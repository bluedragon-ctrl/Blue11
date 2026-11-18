import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const lib = (p: string) => fileURLToPath(new URL(`../../packages/blue11/${p}`, import.meta.url));

export default defineConfig({
  // Relative asset paths, so the build works under https://<user>.github.io/Blue11/.
  base: './',
  resolve: {
    // The library from its source in this repository, so the page and the tests always use
    // the version next to them (no build of the library first). Its public API only.
    alias: [
      { find: /^blue11\/codemirror$/, replacement: lib('src/codemirror.ts') },
      { find: /^blue11$/, replacement: lib('src/index.ts') },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
