import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPrice } from '../src/money.mjs';

test('formats cents as dollars', () => {
  assert.equal(formatPrice(350), '$3.50');
});
