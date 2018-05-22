import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import json from 'rollup-plugin-json';
import resolve from 'rollup-plugin-node-resolve';
import sass from 'rollup-plugin-sass';

export default {
  input: './index.es.js',
  output: {
    name: 'substance',
    format: 'es',
    file: 'lib/substance.es.js',
  },
  plugins: [
    sass(),
    json({
      preferConst: true,
      include: 'node_modules/**',
    }),
    resolve({
      preferBuiltins: true,
      extensions: ['.mjs', '.js', '.jsx', '.json']
    }),
    commonjs(),
    babel({
      exclude: 'node_modules/**' // only transpile our source code
    }),
  ]
};