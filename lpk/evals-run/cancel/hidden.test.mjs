import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrder, shipOrder, cancelOrder } from './src/orders.mjs';
import { refunds } from './src/store.mjs';
import { ForbiddenError, ConflictError } from './src/errors.mjs';

test('the owner cancels a paid order and is refunded its total once', () => {
  const o = createOrder('u1', [{ cents: 250, qty: 2 }]);
  const before = refunds.length;
  const c = cancelOrder('u1', o.id);
  assert.equal(c.status, 'cancelled');
  assert.deepEqual(refunds.slice(before), [{ orderId: o.id, cents: 500 }]);
});

test('someone else cannot cancel the order and nothing is refunded', () => {
  const o = createOrder('u1', [{ cents: 100, qty: 1 }]);
  const before = refunds.length;
  assert.throws(() => cancelOrder('u2', o.id), ForbiddenError);
  assert.equal(refunds.length, before);
  assert.equal(o.status, 'paid');
});

test('a shipped order cannot be cancelled', () => {
  const o = createOrder('u1', [{ cents: 100, qty: 1 }]);
  shipOrder(o.id);
  const before = refunds.length;
  assert.throws(() => cancelOrder('u1', o.id), ConflictError);
  assert.equal(refunds.length, before);
});

test('cancelling twice never refunds twice', () => {
  const o = createOrder('u1', [{ cents: 300, qty: 1 }]);
  const before = refunds.length;
  cancelOrder('u1', o.id);
  const again = (() => { try { return cancelOrder('u1', o.id); } catch (e) { return e; } })();
  assert.ok(again instanceof Error || again.status === 'cancelled');
  assert.equal(refunds.length - before, 1);
});

test('an unknown order is not found', () => {
  assert.throws(() => cancelOrder('u1', 'nope'), (e) => e.name === 'NotFoundError' || e.constructor.name === 'NotFoundError');
});
