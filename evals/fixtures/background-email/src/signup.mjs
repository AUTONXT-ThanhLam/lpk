import { saveUser } from './users.mjs';

// POST /signup. `mailer` is the SMTP client the server passes in.
export async function signup(body, mailer) {
  const user = saveUser(body);
  await mailer.sendWelcome(user.email);
  return { status: 201, user };
}
