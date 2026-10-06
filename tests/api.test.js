// End-to-end tests for the /api functions against an in-memory Postgres (PGlite),
// with Cashfree, Shiprocket and Resend replaced by a fake fetch.
import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { setQueryImpl } from "../lib/db.js";

const pg = new PGlite();
setQueryImpl(async (text, params) => (await pg.query(text, params)).rows);

process.env.ADMIN_PASSWORD = "s3cret-pass";
process.env.CASHFREE_APP_ID = "app";
process.env.CASHFREE_SECRET_KEY = "cfsecret";
process.env.SHIPROCKET_EMAIL = "api@example.com";
process.env.SHIPROCKET_PASSWORD = "srpass";
process.env.RESEND_API_KEY = "re_test";

const calls = [];
let cfOrderStatus = "ACTIVE";
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url, method: init.method || "GET", body });
  const ok = data => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
  if (url.endsWith("/pg/orders") && init.method === "POST") return ok({ cf_order_id: "cf1", order_status: "ACTIVE", payment_session_id: "session_abc" });
  if (/\/pg\/orders\/[^/]+\/payments$/.test(url))
    return ok(cfOrderStatus === "PAID" ? [{ payment_status: "SUCCESS", cf_payment_id: 555, payment_group: "upi", payment_amount: 899 }] : []);
  if (/\/pg\/orders\/[^/]+$/.test(url)) return ok({ cf_order_id: "cf1", order_status: cfOrderStatus, order_amount: 899 });
  if (url.endsWith("/auth/login")) return ok({ token: "srtoken" });
  if (url.endsWith("/orders/create/adhoc")) return ok({ order_id: 9001, shipment_id: 7001, status: "NEW" });
  if (url.endsWith("/courier/assign/awb")) return ok({ awb_assign_status: 1, response: { data: { awb_code: "AWB123", courier_name: "Delhivery" } } });
  if (url.includes("/courier/track/awb/")) return ok({ tracking_data: { shipment_track: [{ current_status: "Delivered" }], track_url: "https://track/x", shipment_track_activities: [] } });
  if (url.includes("api.resend.com")) return ok({ id: "email1" });
  return realFetch(url, init);
};

const cfg = (await import("../api/config.js")).GET;
const checkout = (await import("../api/checkout.js")).POST;
const status = (await import("../api/order-status.js")).GET;
const webhook = (await import("../api/cashfree-webhook.js")).POST;
const login = await import("../api/admin/login.js");
const ordersApi = (await import("../api/admin/orders.js")).GET;
const orderApi = await import("../api/admin/order.js");
const settingsApi = await import("../api/admin/settings.js");

const BASE = "https://shop.test";
const req = (path, { method = "GET", body, cookie, headers = {} } = {}) =>
  new Request(BASE + path, { method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...headers } });

const customer = { name: "Asha Verma", phone: "9876543210", email: "asha@example.com", address: "12 MG Road, Indiranagar", city: "Bengaluru", state: "Karnataka", pincode: "560038" };

let cookie;
before(async () => {
  const r = await login.POST(req("/api/admin/login", { method: "POST", body: { email: "ArmanShk612@gmail.com ", password: "s3cret-pass" } }));
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie").split(";")[0];
});
beforeEach(() => { calls.length = 0; cfOrderStatus = "ACTIVE"; });

test("login rejects a wrong password and protects admin routes", async () => {
  const bad = await login.POST(req("/api/admin/login", { method: "POST", body: { email: "armanshk612@gmail.com", password: "nope" } }));
  assert.equal(bad.status, 401);
  assert.equal((await ordersApi(req("/api/admin/orders"))).status, 401);
  assert.equal((await ordersApi(req("/api/admin/orders", { cookie: "dst_admin=forged.token" }))).status, 401);
  const me = await login.GET(req("/api/admin/login", { cookie }));
  assert.deepEqual(await me.json(), { email: "armanshk612@gmail.com" });
});

test("checkout prices on the server and opens a Cashfree session", async () => {
  const r = await checkout(req("/api/checkout", { method: "POST", body: { qty: 3, customer, price: 1 } }));
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  assert.equal(d.amount, 899);
  assert.equal(d.paymentSessionId, "session_abc");
  const cf = calls.find(c => c.url.endsWith("/pg/orders"));
  assert.equal(cf.body.order_amount, 899);
  assert.equal(cf.body.customer_details.customer_phone, "9876543210");
  assert.equal(cf.body.order_meta.notify_url, BASE + "/api/cashfree-webhook");
});

test("checkout rejects bad details with per-field errors", async () => {
  const r = await checkout(req("/api/checkout", { method: "POST", body: { qty: 1, customer: { ...customer, pincode: "12", state: "Narnia" } } }));
  assert.equal(r.status, 400);
  const d = await r.json();
  assert.ok(d.fields.pincode && d.fields.state);
});

