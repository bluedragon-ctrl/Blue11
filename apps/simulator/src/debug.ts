/**
 * The debugger's views, without the DOM: the registers, disassembly around the PC with
 * names (device registers, labels, the ROM's routines), memory rows, the heat per source
 * line, addresses typed by the student, and the memory explorer (what each word is: an
 * instruction, an operand, data, the stack; which region it is in; what changed). Numbers
 * are octal.
 */

import { disassemble, octal, PSW_ADDRESS, REGISTER_NAMES, REGISTERS, type AssembleResult, type Cpu } from 'blue11';
import { SIM_SYMBOLS } from '../../../packages/blue11/examples/examples';
import { ROM_BASE, ROM_SIZE, romAssembly } from './rom';

type Read = (addr: number) => number;

/** Names that are addresses: the device registers (not the key codes). */
const DEVICE_NAMES = Object.entries(SIM_SYMBOLS).filter(([k, v]) => !k.startsWith('K.') && v >= 0o160000 && !k.endsWith('VEC'));

export const inRom = (a: number): boolean => a >= ROM_BASE && a < ROM_BASE + ROM_SIZE;

/** A name for an address: a device register, a ROM label, or a label of the program. */
export function addressNamer(prog?: Pick<AssembleResult, 'symbols' | 'labels'> | null): (addr: number) => string | undefined {
  const names = new Map<number, string>();
  const rom = romAssembly();
  for (const l of rom.labels) if (/^[A-Z]/.test(l)) names.set(rom.symbols.get(l)!, l);
  for (const l of prog?.labels ?? []) {
    const v = prog!.symbols.get(l);
    if (v !== undefined && /^[A-Z]/.test(l)) names.set(v, l);
  }
  for (const [k, v] of DEVICE_NAMES) names.set(v, k);
  names.set(PSW_ADDRESS, 'PSW');
  return (addr) => names.get(addr & 0xffff);
}

export interface DisasmRow {
  address: number;
  words: number[];
  text: string;
  label?: string;
}

/**
 * About `count` instructions around `pc`, `before` of them ahead of it. `starts` are
 * addresses known to begin instructions (an assembly's `lineAt` keys), so the rows before
 * the PC line up; without them the view starts at the PC.
 */
export function disassemblyAround(read: Read, pc: number, starts: Iterable<number>,
  opts: { before?: number; count?: number; nameOf?: (a: number) => string | undefined } = {}): DisasmRow[] {
  const { before = 4, count = 16, nameOf } = opts;
  const sorted = [...starts].sort((a, b) => a - b);
  let from = pc;
  const i = sorted.indexOf(pc);
  if (i >= 0) from = sorted[Math.max(0, i - before)];
  const rows: DisasmRow[] = [];
  let a = from & 0xfffe;
  while (rows.length < count) {
    const d = disassemble(read, a, { nameOf });
    rows.push({ address: a, words: d.words, text: d.text, label: nameOf?.(a) });
    a = (a + 2 * d.words.length) & 0xffff;
    if (a === 0) break;
  }
  return rows;
}

/** Registers whose read takes the character waiting there: the debugger never reads them. */
export const READ_TAKES: ReadonlySet<number> = new Set([SIM_SYMBOLS.RBUF, SIM_SYMBOLS.KBDBUF]);

/**
 * The word at `addr` (made even) as the debugger may look at it: null where nothing answers
 * (a bus error) and for `RBUF` and `KBDBUF`, whose read would take the character from the
 * program.
 */
export function peek(read: Read, addr: number): number | null {
  const a = addr & 0xfffe;
  if (READ_TAKES.has(a)) return null;
  const v = read(a);
  return v < 0 ? null : v & 0xffff;
}

/** `rows` rows of `perRow` words from `start` (even, rounded down to a row); null: see {@link peek}. */
export function memoryRows(read: Read, start: number, rows = 8, perRow = 4): Array<{ address: number; words: Array<number | null> }> {
  const out = [];
  let a = start & ~(2 * perRow - 1) & 0xffff;
  for (let r = 0; r < rows; r++) {
    const words = [];
    for (let i = 0; i < perRow; i++) words.push(peek(read, a + 2 * i));
    out.push({ address: a, words });
    a = (a + 2 * perRow) & 0xffff;
  }
  return out;
}

/**
 * An address typed by the student: octal, a label or symbol of the program, a device or
 * ROM name (DSPCS, FONT), or a register (its value). Null if it is none of these.
 */
