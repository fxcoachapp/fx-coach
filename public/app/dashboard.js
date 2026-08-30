async function loadQuotes() {
  try {
    const data = await api('/api/quotes');
    const el = document.getElementById('quotes');
    el.innerHTML = '';
    for (const q of data.quotes) {
      const cls = q.changePercent >= 0 ? 'up' : 'down';
      el.insertAdjacentHTML('beforeend', `
        <div class="quote-card">
          <div class="sym"><span>${escapeHtml(q.symbol)}</span><span class="tag">${escapeHtml(q.name || '')}</span></div>
          <div class="price">${fmtNum(q.price)}</div>
          <div class="chg ${cls}">${q.change >= 0 ? '+' : ''}${fmt(q.change, 4)} (${q.change >= 0 ? '+' : ''}${fmt(q.changePercent)}%)</div>
        </div>`);
    }
    document.getElementById('quoteTime').textContent = 'updated ' + new Date(data.updatedAt).toLocaleTimeString();
  } catch (e) {
    document.getElementById('quotes').innerHTML = '<span class="tag">Rates temporarily unavailable.</span>';
  }
}

async function loadStats() {
  try {
    const data = await api('/api/review/journal');
    const r = data.review;
    const s = r.stats || {};
    document.getElementById('sTotal').textContent = s.total || 0;
    document.getElementById('sWin').textContent = s.winRate ? s.winRate + '%' : '—';
    document.getElementById('sR').textContent = s.avgR !== null ? s.avgR : '—';
    document.getElementById('sPF').textContent = s.profitFactor || '—';
    document.getElementById('sScore').textContent = r.score ? r.score + ' (' + r.grade + ')' : '—';
    const box = document.getElementById('coachBox');
    if (r.score) {
      box.innerHTML = `<div class="score-ring">${r.score}<small style="font-size:15px">/100 ${r.grade}</small></div>
        <p style="margin:10px 0 14px"><b>${escapeHtml(r.headline)}</b></p>` +
        (r.items || []).slice(0, 4).map((i) => `<div class="review-item ${i.level}">${escapeHtml(i.text)}</div>`).join('');
    }
  } catch (e) { /* api() handles redirects */ }
}

