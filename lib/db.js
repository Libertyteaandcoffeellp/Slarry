// Postgres access. Production uses Neon (DATABASE_URL, added by the Vercel ↔ Neon integration).
// Tests swap in PGlite through setQueryImpl().
import { neon } from "@neondatabase/serverless";
import { HttpError } from "./http.js";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS orders (
     id             text PRIMARY KEY,
     created_at     timestamptz NOT NULL DEFAULT now(),
     updated_at     timestamptz NOT NULL DEFAULT now(),
     qty            integer NOT NULL,
     subtotal       numeric(10,2) NOT NULL,
     shipping       numeric(10,2) NOT NULL DEFAULT 0,
     total          numeric(10,2) NOT NULL,
     customer       jsonb NOT NULL,
     payment_status text NOT NULL DEFAULT 'pending',
     fulfillment    text NOT NULL DEFAULT 'unfulfilled',
     payment        jsonb NOT NULL DEFAULT '{}',
     shipment       jsonb NOT NULL DEFAULT '{}',
     notes          text NOT NULL DEFAULT '',
     test           boolean NOT NULL DEFAULT false,
     history        jsonb NOT NULL DEFAULT '[]'
   )`,
  `CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS settings (
     key        text PRIMARY KEY,
     value      jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`
];

let impl = null;
let ready = null;

export function setQueryImpl(fn) {
  impl = fn;
  ready = null;
}

export function databaseConfigured() {
  return !!(impl || process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

function getImpl() {
  if (impl) return impl;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new HttpError(503, "The order database isn't connected yet. Add a Neon database to this project in Vercel → Storage.");
  const sql = neon(url);
  impl = (text, params) => sql.query(text, params);
  return impl;
}

export async function query(text, params = []) {
  const run = getImpl();
  if (!ready) {
    ready = (async () => { for (const s of SCHEMA) await run(s, []); })();
    ready.catch(() => (ready = null));
  }
  await ready;
  return run(text, params);
}
