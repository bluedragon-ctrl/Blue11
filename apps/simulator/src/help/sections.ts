/**
 * The simulator's help text, for students. Numbers are octal unless written with a dot
 * (`200.`), as on the machine. Facts that live in the code (addresses, the palette, the
 * frame's cycles) come from the library's constants and the ROM, so the help follows them.
 * Every `code` block assembles, and the `run` ones run in the simulator to a HALT of their
 * own: test/help.test.ts.
 */

import { DEFAULT_PALETTE, DEV, DSP, KBD, octal, PSW_ADDRESS, VEC } from 'blue11';
import { ROM_BASE, ROM_SIZE, romAssembly } from '../rom';
import { OP_GROUPS, opEntry } from './instructions';
import { code, dec, entries, h, list, note, p, table, type Entry, type Section } from './model';
import { symbolEntries } from './symbols';

const o = (n: number, digits = 6) => octal(n, digits);
const START = 'Start';
const LANGUAGE = 'Language';
const MACHINE = 'The machine';
const DEVICES = 'Devices';
const REFERENCE = 'Reference';

/** Cycles per frame, and so per line-clock tick. */
const FRAME = 20000;
const RAM_END = DSP.SCREEN;

const e = (anchor: string, names: string[], term: string, text: string, detail?: string): Entry =>
  ({ anchor, names, term, text, ...(detail ? { detail } : {}) });

const COLOURS = ['black', 'blue', 'green', 'cyan', 'red', 'magenta', 'brown', 'light grey',
  'dark grey', 'light blue', 'light green', 'light cyan', 'light red', 'light magenta', 'yellow', 'white'];

const start: Section = {
  id: 'start', title: 'Getting started', group: START,
  blocks: [
    p('Blue-11 is a 16-bit computer in the style of the PDP-11, a classic minicomputer, with a **screen**, a **keyboard** and a **console**. '
      + 'You program it in **assembly**: write the program in the editor, press **Run** (Ctrl+Enter), and watch the screen and the console.'),
    code(`
      ; Draw a yellow pixel in the middle of the screen.
              MOVB #16, @#SCREEN+4040   ; 16 = yellow; row 40, column 40
              HALT                      ; stop
    `, { run: true }),
    h('Reading the code'),
    list(
      'One instruction per line: an optional `label:`, the instruction, its operands, an optional `; comment`.',
      'Operands go **source first**: `MOV #3, R0` moves 3 into R0.',
      '`#3` is the value 3; `R0` is a [register](registers); `@#SCREEN` is the byte at the address `SCREEN`.',
      '**Numbers are octal**: `10` is eight, `10.` (with a dot) is ten. See [numbers](assembler#syn-numbers).',
      'Device names such as `SCREEN`, `DSPCS` and `KBDKEY` are [predefined](symbols): every program can use them.',
    ),
    h('Where to go next'),
    list(
      'The **Programs** menu has examples for the console, the display and the keyboard. Open one, run it, change it.',
      'The [display](display): pixels are bytes in memory. The [keyboard](keyboard): which keys are down, and every press and release.',
      'The [ROM](rom) draws text on the screen; its source is in the **ROM** tab.',
    ),
    note('Press **F1** in the editor to look up the word under the cursor: an instruction, a register, a device name. Resting the mouse on one shows a short help.'),
  ],
};

