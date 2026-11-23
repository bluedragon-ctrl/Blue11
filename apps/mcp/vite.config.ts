import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const lib = (p: string) => fileURLToPath(new URL(`../../packages/blue11/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    // The library from its source, as in the simulator: the server runs the same machine.
    alias: [{ find: /^blue11$/, replacement: lib('src/index.ts') }],
  },
  build: {
    // One file for Node, with everything in it (the simulator's core, the ROM, the MCP SDK).
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node18',
    rollupOptions: { output: { entryFileNames: 'server.js' } },
  },
  ssr: { noExternal: true },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
