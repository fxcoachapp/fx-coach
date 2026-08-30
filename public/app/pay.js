const err = document.getElementById('err');
const NET_INITIALS = { TRC20: 'TRX', BEP20: 'BSC', ERC20: 'ETH' };
let payment = null;
let timer = null;

function qrSrc(id) {
  return '/api/payments/' + id + '/qr';
}

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(payment.address);
    document.getElementById('copyBtn').textContent = 'Copied ✓';
    setTimeout(() => { document.getElementById('copyBtn').textContent = 'Copy'; }, 1500);
  } catch (e) { /* clipboard may be blocked on http */ }
}

async function checkStatus(manual) {
  if (!payment) return;
  const btn = document.getElementById('verifyBtn');
  if (manual) { btn.classList.add('spinner'); btn.textContent = 'Checking…'; }
  try {
    const data = await api('/api/payments/' + payment.id + '/check', 'POST');
    if (data.payment.status === 'paid') {
      successState(data.payment);
      return;
    }
    if (data.payment.status === 'expired') {
      expiredState();
      return;
    }
    const statusEl = document.getElementById('checkStatus');
    if (statusEl) {
      const r = data.result;
      statusEl.textContent = 'No matching payment yet' + (r && r.count ? ' (' + r.count + ' recent transfers seen)' : '') + ' — keep the tab open, it re-checks automatically.';
    }
  } catch (e) {
    if (!e.message.includes('PAYMENT_REQUIRED')) {
      const statusEl = document.getElementById('checkStatus');
      if (statusEl) statusEl.textContent = 'Check failed: ' + e.message;
    }
  } finally {
    if (manual) { btn.classList.remove('spinner'); btn.textContent = 'I\u2019ve sent it — verify now'; }
  }
}

function successState(p) {
  document.getElementById('success').classList.remove('hidden');
  document.getElementById('expiredNote').classList.add('hidden');
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <div class="text-center">
      <div style="font-size:48px">✓</div>
      <div class="pay-amount" style="justify-content:center;color:var(--accent)">${p.amount} USDT</div>
      <p class="small">Paid on ${p.network} · TX ${escapeHtml((p.confirmedTx || '').slice(0, 20))}…</p>
      <a class="btn btn-primary mt" href="/app/dashboard.html">Go to dashboard</a>
    </div>`;
  if (timer) clearInterval(timer);
  if (window.__countdown) clearInterval(window.__countdown);
}

function expiredState() {
  document.getElementById('expiredNote').classList.remove('hidden');
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <div class="text-center">
      <div style="font-size:44px">⏱</div>
      <h2 style="margin:10px 0 4px">This payment expired</h2>
      <p class="small">Expired payments are cancelled automatically. Start a new one — it takes 20 seconds.</p>
      <a class="btn btn-gold mt" href="/app/subscribe.html">Back to plan</a>
    </div>`;
  if (timer) clearInterval(timer);
  if (window.__countdown) clearInterval(window.__countdown);
}

function renderPanel() {
  const n = NET_INITIALS[payment.network];
  document.getElementById('panel').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <div>
        <div class="tag" style="text-transform:uppercase;letter-spacing:1px">${payment.network}</div>
        <div class="pay-amount mt">${payment.amount}<small>USDT</small></div>
      </div>
      <div class="net-icon" style="width:52px;height:52px;font-size:17px">${n}</div>
    </div>

    <div class="qr-wrap">
      <img src="${qrSrc(payment.id)}" alt="QR code — scan with your wallet" />
    </div>

    <div style="display:flex;align-items:center;justify-content:center;gap:8px;font-size:14px;font-weight:700">
      Exact amount: <span class="mono" style="color:var(--gold)">${payment.amount} USDT</span>
    </div>

    <div class="address-box">
      <div class="addr">${escapeHtml(payment.address)}</div>
      <button class="btn btn-sm" id="copyBtn">Copy</button>
    </div>
    ${payment.network === 'TRC20' ? `
      <div class="address-box" style="margin-top:10px">
        <div class="addr">Memo: <b style="color:var(--gold)">${escapeHtml(payment.memo)}</b></div>
        <button class="btn btn-sm" id="copyMemo">Copy</button>
      </div>` : ''}

    <div class="warn-box mt" style="font-size:12.5px">
      Send <b>USDT</b> only, on the <b>${payment.network}</b> network. Wrong network or wrong coin will lose your money.
    </div>

    <button class="btn btn-gold btn-block mt" id="verifyBtn">I\u2019ve sent it — verify now</button>
    <div class="verify-orbit mt" id="verifyRow">
      <span style="font-size:13px" class="spin">⟳</span>
      <span id="checkStatus">Auto-checking every 15 seconds…</span>
      <span class="tag" id="countdown"></span>
    </div>`;

  document.getElementById('copyBtn').addEventListener('click', copyAddress);
  const copyMemo = document.getElementById('copyMemo');
  if (copyMemo) copyMemo.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(payment.memo); copyMemo.textContent = '✓'; } catch (e) { /* ignore */ }
  });
  document.getElementById('verifyBtn').addEventListener('click', () => checkStatus(true));
}

async function loadPayment() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { location.href = '/app/subscribe.html'; return; }
  const data = await api('/api/payments/' + id);
  payment = data.payment;
  renderPanel();
  document.getElementById('paySub').textContent = 'Send USDT to the address below. Access unlocks automatically when the transfer is confirmed.';
  checkStatus(false);
  timer = setInterval(() => checkStatus(false), 15000);
  startCountdown(payment.expiresAt);
}

function startCountdown(iso) {
  const end = new Date(iso).getTime();
  const update = () => {
    const left = Math.max(0, end - Date.now());
    const el = document.getElementById('countdown');
    if (!el) return;
    if (left <= 0) {
      el.textContent = 'expired';
      clearInterval(timer);
      return;
    }
    const mins = Math.floor(left / 60000);
    const secs = Math.floor((left % 60000) / 1000);
    el.textContent = '· expires in ' + mins + ':' + String(secs).padStart(2, '0');
  };
  update();
  const t2 = setInterval(update, 1000);
  window.__countdown = t2;
}

async function loadNetworkSwitcher() {
  const data = await api('/api/payments/networks');
  const el = document.getElementById('networks');
  el.innerHTML = '';
  for (const n of data.networks.filter((x) => x.configured)) {
    const active = n.key === payment.network;
    el.insertAdjacentHTML('beforeend', `
      <div class="network-card ${active ? 'active' : ''}" data-net="${n.key}" role="button" tabindex="0" ${active ? 'style="pointer-events:none"' : ''}>
        ${n.recommended ? '<span class="rec">★</span>' : ''}
        <div class="net-icon">${NET_INITIALS[n.key]}</div>
        <div style="font-weight:700;font-size:14px">${escapeHtml(n.label)}</div>
        <div class="small">USDT · ${escapeHtml(n.short)}</div>
      </div>`);
  }
  el.querySelectorAll('.network-card').forEach((card) => card.addEventListener('click', async () => {
    card.classList.add('spinner');
    try {
      if (payment && payment.status === 'pending') await api('/api/payments/' + payment.id + '/cancel', 'POST');
      const data = await api('/api/payments', 'POST', { network: card.dataset.net });
      location.href = '/app/pay.html?id=' + data.payment.id;
    } catch (e) { err.textContent = e.message; err.classList.add('show'); }
    card.classList.remove('spinner');
  }));
}

initApp().then((user) => {
  if (!user) return;
  loadPayment().catch((e) => {
    err.textContent = e.message;
    err.classList.add('show');
  });
  loadNetworkSwitcher().catch(() => {});
});