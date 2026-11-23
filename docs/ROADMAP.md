# Blue-11 — Roadmap

Next steps, in order. Each step is one PR with tests first. The library's rules are in
[`packages/blue11/AGENTS.md`](../packages/blue11/AGENTS.md). Every new device is listed in the
README as a departure from the original machine.

**Done:**

- **The machine:** the CPU, assembler, disassembler, the device bus, DEC's console (DL11) and
  line clock (KW11-L). They were built in HackCode. Design: [`BLUE11_MACHINE.md`](BLUE11_MACHINE.md).
- **Device specs**, all decided on 2026-11-18 (the sound's in step 10):
  - The display, [`BLUE11_DISPLAY.md`](BLUE11_DISPLAY.md). Mode 0 is 64 × 64 with a byte per
    pixel; mode 1 is 128 × 128 with 4 bits per pixel. It has 16 colours from an RGB 3-3-3
    palette, a vertical-blank flag and interrupt, and an optional scanning beam that tears.
    The simulator's ROM holds an 8 × 8 font and the routines that draw it.
  - The keyboard, [`BLUE11_KEYBOARD.md`](BLUE11_KEYBOARD.md). It has key codes, a key map with
    one byte per key, and a queue of 16 events with an interrupt. Replays are exact.
- **Its own repository** (2026-11-18). The library moved out of HackCode with its history, as
  npm workspaces, with a build to ESM plus types, an MIT licence, CI, and publishing to npm.
- **`blue11` 0.1.0 on npm** (2026-11-18), published from CI with provenance.
- **An MCP server** (2026-11-23, [`apps/mcp`](../apps/mcp/README.md)): an agent assembles,
  runs (with console and key input at frames, breakpoints, screen snapshots), steps and reads
  memory on the simulator's machine, sees the screen as a PNG, reads the help and examples, and
  gives share links. Next, if wanted: publish it to npm (`npx blue11-mcp`), and a bridge to an
  open simulator tab.

1. ~~**HackCode uses the package**~~ (done, 2026-11-18, in HackCode): it depends on `blue11`
   ^0.1.0; its copies of the library, tests, examples and docs are deleted, and its 309 tests and
   build pass unchanged.
2. ~~**The display in the library**~~ (done, 2026-11-18, `blue11` 0.2.0): the `Display` device
   as in the spec, with both beams, a general `Rom` device, `SimpleMachine({ display })`, their
   tests (spec §10) and six display examples, a README section, and the departure listed. Left
   for HackCode: replace its own `Rom` with the library's once it uses 0.2.0.
3. ~~**The keyboard in the library**~~ (done, 2026-11-18, `blue11` 0.3.0): the `Keyboard` device
   as in the spec, with live and scheduled input and an exact replay log, `keyCode`,
   `SimpleMachine({ keyboard })`, their tests (spec §10) and four keyboard examples, a README
   section, and the departure listed.
4. ~~**The simulator**~~ (done, 2026-11-18, `apps/simulator`, deployed to GitHub Pages from
   `main`): the editor with the library's highlighting, errors on their lines, breakpoints and
   a heat bar; registers, flags, memory, stack, disassembly and the listing; Run / Continue /
   Pause / Step / Step frame; the screen on a canvas, the keyboard and the console; speed in
   frames per second of wall time and a "Real beam (tearing)" switch, plus EIS; the ROM
   (`rom.mac`: an 8 × 8 font drawn for Blue-11, `DRAWCH`, `DRAWC1`) with its listing and three
   showcase programs; the examples, programs saved in `localStorage`, share links, and an input
   log with exact replays, saved to and opened from files. Every example runs in its tests as
   the page runs it, and they check the frames it draws.
5. ~~**Help in the simulator**~~ (done, 2026-11-18, `apps/simulator/src/help/`): HackCode's
   help ported (the model, dialog and tooltips) with the simulator's own text: getting started,
   the controls, the assembler, registers, addressing modes, every instruction, memory, cycles,
   the stack, traps, interrupts, the console, line clock, display, keyboard and ROM, and an
   index of the predefined names. A search, F1 on the word under the cursor, and hover
   tooltips in the editor. Its tests check that every instruction and name is described once,
   that links resolve, and that the examples assemble and run. Then made more approachable:
   short pages (instructions a page per group, the display and keyboard split, running and
   debugging apart), a first-program walk-through, octal numbers, the usual mistakes, a
   glossary, more small examples whose results are tested, and Previous / Next links.
6. **Review fixes** (`blue11` 0.4.0, 2026-11-18): a review of the CPU, the assembler and the
   devices found these, each now with a test:
   - ~~`HALT` in user mode stopped the machine under `protectModes`~~: it traps to 4
     (`'privileged'`), and `WAIT` does nothing, as on the /45.
   - ~~`@-(SP)` passed `stackLimit`~~.
   - ~~`.BLKW N` / `. = A` with a later symbol, and a register symbol used before its
     definition, were reported as "moved between passes" on another line~~: errors on their own
     line.
   - ~~`.ENABL` / `.DSABL` were all ignored~~: `LSB` and `AMA` work, unsupported functions are
     errors.
   - ~~Undocumented: `DIV` into an odd register traps to 10~~; `STKLIM` is the /70's.
7. ~~**Expressions are 16-bit values**~~ (done, 2026-11-18, `blue11` 0.5.0): every operator
   wraps to 16 bits, as on the original assembler, and `/` is signed (`177777/2` and `<-1>/2` are
   both 0). Only a number as written can fail to fit (an error, also in `NAME = expr`); `.BYTE`
   takes −200…377, and branches across address 0 work.
8. ~~**Loading honestly.**~~ (done, 2026-11-18, `blue11` 0.6.0): `boot` returns `notLoaded`, the
   ranges outside RAM with their source lines, and `notLoaded(asm)` gives them without booting.
   The simulator shows each one as an error on its line and loads nothing.
9. ~~**Stepping through `WAIT`.**~~ (done, 2026-11-18, `blue11` 0.7.0): a step on a sleeping
   CPU advances the devices to the next event that can wake it (at most `maxCycles`), as `run`
   does, and takes the interrupt.
10. ~~**Sound: a one-bit speaker**~~ (done, 2026-11-18, `blue11` 0.8.0,
    [`BLUE11_SOUND.md`](BLUE11_SOUND.md)): the `Sound` device (a beeper bit and a tone
    generator, edges recorded at the cycle of each write through the new `DeviceMachine.now`),
    its tests and four examples, a README section and the departure listed; in the simulator,
    the speaker played with Web Audio (true pitch at real time, like a tape at other speeds), volume and mute, a Sound tab with the
    last frame's waveform, the console's bell, and a help page.
11. **Assembler messages for sizes.** Name the symbol and its line whenever a size depends on
    a later definition (the 0.4.0 fixes cover `.BLKW`, `. =` and register symbols; check every
    other place where pass 1 and pass 2 can disagree, and make "moved between passes" a
    message that should never be seen).
12. **A memory explorer in the simulator** (only the simulator; the library's public API is
    enough). The side panel shows 32 words, so the address space as a whole (vectors, code,
    data, stack, pixels, ROM, devices) is only in the docs. In four steps, one PR each:
    1. ~~A **Memory** tab~~ (done, 2026-11-19): 1000₈ bytes at a time, read as words, bytes
       or instructions, with an ASCII column. Each word is marked by what the assembler made it (an instruction's first
       word, an operand, data) or the stack, with its label and source line; the PC, SP and the
       words the last command changed are highlighted; quick jumps to each region. Registers
       whose read takes a character (`RBUF`, `KBDBUF`) are never read by the debugger (the
       side panel used to read them, and took the character). The stack starts at the highest
       SP since the boot, so a program that sets SP itself (`MOV #STK, SP`) shows its stack (it
       was a guess: the origin, or `1000`).
    2. ~~A **map of the whole 64 KB**~~ (done, 2026-11-19): above the rows, a dot per word,
       1000₈ bytes a row, coloured by role or region (dim for 0, black where nothing answers),
       red for what the last command changed, whiter the more often a word ran; squares for the
       PC and SP and a frame for the rows shown. Pointing tells what is there; a click shows it
       in the rows. About 1.5 ms per animation frame while running.
    3. ~~**Pixels and addresses**~~ (done, 2026-11-19): pointing at a pixel on the screen shows
       its coordinates, its byte (`12YYXX`; in mode 1 which half) and its colour, and the
       colour in memory if it is not shown yet. **Shift**+click opens the tab at that byte in
       bytes, the byte (and half) explained: a plain click still gives the keys to the
       program. In the tab, a word of pixel memory says which pixels it holds, on which page.
    4. ~~**Accesses and watchpoints**~~ (done, 2026-11-19): **reads/writes** counts each word's
       reads and writes (fetches left out; the map shows them, blue and orange) and **Stop when
       written** on a word stops the run after the instruction that writes it, saying what it
       wrote. Through `onAccess`, installed only while either is used: measured on a loop that
       only touches memory, 0.38 ms a frame without it and 0.43–0.52 ms with it (none when off).
       The hook stops the run by setting `halted`, so the library needed nothing new; a write
       by an interrupt's push stops after the handler's first instruction, and says so.
13. **Tools for numbers and characters in the simulator** (only the simulator). Students
    convert between octal, decimal and binary, and look up character codes, all the time. Not a
    general calculator: everything uses the assembler's own rules (16-bit wrap, signed `/`,
    `10.`, `'A`), so a tool never disagrees with the code. Octal first, hex last. One PR each:
    1. ~~**Numbers explain themselves**~~ (done, 2026-11-19): resting the mouse on a number or
       a program's name in the editor shows octal, decimal and signed, hex, binary grouped by
       octal digit (`1 111 111 111 111 111`), and the bytes or the character; a number the
       assembler refuses says why. The registers, the PSW (bit by bit), the stack and the
       Memory tab say the same. Tested against the assembler.
    2. **A Chars tab**, beside Screen, Listing, ROM and Sound (not in the help, which is a
       dialog): the font's real glyphs in a 16 × 8 grid with octal codes. A click shows the
       codes in octal, decimal and hex, the glyph's 8 bytes in binary beside its picture at
       `FONT+c*10`, **Show in memory** (the Memory tab at those bytes) and **Insert** (`'A` or
       `101` into the editor). Codes 0–37 by name (BEL, BS, LF, CR), and a note that key codes
       (`K.UP`…) are not ASCII.
    3. **An expression box** in the same tab: `<DSPCS+2>`, `-1`, `100./3`, `'A+1`, with the
       program's labels, shown in every base. Evaluated by the assembler itself (the program
       plus `.WORD <expr>`), so the public API needs nothing new.
