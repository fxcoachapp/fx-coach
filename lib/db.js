const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORAGE_MODE = (process.env.STORAGE || '').toLowerCase() || (process.env.UPSTASH_REDIS_REST_URL ? 'upstash' : 'file');

const upstash = STORAGE_MODE === 'upstash'
  ? { url: String(process.env.UPSTASH_REDIS_REST_URL).trim().replace(/\/$/, ''), token: String(process.env.UPSTASH_REDIS_REST_TOKEN).trim() }
  : null;

function filePath(key) {
  return path.join(DATA_DIR, String(key) + '.json');
}

function defaults(key) {
  if (key === 'config') return {};
  return [];
}

async function read(key) {
  if (upstash) {
    try {
      const res = await fetch(upstash.url + '/get/' + key, { headers: { Authorization: 'Bearer ' + upstash.token } });
      if (!res.ok) throw new Error('upstash ' + res.status);
      const j = await res.json();
      if (j.result === null || j.result === undefined) return defaults(key);
      return JSON.parse(j.result);
    } catch {
      return defaults(key);
    }
  }
  try {
    if (!fs.existsSync(filePath(key))) return defaults(key);
    return JSON.parse(fs.readFileSync(filePath(key), 'utf8'));
  } catch {
    return defaults(key);
  }
}

async function write(key, value) {
  const str = JSON.stringify(value);
  if (upstash) {
    const body = new URLSearchParams({ key: String(key), value: str });
    await fetch(upstash.url + '/set', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + upstash.token, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    return;
  }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath(key), JSON.stringify(value, null, 2));
}

async function flush() {
  await Promise.all(Object.values(collections).map((c) => c.persist()));
}

class Collection {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  async load() { this.rows = await read(this.name); }
  async persist() { await write(this.name, this.rows); }
  all() { return this.rows; }
  find(predicate) { return this.rows.find(predicate); }
  filter(predicate) { return this.rows.filter(predicate); }
  async push(item) { this.rows.push(item); await this.persist(); }
  async update(id, mutate) {
    const i = this.rows.findIndex((r) => (r.id !== undefined ? r.id === id : false));
    if (i >= 0) { mutate(this.rows[i]); await this.persist(); return true; }
    return false;
  }
  async updateWhere(predicate, mutate) {
    const i = this.rows.findIndex(predicate);
    if (i >= 0) { mutate(this.rows[i]); await this.persist(); return true; }
    return false;
  }
  async removeWhere(predicate) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !predicate(r));
    if (this.rows.length !== before) await this.persist();
  }
}

const collections = {
  users: new Collection('users'),
  trades: new Collection('trades'),
  payments: new Collection('payments'),
  config: new Collection('config')
};

const config = {
  get: (k) => (collections.config.all()[0] || {})[k],
  async set(k, v) {
    let obj = collections.config.all()[0] || {};
    obj[k] = v;
    if (collections.config.all().length === 0) collections.config.rows[0] = obj;
    else collections.config.rows[0] = obj;
    await collections.config.persist();
  }
};

const users = {
  all: () => collections.users.all(),
  findByEmail: (email) => collections.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()),
  findById: (id) => collections.users.find((u) => u.id === id),
  findByRefCode: (code) => collections.users.find((u) => u.refCode && String(u.refCode).toLowerCase() === String(code).toLowerCase()),
  async save(user) {
    const existing = collections.users.find((u) => u.id === user.id);
    if (existing) await collections.users.update(user.id, (r) => Object.assign(r, user));
    else await collections.users.push(user);
  },
  async update(id, mutate) { await collections.users.update(id, mutate); }
};

const trades = {
  all: () => collections.trades.all(),
  byUser: (userId) => collections.trades.filter((t) => t.userId === userId),
  findById: (id) => collections.trades.find((t) => t.id === id),
  async save(trade) {
    const existing = collections.trades.find((t) => t.id === trade.id);
    if (existing) await collections.trades.update(trade.id, (r) => Object.assign(r, trade));
    else await collections.trades.push(trade);
  },
  async remove(id) { await collections.trades.removeWhere((t) => t.id === id); }
};

const payments = {
  all: () => collections.payments.all(),
  byUser: (userId) => collections.payments.filter((p) => p.userId === userId),
  findById: (id) => collections.payments.find((p) => p.id === id),
  async save(payment) {
    const existing = collections.payments.find((p) => p.id === payment.id);
    if (existing) await collections.payments.update(payment.id, (r) => Object.assign(r, payment));
    else await collections.payments.push(payment);
  },
  async update(id, mutate) { await collections.payments.update(id, mutate); }
};

async function init() {
  for (const c of Object.values(collections)) await c.load();
}

module.exports = { init, flush, users, trades, payments, config, storageMode: STORAGE_MODE, hasUpstash: !!upstash };