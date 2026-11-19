/**
 * The simulated computer and the commands on it, without the DOM (so it is tested): a
 * SimpleMachine with the display, the keyboard, the sound device and the ROM; load, run a frame, step,
 * breakpoints; live input with a log, and replaying that log exactly.
 *
 * Time is CPU cycles. The page decides how many frames to run per second of wall time;
 * nothing here reads a clock.
 */

import {
  assemble, DSP, octal, SimpleMachine, type AsmError, type AssembleResult, type Beam, type Frame, type Key, type SoundChunk, type StopReason, type TrapInfo,
} from 'blue11';
import { History } from './audio';
import { FRAME_CYCLES, TICK_CYCLES } from './time';
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

/**
 * Why a command stopped: the CPU's reasons, 'frame' (the frame ended), 'asleep' (WAIT and
 * nothing can wake it), 'watch' (an instruction wrote a watched word).
 */
export type Stop = Exclude<StopReason, 'budget' | 'wait'> | 'frame' | 'asleep' | 'watch';

export interface StepResult {
  stop: Stop | 'step';
  cycles: number;
  /** Instructions the command ran (an interrupt's handler included). */
  instructions: number;
  trap?: TrapInfo;
  /** For 'watch': the write. */
  watch?: WatchHit;
}

/** A write to a watched word: by the instruction at `pc`, a byte or the word, the word before and after. */
export interface WatchHit {
  /** The word's address (even). */
  address: number;
  /** The byte or word address written. */
  at: number;
  byte: boolean;
  /** The instruction that wrote it; for an interrupt's push, the instruction it interrupted. */
  pc: number;
  /**
   * An interrupt wrote it, pushing the PC and PSW (the stack is the word): the run stopped
   * after the handler's first instruction.
   */
  interrupt: boolean;
  was: number;
  now: number;
}

/** Reads and writes of each word by the program, instruction fetches left out (counted in `heat`). */
export interface AccessCounts {
  reads: Uint32Array;
  writes: Uint32Array;
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
  /**
   * Where the stack starts, for the debugger: the highest SP at an instruction since the boot
   * (in RAM). A program that sets SP itself (`MOV #STK, SP`) moves it up; pushes don't.
   */
  stackTop = 0;
  /** Why the last command stopped, or null. */
  last: Stop | 'step' | null = null;
  /** The trap the CPU stopped on (a vector with no handler). */
  trap: TrapInfo | null = null;
  /** The speaker's last frame of edges, for the waveform view (one frame of cycles). */
  readonly history = new History(FRAME_CYCLES);
  /** BEL characters (7) the program printed and the page has not rung yet. */
  bells = 0;

  /** Reads and writes per word since they were turned on (`countAccesses`) or the restart; null while off. */
  access: AccessCounts | null = null;
  /** The last command stopped on a watched word: the write. */
  watchHit: WatchHit | null = null;
  /** Words (even addresses) to stop after an instruction writes them, with their value as the watch last saw it. */
  private watched = new Map<number, number>();
  /** 1 for a watched word, by word number: the hook's quick test on every write. */
  private watchedWords = new Uint8Array(0x8000);
  /** The watched word written in the instruction now running, if one was. */
  private hit: WatchHit | null = null;
  /** The address of the instruction now running, and how many have run (for the watch). */
  private ipc = 0;
  private count = 0;
  /** `count` when the watched word was written. */
  private hitCount = 0;
  /** `count` when the command began. */
  private startCount = 0;

  /** Characters typed on the console (the keyboard keeps its own log). */
  private typed: Array<{ cycle: number; ch: number }> = [];
  /** Console characters still to type at their cycle (a replay). */
  private pending: Array<{ cycle: number; ch: number }> = [];

  constructor(opts: SimOptions = {}) {
    this.beam = opts.beam ?? 'instant';
    this.eis = opts.eis ?? false;
    this.build();
  }

