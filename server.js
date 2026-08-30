require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');

const { init, users, trades, payments, config, storageMode, hasUpstash } = require('./lib/db');
const { PLAN_PRICE, PLAN_CURRENCY, TRIAL_DAYS, accessStatus, renewalDate } = require('./lib/subscription');
const { getQuotes } = require('./lib/forex');
const { reviewTrade, reviewJournal } = require('./lib/ai');
const { PAIRS, positionSize } = require('./lib/calculator');
const paymentsLib = require('./lib/payments');
const { fetchDepositAddress } = require('./lib/binance');
const oauth = require('./lib/oauth');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD) app.set('trust proxy', 1);
if (!process.env.SESSION_SECRET) console.warn('⚠ SESSION_SECRET not set — using temporary dev secret. Set one before going live.');

app.disable('x-powered-by');
app.set('etag', false);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: IS_PROD ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" }
}));
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
}));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const payLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth', authLimiter);
app.use('/api/payments', payLimiter);

function isAdminEmail(email) {
  return !!process.env.ADMIN_EMAIL && String(process.env.ADMIN_EMAIL).toLowerCase() === String(email).toLowerCase();
}

function currentUser(req) {
  if (!req.session.userId) return null;
  return users.findById(req.session.userId);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    admin: isAdminEmail(user.email),
    provider: user.provider || 'email',
    plan: user.plan,
    status: accessStatus(user),
    trialEnds: user.trialEnds,
    planEnds: user.planEnds,
    watchlist: user.watchlist || [],
    createdAt: user.createdAt
  };
}

function apiUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  req.user = user;
  next();
}

function apiAccess(req, res, next) {
  const status = accessStatus(req.user);
  if (status !== 'active' && status !== 'trial') {
    return res.status(403).json({ error: 'Subscription expired. Renew to restore access.', code: 'PAYMENT_REQUIRED' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!isAdminEmail(req.user.email)) return res.status(403).json({ error: 'Admin only.' });
  next();
}

function csrfProtect(req, res, next) {
  if (req.path.startsWith('/api/auth/google')) return next();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    if (!req.session.csrf || req.headers['x-csrf-token'] !== req.session.csrf) {
      return res.status(403).json({ error: 'Security token missing or expired. Refresh the page.' });
    }
  }
  next();
}
app.use('/api', csrfProtect);

app.get('/api/csrf', (req, res) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.cookie('csrf', req.session.csrf, {
    httpOnly: false, sameSite: 'lax', secure: IS_PROD, maxAge: 1000 * 60 * 60 * 24
  });
  res.json({ token: req.session.csrf });
});

const gateApp = (req, res, next) => {
  if (!req.session.userId) return res.redirect('/login.html');
  if (req.url.startsWith('/subscribe')) return next();
  if (req.url.startsWith('/pay')) return next();
  if (req.url.startsWith('/admin')) {
    const user = users.findById(req.session.userId);
    if (user && isAdminEmail(user.email)) return next();
    return res.redirect('/app/dashboard.html');
  }
  const user = users.findById(req.session.userId);
  const status = accessStatus(user);
  if (status === 'active' || status === 'trial') return next();
  res.redirect('/app/subscribe.html');
};

app.use('/app', gateApp);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !String(name).trim() || String(name).length > 80) return res.status(400).json({ error: 'Enter your name.' });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return res.status(400).json({ error: 'Enter a valid email.' });
  if (!password || String(password).length < 6 || String(password).length > 200) return res.status(400).json({ error: 'Password must be 6+ characters.' });
  if (users.findByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists.' });

  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: String(email).toLowerCase().trim(),
    passwordHash: await bcrypt.hash(String(password), 10),
    admin: !!process.env.ADMIN_EMAIL && String(process.env.ADMIN_EMAIL).toLowerCase() === String(email).toLowerCase(),
    plan: 'trial',
    trialEnds: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    planEnds: null,
    watchlist: ['EURUSD', 'GBPUSD', 'USDJPY'],
    createdAt: new Date().toISOString()
  };
  await users.save(user);
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.findByEmail(email);
  if (!user || !user.passwordHash || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  req.session.userId = user.id;
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', apiUser, (req, res) => {
  res.json({
    user: publicUser(req.user),
    plan: { price: PLAN_PRICE, currency: PLAN_CURRENCY, trialDays: TRIAL_DAYS },
    walletConfigured: Object.values(paymentsLib.walletConfig()).some(Boolean)
  });
});

