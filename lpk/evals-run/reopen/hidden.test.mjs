import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newItem, hold } from './src/items.mjs';
import { recordProof } from './src/proof.mjs';

function tryProof(p, id, exit) {
  try { return recordProof(p, id, exit); } catch { return null; }
}

const plan = () => ({ items: [newItem('P1', 'x'), newItem('P2', 'y')] });

test('exit 0 marks a todo item done, a failing exit keeps it todo', () => {
  const p = plan();
  assert.equal(recordProof(p, 'P1', 1).status, 'todo');
  assert.equal(recordProof(p, 'P1', 0).status, 'done');
});

test('a failing proof puts a done item back to todo', () => {
  const p = plan();
  recordProof(p, 'P1', 0);
  assert.equal(recordProof(p, 'P1', 2).status, 'todo');
});

test('a failing proof leaves a held item held with its question', () => {
  const p = plan();
  hold(p, 'P1', 'which database?');
  tryProof(p, 'P1', 1);
  assert.equal(p.items[0].status, 'held');
  assert.equal(p.items[0].why, 'which database?');
});

test('a passing proof does not take a held item out of waiting', () => {
  const p = plan();
  hold(p, 'P1', 'which database?');
  tryProof(p, 'P1', 0);
  assert.equal(p.items[0].status, 'held');
  assert.equal(p.items[0].why, 'which database?');
});

test('only the item it was given changes', () => {
  const p = plan();
  recordProof(p, 'P1', 0);
  assert.equal(p.items[1].status, 'todo');
});

test('an unknown id is a RangeError', () => {
  assert.throws(() => recordProof(plan(), 'P9', 0), RangeError);
});
