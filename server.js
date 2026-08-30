require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const bcrypt = require('bcryptjs');

const { init, users, trades, payments, config, storageMode, hasUpstash, read: dbRead } = require('./lib/db');
const { PLAN_PRICE, PLAN_CURRENCY, TRIAL_DAYS, REFERRAL_THRESHOLD, REFERRAL_BONUS_DAYS, accessStatus, renewalDate, extendPremium } = require('./lib/subscription');
const { getQuotes } = require('./lib/forex');
const marketLib = require('./lib/market');
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

class UpstashSessionStore extends session.Store {
  constructor(opts) {
    super();
    this.url = String(opts.url).trim().replace(/\/$/, '');
    this.token = String(opts.token).trim();
    this.prefix = 'fx:sess:';
    this.mem = new Map();
    this.missing = false;
  }
  _ttl(sess) {
    const c = sess && sess.cookie;
    if (c && typeof c.maxAge === 'number' && c.maxAge > 0) return Math.ceil(c.maxAge / 1000);
    if (c && c.expires) return Math.ceil((new Date(c.expires).getTime() - Date.now()) / 1000);
    return 30 * 24 * 60 * 60;
  }
  _auth() { return { Authorization: 'Bearer ' + this.token }; }
  _warn() {
    if (!this.missing) console.error('UPSTASH SESSION STORE FAILED — token/URL invalid or Out-of-region. Falling back to in-memory sessions.');
    this.missing = true;
  }
  get(sid, cb) {
    if (this.missing) return cb(null, this.mem.get(sid) || null);
    fetch(this.url + '/get/' + this.prefix + sid, { headers: this._auth(), signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j) => {
        const raw = j && j.result !== null && j.result !== undefined ? JSON.parse(j.result) : null;
        if (raw) {
          const exp = raw.cookie && raw.cookie.expires ? new Date(raw.cookie.expires).getTime() : 0;
          if (exp > 0 && exp <= Date.now()) {
            this.destroy(sid, () => {});
            return cb(null, null);
          }
          this.mem.set(sid, raw);
        }
        cb(null, raw);
      })
      .catch((e) => { this._warn(); cb(null, this.mem.get(sid) || null); });
  }
  set(sid, sess, cb) {
    this.mem.set(sid, sess);
    const val = encodeURIComponent(JSON.stringify(sess));
    const px = this._ttl(sess);
    fetch(this.url + '/set/' + encodeURIComponent(this.prefix + sid) + '/' + val + '/PX/' + px, {
      method: 'POST',
      headers: this._auth(),
      signal: AbortSignal.timeout(8000)
    }).then((r) => { if (!r.ok) throw new Error('upstash set ' + r.status); cb && cb(); })
      .catch((e) => { this._warn(); cb && cb(); });
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
  destroy(sid, cb) {
    this.mem.delete(sid);
    fetch(this.url + '/del/' + this.prefix + sid, { headers: this._auth(), signal: AbortSignal.timeout(8000) })
      .then(() => { cb && cb(); })
      .catch((e) => { this._warn(); cb && cb(); });
  }
}

async function probeUpstash() {
  const probeKey = 'fx:probe';
  try {
    const setRes = await fetch(
      process.env.UPSTASH_REDIS_REST_URL + '/set/' + probeKey + '/ok',
      { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN }, signal: AbortSignal.timeout(8000) }
    );
    if (!setRes.ok) return 'HTTP ' + setRes.status;
    const getRes = await fetch(process.env.UPSTASH_REDIS_REST_URL + '/get/' + probeKey, {
      headers: { Authorization: 'Bearer ' + process.env.UPSTASH_REDIS_REST_TOKEN },
      signal: AbortSignal.timeout(8000)
    });
    const j = await getRes.json();
    return j.result === 'ok' ? null : 'probe mismatch';
  } catch (e) {
    return String(e.message || e);
  }
}

