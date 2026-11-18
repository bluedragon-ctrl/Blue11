/**
 * The debugger's views, without the DOM: the registers, disassembly around the PC with
 * names (device registers, labels, the ROM's routines), memory rows, the heat per source
 * line, and addresses typed by the student. Numbers are octal.
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

/** `rows` rows of `perRow` words from `start` (even, rounded down to a row). */
export function memoryRows(read: Read, start: number, rows = 8, perRow = 4): Array<{ address: number; words: number[] }> {
  const out = [];
  let a = start & ~(2 * perRow - 1) & 0xffff;
  for (let r = 0; r < rows; r++) {
    const words = [];
    for (let i = 0; i < perRow; i++) words.push(read((a + 2 * i) & 0xffff) & 0xffff);
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
