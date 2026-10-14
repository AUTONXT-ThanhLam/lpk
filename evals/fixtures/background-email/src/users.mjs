const users = [];

export function saveUser({ name, email }) {
  const user = { id: users.length + 1, name, email };
  users.push(user);
  return user;
}

export const allUsers = () => [...users];