const controls: Section = {
  id: 'controls', title: 'Running and debugging', group: START,
  blocks: [
    table(['Button', 'What it does'], [
      ['**Run** (Ctrl+Enter)', 'Assemble the editor\'s program and start it from power-up: memory cleared, the program loaded, every device reset.'],
      ['**Continue**', 'Go on after a pause, a breakpoint, a step or a `HALT`. Only while the program in the editor is the one loaded.'],
      ['**Pause**', 'Stop at the end of the frame.'],
      ['**Step** (F10)', 'Run one instruction. If the code changed, this loads it first.'],
      ['**Step frame**', 'Run to the end of this frame.'],
      ['**Restart**', 'Load the program again, stopped at its first instruction.'],
    ]),
    h('Time: frames'),
    p(`The machine runs in **frames** of ${dec(FRAME)} cycles; the [display](display) shows one picture a frame. `
      + 'A cycle is one trip to memory, so a short instruction costs 1–3 [cycles](cycles). '
      + '**Speed** says how many frames run per second of your time (60 is real time). A program behaves the same at every speed: only you see it faster or slower.'),
    h('Settings'),
    list(
      '**Real beam (tearing)**: the screen is read row by row while the program runs, as on a real monitor ([the beam](display#dsp-beam)). Off, each frame shows memory as it was at the vertical blank.',
      '**EIS**: the multiply and divide [instructions](instructions#op-MUL). Off, they are illegal instructions.',
      '**Retro**: the period look for the screen, the listings and the console. It changes nothing in the machine.',
      'Changing **Real beam** or **EIS** starts the program again. Both are saved with the program, in share links and in replays.',
    ),
    h('Breakpoints'),
    list(
      'Click left of a line number, or press **F9** on the line: a red dot. Run and Continue stop **before** that instruction runs.',
      'Click a row in **Disassembly** to set one by address, also inside the [ROM](rom).',
      'The current instruction is highlighted in the editor and in the disassembly.',
      'A `BPT` instruction in the code stops the run too; Continue goes on after it.',
    ),
    h('Panels'),
    list(
      '**Screen**, **Listing** (the assembler\'s listing: address, words, source) and **ROM** tabs.',
      '**Console**: what the program printed. Click it, or the screen, and type: the keys go to the program.',
      '**CPU**: the [registers](registers), the [PSW](registers#sym-PSW) with its flags (`-` means clear) and the priority.',
      '**Disassembly**: the instructions in memory around the PC, with labels.',
      '**Memory**: words from an address. Type an octal address, a label, a device name (`DSPCS`) or a register (`SP`).',
      '**Stack**: the words from SP up to where the [stack](stack) started.',
      '**Input log**: every key and console character with its cycle. **Replay** runs the program again with the same input at the same cycles; **Save** and **Open** keep a replay in a file.',
      'The orange bar beside the line numbers is a **heat map**: the brighter, the more often that line ran.',
    ),
    h('Keys'),
    p('While the screen or the console has focus (the label says *keyboard → program*), every key goes to the program: to the [keyboard](keyboard) device, and a key that types a character also to the [console](console). '
      + 'Ctrl and Cmd shortcuts stay with the browser. Clicking elsewhere releases every key.'),
    h('Programs'),
    list(
      'The menu holds the examples and **My programs**, saved in this browser with **Save**. The editor\'s text is kept between visits.',
      '**Share** copies a link with the program and its settings (not the input).',
    ),
    h('Status messages'),
    table(['Message', 'Meaning'], [
      ['HALT at …', 'A `HALT` ran. Continue goes on after it.'],
      ['Odd address, Bus error, Illegal instruction …', 'A [trap](traps) with no handler: the run stopped at the instruction that caused it.'],
      ['BPT at …', 'A `BPT` in the code: Continue goes on after it.'],
      ['WAIT at …, and no device has interrupts on', 'A `WAIT` that nothing can wake: it would sleep forever. See [interrupts](interrupts).'],
      ['Interrupt through vector … with no handler', 'A device\'s IE is set but its vector is still 0: set the vector first.'],
      ['Double fault', 'A trap could not push onto the stack (SP pointed at nothing). Run again.'],
      ['N errors, the first on line …', 'The assembler found mistakes; they are marked on their lines.'],
    ]),
  ],
};

const assembler: Section = {
  id: 'assembler', title: 'Writing assembly', group: LANGUAGE,
  blocks: [
    code(`
      LOOP:   MOV  #5, R0        ; label, instruction, operands, comment
              BR   LOOP
    `),
    entries(
      e('syn-names', [], 'Names', 'Labels and symbols have **1 to 6** letters, digits, `.` or `$`, and do not start with a digit. '
        + 'Case does not matter. A seventh character is an error. The [predefined names](symbols), register names and instruction names cannot be used as labels.'),
      e('syn-local', [], 'Local labels `1$`', '`1$` to `99$` are labels that only live between two ordinary labels, so every routine can have its own `1$:` loop.'),
      e('syn-numbers', [], 'Numbers', '`17` is **octal** (fifteen). `15.` is decimal. `^D15`, `^O17` and `^B1111` name the base. `\'A` is the code of the character A. Negative numbers: `-1` is 177777.'),
      e('syn-expr', [], 'Expressions', 'Operators `+ - * /`, `&` (and), `!` (or), evaluated strictly **left to right**: `2+3*4` is 24 (octal), `2+<3*4>` is 16. Use `< >` to group. Values are 16-bit words: `177777+2` is 1, and `/` is signed (`177777/2` is 0, as `<-1>/2`). '
        + 'The assembler warns about `*` or `/` after `+` or `-` without `< >`. `@#SCREEN+4040` is the pixel at row 40, column 40.'),
      e('syn-equ', ['='], '`NAME = value`', 'Define a constant: `WIDTH = 100`, then `MOV #WIDTH, R0`. `PTR = %3` makes `PTR` another name for R3.'),
      e('syn-dot', ['.'], '`.`', 'The location counter: the address being assembled. `. = 2000` moves it; `. = . + 20` skips 20 bytes.'),
    ),
    h('Directives'),
    entries(
      e('dir-.WORD', ['.WORD'], '`.WORD a, b, …`', 'Words of data: `.WORD 1, 2, LOOP`. A line with just a value is a `.WORD` too.'),
      e('dir-.BYTE', ['.BYTE'], '`.BYTE a, b, …`', 'Bytes of data: `.BYTE 1, 377`.'),
      e('dir-.ASCII', ['.ASCII'], '`.ASCII /text/`', 'The characters of the text, one byte each. Any character can be the delimiter.'),
      e('dir-.ASCIZ', ['.ASCIZ'], '`.ASCIZ /text/`', 'As `.ASCII`, with a 0 byte at the end, so a loop knows where the text stops.'),
      e('dir-.BLKW', ['.BLKW'], '`.BLKW n`', 'Reserve `n` words (zero): `BUF: .BLKW 20.`'),
      e('dir-.BLKB', ['.BLKB'], '`.BLKB n`', 'Reserve `n` bytes (zero).'),
      e('dir-.EVEN', ['.EVEN'], '`.EVEN`', 'Move to an even address. Put it after bytes or text and before words or code: words must be at even addresses.'),
      e('dir-.ODD', ['.ODD'], '`.ODD`', 'Move to an odd address.'),
      e('dir-.END', ['.END'], '`.END label`', 'The end of the program; the label, if any, is where it starts. Without it the program starts at its first instruction.'),
    ),
    p('The program is assembled from address 1000 unless you move `.` first. It is one file: there are no macros or include files. '
      + '`.TITLE`, `.SBTTL`, `.IDENT`, `.LIST`, `.NLIST` and `.PAGE` are accepted and ignored, as on the original assembler. '
      + '`.ENABL LSB` makes local labels such as `1$` reach across ordinary labels until `.DSABL LSB`; `.ENABL AMA` assembles `LABEL` as `@#LABEL`.'),
  ],
};

