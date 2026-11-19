/**
 * One help entry per instruction, grouped. Every name in the instruction table
 * (`INSTRUCTIONS` from the `blue11` package) must be in exactly one entry: test/help.test.ts.
 *
 * Flags: four characters for N Z V C. `*` set from the result, `0` / `1` cleared / set,
 * `-` unchanged. Anything longer is shown as it is.
 */

import type { Entry } from './model';

export interface OpGroup {
  /** The help section it is shown in (several groups can share one). */
  section: string;
  title: string;
  intro: string;
  ops: OpHelp[];
}

export interface OpHelp {
  /** The mnemonics, the first one is the anchor: `['MOV', 'MOVB']`. */
  names: string[];
  syntax: string;
  flags: string;
  text: string;
}

const op = (names: string | string[], syntax: string, flags: string, text: string): OpHelp =>
  ({ names: Array.isArray(names) ? names : [names], syntax, flags, text });

/** `MOV` with its byte form `MOVB`. */
const wb = (name: string, syntax: string, flags: string, text: string): OpHelp =>
  op([name, name + 'B'], syntax.replace(name, `${name}(B)`), flags, text);

export const OP_GROUPS: OpGroup[] = [
  {
    section: 'ins-move',
    title: 'Moving data',
    intro: 'Most of a program is moving data: into registers to work on, back to memory to keep, out to a device to show. `MOV` is the most used instruction of all. It **copies**: the source keeps its value. '
      + 'A **(B)** in the name means the instruction has a byte form too: `MOV` copies a word, `MOVB` a byte.',
    ops: [
      wb('MOV', 'MOV src, dst', '**0-', 'Copy `src` to `dst`. `MOV #5, R0` puts 5 into R0. `MOVB` into a register **sign-extends** ([why](octal)): the byte 377 becomes 177777 (−1).'),
      wb('CLR', 'CLR dst', '0100', 'Set `dst` to 0.'),
      op('SWAB', 'SWAB dst', '**00', 'Swap the two bytes of a word. N and Z come from the new low byte.'),
      op('SXT', 'SXT dst', '-*0-', '`dst` = 0 if N is clear, 177777 if N is set: extends a sign into a whole word.'),
    ],
  },
  {
    section: 'ins-arith',
    title: 'Arithmetic',
    intro: 'Numbers are 16-bit words: 0 to 177777 (65535.) unsigned, or −100000 to 77777 (−32768. to 32767.) signed. A result that does not fit wraps around, and a flag tells you: **C** (carry) for unsigned numbers, **V** (overflow) for signed ones ([why](registers)). '
      + 'Comparing is subtracting: `CMP` works out the difference only to set the flags, and throws the result away. A zero difference means equal, a negative one means less.',
    ops: [
      op('ADD', 'ADD src, dst', '****', '`dst` = `dst` + `src`.'),
      op('SUB', 'SUB src, dst', '****', '`dst` = `dst` − `src`. C is set on a borrow (`src` was bigger, unsigned).'),
      wb('INC', 'INC dst', '***-', 'Add 1. C is not changed, so `INC` can count inside multi-word arithmetic.'),
      wb('DEC', 'DEC dst', '***-', 'Subtract 1. C is not changed.'),
      wb('NEG', 'NEG dst', '****', '`dst` = −`dst` (two\'s complement).'),
      wb('CMP', 'CMP src, dst', '****', 'Compute `src` − `dst`, set the flags, store nothing. Note the order: `CMP R0, #10` then `BLT` branches if R0 < 10. See [branches](ins-branch#op-BLT).'),
      wb('TST', 'TST dst', '**00', 'Set N and Z from `dst`: `TST R0` then `BEQ` branches if R0 is 0. `TSTB @#XCSR` puts the console\'s READY bit (bit 7) into N.'),
    ],
  },
  {
    section: 'ins-logic',
    title: 'Bits and logic',
    intro: 'A mask says which bits: `BIT #200, @#DSPCS` tests bit 7, `BIS #100, @#KBDCS` sets bit 6 (IE), `BIC #177600, R0` keeps bits 6–0.',
    ops: [
      wb('BIT', 'BIT src, dst', '**0-', 'AND `src` with `dst`, set the flags, store nothing. `BNE` after it: some of the bits are set.'),
      wb('BIC', 'BIC src, dst', '**0-', 'Clear in `dst` the bits that are set in `src`. `BIC #177400, R0` keeps only the low byte.'),
      wb('BIS', 'BIS src, dst', '**0-', 'Set in `dst` the bits that are set in `src` (OR).'),
      wb('COM', 'COM dst', '**01', 'Invert every bit.'),
      op('XOR', 'XOR R, dst', '**0-', '`dst` = `dst` XOR register `R`. The source must be a register; word only.'),
    ],
  },
  {
    section: 'ins-logic',
    title: 'Shifts and rotates',
    intro: 'Move every bit one place left or right. The bit that falls off the end goes into C. (V is set to N xor C.) '
      + 'In decimal, writing a 0 after a number multiplies it by ten: 25 becomes 250. In binary, shifting left one place multiplies by two, and shifting right divides by two. Shifts are the cheap way to multiply and divide by 2, 4, 10 (eight)….',
    ops: [
      wb('ASL', 'ASL dst', '****', 'Shift left, 0 comes in: multiply by 2.'),
      wb('ASR', 'ASR dst', '****', 'Shift right, the sign bit is kept: divide a signed number by 2, rounding down.'),
      wb('ROL', 'ROL dst', '****', 'Rotate left through C: C goes into bit 0, bit 15 (7 for bytes) into C.'),
      wb('ROR', 'ROR dst', '****', 'Rotate right through C: C goes into the top bit, bit 0 into C.'),
    ],
  },
  {
    section: 'ins-branch',
    title: 'Branches',
    intro: 'A branch is an *if*: it jumps to the label when its condition holds, and otherwise goes on with the next line. '
      + 'It tests the flags left by the **last** instruction that set them, so put the `CMP`, `TST` or `BIT` just before it. '
      + 'A branch reaches at most 127 words forward or 128 back; to go further, branch around a `JMP`. Branches change no flags.',
    ops: [
      op('BR', 'BR label', '----', 'Always branch.'),
      op('BEQ', 'BEQ label', '----', 'Branch if Z: equal, or zero.'),
      op('BNE', 'BNE label', '----', 'Branch if not Z: not equal, not zero.'),
      op('BMI', 'BMI label', '----', 'Branch if N: negative. Also: the top bit was set (bit 15, or bit 7 after a byte instruction).'),
      op('BPL', 'BPL label', '----', 'Branch if not N: zero or positive.'),
      op('BLT', 'BLT label', '----', 'Signed: branch if less than (after `CMP a, b`: a < b).'),
      op('BLE', 'BLE label', '----', 'Signed: branch if less or equal.'),
      op('BGT', 'BGT label', '----', 'Signed: branch if greater than.'),
      op('BGE', 'BGE label', '----', 'Signed: branch if greater or equal.'),
      op(['BCS', 'BLO'], 'BCS / BLO label', '----', 'Branch if C. Two names, one instruction: write `BCS` to test the C flag (a subroutine that sets C to say it **failed**), `BLO` after `CMP a, b` (a < b **unsigned**). The disassembly always shows `BCS`.'),
      op(['BCC', 'BHIS'], 'BCC / BHIS label', '----', 'Branch if not C. Two names, one instruction: `BCC` to test the C flag (the call worked), `BHIS` after `CMP a, b` (a ≥ b unsigned). The disassembly always shows `BCC`.'),
      op('BHI', 'BHI label', '----', 'Unsigned: branch if higher (a > b).'),
      op('BLOS', 'BLOS label', '----', 'Unsigned: branch if lower or the same (a ≤ b).'),
      op('BVS', 'BVS label', '----', 'Branch if V: signed overflow.'),
      op('BVC', 'BVC label', '----', 'Branch if not V.'),
      op('SOB', 'SOB R, label', '----', 'Subtract one and branch: R = R − 1, then branch back to `label` if R is not 0. The label must be before the `SOB`, at most 63 words back. `MOV #5, R2` … `SOB R2, 1$` loops five times.'),
    ],
  },
  {
    section: 'ins-jump',
    title: 'Jumps and subroutines',
    intro: '`JMP` goes somewhere else for good. `JSR` calls a subroutine, which comes back with `RTS`. '
      + 'A subroutine can be called from many places, so it cannot know where to go back to: `JSR` remembers the place for it, on the stack. See [the stack](stack) for how.',
    ops: [
      op('JMP', 'JMP dst', '----', 'Jump to the address of `dst`: `JMP LOOP`, or through a table: `JMP @TABLE(R1)`. A register as `dst` (`JMP R0`) is illegal and traps.'),
      op('JSR', 'JSR R, dst', '----', 'Call a subroutine: push `R`, put the return address in `R`, jump to `dst`. Nearly always `JSR PC, NAME`, which just pushes the return address.'),
      op('RTS', 'RTS R', '----', 'Return from a subroutine: PC = `R`, then pop `R`. `RTS PC` ends a `JSR PC` call.'),
    ],
  },
  {
    section: 'ins-trap',
    title: 'Traps and interrupts',
    intro: 'A trap pushes the PSW and the PC and loads both from a **vector**, a pair of words in low memory. See [traps](traps) and [interrupts](interrupts).',
    ops: [
      op('EMT', 'EMT n', 'from the vector', 'Trap through the vector at 30. `n` (0–377) is the low byte of the `EMT` instruction: the handler finds it at the return address − 2. Nothing is installed at 30: write a handler first ([traps](traps)).'),
      op('TRAP', 'TRAP n', 'from the vector', 'Trap through the vector at 34, for your own system calls. Nothing is installed there: write a handler first.'),
      op('BPT', 'BPT', 'from the vector', 'A breakpoint in the code: with nothing at vector 14 the run stops there, and Continue goes on after it. With a handler at 14, it traps there instead.'),
      op('RTI', 'RTI', 'from the stack', 'Return from an interrupt or trap: pop the PC, then the PSW.'),
      op('WAIT', 'WAIT', '----', 'Sleep until an interrupt comes, then go on after the `WAIT` once its handler returns. The sleeping cycles pass at once, up to the next device event. With no interrupt enabled nothing can wake it: the run stops.'),
    ],
  },
  {
    section: 'ins-control',
    title: 'CPU control and flags',
    intro: 'Stopping, doing nothing, and setting C by hand.',
    ops: [
      op('HALT', 'HALT', '----', 'Stop the program. The status line shows where. A program that loops forever (a game) needs none: Pause stops it.'),
      op('NOP', 'NOP', '----', 'Do nothing (one cycle).'),
      op('CLC', 'CLC', '---0', 'Clear C: a subroutine that reports success (as `DIV16` in the examples does).'),
      op('SEC', 'SEC', '---1', 'Set C: a subroutine that reports failure (the caller tests it with `BCS`).'),
    ],
  },
  {
    section: 'ins-eis',
    title: 'Multiply and divide (EIS)',
    intro: 'Multiplying and dividing take a lot of circuits, which were expensive in the 1970s, so on the PDP-11 they came as an option you paid extra for. '
      + 'The **EIS** instructions (the Extended Instruction Set) work only with the **EIS** setting on; without it they trap to 10 ([illegal instruction](traps)), as on a machine without the option. '
      + 'Without EIS, multiply by shifting and adding (the `DIV16` routine in the examples divides that way). `R` must be a register; an even one (R0, R2, R4) holds a 32-bit value in `R` (high word) and `R+1` (low).',
    ops: [
      op('MUL', 'MUL src, R', '**0*', '`R` × `src`, signed. With an even `R` the 32-bit product is in `R`:`R+1`, with an odd one only its low word. C: the product needs more than 16 bits.'),
      op('DIV', 'DIV src, R', '****', 'Divide the 32-bit `R`:`R+1` (`R` even) by `src`: the quotient goes into `R`, the remainder into `R+1`. V: division by 0 or overflow.'),
      op('ASH', 'ASH src, R', '****', 'Shift `R` by `src` places (−32 to 31): left if positive, right (arithmetic) if negative.'),
      op('ASHC', 'ASHC src, R', '****', 'As `ASH`, on the 32-bit `R`:`R+1`.'),
    ],
  },
  {
    section: 'ins-other',
    title: 'Less common',
    intro: 'Part of the instruction set, needed less often. They work as described.',
    ops: [
      wb('ADC', 'ADC dst', '****', 'Add the C flag: the high word of a 32-bit add.'),
      wb('SBC', 'SBC dst', '****', 'Subtract the C flag: the high word of a 32-bit subtract.'),
      op('IOT', 'IOT', 'from the vector', 'Another trap instruction, vector 20. With nothing at 20 the run stops.'),
      op('RTT', 'RTT', 'from the stack', 'As `RTI` (it differs only for single-stepping with the trace bit).'),
      op('RESET', 'RESET', '----', 'Reset every device: interrupt enables (`IE`) are cleared and pending requests withdrawn. Memory, the screen, the palette and keys held down are kept. Run already starts from power-up.'),
      op(['CLV', 'CLZ', 'CLN', 'CCC'], 'CLV CLZ CLN CCC', 'as named', 'Clear V, Z or N; `CCC` clears all four flags.'),
      op(['SEV', 'SEZ', 'SEN', 'SCC'], 'SEV SEZ SEN SCC', 'as named', 'Set V, Z or N; `SCC` sets all four flags.'),
    ],
  },
];

/** `N* Z* V0 C-` for '**0-'. */
export function flagText(flags: string): string {
  if (flags.length !== 4) return flags;
  return [...flags].map((f, i) => 'NZVC'[i] + (f === '-' ? '–' : f)).join(' ');
}

export function opEntry(o: OpHelp): Entry {
  return { anchor: `op-${o.names[0]}`, names: o.names, term: `\`${o.syntax}\``, detail: flagText(o.flags), text: o.text };
}
