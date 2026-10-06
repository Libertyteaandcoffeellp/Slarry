// POST /api/cashfree-webhook — Cashfree calls this on payment success / failure / drop.
// The signature is checked, then the order is re-read from Cashfree's API (the webhook is only a nudge).
import { handle, json, HttpError } from "../lib/http.js";
import { verifyWebhook } from "../lib/cashfree.js";
import { getSettings } from "../lib/settings.js";
import { getOrder, syncPayment } from "../lib/orders.js";

export const POST = handle(async request => {
  const raw = await request.text();
  const ok = verifyWebhook(raw, request.headers.get("x-webhook-timestamp"), request.headers.get("x-webhook-signature"));
  if (!ok) throw new HttpError(401, "Invalid signature.");

  let body = {};
  try { body = JSON.parse(raw); } catch {}
  const id = body?.data?.order?.order_id;
  const order = id ? await getOrder(id) : null;
  if (!order) return json({ ok: true, ignored: true });      // e.g. Cashfree's "test webhook" button

  await syncPayment(order, { settings: await getSettings(), origin: new URL(request.url).origin });
  return json({ ok: true });
});
