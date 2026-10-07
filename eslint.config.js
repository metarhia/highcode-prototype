'use strict';

const init = require('eslint-config-metarhia');

module.exports = [
  ...init,
  {
    files: ['project.js'],
    languageOptions: {
      globals: {
        domain: 'readonly',
        infrastructure: 'readonly',
        application: 'readonly',
        presentation: 'readonly',
      },
    },
    rules: { strict: 'off' },
  },
];
