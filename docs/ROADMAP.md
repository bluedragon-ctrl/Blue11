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

1. **HackCode uses the package** (in HackCode): depend on `blue11` ^0.1 and delete its
   `src/blue11/`, `tests/blue11/` and `src/simulator/`. **Done when:** HackCode's tests and build
   pass unchanged.
2. **The display in the library:** the `Display` device as in the spec, with both beams, and a
   general `Rom` device (HackCode's, made general). Also their tests (spec §10), a README
   section, the departure listed, and a minor version.
3. **The keyboard in the library:** the same steps, from the keyboard spec.
4. **The simulator** (`apps/simulator`, deployed to GitHub Pages):
   - Editing: CodeMirror with the library's highlighting, and assembler errors shown inline.
   - Debugging: registers and flags, memory and disassembly, breakpoints, step / run / pause.
   - Devices: the console, the display on a canvas, and the keyboard.
   - Speed: a slider in frames per second of wall time (never cycles per frame), and a "Real
     beam (tearing)" switch.
   - The ROM, with the font, `DRAWCH` and `DRAWC1` (display spec §11), and its listing shown.
   - Programs: the examples, programs saved in `localStorage` and shared by URL, and an input
     log for replays.

   **Done when:** every example program runs in the page, and the tests check the frames it
   draws.
5. **Later, if wanted:** a third display mode (such as 128 × 128 at 1 bpp), a mouse, more keys,
   and a shared UI package for the debugger panels HackCode and the simulator have in common
   (extracted only once both exist).
