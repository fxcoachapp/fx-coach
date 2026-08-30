function dayStreaks(list) {
  const days = new Set();
  for (const tr of list) days.add(new Date(tr.openedAt).toISOString().slice(0, 10));
  const sorted = Array.from(days).sort();
  let current = 0;
  let best = 0;
  let cursor = 0;

  const today = new Date().toISOString().slice(0, 10);
  if (days.has(today)) {
    let i = sorted.indexOf(today);
    while (i >= 0) {
      if (i === sorted.length - 1 || sorted[i + 1] === addDays(sorted[i], 1)) { i--; current++; }
      else break;
    }
  } else {
    let i = sorted.indexOf(addDays(today, -1));
    if (i >= 0) {
      while (i >= 0) {
        if (i === sorted.length - 1 || sorted[i + 1] === addDays(sorted[i], 1)) { i--; current++; }
        else break;
      }
    }
  }

  for (const d of sorted) {
    if (cursor === 0 || d === addDays(sorted[cursor - 1], 1)) best++;
    else best = 1;
    cursor++;
  }
  return { current, best, activeDays: sorted.length };
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const DEFINITIONS = [
  { id: 'first', icon: '🎯', label: 'First trade', test: (p) => p.total >= 1 },
  { id: 'starter', icon: '📓', label: 'Journal starter', test: (p) => p.total >= 5 },
  { id: 'regular', icon: '📈', label: 'Regular logger', test: (p) => p.total >= 15 },
  { id: 'focused', icon: '🔥', label: '30-trade focus', test: (p) => p.total >= 30 && p.dayStreak.current >= 2 },
  { id: 'streak3', icon: '⚡', label: '3-day streak', test: (p) => p.dayStreak.current >= 3 },
  { id: 'streak7', icon: '🌟', label: '7-day streak', test: (p) => p.dayStreak.current >= 7 },
  { id: 'winstreak', icon: '🏆', label: 'Riding a win streak', test: (p) => p.tradeStreak >= 3 },
  { id: 'edge', icon: '💎', label: 'Real edge', test: (p) => p.total >= 10 && p.profitFactor >= 1.5 && p.avgR > 0 },
  { id: 'risksavvy', icon: '🛡️', label: 'Risk protected', test: (p) => p.total >= 3 && p.noStopLossCount === 0 },
  { id: 'planner', icon: '🗺️', label: 'Plans every trade', test: (p) => p.plannedCount >= 3 },
  { id: 'pro', icon: '👑', label: 'Pro member', test: (p) => p.plan === 'active' },
  { id: 'referrer', icon: '🤝', label: 'Inviter', test: (p) => (p.confirmedRefs || 0) >= 1 }
];

function progressFor(user, trades, journalStatsObj) {
  const s = journalStatsObj || { total: 0, profitFactor: 0, avgR: 0, noStopLossCount: 0, currentStreak: 0 };
  const ds = dayStreaks(trades || []);
  const stats = {
    total: s.total,
    winRate: s.winRate,
    profitFactor: s.profitFactor,
    avgR: s.avgR,
    noStopLossCount: s.noStopLossCount,
    tradeStreak: s.currentStreak,
    plannedCount: (trades || []).filter((t) => t.stopLoss && t.takeProfit).length,
    dayStreak: ds.current,
    bestDayStreak: ds.best,
    activeDays: ds.activeDays,
    plan: user && user.plan,
    confirmedRefs: (user && user.confirmedRefs) || 0
  };

  const badges = DEFINITIONS.map((b) => ({
    id: b.id,
    icon: b.icon,
    label: b.label,
    unlocked: b.test(stats)
  }));

  const unlockedCount = badges.filter((b) => b.unlocked).length;
  const totalCount = badges.length;
  const nextBadge = badges.find((b) => !b.unlocked) || null;

  return {
    stats,
    badges,
    unlockedCount,
    totalCount,
    progress: totalCount ? Math.round((unlockedCount / totalCount) * 100) : 0,
    nextBadge: nextBadge ? { id: nextBadge.id, icon: nextBadge.icon, label: nextBadge.label } : null
  };
}

module.exports = { progressFor, dayStreaks };