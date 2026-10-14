import { fetchUsers } from './client.mjs';

export async function userCountLabel(fetchImpl) {
  const users = await fetchUsers(fetchImpl);
  return `${users.length} users`;
}
