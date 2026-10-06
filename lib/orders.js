import { randomBytes } from "node:crypto";
import { query } from "./db.js";
import { HttpError, str } from "./http.js";
import { quote } from "./pricing.js";
import { cashfreeConfigured, getCashfreeOrder, getCashfreePayments } from "./cashfree.js";
import { shiprocketConfigured, shiprocketOrderBody, createShiprocketOrder, assignAwb } from "./shiprocket.js";
import { notifyNewOrder } from "./notify.js";

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded", "test"];
export const FULFILLMENTS = ["unfulfilled", "processing", "shipped", "delivered", "cancelled", "returned"];

const STATES = ["Andaman and Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chandigarh","Chhattisgarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu and Kashmir","Jharkhand","Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Puducherry","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal"];

export function newOrderId(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = Array.from(randomBytes(5), b => alphabet[b % alphabet.length]).join("");
  return "DST-" + ist.slice(2, 4) + ist.slice(5, 7) + ist.slice(8, 10) + "-" + rand;
}

export function validateCustomer(input = {}) {
  const c = {
    name: str(input.name, 80),
    phone: str(input.phone, 20).replace(/\D/g, "").slice(-10),
    email: str(input.email, 120),
    address: str(input.address, 300),
    city: str(input.city, 60),
    state: str(input.state, 60),
    pincode: str(input.pincode, 6)
  };
  const errors = {};
  if (c.name.length < 2) errors.name = "Enter your full name.";
  if (!/^[6-9]\d{9}$/.test(c.phone)) errors.phone = "Enter a 10-digit Indian mobile number.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) errors.email = "Enter a valid email address.";
  if (c.address.length < 8) errors.address = "Enter your full address.";
  if (c.city.length < 2) errors.city = "Enter your city.";
  if (!STATES.includes(c.state)) errors.state = "Select your state.";
  if (!/^[1-9]\d{5}$/.test(c.pincode)) errors.pincode = "Enter a 6-digit pincode.";
  if (Object.keys(errors).length) throw new HttpError(400, "Please check your details.", { fields: errors });
  c.phone = "+91" + c.phone;
  return c;
}

const event = text => ({ at: new Date().toISOString(), text });

export function rowToOrder(r) {
  return {
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    qty: r.qty,
    subtotal: Number(r.subtotal),
    shipping: Number(r.shipping),
    total: Number(r.total),
    customer: r.customer,
    paymentStatus: r.payment_status,
    fulfillment: r.fulfillment,
    payment: r.payment || {},
    shipment: r.shipment || {},
    notes: r.notes || "",
    test: r.test,
    history: r.history || []
  };
}

