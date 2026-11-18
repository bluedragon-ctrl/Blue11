/**
 * The simulated computer and the commands on it, without the DOM (so it is tested): a
 * SimpleMachine with the display, the keyboard and the ROM; load, run a frame, step,
 * breakpoints; live input with a log, and replaying that log exactly.
 *
 * Time is CPU cycles. The page decides how many frames to run per second of wall time;
 * nothing here reads a clock.
 */

import {
  assemble, octal, SimpleMachine, type AsmError, type AssembleResult, type Beam, type Key, type StopReason, type TrapInfo,
} from 'blue11';
import { makeRom, programSymbols } from './rom';

/** One input of a run, at the cycle it happened. */
export type InputEvent =
  | { cycle: number; kind: 'key'; code: number; down: boolean }
  | { cycle: number; kind: 'console'; ch: number };

export interface SimOptions {
  /** 'scan': the real beam, which tears. Default 'instant'. */
  beam?: Beam;
  /** The EIS option (MUL, DIV, ASH, ASHC). Default off. */
  eis?: boolean;
}

/** Why a command stopped: the CPU's reasons, 'frame' (the frame ended), 'asleep' (WAIT and nothing can wake it). */
export type Stop = Exclude<StopReason, 'budget' | 'wait'> | 'frame' | 'asleep';

export interface StepResult {
  stop: Stop | 'step';
  cycles: number;
  trap?: TrapInfo;
}

/** A run saved to a file: the program, its options and its input log (keyboard spec §7.1). */
export interface Recording {
  format: 'blue11-replay';
  version: 1;
  source: string;
  beam: Beam;
  eis: boolean;
  inputs: InputEvent[];
}

/** The loaded program's run so far as a recording, or null if nothing is loaded. */
export function record(sim: Simulator): Recording | null {
  if (sim.source === null) return null;
  return { format: 'blue11-replay', version: 1, source: sim.source, beam: sim.beam, eis: sim.eis, inputs: sim.inputs };
}

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** A recording read back from its JSON, or a message saying what is wrong with it. */
export function parseRecording(text: string): Recording | string {
  let v: Partial<Recording>;
  try { v = JSON.parse(text); } catch { return 'not a replay file (it is not JSON)'; }
  if (!v || v.format !== 'blue11-replay' || v.version !== 1) return 'not a Blue-11 replay file';
  if (typeof v.source !== 'string' || (v.beam !== 'instant' && v.beam !== 'scan') || typeof v.eis !== 'boolean' || !Array.isArray(v.inputs)) {
    return 'a broken replay file';
  }
  let last = 0;
  for (const e of v.inputs as unknown[]) {
    const x = e as Partial<InputEvent> & { code?: unknown; down?: unknown; ch?: unknown };
    const ok = !!x && isCount(x.cycle) && x.cycle >= last
      && ((x.kind === 'key' && isCount(x.code) && x.code < 0o200 && typeof x.down === 'boolean')
        || (x.kind === 'console' && isCount(x.ch) && x.ch < 0o400));
    if (!ok) return 'a broken replay file (its input log)';
    last = x.cycle!;
  }
  return v as Recording;
}

/** RAM ends where the display's pixel window starts. */
const RAM_END = 0o120000;

export class Simulator {
  machine!: SimpleMachine;
  beam: Beam;
  eis: boolean;
  /** The assembly loaded, or null. */
  program: AssembleResult | null = null;
  /** The source loaded, or null. */
  source: string | null = null;
  /** Addresses to stop at before their instruction runs. */
  breakpoints: ReadonlySet<number> = new Set();
  /** Instructions run at each word address since the load. */
  readonly heat = new Uint32Array(0x8000);
  /** Why the last command stopped, or null. */
  last: Stop | 'step' | null = null;
  /** The trap the CPU stopped on (a vector with no handler). */
  trap: TrapInfo | null = null;

  /** Characters typed on the console in this run (the keyboard keeps its own log). */
  private typed: Array<{ cycle: number; ch: number }> = [];
  /** Console characters still to type at their cycle (a replay). */
  private pending: Array<{ cycle: number; ch: number }> = [];

  constructor(opts: SimOptions = {}) {
    this.beam = opts.beam ?? 'instant';
    this.eis = opts.eis ?? false;
    this.build();
  }

  private build(): void {
    const m = new SimpleMachine({ display: { beam: this.beam }, keyboard: true, eis: this.eis });
    m.add(makeRom());
    // A trap through an empty vector stops instead of jumping to 0 and running the vectors.
    m.cpu.onTrap = (t) => (m.read(t.vector, false) === 0 ? 'stop' : 'vector');
    m.cpu.onInstruction = (pc) => { this.heat[pc >> 1]++; };
    this.machine = m;
  }

  get display() { return this.machine.display!; }
  get keyboard() { return this.machine.keyboard!; }
  get cpu() { return this.machine.cpu; }
  /** Cycles per frame (20000). */
  get frameCycles(): number { return this.display.frameCycles; }

  /** Another beam or EIS setting: a new machine, and the program (if any) booted again from the start. */
  configure(opts: SimOptions): void {
    const beam = opts.beam ?? this.beam;
    const eis = opts.eis ?? this.eis;
    if (beam === this.beam && eis === this.eis) return;
    this.beam = beam;
    this.eis = eis;
    this.build();
    if (this.program) this.restart();
  }

