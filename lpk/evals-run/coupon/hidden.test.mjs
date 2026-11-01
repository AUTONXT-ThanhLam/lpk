import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCoupon } from './src/cart.mjs';

test('percent coupon takes the discount off, rounded down in cents', () => {
  assert.equal(applyCoupon(1000, { type: 'percent', value: 10 }), 900);
  assert.equal(applyCoupon(999, { type: 'percent', value: 10 }), 900);
});

test('fixed coupon takes cents off and the total never goes below zero', () => {
  assert.equal(applyCoupon(1000, { type: 'fixed', cents: 250 }), 750);
  assert.equal(applyCoupon(1000, { type: 'fixed', cents: 5000 }), 0);
});

test('a percent outside 0..100 is a RangeError', () => {
  assert.throws(() => applyCoupon(1000, { type: 'percent', value: 101 }), RangeError);
  assert.throws(() => applyCoupon(1000, { type: 'percent', value: -1 }), RangeError);
});

test('a negative fixed coupon is a RangeError and an unknown type throws', () => {
  assert.throws(() => applyCoupon(1000, { type: 'fixed', cents: -1 }), RangeError);
  assert.throws(() => applyCoupon(1000, { type: 'bogus', value: 5 }), (e) => e instanceof RangeError || e instanceof TypeError);
});

test('non-integer money is a TypeError', () => {
  assert.throws(() => applyCoupon(10.5, { type: 'fixed', cents: 1 }), TypeError);
  assert.throws(() => applyCoupon(1000, { type: 'fixed', cents: 0.5 }), TypeError);
});

test('a fractional percent is exact to the cent or refused, never off by one', () => {
  let out;
  try { out = applyCoupon(375, { type: 'percent', value: 18.4 }); } catch (e) { assert.ok(e instanceof TypeError || e instanceof RangeError); return; }
  assert.equal(out, 306);
});