export async function createOrder({ qty, customer, test }, settings) {
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 1 || n > settings.maxQty) throw new HttpError(400, "Choose between 1 and " + settings.maxQty + " packs.");
  const c = validateCustomer(customer);
  const q = quote(settings, n);
  const id = newOrderId();
  const rows = await query(
    `INSERT INTO orders (id, qty, subtotal, shipping, total, customer, payment_status, test, history)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, n, q.subtotal, q.shipping, q.total, JSON.stringify(c), test ? "test" : "pending", !!test,
     JSON.stringify([event(test ? "Test order placed (payments not connected)" : "Order created, awaiting payment")])]
  );
  return rowToOrder(rows[0]);
}

export async function getOrder(id) {
  const rows = await query("SELECT * FROM orders WHERE id = $1", [String(id || "")]);
  return rows.length ? rowToOrder(rows[0]) : null;
}

const COLUMNS = { paymentStatus: "payment_status", fulfillment: "fulfillment", payment: "payment", shipment: "shipment", notes: "notes" };

// Applies `patch` (camelCase keys from COLUMNS) and appends `text` to the order's history.
// `onlyIf` is an optional SQL guard, e.g. "payment_status <> 'paid'", so concurrent updates can't double-fire.
export async function updateOrder(id, patch, text, onlyIf) {
  const sets = [], params = [id];
  for (const [k, col] of Object.entries(COLUMNS)) {
    if (patch[k] === undefined) continue;
    const v = patch[k];
    params.push(typeof v === "object" ? JSON.stringify(v) : v);
    sets.push(`${col} = $${params.length}`);
  }
  if (text) {
    params.push(JSON.stringify([event(text)]));
    sets.push(`history = history || $${params.length}::jsonb`);
  }
  sets.push("updated_at = now()");
  const rows = await query(`UPDATE orders SET ${sets.join(", ")} WHERE id = $1${onlyIf ? " AND " + onlyIf : ""} RETURNING *`, params);
  return rows.length ? rowToOrder(rows[0]) : null;
}

const FILTERS = {
  all: "TRUE",
  to_ship: "payment_status = 'paid' AND fulfillment IN ('unfulfilled','processing')",
  pending: "payment_status = 'pending'",
  paid: "payment_status = 'paid'",
  shipped: "fulfillment = 'shipped'",
  delivered: "fulfillment = 'delivered'",
  cancelled: "fulfillment IN ('cancelled','returned') OR payment_status IN ('failed','refunded')",
  test: "test"
};

export async function listOrders({ q = "", filter = "all", limit = 50, offset = 0 } = {}) {
  const where = [FILTERS[filter] ? "(" + FILTERS[filter] + ")" : "TRUE"];
  const params = [];
  if (q) {
    params.push("%" + q.trim().toLowerCase() + "%");
    const p = "$" + params.length;
    where.push(`(lower(id) LIKE ${p} OR lower(customer->>'name') LIKE ${p} OR customer->>'phone' LIKE ${p}
               OR lower(customer->>'email') LIKE ${p} OR customer->>'pincode' LIKE ${p} OR lower(customer->>'city') LIKE ${p})`);
  }
  const w = where.join(" AND ");
  const lim = Math.min(500, Math.max(1, Number(limit) || 50)), off = Math.max(0, Number(offset) || 0);
  const rows = await query(`SELECT * FROM orders WHERE ${w} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`, params);
  const count = await query(`SELECT count(*)::int AS n FROM orders WHERE ${w}`, params);
  return { orders: rows.map(rowToOrder), total: count[0].n };
}

export async function orderStats() {
  const today = "created_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')";
  const rows = await query(`SELECT
      count(*) FILTER (WHERE payment_status = 'paid' AND ${today})::int                         AS orders_today,
      coalesce(sum(total) FILTER (WHERE payment_status = 'paid' AND ${today}), 0)::float         AS revenue_today,
      coalesce(sum(total) FILTER (WHERE payment_status = 'paid' AND created_at > now() - interval '30 days'), 0)::float AS revenue_30d,
      count(*) FILTER (WHERE payment_status = 'paid' AND created_at > now() - interval '30 days')::int AS orders_30d,
      count(*) FILTER (WHERE ${FILTERS.to_ship})::int                                              AS to_ship,
      count(*) FILTER (WHERE payment_status = 'pending' AND created_at > now() - interval '2 days')::int AS pending
    FROM orders`);
  return rows[0];
}

/* ---------- payment ---------- */

// Asks Cashfree for the truth about an order and records it. Safe to call any number of times.
export async function syncPayment(order, ctx) {
  if (!order || order.test || !cashfreeConfigured()) return order;
  const cfo = await getCashfreeOrder(order.id);
  const pays = await getCashfreePayments(order.id).catch(() => []);
  const list = Array.isArray(pays) ? pays : [];
  const success = list.find(p => p.payment_status === "SUCCESS");
  const last = list[0];
  const payment = {
    ...order.payment,
    cfOrderStatus: cfo.order_status,
    cfOrderId: cfo.cf_order_id,
    ...(success ? {
      cfPaymentId: String(success.cf_payment_id),
      method: success.payment_group,
      paidAmount: Number(success.payment_amount),
      paidAt: success.payment_completion_time || success.payment_time
    } : {}),
    lastAttempt: last ? { status: last.payment_status, message: last.payment_message || "", at: last.payment_time } : order.payment.lastAttempt
  };

  if (cfo.order_status === "PAID" || success) {
    const paid = await updateOrder(order.id, { paymentStatus: "paid", payment },
      "Payment received" + (payment.method ? " via " + payment.method : "") + (payment.cfPaymentId ? " (Cashfree " + payment.cfPaymentId + ")" : ""),
      "payment_status <> 'paid'");
    if (paid) { await afterPaid(paid, ctx); return (await getOrder(order.id)) || paid; }
    return getOrder(order.id);
  }
  if ((cfo.order_status === "EXPIRED" || cfo.order_status === "TERMINATED") && order.paymentStatus === "pending") {
    return (await updateOrder(order.id, { paymentStatus: "failed", payment }, "Payment session " + cfo.order_status.toLowerCase(), "payment_status = 'pending'")) || getOrder(order.id);
  }
  return (await updateOrder(order.id, { payment })) || order;
}

export async function afterPaid(order, ctx = {}) {
  const { settings, origin } = ctx;
  if (!settings) return;
  await notifyNewOrder(order, settings, origin || "");
  if (!order.test && settings.fulfillment?.autoCreateShipment && shiprocketConfigured()) {
    await shipOrder(order, settings).catch(err => updateOrder(order.id, {}, "Automatic shipment failed: " + err.message));
  }
}

/* ---------- shipping ---------- */

export async function shipOrder(order, settings) {
  if (order.paymentStatus !== "paid" && !order.test) throw new HttpError(400, "Only paid orders can be shipped.");
  let o = order;
  if (!o.shipment.srOrderId) {
    const res = await createShiprocketOrder(shiprocketOrderBody(o, settings.fulfillment, settings.sku, settings.productName));
    o = await updateOrder(o.id, {
      fulfillment: "processing",
      shipment: { provider: "shiprocket", srOrderId: res.order_id, shipmentId: res.shipment_id, status: res.status || "NEW", awb: res.awb_code || "", courier: res.courier_name || "" }
    }, "Shiprocket order created (#" + res.order_id + ")");
  }
  if (!o.shipment.awb && o.shipment.shipmentId) {
    try {
      const a = await assignAwb(o.shipment.shipmentId);
      const d = a?.response?.data || {};
      if (d.awb_code) {
        o = await updateOrder(o.id, { shipment: { ...o.shipment, awb: d.awb_code, courier: d.courier_name || "", status: "AWB ASSIGNED" } },
          "AWB " + d.awb_code + " assigned" + (d.courier_name ? " · " + d.courier_name : ""));
      } else {
        o = await updateOrder(o.id, {}, "Courier not assigned yet: " + (a.message || "assign it in Shiprocket or retry"));
      }
    } catch (err) {
      o = await updateOrder(o.id, {}, "Courier not assigned: " + err.message);
    }
  }
  return o;
}

export function toCsv(orders) {
  const cols = ["Order ID", "Date", "Name", "Phone", "Email", "Address", "City", "State", "Pincode", "Packs", "Subtotal", "Shipping", "Total", "Payment", "Fulfillment", "AWB", "Courier", "Test", "Notes"];
  const cell = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = orders.map(o => [o.id, o.createdAt, o.customer.name, o.customer.phone, o.customer.email, o.customer.address, o.customer.city, o.customer.state,
    o.customer.pincode, o.qty, o.subtotal, o.shipping, o.total, o.paymentStatus, o.fulfillment, o.shipment.awb, o.shipment.courier, o.test ? "yes" : "", o.notes].map(cell).join(","));
  return [cols.join(","), ...lines].join("\n");
}
