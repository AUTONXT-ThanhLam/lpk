import { expect, load } from './lib.mjs';
export default async function (ws) {
  const f = [];
  const store = await load(ws, 'src/store.mjs');
  const api = await load(ws, 'src/api.mjs');
  const imp = await load(ws, 'src/import.mjs');
  const bad = () => store.allUsers().some((u) => u.email === 'not-an-email');
  store.reset();
  await expect(f, 'valid create still works', () => api.postUser({ name: 'a', email: 'a@example.com' }).status === 201 || 'not 201');
  await expect(f, 'valid patch still works', () => api.patchUser(1, { email: 'b@example.com' }).status === 200 || 'not 200');
  try { api.patchUser(1, { email: 'not-an-email' }); } catch { /* refusing by throwing is fine */ }
  await expect(f, 'PATCH cannot store an invalid email', () => !bad() || store.getUser(1));
  try { imp.importUsers([['x', 'not-an-email']]); } catch { /* refusing by throwing is fine */ }
  await expect(f, 'the CSV import cannot store an invalid email', () => !bad() || store.allUsers());
  store.reset();
  await expect(f, 'a valid import still works', () => imp.importUsers([['y', 'y@example.com']]) && store.allUsers().length === 1 || store.allUsers());
  return f;
}
