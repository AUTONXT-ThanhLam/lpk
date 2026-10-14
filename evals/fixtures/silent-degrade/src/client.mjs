export async function fetchUsers(fetchImpl) {
  return fetchImpl('/api/users')
    .then((r) => r.json())
    .catch(() => []);
}
