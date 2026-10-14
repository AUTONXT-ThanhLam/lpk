const users = new Map();
let next = 1;

export function createUser({ name, email }) {
  const id = next++;
  users.set(id, { id, name, email });
  return users.get(id);
}

export function updateUser(id, patch) {
  const user = users.get(id);
  if (!user) throw new Error('not found');
  Object.assign(user, patch);
  return user;
}

export const getUser = (id) => users.get(id);
export const allUsers = () => [...users.values()];
export function reset() { users.clear(); next = 1; }
