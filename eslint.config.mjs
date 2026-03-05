// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'src/client/public/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  // Extra quality rules scoped to src/ only (tests may use console legitimately)
  {
    files: ['src/**/*.ts'],
    rules: {
      // Q06: promote to 'error' deferred — too many exported functions lack return-type
      // annotations; changing to 'error' would fail CI until all are annotated.
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Q41: surface unhandled floating promises (fire-and-forget should use `void`)
      '@typescript-eslint/no-floating-promises': 'warn',
      // Q42: enforce `import type` for type-only imports
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      // Downgraded: async event handlers (addEventListener) legitimately return Promise<void>
      // across ~47 call sites in client UI code; can't change DOM callback signatures.
      '@typescript-eslint/no-misused-promises': 'warn',
      // Downgraded: stub methods implementing async interface contracts (e.g. visual editorUI)
      // have ~30 intentionally no-await async methods across the codebase.
      '@typescript-eslint/require-await': 'warn',
    },
  }
);
