import eslint from '@eslint/js';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['src/**/*.ts', '!src/**/*.spec.ts'];

export default tseslint.config(
  {
    ignores: [
      '.angular/**',
      'dist/**',
      'node_modules/**',
      'out-tsc/**',
      'eslint.config.mjs',
      'src/**/*.spec.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: typescriptFiles })),
  ...angular.configs.tsRecommended.map((config) => ({ ...config, files: typescriptFiles })),
  ...angular.configs.templateRecommended.map((config) => ({ ...config, files: ['src/**/*.html'] })),
  ...angular.configs.templateAccessibility.map((config) => ({
    ...config,
    files: ['src/**/*.html'],
  })),
  {
    files: typescriptFiles,
    processor: angular.processInlineTemplates,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.html'],
    rules: {
      '@angular-eslint/template/interactive-supports-focus': 'warn',
    },
  },
);