  private build(): void {
    const m = new SimpleMachine({
      display: { beam: this.beam, frameCycles: FRAME_CYCLES }, clockCycles: TICK_CYCLES, keyboard: true, sound: true, eis: this.eis });
    m.add(makeRom());
    m.onOutput = (ch) => { if (ch === '\x07') this.bells++; };
    // A trap through an empty vector stops instead of jumping to 0 and running the vectors.
    m.cpu.onTrap = (t) => (m.read(t.vector, false) === 0 ? 'stop' : 'vector');
    m.cpu.onInstruction = (pc) => {
      this.ipc = pc;
      this.count++;
      this.heat[pc >> 1]++;
      const sp = m.cpu.r[6];
      if (sp > this.stackTop && sp <= RAM_END) this.stackTop = sp;
    };
    this.machine = m;
    this.hook();
  }

  /**
   * Count reads and writes of every word (on) or stop counting (off; the counts are dropped).
   * The CPU's access hook costs time, so it is on only while counts or watches are used.
   */
  countAccesses(on: boolean): void {
    if (on === !!this.access) return;
    this.access = on ? { reads: new Uint32Array(0x8000), writes: new Uint32Array(0x8000) } : null;
    this.hook();
  }

  /** The words watched (even addresses). */
  get watches(): number[] { return [...this.watched.keys()].sort((a, b) => a - b); }

  /** Stop after an instruction writes the word at `address` (on), or no longer (off). */
  watch(address: number, on: boolean): void {
    const a = address & 0xfffe;
    if (on) this.watched.set(a, 0); else this.watched.delete(a);
    this.watchedWords[a >> 1] = on ? 1 : 0;
    this.hook();
  }

  /** The watched words as they are now (the host may have changed them, or a restart). */
  private seeWatched(): void {
    for (const a of this.watched.keys()) {
      // not read in the I/O page: a register's read can take a character from the program
      const v = a >= 0o170000 && a !== 0o177776 ? -1 : this.machine.read(a, false);
      this.watched.set(a, v < 0 ? -1 : v);
    }
  }

  /** The CPU's access hook: installed only while counting or watching. */
  private hook(): void {
    const cpu = this.machine.cpu;
    const counts = this.access;
    const watched = this.watched;
    const quick = this.watchedWords;
    if (!counts && !watched.size) { cpu.onAccess = null; return; }
    cpu.onAccess = (addr, value, write, byte) => {
      const w = addr >> 1;
      if (write) {
        if (counts) counts.writes[w]++;
        if (quick[w]) {
          const was = watched.get(addr & 0xfffe)!;
          // what was written (a device register may read back otherwise); a byte keeps the other half
          const old = was < 0 ? 0 : was;
          const now = !byte ? value : addr & 1 ? (old & 0xff) | (value << 8) : (old & 0xff00) | value;
          watched.set(addr & 0xfffe, now);
          if (!this.hit) {
            this.hit = { address: addr & 0xfffe, at: addr, byte, pc: this.ipc, interrupt: false, was, now };
            this.hitCount = this.count;
            // stop once this instruction is done: the CPU checks `halted` before the next one
            cpu.halted = true;
          }
        }
      } else if (counts && addr !== cpu.r[7]) counts.reads[w]++; // a fetch reads at the PC
    };
  }

  get display() { return this.machine.display!; }

  /** Whether the program has ended: a HALT, a trap with no handler, a double fault, or a WAIT nothing can wake. */
  get ended(): boolean {
    return this.last === 'halt' || this.last === 'trap' || this.last === 'double-fault' || this.last === 'asleep';
  }

