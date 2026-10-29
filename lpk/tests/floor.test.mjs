import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { floor } from '../lib/floor.mjs';

const LINES = ['app.get("/x", handler);', 'const rows = db.query(1);', 'items.map((i) => i);', 'console.log("hi");'];

function owedFor(ext) {
  const repo = mkdtempSync(join(tmpdir(), 'floor-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i'], { cwd: repo });
    writeFileSync(join(repo, `a.${ext}`), `${LINES.join('\n')}\n`);
    return floor(repo, 'HEAD');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test('a frontend file with the same lines owes every lens a .ts file owes', () => {
  const ts = owedFor('ts');
  for (const ext of ['vue', 'svelte', 'html', 'css']) {
    const web = owedFor(ext);
    for (const lens of ts.lenses) assert.ok(web.lenses.includes(lens), `${ext} does not owe ${lens}`);
    assert.equal(web.full, ts.full, `${ext} full lane differs from ts`);
  }
});
