// New-order emails through Resend (optional). Env: RESEND_API_KEY, MAIL_FROM.
import { adminEmail } from "./auth.js";

export const emailConfigured = () => !!process.env.RESEND_API_KEY;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function notifyNewOrder(order, settings, origin) {
  if (!emailConfigured() || !settings.notifications?.emailOnOrder) return;
  const to = [adminEmail(), ...String(settings.notifications.extraEmails || "").split(",").map(s => s.trim()).filter(Boolean)];
  const c = order.customer;
  const tag = order.test ? "[TEST] " : "";
  const html = `
    <h2 style="margin:0 0 8px">${tag}New order ${esc(order.id)} — ₹${order.total}</h2>
    <p style="margin:0 0 12px">${order.qty} × Diet Slim Tea 100 g · Payment: <b>${esc(order.paymentStatus)}</b></p>
    <p style="margin:0 0 12px"><b>${esc(c.name)}</b><br>${esc(c.phone)} · ${esc(c.email)}<br>
      ${esc(c.address)}, ${esc(c.city)}, ${esc(c.state)} ${esc(c.pincode)}</p>
    <p><a href="${esc(origin)}/admin/#order=${encodeURIComponent(order.id)}">Open in admin</a></p>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + process.env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "Diet Slim Tea <onboarding@resend.dev>",
        to,
        subject: `${tag}New order ${order.id} · ₹${order.total} · ${c.city}`,
        html
      })
    });
    if (!r.ok) console.error("Resend error", r.status, await r.text());
  } catch (err) {
    console.error("Resend error", err);
  }
}
