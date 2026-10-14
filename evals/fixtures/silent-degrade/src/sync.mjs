import { fetchUsers } from './client.mjs';

// Runs every minute: keeps the offline cache in step with the API.
export async function syncCache(cache, fetchImpl) {
  cache.users = await fetchUsers(fetchImpl);
  return cache;
}
