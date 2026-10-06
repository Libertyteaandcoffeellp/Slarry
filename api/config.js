// GET /api/config — storefront settings (prices, WhatsApp, texts, FAQ…) as edited in the admin panel.
import { handle, json } from "../lib/http.js";
import { getSettings, publicConfig } from "../lib/settings.js";
import { DEFAULTS } from "../lib/defaults.js";

export const GET = handle(async () => {
  let s;
  try {
    s = await getSettings();
  } catch (err) {
    console.error("config: falling back to defaults", err);
    s = DEFAULTS;
  }
  // Browsers always ask again (so admin edits show on the next page load); Vercel's edge keeps it 5 s to absorb traffic.
  return json(publicConfig(s), 200, { "cache-control": "no-cache", "vercel-cdn-cache-control": "max-age=5" });
});
