import { defineConfig } from 'vitest/config';

// Vitest's default excludes don't cover ad-hoc working-tree snapshot/scratch
// directories (e.g. scratch/, .tmp/) that accumulate during development.
// Without this, `vitest run` silently sweeps up stale copies of the test
// suite and reports failures unrelated to the real codebase.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
      '**/scratch/**',
      '**/.tmp/**',
      '**/.release/**'
    ]
  }
});
