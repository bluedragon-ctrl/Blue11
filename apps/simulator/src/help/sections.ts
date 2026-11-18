/**
 * The simulator's help text, for students. Numbers are octal unless written with a dot
 * (`200.`), as on the machine. Facts that live in the code (addresses, the palette, the
 * frame's cycles) come from the library's constants and the ROM, so the help follows them.
 * Every `code` block assembles, and the `run` ones run in the simulator to a HALT of their
 * own: test/help.test.ts.
 *
 * Write for a student who has never seen assembly: short pages, a small example near the
 * top, the reason before the rule, and every new word explained (or in the glossary).
 */

import { DEFAULT_PALETTE, DEV, DSP, KBD, octal, PSW_ADDRESS, VEC } from 'blue11';
import { ROM_BASE, ROM_SIZE, romAssembly } from '../rom';
import { OP_GROUPS, opEntry } from './instructions';
import { code, dec, entries, h, list, note, p, table, type Block, type Entry, type Section } from './model';
import { symbolEntries } from './symbols';

const o = (n: number, digits = 6) => octal(n, digits);
const START = 'Start';
const LANGUAGE = 'Language';
const MEMREG = 'Memory and registers';
const INSTRUCTIONS = 'Instructions';
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

// ------------------------------------------------------------------ Start

const start: Section = {
  id: 'start', title: 'Getting started', group: START,
  blocks: [
    p('Blue-11 is a small 16-bit computer, built like the PDP-11, a classic minicomputer of the 1970s. It has a **screen**, a **keyboard** and a **console** (a text terminal). '
      + 'You program it in **assembly language**: one line for each step the CPU takes. It is slow to write, but nothing is hidden: you see every step.'),
    h('Your first program'),
    p('Copy these two lines into the editor and press **Run** (or Ctrl+Enter). A yellow dot appears in the middle of the screen.'),
    code(`
      ; Draw a yellow pixel in the middle of the screen.
              MOVB #16, @#SCREEN+4040   ; 16 = yellow; row 40, column 40
              HALT                      ; stop
    `, { run: true }),
    list(
      '`MOVB` means *move a byte*: copy a value somewhere.',
      '`#16` is the number 16: the colour yellow (see [colours](palette)).',
      '`@#SCREEN+4040` is a place in memory: the pixel in row 40, column 40. The screen **is** memory, so writing a byte there paints a pixel.',
      '`HALT` stops the CPU. Without it the CPU would go on and run whatever happens to be in memory after your program.',
      'Everything after `;` is a **comment**, for people. The assembler skips it.',
    ),
    note('**Numbers are octal** (base 8): `10` is eight and `100` is sixty-four. Write a dot for decimal: `10.` is ten. [Octal numbers](octal) explains why, in two minutes.'),
    h('Now change it'),
    list(
      'Change `#16` to `#12`, or `4040` to `0000`, and run again. What happens?',
      'Add a second `MOVB` line before the `HALT` to draw another pixel.',
      'Press **Step** (F10) instead of Run to go one instruction at a time and watch the [registers](registers) change.',
    ),
    h('How a line is written'),
    code(`
      LOOP:   MOV  #3, R0        ; label, instruction, operands, comment
    `),
    list(
      'An optional `label:` names the line, so other lines can jump to it or read it.',
      'Then the instruction and its **operands**, separated by a comma. The **source comes first**: `MOV #3, R0` moves 3 into R0.',
      '`R0` is a [register](registers), a fast storage place inside the CPU. [The big picture](computer) explains registers and memory.',
      'Names such as `SCREEN`, `DSPCS` and `KBDKEY` are [predefined](symbols): every program can use them.',
    ),
    h('Where to go next'),
    list(
      'The **Programs** menu starts with **First steps**: eight short programs, each adding one idea, from a single pixel to a dot you move with the keys. Open one, Step through it, change it. After them come bigger programs for the console, the display and the keyboard.',
      'Read [The big picture](computer) to see how the CPU, registers and memory work together, then [Writing assembly](assembler) and [Addressing modes](addressing). Pick [instructions](instructions) as you need them.',
      'Make something: pixels on the [display](display), keys from the [keyboard](keyboard), text with the [ROM](rom).',
      'Stuck? [When something goes wrong](problems) lists the usual mistakes.',
    ),
    note('Press **F1** in the editor to look up the word under the cursor: an instruction, a register, a device name. Resting the mouse on one shows a short help. The search box above finds anything in the help, and the [glossary](glossary) explains the words it uses.'),
  ],
};

const octalSection: Section = {
  id: 'octal', title: 'Numbers: octal and negative', group: START,
  blocks: [
    p('Blue-11 counts in **octal**, base 8, as the PDP-11 did. Octal uses only the digits 0–7: after 7 comes 10 (eight), after 77 comes 100 (sixty-four). '
      + 'Every number in the editor, the panels and this help is octal, unless it ends in a dot: `10.` is ten.'),
    table(['Decimal', 'Octal', 'Bits'], [
      ['0 … 7', '`0` … `7`', '000 … 111'],
      ['8.', '`10`', '001 000'],
      ['10.', '`12`', '001 010'],
      ['64.', '`100`', '001 000 000'],
      ['255. (a full byte)', '`377`', '11 111 111'],
      ['65535. (a full word)', '`177777`', '1 111 111 111 111 111'],
    ]),
    h('Why octal?'),
    p('**One octal digit is exactly three bits.** So you can read the bits of a number straight from its digits: `5` is 101, so `55` is 101 101. '
      + 'Computers work in bits, and the PDP-11\'s instructions are built from 3-bit fields, so octal makes the machine easy to read.'),
    h('Bits as numbers'),
    p('Devices use single bits as switches and signals. Bit n has the value 2ⁿ. In octal these are easy to remember:'),
    table(['Bit', '0', '1', '2', '3', '4', '5', '6', '7', '15'], [
      ['Value', '`1`', '`2`', '`4`', '`10`', '`20`', '`40`', '`100`', '`200`', '`100000`'],
    ]),
    p('So `BIS #100, @#LKS` sets bit 6 (the [line clock](clock)\'s IE), and `TSTB` tests bit 7 (`200`), the sign of a byte.'),
    h('Negative numbers'),
    p('A word has 16 bits, so it holds 0 to 177777. To have negative numbers too, the top bit (bit 15) is taken to mean *negative*. This is called **two\'s complement**: '
      + 'to make a number negative, invert every bit and add 1. 1 is 000001; inverted, 177776; plus 1, 177777. So 177777 is −1.'),
    table(['Bits as written', 'Unsigned', 'Signed'], [
      ['`000000`', '0', '0'],
      ['`077777`', '32767.', '32767. (the largest)'],
      ['`100000`', '32768.', '−32768. (the smallest)'],
      ['`177776`', '65534.', '−2'],
      ['`177777`', '65535.', '−1'],
    ]),
    p('The same bits are both numbers: you decide which one you mean, by the [branch](ins-branch) you use. Adding and subtracting work the same either way. '
      + 'A byte works the same in 8 bits: 377 is −1, 200 is −128., 177 is 127.'),
    p('**Sign extension**: `MOVB` into a register copies the byte\'s top bit into the whole high byte, so the number keeps its sign. 377 (−1) becomes 177777 (−1), while 177 becomes 000177.'),
    h('Writing numbers'),
    list(
      '`17` is octal (fifteen); `15.` is decimal (fifteen).',
      '`^D15` is decimal, `^O17` octal and `^B1111` binary: all three are fifteen.',
      '`\'A` is the character code of A (`101`).',
      '`-1` is `177777`, `-2` is `177776`: see above.',
    ),
    note('Most calculators have an octal mode (often called *oct* or *programmer*). The **Memory** panel and the registers show octal, so you get used to it quickly.'),
  ],
};

