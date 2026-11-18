# Changelog

The npm package `blue11` follows [semantic versioning](https://semver.org): before 1.0, a
minor version may break the API, and a patch never does. The public API is everything
exported from `blue11` and `blue11/codemirror`, plus the JSON form of saved states
(`cpu.save()`, `display.state()`, `keyboard.state()`).

## 0.5.0 (2026-11-18)

Assembler expressions are 16-bit values, as in the original assembler. Some programs assemble
to different values, so check any that relied on the old arithmetic.

- Every operator (`+ - * / & !`, unary `-`, `^C`) works on 16-bit words, so the same word gives
  the same result however it is written. Sums and products wrap at every step (`177777+2` is 1,
  `<100000+100000>/2` is 0); before, they were computed with unbounded integers and only the final
  value was checked.
- `/` is signed: `177777/2` is 0, as `<-1>/2` is (it was `077777`); `-6/4` is `177777` (−1,
  rounded towards zero).
- A number as written that doesn't fit 16 bits (`200000`, `65536.`, `^B` with 17 digits) is an
  error everywhere, also in `NAME = expr`, where it used to be a warning ("doesn't fit 16 bits:
  X = …"). A result of operators never is: `X = 100000*2` is 0, with no warning.
- `.BYTE` takes −200…377 (`177600`–`177777` are the negative bytes), and its error shows the value
  in octal.
- Branch and `SOB` offsets are computed in 16 bits, so a branch across address 0 works.

## 0.4.0 (2026-11-18)

Correctness fixes from a review of the machine and the assembler. Two changes can break a host:
a new trap cause, and `.ENABL` / `.DSABL` arguments that used to be ignored.

- `protectModes`: `HALT` outside kernel mode traps to 4 with the new `TrapCause` `'privileged'`
  instead of halting the machine, and `WAIT` does nothing, as on the /45 and /70. A host that
  switches over every `TrapCause` gets one more case.
- `stackLimit` also traps a push through `@-(SP)` (autodecrement deferred), as it already did
  for `-(SP)`, `JSR` and trap entry.
- Assembler: `.BLKW N`, `.BLKB N` or `. = A` with the symbol defined later is now an error on
  that line ("… (N is defined later)"). Before, the line took no room in pass 1, so the only
  error was "moved between passes" on a later label, or none if no label followed.
- Assembler: a register symbol (`DIR = %1`) used before its definition is an error on the line
  that uses it, not "moved between passes" on a later label.
- Assembler: `.ENABL LSB` / `.DSABL LSB` (a local-label block that ordinary labels don't end)
  and `.ENABL AMA` (relative operands assembled as `@#`) work as on the original assembler.
  `LC LCM GBL REG CRF` are still accepted and ignored; any other function, or none, is an
  error (they were all ignored before).
- Docs: `DIV` into an odd register traps to 10 (a departure, now listed), and `stackLimit` is
  in the style of the /70's `STKLIM`, not the /45's.

## 0.3.0 (2026-11-18)

- `Keyboard`: keys for games (docs/BLUE11_KEYBOARD.md). A key map at `177000` (a byte per key,
  `200` while down), and a queue of 16 press and release events at `176700` (`KBDCS`, `KBDBUF`)
  with `OVR` and an interrupt at vector `330`. The host calls `press` / `release` (live) or `at`
  (scheduled, for exact replays), and gets a `log`; `state()` / `load()`. Also `KBD`, `KEY` and
  `keyCode` (a browser `KeyboardEvent.code` to a key code).
- `SimpleMachine({ keyboard })` adds a keyboard.
- Keyboard example programs (`KEYBOARD_EXAMPLES` and `KEY_SYMBOLS` in `examples/examples.ts`, not
  part of the API).

## 0.2.0 (2026-11-18)

- `Display`: the Blue-11 framebuffer (docs/BLUE11_DISPLAY.md). Pixel memory at `120000`, registers
  at `176600`, vector `320`; modes 0 (64 × 64) and 1 (128 × 128), 16 colours from a palette, a
  frame every 20000 cycles, and an optional scanning beam (`beam: 'scan'`) that tears. Frames
  are handed to the host as colour indexes with a palette per row; `state()` / `load()`.
  Also `DSP`, `DEFAULT_PALETTE`, `rgb333to888`, `frameToRgba`.
- `Rom`: read-only memory whose contents the host loads; writes are bus errors.
- `SimpleMachine({ display })` adds a display (RAM then ends at `120000`, and the clock ticks
  once a frame).
- Display example programs (`DISPLAY_EXAMPLES` in `examples/examples.ts`, not part of the API).

## 0.1.0 (2026-11-18)

The first release. The library was built in HackCode, and moved here with its history:

- The CPU: the PDP-11 /40 model's instruction set, with EIS as an option. Cycles are counted
  per bus access (or flat), and there are traps, interrupts, `WAIT`, `protectModes`,
  `stackLimit`, and hooks (`onTrap`, `onInstruction`, `onAccess`, `onModeChange`).
- The assembler: a subset of MACRO-11, with errors and warnings as values, a listing, and a
  source line map. Also a disassembler, and the ISA tables.
- `DeviceMachine` with the `Device` interface, DEC's `DL11` console and `KW11L` line clock,
  and `SimpleMachine`.
- `blue11/codemirror`: syntax highlighting for CodeMirror 6.
