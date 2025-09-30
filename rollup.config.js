// rollup.config.js
import typescript from 'rollup-plugin-typescript2';
import path from 'path';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  input: 'main.ts',
  output: {
    dir: 'dist',
    format: 'cjs',
  },
  external: ['obsidian', 'path'],
  plugins: [
    nodeResolve({ preferBuiltins: true }),
    typescript()
  ]
};