const running: Section = {
  id: 'running', title: 'Running a program', group: START,
  blocks: [
    table(['Button', 'What it does'], [
      ['**Run** (Ctrl+Enter)', 'Assemble the editor\'s program and start it fresh: memory cleared, the program loaded, every device reset.'],
      ['**Pause**', 'Stop at the end of the frame.'],
      ['**Continue**', 'Go on after a pause, a breakpoint, a step or a `HALT`. Only while the program in the editor is the one loaded.'],
      ['**Restart**', 'Load the program again, stopped at its first instruction.'],
    ]),
    p('To go one step at a time, see [Debugging](debugging).'),
    p('While the program runs, the screen shows a new picture every frame. When it has ended (a `HALT`, or an error), the screen shows the pixel memory as it is, as a real monitor goes on showing it while the CPU stands still.'),
    h('Time and speed'),
    p(`The machine runs in **frames** of ${dec(FRAME)} cycles; the [display](display) shows one picture per frame, 60 a second. `
      + 'A **cycle** is one trip to memory, so a short instruction costs 1–3 [cycles](cycles). '
      + '**Speed** says how many frames run per second of your time (60 is real time). A program behaves exactly the same at every speed: only you see it faster or slower.'),
    h('Typing into your program'),
    p('Click the screen or the console first: the label says *keyboard → program*. Now every key goes to the program: to the [keyboard](keyboard) device, and a key that types a character also to the [console](console). '
      + 'Ctrl and Cmd shortcuts stay with the browser. Clicking elsewhere releases every key.'),
    h('Settings'),
    list(
      '**Real beam (tearing)**: the screen is read row by row while the program runs, as on a real monitor ([the beam](display-frames#dsp-beam)). Off, each frame shows memory as it was at the vertical blank.',
      '**EIS**: the [multiply and divide](ins-eis) instructions. Off, they are illegal instructions.',
      '**Retro**: the period look for the screen, the listings and the console. It changes nothing in the machine.',
      'Changing **Real beam** or **EIS** starts the program again. Both are saved with the program, in share links and in replays.',
    ),
    h('Saving and sharing'),
    list(
      'The editor\'s text is kept between visits, in this browser.',
      '**Save** puts the program in **My programs** in the **Programs** menu, next to the examples.',
      '**Share** copies a link with the program and its settings (not the input). Anyone who opens it gets your program.',
    ),
  ],
};

const debugging: Section = {
  id: 'debugging', title: 'Debugging', group: START,
  blocks: [
    p('A program rarely works the first time. The simulator lets you stop it anywhere and look inside: at the registers, the flags, memory and the stack.'),
    h('Stepping'),
    list(
      '**Step** (F10) runs one instruction. If the code changed, it loads it first. The status line shows how many [cycles](cycles) it took.',
      '**Step frame** runs to the end of this frame: handy for games that draw once a frame.',
      'The current instruction is highlighted in the editor and in the disassembly.',
    ),
    h('Breakpoints'),
    list(
      'Click left of a line number, or press **F9** on the line: a red dot. Run and Continue stop **before** that instruction runs.',
      'Click a row in **Disassembly** to set one by address, also inside the [ROM](rom).',
      'A `BPT` instruction in the code stops the run too; Continue goes on after it.',
    ),
    h('The panels'),
    list(
      '**CPU**: the [registers](registers), the [PSW](registers#sym-PSW) with its flags (`-` means clear) and the priority.',
      '**Memory**: words from an address. Type an octal address, a label, a device name (`DSPCS`) or a register (`SP`).',
      '**Stack**: the words from SP up to where the [stack](stack) started.',
      '**Disassembly**: the instructions in memory around the PC, with labels.',
      '**Listing**: the assembler\'s output: each line\'s address and the words it became.',
      '**Console**: what the program printed.',
      'The orange bar beside the line numbers is a **heat map**: the brighter, the more often that line ran. It shows where the time goes.',
    ),
    h('Replays'),
    p('The **Input log** records every key and console character with its cycle. **Replay** runs the program again with the same input at the same cycles, so a bug happens again exactly. '
      + '**Save** and **Open** keep a replay in a file.'),
    h('A way to find a bug'),
    list(
      'Say what the program should do at one line, then put a breakpoint there.',
      'Run, and check the registers and memory against what you expected.',
      'Right: move the breakpoint later. Wrong: move it earlier, or Step towards it. The bug is between the last right place and the first wrong one.',
    ),
  ],
};

const problems: Section = {
  id: 'problems', title: 'When something goes wrong', group: START,
  blocks: [
    h('The status line'),
    p('When the program stops, the status line says why and where.'),
    table(['Message', 'Meaning'], [
      ['N errors, the first on line …', 'The assembler found mistakes; they are marked on their lines. Rest the mouse on the mark to read it.'],
      ['HALT at …', 'A `HALT` ran: the normal end. Continue goes on after it.'],
      ['Odd address, Bus error, Illegal instruction …', 'A [trap](traps) with no handler: the run stopped at the instruction that caused it.'],
      ['BPT at …', 'A `BPT` in the code: Continue goes on after it.'],
      ['WAIT at …, and no device has interrupts on', 'A `WAIT` that nothing can wake: it would sleep forever. See [interrupts](interrupts).'],
      ['Interrupt through vector … with no handler', 'A device\'s IE is set but its vector is still 0: set the vector first.'],
      ['Double fault', 'A trap could not push onto the stack (SP pointed at nothing). Run again.'],
    ]),
    h('Common mistakes'),
    list(
      '**Forgetting `@#` on a device**: `MOV DSPFRM, R0` reads a variable called DSPFRM, not the device. Use `MOV @#DSPFRM, R0`. See [addressing](addressing).',
      '**`#` or not**: `MOV #BUF, R0` puts the *address* of BUF in R0; `MOV BUF, R0` the word stored *at* BUF.',
      '**Decimal by mistake**: `MOV #100, R0` is sixty-four. Write `100.` for a hundred. See [octal](octal).',
      '**No `HALT` before the data**: the CPU runs into the data as if it were instructions.',
      '**Words at odd addresses**: after `.ASCIZ` or `.BYTE`, add `.EVEN` before more words or code.',
      '**Branching on old flags**: an instruction between the `CMP` and the branch changed them. Compare just before you branch.',
      '**Wrong `CMP` order**: `CMP R0, #10` then `BLT` branches if R0 < 10. The first operand is the one on the left of `<`.',
      '**An unbalanced stack**: every push needs its pop before `RTS PC`, or it returns to the wrong place.',
      '**IE before the vector**: set a device\'s vector before you turn its interrupt on.',
    ),
  ],
};

// ------------------------------------------------------------------ Language

const assembler: Section = {
  id: 'assembler', title: 'Writing assembly', group: LANGUAGE,
  blocks: [
    p('The **assembler** turns your text into the words of machine code the CPU runs. Each line becomes one instruction or some data. Run assembles the program first; the **Listing** tab shows what each line became.'),
    code(`
      COUNT = 5                  ; a constant
      START:  MOV  #COUNT, R0    ; label, instruction, operands, comment
      1$:     DEC  R0
              BNE  1$            ; back to 1$ until R0 is 0
              HALT
    `),
    entries(
      e('syn-names', [], 'Names', 'Labels and symbols have **1 to 6** letters, digits, `.` or `$`, and do not start with a digit. '
        + 'Case does not matter. A seventh character is an error. The [predefined names](symbols), register names and instruction names cannot be used as labels.'),
      e('syn-local', [], 'Local labels `1$`', '`1$` to `99$` are labels that only live between two ordinary labels, so every routine can have its own `1$:` loop without inventing new names.'),
      e('syn-numbers', [], 'Numbers', '`17` is **octal** (fifteen). `15.` is decimal. `^D15`, `^O17` and `^B1111` name the base. `\'A` is the code of the character A. Negative numbers: `-1` is 177777. See [octal numbers](octal).'),
      e('syn-expr', [], 'Expressions', 'The assembler can compute values: `@#SCREEN+4040` is the pixel at row 40, column 40. Operators are `+ - * /`, `&` (and), `!` (or), and they are worked out strictly **left to right**: `2+3*4` is 24 (octal), `2+<3*4>` is 16. Use `< >` as brackets. '
        + 'Values are 16-bit words: `177777+2` is 1, and `/` is signed (`177777/2` is 0, as `<-1>/2`). The assembler warns about `*` or `/` after `+` or `-` without `< >`.'),
      e('syn-equ', ['='], '`NAME = value`', 'Define a constant: `WIDTH = 100`, then `MOV #WIDTH, R0`. A name for a number makes a program easier to read and to change. `PTR = %3` makes `PTR` another name for R3.'),
      e('syn-dot', ['.'], '`.`', 'The location counter: the address being assembled. `. = 2000` moves it; `. = . + 20` skips 20 bytes.'),
    ),
    h('Where the program goes'),
    p('The program is assembled from address 1000 unless you move `.` first, and it starts at its first instruction (or at the label after `.END`). '
      + 'To put data in memory, see [directives](directives).'),
  ],
};