  /**
   * The picture a monitor shows while the CPU stands still: pixel memory as it is now, in the
   * page and mode `DSPCS` selects, with the palette now (what the next vertical blanks would
   * latch). A halted CPU does not stop a real monitor, and a program that halts within its
   * first frame (`MOVB #16, @#SCREEN+4040` / `HALT`) has no frame of its own.
   */
  screenNow(): Frame {
    const d = this.display;
    const csr = this.machine.read(DSP.DSPCS, false);
    const mode = csr & 4 ? 1 : 0;
    const H = mode ? 128 : 64;
    const pixels = new Uint8Array(H * H);
    const b = d.bytes;
    for (let r = 0; r < H; r++) {
      if (mode) {
        const at = (csr & 1) * 0o20000 + r * 0o100;
        for (let i = 0; i < 64; i++) { pixels[r * H + 2 * i] = b[at + i] & 15; pixels[r * H + 2 * i + 1] = b[at + i] >> 4; }
      } else {
        const at = (csr & 3) * 0o10000 + r * 0o100;
        for (let x = 0; x < 64; x++) pixels[r * H + x] = b[at + x] & 15;
      }
    }
    const palette = new Uint16Array(16 * H);
    for (let r = 0; r < H; r++) palette.set(d.palette, 16 * r);
    return { width: H, height: H, number: d.frame.number, pixels, palette };
  }
  get keyboard() { return this.machine.keyboard!; }
  get sound() { return this.machine.sound!; }
  get cpu() { return this.machine.cpu; }
  /** Cycles per screen frame (FRAME_CYCLES). */
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
    if (this.access) { this.access.reads.fill(0); this.access.writes.fill(0); }
    this.watchHit = null;
    this.stackTop = Math.min(this.cpu.r[6], RAM_END);
    this.typed = [];
    this.pending = [];
    this.last = null;
    this.trap = null;
    this.bells = 0;
    this.history.clear();
  }

  /**
   * The speaker since the last call (docs/BLUE11_SOUND.md §7): the page calls it after every
   * command and plays it, and the waveform view keeps it.
   */
  takeSound(): SoundChunk {
    const c = this.sound.take();
    this.history.push(c);
    return c;
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
    this.begin();
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
    this.begin();
    const cpu = this.cpu;
    if (cpu.halted) return this.finish('halt', 0);
    let used = 0;
    while (true) {
      // Asleep, the machine sleeps to the next device event; stop it at the next replayed input.
      const next = this.pending[0]?.cycle;
      const limit = Math.min(this.frameCycles - used, next !== undefined ? Math.max(1, next - this.machine.cycles) : Infinity);
      const r = this.machine.step(limit);
      used += r.cycles;
      this.feed();
      if (r.reason === 'trap' || r.reason === 'double-fault' || r.reason === 'halt') {
        this.trap = r.trap ?? null;
        return this.finish(r.reason, used);
      }
      if (r.reason !== 'wait' || r.instructions > 0) return this.finish('step', used);
      if (r.cycles === 0) return this.finish('asleep', used);
      if (used >= this.frameCycles) return this.finish('frame', used);
    }
  }

  /** A command starts: no trap, no watch hit yet, the watched words as they are. */
  private begin(): void {
    this.startCount = this.count;
    this.trap = null;
    this.hit = null;
    this.watchHit = null;
    if (this.watched.size) this.seeWatched();
  }

  /**
   * The stop, with the watch: the hook set `halted` to stop after the instruction that wrote a
   * watched word, so the stop is a 'watch' and the CPU goes on. A trap or a double fault in the
   * same instruction is said first (a double fault stays halted).
   */
  private finish(reason: Stop | 'step', cycles: number): StepResult {
    let stop = reason;
    if (this.hit) {
      // an instruction ran after the write: the write came before it, from an interrupt
      this.watchHit = { ...this.hit, interrupt: this.count > this.hitCount };
      this.hit = null;
      if (stop !== 'double-fault') this.cpu.halted = false;
      if (stop !== 'trap' && stop !== 'double-fault') stop = 'watch';
    }
    this.last = stop;
    return { stop, cycles, instructions: this.count - this.startCount, trap: this.trap ?? undefined, watch: this.watchHit ?? undefined };
  }

  /** The address of the first instruction on source line `line`, or null. */
  addressOfLine(line: number): number | null {
    if (!this.program) return null;
    for (const [addr, l] of this.program.lineAt) if (l === line) return addr;
    return null;
  }
}
