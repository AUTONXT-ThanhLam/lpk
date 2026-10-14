import { createUser } from './store.mjs';

// Nightly CSV import from the HR system: rows of [name, email].
export function importUsers(rows) {
  return rows.map(([name, email]) => createUser({ name, email }));
}
