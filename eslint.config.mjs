import eslint from '@eslint/js';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**']
  },
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    ...eslint.configs.recommended
  }
];
