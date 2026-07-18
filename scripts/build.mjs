#!/usr/bin/env node
import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['main.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  external: ['obsidian'],
  sourcemap: false,
  minify: false,
  logLevel: 'info',
});
