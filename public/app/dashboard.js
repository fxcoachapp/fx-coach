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
  setInterval(loadQuotes, 30000);
});