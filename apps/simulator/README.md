# The Blue-11 simulator

A page where students write Blue-11 assembly, run it on a machine with a screen, a keyboard
and a console, and step through it with the registers, memory and disassembly in view. It is
deployed to GitHub Pages from `main`: **[bluedragon-ctrl.github.io/Blue11](https://bluedragon-ctrl.github.io/Blue11/)**.

## What is on the page

- **The editor** (CodeMirror with the library's highlighting). Assembler errors are shown on
  their lines. Breakpoints: click left of a line number, or F9. A heat bar beside the line
  numbers shows how often each line ran. Ctrl+Enter runs, F10 steps.
- **Run, Continue, Pause, Step, Step frame, Restart.** The machine runs whole frames of 20000
  cycles. **Speed** is in frames per second of wall time (1–600; 60 is real time), never in
  cycles per frame, so a program behaves the same at every speed. **Real beam (tearing)** and
  **EIS** are settings of the machine: changing one starts the program again.
- **Screen** (the display, mode 0 or 1), **Listing** (the assembler's listing, the PC's row
  lit) and **ROM** (its listing) tabs.
- **CPU** (registers, flags, priority), **Console** (the DL11 terminal), **Disassembly**
  (click a row for a breakpoint, also in the ROM), **Memory** (an octal address, a label, a
  device name such as `DSPCS`, or a register), **Stack**, and the **Input log**.
- **Keys.** While the screen or the console has focus ("keyboard → program"), every key goes
  to the keyboard device, and a key that types a character also goes to the console
  ([keyboard spec §7.1](../../docs/BLUE11_KEYBOARD.md)). Ctrl and Cmd shortcuts stay with the
  browser. Leaving the screen releases every key.
- **Replays.** Every key and console character is logged with its cycle. **Replay** boots the
  program again and feeds the log at the same cycles, so the run happens again exactly.
  **Save** writes the program, its settings and the log to a `.replay.json` file; **Open**
  plays one.
- **Programs.** The menu has the library's examples (console, display, keyboard), the ROM's
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
| `src/editor.ts` | The editor's breakpoint, heat, error and PC decorations (as in HackCode) |
| `src/page.ts`, `index.html`, `src/style.css` | The page |

It is a host like any other: it uses the library's public API only, from the source next to
it (`vite.config.ts` points `blue11` at `packages/blue11/src`, so no build of the library is
needed first), and the examples from `packages/blue11/examples`. Wall-clock time is used only
by the page to pace frames; the simulation's time is cycles.

## Commands (here, or at the root with `-w apps/simulator`)

- `npm run dev`: a local dev server.
- `npm test`: the tests. Every example runs as the page runs it, and they check what it
  prints and the frames it draws; the ROM's routines are checked against the font for every
  character.
- `npm run build`: typecheck, then build to `dist/`.