async function loadPulse() {
  try {
    const data = await api('/api/market');
    const pulse = document.getElementById('pulse');

    const hot = data.bestNow.map((b) => `
      <div class="quote-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
        <div>
          <div class="sym"><span>${escapeHtml(b.symbol)}</span></div>
          <div class="tag">${escapeHtml(b.name)}</div>
        </div>
        <div style="text-align:right">
          <div class="price">${fmtNum(b.price)}</div>
          <div class="chg ${b.score >= 45 ? 'up' : 'down'}">${b.direction === 'up' ? '▲' : '▼'} ${b.score}/100 ${b.score >= 55 ? '· high' : b.score >= 30 ? '· medium' : '· calm'}</div>
        </div>
      </div>`).join('');

    const win = data.windows.map((w) => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:11px 0;border-bottom:1px dashed var(--border-soft)">
        <div>
          <b>${escapeHtml(w.name)}</b> <span class="tag">${w.active ? '<span style="color:var(--accent);font-weight:700">● LIVE</span>' : 'opens in ' + escapeHtml(w.opensIn)}</span>
          <div class="small" style="margin-top:3px">${escapeHtml(w.pairs.join(' · '))}${w.active && w.closesIn ? ' · closes in ' + escapeHtml(w.closesIn) : ''}</div>
        </div>
      </div>`).join('');

    pulse.innerHTML = `
      <div>
        <h3 style="font-size:15px;margin-bottom:12px">Hottest markets right now</h3>
        ${hot}
      </div>
      <div>
        <h3 style="font-size:15px;margin-bottom:12px">Best time windows (UTC)</h3>
        ${win}
        <p class="small" style="margin-top:10px">${escapeHtml(data.windows.find((w) => w.active && w.note)?.note || 'Set your trade inside the LIVE window for the strongest moves.')}</p>
      </div>`;

    const ideasEl = document.getElementById('ideas');
    ideasEl.innerHTML = (data.ideas || []).map((i) => `
      <div class="idea-card glass">
        <div class="idea-head">
          <span class="idea-sym">${escapeHtml(i.symbol)}</span>
          <span class="tag">${escapeHtml(i.name)}</span>
          <span class="idea-dir ${i.direction === 'up' ? 'up' : 'down'}">${i.direction === 'up' ? '▲' : '▼'} ${i.momentum}</span>
        </div>
        <div class="price">${fmtNum(i.price)} <span class="tag">${i.changePercent >= 0 ? '+' : ''}${fmt(i.changePercent)}%</span></div>
        <p class="idea-why">${escapeHtml(i.why)}</p>
        <div class="idea-row"><b class="${i.windowLive ? 'live-tag' : ''}">${escapeHtml(i.bestWindow)}</b><span class="small">${escapeHtml(i.setup)}</span></div>
        <p class="small risk-note">⚠ ${escapeHtml(i.risk)}</p>
      </div>`).join('');
    document.getElementById('tipLine').textContent = '🤖 ' + (data.tip || '');
  } catch (e) { /* ignore */ }
}

async function loadProgress() {
  try {
    const p = await api('/api/progress');
    const el = document.getElementById('progressBox');
    const streak = p.stats.dayStreak;

    const badges = (p.badges || []).map((b) => `
      <span class="badge-chip ${b.unlocked ? 'on' : 'off'}" title="${escapeHtml(b.label)}">${b.icon}</span>`).join('');

    el.innerHTML = `
      <div class="streak-box">
        <div class="streak-flame">${streak >= 3 ? '🔥' : '📅'}</div>
        <div>
          <div class="streak-num">${streak}<small> day streak</small></div>
          <div class="small">Best streak: <b>${p.stats.bestDayStreak}</b> · ${p.stats.activeDays} active day(s) · ${p.stats.total} trade(s)</div>
        </div>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${p.progress}%"></div></div>
      <div class="badge-row">${badges}</div>
      <p class="small" style="margin-top:10px">${p.nextBadge ? 'Next up: <b>' + p.nextBadge.icon + ' ' + escapeHtml(p.nextBadge.label) + '</b> — keep logging trades to unlock it.' : 'All badges unlocked — you are building a serious track record.'} <b>${p.unlockedCount}/${p.totalCount}</b> unlocked.</p>`;
    document.getElementById('progressMeta').textContent = p.status === 'active'
      ? '👑 Pro · ' + p.daysLeft + ' day(s) left'
      : p.status === 'trial'
        ? '🧪 Trial · ' + p.daysLeft + ' day(s) left'
        : '🔒 Expired';

    showReminder(p);
  } catch (e) { /* ignore */ }
}

function reminderText(p) {
  const when = p.status === 'active' ? 'Pro plan expires in ' + p.daysLeft + ' days.' : p.status === 'trial' ? 'Free trial ends in ' + p.daysLeft + ' days.' : '';
  if (!when) return null;
  return when + ' Renew with USDT — it takes ~30 seconds and unlocks access.';
}

function showReminder(p) {
  const box = document.getElementById('reminderBanner');
  if (!box) return;
  const text = reminderText(p);
  if (!text || p.daysLeft > 5) { box.classList.add('hidden'); return; }
  const subj = encodeURIComponent('FX Coach — renew my plan');
  const body = encodeURIComponent(text + ' ' + location.origin + '/app/subscribe.html');
  box.classList.remove('hidden');
  box.innerHTML = `<b>⏰ ${text}</b> &nbsp;
    <a href="https://wa.me/?text=${body}" target="_blank" rel="noopener" style="color:inherit;font-weight:700">WhatsApp me</a> ·
    <a href="mailto:?subject=${subj}&body=${body}" style="color:inherit;font-weight:700">Email me</a> ·
    <a href="/app/subscribe.html" style="color:inherit;text-decoration:underline;font-weight:700">Renew now</a>`;
}

initApp().then((user) => {
  if (!user) return;
  if (user.status === 'expired') {
    document.getElementById('expiredBanner').classList.remove('hidden');
    document.getElementById('statusLine').textContent = 'Your plan expired on ' + new Date(user.planEnds).toLocaleDateString() + '. Renew to keep access.';
    return;
  }
  document.getElementById('statusLine').textContent = user.status === 'trial'
    ? 'Free trial — renewable until ' + new Date(user.trialEnds).toLocaleDateString() + '.'
    : 'Pro plan active until ' + new Date(user.planEnds).toLocaleDateString() + '.';
  loadQuotes();
  loadStats();
  loadPulse();
  loadProgress();
  setInterval(loadQuotes, 30000);
  setInterval(loadPulse, 30000);
});

(function initReveal() {
  const els = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.08 });
    els.forEach((el) => io.observe(el));
  } else {
    els.forEach((el) => el.classList.add('in'));
  }
})();