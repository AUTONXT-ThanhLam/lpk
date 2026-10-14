import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postUser } from '../src/api.mjs';

test('creating a user with an invalid email is refused', () => {
  assert.equal(postUser({ name: 'a', email: 'nope' }).status, 400);
  assert.equal(postUser({ name: 'b', email: 'b@example.com' }).status, 201);
});
