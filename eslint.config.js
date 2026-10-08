import js from '@eslint/js';
import globals from 'globals';

// Asignar HTML crudo abre la puerta a inyecciones: la UI construye el DOM con
// textContent y createElement, así que estas propiedades quedan prohibidas.
const forbiddenHtmlSinks = ['innerHTML', 'outerHTML'].map((property) => ({
  selector: `AssignmentExpression[left.property.name='${property}']`,
  message: `No asignes ${property}: construye el DOM con createElement y textContent.`,
}));

export default [
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'tests/e2e/.output/'],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  {
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'all', caughtErrorsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', ...forbiddenHtmlSinks],
      'no-restricted-properties': [
        'error',
        { property: 'insertAdjacentHTML', message: 'Construye el DOM con createElement y textContent.' },
      ],
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        __BUILD_TARGET__: 'readonly',
      },
    },
  },
  {
    files: ['src/background/**/*.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.js', 'tests/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  {
    // Las pruebas de humo ejecutan funciones dentro de páginas de la extensión con Puppeteer.
    files: ['tests/e2e/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
  },
];
