import { assemble } from 'blue11';
import { describe, expect, it } from 'vitest';
import { addressNamer, disassemblyAround, lineHeat, memoryRows, parseAddress, registerText, stackRows } from '../src/debug';
import { programSymbols } from '../src/rom';
import { Simulator } from '../src/sim';

describe('debugger views', () => {
  const s = new Simulator();
  s.load(`
START:  MOV  #5, R0
LOOP:   JSR  PC, @#DRAWCH
        SOB  R0, LOOP
        MOV  R1, @#DSPCS
        HALT`);
  const read = (a: number) => s.machine.read(a, false);

  it('names device registers, ROM routines and the program\'s labels', () => {
    const name = addressNamer(s.program);
    expect([name(0o176600), name(0o176700), name(0o177000), name(0o160000), name(0o160010), name(0o1004), name(0o177776)])
      .toEqual(['DSPCS', 'KBDCS', 'KBDKEY', 'DRAWCH', 'DRAW0', 'LOOP', 'PSW']);
  });

  it('disassembles around the PC with those names', () => {
    const rows = disassemblyAround(read, 0o1004, s.program!.lineAt.keys(), { before: 1, count: 4, nameOf: addressNamer(s.program) });
    expect(rows.map((r) => `${r.label ?? ''} ${r.text}`)).toEqual([
      'START MOV #000005, R0', 'LOOP JSR PC, @#DRAWCH', ' SOB R0, LOOP', ' MOV R1, @#DSPCS',
    ]);
  });

  it('reads addresses typed as octal, labels, device and ROM names, or registers', () => {
    const sym = s.program!.symbols;
    expect(['1004', 'loop', 'DSPCS', 'FONT', 'K.UP', 'sp', 'R7', '200000', 'NOPE'].map((t) => parseAddress(t, sym, s.cpu.r)))
      .toEqual([0o1004, 0o1004, 0o176600, 0o162000, 1, 0o1000, 0o1000, null, null]);
  });

  it('memory rows, the stack and the registers', () => {
    expect(memoryRows(read, 0o1003, 1, 4)).toEqual([{ address: 0o1000, words: [0o12700, 5, 0o4737, 0o160000] }]);
    expect(stackRows((a) => a, 0o774, 0o1000)).toEqual([{ address: 0o774, value: 0o774 }, { address: 0o776, value: 0o776 }]);
    expect(registerText(s.cpu)).toBe('R0  000000\nR1  000000\nR2  000000\nR3  000000\nR4  000000\nR5  000000\nSP  001000\nPC  001000\nPSW 000000 ---- pri 0');
  });

  it('heat per source line', () => {
    s.runFrame();
    const heat = lineHeat(s.heat, s.program!.lineAt);
    expect([heat.get(2), heat.get(3), heat.get(4), heat.get(6)]).toEqual([1, 5, 5, 1]);
  });

  it('every predefined name assembles in a program', () => {
    const names = Object.keys(programSymbols()).filter((n) => /^[A-Z]/.test(n));
    expect(assemble(names.map((n) => ` .WORD ${n}`).join('\n'), { symbols: programSymbols() }).errors).toEqual([]);
  });
});
