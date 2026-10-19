import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.test-build/**', 'node_modules/**'] },
  tseslint.configs.recommended,
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['node:*', '../adapters/*', '../runtime/*', '../cli/*'], message: 'Core must remain independent of I/O and composition.' }],
      }],
    },
  },
);
