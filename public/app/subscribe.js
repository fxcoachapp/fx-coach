const err = document.getElementById('err');

function netInitial() {
  return {
    'TRC20': 'TRX', 'BEP20': 'BSC', 'ERC20': 'ETH'
  };
}

function showNetRetry(msg) {
  const el = document.getElementById('networks');
  el.innerHTML = `<p class="empty">${msg ? escapeHtml(msg) + '<br>' : ''}Payment networks couldn't load. <button class="btn btn-sm mt" id="netRetry" type="button">Retry</button></p>`;
  const b = document.getElementById('netRetry');
  if (b) b.addEventListener('click', () => {
    el.innerHTML = '<p class="empty">Loading payment networks…</p>';
    loadNetworks().catch((e) => showNetRetry(e.message));
  });
}

async function loadNetworks() {
  const data = await api('/api/payments/networks');
  const el = document.getElementById('networks');
  const netInitials = netInitial();
  const configured = data.networks.filter((n) => n.configured);
  if (!configured.length) {
    document.getElementById('netHint').textContent = '';
    showNetRetry('The owner has not configured a receiving wallet yet — please come back shortly.');
    return;
  }
  el.innerHTML = '';
  for (const n of configured) {
    el.insertAdjacentHTML('beforeend', `
      <div class="network-card" data-net="${n.key}" role="button" tabindex="0">
        ${n.recommended ? '<span class="rec">★ RECOMMENDED</span>' : ''}
        <div class="net-icon">${netInitials[n.key]}</div>
        <div style="font-weight:700">${escapeHtml(n.label)}</div>
        <div class="small">USDT · ${escapeHtml(n.short)}</div>
      </div>`);
  }
  const hint = document.getElementById('netHint');
  if (hint) hint.textContent = configured.length + ' payment network(s) available · tap one to continue.';
  el.querySelectorAll('.network-card').forEach((card) => card.addEventListener('click', async () => {
    await createPayment(card.dataset.net, card);
  }));
}

async function createPayment(network, card) {
  err.classList.remove('show');
  if (card) card.classList.add('spinner');
  try {
    const data = await api('/api/payments', 'POST', { network });
    location.href = '/app/pay.html?id=' + data.payment.id;
  } catch (e) {
    err.textContent = e.message;
    err.classList.add('show');
    if (card) card.classList.remove('spinner');
  }
}

initApp().then((user) => {
  if (!user) return;
  document.getElementById('statusLine').textContent =
    user.status === 'active' ? 'Pro plan active until ' + new Date(user.planEnds).toLocaleDateString() + '. Access unlocked.'
    : user.status === 'trial' ? 'Free trial until ' + new Date(user.trialEnds).toLocaleDateString() + '. Subscribe below to keep access after the trial.'
    : 'Expired. Access is currently LOCKED — pay below to unlock instantly.';
  document.getElementById('wall').classList.toggle('hidden', user.status !== 'expired');
});

loadNetworks().catch((e) => showNetRetry(e.message));

document.getElementById('simulateBtn').addEventListener('click', async () => {
  const btn = document.getElementById('simulateBtn');
  btn.disabled = true; btn.classList.add('spinner'); btn.textContent = 'Locking…';
  try {
    await api('/api/subscribe/simulate-nonpayment', 'POST');
    const u = (await api('/api/auth/me')).user;
    document.getElementById('statusLine').textContent = 'Expired. Access is now LOCKED — pay below to unlock.';
    document.getElementById('wall').classList.remove('hidden');
  } catch (e) {
    err.textContent = e.message;
    err.classList.add('show');
  }
  btn.disabled = false; btn.classList.remove('spinner'); btn.textContent = 'Simulate payment failure → lock access';
});