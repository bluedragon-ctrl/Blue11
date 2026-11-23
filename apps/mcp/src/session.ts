/**
 * The MCP server's tools, without the protocol: one machine, the simulator's own (`Simulator`
 * from apps/simulator/src/sim.ts, with its ROM, display, keyboard, sound and console), and
 * the commands an agent runs on it. Each returns MCP content: text, and the screen as a PNG.
 * Numbers shown are octal, as everywhere on Blue-11.
 *
 * Time is cycles, as in the simulator: a run is a number of screen frames, and inputs come
 * at frames or cycles, so the same call gives the same result every time.
 */

import { disassemble, keyCode, octal, REGISTER_NAMES, type Frame } from 'blue11';
import { Simulator, type InputEvent, type StepResult } from '../../simulator/src/sim';
import { addressNamer, inRom, parseAddress, peek, stackRows } from '../../simulator/src/debug';
import { describeTrap } from '../../simulator/src/traps';
import { shareHash } from '../../simulator/src/storage';
import { PROGRAMS } from '../../simulator/src/programs';
import { programSymbols } from '../../simulator/src/rom';
import { CPU_HZ, FRAME_CYCLES } from '../../simulator/src/time';
import { HelpIndex, plain, type Block, type Section } from '../../simulator/src/help/model';
import { SECTIONS } from '../../simulator/src/help/sections';
import { frameToPng } from './png';
import { specTool } from './spec';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' };
export type ToolResult = { content: Content[]; isError?: boolean; [key: string]: unknown };

/** Where share links point; BLUE11_SIMULATOR_URL changes it (a local `npm run dev`). */
export const DEFAULT_SIMULATOR_URL = 'https://bluedragon-ctrl.github.io/Blue11/';

export const MAX_FRAMES = 36_000; // 10 minutes of machine time
export const MAX_SNAPSHOTS = 8;
const MAX_OUTPUT = 8000;

/** One input, at a frame (60 a second) or a cycle from the boot. */
export interface InputSpec {
  frame?: number;
  cycle?: number;
  /** Characters typed on the console; a newline is Enter (CR, 015). */
  text?: string;
  /** A key on the keyboard device: a `KeyboardEvent.code` name (`ArrowLeft`, `KeyA`, `Space`, `Enter`). */
  key?: string;
  /** true: press, false: release; leave out for a tap (pressed for `hold_frames`, default 2). */
  down?: boolean;
  hold_frames?: number;
}

export interface RunArgs {
  source: string;
  frames?: number;
  eis?: boolean;
  beam?: 'instant' | 'scan';
  inputs?: InputSpec[];
  /** Source lines (numbers), labels, or octal addresses (strings of octal digits). */
  breakpoints?: Array<number | string>;
  /** Frames after which to capture the screen, as well as the end. */
  snapshots?: number[];
  screen?: boolean;
}

