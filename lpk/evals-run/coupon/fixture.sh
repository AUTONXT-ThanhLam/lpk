#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.name fixture
git config user.email fixture@example.com
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "shop", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > REVIEW.md <<'MD'
- Money is integer cents; a function that takes money rejects a non-integer with a TypeError.
- A value outside its allowed range is rejected with a RangeError, never clamped silently.
- A new branch ships with a test in the same diff.
MD
cat > src/cart.mjs <<'JS'
export function total(items) {
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  return items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.cents) || !Number.isSafeInteger(item.qty)) throw new TypeError('cents and qty must be integers');
    if (item.cents < 0 || item.qty < 0) throw new RangeError('cents and qty must not be negative');
    return sum + item.cents * item.qty;
  }, 0);
}
JS
cat > test/cart.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/cart.mjs';

test('sums cents times quantity', () => {
  assert.equal(total([{ cents: 250, qty: 2 }, { cents: 100, qty: 1 }]), 600);
});

test('refuses a non-integer amount', () => {
  assert.throws(() => total([{ cents: 1.5, qty: 1 }]), TypeError);
});
JS
git add -A
git commit -q -m "Add cart total"
