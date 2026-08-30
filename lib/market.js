const SESSIONS = [
  { key: 'asia', name: 'Asia / Tokyo', open: 22, close: 7, note: 'USDJPY, AUDUSD and NZDUSD are the most active here.' },
  { key: 'london', name: 'London open', open: 7, close: 11, note: 'The pound and euro pairs (EURUSD, GBPUSD) and gold (XAUUSD) wake up here.' },
  { key: 'ny', name: 'New York open', open: 12, close: 16, note: 'USD pairs and gold (XAUUSD) spike at 12:00 UTC — high volatility, good momentum.' },
  { key: 'overlap', name: 'London + New York overlap', open: 12, close: 16, note: 'The busiest hours of the trading day. EURUSD and GBPUSD are most active.' }
];

const PAIR_WINDOW = {
  EURUSD: 'london', GBPUSD: 'london', XAUUSD: 'ny', USDCAD: 'ny', USDJPY: 'asia',
  AUDUSD: 'asia', USDCHF: 'london', NZDUSD: 'asia', USDTRY: 'ny', USDMXN: 'ny'
};

const VOLATILITY = {
  EURUSD: 0.45, GBPUSD: 0.6, USDJPY: 0.55, USDCAD: 0.45, AUDUSD: 0.55,
  USDCHF: 0.45, NZDUSD: 0.55, XAUUSD: 1.1, USDTRY: 0.7, USDMXN: 0.7
};

function hourIndex(h) {
  while (h < 0) h += 24;
  return h % 24;
}

function minutesOpen() {
  const n = new Date();
  return n.getUTCHours() * 60 + n.getUTCMinutes();
}

function windowState(w) {
  const now = minutesOpen();
  const openMin = hourIndex(w.open) * 60;
  const closeMin = hourIndex(w.close) * 60;
  let inSession;
  if (w.open < w.close) inSession = now >= openMin && now < closeMin;
  else inSession = now >= openMin || now < closeMin;

  let untilOpen;
  if (inSession) untilOpen = 0;
  else if (w.open < w.close) {
    untilOpen = now < openMin ? openMin - now : (24 * 60 - now) + openMin;
  } else {
    untilOpen = now < openMin ? openMin - now : openMin + (24 * 60 - now);
  }
  untilOpen = Math.max(0, untilOpen);

  let untilClose;
  if (inSession) {
    if (w.open < w.close) untilClose = closeMin - now;
    else untilClose = now < closeMin ? closeMin - now : (24 * 60 - now) + closeMin;
    untilClose = Math.max(0, untilClose);
  } else {
    untilClose = null;
  }
  return { active: inSession, untilOpen, untilClose };
}

function fmtMin(m) {
  if (m === null || m === undefined) return '';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return (h > 0 ? h + 'h ' : '') + mm + 'm';
}

function scoreFor(q) {
  const scale = VOLATILITY[q.symbol] || 0.5;
  const raw = Math.abs(q.changePercent || 0) / scale;
  return Math.round(Math.min(100, raw * 100));
}

function analyze(quotes) {
  const now = new Date();
  const scored = quotes
    .map((q) => ({ q, score: scoreFor(q), dir: q.changePercent >= 0 ? 'up' : 'down' }))
    .sort((a, b) => b.score - a.score);

  const windows = SESSIONS.map((w) => {
    const st = windowState(w);
    return {
      key: w.key,
      name: w.name,
      note: w.note,
      active: st.active,
      opensIn: st.active ? null : fmtMin(st.untilOpen),
      closesIn: st.active ? fmtMin(st.untilClose) : null,
      pairs: quotes.map((q) => q.symbol).filter((s) => PAIR_WINDOW[s] === w.key)
    };
  });

  const bestNow = scored.slice(0, 3).map((s) => ({
    symbol: s.q.symbol,
    name: s.q.name,
    price: s.q.price,
    changePercent: s.q.changePercent,
    score: s.score,
    direction: s.dir,
    bestWindow: PAIR_WINDOW[s.q.symbol] || 'london'
  }));

  return {
    bestNow,
    windows,
    rank: scored.map((s, i) => ({ symbol: s.q.symbol, rank: i + 1, score: s.score })),
    updatedAt: now.toISOString()
  };
}

module.exports = { analyze };