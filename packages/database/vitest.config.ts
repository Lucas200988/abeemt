import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // As constraints são verificadas contra um banco real. Rodar em paralelo
    // faria os testes disputarem as mesmas linhas.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20000,
  },
});
