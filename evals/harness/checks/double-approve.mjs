import { expect, load } from './lib.mjs';
export default async function (ws) {
  const f = [];
  const { approve } = await load(ws, 'src/approve.mjs');
  const { sent } = await load(ws, 'src/payouts.mjs');
  const store = await load(ws, 'src/store.mjs');
  store.reset();
  await store.insert({ id: 7, amount: 120, status: 'pending' });
  const both = await Promise.all([approve(7), approve(7)]);
  await expect(f, 'a double-click pays once', () => sent.filter((p) => p.requestId === 7).length === 1 || sent);
  await expect(f, 'one click succeeds and the other is refused', () => both.map((r) => r.status).sort().join() === '200,409' || both);
  await expect(f, 'the request ends approved', async () => (await store.get(7)).status === 'approved' || (await store.get(7)));
  await store.insert({ id: 8, amount: 5, status: 'pending' });
  await expect(f, 'a single approve still works', async () => (await approve(8)).status === 200 || 'not 200');
  return f;
}
