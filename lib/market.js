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

const TIPS = [
  'Risk no more than 1–2% per trade. Survival is the edge.',
  'Trade the LIVE session window — the pairs that move most right now.',
  'Fade your first instinct after two straight losses. Take a break.',
  'A trade with a written plan beats a trade without one. Log it first.',
  'Sunday and Monday opens are the least predictable — size down.',
  'Your biggest loss is rarely the trade — it is trading while emotional.',
  'Consistency beats brilliance. Protect your streak, not your win rate.',
  'If you do not know your average R, you do not know if you are winning.',
  'Small size, clear stop, repeat. That is what makes the edge compound.',
  'Manage your risk first and the profits look after themselves.'
];

function bestWindowKey(symbol) {
  return PAIR_WINDOW[symbol] || 'london';
}

function windowName(key) {
  const w = SESSIONS.find((x) => x.key === key);
  return w ? w.name : key;
}

function momentumLabel(score) {
  if (score >= 55) return 'high momentum';
  if (score >= 30) return 'medium momentum';
  return 'calm — wait for activity';
}

function buildIdeas(quotes, scored) {
  return scored.slice(0, 3).map((s) => {
    const sym = s.q.symbol;
    const wk = bestWindowKey(sym);
    const active = SESSIONS.find((w) => w.key === wk && windowState(w).active);
    const liveNote = active
      ? sym + ' is inside its LIVE window (' + windowName(wk) + '). This is when ' + sym + ' moves most.'
      : 'The best window for ' + sym + ' is ' + windowName(wk) + ' — that is where this pair is most active.';
    const why = s.score >= 55
      ? 'Strong movement right now against its normal pace. Momentum is real — but wait for the session range to confirm before entering.'
      : s.score >= 30
        ? 'Noticeable movement. Watch for a cleaner entry inside the next LIVE window instead of chasing here.'
        : 'Below normal activity. Not an ideal entry — keep this pair on the watchlist for its LIVE window.';
    return {
      symbol: sym,
      name: s.q.name,
      price: s.q.price,
      changePercent: s.q.changePercent,
      score: s.score,
      direction: s.dir,
      momentum: momentumLabel(s.score),
      bestWindow: windowName(wk),
      windowLive: !!active,
      why,
      risk: 'Never enter without a defined stop and a max-loss number you can afford.',
      setup: s.score >= 55 ? ('Re-entry on a pullback toward the ' + (s.dir === 'up' ? 'upper' : 'lower') + ' edge of the current session range') : 'Sit out until your best window — patience is a position.'
    };
  });
}

function tipFor(now) {
  return TIPS[Math.floor(now.getTime() / (24 * 60 * 60 * 1000)) % TIPS.length];
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
    ideas: buildIdeas(quotes, scored),
    tip: tipFor(now),
    rank: scored.map((s, i) => ({ symbol: s.q.symbol, rank: i + 1, score: s.score })),
    updatedAt: now.toISOString()
  };
}

module.exports = { analyze };