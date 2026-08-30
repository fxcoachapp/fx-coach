const crypto = require('crypto');
const { PLAN_PRICE } = require('./subscription');
const { payments, users, config } = require('./db');

const NETWORKS = {
  TRC20: { label: 'TRON Network', short: 'TRC-20', explorer: 'https://tronscan.org/#/transaction/', decimals: 6, depositMatch: 'TRX' },
  BEP20: { label: 'BNB Smart Chain', short: 'BEP-20', explorer: 'https://bscscan.com/tx/', decimals: 18 },
  ERC20: { label: 'Ethereum Network', short: 'ERC-20', explorer: 'https://etherscan.io/tx/', decimals: 18 }
};

const EXPIRE_MS = 2 * 60 * 60 * 1000;

function walletConfig() {
  return config.get('wallet') || {};
}

function addressFor(network) {
  const w = walletConfig();
  return w[network] && String(w[network]).trim() ? String(w[network]).trim() : null;
}

function createIntent(user, network) {
  const address = addressFor(network);
  if (!address) return null;
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    userId: user.id,
    network,
    coin: 'USDT',
    amount: PLAN_PRICE,
    address,
    status: 'pending',
    memo: crypto.randomBytes(5).toString('hex').toUpperCase(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EXPIRE_MS).toISOString(),
    confirmedTx: null,
    confirmedAt: null
  };
}

function isExpired(p) {
  return new Date(p.expiresAt).getTime() < Date.now();
}

async function createPayment(user, network) {
  const intent = createIntent(user, network);
  if (!intent) throw new Error('Payment method for this network is not configured yet.');
  await payments.save(intent);
  return intent;
}

async function confirmPayment(payment) {
  payment.status = 'paid';
  payment.confirmedAt = new Date().toISOString();
  await payments.save(payment);
  const user = users.findById(payment.userId);
  if (user) {
    const { renewalDate } = require('./subscription');
    user.plan = 'active';
    user.planEnds = renewalDate(user.planEnds);
    await users.save(user);
  }
}

async function verifyPayment(payment) {
  if (payment.status === 'paid') return { paid: true, tx: payment.confirmedTx, already: true };
  if (isExpired(payment)) { payment.status = 'expired'; await payments.save(payment); return { paid: false, expired: true }; }
  if (payment.network === 'TRC20') return verifyTron(payment);
  if (payment.network === 'BEP20') return verifyBsc(payment);
  if (payment.network === 'ERC20') return verifyEth(payment);
  return { paid: false, error: 'Unsupported network' };
}

async function verifyTron(payment) {
  try {
    const url = 'https://api.trongrid.io/v1/accounts/' + payment.address + '/transactions/trc20'
      + '?only_confirmed=true&limit=50&order_by=block_timestamp,desc&min_timestamp=' + (new Date(payment.createdAt).getTime());
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const j = await res.json();
      const hit = await matchTronRows(j.data || [], payment);
      if (hit.paid) return hit;
      if ((j.data || []).length) return { paid: false, count: (j.data || []).length };
    }
  } catch (e) { /* fall through to tronscan */ }

  try {
    const url = 'https://apilist.tronscanapi.com/api/token_trc20/transfers'
      + '?limit=20&relatedAddress=' + payment.address + '&start_timestamp=' + (new Date(payment.createdAt).getTime())
      + '&end_timestamp=' + (new Date().getTime() + 60000);
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const j = await res.json();
      const hit = await matchTronRows(j.data || j.token_transfers || [], payment);
      if (hit.paid) return hit;
      return { paid: false, count: (j.data || j.token_transfers || []).length };
    }
  } catch (e2) { /* give up gracefully */ }

  return { paid: false, error: 'Explorer unreachable — ask the owner to confirm manually (they see the payment in Binance).' };
}

async function matchTronRows(rows, payment) {
  for (const t of rows || []) {
    const to = t.to || t.toAddress;
    const from = t.from || t.fromAddress;
    const symbol = (t.token_info && t.token_info.symbol) || t.tokenSymbol || t.symbol;
    const value = t.value !== undefined ? Number(t.value) / Math.pow(10, 6) : Number(t.quant || 0);
    if (to && String(to).toLowerCase() === String(payment.address).toLowerCase() &&
        String(from).toLowerCase() !== String(payment.address).toLowerCase() &&
        symbol === 'USDT' && value >= payment.amount - 0.01) {
      payment.confirmedTx = t.transaction_id || t.hash || t.transactionHash;
      payment.confirmedTx = String(payment.confirmedTx || '').split('&')[0];
      await confirmPayment(payment);
      return { paid: true, tx: payment.confirmedTx, value };
    }
  }
  return { paid: false, count: (rows || []).length };
}

async function verifyEthLike(payment, apiKey, base) {
  if (!apiKey) return { paid: false, error: 'Explorer key not configured (manual confirmation available)' };
  try {
    const url = base + '?module=account&action=tokenlist&address=' + payment.address + '&apikey=' + apiKey;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    const rows = (j.result || []).filter((t) =>
      t && String(t.to).toLowerCase() === String(payment.address).toLowerCase() &&
      String(t.from).toLowerCase() !== String(payment.address).toLowerCase() && t.symbol === 'USDT');
    for (const tx of rows) {
      const value = Number(tx.value) / Math.pow(10, 18);
      if (value >= payment.amount - 0.01) {
        payment.confirmedTx = tx.hash;
        await confirmPayment(payment);
        return { paid: true, tx: tx.hash, value };
      }
    }
    return { paid: false, count: rows.length };
  } catch (e) {
    return { paid: false, error: e.message };
  }
}

async function verifyBsc(payment) {
  return verifyEthLike(payment, process.env.BSCSCAN_API_KEY || '', 'https://api.bscscan.com/api');
}

async function verifyEth(payment) {
  return verifyEthLike(payment, process.env.ETHERSCAN_API_KEY || '', 'https://api.etherscan.io/api');
}

async function checkAllPending() {
  const pending = payments.all().filter((p) => p.status === 'pending');
  for (const p of pending) await verifyPayment(p);
}

module.exports = { NETWORKS, walletConfig, addressFor, createPayment, verifyPayment, confirmPayment, checkAllPending, isExpired };