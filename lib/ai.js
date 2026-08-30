const EMOTION_KEYWORDS = ['fomo', 'momentum', 'revenge', 'panic', 'scared', 'fear', 'greed', 'overconfident', 'hesitated', 'bored', 'tired', 'exhausted', 'angry', 'frustrated'];

function detectEmotions(note) {
  const text = String(note || '').toLowerCase();
  const found = EMOTION_KEYWORDS.filter((k) => text.includes(k));
  return found;
}

function tradeMetrics(trade) {
  const direction = String(trade.direction || 'buy').toLowerCase();
  const entry = parseFloat(trade.entry);
  const exit = parseFloat(trade.exit);
  const sl = trade.stopLoss ? parseFloat(trade.stopLoss) : NaN;
  const tp = trade.takeProfit ? parseFloat(trade.takeProfit) : NaN;

  const diff = direction === 'sell' ? entry - exit : exit - entry;
  const outcome = diff > 0 ? 'win' : diff < 0 ? 'loss' : 'breakeven';

  const riskInput = isFinite(sl) ? (direction === 'sell' ? sl - entry : entry - sl) : NaN;
  const rewardInput = isFinite(tp) ? (direction === 'sell' ? entry - tp : tp - entry) : NaN;
  const rMultiple = isFinite(riskInput) && riskInput > 0 ? Math.abs(diff) / riskInput : null;
  const riskReward = isFinite(riskInput) && riskInput > 0 && isFinite(rewardInput) ? rewardInput / riskInput : null;

  return {
    outcome,
    rMultiple: rMultiple !== null ? Math.round(rMultiple * 100) / 100 : rMultiple,
    riskReward: riskReward !== null ? Math.round(riskReward * 100) / 100 : riskReward,
    hasSL: isFinite(sl),
    hasTP: isFinite(tp),
    yourRisk: riskInput,
    yourReward: rewardInput
  };
}

function reviewTrade(trade) {
  const m = tradeMetrics(trade);
  const emotions = detectEmotions(trade.notes);
  const items = [];
  let discipline = 70;
  let riskScore = 70;
  let psychScore = 75;

  if (m.outcome === 'breakeven') {
    items.push({ level: 'info', text: 'Trade closed at breakeven. Zero damage, but also zero insight - journal what changed.' });
  } else if (m.outcome === 'win') {
    if (m.rMultiple !== null && m.rMultiple >= 2) {
      items.push({ level: 'good', text: 'Nice runner - captured ' + m.rMultiple + 'R. Letting winners run pays.' });
      riskScore += 4;
    } else if (m.rMultiple !== null && m.rMultiple < 1) {
      items.push({ level: 'warn', text: 'Won, but only ' + m.rMultiple + 'R. You may be cutting winners short.' });
    }
  } else {
    if (m.rMultiple !== null && m.rMultiple <= -1) {
      items.push({ level: 'bad', text: 'Hit the full ' + m.rMultiple.toFixed(2) + 'R stop. That is the plan working - protect next trade.' });
    } else if (m.rMultiple !== null && m.rMultiple > -1) {
      items.push({ level: 'warn', text: 'Lost only ' + Math.abs(m.rMultiple).toFixed(2) + 'R, better than your planned risk. Discipline helped you here.' });
    }
  }

  if (!m.hasSL) {
    items.push({ level: 'bad', text: 'No stop loss recorded. This is the #1 account killer in forex.' });
    riskScore -= 20;
  } else if (m.hasTP && m.riskReward !== null && m.riskReward < 1 && m.outcome === 'win') {
    items.push({ level: 'warn', text: 'Your risk:reward is only ' + m.riskReward.toFixed(2) + ':1. To stay profitable you need a win rate above ' + Math.round(100 / (1 + m.riskReward)) + '%.' });
  } else if (!m.hasTP && m.outcome === 'win') {
    items.push({ level: 'info', text: 'No take-profit set but you took a win. Consider pre-setting TPs to remove emotion from exits.' });
  }

  if (emotions.length) {
    items.push({ level: 'warn', text: 'Emotional state detected: ' + emotions.join(', ') + '. If a trade comes with strong emotion, size down or stand aside.' });
    psychScore -= emotions.length * 5;
  } else {
    items.push({ level: 'good', text: 'No emotional flags in your notes - clean executing.' });
  }

  if (m.rMultiple !== null && m.rMultiple < 0) {
    discipline -= 3;
  }

  const overall = Math.max(5, Math.min(99, Math.round((discipline + riskScore + psychScore) / 3)));

  return {
    overall,
    outcome: m.outcome,
    rMultiple: m.rMultiple,
    riskReward: m.riskReward,
    breakdown: {
      discipline: Math.max(5, Math.min(99, discipline)),
      risk: Math.max(5, Math.min(99, riskScore)),
      psychology: Math.max(5, Math.min(99, psychScore))
    },
    items,
    emotions
  };
}

