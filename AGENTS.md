# Working on Blue-11 (for AI coding agents and people)

Blue-11 is a PDP-11-style 16-bit CPU, assembler, disassembler and memory-mapped devices, made
for teaching, with a simulator for students in the browser
([bluedragon-ctrl.github.io/Blue11](https://bluedragon-ctrl.github.io/Blue11/)). Hosts such as
[HackCode](https://github.com/bluedragon-ctrl/HackCode) use the npm package `blue11`.

## Layout

| Folder | What | Rules |
| :--- | :--- | :--- |
| `packages/blue11/` | the library, published to npm as `blue11` | [`packages/blue11/AGENTS.md`](packages/blue11/AGENTS.md): no imports from outside `src/`, no runtime dependencies, deterministic |
| `apps/simulator/` | the student simulator, a Vite page deployed to GitHub Pages: [`apps/simulator/README.md`](apps/simulator/README.md) | a host like any other: it uses only the library's public API; its core (`src/sim.ts`) has no DOM and is tested |
| `apps/mcp/` | an MCP server for AI agents: assemble, run and debug programs on the simulator's machine, see the screen, give share links: [`apps/mcp/README.md`](apps/mcp/README.md) | it imports the simulator's DOM-free core from source, so `sim.ts`, `debug.ts`, `traps.ts`, `storage.ts`, `programs.ts`, `rom.ts` and `help/model.ts`, `help/sections.ts` must stay free of the DOM |
| `docs/` | the design: [machine](docs/BLUE11_MACHINE.md), [display](docs/BLUE11_DISPLAY.md), [keyboard](docs/BLUE11_KEYBOARD.md), [sound](docs/BLUE11_SOUND.md), [roadmap](docs/ROADMAP.md) | update them when a design decision changes |

## Commands (at the root)

- `npm test`: every workspace's tests.
- `npm run typecheck`, `npm run build`: the library builds to `packages/blue11/dist/` (ESM and
  types), the simulator to `apps/simulator/dist/`, the MCP server to `apps/mcp/dist/server.js`.
- `npm run dev -w apps/simulator`: the simulator on a local dev server.
- `npm run -s start -w apps/mcp`: the MCP server on stdio (`.mcp.json` declares it for Claude
  Code).

CI (`.github/workflows/ci.yml`) typechecks, tests, builds, then packs the package and imports
it, on every PR and push to `main`; on `main` it also deploys the simulator to GitHub Pages. To release, bump `packages/blue11/package.json` and
`CHANGELOG.md`, then either push a tag `vX.Y.Z` with the same version, or run "Release to npm"
by hand on `main` (it creates the tag). `release.yml` publishes to npm (it needs the
`NPM_TOKEN` secret).

## Conventions

- Numbers shown to people are octal, as on the original machine.
- Time is CPU cycles: no `Math.random`, `Date` or wall-clock time in the library. A run is
  reproducible from (program, options, inputs with their cycles).
- The public API is a contract (semver, `CHANGELOG.md`). Changing it in a way that breaks hosts
  is a major version (a minor one before 1.0).
