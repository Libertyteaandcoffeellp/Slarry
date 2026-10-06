// GET /api/order-status?id=DST-… — the storefront polls this after the Cashfree popup closes.
// Returns only what the confirmation screen needs, never the address.
import { handle, json, HttpError } from "../lib/http.js";
import { getSettings } from "../lib/settings.js";
import { getOrder, syncPayment } from "../lib/orders.js";

export const GET = handle(async request => {
  const url = new URL(request.url);
  let order = await getOrder(url.searchParams.get("id"));
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.paymentStatus === "pending") {
    order = await syncPayment(order, { settings: await getSettings(), origin: url.origin }).catch(err => {
      console.error("order-status sync", err);
      return order;
    });
  }
  return json({ orderId: order.id, paymentStatus: order.paymentStatus, amount: order.total, qty: order.qty });
});