app.get('/api/auth/google', (req, res) => {
  const state = oauth.randomState();
  req.session.oauthState = state;
  const redirectUri = req.protocol + '://' + req.get('host') + '/api/auth/google/callback';
  const url = oauth.authUrl(state, redirectUri);
  if (!url) return res.redirect('/login.html?error=not_configured');
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/login.html?error=google_denied');
  if (!state || state !== req.session.oauthState) return res.redirect('/login.html?error=bad_state');
  try {
    const redirectUri = req.protocol + '://' + req.get('host') + '/api/auth/google/callback';
    const tokens = await oauth.exchangeCode(code, redirectUri);
    const profile = await oauth.fetchProfile(tokens);
    const user = await oauth.upsertGoogleUser(profile);
    req.session.userId = user.id;
    res.redirect('/app/dashboard.html');
  } catch (e) {
    console.error('GOOGLE OAUTH ERROR:', e.message);
    res.redirect('/login.html?error=google_failed&detail=' + encodeURIComponent(String(e.message || 'unknown').slice(0, 200)));
  }
});

app.get('/api/quotes', apiUser, apiAccess, async (req, res) => {
  res.json(await getQuotes());
});

app.get('/api/payments/networks', apiUser, (req, res) => {
  res.json({
    networks: Object.entries(paymentsLib.NETWORKS).map(([key, n]) => ({
      key, label: n.label, short: n.short,
      configured: !!paymentsLib.addressFor(key),
      recommended: key === 'TRC20'
    }))
  });
});

