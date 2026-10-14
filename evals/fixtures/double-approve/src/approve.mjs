import { pay } from './payouts.mjs';
import { get, update } from './store.mjs';

// POST /requests/:id/approve
export async function approve(id) {
  const req = await get(id);
  if (!req) return { status: 404 };
  if (req.status !== 'pending') return { status: 409, error: `request is ${req.status}` };
  await pay(id, req.amount);
  await update(id, { status: 'approved' });
  return { status: 200 };
}
