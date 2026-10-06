// GET /api/admin/orders?filter=&q=&page= — order list + dashboard numbers. Add &format=csv to download.
import { handle, json } from "../../lib/http.js";
import { requireAdmin } from "../../lib/auth.js";
import { listOrders, orderStats, toCsv } from "../../lib/orders.js";

const PAGE = 50;

export const GET = handle(async request => {
  requireAdmin(request);
  const p = new URL(request.url).searchParams;
  const filter = p.get("filter") || "all", q = p.get("q") || "";
  if (p.get("format") === "csv") {
    const { orders } = await listOrders({ filter, q, limit: 500 });
    return new Response(toCsv(orders), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store"
      }
    });
  }
  const page = Math.max(1, Number(p.get("page")) || 1);
  const [list, stats] = await Promise.all([listOrders({ filter, q, limit: PAGE, offset: (page - 1) * PAGE }), orderStats()]);
  return json({ ...list, page, pageSize: PAGE, stats });
});
