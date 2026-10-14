import { expect, load } from './lib.mjs';
export default async function (ws) {
  const f = [];
  const { userCountLabel } = await load(ws, 'src/dashboard.mjs');
  const { syncCache } = await load(ws, 'src/sync.mjs');
  const down = async () => { throw new Error('ECONNREFUSED'); };
  const two = async () => ({ ok: true, status: 200, json: async () => [{ id: 1 }, { id: 2 }] });
  const none = async () => ({ ok: true, status: 200, json: async () => [] });
  await expect(f, 'API down shows Users unavailable', async () => (await userCountLabel(down)) === 'Users unavailable' || userCountLabel(down));
  await expect(f, 'two users still counted', async () => (await userCountLabel(two)) === '2 users' || 'wrong');
  await expect(f, 'a real empty list still reads 0 users', async () => (await userCountLabel(none)) === '0 users' || 'wrong');
  const cache = { users: [{ id: 1 }, { id: 2 }] };
  try { await syncCache(cache, down); } catch { /* failing loudly is fine */ }
  await expect(f, 'an outage does not wipe the offline cache', () => (cache.users && cache.users.length === 2) || cache);
  return f;
}
