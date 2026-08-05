/**
 * @file eslint.config.js
 * @description ESLint flat configuration for the EyeFlow source tree.
 *
 * @purpose
 * Defines linting rules for browser, WebExtension, and Node contexts. This file
 * protects the extension from common JavaScript mistakes without changing runtime
 * code.
 *
 * @responsibilities
 *   - Ignore generated dist/, docs, and tests during regular lint runs.
 *   - Enable recommended JavaScript checks.
 *   - Register globals used by Chrome extension APIs and Node build scripts.
 *
 * @dependents
 *   - package.json lint script.
 */
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['dist/**', 'tests/**', 'docs/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-empty': 'warn',
      'no-undef': 'error',
    },
  },
];
