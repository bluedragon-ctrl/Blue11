# The Blue-11 simulator

A page where students write Blue-11 assembly, run it on a machine with a screen, a keyboard
and a console, and step through it with the registers, memory and disassembly in view. It is
deployed to GitHub Pages from `main`: **[bluedragon-ctrl.github.io/Blue11](https://bluedragon-ctrl.github.io/Blue11/)**.

## What is on the page

- **The editor** (CodeMirror with the library's highlighting). Assembler errors are shown on
  their lines. Breakpoints: click left of a line number, or F9. A heat bar beside the line
  numbers shows how often each line ran. Ctrl+Enter runs, F10 steps.
- **Run, Continue, Pause, Step, Step frame, Restart.** The machine runs whole frames of 20000
  cycles. **Speed** is shown against real time (1/60 of real time to 10×; real time is 60 frames,
  ticks of the line clock, per second of wall time), never in cycles per frame, so a program behaves the same at every speed. **Real beam (tearing)** and
  **EIS** are settings of the machine: changing one starts the program again. Step on a `WAIT`
  sleeps to the next interrupt and stops in its handler (at most a frame).
- **Screen** (the display, mode 0 or 1), **Listing** (the assembler's listing, the PC's row
  lit) and **ROM** (its listing) tabs.
- **The screen after the end.** While a program runs, the screen shows the frames the display
  latches. Once it has ended (`HALT`, a trap with no handler, a double fault, a `WAIT` nothing
  can wake), it shows pixel memory as it is, in the page and mode `DSPCS` selects
  (`Simulator.screenNow`), as a real monitor goes on refreshing while the CPU is halted.
  Otherwise a program that halts within its first frame would leave the screen black.
- **Console** (the DL11 terminal), below the tabs, so it stays in view with each of them.
- **Sound** (on unless turned off, with its volume, kept in the browser): the speaker
  (`SNDCS`, `SNDDIV`, [sound spec](../../docs/BLUE11_SOUND.md)) played with Web Audio. It plays
  only at real time (60 frames/s), and is silent at other speeds, while paused and while
  stepping, so a note is never heard at the wrong pitch. The **Sound** tab draws the speaker over
  the last frame against a ruler in cycles, with the last half period it measured. A program
  that prints BEL (7) on the console rings a bell. The edges become samples in `src/audio.ts`
  (no DOM, tested); `src/speaker.ts` queues them a little ahead of the audio clock.
- **Retro** (on unless turned off, kept in the browser): the machine's own views in the look of
  the period. The screen is a CRT in its bezel, with one faint scanline per row the display
  draws; the Listing and ROM are printed on green-bar fan-fold paper; the console is an amber
  terminal. Nothing moves or blurs a pixel or a character, and the editor and the debugger
  stay as they are.
- **The beam.** Stopped in the middle of a frame, a marker beside the screen shows the row the
  beam reads next (`DSPLIN`), and the line under the screen says it.
- **CPU** (registers, flags, priority), **Disassembly**
  (click a row for a breakpoint, also in the ROM), **Memory** (an octal address, a label, a
  device name such as `DSPCS`, or a register), **Stack**, and the **Input log**. The **Memory**
  tab shows 1000 bytes at a time as words, bytes or instructions, and what each word is
  (instruction, operand, data, stack, with its label and line), the PC and SP, and what the
  last command changed, under a map of all 64 KB (a dot per word, coloured the same way, with
  the heat: point at it to see a word, click it to show it in the rows). Pointing at the
  screen tells a pixel's address (`12YYXX`, and the half of the byte in mode 1); Shift+click
  opens the Memory tab at it. **reads/writes** counts each word's reads and writes (the map
  shows them), and **Stop when written** on a word stops the run after the instruction that
  writes it. The CPU's access hook is installed only while either is used.
- **Numbers explained.** Resting the mouse on a number in the editor (`177777`, `10.`, `^B101`,
  `'A`, `"HI`, `-1`) or on a label or symbol of the assembled program shows it in octal, decimal
  (and signed), hex, binary grouped by octal digit, and its two bytes or its character; a number
  the assembler would refuse (`19`, `200000`) says why. Pointing at a register, the PSW (bit by
  bit), a stack word or a word in the Memory tab says the same. The parser (`numberAt` in
  `src/debug.ts`) is tested against the assembler.
- **Keys.** While the screen or the console has focus ("keyboard → program"), every key goes
  to the keyboard device, and a key that types a character also goes to the console
  ([keyboard spec §7.1](../../docs/BLUE11_KEYBOARD.md)). Ctrl and Cmd shortcuts stay with the
  browser. Leaving the screen releases every key.
- **Replays.** Every key and console character is logged with its cycle. **Replay** boots the
  program again and feeds the log at the same cycles, so the run happens again exactly.
  **Save** writes the program, its settings and the log to a `.replay.json` file; **Open**
  plays one.
- **Help** (the button, or F1): short pages for students, read in order with Previous / Next
  links: getting started (a first program, octal numbers, running, debugging, the usual
  mistakes), the assembler and its directives, registers, addressing modes, the instructions
  (an overview, then a page per group, with examples), the machine (memory, cycles, the stack,
  traps, interrupts), the devices (console, line clock, display, keyboard), the ROM's
  routines, every predefined name and a glossary, with a search. **F1 in the editor**
  opens it at the word under the cursor (an instruction, a register, a directive, a device
  name), and resting the mouse on one shows its entry in a tooltip. It is HackCode's help
  (`src/ui/help/` there), ported with the simulator's own text.
- **Programs.** The menu starts with **First steps** (`src/first-steps.ts`), eight short
  programs for beginners, each adding one idea (a pixel, registers, variables, a loop, a
  decision, printing, a subroutine, a key-driven dot); a fresh page opens the first. Then the
  library's examples (console, display, keyboard), the ROM's
  showcase, and **My programs**, saved in this browser (`localStorage`). The editor's text is
  kept between visits. **Share** copies a link with the program and its settings in the URL
  (`#code=…`), not the input.

## The ROM

`src/rom.mac`, at `160000`–`167777`, is assembled when the page loads: an 8 × 8 font
(`src/font.ts`, drawn for Blue-11) and two routines that draw it, `DRAWCH` (mode 0) and
`DRAWC1` (mode 1), behind a jump table ([display spec §11](../../docs/BLUE11_DISPLAY.md)).
Programs can use `DRAWCH`, `DRAWC1` and `FONT` without defining them, like the device names
(`SCREEN`, `DSPCS`, `KBDKEY`, `K.UP`…). A character costs about 380 cycles in mode 0 and 450
in mode 1.

## Code

| File | What |
| :--- | :--- |
| `src/sim.ts` | The machine and its commands, without the DOM: load, run a frame, step, breakpoints, input and its log, replays, recordings |
| `src/rom.ts`, `src/rom.mac`, `src/font.ts` | The ROM: its source, the font's pictures, and the symbols programs get |
| `src/programs.ts` | The examples menu, and the ROM showcase programs |
| `src/debug.ts`, `src/traps.ts` | The debugger's views (disassembly, memory, stack, registers) and what a trap means, as text |
| `src/storage.ts` | Saved programs and share links |
| `src/help/` | The help: its text (`sections.ts`, `instructions.ts`, `symbols.ts`), the search and F1 lookup (`model.ts`, no DOM), the dialog and the editor's tooltips |
| `src/editor.ts` | The editor's breakpoint, heat, error and PC decorations (as in HackCode) |
| `src/number-tip.ts` | The editor's tooltip for numbers and the program's names |
| `src/page.ts`, `index.html`, `src/style.css` | The page |

It is a host like any other: it uses the library's public API only, from the source next to
it (`vite.config.ts` points `blue11` at `packages/blue11/src`, so no build of the library is
needed first), and the examples from `packages/blue11/examples`. Wall-clock time is used only
by the page to pace frames; the simulation's time is cycles.

## Commands (here, or at the root with `-w apps/simulator`)

- `npm run dev`: a local dev server.
- `npm test`: the tests. Every example runs as the page runs it, and they check what it
  prints and the frames it draws; the ROM's routines are checked against the font for every
  character. The help describes every instruction and predefined name exactly once, its links
  resolve, its examples assemble, and the ones marked to run do, with the results it promises.
- `npm run build`: typecheck, then build to `dist/`.
