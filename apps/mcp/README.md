# The Blue-11 MCP server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Claude Code, Claude
Desktop, any MCP client) write Blue-11 programs and run them. It runs them on the simulator's
own machine (`apps/simulator/src/sim.ts`, with the ROM, display, keyboard, console and
speaker), headless, so the agent sees what a student would see: the console output, the
registers, why the program stopped and on which line, and the screen as a picture. When a
program works, the agent gives you a link that opens it in the
[simulator](https://bluedragon-ctrl.github.io/Blue11/) in your browser, ready to run and step.

Runs are deterministic, as everything on Blue-11: time is cycles, inputs come at frames or
cycles, and the same call always gives the same result.

## Use it

From this repository, after `npm install`:

- **Claude Code:** the repository's [`.mcp.json`](../../.mcp.json) declares the server, so
  Claude Code offers it when started at the root (approve it once). Elsewhere:
  `claude mcp add blue11 -- npm run -s start --prefix /path/to/Blue11/apps/mcp`.
- **Other clients:** run `npm run -s start -w apps/mcp` at the root as a stdio server. It
  builds `dist/server.js` (one file, about a second) and starts it, so it always runs the
  sources as they are. `node apps/mcp/dist/server.js` runs a build that already exists.

Set `BLUE11_SIMULATOR_URL` to make share links point to another simulator, such as
`http://localhost:5173/` for `npm run dev -w apps/simulator`.

## The tools

| Tool | What it does |
| :--- | :--- |
| `assemble` | Errors on their lines, or the size, start and symbols; the listing if asked |
| `run` | Assemble, boot and run up to `frames` frames (60 a second of machine time). Reports the stop (HALT, a trap explained, a breakpoint, a WAIT nothing can wake, or still running), the console output, the registers, the next instructions, the screen as a PNG (and at `snapshots` frames), and a share link. `inputs` types on the console or presses keys at given frames; `breakpoints` are lines, labels or octal addresses |
| `continue` | Go on from where the last command stopped |
| `step` | One or more instructions: address, instruction, source line, the registers it changed |
| `state` | Registers, PSW, the next instructions and the stack |
| `memory` | Words, bytes, instructions or text, from an octal address, a label, a device register or a register |
| `screen` | The screen as the simulator shows it, or pixel memory as it is now |
| `share_link` | The simulator URL for a program (`#code=...`) |
| `help` | The simulator's help for students: the contents, a section as Markdown, or a lookup (`MOVB`, `DSPCS`) |
| `spec` | The specification, for exact behaviour the help leaves out: [machine](../../docs/BLUE11_MACHINE.md), [display](../../docs/BLUE11_DISPLAY.md), [keyboard](../../docs/BLUE11_KEYBOARD.md), [sound](../../docs/BLUE11_SOUND.md) and the [library's README](../../packages/blue11/README.md) (the assembler's compatibility with MACRO-11). The contents, a whole document, one section (`5.1`, `registers`), or a search |
| `examples` | The simulator's example programs, with their source |

The server also sends the client short instructions: octal numbers, the layout of a line, the
predefined names, the screen's memory, the workflow above, and when to read `help` (writing
programs) or `spec` (cycles, interrupts, the beam, sound, MACRO-11), with the documents' GitHub
links.

The documents are bundled into the server, so an agent reads the specification of the machine
it runs, whatever version that is, and needs no network. A link between them becomes a topic.

## How it is built

- `src/session.ts`: the tools without the protocol, on one `Simulator`. Tested in
  `test/session.test.ts`.
- `src/server.ts`: the tools on the MCP SDK, with their schemas (zod). Tested through the
  protocol with an in-memory transport in `test/server.test.ts`.
- `src/spec.ts`: the specification's documents (`?raw` imports), their sections and a search.
  Tested in `test/spec.test.ts`, which checks that every document and section is served.
- `src/main.ts`: stdio. `src/png.ts`: frames as PNGs (Node's zlib).

It imports the simulator's DOM-free core (`sim.ts`, `debug.ts`, `traps.ts`, `storage.ts`,
`programs.ts`, `rom.ts` and the help's `model.ts` and `sections.ts`) from source, and Vite
bundles them with the library and the SDK into `dist/server.js`. So those files stay free of
the DOM. The library itself is unchanged and is used through its public API.

Not yet: a bridge to a browser tab that is open (the agent pressing Run in your simulator).
The share link covers that for now.
