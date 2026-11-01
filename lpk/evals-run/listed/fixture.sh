#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.name fixture
git config user.email fixture@example.com
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "hooks", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > REVIEW.md <<'MD'
- A new branch ships with a test in the same diff.
- A hook runs after every edit and never throws: a file it cannot judge is reported as not covered.
MD
cat > src/say.mjs <<'JS'
export function say(message) {
  return { systemMessage: message };
}
JS
cat > test/say.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { say } from '../src/say.mjs';

test('wraps a message for the host', () => {
  assert.deepEqual(say('hi'), { systemMessage: 'hi' });
});
JS
git add -A
git commit -q -m "Add say"
