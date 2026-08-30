const err = document.getElementById('err');
const EXPLORERS = { TRC20: 'https://tronscan.org/#/transaction/', BEP20: 'https://bscscan.com/tx/', ERC20: 'https://etherscan.io/tx/' };

function statusPill(status) {
  const map = { pending: ['pending', 'PENDING'], paid: ['paid', 'PAID'], cancelled: ['be', 'CANCELLED'], expired: ['expired', 'EXPIRED'] };
  const [cls, label] = map[status] || ['be', status];
  return `<span class="status-pill badge-${cls}">${label}</span>`;
}

async function loadOverview() {
  const data = await api('/api/admin/overview');
  document.getElementById('oUsers').textContent = data.users;
  document.getElementById('oActive').textContent = data.active;
  document.getElementById('oTrials').textContent = data.trial;
  document.getElementById('oExpired').textContent = data.expired;
  document.getElementById('oRevenue').textContent = data.paidRevenueUSDT;
  document.getElementById('oPending').textContent = data.pendingPayments;
}

async function loadPayments() {
  const data = await api('/api/admin/payments');
  const el = document.getElementById('paymentsTable');
  if (!data.payments.length) { el.innerHTML = '<p class="empty">No payments yet.</p>'; return; }
  el.innerHTML = `
    <div style="overflow-x:auto">
    <table class="tbl">
      <tr><th>User</th><th>Network</th><th>Amount</th><th>Status</th><th>Created</th><th>TX</th><th>Actions</th></tr>
      ${data.payments.map((p) => {
        const tx = p.status === 'paid' && p.confirmedTx
          ? `<a class="small" target="_blank" rel="noopener" href="${EXPLORERS[p.network] || ''}${p.confirmedTx}">${escapeHtml(p.confirmedTx.slice(0, 14))}…</a>`
          : '—';
        const actions = p.status === 'pending'
          ? `<button class="btn btn-sm" data-confirm="${p.id}">✓ Confirm</button> <button class="btn btn-sm btn-ghost" data-cancel="${p.id}" style="color:var(--danger)">✕</button>`
          : '—';
        return `<tr>
          <td>${escapeHtml(p.userEmail)}</td>
          <td><span class="mono">${p.network}</span></td>
          <td>${p.amount} USDT</td>
          <td>${statusPill(p.status)}</td>
          <td class="small">${new Date(p.createdAt).toLocaleString()}</td>
          <td>${tx}</td>
          <td>${actions}</td>
        </tr>`;
      }).join('')}
    </table></div>`;
  el.querySelectorAll('[data-confirm]').forEach((b) => b.addEventListener('click', async () => {
    await api('/api/admin/payments/' + b.dataset.confirm + '/confirm', 'POST');
    loadPayments(); loadOverview();
  }));
  el.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    await api('/api/admin/payments/' + b.dataset.cancel + '/cancel', 'POST');
    loadPayments();
  }));
}

async function loadWallet() {
  const data = await api('/api/admin/wallet');
  const w = data.wallet || {};
  document.getElementById('wTRC20').value = w.TRC20 || '';
  document.getElementById('wBEP20').value = w.BEP20 || '';
  document.getElementById('wERC20').value = w.ERC20 || '';
}

document.getElementById('walletForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  err.classList.remove('show');
  try {
    await api('/api/admin/wallet', 'POST', {
      TRC20: document.getElementById('wTRC20').value,
      BEP20: document.getElementById('wBEP20').value,
      ERC20: document.getElementById('wERC20').value
    });
    const s = document.getElementById('walletSaved');
    s.textContent = 'Saved ✓';
    setTimeout(() => { s.textContent = ''; }, 2000);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add('show');
  }
});

document.querySelectorAll('[data-fetch]').forEach((b) => b.addEventListener('click', async () => {
  const net = b.dataset.fetch;
  b.disabled = true; b.classList.add('spinner'); b.textContent = 'Contacting Binance…';
  err.classList.remove('show');
  try {
    const data = await api('/api/admin/wallet/binance-fetch', 'POST', { network: net });
    const map = { 'TRC20': 'wTRC20', 'BEP20': 'wBEP20', 'ERC20': 'wERC20' };
    document.getElementById(map[net]).value = data.address;
    b.textContent = 'Fetched ✓';
  } catch (ex) {
    err.textContent = ex.message + ' — you can paste your address manually instead.';
    err.classList.add('show');
    b.textContent = 'Auto-fetch from Binance (' + net + ')';
  }
  b.disabled = false; b.classList.remove('spinner');
}));

initApp().then((user) => {
  if (!user) return;
  if (!user.admin) { location.href = '/app/dashboard.html'; return; }
  loadOverview();
  loadPayments();
  loadWallet();
});