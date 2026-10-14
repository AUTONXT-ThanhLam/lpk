import { isEmail } from './validate.mjs';
import { createUser, updateUser } from './store.mjs';

// POST /users
export function postUser(body) {
  if (!isEmail(body.email)) return { status: 400, error: 'invalid email' };
  return { status: 201, user: createUser(body) };
}

// PATCH /users/:id
export function patchUser(id, body) {
  try {
    return { status: 200, user: updateUser(id, body) };
  } catch (e) {
    return { status: 404, error: e.message };
  }
}
