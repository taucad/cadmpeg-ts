import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { plugin } from './tools/eslint-plugin/index.js';

export default tseslint.config(
  {
    ignores: [
      'coverage/**',
      'dist/**',
      'node_modules/**',
      'npm/**',
      'rust/target/**',
      // The pinned upstream release; its code and prose are upstream's.
      'upstream/**',
      'src/native/**',
      'src/wasm/**',
      'tests/out/**',
    ],
  },
  eslint.configs.recommended,
  {
    files: ['**/*.{cjs,js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/browser/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.worker } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: tseslint.configs.strictTypeChecked,
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test-d.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.{cjs,js,mjs,ts,tsx}'],
    plugins: { cadmpeg: plugin },
    rules: { 'cadmpeg/jsdoc-quality': 'error' },
  },
);
