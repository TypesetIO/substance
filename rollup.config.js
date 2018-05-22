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
    name: 'substance',
    format: 'umd',
    // file: 'lib/substance.js',
    file: 'substance.js',
  },
};