const text = (t: string): Content => ({ type: 'text', text: t });
const image = (png: Buffer): Content => ({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
const fail = (t: string): ToolResult => ({ content: [text(t)], isError: true });

export class Session {
  readonly sim = new Simulator();
  /** How much of the console output earlier commands reported. */
  private seen = 0;
  private frames = 0;
  readonly help = new HelpIndex(SECTIONS);

  constructor(readonly simulatorUrl = DEFAULT_SIMULATOR_URL) {}

  // ---------------------------------------------------------------- assemble

  assemble(args: { source: string; eis?: boolean; listing?: boolean }): ToolResult {
    const sim = new Simulator({ eis: args.eis });
    const errors = sim.load(args.source);
    if (errors.length) return fail(this.errorText(args.source, errors));
    const p = sim.program!;
    const out = [`Assembled: ${p.bytes.length}. bytes at ${octal(p.origin)}–${octal(p.origin + p.bytes.length - 1)}, start ${octal(p.start)}.`];
    if (p.warnings.length) out.push('Warnings:\n' + p.warnings.map((w) => `  line ${w.line}: ${w.message}`).join('\n'));
    const predefined = programSymbols();
    const own = [...p.symbols].filter(([k]) => !(k in predefined));
    if (own.length) out.push('Symbols:\n' + own.map(([k, v]) => `  ${k.padEnd(8)} ${octal(v)}${p.labels.has(k) ? '' : ' (=)'}`).join('\n'));
    if (args.listing) out.push('Listing:\n' + p.listing);
    return { content: [text(out.join('\n\n'))] };
  }

  private errorText(source: string, errors: Array<{ line: number; message: string }>): string {
    const lines = source.split('\n');
    return `${errors.length} error${errors.length > 1 ? 's' : ''}, nothing loaded:\n`
      + errors.map((e) => `  line ${e.line}: ${e.message}${lines[e.line - 1] !== undefined ? `\n      ${lines[e.line - 1].trim()}` : ''}`).join('\n');
  }

  // ---------------------------------------------------------------- run

  run(args: RunArgs): ToolResult {
    const sim = this.sim;
    sim.configure({ eis: args.eis ?? false, beam: args.beam ?? 'instant' });
    const errors = sim.load(args.source);
    if (errors.length) return fail(this.errorText(args.source, errors));
    let inputs: InputEvent[];
    try { inputs = toInputs(args.inputs ?? []); } catch (e) { return fail((e as Error).message); }
    if (inputs.length) sim.replay(inputs);
    const bp = this.breakpoints(args.breakpoints ?? []);
    if (typeof bp === 'string') return fail(bp);
    sim.breakpoints = bp;
    this.seen = 0;
    this.frames = 0;
    sim.takeSound();
    return this.go(args.frames ?? 300, false, args.snapshots ?? [], args.screen);
  }

  continue(args: { frames?: number; snapshots?: number[]; screen?: boolean; breakpoints?: Array<number | string> }): ToolResult {
    if (!this.sim.program) return fail('No program is loaded: call run first.');
    if (!this.sim.canRun) return fail('The machine double-faulted: call run to start again.');
    if (args.breakpoints) {
      const bp = this.breakpoints(args.breakpoints);
      if (typeof bp === 'string') return fail(bp);
      this.sim.breakpoints = bp;
    }
    return this.go(args.frames ?? 300, true, args.snapshots ?? [], args.screen);
  }

  /** Run up to `frames` frames, as the page does: the first may pass a breakpoint at the PC. */
  private go(frames: number, resume: boolean, snapshots: number[], screen?: boolean): ToolResult {
    const sim = this.sim;
    const n = Math.max(1, Math.min(MAX_FRAMES, Math.floor(frames)));
    const want = new Set(snapshots.slice(0, MAX_SNAPSHOTS).map((f) => Math.floor(f)));
    const shots: Content[] = [];
    let r: StepResult | null = null;
    let cycles = 0;
    let instructions = 0;
    let edges = 0;
    let ran = 0;
    for (; ran < n; ran++) {
      r = sim.runFrame(resume && ran === 0);
      cycles += r.cycles;
      instructions += r.instructions;
      edges += sim.takeSound().edges.length;
      if (r.stop !== 'frame') break;
      this.frames++;
      if (want.has(this.frames)) shots.push(text(`Screen after frame ${this.frames}:`), image(frameToPng(sim.display.frame)));
    }
    const out: string[] = [this.stopText(r!, ran >= n)];
    out.push(`This command: ${cycles} cycles (${(cycles / CPU_HZ).toFixed(3)} s of machine time at ${CPU_HZ / 1e6} MHz), ${instructions} instructions; ${this.frames} whole frames since the boot.`);
    if (edges) out.push(`Speaker: ${edges} edges.`);
    if (sim.bells) out.push(`Bell: rung ${sim.bells} time${sim.bells > 1 ? 's' : ''}.`);
    out.push(this.consoleText(), this.stateText(), `Open it in the simulator: ${this.link()}`);
    return { content: [text(out.join('\n\n')), ...shots, ...this.screenContent(screen)] };
  }

  /** Why the run stopped, where, on which line. */
  private stopText(r: StepResult, budget: boolean): string {
    const sim = this.sim;
    const pc = sim.cpu.r[7];
    switch (r.stop) {
      case 'frame': return budget ? `Still running after the frames asked for (PC ${this.where(pc)}). continue goes on.` : 'Stopped at the end of a frame.';
      case 'halt': return `Ended: HALT at ${this.where((pc - 2) & 0xffff)}.`;
      case 'breakpoint': return `Stopped at a breakpoint: ${this.where(pc)}. step or continue go on.`;
      case 'asleep': return `Ended: WAIT at ${this.where(pc)}, and no device has interrupts on: nothing can wake the CPU.`;
      case 'double-fault': return `Ended: double fault at ${this.where(pc)}: a trap could not push onto the stack (is SP valid?).`;
      case 'trap': return `Ended: ${describeTrap(r.trap!, sim.cpu, (a) => sim.machine.read(a, false))} (${this.where(r.trap!.pc)})`;
      case 'watch': return `Stopped: a watched word was written, at ${this.where(pc)}.`;
      case 'step': return `Stepped to ${this.where(pc)}.`;
    }
  }

  /** An address with its name and source line: `001012 (LOOP, line 7: MOVB (R1)+, R0)`. */
  private where(addr: number): string {
    const p = this.sim.program;
    const name = addressNamer(p)(addr);
    const line = p?.lineAt.get(addr);
    const src = line !== undefined ? this.sim.source!.split('\n')[line - 1]?.trim() : undefined;
    const parts = [name, inRom(addr) ? 'in the ROM' : undefined, line !== undefined ? `line ${line}: ${src}` : undefined].filter(Boolean);
    return parts.length ? `${octal(addr)} (${parts.join(', ')})` : octal(addr);
  }

  private consoleText(): string {
    const all = this.sim.machine.output.replace(/\r\n?/g, '\n');
    const fresh = all.slice(this.seen);
    this.seen = all.length;
    if (!all) return 'Console: no output.';
    if (!fresh) return `Console: nothing new (${all.length} characters in all).`;
    const shown = fresh.length > MAX_OUTPUT ? '…' + fresh.slice(-MAX_OUTPUT) : fresh;
    return `Console output${fresh.length < all.length ? ' since the last command' : ''} (${fresh.length} characters):\n\`\`\`\n${shown}\n\`\`\``;
  }

  /** The registers, the PSW and the instructions around the PC. */
  stateText(): string {
    const sim = this.sim;
    const cpu = sim.cpu;
    const flags = ['N', 'Z', 'V', 'C'].map((f, i) => (cpu.psw & (8 >> i) ? f : '-')).join('');
    const regs = REGISTER_NAMES.map((n, i) => `${n}=${octal(cpu.r[i])}`).join(' ');
    const out = [`Registers: ${regs}\nPSW ${octal(cpu.psw)} ${flags} priority ${(cpu.psw >> 5) & 7}${cpu.halted ? ', HALTED' : cpu.waiting ? ', in WAIT' : ''}`];
    const read = (a: number) => sim.machine.read(a, false);
    const nameOf = addressNamer(sim.program);
    const rows: string[] = [];
    let a = cpu.r[7] & 0xfffe;
    for (let i = 0; i < 4; i++) {
      const d = disassemble(read, a, { nameOf });
      const line = sim.program?.lineAt.get(a);
      const p = sim.program;
      const data = line === undefined && p && a >= p.origin && a < p.origin + p.bytes.length;
      rows.push(`${i === 0 ? '→' : ' '} ${octal(a)}  ${d.text.padEnd(24)}${line !== undefined ? ` ; line ${line}` : data ? ' ; data of the program, not an instruction' : ''}`.trimEnd());
      a = (a + 2 * d.words.length) & 0xffff;
    }
    out.push('Next instructions:\n' + rows.join('\n'));
    const stack = stackRows(read, cpu.r[6], sim.stackTop, 6);
    if (stack.length) out.push('Stack (top first): ' + stack.map((s) => `${octal(s.address)}:${octal(s.value)}`).join(' '));
    return out.join('\n');
  }

  private breakpoints(list: Array<number | string>): Set<number> | string {
    const set = new Set<number>();
    for (const b of list) {
      let a: number | null;
      if (typeof b === 'number') {
        a = this.sim.addressOfLine(b);
        if (a === null) return `Breakpoint: line ${b} has no instruction.`;
      } else {
        a = parseAddress(b, this.sim.program?.symbols ?? new Map());
        if (a === null) return `Breakpoint: ${b} is not a label, symbol or octal address.`;
      }
      set.add(a);
    }
    return set;
  }

  // ---------------------------------------------------------------- step, state, memory, screen

  step(args: { count?: number }): ToolResult {
    const sim = this.sim;
    if (!sim.program) return fail('No program is loaded: call run first.');
    if (!sim.canRun) return fail('The machine double-faulted: call run to start again.');
    const n = Math.max(1, Math.min(500, Math.floor(args.count ?? 1)));
    const read = (a: number) => sim.machine.read(a, false);
    const nameOf = addressNamer(sim.program);
    const rows: string[] = [];
    let r: StepResult | null = null;
    for (let i = 0; i < n; i++) {
      const pc = sim.cpu.r[7];
      const before = [...sim.cpu.r];
      const psw = sim.cpu.psw;
      const d = disassemble(read, pc, { nameOf });
      r = sim.step();
      sim.takeSound();
      const changed = REGISTER_NAMES.slice(0, 7).map((name, j) => (sim.cpu.r[j] !== before[j] ? `${name}=${octal(sim.cpu.r[j])}` : '')).filter(Boolean);
      if (sim.cpu.psw !== psw) changed.push(`PSW=${octal(sim.cpu.psw)}`);
      const line = sim.program.lineAt.get(pc);
      rows.push(`${octal(pc)}  ${d.text.padEnd(24)} ${line !== undefined ? `line ${String(line).padEnd(4)}` : '         '} ${changed.join(' ')}`.trimEnd());
      if (r.stop !== 'step') break;
      if (i < n - 1 && sim.breakpoints.has(sim.cpu.r[7])) { r = { ...r, stop: 'breakpoint' }; break; }
    }
    const out = [`${rows.length} instruction${rows.length > 1 ? 's' : ''} (address, instruction, source line, what changed):\n${rows.join('\n')}`];
    if (r!.stop !== 'step') out.push(this.stopText(r!, false));
    out.push(this.consoleText(), this.stateText());
    return { content: [text(out.join('\n\n'))] };
  }

  state(): ToolResult {
    if (!this.sim.program) return fail('No program is loaded: call run first.');
    return { content: [text(`${this.sim.last ? `Last stop: ${this.sim.last}. ` : ''}PC at ${this.where(this.sim.cpu.r[7])}.\n\n${this.stateText()}`)] };
  }

  memory(args: { address: string; count?: number; format?: 'words' | 'bytes' | 'instructions' | 'text' }): ToolResult {
    const sim = this.sim;
    const start = parseAddress(args.address, sim.program?.symbols ?? new Map(), sim.cpu.r);
    if (start === null) return fail(`${args.address} is not an octal address, a label, a device register or a register.`);
    const count = Math.max(1, Math.min(512, Math.floor(args.count ?? 16)));
    const read = (a: number) => sim.machine.read(a, false);
    const word = (a: number) => peek(read, a);
    const out: string[] = [];
    switch (args.format ?? 'words') {
      case 'words': {
        let a = start & 0xfffe;
        for (let i = 0; i < count; i += 8) {
          const ws = [];
          for (let j = 0; j < 8 && i + j < count; j++) { const w = word(a + 2 * j); ws.push(w === null ? '------' : octal(w)); }
          out.push(`${octal(a)}: ${ws.join(' ')}`);
          a = (a + 16) & 0xffff;
        }
        break;
      }
      case 'bytes': {
        let a = start;
        for (let i = 0; i < count; i += 8) {
          const bs = [];
          for (let j = 0; j < 8 && i + j < count; j++) {
            const w = word((a + j) & 0xffff);
            bs.push(w === null ? '---' : octal(((a + j) & 1 ? w >> 8 : w) & 0xff, 3));
          }
          out.push(`${octal(a)}: ${bs.join(' ')}`);
          a = (a + 8) & 0xffff;
        }
        break;
      }
      case 'text': {
        let s = '';
        for (let i = 0; i < count; i++) {
          const w = word((start + i) & 0xffff);
          const b = w === null ? -1 : ((start + i) & 1 ? w >> 8 : w) & 0xff;
          s += b >= 0o40 && b < 0o177 ? String.fromCharCode(b) : b === 0 ? '\\0' : b === 0o12 ? '\\n' : b === 0o15 ? '\\r' : '·';
        }
        out.push(`${octal(start)}: ${s}`);
        break;
      }
      case 'instructions': {
        const nameOf = addressNamer(sim.program);
        let a = start & 0xfffe;
        for (let i = 0; i < count; i++) {
          const d = disassemble(read, a, { nameOf });
          const line = sim.program?.lineAt.get(a);
          const label = nameOf(a);
          out.push(`${octal(a)}  ${d.words.map((w) => octal(w)).join(' ').padEnd(20)} ${(label ? label + ':' : '').padEnd(8)} ${d.text}${line !== undefined ? `   ; line ${line}` : ''}`);
          a = (a + 2 * d.words.length) & 0xffff;
        }
        break;
      }
    }
    const note = sim.program ? '' : ' (no program loaded: memory of an empty machine)';
    return { content: [text(`Memory from ${octal(start)}${note}:\n${out.join('\n')}`)] };
  }

  /** The screen: `now` shows pixel memory as it is, otherwise the frame a monitor shows. */
  screen(args: { now?: boolean } = {}): ToolResult {
    return { content: this.screenContent(true, args.now) };
  }

  private screenContent(want?: boolean, now?: boolean): Content[] {
    const sim = this.sim;
    // As the page shows it: the latched frame while running, pixel memory once ended.
    const f: Frame = now || sim.ended ? sim.screenNow() : sim.display.frame;
    const blank = f.pixels.every((p) => p === f.pixels[0]);
    if (want === false || (want === undefined && blank)) {
      return blank && want === undefined ? [text('Screen: blank (one colour); not shown.')] : [];
    }
    const mode = f.width === 128 ? 1 : 0;
    return [text(`Screen: mode ${mode}, ${f.width} × ${f.height} pixels, frame ${f.number}${now || sim.ended ? ' (pixel memory as it is now)' : ''}, shown at ${256 / f.width}×:`), image(frameToPng(f))];
  }

  // ---------------------------------------------------------------- links, help, examples

  link(source = this.sim.source ?? '', eis = this.sim.eis, beam = this.sim.beam): string {
    return this.simulatorUrl + shareHash({ source, eis, beam });
  }

  shareLink(args: { source?: string; eis?: boolean; beam?: 'instant' | 'scan' }): ToolResult {
    if (args.source === undefined && !this.sim.source) return fail('Give the source, or run a program first.');
    return { content: [text(this.link(args.source, args.eis, args.beam))] };
  }

  helpTool(args: { section?: string; query?: string }): ToolResult {
    if (args.section) {
      const s = this.help.section(args.section);
      if (!s) return fail(`No section ${args.section}. Call help with no arguments for the contents.`);
      return { content: [text(sectionMarkdown(s, this.help))] };
    }
    if (args.query) {
      const entry = this.help.entryFor(args.query);
      const hits = this.help.search(args.query, 15);
      const out: string[] = [];
      if (entry) out.push(`**${plain(entry.entry.term)}**${entry.entry.detail ? ` (${plain(entry.entry.detail)})` : ''}: ${plain(entry.entry.text)}\n(in section \`${entry.section.id}\`)`);
      if (hits.length) out.push('Matches (section ids for help { section }):\n' + hits.map((h) => `- ${h.label} — \`${h.section}\`${h.anchor ? ` (${h.where})` : ''}`).join('\n'));
      return out.length ? { content: [text(out.join('\n\n'))] } : fail(`Nothing in the help matches "${args.query}".`);
    }
    const groups = new Map<string, Section[]>();
    for (const s of this.help.sections) groups.set(s.group, [...(groups.get(s.group) ?? []), s]);
    const toc = [...groups].map(([g, ss]) => `${g}:\n` + ss.map((s) => `- \`${s.id}\`: ${s.title}`).join('\n')).join('\n\n');
    return { content: [text(`The simulator's help, for students. Call help { section: "<id>" } to read one.\n\n${toc}`)] };
  }

  spec(args: { topic?: string; section?: string; query?: string }): ToolResult {
    const r = specTool(args);
    return r.ok ? { content: [text(r.text)] } : fail(r.text);
  }

  examples(args: { id?: string }): ToolResult {
    if (args.id) {
      const p = PROGRAMS.find((x) => x.id === args.id);
      if (!p) return fail(`No example ${args.id}. Call examples with no id for the list.`);
      const notes = [p.beam === 'scan' ? 'Meant for beam: "scan".' : '', p.input ? `Console input to type: ${JSON.stringify(p.input)}` : '',
        p.keys ? `Keys: ${p.keys}` : '', p.expect ? `Console output it ends with: ${JSON.stringify(p.expect)}` : ''].filter(Boolean);
      return { content: [text(`${p.name} (${p.group})\n${notes.join('\n')}\n\n\`\`\`\n${p.source.replace(/^\n/, '')}\n\`\`\``)] };
    }
    return { content: [text('The simulator\'s examples (examples { id } gives the source):\n' + PROGRAMS.map((p) => `- \`${p.id}\` — ${p.group}: ${p.name}`).join('\n'))] };
  }
}

/** Inputs as the simulator's log: console characters and key presses at their cycles. */
export function toInputs(specs: InputSpec[]): InputEvent[] {
  const out: InputEvent[] = [];
  for (const s of specs) {
    const cycle = Math.floor(s.cycle ?? (s.frame ?? 0) * FRAME_CYCLES);
    if (!(cycle >= 0)) throw new Error('An input needs a frame or cycle of 0 or more.');
    if (s.text !== undefined) {
      for (const ch of s.text.replace(/\r?\n/g, '\r')) {
        const c = ch.charCodeAt(0);
        if (c > 0o377) throw new Error(`The console takes 8-bit characters: ${JSON.stringify(ch)} is not one.`);
        out.push({ cycle, kind: 'console', ch: c });
      }
    }
    if (s.key !== undefined) {
      const code = keyCode(s.key);
      if (!code) throw new Error(`Unknown key ${s.key}: use KeyboardEvent.code names such as ArrowLeft, KeyA, Digit1, Space, Enter, ShiftLeft.`);
      if (s.down !== undefined) out.push({ cycle, kind: 'key', code, down: s.down });
      else {
        out.push({ cycle, kind: 'key', code, down: true });
        out.push({ cycle: cycle + Math.max(1, Math.floor(s.hold_frames ?? 2) * FRAME_CYCLES), kind: 'key', code, down: false });
      }
    }
    if (s.text === undefined && s.key === undefined) throw new Error('An input needs text (the console) or key (the keyboard).');
  }
  return out.sort((a, b) => a.cycle - b.cycle);
}

/** A help section as Markdown. Links become their label with the section id. */
export function sectionMarkdown(s: Section, help: HelpIndex): string {
  const inline = (t: string) => t.replace(/\[([^\]]+)\]\(([\w-]+)(?:#[\w.$-]+)?\)/g, (_, label, id) => (help.section(id) ? `${label} (section \`${id}\`)` : label));
  const block = (b: Block): string => {
    switch (b.kind) {
      case 'p': return inline(b.text);
      case 'h': return `### ${inline(b.text)}`;
      case 'note': return `> ${inline(b.text)}`;
      case 'list': return b.items.map((i) => `- ${inline(i)}`).join('\n');
      case 'code': return '```\n' + b.text + '\n```';
      case 'table': return [`| ${b.head.map(inline).join(' | ')} |`, `|${b.head.map(() => ' --- ').join('|')}|`, ...b.rows.map((r) => `| ${r.map(inline).join(' | ')} |`)].join('\n');
      case 'entries': return b.entries.map((e) => `- **${inline(e.term)}**${e.detail ? ` (${inline(e.detail)})` : ''}: ${inline(e.text)}`).join('\n');
    }
  };
  return [`## ${s.title}`, ...s.blocks.map(block)].join('\n\n');
}
