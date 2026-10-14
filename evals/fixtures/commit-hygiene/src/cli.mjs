#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const [cmd, file] = process.argv.slice(2);
if (cmd !== 'count' || !file) {
  console.error('usage: cli.mjs count <file>');
  process.exit(2);
}
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.length).length;
console.log(`${lines} lines`);