14. **Conditional assembly and repetition:** `.IF` / `.IFF` / `.IFT` / `.ENDC` with `EQ NE GT
    LT GE LE DF NDF`, `.IIF`, and `.REPT` / `.ENDR`. Small, self-contained, and they let the
    ROM and the examples drop copy-pasted tables.
15. **Macros:** `.MACRO` / `.ENDM` with arguments, default values and `.NARG`, then `.IRP` /
    `.IRPC`. The largest gap from the original assembler; listings show expansions as the
    original does. Needs a design note in `BLUE11_MACHINE.md` §3 first (what of `.MCALL` the
    predefined symbols replace).
16. **More of the /40 and its successors' instructions**, each as an option like `eis`: `SPL`
    and `MTPS` / `MFPS` (a priority change that works under `protectModes`), and `MARK`.
17. **`.INCLUDE`** through a host callback (`options.include(name) → source`), so the
    simulator's ROM routines and a host's library can be shared without pasting. The library
    stays free of file I/O.
18. **A differential test against SIMH:** random instruction sequences, compared register by
    register and flag by flag with traces from SIMH's /40 model (with EIS), checked in as
    fixtures. It pins down the corners: `ASH` / `ASHC` overflow, `DIV` overflow, `SBC` / `ADC`
    flags, the order of side effects in `JSR R, @(R)+` and `MOV R, (R)+`.
19. **Documented restart rules for hosts:** when `onTrap` stops on a fault, the PC is set back
    but autoincrement and autodecrement have already happened. Say so in the README, and
    consider an option to undo them (the /45's `SSR1` records exactly this).
20. **Later, if wanted:** a third display mode (such as 128 × 128 at 1 bpp), a mouse, more keys,
   and a shared UI package for the debugger panels HackCode and the simulator have in common
   (extracted only once both exist).
