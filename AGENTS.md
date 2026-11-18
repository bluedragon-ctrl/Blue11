# Working on Blue-11 (for AI coding agents and people)

Blue-11 is a PDP-11-style 16-bit CPU, assembler, disassembler and memory-mapped devices, made
for teaching, with a simulator for students (to come). Hosts such as
[HackCode](https://github.com/bluedragon-ctrl/HackCode) use the npm package `blue11`.

## Layout

| Folder | What | Rules |
| :--- | :--- | :--- |
| `packages/blue11/` | the library, published to npm as `blue11` | [`packages/blue11/AGENTS.md`](packages/blue11/AGENTS.md): no imports from outside `src/`, no runtime dependencies, deterministic |
| `apps/simulator/` | the student simulator (not yet built: [`docs/ROADMAP.md`](docs/ROADMAP.md) step 5) | a host like any other: it uses only the library's public API |
| `docs/` | the design: [machine](docs/BLUE11_MACHINE.md), [display](docs/BLUE11_DISPLAY.md), [keyboard](docs/BLUE11_KEYBOARD.md), [roadmap](docs/ROADMAP.md) | update them when a design decision changes |

## Commands (at the root)

- `npm test`: every workspace's tests.
- `npm run typecheck`, `npm run build`: the library builds to `packages/blue11/dist/` (ESM and
  types).

CI (`.github/workflows/ci.yml`) typechecks, tests, builds, then packs the package and imports
it, on every PR and push to `main`. To release, bump `packages/blue11/package.json` and
`CHANGELOG.md`, then either push a tag `vX.Y.Z` with the same version, or run "Release to npm"
by hand on `main` (it creates the tag). `release.yml` publishes to npm (it needs the
`NPM_TOKEN` secret).

## Conventions

- Numbers shown to people are octal, as on the original machine.
- Time is CPU cycles: no `Math.random`, `Date` or wall-clock time in the library. A run is
  reproducible from (program, options, inputs with their cycles).
- The public API is a contract (semver, `CHANGELOG.md`). Changing it in a way that breaks hosts
  is a major version (a minor one before 1.0).
