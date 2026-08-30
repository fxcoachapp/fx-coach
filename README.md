# FX Coach — AI Forex Trading Co-Pilot

A forex / currency-trading web app with a **crypto paywall (USDT)**, automatic access lockout, live FX rates, a trade journal with an AI coach, and a position-size calculator. Google (Gmail) sign-in supported.

Built with **Node.js + Express** + optional Upstash Redis for durable data on free hosts.

## Run locally

```bash
npm install
npm start
```

Open **http://localhost:3000** — but first copy `.env.example` → `.env` and fill in at least `SESSION_SECRET` and `ADMIN_EMAIL` (your own email → that account becomes the owner/admin).

## How the money works (Binance / USDT)

1. New users get a **7-day free trial**.
2. To keep access they pay **$10 USD = 10 USDT/month** via crypto — your Binance deposit address.
3. On the payment page the user picks a network (**TRC-20 recommended**, BEP-20, ERC-20), scans the **server-generated QR** and sends USDT.
4. The server **watches the blockchain** for the money arriving at **your** address and unlocks the account automatically (~1 min). If auto-verify is unavailable you confirm manually in the Owner panel.
5. If a user doesn't renew, every data API returns `403 PAYMENT_REQUIRED` and pages redirect to the Plan page. **Lockout is enforced server-side — no way around it through the UI.**

### Security (the "hackers can't swap the QR" part)

- Your wallet addresses live **only in server config** — they never appear in page source or static files.
- QR codes are generated **server-side at request time** from that config. There is nothing in the HTML/JS a hacker could edit, and the site runs a strict Content-Security-Policy that **blocks all injected/inline scripts**.
- Everything is served over HTTPS only (Render), with HSTS, X-Frame-Options, no-referrer, `nosniff`, and `frame-ancestors none`.
- Every state-changing request needs a **CSRF token**; the login/trading endpoints are **rate-limited**; sessions are HttpOnly + SameSite; passwords are bcrypt-hashed.
- Even if someone tampered with their own screen, money can only ever be sent to the address **you** control — you never lose funds.

### Putting you in control

- **Owner panel** (`/app/admin.html`, only for `ADMIN_EMAIL`): live revenue, payments list, confirm/cancel payments, and set your USDT addresses per network.
- **"Auto-fetch from Binance"** buttons pull your real deposit address using a **read-only Binance API key** (never give the key trading/withdraw permissions).

## Features

| Page | What it does |
|---|---|
| Landing (`/`) | Marketing + $10/mo pricing |
| `/signup` / `/login` | Email+password **or Google (Gmail)** login |
| `/app/dashboard` | Live FX rates (Yahoo Finance), AI coach summary, plan status |
| `/app/journal` | Log trades; per-trade AI coaching + weekly pattern review |
| `/app/calculator` | Lot sizing from balance / risk % / stop |
| `/app/subscribe` | Choose USDT network → `/app/pay` |
| `/app/pay` | QR + address + memo, countdown, auto on-chain verification → instant unlock |
| `/app/admin` | Owner: revenue, payments, wallet addresses |

## Project structure

```
business market/
  server.js            Express app: security, auth (email + Google), payments, admin, all APIs
  lib/
    db.js              Storage adapter: JSON files (dev) or Upstash Redis (prod, survives restarts)
    subscription.js    Trial / paid / expired state machine
    forex.js           Live quotes via Yahoo Finance (with offline fallback)
    ai.js              AI coach: trade + journal review engine
    calculator.js      Position size calculator
    payments.js        Payment intents + on-chain verification (TRON, BSC, ETH)
    binance.js         Auto-fetch your Binance deposit address (read-only key)
    oauth.js           Google OAuth helpers
  public/              Frontend (no build step, all scripts external for CSP)
  docs/                GOOGLE_LOGIN_SETUP.md, BINANCE_PAYMENTS.md
  render.yaml          Render free-tier deployment blueprint
  Dockerfile
  data/                Local JSON storage (created automatically)
```

## Deploy online (Render, free)

1. **Durable data:** create a free DB at **upstash.com** → get `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Set `STORAGE=upstash`. This makes users/payments survive restarts (Render free disks are wiped on redeploy).
2. Push this folder to a GitHub repo.
3. On **render.com**: New → **Blueprint** → pick the repo (it reads `render.yaml`). Fill the env values it asks for:
   - `ADMIN_EMAIL` (your email → you become the owner)
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see `docs/GOOGLE_LOGIN_SETUP.md`)
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`
   - `BINANCE_API_KEY` / `BINANCE_API_SECRET` (read-only — see `docs/BINANCE_PAYMENTS.md`)
4. After deploy: open `/app/admin.html`, log in with your Google/email, **set your USDT addresses** (or click "Auto-fetch from Binance").
5. Update `GOOGLE_REDIRECT_URI` to your live URL.

## API overview (all locked behind login + subscription + CSRF)

- Auth: `POST /api/auth/signup|login|logout`, `GET /api/auth/me`, `GET /api/auth/google`, `GET /api/csrf`
- Payments: `POST /api/payments`, `GET /api/payments/:id`, `GET /api/payments/:id/qr`, `POST /api/payments/:id/check|cancel`
- Admin: `GET /api/admin/overview|payments|wallet`, `POST /api/admin/payments/:id/confirm|cancel`, `POST /api/admin/wallet`, `POST /api/admin/wallet/binance-fetch`
- Trading: `GET /api/quotes`, `GET|POST|DELETE /api/journal`, `GET /api/review/journal`, `POST /api/review/trade`, `POST /api/calculator`

## Disclaimer

Trading forex carries a high level of risk. FX Coach is an educational and analytical tool — not financial advice.