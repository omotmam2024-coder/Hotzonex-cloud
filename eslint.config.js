// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dev-dist/**',
      '**/dist-ui/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/shared/src/database.types.ts',
      'supabase/.temp/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  // Architecture guard: the MikroTik layer knows nothing about Supabase, business logic or apps.
  {
    files: ['packages/mikrotik/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@supabase/*'], message: 'packages/mikrotik must not import Supabase.' },
            { group: ['@hotzonex/*', '../../apps/*', '../../../apps/*'], message: 'packages/mikrotik must stay standalone.' },
          ],
        },
      ],
    },
  },

  // Architecture guard: the browser never touches router sockets, the service-role key, or Node APIs.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@hotzonex/mikrotik', message: 'Only @hotzonex/mikrotik/{errors,types,setup-script} are browser-safe.' },
          ],
          patterns: [
            { group: ['node:*'], message: 'Node APIs are not available in the browser.' },
            { group: ['@hotzonex/connector', '@hotzonex/connector/*'], message: 'The web app never imports the connector.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Identifier[name=/service_?role/i]',
          message: 'The Supabase service-role key must never appear in apps/web.',
        },
        {
          selector: 'Literal[value=/service_?role/i]',
          message: 'The Supabase service-role key must never appear in apps/web.',
        },
      ],
    },
  },
  {
    files: ['apps/web/test/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
  },
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser }, sourceType: 'script' },
    rules: { 'no-var': 'off' },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/scripts/**/*.{ts,js,mjs}', 'supabase/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
