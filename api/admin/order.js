// /api/admin/order — GET ?id= for one order; POST { id, action, ... } to act on it.
import { handle, json, readJson, HttpError, str } from "../../lib/http.js";
import { requireAdmin } from "../../lib/auth.js";
import { getSettings } from "../../lib/settings.js";
import { getOrder, updateOrder, syncPayment, shipOrder, FULFILLMENTS, PAYMENT_STATUSES } from "../../lib/orders.js";
import { query } from "../../lib/db.js";
import { schedulePickup, generateLabel, trackAwb, cancelShiprocketOrder } from "../../lib/shiprocket.js";

async function load(id) {
  const o = await getOrder(id);
  if (!o) throw new HttpError(404, "Order not found.");
  return o;
}

export const GET = handle(async request => {
  requireAdmin(request);
  return json({ order: await load(new URL(request.url).searchParams.get("id")) });
});

const ACTIONS = {
  async update(o, b) {
    const patch = {}, said = [];
    if (b.fulfillment !== undefined && b.fulfillment !== o.fulfillment) {
      if (!FULFILLMENTS.includes(b.fulfillment)) throw new HttpError(400, "Unknown fulfillment status.");
      patch.fulfillment = b.fulfillment;
      said.push("Marked " + b.fulfillment);
    }
    if (b.paymentStatus !== undefined && b.paymentStatus !== o.paymentStatus) {
      if (!PAYMENT_STATUSES.includes(b.paymentStatus)) throw new HttpError(400, "Unknown payment status.");
      patch.paymentStatus = b.paymentStatus;
      said.push("Payment set to " + b.paymentStatus + " by admin");
    }
    if (b.notes !== undefined && str(b.notes, 2000) !== o.notes) {
      patch.notes = str(b.notes, 2000);
      said.push("Notes updated");
    }
    return said.length ? updateOrder(o.id, patch, said.join(" · ")) : o;
  },
  async "sync-payment"(o, b, ctx) {
    return syncPayment(o, ctx);
  },
  async ship(o, b, ctx) {
    return shipOrder(o, ctx.settings);
  },
  async pickup(o) {
    if (!o.shipment.shipmentId) throw new HttpError(400, "Create the shipment first.");
    const r = await schedulePickup(o.shipment.shipmentId);
    const when = r?.response?.pickup_scheduled_date || "";
    return updateOrder(o.id, { shipment: { ...o.shipment, pickupScheduled: when || true } }, "Pickup scheduled" + (when ? " for " + when : ""));
  },
  async label(o) {
    if (!o.shipment.shipmentId) throw new HttpError(400, "Create the shipment first.");
    const r = await generateLabel(o.shipment.shipmentId);
    if (!r.label_url) throw new HttpError(502, "Shiprocket didn't return a label yet: " + (r.response || r.message || "assign a courier first"));
    return updateOrder(o.id, { shipment: { ...o.shipment, labelUrl: r.label_url } }, "Shipping label generated");
  },
  async track(o) {
    if (!o.shipment.awb) throw new HttpError(400, "This order has no AWB yet.");
    const t = (await trackAwb(o.shipment.awb))?.tracking_data || {};
    const acts = (t.shipment_track_activities || []).slice(0, 15).map(a => ({ at: a.date, status: a["sr-status-label"] || a.activity, location: a.location }));
    const current = t.shipment_track?.[0]?.current_status || "";
    const delivered = /delivered/i.test(current) && !/undelivered|not delivered/i.test(current);
    const patch = { shipment: { ...o.shipment, status: current || o.shipment.status, trackUrl: t.track_url || o.shipment.trackUrl || "", etd: t.etd || "", activities: acts, trackedAt: new Date().toISOString() } };
    if (delivered && o.fulfillment !== "delivered") patch.fulfillment = "delivered";
    else if (current && /pick|transit|out for/i.test(current) && o.fulfillment === "processing") patch.fulfillment = "shipped";
    return updateOrder(o.id, patch, patch.fulfillment ? "Tracking: " + current : null);
  },
  async "cancel-shipment"(o) {
    if (!o.shipment.srOrderId) throw new HttpError(400, "There's no Shiprocket order to cancel.");
    await cancelShiprocketOrder(o.shipment.srOrderId);
    return updateOrder(o.id, { fulfillment: "unfulfilled", shipment: { ...o.shipment, cancelled: true, srOrderId: null, shipmentId: null, awb: "", status: "CANCELLED" } }, "Shiprocket order cancelled");
  },
  async delete(o) {
    if (!o.test) throw new HttpError(400, "Only test orders can be deleted.");
    await query("DELETE FROM orders WHERE id = $1", [o.id]);
    return null;
  }
};

export const POST = handle(async request => {
  requireAdmin(request);
  const b = await readJson(request);
  const fn = ACTIONS[b.action];
  if (!fn) throw new HttpError(400, "Unknown action.");
  const o = await load(b.id);
  const ctx = { settings: await getSettings(), origin: new URL(request.url).origin };
  const order = await fn(o, b, ctx);
  return json({ order: order === null ? null : order || (await load(b.id)) });
});
