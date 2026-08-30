# Receiving payments safely (Binance + USDT)

## The secure model built in

- Your USDT deposit addresses live **only in the server config**. The website's HTML/JS never contains them.
- The QR code and the address you see on the payment page are **generated fresh by the server** at the moment you click "Pay". A hacker cannot "edit the QR to their own account" — there is nothing to edit in the page source, and the server uses a strict Content-Security-Policy that blocks injected scripts.
- The server **verifies the payment on-chain** (it watches the blockchain for USDT arriving at *your* address in the required amount) and unlocks the user only then. So even in a worst-case attack on the page, you never lose money — the money only ever goes where you control the wallet.
- Every payment page is served over **HTTPS only**, and every API call needs both a login session and a CSRF token.

## Set your addresses (the only step that sends you money)

Open **Owner panel → Receiving wallets** after deploying, then either:

1. **Auto-fetch from Binance** — the recommended way.
   - In Binance: **Settings → API Management → Create API**.
   - **Security must include "Enable Reading" (Read-Only) permission ONLY.** Never enable trading or withdrawals on this key.
   - Also turn on **"Restrict access to trusted IPs only"** and add your server's IP.
   - Put `BINANCE_API_KEY` and `BINANCE_API_SECRET` in the server env, then click the "Auto-fetch" buttons in the Owner panel.
   - Heads-up: Binance sometimes blocks cloud/datacenter IPs. If the fetch fails, just paste the address manually below.
2. **Manual** — open the Binance app → Wallet → **Deposit → USDT → choose the network** (TRON = TRC-20 recommended) → copy the deposit address → paste into the Owner panel.

⚠️ On Binance you get a **different address per network**. Paste each one into its correct box:
TRC-20 (starts with `T`), BEP-20 (`0x…`), ERC-20 (`0x…`). They are NOT interchangeable — sending on the wrong network loses the money.

## Payment confirmation

- **TRC-20** verifies automatically via the public Tron network explorer — no setup needed.
- **BEP-20 / ERC-20** auto-verify if you add a free API key (`BSCSCAN_API_KEY`, `ETHERSCAN_API_KEY`) from bscscan.com / etherscan.io. Without keys, confirm those payments manually in the Owner panel (you'll see the money arrive in Binance, then click **✓ Confirm**).

## Owners — never ship the `.env` file
It contains your keys. `.env` is already in `.gitignore`.