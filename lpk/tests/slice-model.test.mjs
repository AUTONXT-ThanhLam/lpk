import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceModel } from '../lib/cmd/code-review.mjs';

const ROUTED = { LPK_ROUTER_URL: 'http://127.0.0.1:18766', ANTHROPIC_BASE_URL: 'http://127.0.0.1:18766' };

function home(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'lpk-slice-model-'));
  if (mode) {
    mkdirSync(join(dir, '.config', 'lpk'), { recursive: true });
    writeFileSync(join(dir, '.config', 'lpk', 'deepseek.mode'), mode);
  }
  return dir;
}

test('the self-review runs on DeepSeek only in a routed session with DeepSeek roles on', () => {
  const on = home('on\n'), off = home('off\n'), none = home();
  try {
    assert.equal(sliceModel(ROUTED, on), 'deepseek-flash');
    assert.equal(sliceModel(ROUTED, off), 'sonnet');
    assert.equal(sliceModel(ROUTED, none), 'sonnet');
    assert.equal(sliceModel({}, on), 'sonnet');
    assert.equal(sliceModel({ ...ROUTED, ANTHROPIC_BASE_URL: 'http://127.0.0.1:4141' }, on), 'sonnet');
  } finally {
    for (const d of [on, off, none]) rmSync(d, { recursive: true });
  }
});
