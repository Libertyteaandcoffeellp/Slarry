// Local preview: serves public/ and the /api functions with an in-memory database.
//   node scripts/dev-server.js   →  http://localhost:3000  (admin: /admin, password "admin")
// Payments run in test mode unless CASHFREE_* variables are set.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { setQueryImpl } from "../lib/db.js";

const root = fileURLToPath(new URL("..", import.meta.url));
process.env.ADMIN_PASSWORD ||= "admin";
if (!process.env.DATABASE_URL) {
  const pg = new PGlite();
  setQueryImpl(async (text, params) => (await pg.query(text, params)).rows);
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".avif": "image/avif", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT) || 3000;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + port);
  try {
    if (url.pathname.startsWith("/api/")) {
      const mod = await import(join(root, normalize(url.pathname).replace(/\/$/, "") + ".js"));
      const fn = mod[req.method];
      if (!fn) { res.writeHead(405).end(); return; }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await fn(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }));
      // Local http can't keep Secure cookies, so drop the flag here only.
      const headers = Object.fromEntries(r.headers);
      if (headers["set-cookie"]) headers["set-cookie"] = headers["set-cookie"].replace("; Secure", "");
      res.writeHead(r.status, headers).end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let p = normalize(decodeURIComponent(url.pathname));
    if (p.endsWith("/")) p += "index.html";
    const file = join(root, "public", p);
    if (!file.startsWith(join(root, "public"))) throw Object.assign(new Error(), { code: "ENOENT" });
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(data);
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ERR_MODULE_NOT_FOUND") console.error(err);
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => console.log("Diet Slim Tea running at http://localhost:" + port + "  (admin password: " + process.env.ADMIN_PASSWORD + ")"));