const directives: Section = {
  id: 'directives', title: 'Directives', group: LANGUAGE,
  blocks: [
    p('A **directive** starts with a dot. It is an order to the assembler, not an instruction for the CPU: put these bytes here, leave room there.'),
    code(`
              MOV  #MSG, R1       ; R1 = the address of the text
              MOV  SPEED, R0      ; R0 = 3
              HALT
      SPEED:  .WORD 3             ; a variable
      MSG:    .ASCIZ /HI!/        ; a text, ending in a 0 byte
              .EVEN
      BUF:    .BLKW 10.           ; ten words of room
    `, { run: true }),
    entries(
      e('dir-.WORD', ['.WORD'], '`.WORD a, b, …`', 'Words of data: `.WORD 1, 2, LOOP`. A line with just a value is a `.WORD` too.'),
      e('dir-.BYTE', ['.BYTE'], '`.BYTE a, b, …`', 'Bytes of data: `.BYTE 1, 377`.'),
      e('dir-.ASCII', ['.ASCII'], '`.ASCII /text/`', 'The characters of the text, one byte each. Any character that is not in the text can be the delimiter.'),
      e('dir-.ASCIZ', ['.ASCIZ'], '`.ASCIZ /text/`', 'As `.ASCII`, with a 0 byte at the end, so a loop knows where the text stops.'),
      e('dir-.BLKW', ['.BLKW'], '`.BLKW n`', 'Reserve `n` words (zero): `BUF: .BLKW 20.`'),
      e('dir-.BLKB', ['.BLKB'], '`.BLKB n`', 'Reserve `n` bytes (zero).'),
      e('dir-.EVEN', ['.EVEN'], '`.EVEN`', 'Move to an even address. Put it after bytes or text and before words or code: words must be at even addresses.'),
      e('dir-.ODD', ['.ODD'], '`.ODD`', 'Move to an odd address.'),
      e('dir-.END', ['.END'], '`.END label`', 'The end of the program; the label, if any, is where it starts. Without it the program starts at its first instruction.'),
    ),
    h('Also accepted'),
    list(
      'The program is one file: there are no macros or include files.',
      '`.TITLE`, `.SBTTL`, `.IDENT`, `.LIST`, `.NLIST` and `.PAGE` are accepted and ignored, as on the original assembler.',
      '`.ENABL LSB` makes local labels such as `1$` reach across ordinary labels until `.DSABL LSB`.',
      '`.ENABL AMA` assembles `LABEL` as `@#LABEL`.',
    ),
  ],
};

const bigPicture: Section = {
  id: 'computer', title: 'The big picture: CPU, registers, memory', group: MEMREG,
  blocks: [
    p('Every program does the same few things: it takes numbers from somewhere, works on them, and puts the results somewhere. That *somewhere* is either **memory** or a **register**. This page shows how they fit together.'),
    table(['Part', 'What it is', 'Where you see it'], [
      ['**CPU**', 'The processor: it runs instructions, one after the other.', 'the highlighted line'],
      ['**Registers**', 'Eight 16-bit places **inside** the CPU, called R0–R7. Few, but fast: the CPU works on them directly.', 'the **CPU** panel'],
      ['**Memory**', '65536. bytes **outside** the CPU, each with a number, its **address** (0–177777). Big, but each use costs time.', 'the **Memory** panel'],
    ]),
    h('Memory: numbered boxes'),
    p('Think of memory as a long row of boxes, numbered from 0. Each box holds one **byte** (0–377). Two boxes side by side, starting at an even number, make a **word** (0–177777), the size the CPU works in. '
      + 'Everything lives in memory: your program, its variables, the stack, even the pixels of the screen and the devices\' registers. A label like `COUNT:` is just a name for one box\'s address.'),
    h('Registers: the CPU\'s hands'),
    p('Memory is big, but every trip to it costs a [cycle](cycles). So programs bring the values they are working on into **registers**, which the CPU uses directly, like holding something in your hands instead of fetching it from a shelf each time. '
      + 'R0–R5 are free for anything. Two have a fixed job: **R6 = SP**, the stack pointer, holds the address of the top of the [stack](stack); **R7 = PC**, the program counter, holds the address of the next instruction.'),
    h('How an instruction runs'),
    p('Your program is numbers in memory too (the **Listing** tab shows them). The CPU repeats three steps forever: **fetch** the instruction at the address in PC, move PC past it, **do** it. '
      + 'A jump or branch just puts a new address into PC. `HALT` stops the repeating.'),
    h('Follow a program'),
    p('This program takes two numbers from memory, adds them in a register, and puts the sum back in memory. Press **Step** (F10) and watch PC, R0 and the word at `C` change:'),
    code(`
              MOV  A, R0          ; memory → register:  R0 = 5
              ADD  B, R0          ; memory + register:  R0 = 5 + 3
              MOV  R0, C          ; register → memory:  C = 10 (eight)
              HALT
      A:      .WORD 5
      B:      .WORD 3
      C:      .WORD 0
    `, { run: true }),
    table(['After', 'PC', 'R0', 'Word at C'], [
      ['loading', '`001000`', '`0`', '`0`'],
      ['`MOV A, R0`', '`001004`', '`5`', '`0`'],
      ['`ADD B, R0`', '`001010`', '`10`', '`0`'],
      ['`MOV R0, C`', '`001014`', '`10`', '`10`'],
      ['`HALT`', '`001016`', '`10`', '`10`'],
    ]),
    p('Each of the first three instructions takes two words: the instruction, and a second word that says where `A`, `B` or `C` is. So PC moves on by 4 each time. `HALT` is one word.'),
    note('**A register holds one number; memory holds many.** Load what you need into registers, work there, store the results back. Most programs are this pattern again and again.'),
    h('Read on'),
    list(
      '[Registers and flags](registers): each register, and the flags that remember facts about the last result.',
      '[Memory](memory): what is at which address, variables and tables.',
      '[Addressing modes](addressing): all the ways an operand can say where a number is.',
      '[The stack](stack): a pile of words for saving registers and calling subroutines.',
    ),
  ],
};

