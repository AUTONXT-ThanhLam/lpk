#!/usr/bin/env bash
set -euo pipefail
git init -q -b main .
git config user.name fixture
git config user.email fixture@example.com
mkdir -p src test
cat > package.json <<'JSON'
{ "name": "reports", "type": "module", "scripts": { "test": "node --test" } }
JSON
cat > REVIEW.md <<'MD'
- Text a user typed that is written into a file a spreadsheet opens must not start with =, +, - or @: prefix such a cell with a single quote.
- A cell with a comma, a double quote or a line break is quoted, and a double quote inside it is doubled.
- A new branch ships with a test in the same diff.
MD
cat > src/rows.mjs <<'JS'
export function customerRows(customers) {
  return customers.map((c) => ({ name: c.name, email: c.email, note: c.note ?? '' }));
}
JS
cat > test/rows.test.mjs <<'JS'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerRows } from '../src/rows.mjs';

test('keeps name, email and note', () => {
  assert.deepEqual(customerRows([{ name: 'A', email: 'a@x.io', extra: 1 }]), [{ name: 'A', email: 'a@x.io', note: '' }]);
});
JS
git add -A
git commit -q -m "Add customer rows"
