# Blue-11 — Roadmap

Next steps, in order. Each step is one PR with tests first. The library's rules are in
[`packages/blue11/AGENTS.md`](../packages/blue11/AGENTS.md). Every new device is listed in the
README as a departure from the original machine.

**Done:**

- **The machine:** the CPU, assembler, disassembler, the device bus, DEC's console (DL11) and
  line clock (KW11-L). They were built in HackCode. Design: [`BLUE11_MACHINE.md`](BLUE11_MACHINE.md).
- **Two device specs**, both decided on 2026-11-18:
  - The display, [`BLUE11_DISPLAY.md`](BLUE11_DISPLAY.md). Mode 0 is 64 × 64 with a byte per
    pixel; mode 1 is 128 × 128 with 4 bits per pixel. It has 16 colours from an RGB 3-3-3
    palette, a vertical-blank flag and interrupt, and an optional scanning beam that tears.
    The simulator's ROM holds an 8 × 8 font and the routines that draw it.
  - The keyboard, [`BLUE11_KEYBOARD.md`](BLUE11_KEYBOARD.md). It has key codes, a key map with
    one byte per key, and a queue of 16 events with an interrupt. Replays are exact.
- **Its own repository** (2026-11-18). The library moved out of HackCode with its history, as
  npm workspaces, with a build to ESM plus types, an MIT licence, CI, and publishing to npm.
- **`blue11` 0.1.0 on npm** (2026-11-18), published from CI with provenance.

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
8. **Loading honestly.** `DeviceMachine.boot` drops any part of a program outside RAM without
   a word (`. = 170000` then `.WORD 1`). It should report it: a result from `boot` listing the
   ranges not loaded (the program's mistake, so a value, not a throw), shown by the simulator
   on the program's line.
9. **Stepping through `WAIT`.** `DeviceMachine.step()` returns `'wait'` with 0 cycles, so
   single-stepping a program that waits for the clock or a key stalls. A step on a sleeping
   CPU should advance the devices to the next event that can wake it (as `run` does) and
   take the interrupt.
10. **Assembler messages for sizes.** Name the symbol and its line whenever a size depends on
    a later definition (the 0.4.0 fixes cover `.BLKW`, `. =` and register symbols; check every
    other place where pass 1 and pass 2 can disagree, and make "moved between passes" a
    message that should never be seen).
11. **Conditional assembly and repetition:** `.IF` / `.IFF` / `.IFT` / `.ENDC` with `EQ NE GT
    LT GE LE DF NDF`, `.IIF`, and `.REPT` / `.ENDR`. Small, self-contained, and they let the
    ROM and the examples drop copy-pasted tables.
12. **Macros:** `.MACRO` / `.ENDM` with arguments, default values and `.NARG`, then `.IRP` /
    `.IRPC`. The largest gap from the original assembler; listings show expansions as the
    original does. Needs a design note in `BLUE11_MACHINE.md` §3 first (what of `.MCALL` the
    predefined symbols replace).
13. **More of the /40 and its successors' instructions**, each as an option like `eis`: `SPL`
    and `MTPS` / `MFPS` (a priority change that works under `protectModes`), and `MARK`.
14. **`.INCLUDE`** through a host callback (`options.include(name) → source`), so the
    simulator's ROM routines and a host's library can be shared without pasting. The library
    stays free of file I/O.
15. **A differential test against SIMH:** random instruction sequences, compared register by
    register and flag by flag with traces from SIMH's /40 model (with EIS), checked in as
    fixtures. It pins down the corners: `ASH` / `ASHC` overflow, `DIV` overflow, `SBC` / `ADC`
    flags, the order of side effects in `JSR R, @(R)+` and `MOV R, (R)+`.
16. **Documented restart rules for hosts:** when `onTrap` stops on a fault, the PC is set back
    but autoincrement and autodecrement have already happened. Say so in the README, and
    consider an option to undo them (the /45's `SSR1` records exactly this).
17. **Later, if wanted:** a third display mode (such as 128 × 128 at 1 bpp), a mouse, more keys,
   and a shared UI package for the debugger panels HackCode and the simulator have in common
   (extracted only once both exist).
