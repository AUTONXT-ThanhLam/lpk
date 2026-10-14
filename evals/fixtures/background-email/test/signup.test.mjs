import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signup } from '../src/signup.mjs';

test('signup saves the user and sends the welcome email', async () => {
  const sent = [];
  const res = await signup({ name: 'a', email: 'a@example.com' }, { sendWelcome: async (to) => { sent.push(to); } });
  assert.equal(res.status, 201);
  assert.deepEqual(sent, ['a@example.com']);
});
