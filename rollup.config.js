import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import resolve from 'rollup-plugin-node-resolve';
import sass from 'rollup-plugin-sass';
import builtins from 'rollup-plugin-node-builtins';

export default {
  input: './index.es.js',
  output: {
    name: 'substance',
    format: 'cjs',
    file: 'lib/substance.js',
  },
  plugins: [
    builtins(),
    sass(),
    json({
      preferConst: true,
      include: 'node_modules/**',
    }),
    resolve({
      preferBuiltins: false,
      extensions: ['.mjs', '.js', '.jsx', '.json']
    }),
    commonjs(),
    babel({
      exclude: 'node_modules/**' // only transpile our source code
    }),
  ]
};