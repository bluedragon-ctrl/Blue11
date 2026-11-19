import { assemble } from 'blue11';
import { describe, expect, it } from 'vitest';
import { binaryOctal, charName, numberAt, numberParts, pswParts, registerTitles } from '../src/debug';
import { Simulator } from '../src/sim';

describe('numbers explained', () => {
  it('shows a word in octal, decimal, hex, binary and bytes', () => {
    expect(numberParts(0o177777)).toEqual(['octal 177777', 'decimal 65535., signed -1.', 'hex FFFF',
      'binary 1 111 111 111 111 111', 'bytes: high 377, low 377']);
    expect(numberParts(0o101)).toEqual(['octal 000101', 'decimal 65.', 'hex 0041', 'binary 0 000 000 001 000 001', "character 'A'"]);
    expect(numberParts(0o15).at(-1)).toBe('character CR (carriage return)');
    expect(numberParts(0o200).at(-1)).toBe('binary 0 000 000 010 000 000');
    expect(numberParts(5)).toHaveLength(4); // no 'control ^E' for every small number, nor NUL for 0
    expect(numberParts(0)).toHaveLength(4);
  });

  it('groups binary by octal digit and names characters', () => {
    expect(binaryOctal(0o123456)).toBe('1 010 011 100 101 110');
    expect([charName(0o40), charName(0o176), charName(3), charName(0o200)]).toEqual(['space', "'~'", 'control ^C', null]);
  });

  it('explains the PSW bit by bit', () => {
    expect(pswParts(0o344)).toEqual(['PSW 000344', 'binary 0 000 000 011 100 100', 'priority 7 (bits 7–5)', 'T 0 (trace, bit 4)',
      'N 0 (negative) · Z 1 (zero) · V 0 (overflow) · C 0 (carry)']);
    expect(pswParts(0o170000)[2]).toBe('mode user (bits 15–14), previous user (13–12)');
  });

  it('gives each register line its title', () => {
    const s = new Simulator();
    s.load('MOV #-1, R0\nHALT');
    s.step();
    const t = registerTitles(s.cpu);
    expect(t).toHaveLength(9);
    expect(t[0]).toBe('R0 = 177777 · decimal 65535., signed -1. · hex FFFF · binary 1 111 111 111 111 111 · bytes: high 377, low 377');
    expect(t[8]).toMatch(/^PSW 000010 · .* N 1/);
  });

  describe('a number in the editor', () => {
    const at = (line: string, word: string, k = 0) => numberAt(line, line.indexOf(word) + k);
    it('reads what the assembler reads, where the mouse is', () => {
      expect(at('  MOV #177777, R0', '177777', 2)).toEqual({ from: 7, to: 13, text: '177777', value: 0o177777 });
      expect(at('  MOV #10., R0', '10.', 2)?.value).toBe(10);
      expect(at("  CMPB R0, #'A", "'A", 1)?.value).toBe(0o101);
      expect(at('  MOV #"HI, R0', '"HI')?.value).toBe(0x4948);
      expect(at('  MOV #-1, R0', '-1', 1)).toMatchObject({ text: '-1', value: 0o177777 });
      expect(at('  MOV #5-3, R0', '3')).toMatchObject({ text: '3', value: 3 });
      expect(at('  MOV #^B101, R0', '^B', 3)?.value).toBe(5);
      expect(at('  MOV #^D100, R0', '^D')?.value).toBe(100);
      expect(at('  BIC #^C17, R0', '^C')?.value).toBe(0o177760);
    });
    it('is not a name, a comment or .ASCII text', () => {
      expect(at('  MOV R0, R1', '0')).toBeNull();
      expect(at('1$: BR 1$', '1')).toBeNull();
      expect(at('  JMP L10', '10')).toBeNull();
      expect(at('  NOP ; 177', '177')).toBeNull();
      expect(at('  .ASCII /123/', '123')).toBeNull();
      expect(at('  MOV R0, R1', 'MOV')).toBeNull();
    });
    it('says what is wrong, as the assembler does', () => {
      expect(at('  MOV #19, R0', '19')?.error).toBe('19 is not octal: write 19. for decimal');
      expect(at('  MOV #200000, R0', '200000')?.error).toMatch(/doesn't fit 16 bits/);
      expect(at('  MOV #^B102, R0', '^B')?.error).toBe('bad digit for ^B: 102');
    });
    it('agrees with the assembler', () => {
      for (const lit of ['0', '7', '177777', '65535.', '10.', "'A", "'0", '"HI', '-1', '-177777', '^B1111', '^O17', '^D255', '^C0', '-^C5']) {
        const n = numberAt(`  .WORD ${lit}`, 8);
        const asm = assemble(`.WORD ${lit}`);
        expect(asm.errors, lit).toEqual([]);
        expect(n?.value, lit).toBe(asm.lines.find((l) => l.bytes.length)!.bytes[0] | (asm.lines.find((l) => l.bytes.length)!.bytes[1] << 8));
      }
    });
  });
});
