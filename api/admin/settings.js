// /api/admin/settings — GET current settings + integration status; PUT { settings } to save.
import { handle, json, readJson } from "../../lib/http.js";
import { requireAdmin, adminEmail } from "../../lib/auth.js";
import { getSettings, saveSettings } from "../../lib/settings.js";
import { databaseConfigured } from "../../lib/db.js";
import { cashfreeConfigured, cashfreeMode } from "../../lib/cashfree.js";
import { shiprocketConfigured } from "../../lib/shiprocket.js";
import { emailConfigured } from "../../lib/notify.js";

function integrations(origin) {
  return {
    adminEmail: adminEmail(),
    database: databaseConfigured(),
    cashfree: { configured: cashfreeConfigured(), mode: cashfreeMode(), webhookUrl: origin + "/api/cashfree-webhook" },
    shiprocket: { configured: shiprocketConfigured() },
    email: { configured: emailConfigured(), from: process.env.MAIL_FROM || "Diet Slim Tea <onboarding@resend.dev>" }
  };
}

export const GET = handle(async request => {
  requireAdmin(request);
  return json({ settings: await getSettings(), integrations: integrations(new URL(request.url).origin) });
});

export const PUT = handle(async request => {
  requireAdmin(request);
  const { settings } = await readJson(request);
  return json({ settings: await saveSettings(settings), integrations: integrations(new URL(request.url).origin) });
});