function journalStats(list) {
  const t = list.map(tradeMetrics);
  const wins = t.filter((m) => m.outcome === 'win');
  const losses = t.filter((m) => m.outcome === 'loss');
  const all = t.filter((m) => m.rMultiple !== null);
  const grossWin = all.filter((m) => m.rMultiple > 0).reduce((s, m) => s + m.rMultiple, 0);
  const grossLoss = Math.abs(all.filter((m) => m.rMultiple < 0).reduce((s, m) => s + m.rMultiple, 0));
  const avgR = all.length ? all.reduce((s, m) => s + m.rMultiple, 0) / all.length : null;

  let streak = 0;
  let maxLossStreak = 0;
  let maxWinStreak = 0;
  let cur = 0;
  let best = 0;
  let worst = 0;
  const order = list.slice().sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt));
  for (const tr of order) {
    const m = tradeMetrics(tr);
    if (m.outcome === 'win') {
      cur = cur > 0 ? cur + 1 : 1;
      best = Math.max(best, cur);
    } else if (m.outcome === 'loss') {
      cur = cur < 0 ? cur - 1 : -1;
      worst = Math.min(worst, cur);
    }
    streak = cur;
  }

  const noSL = list.filter((tr) => !tradeMetrics(tr).hasSL).length;
  const days = {};
  for (const tr of list) days[new Date(tr.openedAt).toDateString()] = (days[new Date(tr.openedAt).toDateString()] || 0) + 1;
  const maxTradesDay = Math.max(0, ...Object.values(days));

  return {
    total: list.length,
    wins: wins.length,
    losses: losses.length,
    winRate: list.length ? Math.round(wins.length / list.length * 100) : 0,
    avgR: avgR !== null ? Math.round(avgR * 100) / 100 : avgR,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : grossWin > 0 ? 99 : 0,
    bestWinStreak: best,
    worstLossStreak: Math.abs(worst),
    currentStreak: streak,
    noStopLossCount: noSL,
    maxTradesDay,
    overtrading: list.length >= 5 && (maxTradesDay > 5 || list.length / Math.max(1, Object.keys(days).length) > 3)
  };
}

function reviewJournal(list) {
  if (!list.length) {
    return { score: 0, grade: 'No data', headline: 'Add at least a few trades and the coach will analyse your patterns.', stats: journalStats(list), items: [] };
  }

  const s = journalStats(list);
  const items = [];
  let score = 50;

  if (s.total >= 10) {
    score += 6;
    items.push({ level: 'good', text: 'Good sample size (' + s.total + ' trades) - patterns are meaningful.' });
  } else {
    items.push({ level: 'warn', text: 'Only ' + s.total + ' trades logged. Keep going - analysis gets sharper with more data.' });
  }

  if (s.winRate >= 55) {
    score += 10;
    items.push({ level: 'good', text: s.winRate + '% win rate is solid if your R-multiples hold.' });
  } else if (s.winRate >= 45) {
    score += 5;
    items.push({ level: 'info', text: s.winRate + '% win rate is survivable with good risk:reward.' });
  } else {
    score -= 7;
    items.push({ level: 'bad', text: s.winRate + '% win rate means wins must pay more than losses cost. Lower risk or improve entries.' });
  }

  if (s.avgR !== null) {
    score += s.avgR * 8;
    if (s.avgR > 0.3) items.push({ level: 'good', text: 'Average ' + s.avgR.toFixed(2) + 'R per trade - edge confirmed. Keep doing the same thing.' });
    else if (s.avgR > 0) items.push({ level: 'info', text: 'Average ' + s.avgR.toFixed(2) + 'R per trade. Positive, but fragile - tighten your stop placement.' });
    else items.push({ level: 'bad', text: 'Average ' + s.avgR.toFixed(2) + 'R per trade. You are leaking money. Cut position sizes until this turns positive.' });
  }

  if (s.profitFactor >= 1.5) {
    score += 8;
    items.push({ level: 'good', text: 'Profit factor ' + s.profitFactor + ' - this is a real edge.' });
  } else if (s.profitFactor >= 1) {
    items.push({ level: 'info', text: 'Profit factor ' + s.profitFactor + '. Marginal - a single trade flips it. Shrink size.' });
    score -= 3;
  } else {
    items.push({ level: 'bad', text: 'Profit factor ' + s.profitFactor + '. You are losing more than you win per unit of risk.' });
    score -= 10;
  }

  if (s.noStopLossCount > 0) {
    score -= s.noStopLossCount * 4;
    items.push({ level: 'bad', text: s.noStopLossCount + ' trade(s) had no stop loss. One black swan can erase weeks of work.' });
  } else {
    score += 5;
    items.push({ level: 'good', text: 'Every trade logged with a stop loss. That is professional behaviour.' });
  }

  if (s.worstLossStreak >= 4) {
    score -= 5;
    items.push({ level: 'bad', text: 'Worst losing streak of ' + s.worstLossStreak + '. After 2-3 losses in a row you must halve size or stop trading for the day.' });
  }

  if (s.overtrading) {
    score -= 8;
    items.push({ level: 'bad', text: 'Peak of ' + s.maxTradesDay + ' trades in one day. Overtrading is the fastest way to give profits back.' });
  }

  if (s.winRate >= 50 && s.avgR > 0 && s.profitFactor >= 1.2 && s.noStopLossCount === 0) {
    score += 6;
    items.push({ level: 'good', text: 'You have a repeatable, protected edge. Consider slowly scaling a demo strategy into live.' });
  }

  score = Math.max(5, Math.min(99, Math.round(score)));
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';

  const headline = grade === 'A' || grade === 'B'
    ? 'Solid execution. Protect this edge.'
    : grade === 'C'
      ? 'Room to improve. Focus on your action items below.'
      : 'Urgent fixes needed. Trade smaller until the edge is proven.';

  const actionItems = items.filter((i) => i.level !== 'good').slice(0, 3).map((i) => i.text);

  return { score, grade, headline, stats: s, items: items.slice(0, 8), actionItems };
}

module.exports = { reviewTrade, reviewJournal, journalStats, tradeMetrics, detectEmotions };