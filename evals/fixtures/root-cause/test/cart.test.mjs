import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartTotal } from '../src/cart.mjs';

test('sums price times quantity', () => {
  assert.equal(cartTotal([{ price: 2, qty: 3 }]), 6);
});
