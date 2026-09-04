import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  // Relative asset URLs so the same build works at a loopback root ('/'),
  // and under any project subpath a published export is hosted at (e.g.
  // https://user.github.io/<project>/). A root-absolute '/assets/...' URL
  // 404s under a subpath.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