export function parseAddress(text: string, symbols: ReadonlyMap<string, number>, regs?: ArrayLike<number>): number | null {
  const t = text.trim().toUpperCase();
  if (/^[0-7]+$/.test(t)) {
    const v = parseInt(t, 8);
    return v <= 0xffff ? v : null;
  }
  if (t in REGISTERS && regs) return regs[REGISTERS[t]] & 0xffff;
  const v = symbols.get(t) ?? SIM_SYMBOLS[t] ?? romAssembly().symbols.get(t);
  return v === undefined ? null : v & 0xffff;
}

/** Executions per source line: the counts of its instructions' first words. */
export function lineHeat(heat: Uint32Array, lineAt: ReadonlyMap<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [addr, line] of lineAt) {
    const n = heat[addr >> 1];
    if (n) out.set(line, (out.get(line) ?? 0) + n);
  }
  return out;
}

/** The CPU panel: the registers, the PSW with its flags and priority, and HALTED or WAIT. */
export function registerText(cpu: Cpu): string {
  const flags = ['N', 'Z', 'V', 'C'].map((f, i) => (cpu.psw & (8 >> i) ? f : '-')).join('');
  return REGISTER_NAMES.map((n, i) => `${n.padEnd(3)} ${octal(cpu.r[i])}`).join('\n')
    + `\nPSW ${octal(cpu.psw)} ${flags} pri ${(cpu.psw >> 5) & 7}` + (cpu.halted ? '\nHALTED' : cpu.waiting ? '\nWAIT' : '');
}

/** The words from SP up to where the stack started (at most `max`), top first. */
export function stackRows(read: Read, sp: number, base: number, max = 8): Array<{ address: number; value: number }> {
  const out = [];
  for (let a = sp & 0xfffe; a < base && out.length < max; a += 2) out.push({ address: a, value: read(a) & 0xffff });
  return out;
}


// ---------------------------------------------------------------- the memory explorer

export type Region = 'vectors' | 'ram' | 'pixels' | 'rom' | 'io';

/** The simulator's memory map, region by region (end is exclusive). */
export const REGIONS: ReadonlyArray<{ region: Region; start: number; end: number; name: string; about: string }> = [
  { region: 'vectors', start: 0, end: 0o400, name: 'vectors', about: 'trap and interrupt vectors: two words each, the new PC and the new PSW' },
  { region: 'ram', start: 0o400, end: 0o120000, name: 'RAM', about: 'your program, its data and the stack' },
  { region: 'pixels', start: 0o120000, end: ROM_BASE, name: 'pixel memory', about: 'the display: a byte per pixel in mode 0 (pages at 120000, 130000, 140000, 150000), two in mode 1 (120000, 140000)' },
  { region: 'rom', start: ROM_BASE, end: ROM_BASE + ROM_SIZE, name: 'ROM', about: 'read-only: DRAWCH, DRAWC1 and the font' },
  { region: 'io', start: ROM_BASE + ROM_SIZE, end: 0o200000, name: 'I/O page', about: 'the devices\' registers; most addresses here answer nothing' },
];

export const regionOf = (addr: number): (typeof REGIONS)[number] => REGIONS.find((r) => (addr & 0xffff) < r.end)!;

/** The CPU's vectors and the devices': the name of the trap or interrupt whose new PC is at `addr`. */
const VECTORS = new Map<number, string>([
  [0o4, 'bus error, odd address, stack limit'], [0o10, 'illegal instruction'], [0o14, 'BPT, trace'], [0o20, 'IOT'],
  [0o24, 'power fail'], [0o30, 'EMT'], [0o34, 'TRAP'], [0o60, 'console input'], [0o64, 'console output'],
  [0o100, 'line clock'], [SIM_SYMBOLS.DSPVEC, 'display, vertical blank'], [SIM_SYMBOLS.KBDVEC, 'keyboard'],
]);

/** What a vector word is for: "TRAP: new PC" at 34, "TRAP: new PSW" at 36. */
export function vectorName(addr: number): string | undefined {
  const a = addr & 0xfffe;
  const pc = VECTORS.get(a);
  if (pc) return `${pc}: new PC`;
  const psw = VECTORS.get(a - 2);
  return psw ? `${psw}: new PSW` : undefined;
}

/** What a word holds, as far as the debugger knows: the assembler's output, or the stack. */
export type Role = 'code' | 'operand' | 'data' | 'stack';
const ROLES: ReadonlyArray<Role | null> = [null, 'code', 'operand', 'data', 'stack'];