const registers: Section = {
  id: 'registers', title: 'Registers and flags', group: LANGUAGE,
  blocks: [
    p('The CPU has eight 16-bit registers. Working in registers is free; every trip to memory costs a [cycle](cycles).'),
    entries(
      e('reg-R0', ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'], '`R0` – `R5`', 'General purpose: counters, pointers, values. Subroutines usually take arguments and give results in them, as the [ROM](rom)\'s `DRAWCH` does.'),
      e('reg-SP', ['SP', 'R6'], '`SP` (R6)', 'The [stack](stack) pointer. Run sets it to the program\'s first address (1000); the stack grows down from there.'),
      e('reg-PC', ['PC', 'R7'], '`PC` (R7)', 'The program counter: the address of the next instruction. `#`, `@#` and labels are [addressing modes](addressing) on the PC.'),
      e('reg-%', ['%0', '%1', '%2', '%3', '%4', '%5', '%6', '%7'], '`%n`', 'Register n by number: `PTR = %3` makes `PTR` another name for R3.'),
    ),
    entries(...symbolEntries('PSW')),
    h('The flags'),
    p('Most instructions set four flags in the PSW from their result. Branches test them.'),
    table(['Flag', 'Set when the result…'], [
      ['**N** negative', 'has its top bit set (bit 15, or bit 7 for a byte)'],
      ['**Z** zero', 'is 0'],
      ['**V** overflow', 'is wrong as a signed number (e.g. 77777 + 1)'],
      ['**C** carry', 'carried out of the top bit, or borrowed (unsigned overflow)'],
    ]),
    note('The flags belong to the **last** instruction that set them. In `CMP R0, #5` / `MOV #1, R1` / `BLT …` the branch tests the `MOV`. Compare just before you branch.'),
    p('Bit 7 is the sign of a byte, so devices put their DONE or READY flag there: `TSTB @#XCSR` then `BPL` waits for the console, with no mask.'),
  ],
};

const addressing: Section = {
  id: 'addressing', title: 'Addressing modes', group: LANGUAGE,
  blocks: [
    p('Every operand is a register with one of eight modes. In the table, R is any register.'),
    table(['Write', 'Mode', 'The operand is'], [
      ['`R`', '0 register', 'the register itself'],
      ['`(R)`', '1 deferred', 'the word at the address in R'],
      ['`(R)+`', '2 autoincrement', 'the word at R; then R goes up by 2 (by 1 for a byte instruction)'],
      ['`@(R)+`', '3 autoincrement deferred', 'the word whose address is at R; then R goes up by 2'],
      ['`-(R)`', '4 autodecrement', 'R goes down by 2 (1 for bytes) first, then the word at R'],
      ['`@-(R)`', '5 autodecrement deferred', 'R goes down by 2, then the word whose address is at R'],
      ['`X(R)`', '6 index', 'the word at R + X; X is stored after the instruction'],
      ['`@X(R)`', '7 index deferred', 'the word whose address is at R + X'],
    ]),
    h('On the PC: values, addresses, labels'),
    table(['Write', 'Means', 'Example'], [
      ['`#n`', '**immediate**: the value n', '`MOV #5, R0`: R0 = 5'],
      ['`@#a`', '**absolute**: the word at address a', '`MOV @#DSPFRM, R0`: R0 = the frame counter'],
      ['`LABEL`', '**relative**: the word at LABEL', '`INC COUNT`: add 1 to the variable COUNT'],
      ['`@LABEL`', 'the word whose address is at LABEL', '`MOV @PTR, R0`'],
    ]),
    note('**`#` is a value, `@#` is an address.** `MOV #DSPFRM, R0` puts the *address* 176602 into R0; `MOV @#DSPFRM, R0` reads the frame counter. Device registers always need `@#`.'),
    h('Walking through memory'),
    code(`
              MOV  #LIST, R1     ; R1 points at the list
              CLR  R0
      1$:     ADD  (R1)+, R0     ; add a word, step to the next
              CMP  R1, #END
              BLO  1$
              HALT               ; R0 = 1+2+3 = 6
      LIST:   .WORD 1, 2, 3
      END:
    `, { run: true }),
    p('The same loop with `MOVB R2, (R1)+` paints a row of pixels. The [stack](stack) uses `-(SP)` to push and `(SP)+` to pop. '
      + 'A byte instruction steps by 1, except on SP and PC, which always step by 2. The **Addressing modes tour** example shows every mode.'),
  ],
};

