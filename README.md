# Blue-11

A small, honest computer for learning how computers work: a PDP-11-style 16-bit CPU with its
assembler (a subset of MACRO-11), a disassembler and memory-mapped devices, written in
TypeScript. It is deterministic, integer-only and has no dependencies. Programs and numbers are
in octal, as on the original machine.

```sh
npm install blue11
```

```ts
import { assemble, SimpleMachine } from 'blue11';

const m = new SimpleMachine();
m.boot(assemble(`
        MOV #MSG, R1
1$:     MOVB (R1)+, R0
        BEQ 2$
3$:     TSTB @#177564       ; console ready?
        BPL 3$
        MOVB R0, @#177566   ; print the character
        BR 1$
2$:     HALT
MSG:    .ASCIZ /HELLO/
`));
m.run(10_000);
console.log(m.output);      // HELLO
```

- **The library:** [`packages/blue11`](packages/blue11/README.md), with its API reference,
  recipes and pitfalls.
- **The design:** [the machine](docs/BLUE11_MACHINE.md), and the next devices: [a
  display](docs/BLUE11_DISPLAY.md) and [a keyboard](docs/BLUE11_KEYBOARD.md).
- **What comes next:** [`docs/ROADMAP.md`](docs/ROADMAP.md), including a simulator in the
  browser where students write programs that draw and read the keyboard.
- **Used by:** [HackCode](https://github.com/bluedragon-ctrl/HackCode), a game where you program
  a robot in Blue-11 assembly.

"PDP-11" and "MACRO-11" name the original machine and assembler, whose design Blue-11
follows. Blue-11 is not affiliated with DEC or its successors.

MIT licence.