const registers: Section = {
  id: 'registers', title: 'Registers and flags', group: MEMREG,
  blocks: [
    p('**Registers** are eight 16-bit storage places inside the CPU. They are where the work happens: using a register is free, while every trip to memory costs a [cycle](cycles). '
      + 'Six are yours to use as you like; two have a special job. The **CPU** panel shows them all.'),
    entries(
      e('reg-R0', ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'], '`R0` – `R5`', 'General purpose: counters, pointers, values. Subroutines usually take arguments and give results in them, as the [ROM](rom)\'s `DRAWCH` does.'),
      e('reg-SP', ['SP', 'R6'], '`SP` (R6)', 'The **stack pointer**: the address of the top of the [stack](stack), the word pushed last. A push moves SP down by 2 and stores a word there; a pop takes the word and moves SP up by 2. '
        + 'Run sets it to the program\'s first address (1000), so the stack grows down from there. `JSR`, `RTS`, traps and interrupts all use it, so keep SP for the stack.'),
      e('reg-PC', ['PC', 'R7'], '`PC` (R7)', 'The **program counter**: the address of the next instruction. The CPU reads the instruction at PC, moves PC past it, and runs it; a jump or branch just puts a new address into PC. '
        + 'The highlighted line in the editor and the **Disassembly** is where PC is. `#`, `@#` and labels are [addressing modes on the PC](modes).'),
      e('reg-%', ['%0', '%1', '%2', '%3', '%4', '%5', '%6', '%7'], '`%n`', 'Register n by number: `PTR = %3` makes `PTR` another name for R3.'),
    ),
    h('The flags'),
    p('After most instructions the CPU notes four facts about the result, the **flags**. [Branches](ins-branch) test them to decide where to go: that is how a program makes decisions.'),
    table(['Flag', 'Set when the result…', 'Example'], [
      ['**N** negative', 'has its top bit set (bit 15, or bit 7 for a byte): negative as a [signed number](octal)', '`MOV #-5, R0`'],
      ['**Z** zero', 'is 0', '`SUB #3, R0` with R0 = 3'],
      ['**V** overflow', 'is wrong as a **signed** number: it did not fit in −100000…77777', '77777 + 1 = 100000: two positives gave a negative'],
      ['**C** carry', 'is wrong as an **unsigned** number: it did not fit in 0…177777. For a subtract or compare: a **borrow**, the second number was bigger', '177777 + 1 = 0'],
    ]),
    p('The CPU does not know whether you mean your numbers as signed or unsigned, so it sets both V and C, and you pick the branch that fits: `BLT` for signed, `BLO` for unsigned ([which branch?](ins-branch)).'),
    code(`
              MOV  #3, R0
              SUB  #3, R0         ; R0 = 0: Z is set
              BEQ  ZERO           ; Z set: go to ZERO
              HALT                ; not reached
      ZERO:   HALT
    `, { run: true }),
    note('The flags belong to the **last** instruction that set them. In `CMP R0, #5` / `MOV #1, R1` / `BLT …` the branch tests the `MOV`. Compare just before you branch.'),
    p('Bit 7 is the sign of a byte, so devices put their DONE or READY flag there: `TSTB @#XCSR` then `BPL` waits for the console, with no mask.'),
    h('The PSW'),
    p('The flags live in the **processor status word** (PSW), together with the CPU\'s **priority** (bits 7–5): the level an [interrupt](interrupts) must be above to break in. '
      + 'The **CPU** panel shows it. Programs rarely touch the PSW directly; each [vector](traps) holds a new PSW for its handler.'),
    entries(...symbolEntries('PSW')),
  ],
};

const addressing: Section = {
  id: 'addressing', title: 'Addressing modes', group: MEMREG,
  blocks: [
    p('An **addressing mode** is the way an operand says where its value is: in a register, in memory, or written in the instruction itself. Four of them cover most programs:'),
    table(['Write', 'Means', 'Example'], [
      ['`R0`', 'the register', '`MOV R1, R0`: R0 = R1'],
      ['`#n`', '**immediate**: the value n itself, written in the instruction', '`MOV #5, R0`: R0 = 5'],
      ['`LABEL`', 'the word in memory at LABEL: a variable', '`INC COUNT`: add 1 to the variable COUNT'],
      ['`@#a`', '**absolute**: the word at address a. Use it for devices', '`MOV @#DSPFRM, R0`: R0 = the frame counter'],
    ]),
    note('**`#` is a value, `@#` is an address.** `MOV #DSPFRM, R0` puts the *address* 176602 into R0; `MOV @#DSPFRM, R0` reads the frame counter. Device registers always need `@#`.'),
    h('Pointers: walking through memory'),
    p('A register can hold an address instead of a value: then it is a **pointer**, it *points at* a place in memory. '
      + 'Parentheses mean *go to that address*: `(R1)` is not R1, but the word at the address that is in R1. `(R1)+` does the same and then moves R1 on to the next word, which makes loops over a list or the screen short:'),
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
    p('The same loop with `MOVB R2, (R1)+` paints a row of pixels. The [stack](stack) uses `-(SP)` to push and `(SP)+` to pop.'),
    p('There are eight modes in all. [Addressing modes in detail](modes) goes through each one with an example, and explains **deferred**.'),
  ],
};

const modes: Section = {
  id: 'modes', title: 'Addressing modes in detail', group: MEMREG,
  blocks: [
    p('Every operand is a register (R0–R7) plus one of eight **modes**: the mode says what to do with the register. In the examples, R1 holds 2000, and memory holds:'),
    table(['Address', '2000', '2002', '2004', '3000'], [['Word', '`3000`', '`22`', '`33`', '`7`']]),
    h('Deferred: one more step'),
    p('**Deferred** (also called *indirect*) means: what you found is not the value but an **address**, so go there and take the word you find. '
      + 'Parentheses `( )` defer once, from a register to memory. An `@` in front defers once more. '
      + 'Think of a note that says *the answer is in drawer 2000*: plain `R1` is the note itself, `(R1)` is what is in drawer 2000, and `@(R1)+` finds another note in drawer 2000 and follows that one too.'),
    entries(
      e('mode-0', [], 'Mode 0, register: `R1`', 'The register itself. `MOV R1, R0`: R0 = 2000.'),
      e('mode-1', [], 'Mode 1, register deferred: `(R1)`', 'The word at the address in R1. `MOV (R1), R0`: R0 = 3000, the word at 2000. R1 does not change.'),
      e('mode-2', [], 'Mode 2, autoincrement: `(R1)+`', 'As `(R1)`, then R1 goes **up** by 2 (by 1 for a byte instruction), to the next word. `MOV (R1)+, R0`: R0 = 3000, then R1 = 2002. For stepping forward through a list, and for popping: `(SP)+`.'),
      e('mode-3', [], 'Mode 3, autoincrement deferred: `@(R1)+`', 'R1 points at a list of **addresses**: take the address at R1, then the word at that address, then R1 goes up by 2. `MOV @(R1)+, R0`: the word at 2000 is 3000, the word at 3000 is 7, so R0 = 7, then R1 = 2002.'),
      e('mode-4', [], 'Mode 4, autodecrement: `-(R1)`', 'R1 goes **down** by 2 (1 for bytes) **first**, then the word at the new R1. With R1 = 2002, `MOV -(R1), R0`: R1 = 2000, R0 = 3000. For stepping backwards, and for pushing: `-(SP)`.'),
      e('mode-5', [], 'Mode 5, autodecrement deferred: `@-(R1)`', 'R1 goes down by 2, then as mode 3: the word at the address found at R1. Rarely needed.'),
      e('mode-6', [], 'Mode 6, index: `X(R1)`', 'The word at R1 + X, where X is a number stored in the word after the instruction. R1 does not change. `MOV 4(R1), R0`: R0 = 33, the word at 2004. '
        + 'For fields of a record (`4(R1)` is its third word), or the other way round, a table and a register as the index: `MOV TABLE(R2), R0`.'),
      e('mode-7', [], 'Mode 7, index deferred: `@X(R1)`', 'The word at R1 + X is an address: take the word there. `MOV @0(R1), R0`: the word at 2000 is 3000, so R0 = 7.'),
    ),
    p('An **auto**increment or **auto**decrement steps by 2 for word instructions and 1 for byte instructions, except on SP and PC, which always step by 2 to stay even.'),
    h('Try them'),
    code(`
              MOV  #LIST, R1      ; R1 = the address of LIST
              MOV  (R1), R2       ; mode 1: R2 = the word R1 points at: 11
              MOV  4(R1), R3      ; mode 6: R3 = the word 4 bytes on: 33
              MOV  (R1)+, R4      ; mode 2: R4 = 11, then R1 = LIST+2
              MOV  (R1)+, R5      ; mode 2: R5 = 22, then R1 = LIST+4
              MOV  -(R1), R0      ; mode 4: R1 = LIST+2 first, then R0 = 22
              HALT
      LIST:   .WORD 11, 22, 33
    `, { run: true }),
    p('Deferred modes follow a list of addresses, for example a table of texts or of routines to call:'),
    code(`
              MOV  #PTRS, R1      ; R1 points at a list of addresses
              MOV  @(R1)+, R2     ; mode 3: R2 = the word at A: 5
              MOV  @(R1)+, R3     ; mode 3: R3 = the word at B: 6
              MOV  #PTRS, R1
              MOV  @2(R1), R4     ; mode 7: R4 = the word at the second address: 6
              HALT
      PTRS:   .WORD A, B          ; two addresses
      A:      .WORD 5
      B:      .WORD 6
    `, { run: true }),
    p('Step through them with **Step** (F10) and watch the registers in the **CPU** panel.'),
    h('On the PC'),
    p('`#`, `@#` and labels are really these modes on the PC (R7), the register that points at the instruction being read. The assembler writes them for you:'),
    table(['Write', 'Is', 'Means'], [
      ['`#n`', '`(PC)+`, mode 2', '**immediate**: the value n, stored in the word after the instruction'],
      ['`@#a`', '`@(PC)+`, mode 3', '**absolute**: the word at address a, stored after the instruction'],
      ['`LABEL`', '`X(PC)`, mode 6', '**relative**: the word at LABEL, stored as its distance from the PC, so the program works wherever it is loaded'],
      ['`@LABEL`', '`@X(PC)`, mode 7', 'relative deferred: the word whose address is at LABEL'],
    ]),
    p('The **Addressing modes tour** example shows every mode.'),
  ],
};

