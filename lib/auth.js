// Admin login: one owner account. Email from ADMIN_EMAIL (defaults to the store owner's address),
// password from ADMIN_PASSWORD. Sessions are HMAC-signed cookies valid for 7 days.
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.js";

const COOKIE = "dst_admin";
const MAX_AGE = 7 * 24 * 3600;

export const adminEmail = () => (process.env.ADMIN_EMAIL || "armanshk612@gmail.com").trim().toLowerCase();

function secret() {
  const s = process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD;
  if (!s) throw new HttpError(503, "Admin login isn't set up yet. Add ADMIN_PASSWORD in Vercel → Settings → Environment Variables, then redeploy.");
  return s;
}

const b64 = s => Buffer.from(s).toString("base64url");
const mac = data => createHmac("sha256", secret()).update(data).digest("base64url");

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkLogin(email, password) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) secret();                                     // throws the "not set up" error
  const okEmail = safeEqual(String(email || "").trim().toLowerCase(), adminEmail());
  const okPass = safeEqual(password || "", pw);
  return okEmail && okPass;
}

export function issueToken(email, now = Date.now()) {
  const body = b64(JSON.stringify({ e: email, exp: Math.floor(now / 1000) + MAX_AGE }));
  return body + "." + mac(body);
}

export function verifyToken(token, now = Date.now()) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!safeEqual(sig, mac(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > now / 1000 && p.e === adminEmail() ? p : null;
  } catch {
    return null;
  }
}

export const sessionCookie = token => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function requireAdmin(request) {
  const cookies = Object.fromEntries((request.headers.get("cookie") || "").split(/;\s*/).filter(Boolean).map(c => {
    const i = c.indexOf("=");
    return [c.slice(0, i), c.slice(i + 1)];
  }));
  const p = verifyToken(cookies[COOKIE]);
  if (!p) throw new HttpError(401, "Please log in.");
  return p;
}
