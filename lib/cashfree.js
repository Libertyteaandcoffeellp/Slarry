// Cashfree Payment Gateway (PG API version 2023-08-01).
// Env: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV = "sandbox" | "production".
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.js";

const API_VERSION = "2023-08-01";

export const cashfreeConfigured = () => !!(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
export const cashfreeMode = () => ((process.env.CASHFREE_ENV || "sandbox").trim().toLowerCase() === "production" ? "production" : "sandbox");
const base = () => (cashfreeMode() === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg");

async function cf(path, { method = "GET", body } = {}) {
  if (!cashfreeConfigured()) throw new HttpError(503, "Cashfree isn't connected yet.");
  const r = await fetch(base() + path, {
    method,
    headers: {
      "x-client-id": process.env.CASHFREE_APP_ID,
      "x-client-secret": process.env.CASHFREE_SECRET_KEY,
      "x-api-version": API_VERSION,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, "Cashfree: " + (data.message || "request failed (" + r.status + ")"), { provider: data });
  return data;
}

export function createCashfreeOrder(order, { returnUrl, notifyUrl }) {
  const c = order.customer;
  const phone = String(c.phone).replace(/\D/g, "").slice(-10);
  return cf("/orders", {
    method: "POST",
    body: {
      order_id: order.id,
      order_amount: order.total,
      order_currency: "INR",
      customer_details: {
        customer_id: "c_" + phone,
        customer_name: c.name,
        customer_email: c.email,
        customer_phone: phone
      },
      order_meta: { return_url: returnUrl, notify_url: notifyUrl },
      order_note: "Diet Slim Tea x " + order.qty
    }
  });
}

export const getCashfreeOrder = id => cf("/orders/" + encodeURIComponent(id));
export const getCashfreePayments = id => cf("/orders/" + encodeURIComponent(id) + "/payments");

// Webhook signature: base64(HMAC-SHA256(timestamp + rawBody, secretKey)).
export function verifyWebhook(rawBody, timestamp, signature) {
  if (!cashfreeConfigured() || !timestamp || !signature) return false;
  const expected = createHmac("sha256", process.env.CASHFREE_SECRET_KEY).update(timestamp + rawBody).digest("base64");
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