// ------------------------------------------------------------------ Instructions

/** The sections of the instructions, one or more groups of instructions.ts each. */
const INSTRUCTION_PAGES: Array<{ id: string; title: string; lead?: Block[]; after?: Block[] }> = [
  {
    id: 'ins-move', title: 'Moving data',
    after: [code(`
              MOV  #5, R0         ; R0 = 5
              MOV  R0, R1         ; R1 = 5
              CLR  R0             ; R0 = 0
              MOVB #'A, R2        ; R2 = 101, the code of A
              HALT
    `, { run: true })],
  },
  {
    id: 'ins-arith', title: 'Arithmetic and comparing',
    after: [code(`
              MOV  #10., R0       ; R0 = ten (12 in octal)
              ADD  #5, R0         ; fifteen: 17
              SUB  #3, R0         ; twelve: 14
              INC  R0             ; thirteen: 15
              NEG  R0             ; minus thirteen: 177763
              HALT
    `, { run: true })],
  },
  {
    id: 'ins-logic', title: 'Bits, logic and shifts',
    lead: [p('Devices pack several switches and signals into one word, a bit each. These instructions pick out, set and clear single bits. '
      + 'A **mask** is a number whose 1 bits say which bits to work on (see [bits as numbers](octal)).')],
    after: [code(`
              MOV  #123456, R0
              BIC  #177400, R0    ; clear the high byte: R0 = 000056
              BIS  #100, R0       ; set bit 6: R0 = 000156
              ASL  R0             ; times 2: R0 = 000334
              HALT
    `, { run: true })],
  },
  {
    id: 'ins-branch', title: 'Branches and loops',
    lead: [
      p('Branches are how a program decides and repeats. Compare, then branch:'),
      code(`
              MOV  A, R0
              CMP  R0, B          ; compare A with B
              BGE  1$             ; A ≥ B: keep A
              MOV  B, R0          ; else take B
      1$:     HALT                ; R0 = the larger one: 7
      A:      .WORD 3
      B:      .WORD 7
      `, { run: true }),
      p('A loop is a branch back. `SOB` counts a register down and loops until it is 0:'),
      code(`
              MOV  #5, R2         ; five times
              CLR  R0
      1$:     ADD  R2, R0         ; R0 = 5+4+3+2+1
              SOB  R2, 1$
              HALT                ; R0 = fifteen: 17
      `, { run: true }),
      h('Which branch?'),
      p('After `CMP a, b`: **signed** for numbers that can be negative, **unsigned** for addresses, counts and characters.'),
      table(['After `CMP a, b`', 'signed', 'unsigned'], [
        ['a = b', '`BEQ`', '`BEQ`'], ['a ≠ b', '`BNE`', '`BNE`'],
        ['a < b', '`BLT`', '`BLO`'], ['a ≤ b', '`BLE`', '`BLOS`'],
        ['a > b', '`BGT`', '`BHI`'], ['a ≥ b', '`BGE`', '`BHIS`'],
      ]),
    ],
  },
  { id: 'ins-jump', title: 'Jumps and subroutines' },
  { id: 'ins-trap', title: 'Trap instructions' },
  { id: 'ins-control', title: 'CPU control and flags' },
  { id: 'ins-eis', title: 'Multiply and divide (EIS)' },
  { id: 'ins-other', title: 'Less common instructions' },
];

const instructionPages: Section[] = INSTRUCTION_PAGES.map((page) => {
  const groups = OP_GROUPS.filter((g) => g.section === page.id);
  if (!groups.length) throw new Error(`help: no instructions for ${page.id}`);
  const one = groups.length === 1;
  return {
    id: page.id, title: page.title, group: INSTRUCTIONS,
    blocks: [
      ...(page.lead ?? []),
      ...groups.flatMap((g) => [...(one && !page.lead ? [] : [h(g.title)]), ...(g.intro ? [p(g.intro)] : []), entries(...g.ops.map(opEntry))]),
      ...(page.after ? [h('Example'), ...page.after] : []),
    ],
  };
});

/** `[MOV](ins-move#op-MOV)` for an instruction, wherever it is described. */
const opLink = (name: string, label = name): string => {
  const g = OP_GROUPS.find((x) => x.ops.some((op) => op.names.includes(name)));
  if (!g) throw new Error(`help: no instruction ${name}`);
  const anchor = g.ops.find((op) => op.names.includes(name))!.names[0];
  return `[${label}](${g.section}#op-${anchor})`;
};

const instructions: Section = {
  id: 'instructions', title: 'Instructions: overview', group: INSTRUCTIONS,
  blocks: [
    p('Blue-11 has more than 80 instructions, counting the byte forms, but a dozen do most of the work. Start with these:'),
    table(['To…', 'Use'], [
      ['copy a value', `${opLink('MOV')}, ${opLink('MOVB')}, ${opLink('CLR')}`],
      ['calculate', `${opLink('ADD')}, ${opLink('SUB')}, ${opLink('INC')}, ${opLink('DEC')}`],
      ['compare', `${opLink('CMP')}, ${opLink('TST')}`],
      ['decide', `${opLink('BEQ')}, ${opLink('BNE')}, ${opLink('BLT')}, ${opLink('BGE')} …`],
      ['loop', `${opLink('BR')}, ${opLink('SOB')}`],
      ['call a subroutine', `${opLink('JSR')}, ${opLink('RTS')}`],
      ['work with bits', `${opLink('BIT')}, ${opLink('BIS')}, ${opLink('BIC')}`],
      ['stop', opLink('HALT')],
    ]),
    h('Reading an entry'),
    list(
      '`src` and `dst` (source and destination) are operands in any [addressing mode](addressing); `R` must be a register.',
      'A **(B)** in the name means there is a byte form too: `MOV` copies a word, `MOVB` a byte.',
      'Beside each instruction: what it does to the [flags](registers) N Z V C. `*` set from the result, `0` / `1` cleared / set, `–` unchanged.',
    ),
    h('All instructions'),
    list(...INSTRUCTION_PAGES.map((page) => `[${page.title}](${page.id})`)),
  ],
};

// ------------------------------------------------------------------ The machine