  /** Assemble and boot `source`. Returns the errors; none means it is loaded and ready to run. */
  load(source: string): AsmError[] {
    const asm = assemble(source, { symbols: programSymbols() });
    if (!asm.ok) return asm.errors;
    // Everything past RAM would be left out: say so on each line, and load nothing.
    const outside = this.machine.notLoaded(asm);
    if (outside.length) {
      return outside.map((n) => ({
        line: n.line ?? 0,
        column: 0,
        message: `${octal(n.start)}–${octal(n.end - 1)} is past the end of RAM (${octal(RAM_END - 1)}), in the display's memory or above: it can't be loaded`,
      }));
    }
    this.program = asm;
    this.source = source;
    this.restart();
    return [];
  }

  /** Boot the loaded program again: memory cleared, devices powered up, no inputs. */
  restart(): void {
    if (!this.program) return;
    this.machine.boot(this.program);
    this.heat.fill(0);
    this.typed = [];
    this.pending = [];
    this.last = null;
    this.trap = null;
  }

  /** Every input of this run so far, in order. */
  get inputs(): InputEvent[] {
    const keys: InputEvent[] = this.keyboard.log.map((e) => ({ cycle: e.cycle, kind: 'key' as const, code: e.code, down: e.down }));
    const chars: InputEvent[] = this.typed.map((t) => ({ cycle: t.cycle, kind: 'console' as const, ch: t.ch }));
    return [...keys, ...chars].sort((a, b) => a.cycle - b.cycle);
  }

  /** Boot again and feed `inputs` at their cycles: the run happens again exactly. */
  replay(inputs: InputEvent[] = this.inputs): void {
    this.restart();
    for (const e of inputs) {
      if (e.kind === 'key') this.keyboard.at(e.cycle, e.code, e.down);
      else this.pending.push({ cycle: e.cycle, ch: e.ch });
    }
    this.pending.sort((a, b) => a.cycle - b.cycle);
    this.feed();
  }

  /** A key on the keyboard device, now (`KeyboardEvent.code` names, or a key code). */
  press(key: Key): void { this.keyboard.press(key); }
  release(key: Key): void { this.keyboard.release(key); }
  releaseAll(): void { this.keyboard.releaseAll(); }

  /** A character typed on the console terminal, now. */
  type(ch: string | number): void {
    const c = typeof ch === 'number' ? ch : ch.charCodeAt(0);
    this.machine.type(c);
    this.typed.push({ cycle: this.machine.cycles, ch: c });
  }

  /** Type the replay's characters that are due. */
  private feed(): void {
    while (this.pending.length && this.pending[0].cycle <= this.machine.cycles) this.type(this.pending.shift()!.ch);
  }

  /** The CPU can go on: a program is loaded and it has not double-faulted. */
  get canRun(): boolean { return !!this.program && this.last !== 'double-fault'; }

  /** Continuing after HALT goes on with the next instruction, as on the console. */
  private unhalt(): void {
    if (this.cpu.halted && this.last === 'halt') this.cpu.halted = false;
  }

  /** Cycles to the end of the current frame. */
  private toFrameEnd(): number {
    return this.frameCycles - (this.machine.cycles % this.frameCycles);
  }

  /**
   * Run to the end of the current frame, or until the CPU stops. `resume`: a breakpoint at
   * the PC is passed (Continue); a run that goes on from frame to frame stops there.
   */
  runFrame(resume = false): StepResult {
    this.unhalt();
    this.trap = null;
    const pc = this.cpu.r[7];
    if (!resume && this.breakpoints.has(pc) && !this.cpu.halted && !this.cpu.waiting) return this.finish('breakpoint', 0);
    let left = this.toFrameEnd();
    let used = 0;
    while (left > 0) {
      const next = this.pending[0]?.cycle;
      const slice = next !== undefined ? Math.max(1, Math.min(left, next - this.machine.cycles)) : left;
      const r = this.machine.run(slice, this.breakpoints);
      used += r.cycles;
      left -= r.cycles;
      this.feed();
      if (r.reason === 'budget' || (r.reason === 'wait' && r.cycles >= slice)) continue;
      if (r.reason === 'wait') return this.finish('asleep', used);
      this.trap = r.trap ?? null;
      return this.finish(r.reason, used);
    }
    return this.finish('frame', used);
  }

  /** One instruction. Asleep in WAIT, time passes until an interrupt wakes the CPU (at most a frame). */
  step(): StepResult {
    this.unhalt();
    this.trap = null;
    const cpu = this.cpu;
    if (cpu.halted) return this.finish('halt', 0);
    let used = 0;
    if (cpu.waiting) {
      while (cpu.waiting && used < this.frameCycles) {
        const r = this.machine.run(1);
        used += r.cycles;
        this.feed();
        if (r.reason === 'wait' && r.cycles === 0) return this.finish('asleep', used);
      }
      return this.finish(cpu.waiting ? 'frame' : 'step', used);
    }
    const r = this.machine.step();
    this.feed();
    if (r.reason === 'trap' || r.reason === 'double-fault' || r.reason === 'halt') {
      this.trap = r.trap ?? null;
      return this.finish(r.reason, r.cycles);
    }
    return this.finish('step', r.cycles);
  }

  private finish(stop: Stop | 'step', cycles: number): StepResult {
    this.last = stop;
    return { stop, cycles, trap: this.trap ?? undefined };
  }

  /** The address of the first instruction on source line `line`, or null. */
  addressOfLine(line: number): number | null {
    if (!this.program) return null;
    for (const [addr, l] of this.program.lineAt) if (l === line) return addr;
    return null;
  }
}
