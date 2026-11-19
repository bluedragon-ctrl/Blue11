import { assemble } from 'blue11';
import { describe, expect, it } from 'vitest';
import { octal } from 'blue11';
import {
  addressNamer, charOf, disassemblyAround, explorerInstructions, explorerRows, lineHeat, MAP_COLOURS, MAP_COLS, MAP_ROWS, mapAddress,
  mapCell, memoryLayout, memoryMapRgba, memoryRows, memorySnapshot, parseAddress, peek,
  regionOf, registerText, stackRows, vectorName,
} from '../src/debug';
import { romAssembly } from '../src/rom';
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

describe('the memory explorer', () => {
  const s = new Simulator();
  s.load(`
START:  MOV  #STK, SP     ; 1000
        MOV  #MSG, R1     ; 1004
        JSR  PC, SUB      ; 1010
        HALT              ; 1014
SUB:    MOV  R1, -(SP)    ; 1016
        INC  COUNT        ; 1020
        BPT               ; 1024
        RTS  PC
COUNT:  .WORD 0           ; 1030
MSG:    .ASCIZ /HI/       ; 1032
        .EVEN
        .BLKW 20
STK:                      ; 1076`);
  const read = (a: number) => s.machine.read(a, false);
  const prog = s.program!;

  it('never reads RBUF or KBDBUF, which would take the character', () => {
    const t = new Simulator();
    t.load('HALT');
    const r = (a: number) => t.machine.read(a, false);
    t.machine.type('A');
    t.keyboard.press('KeyA');
    expect([peek(r, 0o177562), peek(r, 0o176702), peek(r, 0o170000), peek(r, 0o1001)]).toEqual([null, null, null, 0]);
    expect(memoryRows(r, 0o177560, 1, 4)[0].words[1]).toBeNull();
    memorySnapshot(r);
    explorerRows(r, memoryLayout(null, romAssembly(), 0o1000, 0o1000), 0o176700, 1);
    expect([r(0o177560) & 0o200, r(0o176700) & 0o200]).toEqual([0o200, 0o200]); // both still waiting
  });

  it('knows the regions and the vectors', () => {
    expect([0, 0o776, 0o117776, 0o120000, 0o160000, 0o177776].map((a) => regionOf(a).region))
      .toEqual(['vectors', 'ram', 'ram', 'pixels', 'rom', 'io']);
    expect([vectorName(0o34), vectorName(0o36), vectorName(0o60), vectorName(0o40)])
      .toEqual(['TRAP: new PC', 'TRAP: new PSW', 'console input: new PC', undefined]);
  });

  it('marks each word: an instruction, its operands, data, the stack; with its line', () => {
    const l = memoryLayout(prog, romAssembly(), 0o774, 0o1000);
    expect([0o1000, 0o1002, 0o1004, 0o1014, 0o1030, 0o1032, 0o1034, 0o1036, 0o774, 0o776, 0o772].map((a) => l.role(a)))
      .toEqual(['code', 'operand', 'code', 'code', 'data', 'data', 'data', 'data', 'stack', 'stack', null]);
    expect([l.source(0o1002), l.source(0o1030), l.source(0o772), l.source(0o160000)?.rom])
      .toEqual([{ line: 2, rom: false }, { line: 10, rom: false }, undefined, true]);
    // SP above the base: no stack
    expect(memoryLayout(prog, romAssembly(), 0o1002, 0o1000).role(0o776)).toBeNull();
  });

  it('rows of words, with what the last command changed', () => {
    expect(prog.symbols.get('STK')).toBe(0o1076);
    expect(s.stackTop).toBe(0o1000); // SP at the boot
    const before = memorySnapshot(read);
    s.runFrame(); // to the BPT in SUB
    expect(s.stackTop).toBe(0o1076); // MOV #STK, SP moved it; the pushes did not
    const l = memoryLayout(prog, romAssembly(), s.cpu.r[6], s.stackTop);
    const [row] = explorerRows(read, l, 0o1030, 1, { before, nameOf: addressNamer(prog) });
    expect(row.address).toBe(0o1020);
    const at = (a: number) => row.cells.find((x) => x.address === a)!;
    expect(at(0o1030)).toEqual({ address: 0o1030, value: 1, was: 0, role: 'data', name: 'COUNT' });
    expect(at(0o1020)).toEqual({ address: 0o1020, value: 0o5267, role: 'code' }); // INC, unchanged
    expect(charOf(at(0o1032).value! & 0xff) + charOf(at(0o1032).value! >> 8) + charOf(0)).toBe('HI·');
    // the two pushes: R1 (MSG) on top, then the return address
    const [top] = explorerRows(read, l, 0o1060, 1, { before });
    expect(top.cells.slice(4).map((x) => [x.role, x.value, x.was])).toEqual([['data', 0, undefined], ['stack', 0o1032, 0], ['stack', 0o1014, 0], [null, 0, undefined]]);
    expect(s.cpu.r[6]).toBe(0o1072);
  });

  it('reads any words as instructions, data too, and starts on an instruction', () => {
    const l = memoryLayout(prog, romAssembly(), s.cpu.r[6], 0o1076);
    const rows = explorerInstructions(read, l, 0o1002, 3, addressNamer(prog));
    expect(rows.map((r) => [octal(r.address), r.label, r.text, r.role])).toEqual([
      ['001000', 'START', 'MOV #001076, SP', 'code'],
      ['001004', undefined, 'MOV #001032, R1', 'code'],
      ['001010', undefined, 'JSR PC, SUB', 'code'],
    ]);
    expect(explorerInstructions(read, l, 0o1030, 1)[0]).toMatchObject({ words: [1], text: 'WAIT', role: 'data' });
  });

  it('maps all 64 KB, a dot per word, 1000 bytes a row', () => {
    expect([MAP_COLS * MAP_ROWS * 2, mapAddress(0, 1), mapAddress(MAP_COLS - 1, MAP_ROWS - 1)]).toEqual([0o200000, 0o1000, 0o177776]);
    expect([mapCell(0o1030), mapCell(0o120000), mapCell(0o177777)]).toEqual([{ x: 0o14, y: 1 }, { x: 0, y: 0o120 }, { x: 0o377, y: 0o177 }]);
    for (const a of [0, 0o1030, 0o157776, 0o177776]) { const c = mapCell(a); expect(mapAddress(c.x, c.y)).toBe(a); }

    const l = memoryLayout(prog, romAssembly(), s.cpu.r[6], s.stackTop);
    const words = memorySnapshot(read);
    const before = Int32Array.from(words);
    before[0o1030 >> 1] = 0; // COUNT was 0
    const px = new Uint8ClampedArray(MAP_COLS * MAP_ROWS * 4);
    memoryMapRgba(words, l, px, { heat: s.heat, before });
    const at = (a: number) => Array.from(px.subarray(2 * a, 2 * a + 3)); // 4 bytes a dot, a dot per 2 bytes
    expect(at(0o1030)).toEqual([...MAP_COLOURS.changed]); // COUNT, changed
    expect(at(0o1032)).toEqual([...MAP_COLOURS.data]); // MSG, not 0
    expect(at(0o1036)).toEqual(MAP_COLOURS.data.map((c) => Math.round(c * 0.55))); // a 0 in .BLKW: dim
    expect(at(0o1072)).toEqual([...MAP_COLOURS.stack]);
    expect(at(0o2000)).toEqual(MAP_COLOURS.ram.map((c) => Math.round(c * 0.3))); // free RAM, 0
    expect(at(0o170000)).toEqual([...MAP_COLOURS.none]); // nothing answers
    expect(at(0o177564)).toEqual([...MAP_COLOURS.io]); // XCSR: ready
    // run once: towards white; never run (RTS PC, after the BPT): the plain colour
    expect(s.heat[0o1000 >> 1]).toBe(1);
    expect(at(0o1000).every((c, i) => c > MAP_COLOURS.code[i] || c === 255)).toBe(true);
    expect(at(0o1026)).toEqual([...MAP_COLOURS.code]);
    expect(at(0o1014)).toEqual(MAP_COLOURS.code.map((c) => Math.round(c * 0.55))); // HALT is 000000
    expect(at(0o1002)).toEqual([...MAP_COLOURS.operand]);
    expect(px[3]).toBe(255);
  });
});