const instructions: Section = {
  id: 'instructions', title: 'Instructions', group: LANGUAGE,
  blocks: [
    p('`src` and `dst` are operands in any [addressing mode](addressing); `R` must be a register. '
      + 'Beside each instruction: how it leaves the flags N Z V C. `*` from the result, `0` / `1` cleared / set, `–` unchanged.'),
    ...OP_GROUPS.flatMap((g) => [h(g.title), ...(g.intro ? [p(g.intro)] : []),
      ...(g.title === 'Branches' ? [table(['After `CMP a, b`', 'signed', 'unsigned (addresses, counts)'], [
        ['a = b', '`BEQ`', '`BEQ`'], ['a ≠ b', '`BNE`', '`BNE`'],
        ['a < b', '`BLT`', '`BLO`'], ['a ≤ b', '`BLE`', '`BLOS`'],
        ['a > b', '`BGT`', '`BHI`'], ['a ≥ b', '`BGE`', '`BHIS`'],
      ])] : []),
      entries(...g.ops.map(opEntry))]),
  ],
};

const memory: Section = {
  id: 'memory', title: 'Memory', group: MACHINE,
  blocks: [
    p('Memory is 64 KB of bytes, numbered by 16-bit addresses. A **word** is two bytes, **low byte first**, at an **even** address.'),
    table(['Addresses', 'What'], [
      ['000000–000377', 'trap and interrupt **vectors** (two words each: new PC, new PSW)'],
      [`000400–${o(RAM_END - 1)}`, 'RAM: your program, its data and the stack. Programs start at 001000.'],
      [`${o(DSP.SCREEN)}–157777`, 'the [display](display)\'s pixel memory'],
      [`${o(ROM_BASE)}–${o(ROM_BASE + ROM_SIZE - 1)}`, 'the [ROM](rom): the font and the routines that draw it. Read it freely; writing is a bus error.'],
      [`${o(DSP.DSPCS)}–176657`, 'the display\'s registers'],
      [`${o(KBD.KBDCS)}–176703`, 'the [keyboard](keyboard)\'s registers'],
      [`${o(KBD.KBDKEY)}–177177`, 'the keyboard\'s key map: a byte per key'],
      [o(DEV.LKS), 'the [line clock](clock)'],
      [`${o(DEV.RCSR)}–177567`, 'the [console](console)'],
      [o(PSW_ADDRESS), 'the [PSW](registers#sym-PSW)'],
      ['everything else', 'nothing: a bus error ([trap](traps) to 4)'],
    ]),
    h('Variables and tables'),
    p('Code and data share memory. Reserve a word with a label and `.WORD` (or `.BLKW`), and use the label as the operand:'),
    code(`
              INC  COUNT          ; COUNT = COUNT + 1
              MOV  COUNT, R0      ; read it
              MOV  #TABLE, R1
              MOV  4(R1), R2      ; the third word of TABLE: 30
              MOVB NAME+1, R3     ; one byte: 'I
              HALT
      COUNT:  .WORD 0
      TABLE:  .WORD 10, 20, 30
      NAME:   .ASCIZ /HI/
    `, { run: true }),
    list(
      'Run starts from power-up: memory is cleared and the program loaded again, so `COUNT` starts at 0 each time.',
      'Words are at even addresses: a word access at an odd address is a trap. After `.BYTE` or `.ASCIZ`, add `.EVEN` before more words.',
      'Byte instructions (`MOVB`, `CMPB`, `TSTB` …) reach any address. `MOVB` into a register sign-extends: byte 200–377 becomes negative.',
      'Low byte first: `MOV #1403, @#SCREEN` puts 3 in the first pixel and 3 in the second (`1403` = 3 × 400 + 3).',
    ),
  ],
};

const cycles: Section = {
  id: 'cycles', title: 'Cycles and time', group: MACHINE,
  blocks: [
    p('Every trip to memory costs **1 cycle**: the instruction word, each extra word (an immediate, an address, an index), each operand read and each operand write. Work inside the CPU is free.'),
    table(['Instruction', 'Cycles'], [
      ['`MOV R1, R2`', '1'],
      ['`MOV #5, R0`', '2'],
      ['`MOVB (R1)+, (R2)+`', '3'],
      ['`INC @#COUNT`', '4 (fetch, address, read, write)'],
      ['branches, `SOB`, `WAIT`, `HALT`, flag instructions', '1'],
      ['`JSR PC, X`', '3 (fetch, displacement, push)'],
      ['`RTS PC`', '2 (fetch, pop)'],
      ['`RTI`', '3 (fetch, pop PC, pop PSW)'],
      ['an interrupt or trap', '4 (push PSW, push PC, read the vector)'],
    ]),
    p(`A frame is ${dec(FRAME)} cycles: 60 frames make a second of the machine's time. So a program has ${dec(FRAME)} cycles between two pictures. `
      + 'Clearing a mode 0 page with `CLR (R1)+` and `SOB` costs about 6000 cycles; drawing a character with the [ROM](rom) about 400.'),
    p('**Step** shows the cycles an instruction took in the status line; the screen\'s line shows the cycle count of the run.'),
    note('Time is cycles, never your clock: the line clock, the display\'s frames and the keyboard\'s events all count cycles. That is why a [replay](controls) runs exactly the same.'),
  ],
};

