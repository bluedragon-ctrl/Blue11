/**
 * README "Assembler compatibility": every claim there is checked here. Implicit .WORD and
 * the warnings for likely mistakes are in syntax-warnings.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/index.js';
import { assembleOk } from './helpers/asm';
import { err, word, words } from './helpers';

describe('assembler compatibility', () => {
  it('statement format, case, operand spacing', () => {
    expect(words('start: mov r0,r1 ; comment')).toEqual(words('START:  MOV  R0, R1'));
  });

  it('numbers: octal, a trailing dot for decimal, ^D ^O ^B, characters, complement', () => {
    expect(words('.WORD 20, 20., ^D20, ^O20, ^B101, \'A, "AB, ^C0')).toEqual([16, 20, 20, 16, 5, 65, 0x4241, 0xffff]);
    expect(err('.WORD 19')).toMatch(/not octal.*19\./);
  });

  it('strict left-to-right evaluation, < > grouping, & and !', () => {
    expect(words('.WORD 1+2*3, 1+<2*3>, 17&5!40, 10-1&6, 1!2, -1')).toEqual([9, 7, 0o45, 6, 3, 0xffff]);
  });

  it('every operator works on 16-bit words: the same word gives the same result', () => {
    // / is signed: 177777 is −1, so 177777/2 is 0, as <-1>/2.
    expect(words('.WORD <-1>/2, 177777/2, -6/4, 177772/4, 6/-4, 100000/-1, 77777/2')).toEqual([0, 0, 0xffff, 0xffff, 0xffff, 0o100000, 0o37777]);
    // + - * wrap to 16 bits at every step, not only at the end.
    expect(words('.WORD 177777+2, 0-1, 100000*2, 177777*177777, <100000+100000>/2, -100000')).toEqual([1, 0xffff, 0, 1, 0, 0o100000]);
    expect(words('X = 177777\n .WORD X+1, X*X, X/X, -X, ^C<X+1>')).toEqual([0, 1, 1, 1, 0xffff]);
    // A product or sum that overflows is not an error: the result is the 16-bit word.
    expect([...assembleOk(' MOV #100000*4+1, R0\n .WORD 170000+10000').bytes.slice(2, 4)]).toEqual([1, 0]);
    expect(assemble('X = 100000*2').warnings).toEqual([]);
  });

  it('a number too big for 16 bits is an error; bytes take −200…377', () => {
    expect(err('.WORD 200000')).toMatch(/200000 doesn't fit 16 bits/);
    expect(err('X = 200000')).toMatch(/200000 doesn't fit 16 bits/);
    expect(err('.WORD 65536.')).toMatch(/65536\. doesn't fit 16 bits/);
    expect(err('.WORD ^B10000000000000000')).toMatch(/doesn't fit 16 bits/);
    expect(words('.WORD 177777, 65535., -100000')).toEqual([0xffff, 0xffff, 0o100000]);
    expect([...assembleOk('.BYTE 377, -1, -200, 177600, 177777').bytes]).toEqual([0o377, 0o377, 0o200, 0o200, 0o377]);
    expect(err('.BYTE 400')).toMatch(/000400 doesn't fit in a byte/);
    expect(err('.BYTE -201')).toMatch(/177577 doesn't fit in a byte/);
  });

  it('branches and SOB compute their offsets in 16 bits, across address 0', () => {
    expect(words('. = 177774\n BR 2\n').at(-1)).toBe(0o000402);
    expect(assemble('. = 2\n BR 177776').ok).toBe(true);
    expect(err(' BR .+404')).toMatch(/too far/);
    expect(err(' TRAP -1')).toMatch(/0–377/);
  });

  it('assignment, register symbols, the location counter, global forms', () => {
    expect(assembleOk('N = 5\nN2 == 6\nX = %2\nA:: CLR X\n. = . + 10\nB: BR .+4').symbols.get('B')).toBe(0o1000 + 2 + 8);
  });

  it('local labels live between two ordinary labels', () => {
    expect(words('A: BR 1$\n1$: BR A\nB: BR 1$\n1$: HALT')).toEqual([0o000400, 0o000776, 0o000400, 0]);
    expect(err('L: HALT\n1$: BR L\nM: BR 1$')).toMatch(/undefined symbol 1\$/);
  });

  it('.END expr sets the start and ends the source, even with a bad start address', () => {
    const r = assembleOk('S: HALT\nT: HALT\n.END T\n THIS IS NOT ASSEMBLED');
    expect(r.start).toBe(r.symbols.get('T'));
    const bad = assemble('HALT\n.END FOO\nMOV R0, R1\n');
    expect(bad.errors.map((e) => e.message)).toEqual(['undefined symbol FOO']);
    expect(bad.bytes.length).toBe(2);
  });

  it('differences: names of at most 6 characters without "_" (long ones on request), values that do not fit', () => {
    expect(err('COUNTER1: HALT')).toMatch(/at most 6 characters/);
    expect(err('A_B = 1')).toMatch(/"_"/);
    expect(err(' MOV #ERR_BLOCKED, R0', { symbols: { ERR_BLOCKED: 1 } })).toMatch(/"_"/);
    expect(assemble('ERR_BLOCKED = 1\nCOUNTER_1: MOV #ERR_BLOCKED, R0', { names: 'long' }).ok).toBe(true);
    expect(err(' .BYTE 400')).toMatch(/doesn't fit in a byte/);
    expect(err(' TRAP 400')).toMatch(/0–377/);
  });

  it('predefined symbols: not as a label; a direct assignment may reassign one', () => {
    expect(err('XCSR: HALT', { symbols: { XCSR: 0o177564 } })).toMatch(/predefined symbol/);
    expect(word('XCSR = 1\n .WORD XCSR', { symbols: { XCSR: 0o177564 } })).toBe(1);
  });

  it('not supported: an error, never silently ignored', () => {
    for (const d of ['.MACRO FOO', '.MCALL X', '.IRP', '.REPT 3', '.NARG', '.IF EQ 0', '.IIF EQ 0, HALT', '.PSECT', '.CSECT', '.ASECT', '.GLOBL X', '.LIMIT', '.RADIX 10', '.RAD50 /ABC/', '.REM', '.PRINT', '.FLT2 1.0'])
      expect(assemble(' ' + d).ok, d).toBe(false);
    expect(err(' .WORD ^RABC')).toMatch(/unknown \^R/);
  });

  it('listing control directives are accepted and ignored', () => {
    expect(words(' .TITLE T\n .SBTTL S\n .IDENT /1/\n .ENABL LC\n .DSABL GBL\n .LIST\n .NLIST\n .PAGE\n HALT')).toEqual([0]);
    expect(words(' .ENABL LC, GBL, REG\n .DSABL LCM, CRF\n HALT')).toEqual([0]);
  });

  it('.ENABL LSB: local labels live until .DSABL LSB or the next .ENABL LSB, across ordinary labels', () => {
    // BR 1$ at 1000 jumps over B to 1$ at 1004: offset +1.
    expect(words(' .ENABL LSB\nA: BR 1$\nB: NOP\n1$: HALT\n .DSABL LSB')).toEqual([0o000401, 0o000240, 0]);
    // After .DSABL LSB the next ordinary label starts a new block again.
    expect(err(' .ENABL LSB\nA: NOP\n .DSABL LSB\nB: BR 1$\nC: NOP\n1$: HALT')).toMatch(/undefined symbol 1\$/);
    // A second .ENABL LSB starts a new block.
    expect(err(' .ENABL LSB\n1$: NOP\n .ENABL LSB\n BR 1$')).toMatch(/undefined symbol 1\$/);
  });

  it('.ENABL AMA: relative operands are assembled as absolute (@#)', () => {
    // MOV X, R0 becomes MOV @#X, R0 (013700, address 1004).
    expect(words(' .ENABL AMA\n MOV X, R0\nX: .WORD 5')).toEqual([0o013700, 0o001004, 5]);
    expect(words(' .ENABL AMA\n .DSABL AMA\n MOV X, R0\nX: .WORD 5')).toEqual([0o016700, 0o000000, 5]);
    expect(words(' .ENABL AMA\n MOV @X, R0\nX: .WORD X')).toEqual([0o017700, 0o000000, 0o001004]); // @X stays relative
  });

  it('.ENABL / .DSABL arguments that change meaning but are not supported are errors', () => {
    for (const a of ['ABS', 'MCL', 'CDR', 'FPT', 'XYZ', '']) expect(assemble(` .ENABL ${a}`).ok, a).toBe(false);
  });
});