const sessionStore = hasUpstash
  ? new UpstashSessionStore({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
  : null;

if (hasUpstash) {
  probeUpstash().then((err) => {
    if (err) console.error('UPSTASH PROBE FAILED (' + err + ') — check UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN in Render env.');
    else console.log('UPSTASH OK — sessions persist across restarts.');
  });
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  rolling: false,
  store: sessionStore || undefined,
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

function makeRefCode() {
  let code;
  do { code = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (users.findByRefCode(code));
  return code;
}

function applyRemember(session, remember) {
  if (remember) session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
  else { session.cookie.maxAge = null; session.cookie.expires = null; }
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
    refCode: user.refCode,
    confirmedRefs: user.confirmedRefs || 0,
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
    refCode: makeRefCode(),
    refBy: req.body && req.body.ref ? (users.findByRefCode(String(req.body.ref).trim()) ? String(req.body.ref).trim() : null) : null,
    confirmedRefs: 0,
    createdAt: new Date().toISOString()
  };
  await users.save(user);
  req.session.regenerate((regErr) => {
    if (regErr) return res.status(500).json({ error: 'Could not start session.' });
    req.session.userId = user.id;
    applyRemember(req.session, !!req.body.remember);
    res.json({ ok: true, user: publicUser(user) });
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = users.findByEmail(email);
  if (!user || !user.passwordHash || !(await bcrypt.compare(String(password || ''), user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  req.session.regenerate((regErr) => {
    if (regErr) return res.status(500).json({ error: 'Could not start session.' });
    req.session.userId = user.id;
    applyRemember(req.session, !!req.body.remember);
    res.json({ ok: true, user: publicUser(user) });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', apiUser, async (req, res) => {
  const user = users.findById(req.user.id);
  if (user && !user.refCode) { user.refCode = makeRefCode(); await users.save(user); }
  res.json({
    user: publicUser(user),
    plan: { price: PLAN_PRICE, currency: PLAN_CURRENCY, trialDays: TRIAL_DAYS },
    walletConfigured: Object.values(paymentsLib.walletConfig()).some(Boolean)
  });
});

app.get('/api/referrals', apiUser, async (req, res) => {
  const me = users.findById(req.user.id);
  if (!me) return res.status(401).json({ error: 'Not logged in.' });
  if (!me.refCode) { me.refCode = makeRefCode(); await users.save(me); }
  const invited = users.all()
    .filter((u) => u.refBy && String(u.refBy).toLowerCase() === String(me.refCode).toLowerCase())
    .map((u) => ({ email: u.email, name: u.name, status: accessStatus(u), paid: u.plan === 'active', createdAt: u.createdAt }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({
    code: me.refCode,
    link: req.protocol + '://' + req.get('host') + '/signup.html?ref=' + me.refCode,
    confirmed: me.confirmedRefs || 0,
    threshold: REFERRAL_THRESHOLD,
    bonusDays: REFERRAL_BONUS_DAYS,
    invited
  });
});

function oauthStateFor(remember) {
  const rnd = crypto.randomBytes(12).toString('hex');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev-secret-change-me').update(rnd).digest('hex').slice(0, 24);
  return rnd + ':' + sig + ':' + (remember ? 'R' : 'T');
}

function verifyOAuthState(state) {
  const parts = String(state || '').split(':');
  if (parts.length !== 3) return null;
  const [rnd, sig, tag] = parts;
  const expect = crypto.createHmac('sha256', process.env.SESSION_SECRET || 'dev-secret-change-me').update(rnd).digest('hex').slice(0, 24);
  if (sig !== expect) return null;
  return tag === 'R';
}

app.get('/api/auth/google', (req, res) => {
  const state = oauthStateFor(req.query.remember === '1');
  const redirectUri = req.protocol + '://' + req.get('host') + '/api/auth/google/callback';
  const url = oauth.authUrl(state, redirectUri);
  if (!url) return res.redirect('/login.html?error=not_configured');
  res.redirect(url);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/login.html?error=google_denied');
  const remember = verifyOAuthState(state);
  if (remember === null) return res.redirect('/login.html?error=bad_state');
  try {
    const redirectUri = req.protocol + '://' + req.get('host') + '/api/auth/google/callback';
    const tokens = await oauth.exchangeCode(code, redirectUri);
    const profile = await oauth.fetchProfile(tokens);
    const user = await oauth.upsertGoogleUser(profile);
    req.session.regenerate((regErr) => {
      if (regErr) return res.redirect('/login.html?error=google_failed&detail=session');
      req.session.userId = user.id;
      applyRemember(req.session, remember);
      res.redirect('/app/dashboard.html');
    });
  } catch (e) {
    console.error('GOOGLE OAUTH ERROR:', e.message);
    res.redirect('/login.html?error=google_failed&detail=' + encodeURIComponent(String(e.message || 'unknown').slice(0, 200)));
  }
});

app.get('/api/quotes', apiUser, apiAccess, async (req, res) => {
  res.json(await getQuotes());
});

app.get('/api/market', apiUser, apiAccess, async (req, res) => {
  const quotesData = await getQuotes();
  res.json(marketLib.analyze(quotesData.quotes));
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
  let persisted = true;
  if (hasUpstash) {
    try {
      const ver = await dbRead('config');
      const arr = Array.isArray(ver) ? ver : [];
      const stored = arr[0] && arr[0].wallet ? arr[0].wallet : {};
      persisted = Object.keys(next).every((k) => String(stored[k] || '') === String(next[k]));
    } catch { persisted = false; }
  }
  if (!persisted) console.error('[wallet] SAVE NOT DURABLE — Upstash write did not stick. Check UPSTASH_REDIS_REST_URL/TOKEN.');
  res.json({ wallet: paymentsLib.walletConfig(), persisted });
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

app.post('/api/admin/wallet/binance-fetch-all', apiUser, requireAdmin, async (req, res) => {
  const wallet = paymentsLib.walletConfig();
  const results = [];
  for (const network of ['TRC20', 'BEP20', 'ERC20']) {
    try {
      const data = await fetchDepositAddress('USDT', network);
      const key = network === 'BEP20' && !data.address ? data : null;
      const address = (key && key.address) || data.address || '';
      if (address) { wallet[network] = address; results.push({ network, ok: true, address }); }
      else results.push({ network, ok: false, error: 'Binance returned no address for this network.' });
    } catch (e) {
      results.push({ network, ok: false, error: e.message });
    }
  }
  await config.set('wallet', wallet);
  res.json({ ok: true, results, wallet: paymentsLib.walletConfig() });
});

app.get('/api/admin/users', apiUser, requireAdmin, (req, res) => {
  res.json({
    users: users.all().map((u) => {
      const paidTotal = payments.all()
        .filter((p) => p.userId === u.id && p.status === 'paid')
        .reduce((s, p) => s + p.amount, 0);
      const invites = users.all()
        .filter((x) => x.refBy && String(x.refBy).toLowerCase() === String(u.refCode || '').toLowerCase()).length;
      return {
        email: u.email,
        name: u.name,
        provider: u.provider || 'email',
        plan: u.plan,
        status: accessStatus(u),
        planEnds: u.planEnds,
        trialEnds: u.trialEnds,
        confirmedRefs: u.confirmedRefs || 0,
        invites,
        paidTotal,
        createdAt: u.createdAt
      };
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  });
});

app.post('/api/admin/revoke-vip', apiUser, requireAdmin, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Enter a valid email.' });
  const user = users.findByEmail(email);
  if (!user) return res.status(404).json({ error: 'No account with that email.' });
  user.plan = 'expired';
  user.planEnds = null;
  await users.save(user);
  res.json({ ok: true, user: { email: user.email, name: user.name, status: accessStatus(user) } });
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

app.post('/api/admin/grant-vip', apiUser, requireAdmin, async (req, res) => {
  const { email, days } = req.body || {};
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
    return res.status(400).json({ error: 'Enter a valid email.' });
  }
  const user = users.findByEmail(email);
  if (!user) return res.status(404).json({ error: 'No account with that email.' });
  const d = Math.min(parseInt(days, 10) || 30, 3650);
  extendPremium(user, d);
  await users.save(user);
  res.json({ ok: true, user: { email: user.email, name: user.name, plan: user.plan, planEnds: user.planEnds, status: accessStatus(user) } });
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
  const w = paymentsLib.walletConfig();
  const nets = Object.keys(paymentsLib.NETWORKS)
    .map((n) => n + '=' + (paymentsLib.addressFor(n) ? 'set' : 'not-set'))
    .join(' ');
  console.log('[wallet] ' + (nets || 'no networks') + (hasUpstash && storageMode === 'upstash' ? ' (upstash)' : ''));
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