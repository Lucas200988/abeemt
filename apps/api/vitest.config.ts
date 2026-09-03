import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/env.ts'],
    // Testes de API compartilham o mesmo banco; paralelismo geraria disputa
    // pelas mesmas linhas.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  // O Nest depende de metadados de decorator, que o esbuild padrão do Vitest
  // não emite. O SWC emite.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