const memory: Section = {
  id: 'memory', title: 'Memory', group: MEMREG,
  blocks: [
    p('Memory is 64 KB of bytes, each with a 16-bit **address**. A **word** is two bytes, **low byte first**, at an **even** address. '
      + 'Your program, its data, the screen and the devices all live in this one address space.'),
    table(['Addresses', 'What'], [
      ['000000–000377', 'trap and interrupt **vectors** (two words each: new PC, new PSW)'],
      [`000400–${o(RAM_END - 1)}`, 'RAM: your program, its data and the stack. Programs start at 001000.'],
      [`${o(DSP.SCREEN)}–157777`, 'the [display](display)\'s pixel memory'],
      [`${o(ROM_BASE)}–${o(ROM_BASE + ROM_SIZE - 1)}`, 'the [ROM](rom): the font and the routines that draw it. Read it freely; writing is a bus error.'],
      [`${o(DSP.DSPCS)}–176657`, 'the display\'s [registers](display-frames)'],
      [`${o(KBD.KBDCS)}–176703`, 'the [keyboard](keyboard-events)\'s registers'],
      [`${o(KBD.KBDKEY)}–177177`, 'the keyboard\'s [key map](keyboard): a byte per key'],
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
      'Byte instructions (`MOVB`, `CMPB`, `TSTB` …) reach any address. `MOVB` into a register [sign-extends](octal): byte 200–377 becomes negative.',
      'Low byte first: `MOV #1403, @#SCREEN` puts 3 in the first pixel and 3 in the second (`1403` = 3 × 400 + 3).',
    ),
  ],
};

const cycles: Section = {
  id: 'cycles', title: 'Cycles and time', group: MACHINE,
  blocks: [
    p('Time on Blue-11 is counted in **cycles**. Every trip to memory costs **1 cycle**: fetching the instruction word, each extra word (an immediate, an address, an index), each operand read and each operand write. Work inside the CPU is free.'),
    table(['Instruction', 'Cycles'], [
      ['`MOV R1, R2`', '1'],
      ['`MOV #5, R0`', '2'],
      ['`MOVB (R1)+, (R2)+`', '3'],
      ['`INC @#COUNT`', '4 (fetch, address, read, write)'],
      ['branches, `SOB`, `WAIT`, `HALT`, flag instructions', '1'],
      ['`JSR PC, X`', '3 (fetch, the word with X\'s offset, push)'],
      ['`RTS PC`', '2 (fetch, pop)'],
      ['`RTI`', '3 (fetch, pop PC, pop PSW)'],
      ['an interrupt or trap', '4 (push PSW, push PC, read the vector)'],
    ]),
    h('The budget of a frame'),
    p(`A frame is ${dec(FRAME)} cycles: 60 frames make a second of the machine's time. So a game has ${dec(FRAME)} cycles between two pictures to do everything. `
      + 'Clearing a mode 0 page with `CLR (R1)+` and `SOB` costs about 6000 cycles; drawing a character with the [ROM](rom) about 400.'),
    list(
      '**Step** shows the cycles an instruction took in the status line; the screen\'s line shows the cycle count of the run.',
      'Keep values in registers inside a loop: a register costs nothing, a variable in memory a cycle each time.',
    ),
    note('Time is cycles, never your clock: the line clock, the display\'s frames and the keyboard\'s events all count cycles. That is why a [replay](debugging) runs exactly the same.'),
  ],
};

const stack: Section = {
  id: 'stack', title: 'The stack and subroutines', group: MEMREG,
  blocks: [
    p('The **stack** is a pile of words in memory: you put a word on top (**push**) and take the top one off (**pop**). SP points at the top. '
      + 'It grows **down**, below the program: Run sets SP to the program\'s first address (001000).'),
    table(['Write', 'Does'], [
      ['`MOV R2, -(SP)`', 'push R2'],
      ['`MOV (SP)+, R2`', 'pop into R2'],
      ['`MOV 2(SP), R0`', 'read the second word on the stack without popping'],
      ['`TST (SP)+`', 'drop the top word'],
    ]),
    h('Subroutines'),
    p('A **subroutine** is a piece of code you can call from anywhere, and that goes back to where it was called from. '
      + '`JSR PC, NAME` pushes the return address and jumps; `RTS PC` pops it and goes back. '
      + 'A subroutine that uses a register keeps the caller\'s value by pushing it first and popping it before it returns, in the opposite order.'),
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
      'Write a comment above each subroutine: what it takes, what it gives back, which registers it changes.',
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
    p('A **trap** is what the CPU does when the program makes a mistake (or asks for one with a trap instruction): it pushes the PSW and PC and continues at the address in a **vector**, a pair of words in low memory.'),
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
      + 'for example *Odd address 000001 at 001004* or *MUL at 001010 needs the EIS option*. A fault stops **at** the instruction that caused it; `BPT`, `TRAP` and `IOT` stop just after theirs. '
      + 'See [When something goes wrong](problems) for the usual causes.'),
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
  ],
};