const stack: Section = {
  id: 'stack', title: 'The stack and subroutines', group: MACHINE,
  blocks: [
    p('The stack is memory that SP points at. It grows **down**, below the program: Run sets SP to the program\'s first address (001000).'),
    table(['Write', 'Does'], [
      ['`MOV R2, -(SP)`', 'push R2'],
      ['`MOV (SP)+, R2`', 'pop into R2'],
      ['`MOV 2(SP), R0`', 'read the second word on the stack without popping'],
      ['`TST (SP)+`', 'drop the top word'],
    ]),
    h('Subroutines'),
    p('`JSR PC, NAME` pushes the return address and jumps; `RTS PC` pops it and goes back. A subroutine that uses a register keeps the caller\'s value by pushing it first and popping it before it returns, in the opposite order.'),
    code(`
              MOV  #3, R0
              JSR  PC, TWICE      ; R0 = 6
              HALT

      ; TWICE: R0 = R0 * 2. Keeps R1.
      TWICE:  MOV  R1, -(SP)      ; save R1
              MOV  R0, R1
              ADD  R1, R0
              MOV  (SP)+, R1      ; restore R1
              RTS  PC
    `, { run: true }),
    list(
      'Pass arguments and results in registers, or push them before the call.',
      'Every push needs its pop. If the stack is not balanced when `RTS PC` runs, it returns to the wrong place.',
      'Traps and interrupts push two words (PSW and PC); `RTI` pops them.',
      'A routine in the [ROM](rom) is called the same way, with `@#`: `JSR PC, @#DRAWCH`.',
    ),
  ],
};

const traps: Section = {
  id: 'traps', title: 'Traps and errors', group: MACHINE,
  blocks: [
    p('A **trap** is an interrupt caused by the program itself: a mistake, or a trap instruction. The CPU pushes the PSW and PC and continues at the address in the vector.'),
    table(['Vector', 'Cause'], [
      [o(VEC.BUS_ERROR, 3), '**bus error**: a word at an odd address, an address with nothing there, a write to ROM'],
      [o(VEC.ILLEGAL, 3), '**illegal instruction**: a word that is no instruction (or `MUL` / `DIV` without EIS)'],
      [o(VEC.BPT, 3), '`BPT`: a breakpoint in the code'],
      [o(VEC.IOT, 3), '`IOT`'],
      [o(VEC.EMT, 3), '`EMT`'],
      [o(VEC.TRAP, 3), '`TRAP`: your own system calls'],
      ['060, 064, 100, 320, 330', 'the devices\' [interrupts](interrupts)'],
    ]),
    h('A trap with no handler'),
    p('Every vector is 0 at power-up. A trap or interrupt whose vector is 0 does not jump: the run **stops**, and the status line says what happened and where, '
      + 'for example *Odd address 000001 at 001004* or *MUL at 001010 needs the EIS option*. A fault stops **at** the instruction that caused it; `BPT`, `TRAP` and `IOT` stop just after theirs.'),
    h('Catching a trap'),
    code(`
              MOV  #OOPS, @#4     ; bus errors come to OOPS
              MOV  #340, @#6
              MOV  @#1, R0        ; a word at an odd address: trap
              HALT
      OOPS:   MOV  (SP), R1       ; R1 = the address after the bad instruction
              HALT
    `, { run: true }),
    p('The **TRAP as a system call** example installs a handler at 34 and reads the call\'s number from the `TRAP` instruction.'),
    h('Common mistakes'),
    list(
      '`MOV DSPFRM, R0` without `@#`: that reads a variable called DSPFRM relative to the PC, not the device. Use `MOV @#DSPFRM, R0`.',
      '`MOV #BUF, R0` vs `MOV BUF, R0`: the first is the address of BUF, the second the word stored there.',
      'Data after code without a `HALT` or `BR` in between: the CPU runs into the data as if it were instructions.',
      'Words after `.ASCIZ` or `.BYTE` without `.EVEN`: they land on an odd address.',
      'Branching on old flags: an instruction between the `CMP` and the branch changed them.',
      'Setting a device\'s IE before its vector: the first interrupt finds 0 there.',
    ),
  ],
};

