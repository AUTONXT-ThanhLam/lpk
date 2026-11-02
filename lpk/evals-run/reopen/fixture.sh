#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.name fixture
git config user.email fixture@example.com
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "plans", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > REVIEW.md <<'MD'
- A new branch ships with a test in the same diff.
- A function does not change anything but the item it was given.
MD
cat > src/items.mjs <<'JS'
export function newItem(id, title) {
  return { id, title, status: 'todo', why: '' };
}

export function hold(plan, id, why) {
  const item = plan.items.find((i) => i.id === id);
  if (!item) throw new RangeError(`no item ${id}`);
  if (item.status !== 'todo') throw new Error(`${id} is ${item.status}: only an open item can be held`);
  if (!String(why).trim()) throw new Error('holding an item needs the question the owner must answer');
  item.status = 'held';
  item.why = String(why).trim();
  return item;
}

export function open(plan, id) {
  const item = plan.items.find((i) => i.id === id);
  if (!item) throw new RangeError(`no item ${id}`);
  if (item.status !== 'held') throw new Error(`${id} is ${item.status}: only a held item is opened`);
  item.status = 'todo';
  item.why = '';
  return item;
}
JS
cat > test/items.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newItem, hold, open } from '../src/items.mjs';

test('a held item keeps its question until it is opened', () => {
  const plan = { items: [newItem('P1', 'x')] };
  hold(plan, 'P1', 'which database?');
  assert.equal(plan.items[0].why, 'which database?');
  open(plan, 'P1');
  assert.equal(plan.items[0].status, 'todo');
  assert.equal(plan.items[0].why, '');
});
JS
git add -A
git commit -q -m "Add plan items"
