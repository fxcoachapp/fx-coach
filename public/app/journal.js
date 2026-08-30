const PAIRS = ['EURUSD','GBPUSD','USDJPY','USDCAD','AUDUSD','USDCHF','NZDUSD','XAUUSD','USDTRY','USDMXN','EURJPY','EURGBP','GBPJPY','AUDJPY','USDSGD','EURNZD','GBPAUD','AUDNZD','EURCHF'];
const err = document.getElementById('err');
let currentList = [];

const pairSel = document.getElementById('pair');
pairSel.innerHTML = PAIRS.map((p) => `<option>${p}</option>`).join('');

const now = new Date();
now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
document.getElementById('openedAt').value = now.toISOString().slice(0, 16);

function outcomeBadge(outcome) {
  if (outcome === 'win') return '<span class="badge badge-win">WIN</span>';
  if (outcome === 'loss') return '<span class="badge badge-loss">LOSS</span>';
  return '<span class="badge badge-be">BE</span>';
}

function renderTrades(list) {
  currentList = list;
  const el = document.getElementById('trades');
  document.getElementById('tradeCount').textContent = '(' + list.length + ')';
  if (!list.length) {
    el.innerHTML = '<p class="empty">No trades yet. Log your first one above.</p>';
    return;
  }
  el.innerHTML = '';
  for (const t of list) {
    const dir = t.direction === 'sell' ? 'Sell' : 'Buy';
    const items = `
      <div class="trade-item">
        <div class="main">
          <b class="mono">${t.pair}</b>
          <span class="badge ${t.direction === 'sell' ? 'badge-loss' : 'badge-win'}">${dir}</span>
          <span class="tag">in ${fmtNum(t.entry)} → out ${t.exit !== null ? fmtNum(t.exit) : '—'}</span>
          <span class="tag">${new Date(t.openedAt).toLocaleString()}</span>
          ${t.notes ? `<span class="tag">${escapeHtml(t.notes)}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-ghost btn-sm" data-review="${t.id}">Coach</button>
          <button class="btn btn-ghost btn-sm" data-del="${t.id}" style="color:var(--danger)">Delete</button>
        </div>
      </div>
      <div class="card hidden review-slot" id="review-${t.id}" style="margin-top:-4px"></div>`;
    el.insertAdjacentHTML('beforeend', items);
  }
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    await api('/api/journal/' + b.dataset.del, 'DELETE');
    reload();
  }));
  el.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', async () => {
    const slot = document.getElementById('review-' + b.dataset.review);
    slot.classList.remove('hidden');
    slot.textContent = 'Analysing…';
    try {
      const t = currentList.find((x) => x.id === b.dataset.review);
      const data = await api('/api/review/trade', 'POST', t);
      renderSingleReview(slot, data.review);
    } catch (e) {
      slot.textContent = e.message;
    }
  }));
}

function renderSingleReview(slot, r) {
  slot.innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <div class="score-ring" style="font-size:32px">${r.overall}/100</div>
      <div>
        <div>${outcomeBadge(r.outcome)} <span class="tag">${r.rMultiple !== null ? r.rMultiple.toFixed(2) + 'R' : 'no SL'}</span></div>
        <div class="small" style="margin-top:4px">Discipline ${r.breakdown.discipline} · Risk ${r.breakdown.risk} · Psychology ${r.breakdown.psychology}</div>
      </div>
    </div>` +
    r.items.map((i) => `<div class="review-item ${i.level}">${escapeHtml(i.text)}</div>`).join('');
}

function renderReview(r) {
  const box = document.getElementById('coachBox');
  if (!r.score) { box.innerHTML = '<p class="small">' + escapeHtml(r.headline) + '</p>'; }
  else {
    box.innerHTML = `
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div class="score-ring">${r.score}<small style="font-size:15px">/100 ${r.grade}</small></div>
        <p style="max-width:340px"><b>${escapeHtml(r.headline)}</b></p>
      </div>
      <div class="mt">${(r.items || []).map((i) => `<div class="review-item ${i.level}">${escapeHtml(i.text)}</div>`).join('')}</div>`;
  }
  const s = r.stats || {};
  document.getElementById('cWin').textContent = s.winRate ? s.winRate + '%' : '—';
  document.getElementById('cR').textContent = s.avgR !== null ? s.avgR : '—';
  document.getElementById('cPF').textContent = s.profitFactor || '—';
}

async function reload() {
  const data = await api('/api/journal');
  renderTrades(data.trades);
}

document.getElementById('reviewBtn').addEventListener('click', async () => {
  const btn = document.getElementById('reviewBtn');
  btn.disabled = true; btn.classList.add('spinner'); btn.textContent = 'Reviewing…';
  try {
    const data = await api('/api/review/journal');
    renderReview(data.review);
  } catch (e) { err.textContent = e.message; err.classList.add('show'); }
  btn.disabled = false; btn.classList.remove('spinner'); btn.textContent = 'Run AI coach review';
});

document.getElementById('tradeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.classList.remove('show');
  const opened = document.getElementById('openedAt').value
    ? new Date(document.getElementById('openedAt').value).toISOString()
    : new Date().toISOString();
  const body = {
    pair: pairSel.value,
    direction: document.getElementById('direction').value,
    entry: document.getElementById('entry').value,
    exit: document.getElementById('exit').value || null,
    stopLoss: document.getElementById('stopLoss').value || null,
    takeProfit: document.getElementById('takeProfit').value || null,
    lots: document.getElementById('lots').value || null,
    notes: document.getElementById('notes').value,
    openedAt: opened
  };
  try {
    const data = await api('/api/journal', 'POST', body);
    document.getElementById('tradeForm').reset();
    await reload();
    const review = await api('/api/review/journal');
    renderReview(review.review);
    const singleSlot = document.getElementById('review-' + data.trade.id);
    singleSlot.classList.remove('hidden');
    const r2 = await api('/api/review/trade', 'POST', data.trade);
    renderSingleReview(singleSlot, r2.review);
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.add('show');
  }
});

initApp().then(async (user) => {
  if (!user) return;
  await reload();
  const review = await api('/api/review/journal');
  renderReview(review.review);
});