const interrupts: Section = {
  id: 'interrupts', title: 'Interrupts and WAIT', group: MACHINE,
  blocks: [
    p('Instead of polling a device, let it **interrupt**: set its IE bit, and when it has something (a key, a blank, a clock tick) the CPU stops what it is doing and runs your handler.'),
    list(
      'Each device has a **vector**: two words in low memory, the handler\'s address and the PSW to run it with. `MOV #TICK, @#100` installs the line clock\'s.',
      'The CPU pushes the PSW and PC, and loads both from the vector. The handler ends with `RTI`, which pops them back.',
      'The PSW\'s bits 7–5 are the CPU\'s **priority**. A device interrupts only above it: the console, display and keyboard at level 4, the line clock at 6. Handler PSW 340 (level 7) blocks every other interrupt while it runs.',
      'Interrupts come between instructions.',
      'A handler must keep every register it uses (push and pop), since it can break in anywhere.',
    ),
    table(['Vector', 'Device', 'Interrupts when'], [
      [o(DEV.VEC_RX, 3), '[console](console) receiver', 'a typed character is waiting in `RBUF`'],
      [o(DEV.VEC_TX, 3), 'console transmitter', 'it is ready for the next character'],
      [o(DEV.VEC_CLOCK, 3), '[line clock](clock)', 'every tick (once a frame)'],
      [o(DSP.VEC, 3), '[display](display) (`DSPVEC`)', 'every vertical blank'],
      [o(KBD.VEC, 3), '[keyboard](keyboard) (`KBDVEC`)', 'a key event is waiting in `KBDBUF`'],
    ]),
    h('WAIT'),
    p('`WAIT` sleeps until an interrupt comes, then goes on after the `WAIT` once the handler\'s `RTI` has run. The sleeping cycles pass at once. '
      + 'Since any interrupt wakes it, the pattern is always *wait, then check*:'),
    code(`
              MOV  #TICK, @#100       ; the clock's handler
              MOV  #340, @#102        ; its PSW: priority 7
              MOV  #100, @#LKS        ; IE: interrupt every tick
      1$:     WAIT                    ; sleep until an interrupt
              CMP  COUNT, #3
              BLO  1$                 ; fewer than 3 ticks: sleep again
              HALT                    ; 3 frames later

      TICK:   INC  COUNT
              RTI
      COUNT:  .WORD 0
    `, { run: true }),
    note('`WAIT` with no interrupt enabled can never wake: the run stops with *nothing can wake the CPU*.'),
    p('The **Line clock**, **Echo** and **Counting Space** examples use interrupts; the [display](display) interrupts at every blank, a heartbeat for a game.'),
  ],
};

const consoleSection: Section = {
  id: 'console', title: 'Console', group: DEVICES,
  blocks: [
    p('The console is a terminal: a printer for what the program writes, and a keyboard for text typed on it (DEC\'s DL11). '
      + 'It is the **Console** panel. Click it (or the screen) and type: each character goes to `RBUF`.'),
    entries(...symbolEntries('XCSR', 'XBUF', 'RCSR', 'RBUF')),
    h('Printing'),
    p('Wait until bit 7 of `XCSR` is set, then write the character to `XBUF`:'),
    code(`
              MOV  #MSG, R1
      1$:     MOVB (R1)+, R0      ; next character
              BEQ  3$             ; 0: done
      2$:     TSTB @#XCSR         ; ready? (bit 7 is the sign of the low byte)
              BPL  2$
              MOVB R0, @#XBUF     ; print it
              BR   1$
      3$:     HALT
      MSG:    .ASCIZ /HELLO/
    `, { run: true }),
    p('A new line is the two characters 15 and 12 (carriage return, line feed): put `.BYTE 15, 12` after the text\'s `.ASCII`.'),
    h('Reading what is typed'),
    code(`
      ; GETC: wait for a typed character, return it in R0.
      GETC:   TSTB @#RCSR         ; DONE: a character waiting?
              BPL  GETC
              MOVB @#RBUF, R0     ; take it (this clears DONE)
              RTS  PC
    `),
    list(
      'Characters typed before the program reads them wait in line: none is lost.',
      'Enter types 15, Backspace 10, Esc 33, Tab 11.',
      'The console is for **text**. For keys held down, or every press and release, use the [keyboard](keyboard).',
    ),
  ],
};

const clock: Section = {
  id: 'clock', title: 'Line clock', group: DEVICES,
  blocks: [
    p(`The line clock (DEC's KW11-L) ticks once a frame, every ${dec(FRAME)} cycles: 60 times a second of the machine's time.`),
    entries(...symbolEntries('LKS')),
    list(
      'Polling: `BIC #200, @#LKS`, then wait until `TSTB @#LKS` is negative.',
      `With IE (\`MOV #100, @#LKS\`) it interrupts at vector ${o(DEV.VEC_CLOCK, 3)}, level 6, at every tick: a heartbeat that wakes a \`WAIT\`. Install the handler first. See [interrupts](interrupts).`,
      'Setting IE between two ticks does not interrupt at once: the first interrupt comes at the next tick.',
    ),
  ],
};

