import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from './src/csv.mjs';

const cols = ['name', 'email', 'note'];

test('writes a header and one line per row', () => {
  assert.equal(toCsv([{ name: 'A', email: 'a@x.io', note: 'hi' }], cols), 'name,email,note\nA,a@x.io,hi');
});

test('quotes a comma, a double quote and a line break', () => {
  assert.equal(toCsv([{ name: 'A, B', email: 'e', note: 'say "hi"' }], cols), 'name,email,note\n"A, B",e,"say ""hi"""');
  assert.equal(toCsv([{ name: 'A', email: 'e', note: 'a\nb' }], cols), 'name,email,note\nA,e,"a\nb"');
});

test('a cell that starts with = + - or @ gets a single quote in front', () => {
  for (const lead of ['=', '+', '-', '@']) {
    const out = toCsv([{ name: `${lead}cmd`, email: 'e', note: '' }], cols).split('\n')[1];
    assert.equal(out, `'${lead}cmd,e,`);
  }
});

test('a formula cell that also needs quoting keeps both', () => {
  const out = toCsv([{ name: '=SUM(A1,A2)', email: 'e', note: '' }], cols).split('\n')[1];
  assert.equal(out, `"'=SUM(A1,A2)",e,`);
});

test('a missing value is an empty cell and numbers are written as is', () => {
  assert.equal(toCsv([{ name: 'A', email: undefined, note: 5 }], cols), 'name,email,note\nA,,5');
});
