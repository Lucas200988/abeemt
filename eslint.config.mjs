import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.config.{js,mjs,ts}',
      'index.html',
      'packages/database/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Dinheiro e energia nunca podem virar float por descuido (ADR-0005).
      'no-loss-of-precision': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Testes precisam simular entradas inválidas de propósito.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/prisma/seed.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    /**
     * Scripts de operação (.mjs) rodam em Node puro, fora do TypeScript.
     *
     * O preset recomendado não conhece os globais do Node e acusava `process`
     * e `console` como indefinidos — mas SÓ no CI, que roda `eslint .` na
     * raiz; o lint de cada pacote olha apenas `src` e nunca via estes
     * arquivos. Foi assim que o CI ficou vermelho com o repositório verde
     * localmente (encontrado pelos e-mails de falha, 2026-07-31).
     */
    files: ['**/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  prettier,
);