const display: Section = {
  id: 'display', title: 'Display', group: DEVICES,
  blocks: [
    p('The screen is memory: **a pixel is a byte** (mode 0) or half a byte (mode 1) in the 16 KB at 120000–157777. '
      + 'Write a colour there and it shows at the next frame.'),
    table(['Mode', 'Pixels', 'A pixel', 'Pages at', 'Pixel (x, y) is at'], [
      ['**0**', '64 × 64 (`100` × `100`)', 'a byte', '120000, 130000, 140000, 150000', '`page + y*100 + x`'],
      ['**1**', '128 × 128 (`200` × `200`)', '4 bits, two per byte', '120000, 140000', '`page + y*100 + x/2`'],
    ]),
    h('Mode 0: a byte per pixel'),
    p('In octal the address shows the position: page 0 is `12YYXX`, so pixel (x = 12, y = 34) is at 123412. One row down adds 100, one pixel right adds 1.'),
    code(`
      ; A diagonal from the top left, in colour 12 (light green).
              MOV  #SCREEN, R1
              MOV  #100, R0       ; 64 pixels
      1$:     MOVB #12, (R1)
              ADD  #101, R1       ; one down, one right
              SOB  R0, 1$
              HALT
    `, { run: true }),
    list(
      'Only the low 4 bits pick the colour (0–17). The high 4 bits are kept but not shown: a program may use them as its own marks.',
      'A word is two pixels, low byte on the left: `MOV #1403, (R1)+` paints two pixels in colour 3.',
    ),
    h('Mode 1: two pixels per byte'),
    p('A row is still 100 bytes, so a row down is still `ADD #100`. In a byte, **even x is bits 3–0** and odd x bits 7–4. '
      + 'Change one pixel with `BICB` and `BISB`; a byte with colour c in both halves is `c*21`. The **Circle (mode 1, PLOT1)** example has a routine that plots a pixel.'),
    entries(...symbolEntries('SCREEN')),
    h('Registers'),
    entries(...symbolEntries('DSPCS', 'DSPFRM', 'DSPLIN', 'DSPPAL', 'DSPVEC')),
    table(['`DSPCS` bits', 'Name', ''], [
      ['1–0', '`PAGE`', 'the page shown, from the next vertical blank on (mode 1: 0–1)'],
      ['2', '`MODE`', '0: 64 × 64; 1: 128 × 128. From the next vertical blank on. Memory is not cleared'],
      ['6', 'IE', 'interrupt at every vertical blank, vector 320, level 4'],
      ['7', 'DONE', 'set at every vertical blank; cleared by writing it as 0 (`BIC #200, @#DSPCS`)'],
    ]),
    h('Frames and the vertical blank'),
    p(`Every ${dec(FRAME)} cycles comes a **vertical blank**: the display takes the page and the palette as they are into the picture you see, adds 1 to \`DSPFRM\`, and sets DONE. `
      + 'Wait for it to draw once a frame:'),
    code(`
      ; VSYNC: wait for the next vertical blank.
      VSYNC:  BIC  #200, @#DSPCS      ; forget a blank we may already have seen
      1$:     TSTB @#DSPCS            ; DONE?
              BPL  1$                 ; not yet
              RTS  PC
    `),
    list(
      '**Double buffering**: draw on a page that is not shown, then set `PAGE` to it. The switch happens at the blank, never in the middle of a picture. See the **Bouncing pixel** example.',
      'At power-up memory is 0 (black) and the palette is the one below.',
    ),
    entries(e('dsp-beam', [], 'The beam (Real beam)', 'With **Real beam (tearing)** on, the display reads the rows one by one during the frame, after a blank of 2500 cycles, as a real monitor does. '
      + 'A row changed before the beam reaches it shows in this picture, a row changed after in the next: drawing on the shown page **tears**. `DSPLIN` says where the beam is. '
      + 'Changing a palette entry when the beam reaches a row colours the rest of the picture: the **Sky gradient** example races the beam.')),
    h('The palette'),
    p('16 entries at `DSPPAL`, one word each, read as three octal digits **red green blue**, each 0–7: 700 is red, 070 green, 007 blue, 777 white. '
      + 'A pixel\'s value picks the entry. Change an entry and every pixel of that colour changes: `MOV #700, @#DSPPAL` turns the background red.'),
    table(['Index', 'Colour', 'Value'], DEFAULT_PALETTE.map((v, i) => [o(i, 2), COLOURS[i], `\`${o(v, 3)}\``])),
  ],
};

