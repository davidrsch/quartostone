// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'src/client/public/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
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
    },
  }
);
