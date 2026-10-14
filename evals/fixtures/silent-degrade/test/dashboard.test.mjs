import assert from 'node:assert/strict';
import { test } from 'node:test';
import { userCountLabel } from '../src/dashboard.mjs';

test('counts users', async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => [{ id: 1 }, { id: 2 }] });
  assert.equal(await userCountLabel(ok), '2 users');
});