const keyboard: Section = {
  id: 'keyboard', title: 'Keyboard', group: DEVICES,
  blocks: [
    p('The keyboard is for games: it tells which keys are **down right now** (the key map), and every **press and release** in order (the event queue). '
      + 'For typed text, use the [console](console). Click the screen first, so the keys go to the program.'),
    h('Key codes'),
    p('A code names a key, a position on the keyboard, not the character it types. Letters and digits have their ASCII codes, so `\'A` is the A key and `\'7` the 7 key. The others have names:'),
    entries(...symbolEntries('K.UP', 'K.DOWN', 'K.LEFT', 'K.RGHT', 'K.SHFT', 'K.CTRL', 'K.ALT', 'K.BS', 'K.TAB', 'K.ENT', 'K.ESC', 'K.SPC', 'K.DEL')),
    p('There are codes for `\'` `,` `-` `.` `/` `;` `=` `[` `\\` `]` and the backquote too: their ASCII codes. Left and right Shift (Ctrl, Alt) are one key.'),
    h('The key map: which keys are down'),
    entries(...symbolEntries('KBDKEY')),
    p('The byte of key k is at `KBDKEY + k`: 200 while the key is down, 0 when it is up. Bit 7 is the sign of a byte, so `TSTB` and `BMI` test it:'),
    code(`
      ; Move a dot with ← and →, as long as they are held. Q quits.
              MOV  #SCREEN+4040, R1
      LOOP:   MOVB #17, (R1)              ; draw the dot
              JSR  PC, VSYNC              ; once a frame
              CLRB (R1)                   ; erase it
              TSTB @#KBDKEY+K.LEFT        ; ← down?
              BPL  1$
              DEC  R1
      1$:     TSTB @#KBDKEY+K.RGHT        ; → down?
              BPL  2$
              INC  R1
      2$:     TSTB @#KBDKEY+'Q            ; Q quits
              BPL  LOOP
              HALT

      VSYNC:  BIC  #200, @#DSPCS
      3$:     TSTB @#DSPCS
              BPL  3$
              RTS  PC
    `),
    note('The key map shows what is down when it is read. A tap that starts and ends between two reads is never seen there: that is what the event queue is for.'),
    h('The event queue: every press and release'),
    entries(...symbolEntries('KBDCS', 'KBDBUF', 'KBDVEC')),
    list(
      '`MOVB @#KBDBUF, R0` sign-extends, so **a release is negative**: `BMI` branches on it, and `BIC #177600, R0` leaves only the code.',
      'Reading `KBDBUF` takes the event out; if another is waiting it comes in and DONE stays set. With nothing waiting it reads 0.',
      'The queue holds 16 events. One more is lost and sets OVR (bit 15), until the program writes it as 0. The key map is always right.',
      `With IE (\`BIS #100, @#KBDCS\`) the keyboard interrupts at vector ${o(KBD.VEC, 3)}, level 4, while an event is waiting.`,
    ),
    code(`
      ; GETKEY: wait for a key press, return its code in R0. Releases are skipped.
      GETKEY: TSTB @#KBDCS                ; DONE: an event waiting?
              BPL  GETKEY
              MOVB @#KBDBUF, R0           ; take it
              BMI  GETKEY                 ; a release: not what we want
              RTS  PC
    `),
    p('Every key goes into the **Input log** with its cycle, so a **Replay** presses it again at the same cycle: the run happens again exactly.'),
  ],
};

/** The ROM's numbers, from its assembly. */
const romSym = (n: string) => romAssembly().symbols.get(n)!;

const rom: Section = {
  id: 'rom', title: 'The ROM: text on the screen', group: DEVICES,
  blocks: [
    p(`There is no text mode: text is drawn pixel by pixel. The ROM, at ${o(ROM_BASE)}–${o(ROM_BASE + ROM_SIZE - 1)}, holds an 8 × 8 **font** and two routines that draw it. `
      + 'They are ordinary Blue-11 code: the **ROM** tab shows the source. Read it, call it, then copy it into your own program and change it.'),
    entries(...symbolEntries('DRAWCH', 'DRAWC1', 'FONT')),
    code(`
      ; HI in white at the top left, in mode 0.
              MOV  #SCREEN, R1    ; the first cell
              MOV  #17, R2        ; white
              MOV  #'H, R0
              JSR  PC, @#DRAWCH   ; R1 moves to the next cell
              MOV  #'I, R0
              JSR  PC, @#DRAWCH
              HALT
    `, { run: true }),
    list(
      'Only the glyph\'s pixels are painted: the rest of the cell is left as it is. To write over old text, clear the cell first.',
      'Every other register is kept, so a loop can draw a whole text with R1 moving along.',
      'Mode 0 has 8 × 8 cells (cell (c, r) at `SCREEN + r*1000 + c*10`); mode 1 has 16 × 16 (at `SCREEN + r*1000 + c*4`).',
      'A character costs about 400 cycles: a full screen of text in mode 0 takes more than a frame. Redraw only what changed.',
      `In the font, character c is at \`FONT + c*10\` (${o(romSym('FONT'))} + c*10): 8 bytes, the top row first, bit 7 the leftmost pixel. \`'A\` (101) is at ${o(romSym('FONT') + 0o101 * 8)}.`,
      'Codes 40–176 are printable; 0–37 and 177 are blank.',
    ),
    p(`\`DRAWCH\` (${o(romSym('DRAWCH'))}) and \`DRAWC1\` (${o(romSym('DRAWC1'))}) are a jump table: each is a \`JMP\` to the routine, so the addresses stay the same when the routines change. `
      + 'The **Hello**, **Font viewer** and **My own DRAWCH** examples use them.'),
  ],
};

const SECTIONS_NO_INDEX: Section[] = [start, controls, assembler, registers, addressing, instructions, memory, cycles, stack, traps, interrupts,
  consoleSection, clock, display, keyboard, rom];

/** Every predefined name with its value and where it is described. */
function symbolIndex(): Section {
  const rows: string[][] = [];
  for (const s of SECTIONS_NO_INDEX) {
    for (const b of s.blocks) {
      if (b.kind !== 'entries') continue;
      for (const en of b.entries) {
        if (!en.anchor.startsWith('sym-')) continue;
        rows.push([`[${en.names[0]}](${s.id}#${en.anchor})`, `\`${(en.detail ?? '').replace('= ', '')}\``, en.text]);
      }
    }
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  return {
    id: 'symbols', title: 'Predefined names', group: REFERENCE,
    blocks: [
      p('The names every program can use without defining them: the devices\' registers, the key codes and the ROM\'s entry points. Click one for its section.'),
      table(['Name', 'Value', 'Meaning'], rows),
    ],
  };
}

export const SECTIONS: readonly Section[] = [...SECTIONS_NO_INDEX, symbolIndex()];
