import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/slug.mjs';

test('slugifies ascii titles', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
});