const interrupts: Section = {
  id: 'interrupts', title: 'Interrupts and WAIT', group: MACHINE,
  blocks: [
    p('A program can ask a device again and again whether it has something (**polling**). Or it can let the device **interrupt**: set the device\'s IE bit, and when it has something (a key, a blank, a clock tick) the CPU stops what it is doing, runs your **handler**, and then carries on where it was.'),
    list(
      'Each device has a **vector**: two words in low memory, the handler\'s address and the PSW to run it with. `MOV #TICK, @#100` installs the line clock\'s.',
      'The CPU pushes the PSW and PC, and loads both from the vector. The handler ends with `RTI`, which pops them back.',
      'Interrupts come between instructions.',
      'A handler must keep every register it uses (push and pop), since it can break in anywhere.',
      'The PSW\'s bits 7–5 are the CPU\'s **priority**. A device interrupts only above it: the console, display and keyboard at level 4, the line clock at 6. Handler PSW 340 (level 7) blocks every other interrupt while it runs.',
    ),
    table(['Vector', 'Device', 'Interrupts when'], [
      [o(DEV.VEC_RX, 3), '[console](console) receiver', 'a typed character is waiting in `RBUF`'],
      [o(DEV.VEC_TX, 3), 'console transmitter', 'it is ready for the next character'],
      [o(DEV.VEC_CLOCK, 3), '[line clock](clock)', 'every tick (once a frame)'],
      [o(DSP.VEC, 3), '[display](display-frames) (`DSPVEC`)', 'every vertical blank'],
      [o(KBD.VEC, 3), '[keyboard](keyboard-events) (`KBDVEC`)', 'a key event is waiting in `KBDBUF`'],
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
    p('The **Line clock**, **Echo** and **Counting Space** examples use interrupts; the [display](display-frames) interrupts at every blank, a heartbeat for a game.'),
  ],
};

// ------------------------------------------------------------------ Devices

const consoleSection: Section = {
  id: 'console', title: 'Console', group: DEVICES,
  blocks: [
    p('The console is a text terminal: it prints what the program writes, and passes on text typed on it (it is DEC\'s DL11). '
      + 'It is the **Console** panel. Click it (or the screen) and type: each character goes to `RBUF`.'),
    h('Printing'),
    p('The console prints one character at a time and needs a moment for each. So: wait until bit 7 of `XCSR` (READY) is set, then write the character to `XBUF`:'),
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
    h('Registers'),
    entries(...symbolEntries('XCSR', 'XBUF', 'RCSR', 'RBUF')),
  ],
};

const clock: Section = {
  id: 'clock', title: 'Line clock', group: DEVICES,
  blocks: [
    p(`The line clock (DEC's KW11-L) ticks once a frame, every ${dec(FRAME)} cycles: 60 times a second of the machine's time. Use it to time things: a game step, a blink, a countdown.`),
    entries(...symbolEntries('LKS')),
    list(
      'Polling: `BIC #200, @#LKS`, then wait until `TSTB @#LKS` is negative.',
      `With IE (\`MOV #100, @#LKS\`) it interrupts at vector ${o(DEV.VEC_CLOCK, 3)}, level 6, at every tick: a heartbeat that wakes a \`WAIT\`. Install the handler first. See [interrupts](interrupts).`,
      'Setting IE between two ticks does not interrupt at once: the first interrupt comes at the next tick.',
    ),
  ],
};

const display: Section = {
  id: 'display', title: 'Display: pixels', group: DEVICES,
  blocks: [
    p('The screen is memory: **a pixel is a byte** (mode 0) or half a byte (mode 1) in the 16 KB at 120000–157777. '
      + 'Write a colour number there and it shows at the next frame. There is nothing else to set up.'),
    table(['Mode', 'Pixels', 'A pixel', 'Pages at', 'Pixel (x, y) is at'], [
      ['**0**', '64 × 64 (`100` × `100`)', 'a byte', '120000, 130000, 140000, 150000', '`page + y*100 + x`'],
      ['**1**', '128 × 128 (`200` × `200`)', '4 bits, two per byte', '120000, 140000', '`page + y*100 + x/2`'],
    ]),
    p('Mode 0 is the default and the easiest. A **page** is one screenful of memory; the display shows one page while you may draw on another (see [frames and pages](display-frames)).'),
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
      'Only the low 4 bits pick the [colour](palette) (0–17). The high 4 bits are kept but not shown: a program may use them as its own marks.',
      'A word is two pixels, low byte on the left: `MOV #1403, (R1)+` paints two pixels in colour 3.',
      'At power-up memory is 0, so the screen is black.',
    ),
    h('Mode 1: two pixels per byte'),
    p('Set `MODE` in [DSPCS](display-frames#sym-DSPCS) for twice the detail. A row is still 100 bytes, so a row down is still `ADD #100`. In a byte, **even x is bits 3–0** and odd x bits 7–4. '
      + 'Change one pixel with `BICB` and `BISB`; a byte with colour c in both halves is `c*21`. The **Circle (mode 1, PLOT1)** example has a routine that plots a pixel.'),
    entries(...symbolEntries('SCREEN')),
  ],
};

const displayFrames: Section = {
  id: 'display-frames', title: 'Display: frames and pages', group: DEVICES,
  blocks: [
    p(`Every ${dec(FRAME)} cycles comes a **vertical blank**: the moment the display starts a new picture. It takes the page and the [palette](palette) as they are, adds 1 to \`DSPFRM\`, and sets DONE in \`DSPCS\`. `
      + 'A game draws once per frame by waiting for it:'),
    code(`
      ; VSYNC: wait for the next vertical blank.
      VSYNC:  BIC  #200, @#DSPCS      ; forget a blank we may already have seen
      1$:     TSTB @#DSPCS            ; DONE?
              BPL  1$                 ; not yet
              RTS  PC
    `),
    h('Double buffering'),
    p('Drawing on the page that is shown can flicker: the picture may catch half a drawing. Instead, draw on a page that is not shown, then set `PAGE` to it. '
      + 'The switch happens at the blank, never in the middle of a picture. See the **Bouncing pixel** example.'),
    h('Registers'),
    entries(...symbolEntries('DSPCS', 'DSPFRM', 'DSPLIN', 'DSPVEC')),
    table(['`DSPCS` bits', 'Name', ''], [
      ['1–0', '`PAGE`', 'the page shown, from the next vertical blank on (mode 1: 0–1)'],
      ['2', '`MODE`', '0: 64 × 64; 1: 128 × 128. From the next vertical blank on. Memory is not cleared'],
      ['6', 'IE', `interrupt at every vertical blank, vector ${o(DSP.VEC, 3)}, level 4`],
      ['7', 'DONE', 'set at every vertical blank; cleared by writing it as 0 (`BIC #200, @#DSPCS`)'],
    ]),
    h('The beam'),
    entries(e('dsp-beam', [], 'The beam (Real beam)', 'With **Real beam (tearing)** on, the display reads the rows one by one during the frame, after a blank of 2500 cycles, as a real monitor does. '
      + 'A row changed before the beam reaches it shows in this picture, a row changed after in the next: drawing on the shown page **tears**. `DSPLIN` says where the beam is. '
      + 'Changing a palette entry when the beam reaches a row colours the rest of the picture: the **Sky gradient** example races the beam.')),
  ],
};

const palette: Section = {
  id: 'palette', title: 'Display: colours', group: DEVICES,
  blocks: [
    p('A pixel holds a colour **number**, 0–17. The **palette** says which colour each number is: 16 words at `DSPPAL`, one per number.'),
    p('Each entry is three octal digits **red green blue**, each 0–7: 700 is red, 070 green, 007 blue, 777 white, 000 black. '
      + 'Change an entry and every pixel with that number changes at once: `MOV #700, @#DSPPAL` turns the black background red.'),
    entries(...symbolEntries('DSPPAL')),
    table(['Number', 'Colour', 'Value'], DEFAULT_PALETTE.map((v, i) => [o(i, 2), COLOURS[i], `\`${o(v, 3)}\``])),
    p('At power-up the palette is the one above.'),
  ],
};

const keyboard: Section = {
  id: 'keyboard', title: 'Keyboard: keys held down', group: DEVICES,
  blocks: [
    p('The keyboard is for games. It tells which keys are **down right now** (the key map, on this page), and every **press and release** in order ([the event queue](keyboard-events)). '
      + 'For typed text, use the [console](console). Click the screen first, so the keys go to the program.'),
    h('The key map'),
    p('The byte of key k is at `KBDKEY + k`: 200 while the key is down, 0 when it is up. Bit 7 is the sign of a byte, so `TSTB` then `BMI` (or `BPL`) tests it:'),
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
    entries(...symbolEntries('KBDKEY')),
    note('The key map shows what is down when it is read. A tap that starts and ends between two reads is never seen there: that is what the [event queue](keyboard-events) is for.'),
    h('Key codes'),
    p('A code names a key, a position on the keyboard, not the character it types. Letters and digits have their ASCII codes, so `\'A` is the A key and `\'7` the 7 key. The others have names:'),
    entries(...symbolEntries('K.UP', 'K.DOWN', 'K.LEFT', 'K.RGHT', 'K.SHFT', 'K.CTRL', 'K.ALT', 'K.BS', 'K.TAB', 'K.ENT', 'K.ESC', 'K.SPC', 'K.DEL')),
    p('There are codes for `\'` `,` `-` `.` `/` `;` `=` `[` `\\` `]` and the backquote too: their ASCII codes. Left and right Shift (Ctrl, Alt) are one key.'),
  ],
};

const keyboardEvents: Section = {
  id: 'keyboard-events', title: 'Keyboard: presses and releases', group: DEVICES,
  blocks: [
    p('Every press and every release goes into a queue, in order, so the program sees each one, even a tap shorter than a frame. Use it for menus, typing a name, or a jump that should happen once per press.'),
    code(`
      ; GETKEY: wait for a key press, return its code in R0. Releases are skipped.
      GETKEY: TSTB @#KBDCS                ; DONE: an event waiting?
              BPL  GETKEY
              MOVB @#KBDBUF, R0           ; take it
              BMI  GETKEY                 ; a release: not what we want
              RTS  PC
    `),
    list(
      '`MOVB @#KBDBUF, R0` sign-extends, so **a release is negative**: `BMI` branches on it, and `BIC #177600, R0` leaves only the [key code](keyboard).',
      'Reading `KBDBUF` takes the event out; if another is waiting it comes in and DONE stays set. With nothing waiting it reads 0.',
      'The queue holds 16 events. One more is lost and sets OVR (bit 15), until the program writes it as 0. The key map is always right.',
      `With IE (\`BIS #100, @#KBDCS\`) the keyboard interrupts at vector ${o(KBD.VEC, 3)}, level 4, while an event is waiting.`,
    ),
    h('Registers'),
    entries(...symbolEntries('KBDCS', 'KBDBUF', 'KBDVEC')),
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
    entries(...symbolEntries('DRAWCH', 'DRAWC1', 'FONT')),
    list(
      'Only the glyph\'s pixels are painted: the rest of the cell is left as it is. To write over old text, clear the cell first.',
      'Every other register is kept, so a loop can draw a whole text with R1 moving along.',
      'Mode 0 has 8 × 8 cells (cell (c, r) at `SCREEN + r*1000 + c*10`); mode 1 has 16 × 16 (at `SCREEN + r*1000 + c*4`).',
      'A character costs about 400 cycles: a full screen of text in mode 0 takes more than a frame. Redraw only what changed.',
      `In the font, character c is at \`FONT + c*10\` (\`${o(romSym('FONT'))} + c*10\`): 8 bytes, the top row first, bit 7 the leftmost pixel. \`'A\` (101) is at ${o(romSym('FONT') + 0o101 * 8)}.`,
      'Codes 40–176 are printable; 0–37 and 177 are blank.',
    ),
    p(`\`DRAWCH\` (${o(romSym('DRAWCH'))}) and \`DRAWC1\` (${o(romSym('DRAWC1'))}) are a jump table: each is a \`JMP\` to the routine, so the addresses stay the same when the routines change. `
      + 'The **Hello**, **Font viewer** and **My own DRAWCH** examples use them.'),
  ],
};

// ------------------------------------------------------------------ Reference

const glossary: Section = {
  id: 'glossary', title: 'Glossary', group: REFERENCE,
  blocks: [
    p('The words this help uses, in short. Follow a link for the whole story.'),
    entries(
      e('gl-absolute', [], 'Absolute address `@#a`', 'An operand that names a fixed address: `@#DSPCS`. Used for devices. See [addressing](addressing).'),
      e('gl-address', [], 'Address', 'The number of a byte in [memory](memory), 0–177777.'),
      e('gl-ascii', [], 'ASCII', 'The standard code for characters: A is 101, a is 141, 0 is 60, a space is 40. `\'A` in a program gives the code of A.'),
      e('gl-assembler', [], 'Assembler', 'The program that turns your text into machine code. See [Writing assembly](assembler).'),
      e('gl-auto', [], 'Autoincrement, autodecrement', 'Addressing modes that move a pointer register on (`(R1)+`) or back (`-(R1)`) each time it is used. See [modes](modes#mode-2).'),
      e('gl-bit', [], 'Bit, byte, word', 'A bit is 0 or 1. A byte is 8 bits (0–377). A word is 16 bits, two bytes (0–177777). See [numbers](octal).'),
      e('gl-blank', [], 'Vertical blank', 'The moment, once a frame, when the display starts a new picture. See [frames](display-frames).'),
      e('gl-bus', [], 'Bus error', 'A trap: the program read or wrote a word at an odd address, an address where nothing is, or the ROM. See [traps](traps).'),
      e('gl-byteform', [], 'Byte form', 'The version of an instruction that works on a byte instead of a word, with a B at the end: `MOVB`, `CMPB`.'),
      e('gl-carry', [], 'Carry (C), overflow (V)', 'Flags for a result that did not fit: C as an unsigned number, V as a signed one. See [flags](registers).'),
      e('gl-cycle', [], 'Cycle', 'One trip to memory: the unit of time. See [cycles](cycles).'),
      e('gl-deferred', [], 'Deferred (indirect)', 'An operand whose value is an **address**: the CPU goes there and takes the word it finds. Written with `( )` or `@`: `(R1)`, `@(R1)+`, `@#DSPCS`. See [deferred](modes).'),
      e('gl-device', [], 'Device, device register', 'A part of the machine besides the CPU and memory: the console, clock, display, keyboard. Programs talk to it through its registers, words at fixed addresses: `@#DSPCS`.'),
      e('gl-directive', [], 'Directive', 'A line for the assembler, not the CPU, starting with a dot: `.WORD`. See [directives](directives).'),
      e('gl-double', [], 'Double buffering', 'Drawing on a page that is not shown, then showing it, so the picture never shows half a drawing. See [frames and pages](display-frames).'),
      e('gl-eis', [], 'EIS', 'The *Extended Instruction Set*: `MUL`, `DIV`, `ASH`, `ASHC`. A setting turns it on. See [multiply and divide](ins-eis).'),
      e('gl-flag', [], 'Flag', 'One of the four bits N Z V C that describe the last result. Branches test them. See [flags](registers).'),
      e('gl-frame', [], 'Frame', `${dec(FRAME)} cycles, one picture on the screen, a 60th of a second.`),
      e('gl-handler', [], 'Handler', 'The code that runs on an interrupt or a trap. It ends with `RTI`.'),
      e('gl-ie', [], 'IE, DONE, READY', 'Common bits in a device\'s status register: IE (bit 6) turns its interrupt on; DONE or READY (bit 7) says it has something, or is ready for more.'),
      e('gl-illegal', [], 'Illegal instruction', 'A trap: the CPU met a word that is not an instruction, often data it ran into by mistake. See [traps](traps).'),
      e('gl-immediate', [], 'Immediate `#n`', 'An operand that is a value written in the instruction: `MOV #5, R0`. See [addressing](addressing).'),
      e('gl-index', [], 'Index mode `X(R)`', 'The word at the address R + X: `4(R1)`, `TABLE(R2)`. See [modes](modes#mode-6).'),
      e('gl-interrupt', [], 'Interrupt', 'A device breaking in to run a handler. See [interrupts](interrupts).'),
      e('gl-jumptable', [], 'Jump table', 'A list of `JMP` instructions (or addresses) at fixed places, so callers find a routine even when it moves. The ROM\'s `DRAWCH` is one.'),
      e('gl-label', [], 'Label', 'A name for a line, and so for its address: `LOOP:`.'),
      e('gl-lc', [], 'Location counter `.`', 'The address the assembler is writing at. `. = 2000` moves it. See [Writing assembly](assembler).'),
      e('gl-lowbyte', [], 'Low byte first', 'How a word sits in memory: its low 8 bits at the even address, its high 8 bits at the next one. See [memory](memory).'),
      e('gl-machinecode', [], 'Machine code', 'The numbers the CPU actually runs. The **Listing** tab shows the words each line became.'),
      e('gl-mask', [], 'Mask', 'A number whose 1 bits pick the bits to test, set or clear: `BIT #200, R0`.'),
      e('gl-mode', [], 'Addressing mode', 'How an operand says where its value is: `R0`, `#5`, `(R1)+`, `@#DSPCS`. See [addressing](addressing) and [in detail](modes).'),
      e('gl-octal', [], 'Octal', 'Base 8. Blue-11\'s numbers are octal unless they end in a dot. See [numbers](octal).'),
      e('gl-offset', [], 'Offset', 'A distance from an address. A branch, or a label used as an operand, is stored as an offset from the PC.'),
      e('gl-operand', [], 'Operand', 'What an instruction works on: `MOV src, dst` has two, the source and the destination.'),
      e('gl-page', [], 'Page', 'One screenful of pixel memory. See [display](display).'),
      e('gl-palette', [], 'Palette', 'The table that gives each colour number its colour. See [colours](palette).'),
      e('gl-pc', [], 'PC (program counter)', 'Register R7: the address of the next instruction. See [registers](registers#reg-PC).'),
      e('gl-pointer', [], 'Pointer', 'A register or word that holds an address: it *points at* something in memory. See [pointers](addressing).'),
      e('gl-polling', [], 'Polling', 'Asking a device again and again in a loop whether it is ready, instead of waiting for an interrupt.'),
      e('gl-priority', [], 'Priority', 'Bits 7–5 of the PSW, 0–7. A device interrupts only if its level is above the CPU\'s priority. See [interrupts](interrupts).'),
      e('gl-psw', [], 'PSW (processor status word)', 'The word with the flags and the priority. See [registers](registers).'),
      e('gl-register', [], 'Register', 'A 16-bit storage place in the CPU, R0–R7. See [registers](registers). Devices have registers too: words in memory.'),
      e('gl-relative', [], 'Relative address', 'A label as an operand: `INC COUNT`. Stored as an offset from the PC, so the program works wherever it is loaded. See [modes on the PC](modes).'),
      e('gl-sign', [], 'Signed, unsigned', 'The same 16 bits read as 0 to 177777 (unsigned), or with the top bit meaning negative (signed): 177777 is 65535. or −1. See [negative numbers](octal).'),
      e('gl-signext', [], 'Sign extension', 'Copying a byte\'s top bit into the high byte when `MOVB` puts it in a register, so a negative byte stays negative: 377 becomes 177777. See [negative numbers](octal).'),
      e('gl-sp', [], 'SP (stack pointer)', 'Register R6: the address of the top of the stack. See [registers](registers#reg-SP).'),
      e('gl-stack', [], 'Stack, push, pop', 'A pile of words in memory that SP points at: push puts a word on top, pop takes the top one off. See [the stack](stack).'),
      e('gl-subroutine', [], 'Subroutine', 'Code called with `JSR PC` that returns with `RTS PC`. See [the stack](stack).'),
      e('gl-tearing', [], 'Tearing', 'Part of the screen showing the old picture and part the new, because the program drew while the beam was reading. See [the beam](display-frames#dsp-beam).'),
      e('gl-trap', [], 'Trap', 'The CPU\'s jump to a handler when something goes wrong, or on a trap instruction. See [traps](traps).'),
      e('gl-twos', [], 'Two\'s complement', 'How negative numbers are stored: invert every bit and add 1. −1 is 177777. See [negative numbers](octal).'),
      e('gl-vector', [], 'Vector', 'Two words in low memory: where a handler is, and the PSW to run it with. See [traps](traps).'),
    ),
  ],
};

const SECTIONS_NO_INDEX: Section[] = [
  start, octalSection, running, debugging, problems,
  assembler, directives,
  bigPicture, registers, memory, addressing, modes, stack,
  instructions, ...instructionPages,
  cycles, traps, interrupts,
  consoleSection, clock, display, displayFrames, palette, keyboard, keyboardEvents, rom,
];

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

export const SECTIONS: readonly Section[] = [...SECTIONS_NO_INDEX, symbolIndex(), glossary];