export interface MemoryLayout {
  role(addr: number): Role | null;
  /** The source line that made the word, in the program or (rom) in the ROM. */
  source(addr: number): { line: number; rom: boolean } | undefined;
}

/**
 * Each word's role and source line, from the assemblies of the program and the ROM (an
 * instruction's first word, its operand words, data), and the stack: from SP up to `base`,
 * over data (a stack is often space kept with `.BLKW`) but not over instructions.
 */
export function memoryLayout(prog: Pick<AssembleResult, 'lines'> | null | undefined, rom: Pick<AssembleResult, 'lines'>,
  sp: number, base: number): MemoryLayout {
  const roles = new Uint8Array(0x8000);
  const lines = new Int32Array(0x8000); // + program line, - ROM line, 0 none
  const add = (asm: Pick<AssembleResult, 'lines'>, sign: number) => {
    for (const l of asm.lines) {
      for (let i = 0; i < l.bytes.length; i++) {
        const w = ((l.address + i) & 0xffff) >> 1;
        roles[w] = l.code ? (i < 2 ? 1 : 2) : 3;
        lines[w] = sign * l.line;
      }
    }
  };
  add(rom, -1);
  if (prog) add(prog, 1);
  if (sp <= base) for (let a = sp & 0xfffe; a < base; a += 2) if (roles[a >> 1] !== 1 && roles[a >> 1] !== 2) roles[a >> 1] = 4;
  return {
    role: (addr) => ROLES[roles[(addr & 0xffff) >> 1]],
    source: (addr) => {
      const l = lines[(addr & 0xffff) >> 1];
      return l ? { line: Math.abs(l), rom: l < 0 } : undefined;
    },
  };
}

/** Every word of memory as the debugger sees it (-1 for null, see {@link peek}), to compare with later. */
export function memorySnapshot(read: Read): Int32Array {
  const out = new Int32Array(0x8000);
  for (let w = 0; w < 0x8000; w++) out[w] = peek(read, w << 1) ?? -1;
  return out;
}

export interface MemCell {
  address: number;
  value: number | null;
  /** The value in the snapshot, if it was different. */
  was?: number | null;
  role: Role | null;
  name?: string;
}

/** Words per row in the explorer: 20 bytes, so each row starts at an address ending in 0. */
export const ROW_WORDS = 8;

/** `rows` rows of {@link ROW_WORDS} words from `start` (rounded down to a row), with what each one is. */
export function explorerRows(read: Read, layout: MemoryLayout, start: number, rows: number,
  opts: { before?: Int32Array | null; nameOf?: (a: number) => string | undefined } = {}): Array<{ address: number; cells: MemCell[] }> {
  const out = [];
  let a = start & ~(2 * ROW_WORDS - 1) & 0xffff;
  for (let r = 0; r < rows; r++) {
    const cells: MemCell[] = [];
    for (let i = 0; i < ROW_WORDS; i++) {
      const address = (a + 2 * i) & 0xffff;
      const value = peek(read, address);
      const cell: MemCell = { address, value, role: layout.role(address) };
      const name = opts.nameOf?.(address);
      if (name) cell.name = name;
      if (opts.before) {
        const b = opts.before[address >> 1];
        if (b !== (value ?? -1)) cell.was = b < 0 ? null : b;
      }
      cells.push(cell);
    }
    out.push({ address: a, cells });
    a = (a + 2 * ROW_WORDS) & 0xffff;
    if (a === 0) break;
  }
  return out;
}

/** A byte as a character for the ASCII column: printable ASCII, else a dot. */
export const charOf = (b: number): string => (b >= 0o40 && b < 0o177 ? String.fromCharCode(b) : '·');

/**
 * `count` instructions from `start`: every word read as an instruction, also data, to show
 * that the same bits can be read either way. `start` inside an instruction (an operand word)
 * moves back to its first word.
 */
export function explorerInstructions(read: Read, layout: MemoryLayout, start: number, count: number,
  nameOf?: (a: number) => string | undefined): Array<DisasmRow & { role: Role | null }> {
  let a = start & 0xfffe;
  for (let i = 0; i < 2 && layout.role(a) === 'operand' && a > 0; i++) a -= 2;
  const safe = (x: number) => peek(read, x) ?? 0;
  const rows = [];
  while (rows.length < count) {
    const d = disassemble(safe, a, { nameOf });
    rows.push({ address: a, words: d.words, text: d.text, label: nameOf?.(a), role: layout.role(a) });
    a = (a + 2 * d.words.length) & 0xffff;
    if (a === 0) break;
  }
  return rows;
}

// ---------------------------------------------------------------- the map of all memory

