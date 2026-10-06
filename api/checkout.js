// POST /api/checkout { qty, customer } — saves the order and opens a Cashfree payment session.
// Without Cashfree keys the order is saved as a test order so the whole flow can be tried end to end.
import { handle, json, readJson } from "../lib/http.js";
import { getSettings } from "../lib/settings.js";
import { createOrder, updateOrder, afterPaid } from "../lib/orders.js";
import { cashfreeConfigured, cashfreeMode, createCashfreeOrder } from "../lib/cashfree.js";

export const POST = handle(async request => {
  const body = await readJson(request);
  const settings = await getSettings();
  const origin = new URL(request.url).origin;
  const live = cashfreeConfigured();
  const order = await createOrder({ qty: body.qty, customer: body.customer, test: !live }, settings);

  if (!live) {
    await afterPaid(order, { settings, origin });           // sends the (marked TEST) email so notifications can be checked
    return json({ orderId: order.id, amount: order.total, qty: order.qty, test: true });
  }

  try {
    const cf = await createCashfreeOrder(order, {
      returnUrl: origin + "/?order_id={order_id}",
      notifyUrl: origin + "/api/cashfree-webhook"
    });
    await updateOrder(order.id, { payment: { provider: "cashfree", mode: cashfreeMode(), cfOrderId: cf.cf_order_id, cfOrderStatus: cf.order_status } });
    return json({ orderId: order.id, amount: order.total, qty: order.qty, paymentSessionId: cf.payment_session_id, mode: cashfreeMode() });
  } catch (err) {
    await updateOrder(order.id, { paymentStatus: "failed" }, "Could not start payment: " + err.message);
    throw err;
  }
});
