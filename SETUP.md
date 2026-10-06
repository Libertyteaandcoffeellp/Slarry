# Diet Slim Tea: store backend setup

The shop is in `public/` and the backend in `api/` (Vercel Functions) plus `lib/`.
The admin panel is at **/admin**.

| What | Where |
| --- | --- |
| Orders: list, search, CSV export, status, notes | `/admin` → Orders |
| Payments | Cashfree (UPI, cards, net banking, wallets) |
| Shipping | Shiprocket: create shipment, courier/AWB, pickup, label, tracking |
| Website content: prices, WhatsApp, page text, FAQs, reviews, label, contact, policy links, tracking IDs | `/admin` → Website content |
| New-order emails | Resend → the admin email |

Until Cashfree is connected, checkout saves **test orders** (no money is taken), so you can try the whole flow first.

## 1. Connect the database (required)

Vercel → your project → **Storage** → **Create Database** → **Neon** (the free plan is enough) → connect it to this project.
This adds `DATABASE_URL` automatically. Tables are created on first use.

## 2. Environment variables

Vercel → project → **Settings → Environment Variables**. Add them for Production (and Preview if you test there),
then **redeploy** (Deployments → ⋯ → Redeploy) so they take effect.

| Name | Value |
| --- | --- |
| `ADMIN_PASSWORD` | A long password for the admin login (required) |
| `ADMIN_EMAIL` | Optional. Defaults to `armanshk612@gmail.com` |
| `AUTH_SECRET` | Optional. Any long random text. If set, changing the password doesn't log you out |
| `CASHFREE_APP_ID` | Cashfree → Developers → API Keys → App ID |
| `CASHFREE_SECRET_KEY` | Cashfree → Developers → API Keys → Secret Key |
| `CASHFREE_ENV` | `sandbox` for testing, `production` for real payments |
| `SHIPROCKET_EMAIL` | Email of a Shiprocket **API user** (Settings → API → Configure) |
| `SHIPROCKET_PASSWORD` | That API user's password |
| `RESEND_API_KEY` | Optional, for new-order emails (resend.com → API Keys) |
| `MAIL_FROM` | Optional, e.g. `Diet Slim Tea <orders@yourdomain.com>` once your domain is verified in Resend |

## 3. Cashfree

1. Use the **sandbox** keys and `CASHFREE_ENV=sandbox` first, and place a test payment.
2. In Cashfree → Developers → **Webhooks**, add `https://<your-site>/api/cashfree-webhook`
   (the exact URL is shown in Admin → Settings) for payment success, failed and user-dropped events.
3. Whitelist your website domain in Cashfree (Developers → Whitelisting) before going live.
4. Switch to the production keys and `CASHFREE_ENV=production`, then redeploy.

Payments are always confirmed by asking Cashfree's API. The browser and the webhook only trigger that check.

## 4. Shiprocket

1. Add your pickup address in Shiprocket → Settings → Pickup Addresses and note its name.
2. In Admin → Settings → Shipping defaults, set the **pickup location name**, pack weight and box size.
3. On a paid order, click **Create shipment in Shiprocket**, then **Schedule pickup** and **Get label**.
   Or turn on "create automatically when an order is paid".

## Run locally

```bash
npm install
npm run dev     # http://localhost:3000, admin password "admin", in-memory database
npm test        # API tests against an in-memory Postgres
```
