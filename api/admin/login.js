// /api/admin/login — POST logs in, GET returns the current session, DELETE logs out.
import { handle, json, readJson, HttpError } from "../../lib/http.js";
import { checkLogin, issueToken, sessionCookie, clearCookie, requireAdmin, adminEmail } from "../../lib/auth.js";

export const POST = handle(async request => {
  const { email, password } = await readJson(request);
  if (!checkLogin(email, password)) {
    await new Promise(r => setTimeout(r, 600));               // slow down guessing
    throw new HttpError(401, "Wrong email or password.");
  }
  return json({ email: adminEmail() }, 200, { "set-cookie": sessionCookie(issueToken(adminEmail())) });
});

export const GET = handle(async request => json({ email: requireAdmin(request).e }));

export const DELETE = handle(async () => json({ ok: true }, 200, { "set-cookie": clearCookie() }));
