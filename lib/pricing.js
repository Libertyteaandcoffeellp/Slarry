// Server-side copy of the storefront pricing engine. The server never trusts a price sent by the browser.

export function priceFor(packs, n) {          // cheapest combination of bundles for n packs
  if (n <= 0) return 0;
  const tiers = packs.slice().sort((a, b) => a.qty - b.qty);
  const dp = [0];
  for (let i = 1; i <= n; i++) {
    let best = Infinity;
    for (const t of tiers) if (t.qty <= i) best = Math.min(best, dp[i - t.qty] + t.price);
    dp[i] = best;
  }
  return dp[n];
}

export function quote(settings, n) {
  const subtotal = priceFor(settings.packs, n);
  const s = settings.shipping || {};
  const free = s.freeAbove != null && subtotal >= Number(s.freeAbove);
  const shipping = n && !free ? Number(s.fee) || 0 : 0;
  return { subtotal, shipping, total: Math.round((subtotal + shipping) * 100) / 100 };
}
