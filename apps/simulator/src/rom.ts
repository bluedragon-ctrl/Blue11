/**
 * The simulator's ROM (docs/BLUE11_DISPLAY.md §11): `rom.mac`, assembled when the page
 * loads, at 160000–167777. Programs get its entry points as predefined symbols.
 */

import { assemble, Rom, type AssembleResult } from 'blue11';
import { SIM_SYMBOLS } from '../../../packages/blue11/examples/examples';
import ROM_SOURCE from './rom.mac?raw';

export { ROM_SOURCE };
export const ROM_BASE = 0o160000;
export const ROM_SIZE = 0o10000;

let cached: AssembleResult | null = null;

/** The ROM assembled (once). Throws if `rom.mac` has an error: that is a bug in the simulator. */
export function romAssembly(): AssembleResult {
  if (cached) return cached;
  const asm = assemble(ROM_SOURCE, { symbols: SIM_SYMBOLS });
  if (!asm.ok) throw new Error(`rom.mac: ${asm.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}`);
  if (asm.origin < ROM_BASE || asm.origin + asm.bytes.length > ROM_BASE + ROM_SIZE) throw new Error('rom.mac: outside 160000–167777');
  return (cached = asm);
}

/** A ROM device with the contents loaded. */
export function makeRom(): Rom {
  const asm = romAssembly();
  const rom = new Rom({ base: ROM_BASE, size: ROM_SIZE });
  rom.load(asm.bytes, asm.origin - ROM_BASE);
  return rom;
}

/** The ROM's names a program may use: its entry points and the font. */
export const ROM_NAMES = ['DRAWCH', 'DRAWC1', 'FONT'] as const;

/** Everything a program can use without defining it: the device registers, key codes and the ROM's entry points. */
export function programSymbols(): Record<string, number> {
  const rom = romAssembly();
  const out: Record<string, number> = { ...SIM_SYMBOLS };
  for (const n of ROM_NAMES) out[n] = rom.symbols.get(n)!;
  return out;
}
