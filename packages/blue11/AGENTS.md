# Working on the Blue-11 library (for AI coding agents and people)

`packages/blue11/` is a **standalone, reusable library**: CPU, assembler (a subset of the original syntax),
disassembler, device bus, published to npm as `blue11`. Its users (HackCode, the simulator) are
hosts, not owners.
User documentation: [`README.md`](README.md). Design and rationale: `../../docs/BLUE11_MACHINE.md` (§9: the library boundary); specified devices: `../../docs/BLUE11_DISPLAY.md`, `../../docs/BLUE11_KEYBOARD.md`.

## Rules (the first three are enforced by `test/boundary.test.ts`)

1. **Nothing imports from outside `src/`.** Files import only `./name.js` (the `.js` is what
   Node's ESM needs in the published build). The one
   exception is `codemirror.ts`, which may import `@codemirror/*` and `@lezer/*`; `index.ts`
   must never load it.
2. **No runtime dependencies.**
3. **Deterministic and integer-only:** no `Math.random`, `Date`, `performance.now`, timers,
   floating-point trig, DOM or `window` (except in `codemirror.ts`). Time is CPU cycles.
   The same inputs give the same run; states survive JSON.
4. **Errors in the program are values** (`assemble` returns `errors` / `warnings`, the CPU
   reports `RunResult`s and calls `onTrap`). **Mistakes by the host may throw** (a device
   overlapping another), and only at setup time, never during `run`.
5. **Nothing host-specific.** A host keeps its own memory map, ROM contents and devices
   (HackCode its robot, the simulator its font ROM). If a host needs new behaviour, add a general option or hook that
   the original machine had, or one documented as a departure (`protectModes`, `stackLimit`,
   `onTrap`, `onInstruction`), never a special case for one user.
6. **Behave like the original machine** (the /40 model, EIS optional) and **assemble like the original assembler.**
   Every departure is listed in the README ("Where it departs from the real machine",
   "Assembler compatibility"). Original features we lack are errors, never silently ignored.

## When you change something

- Tests first: they are the specification (cycle counts, flags and traps all have tests).
- `npm test` and `npm run build` (at the repository root, or here).
- The public API is a published contract (semver): a change that can break a host is a major
  version. Add a line to `CHANGELOG.md` for every change a user can notice.
- Update `README.md` with the change. Its code blocks are run by
  `test/readme-examples.test.ts`, which also fails if a README block is not in it:
  edit both together. A new compatibility claim gets a test in `test/syntax*.test.ts`.
- Export new public things from `index.ts`, and document them in the README.

## Where things are

Sources are in `src/`, tests in `test/`.

| Change | File | Tests |
| :--- | :--- | :--- |
| An instruction | `isa.ts` (name, opcode, format), `cpu.ts` (`exec`), `disassembler.ts` for a new format | `cpu.test.ts`; `assembler.test.ts` assembles and disassembles every table entry |
| Assembler syntax, directives, warnings | `assembler.ts` | `assembler.test.ts`, `syntax.test.ts` (compatibility claims), `syntax-warnings.test.ts` (implicit `.WORD`, warnings) |
| Bus, devices, time, `WAIT` | `devices.ts` (`DeviceMachine`, `DL11`, `KW11L`, `Rom`) | `devices.test.ts`, `cpu.test.ts` (interrupts) |
| The display | `display.ts` (`Display`, `frameToRgba`) | `display.test.ts` (also the `DISPLAY_EXAMPLES`) |
| The keyboard | `keyboard.ts` (`Keyboard`, `keyCode`) | `keyboard.test.ts` (also the `KEYBOARD_EXAMPLES`) |
| `SimpleMachine` | `machine.ts` | `examples.test.ts` (the programs in `examples/examples.ts`), `readme-examples.test.ts` |
| Syntax highlighting | `codemirror.ts` | – |
| Public API | `index.ts` | `boundary.test.ts` |
| Docs | `README.md` | `readme-examples.test.ts` |
