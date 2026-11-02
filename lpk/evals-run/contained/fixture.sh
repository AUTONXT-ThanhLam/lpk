#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.name fixture
git config user.email fixture@example.com
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "uploads", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > REVIEW.md <<'MD'
- A new branch ships with a test in the same diff.
- A function that answers a yes or no question never throws on a path it cannot judge: it answers no.
MD
cat > src/names.mjs <<'JS'
export function safeName(name) {
  return String(name).replace(/[^\w.-]/g, '_');
}
JS
cat > test/names.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeName } from '../src/names.mjs';

test('replaces characters that are not word characters, dots or dashes', () => {
  assert.equal(safeName('a b/c.txt'), 'a_b_c.txt');
});
JS
git add -A
git commit -q -m "Add safe names"