/** The map has a cell per word: 400 words (1000 bytes) a row, 200 rows for the 64 KB. */
export const MAP_COLS = 0o400;
export const MAP_ROWS = 0o200;
/** The address of the word in map cell (x, y), and back. */
export const mapAddress = (x: number, y: number): number => ((y * MAP_COLS + x) * 2) & 0xffff;
export const mapCell = (addr: number): { x: number; y: number } => ({ x: ((addr & 0xffff) >> 1) % MAP_COLS, y: (addr & 0xffff) >> 9 });

type Rgb = readonly [number, number, number];
/** The map's colours: by role where the assembler or the stack says, else by region. */
export const MAP_COLOURS: Readonly<Record<Role | Region | 'none' | 'changed', Rgb>> = {
  code: [0x39, 0xd0, 0xff], operand: [0x8f, 0x6f, 0xff], data: [0xff, 0xb3, 0x00], stack: [0x3c, 0xff, 0x3c],
  vectors: [0xff, 0x6f, 0xc8], ram: [0x7a, 0x8a, 0x9c], pixels: [0xb0, 0x7c, 0xff], rom: [0x6f, 0x8a, 0xa0], io: [0xff, 0x7f, 0x50],
  none: [0x0b, 0x0e, 0x12], changed: [0xff, 0x4d, 0x4d],
};

/**
 * The map as RGBA (MAP_COLS × MAP_ROWS pixels) from a {@link memorySnapshot}: a word's colour is
 * its role or its region, dim when it holds 0; black where nothing answers. Words run as
 * instructions (`heat`) go towards white, the more often the whiter; words that differ from
 * `before` are red.
 */
export function memoryMapRgba(words: Int32Array, layout: MemoryLayout, out: Uint8ClampedArray,
  opts: { heat?: Uint32Array; before?: Int32Array | null } = {}): void {
  const { heat, before } = opts;
  let most = 0;
  if (heat) for (let w = 0; w < 0x8000; w++) if (heat[w] > most) most = heat[w];
  const scale = most ? 1 / Math.log(1 + most) : 0;
  let r = REGIONS[0];
  for (let w = 0; w < 0x8000; w++) {
    const a = w << 1;
    if (a >= r.end) r = regionOf(a);
    const v = words[w];
    const role = layout.role(a);
    let c: Rgb = v < 0 ? MAP_COLOURS.none : MAP_COLOURS[role ?? r.region];
    let k = v === 0 ? (role ? 0.55 : 0.3) : 1;
    let white = 0;
    if (before && before[w] !== v) { c = MAP_COLOURS.changed; k = 1; }
    else if (heat && heat[w]) white = 0.3 + 0.7 * Math.log(1 + heat[w]) * scale;
    const o = w * 4;
    for (let i = 0; i < 3; i++) out[o + i] = c[i] * k * (1 - white) + 255 * white;
    out[o + 3] = 255;
  }
}

// ---------------------------------------------------------------- pixels and addresses

/** Where a pixel of the screen is in memory (display spec §3). */
export interface PixelSpot {
  x: number;
  y: number;
  /** The byte that holds it. */
  address: number;
  /** Mode 1: which half of the byte (the even x in the low half, bits 3–0). Mode 0: null. */
  half: 'low' | 'high' | null;
}

/** The first byte of a page: mode 0 has pages 0–3 of 10000 bytes, mode 1 pages 0–1 of 20000. */
export const pageBase = (mode: number, page: number) => 0o120000 + (mode ? (page & 1) * 0o20000 : (page & 3) * 0o10000);

/** The byte of pixel (x, y) on a page shown in a mode: `page + y*100 + x` (mode 1: `x/2`). */
export function pixelAddress(x: number, y: number, mode: number, page: number): PixelSpot {
  return { x, y, address: pageBase(mode, page) + y * 0o100 + (mode ? x >> 1 : x), half: mode ? (x & 1 ? 'high' : 'low') : null };
}

/**
 * The pixels a word of memory holds on the page shown: the first (x, y) and how many, side by
 * side on one row (2 in mode 0, 4 in mode 1). Null if the word is not on that page.
 */
export function pixelsOfWord(address: number, mode: number, page: number): { x: number; y: number; n: number } | null {
  const off = (address & 0xfffe) - pageBase(mode, page);
  if (off < 0 || off >= (mode ? 0o20000 : 0o10000)) return null;
  return { x: (off & 0o77) * (mode ? 2 : 1), y: off >> 6, n: mode ? 4 : 2 };
}