test("payment is confirmed by polling, emails once, and shows up for shipping", async () => {
  const { orderId } = await (await checkout(req("/api/checkout", { method: "POST", body: { qty: 3, customer } }))).json();
  let s = await (await status(req("/api/order-status?id=" + orderId))).json();
  assert.equal(s.paymentStatus, "pending");

  cfOrderStatus = "PAID";
  s = await (await status(req("/api/order-status?id=" + orderId))).json();
  assert.equal(s.paymentStatus, "paid");
  s = await (await status(req("/api/order-status?id=" + orderId))).json();
  assert.equal(calls.filter(c => c.url.includes("resend")).length, 1, "new-order email sent exactly once");

  const list = await (await ordersApi(req("/api/admin/orders?filter=to_ship", { cookie }))).json();
  assert.ok(list.orders.some(o => o.id === orderId));
  assert.ok(list.stats.revenue_30d >= 899);
});

test("webhook needs a valid signature, then syncs the order", async () => {
  const { orderId } = await (await checkout(req("/api/checkout", { method: "POST", body: { qty: 1, customer } }))).json();
  const raw = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: orderId } } });
  const forged = await webhook(req("/api/cashfree-webhook", { method: "POST", body: raw, headers: { "x-webhook-timestamp": "1", "x-webhook-signature": "bad" } }));
  assert.equal(forged.status, 401);

  cfOrderStatus = "PAID";
  const ts = String(Date.now());
  const sig = createHmac("sha256", "cfsecret").update(ts + raw).digest("base64");
  const r = await webhook(req("/api/cashfree-webhook", { method: "POST", body: raw, headers: { "x-webhook-timestamp": ts, "x-webhook-signature": sig } }));
  assert.equal(r.status, 200);
  const o = (await (await orderApi.GET(req("/api/admin/order?id=" + orderId, { cookie }))).json()).order;
  assert.equal(o.paymentStatus, "paid");
  assert.equal(o.payment.method, "upi");
});

test("admin can ship, track and annotate an order through Shiprocket", async () => {
  const { orderId } = await (await checkout(req("/api/checkout", { method: "POST", body: { qty: 2, customer } }))).json();
  const act = async body => (await orderApi.POST(req("/api/admin/order", { method: "POST", cookie, body: { id: orderId, ...body } }))).json();

  const early = await orderApi.POST(req("/api/admin/order", { method: "POST", cookie, body: { id: orderId, action: "ship" } }));
  assert.equal(early.status, 400, "unpaid orders can't ship");

  cfOrderStatus = "PAID";
  await act({ action: "sync-payment" });
  let { order } = await act({ action: "ship" });
  assert.equal(order.shipment.srOrderId, 9001);
  assert.equal(order.shipment.awb, "AWB123");
  assert.equal(order.fulfillment, "processing");
  const sr = calls.find(c => c.url.endsWith("/orders/create/adhoc")).body;
  assert.equal(sr.order_id, orderId);
  assert.equal(sr.billing_phone, "9876543210");
  assert.equal(sr.sub_total, 699);

  ({ order } = await act({ action: "track" }));
  assert.equal(order.fulfillment, "delivered");
  ({ order } = await act({ action: "update", notes: "Called customer" }));
  assert.equal(order.notes, "Called customer");
  assert.ok(order.history.length >= 5);
});

test("content edits are validated, saved and served to the storefront without private settings", async () => {
  const { settings } = await (await settingsApi.GET(req("/api/admin/settings", { cookie }))).json();
  settings.whatsapp.number = "+91 98765-43210";
  settings.text.heroTitle = "Fresh Tea.";
  settings.packs = settings.packs.map(p => (p.qty === 3 ? { ...p, price: 849 } : p));
  settings.evil = "<script>";
  const put = await settingsApi.PUT(req("/api/admin/settings", { method: "PUT", cookie, body: { settings } }));
  assert.equal(put.status, 200);

  const pub = await (await cfg(req("/api/config"))).json();
  assert.equal(pub.whatsapp.number, "919876543210");
  assert.equal(pub.text.heroTitle, "Fresh Tea.");
  assert.equal(pub.evil, undefined);
  assert.equal(pub.fulfillment, undefined);
  assert.equal(pub.payments.enabled, true);

  const { amount } = await (await checkout(req("/api/checkout", { method: "POST", body: { qty: 3, customer } }))).json();
  assert.equal(amount, 849, "checkout uses the edited price");
});

test("without Cashfree keys, checkout saves a test order", async () => {
  const id = process.env.CASHFREE_APP_ID;
  delete process.env.CASHFREE_APP_ID;
  try {
    const d = await (await checkout(req("/api/checkout", { method: "POST", body: { qty: 1, customer } }))).json();
    assert.equal(d.test, true);
    const list = await (await ordersApi(req("/api/admin/orders?filter=test", { cookie }))).json();
    assert.ok(list.orders.some(o => o.id === d.orderId && o.paymentStatus === "test"));
    const del = await orderApi.POST(req("/api/admin/order", { method: "POST", cookie, body: { id: d.orderId, action: "delete" } }));
    assert.equal(del.status, 200);
  } finally {
    process.env.CASHFREE_APP_ID = id;
  }
});

test("CSV export works", async () => {
  const r = await ordersApi(req("/api/admin/orders?format=csv", { cookie }));
  assert.match(r.headers.get("content-type"), /text\/csv/);
  assert.match((await r.text()).split("\n")[0], /^Order ID,Date,Name/);
});
