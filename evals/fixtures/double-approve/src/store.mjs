// Stand-in for the database: every call is a round trip.
const rows = new Map();
const roundTrip = () => new Promise((resolve) => setTimeout(resolve, 5));

export async function insert(row) {
  await roundTrip();
  rows.set(row.id, { ...row });
}

export async function get(id) {
  await roundTrip();
  const row = rows.get(id);
  return row && { ...row };
}

export async function update(id, fields) {
  await roundTrip();
  Object.assign(rows.get(id), fields);
}

export function reset() {
  rows.clear();
}
