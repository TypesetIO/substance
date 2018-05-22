var multiEntry = require('rollup-plugin-multi-entry');

export default {
  input: [
    './collab/**/*.js',
    './model/**/*.js',
    './packages/**/*.js',
    './ui/**/*.js',
    './util/**/*.js',
  ],
  plugins: [multiEntry()],
  output: {
    format: 'cjs',
    file: 'lib/substance.js',
    format: 'cjs'
  },
};