app.post('/api/payments', apiUser, async (req, res) => {
  const network = String((req.body || {}).network || 'TRC20').toUpperCase();
  if (!paymentsLib.NETWORKS[network]) return res.status(400).json({ error: 'Unknown payment network.' });
  if (accessStatus(req.user) === 'active') return res.status(400).json({ error: 'You already have an active plan.' });
  let pending = payments.byUser(req.user.id).find((p) => p.network === network && p.status === 'pending' && !paymentsLib.isExpired(p));
  if (!pending) {
    try {
      pending = await paymentsLib.createPayment(req.user, network);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  res.json({ payment: pending });
});

app.get('/api/payments/:id', apiUser, (req, res) => {
  const p = payments.findById(req.params.id);
  if (!p || p.userId !== req.user.id) return res.status(404).json({ error: 'Payment not found.' });
  res.json({ payment: p, network: paymentsLib.NETWORKS[p.network] });
});

app.get('/api/payments/:id/qr', apiUser, async (req, res) => {
  const p = payments.findById(req.params.id);
  if (!p || p.userId !== req.user.id) return res.status(404).json({ error: 'Payment not found.' });
  const text = p.network === 'TRC20'
    ? p.address + '\n(USDT TRC-20 · Add memo ' + p.memo + ' to help match)'
    : p.address + '\n(USDT ' + p.network + ')';
  const buf = await QRCode.toBuffer(text, { type: 'png', width: 340, margin: 1, color: { dark: '#0b1020', light: '#ffffff' } });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.send(buf);
});

app.post('/api/payments/:id/check', apiUser, async (req, res) => {
  const p = payments.findById(req.params.id);
  if (!p || p.userId !== req.user.id) return res.status(404).json({ error: 'Payment not found.' });
  const result = await paymentsLib.verifyPayment(p);
  res.json({ result, payment: payments.findById(p.id) });
});

app.post('/api/payments/:id/cancel', apiUser, async (req, res) => {
  const p = payments.findById(req.params.id);
  if (!p || p.userId !== req.user.id) return res.status(404).json({ error: 'Payment not found.' });
  if (p.status === 'pending') { p.status = 'cancelled'; await payments.save(p); }
  res.json({ ok: true, payment: p });
});

app.get('/api/admin/payments', apiUser, requireAdmin, (req, res) => {
  const list = payments.all().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map((p) => {
    const u = users.findById(p.userId);
    return { ...p, userEmail: u ? u.email : p.userId };
  });
  res.json({ payments: list });
});

app.post('/api/admin/payments/:id/confirm', apiUser, requireAdmin, async (req, res) => {
  const p = payments.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Payment not found.' });
  await paymentsLib.confirmPayment(p);
  res.json({ ok: true, payment: payments.findById(p.id) });
});

app.post('/api/admin/payments/:id/cancel', apiUser, requireAdmin, async (req, res) => {
  const p = payments.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Payment not found.' });
  p.status = 'cancelled';
  await payments.save(p);
  res.json({ ok: true });
});

app.get('/api/admin/wallet', apiUser, requireAdmin, (req, res) => {
  res.json({ wallet: paymentsLib.walletConfig() });
});

app.post('/api/admin/wallet', apiUser, requireAdmin, async (req, res) => {
  const b = req.body || {};
  const next = {};
  for (const key of Object.keys(paymentsLib.NETWORKS)) {
    const v = String(b[key] || '').trim();
    if (v && v.length > 120) return res.status(400).json({ error: 'Invalid address for ' + key });
    if (v) next[key] = v;
  }
  await config.set('wallet', next);
  res.json({ wallet: paymentsLib.walletConfig() });
});

app.post('/api/admin/wallet/binance-fetch', apiUser, requireAdmin, async (req, res) => {
  const network = String((req.body || {}).network || '').toUpperCase();
  if (!paymentsLib.NETWORKS[network]) return res.status(400).json({ error: 'Unknown network.' });
  try {
    const data = await fetchDepositAddress('USDT', network);
    const wallet = paymentsLib.walletConfig();
    const key = network === 'BEP20' && !data.address ? data : null;
    wallet[network] = (key && key.address) || data.address || '';
    await config.set('wallet', wallet);
    res.json({ ok: true, address: wallet[network], network });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/admin/users', apiUser, requireAdmin, (req, res) => {
  res.json({
    users: users.all().map((u) => ({
      email: u.email,
      name: u.name,
      provider: u.provider || 'email',
      plan: u.plan,
      status: accessStatus(u),
      createdAt: u.createdAt
    })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  });
});

app.get('/api/admin/overview', apiUser, requireAdmin, (req, res) => {
  const all = users.all();
  const count = (pred) => all.filter(pred).length;
  res.json({
    users: all.length,
    active: count((u) => accessStatus(u) === 'active'),
    trial: count((u) => accessStatus(u) === 'trial'),
    expired: count((u) => accessStatus(u) === 'expired'),
    paidRevenueUSDT: payments.all().filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0),
    pendingPayments: payments.all().filter((p) => p.status === 'pending').length,
    storage: storageMode,
    upstash: hasUpstash
  });
});

app.get('/api/journal', apiUser, apiAccess, (req, res) => {
  const list = trades.byUser(req.user.id).sort((a, b) => new Date(b.openedAt) - new Date(a.openedAt));
  res.json({ trades: list });
});

app.post('/api/journal', apiUser, apiAccess, async (req, res) => {
  const b = req.body || {};
  const pair = String(b.pair || '').toUpperCase();
  const direction = b.direction === 'sell' ? 'sell' : 'buy';
  const entry = parseFloat(b.entry);
  const exit = b.exit === '' || b.exit == null ? null : parseFloat(b.exit);
  const stopLoss = b.stopLoss === '' || b.stopLoss == null ? null : parseFloat(b.stopLoss);
  const takeProfit = b.takeProfit === '' || b.takeProfit == null ? null : parseFloat(b.takeProfit);
  const lots = b.lots === '' || b.lots == null ? null : parseFloat(b.lots);

  if (!PAIRS.includes(pair)) return res.status(400).json({ error: 'Unknown currency pair.' });
  if (!isFinite(entry) || entry <= 0) return res.status(400).json({ error: 'Enter a valid entry price.' });
  if (exit !== null && !isFinite(exit)) return res.status(400).json({ error: 'Enter a valid exit price.' });
  if (stopLoss !== null && !isFinite(stopLoss)) return res.status(400).json({ error: 'Enter a valid stop loss.' });

  const trade = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    pair,
    direction,
    entry,
    exit,
    stopLoss,
    takeProfit: takeProfit !== null && isFinite(takeProfit) ? takeProfit : null,
    lots,
    notes: String(b.notes || '').slice(0, 500),
    openedAt: b.openedAt || new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  await trades.save(trade);
  res.json({ ok: true, trade });
});

app.delete('/api/journal/:id', apiUser, apiAccess, async (req, res) => {
  const t = trades.findById(req.params.id);
  if (!t || t.userId !== req.user.id) return res.status(404).json({ error: 'Trade not found.' });
  await trades.remove(t.id);
  res.json({ ok: true });
});

app.post('/api/review/trade', apiUser, apiAccess, (req, res) => {
  res.json({ review: reviewTrade(req.body || {}) });
});

app.get('/api/review/journal', apiUser, apiAccess, (req, res) => {
  res.json({ review: reviewJournal(trades.byUser(req.user.id)) });
});

app.post('/api/calculator', apiUser, apiAccess, (req, res) => {
  res.json(positionSize(req.body || {}));
});

app.post('/api/subscribe/simulate-nonpayment', apiUser, async (req, res) => {
  req.user.plan = 'expired';
  await users.save(req.user);
  res.json({ ok: true, user: publicUser(req.user) });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

init().then(() => {
  if (hasUpstash && storageMode === 'upstash') {
    setInterval(() => paymentsLib.checkAllPending(), 60 * 1000);
  }
  setInterval(() => paymentsLib.checkAllPending(), 90 * 1000);
  app.listen(PORT, () => {
    console.log('FX Coach running at http://localhost:' + PORT + ' (storage: ' + storageMode + ')');
  });
}).catch((e) => {
  console.error('Failed to init storage:', e);
  process.exit(1);
});