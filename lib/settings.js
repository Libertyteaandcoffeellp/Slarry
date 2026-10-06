import { query, databaseConfigured } from "./db.js";
import { DEFAULTS, PRIVATE_KEYS, ITEM_SHAPES } from "./defaults.js";
import { HttpError } from "./http.js";
import { cashfreeConfigured, cashfreeMode } from "./cashfree.js";

const isObj = v => v && typeof v === "object" && !Array.isArray(v);

export function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

// Coerces `val` to the shape of `def`. Unknown keys are dropped; wrong types fall back to the default.
function shape(def, val, key) {
  if (Array.isArray(def)) {
    if (!Array.isArray(val)) return def;
    const item = ITEM_SHAPES[key];
    return val.slice(0, 100).map(v => (item ? shape(item, v) : v)).filter(Boolean);
  }
  if (isObj(def)) {
    const src = isObj(val) ? val : {};
    const out = {};
    for (const k of Object.keys(def)) out[k] = shape(def[k], src[k], k);
    return out;
  }
  if (typeof def === "number") {
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : def;
  }
  if (typeof def === "boolean") return typeof val === "boolean" ? val : def;
  if (def === null) {                                    // optional text or number (e.g. freeAbove)
    if (val === null || val === undefined || val === "") return null;
    return typeof val === "number" ? val : String(val).slice(0, 5000);
  }
  return val == null ? "" : String(val).slice(0, 5000);
}

export function validate(input) {
  const s = shape(DEFAULTS, input);
  s.packs = s.packs.filter(p => Number.isInteger(p.qty) && p.qty > 0 && p.price > 0);
  if (!s.packs.some(p => p.qty === 1)) throw new HttpError(400, "There must be a 1-pack price.");
  s.reviews = s.reviews.filter(r => r.name && r.text).map(r => ({ ...r, rating: Math.min(5, Math.max(1, Math.round(r.rating))) }));
  s.faq = s.faq.filter(f => f.q && f.a);
  s.whatsapp.number = s.whatsapp.number.replace(/\D/g, "");
  if (s.shipping.freeAbove !== null && !(Number(s.shipping.freeAbove) >= 0)) s.shipping.freeAbove = null;
  s.maxQty = Math.min(100, Math.max(1, Math.round(s.maxQty)));
  return s;
}

export async function getSettings() {
  if (!databaseConfigured()) return DEFAULTS;
  const rows = await query("SELECT value FROM settings WHERE key = 'site'");
  return rows.length ? merge(DEFAULTS, rows[0].value) : DEFAULTS;
}

export async function saveSettings(input) {
  const s = validate(input);
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('site', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(s)]
  );
  return s;
}

export function publicConfig(s) {
  const out = { ...s };
  for (const k of PRIVATE_KEYS) delete out[k];
  out.payments = { enabled: cashfreeConfigured(), provider: "cashfree", mode: cashfreeMode() };
  return out;
}

// Small key/value cache for integration state (e.g. the Shiprocket login token).
export async function getKv(key) {
  const rows = await query("SELECT value FROM settings WHERE key = $1", [key]);
  return rows.length ? rows[0].value : null;
}
export async function setKv(key, value) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}
