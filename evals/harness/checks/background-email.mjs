import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { expect, run } from './lib.mjs';
// Each scenario runs in a child process: an unhandled rejection there ends it with a non-zero code.
const scenario = (ws, body) => run(ws, 'node', ['--input-type=module', '-e', `import { signup } from ${JSON.stringify(pathToFileURL(join(ws, 'src/signup.mjs')).href)};\n${body}`]);
export default async function (ws) {
  const f = [];
  const slow = scenario(ws, `const sent = []; const t = Date.now();
const res = await signup({ name: 'a', email: 'a@example.com' }, { sendWelcome: (to) => new Promise((r) => setTimeout(() => { sent.push(to); r(); }, 400)) });
const took = Date.now() - t;
await new Promise((r) => setTimeout(r, 600));
console.log(JSON.stringify({ status: res.status, took, sent }));`);
  let s = {};
  try { s = JSON.parse(slow.stdout.trim().split('\n').pop()); } catch { /* reported below */ }
  await expect(f, 'signup answers before the email is sent', () => (s.status === 201 && s.took < 200) || slow.out);
  await expect(f, 'the welcome email is still sent', () => (s.sent && s.sent.length === 1) || slow.out);
  const down = scenario(ws, `const res = await signup({ name: 'b', email: 'b@example.com' }, { sendWelcome: async () => { throw new Error('SMTP_DOWN'); } });
await new Promise((r) => setTimeout(r, 300));
console.log('STATUS', res.status);`);
  await expect(f, 'a failing mailer does not crash the server', () => (down.code === 0 && /STATUS 201/.test(down.out)) || down.out);
  await expect(f, 'the email failure is reported, not swallowed', () => /SMTP_DOWN|welcome/i.test(down.out.replace(/STATUS 201/, '')) || down.out);
  return f;
}
