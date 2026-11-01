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
- Money is integer cents.
- A function that acts on an order checks that the caller owns it and throws ForbiddenError when not.
- A call that moves money is safe to repeat: the second call never pays twice.
- A new branch ships with a test in the same diff.
MD
cat > src/errors.mjs <<'JS'
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}
export class NotFoundError extends Error {}
JS
cat > src/store.mjs <<'JS'
const orders = new Map();
export const refunds = [];

export function saveOrder(order) {
  orders.set(order.id, order);
  return order;
}

export function getOrder(id) {
  return orders.get(id) ?? null;
}

export function refund(orderId, cents) {
  refunds.push({ orderId, cents });
}
JS
cat > src/orders.mjs <<'JS'
import { NotFoundError } from './errors.mjs';
import { getOrder, saveOrder } from './store.mjs';

let next = 1;

export function createOrder(userId, items) {
  const totalCents = items.reduce((sum, i) => sum + i.cents * i.qty, 0);
  return saveOrder({ id: `o${next++}`, userId, items, totalCents, status: 'paid' });
}

export function shipOrder(orderId) {
  const order = getOrder(orderId);
  if (!order) throw new NotFoundError(`order ${orderId} not found`);
  order.status = 'shipped';
  return order;
}
JS
cat > test/orders.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, shipOrder } from '../src/orders.mjs';

test('creates a paid order with its total', () => {
  const o = createOrder('u1', [{ cents: 250, qty: 2 }]);
  assert.equal(o.totalCents, 500);
  assert.equal(o.status, 'paid');
});

test('ships an order', () => {
  const o = createOrder('u1', [{ cents: 100, qty: 1 }]);
  assert.equal(shipOrder(o.id).status, 'shipped');
});
JS
git add -A
git commit -q -m "Add orders"
