const err = document.getElementById('err');
const EXPLORERS = { TRC20: 'https://tronscan.org/#/transaction/', BEP20: 'https://bscscan.com/tx/', ERC20: 'https://etherscan.io/tx/' };

function statusPill(status) {
  const map = { pending: ['pending', 'PENDING'], paid: ['paid', 'PAID'], cancelled: ['be', 'CANCELLED'], expired: ['expired', 'EXPIRED'] };
  const [cls, label] = map[status] || ['be', status];
  return `<span class="status-pill badge-${cls}">${label}</span>`;
}

function daysLeft(u) {
  const end = u.status === 'trial' ? (u.trialEnds || u.planEnds) : u.planEnds;
  if (!end) return '';
  const d = Math.ceil((new Date(end).getTime() - Date.now()) / 86400000);
  if (d < 1) return '';
  return d + 'd';
}

async function loadUsers() {
  const data = await api('/api/admin/users');
  const el = document.getElementById('usersTable');
  document.getElementById('usersCount').textContent = '(' + data.users.length + ')';
  if (!data.users.length) { el.innerHTML = '<p class="empty">No users yet.</p>'; return; }
  el.innerHTML = `
    <div style="overflow-x:auto">
    <table class="tbl">
      <tr><th>Email</th><th>Name</th><th>Account</th><th>Status</th><th>Invites</th><th>Paid (USDT)</th><th>Joined</th><th></th></tr>
      ${data.users.map((u) => `
        <tr>
          <td>${escapeHtml(u.email)}${u.email === __me.email ? ' <span class="badge badge-active">you</span>' : ''}</td>
          <td>${escapeHtml(u.name)}</td>
          <td><span class="badge ${u.provider === 'google' ? 'badge-trial' : 'badge-be'}">${u.provider === 'google' ? 'Google' : 'Email'}</span></td>
          <td>
            ${statusBadge(u.status)}
            ${u.status === 'active' || u.status === 'trial' ? `<span class="tag">${daysLeft(u)} left</span>` : ''}
            <div class="small">${u.plan}</div>
          </td>
          <td class="small">${u.invites} invited · <b>${u.confirmedRefs}</b> paid</td>
          <td>${u.paidTotal ? u.paidTotal.toFixed(0) + ' USDT' : '<span class="muted">—</span>'}</td>
          <td class="small">${new Date(u.createdAt).toLocaleDateString()}</td>
          <td>${u.status === 'active' ? `<button class="btn btn-sm revoke-btn" data-email="${escapeHtml(u.email)}">Revoke</button>` : ''}</td>
        </tr>`).join('')}
    </table></div>`;
  el.querySelectorAll('.revoke-btn').forEach((btn) => btn.addEventListener('click', revokeVip));
}

async function revokeVip(e) {
  const email = e.target.dataset.email;
  if (!confirm('Revoke VIP access for ' + email + '? They will lose access immediately.')) return;
  try {
    const res = await api('/api/admin/revoke-vip', 'POST', { email });
    alert(res.user.name + ' (' + email + ') revoked.');
    loadOverview();
    loadUsers();
  } catch (ex) {
    alert(ex.message);
  }
}

function grantVip() {
  const form = document.getElementById('grantForm');
  const msg = document.getElementById('grantMsg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = 'Working…';
    try {
      const res = await api('/api/admin/grant-vip', 'POST', {
        email: document.getElementById('gEmail').value.trim(),
        days: parseInt(document.getElementById('gDays').value || '30', 10)
      });
      msg.style.color = 'var(--accent)';
      msg.textContent = res.user.name + ' (' + res.user.email + ') is now ' + res.user.status.toUpperCase() + ' until ' + new Date(res.user.planEnds).toLocaleDateString() + '.';
      loadOverview();
      loadUsers();
      document.getElementById('gEmail').value = '';
    } catch (ex) {
      msg.style.color = 'var(--danger)';
      msg.textContent = ex.message;
    }
  });
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
          ? `<button class="btn btn-sm" data-confirm="${p.id}">✓ Confirm</button> <button class="btn btn-sm btn-ghost" data-cancel="${p.id}" style="color:var(--danger)">✕</button> <button class="btn btn-sm btn-ghost" data-edit="${p.id}" title="Edit amount">✏️</button>`
          : `<button class="btn btn-sm" data-edit="${p.id}" title="Reopen (undo cancel)">✏️ Reopen</button>`;
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
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.edit;
    const p = data.payments.find((x) => x.id === id);
    const raw = prompt('New amount in USDT (Leave empty to keep ' + (p ? p.amount : '') + ' and just reopen):', p ? String(p.amount) : '');
    if (raw === null) return;
    const amount = raw.trim() === '' ? undefined : Number(raw);
    if (amount !== undefined && (!isFinite(amount) || amount <= 0)) { err.textContent = 'Invalid amount.'; err.classList.add('show'); return; }
    await api('/api/admin/payments/' + id + '/reopen', 'POST', amount !== undefined ? { amount } : {});
    loadPayments(); loadOverview();
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
    const res = await api('/api/admin/wallet', 'POST', {
      TRC20: document.getElementById('wTRC20').value,
      BEP20: document.getElementById('wBEP20').value,
      ERC20: document.getElementById('wERC20').value
    });
    const s = document.getElementById('walletSaved');
    s.textContent = res.persisted === false ? '⚠ Saved in memory but NOT durable — Upstash write failing. Check Render logs.' : 'Saved ✓';
    setTimeout(() => { s.textContent = ''; }, 4000);
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

document.getElementById('fetchAll').addEventListener('click', async () => {
  const b = document.getElementById('fetchAll');
  b.disabled = true; b.textContent = 'Contacting Binance…';
  err.classList.remove('show');
  try {
    const data = await api('/api/admin/wallet/binance-fetch-all', 'POST', {});
    const map = { TRC20: 'wTRC20', BEP20: 'wBEP20', ERC20: 'wERC20' };
    for (const r of data.results) {
      if (r.address) document.getElementById(map[r.network]).value = r.address;
    }
    const failed = data.results.filter((r) => !r.address).map((r) => r.network);
    b.textContent = 'Done ✓' + (failed.length ? ' — ' + failed.join(', ') + ' empty' : '');
    var s = document.getElementById('walletSaved');
    s.textContent = failed.length ? 'Saved everything found; ' + failed.join(', ') + ' returned no address.' : 'Saved ✓ All networks set.';
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add('show');
    b.textContent = 'Auto-fetch ALL networks';
  }
  b.disabled = false;
});

grantVip();

initApp().then((user) => {
  if (!user) return;
  if (!user.admin) { location.href = '/app/dashboard.html'; return; }
  window.__me = user;
  loadOverview();
  loadUsers();
  loadPayments();
  loadWallet();
});