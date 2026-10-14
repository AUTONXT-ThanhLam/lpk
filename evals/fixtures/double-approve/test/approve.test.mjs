import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approve } from '../src/approve.mjs';
import { sent } from '../src/payouts.mjs';
import { insert } from '../src/store.mjs';

test('an approved request cannot be approved again', async () => {
  await insert({ id: 1, amount: 50, status: 'pending' });
  assert.equal((await approve(1)).status, 200);
  assert.equal((await approve(1)).status, 409);
  assert.equal(sent.length, 1);
});
