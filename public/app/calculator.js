const err = document.getElementById('err');

document.getElementById('calcForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.classList.remove('show');
  const body = {
    balance: document.getElementById('balance').value,
    riskPercent: document.getElementById('riskPercent').value,
    entry: document.getElementById('entry').value,
    stop: document.getElementById('stop').value,
    pair: document.getElementById('pair').value
  };
  const tp = document.getElementById('tp').value;
  try {
    const r = await api('/api/calculator', 'POST', body);
    if (r.error) { err.textContent = r.error; err.classList.add('show'); return; }
    const riskReward = tp ? Math.abs((parseFloat(tp) - parseFloat(body.entry)) / (parseFloat(body.entry) - parseFloat(body.stop))) : null;
    document.getElementById('result').innerHTML = `
      <div class="stat-row">
        <div class="stat"><div class="label">Risk amount</div><div class="value gold">$${fmt(r.riskUSD)}</div></div>
        <div class="stat"><div class="label">Distance</div><div class="value">${fmt(r.distancePips)} pips</div></div>
        <div class="stat"><div class="label">Lot size</div><div class="value green">${r.lots}</div></div>
        <div class="stat"><div class="label">Units</div><div class="value">${r.units.toLocaleString()}</div></div>
        ${riskReward ? `<div class="stat"><div class="label">Risk:Reward</div><div class="value">1 : ${fmt(riskReward)}</div></div>` : ''}
      </div>
      <div class="notice">${escapeHtml(r.disclaimer)}</div>`;
    document.getElementById('result').classList.remove('hidden');
  } catch (e2) {
    err.textContent = e2.message;
    err.classList.add('show');
  }
});

initApp();