// Shiprocket shipping API. Env: SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD
// (create a dedicated API user in Shiprocket → Settings → API → Configure).
import { HttpError } from "./http.js";
import { getKv, setKv } from "./settings.js";

const BASE = "https://apiv2.shiprocket.in/v1/external";
export const shiprocketConfigured = () => !!(process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD);

let memToken = null;

async function login() {
  const r = await fetch(BASE + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.token) throw new HttpError(502, "Shiprocket login failed: " + (data.message || r.status) + ". Check SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD.");
  memToken = { token: data.token, exp: Date.now() + 9 * 24 * 3600 * 1000 };   // tokens last 10 days
  await setKv("shiprocket_token", memToken).catch(() => {});
  return memToken.token;
}

async function token(force) {
  if (!shiprocketConfigured()) throw new HttpError(503, "Shiprocket isn't connected yet.");
  if (!force) {
    if (memToken && memToken.exp > Date.now()) return memToken.token;
    const saved = await getKv("shiprocket_token").catch(() => null);
    if (saved && saved.exp > Date.now()) return (memToken = saved).token;
  }
  return login();
}

async function sr(path, { method = "GET", body } = {}, retried = false) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", authorization: "Bearer " + (await token(retried)) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401 && !retried) return sr(path, { method, body }, true);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.errors ? Object.values(data.errors).flat().join(" ") : "";
    throw new HttpError(502, "Shiprocket: " + (data.message || "request failed (" + r.status + ")") + (detail ? " " + detail : ""), { provider: data });
  }
  return data;
}

function istDate(d) {
  const t = new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString();
  return t.slice(0, 10) + " " + t.slice(11, 16);
}

export function shiprocketOrderBody(order, f, sku, productName) {
  const c = order.customer;
  const [first, ...rest] = c.name.trim().split(/\s+/);
  return {
    order_id: order.id,
    order_date: istDate(order.createdAt),
    pickup_location: f.pickupLocation,
    billing_customer_name: first,
    billing_last_name: rest.join(" "),
    billing_address: c.address,
    billing_city: c.city,
    billing_pincode: c.pincode,
    billing_state: c.state,
    billing_country: "India",
    billing_email: c.email,
    billing_phone: String(c.phone).replace(/\D/g, "").slice(-10),
    shipping_is_billing: true,
    order_items: [{ name: productName, sku, units: order.qty, selling_price: Math.round((order.subtotal / order.qty) * 100) / 100 }],
    payment_method: "Prepaid",
    shipping_charges: order.shipping,
    sub_total: order.subtotal,
    length: f.lengthCm,
    breadth: f.breadthCm,
    height: f.heightCm,
    weight: Math.round((f.weightKgPerPack * order.qty + 0.05) * 1000) / 1000
  };
}

export const createShiprocketOrder = body => sr("/orders/create/adhoc", { method: "POST", body });
export const assignAwb = shipmentId => sr("/courier/assign/awb", { method: "POST", body: { shipment_id: shipmentId } });
export const schedulePickup = shipmentId => sr("/courier/generate/pickup", { method: "POST", body: { shipment_id: [shipmentId] } });
export const generateLabel = shipmentId => sr("/courier/generate/label", { method: "POST", body: { shipment_id: [shipmentId] } });
export const trackAwb = awb => sr("/courier/track/awb/" + encodeURIComponent(awb));
export const cancelShiprocketOrder = srOrderId => sr("/orders/cancel", { method: "POST", body: { ids: [srOrderId] } });
