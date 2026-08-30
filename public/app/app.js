let __csrf = '';
async function ensureCsrf() {
  try {
    const p = /csrf=([^;]+)/.exec(document.cookie);
    if (p) __csrf = decodeURIComponent(p[1]);
    if (!__csrf) __csrf = (await (await fetch('/api/csrf')).json()).token;
  } catch (e) { /* ignore */ }
  return __csrf;
}

async function getMe() {
  try {
    const res = await fetch('/api/auth/me', { headers: { 'Accept': 'application/json' } });
    if (res.status === 401) { location.href = '/login.html'; return null; }
    const data = await res.json();
    return data.user || null;
  } catch {
    return null;
  }
}

async function api(path, method, body) {
  await ensureCsrf();
  const opts = { method: method || 'GET', headers: { 'Accept': 'application/json' } };
  opts.headers['X-CSRF-Token'] = __csrf;
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Not logged in.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 404 && !res.ok) throw new Error(data.error || 'Not found.');
  if (res.status === 403 && data.code === 'PAYMENT_REQUIRED') {
    if (!location.pathname.endsWith('subscribe.html')) location.href = '/app/subscribe.html';
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function statusBadge(status) {
  if (status === 'active') return '<span class="badge badge-active">PRO</span>';
  if (status === 'trial') return '<span class="badge badge-trial">TRIAL</span>';
  return '<span class="badge badge-expired">EXPIRED</span>';
}

function renderNav(user) {
  const holder = document.getElementById('nav');
  if (!holder || !user) return;
  const page = document.body.dataset.page;
  const links = [
    ['dashboard', 'Dashboard', '/app/dashboard.html'],
    ['journal', 'Journal', '/app/journal.html'],
    ['calculator', 'Calculator', '/app/calculator.html'],
    ['refer', 'Invite', '/app/refer.html'],
    ['subscribe', 'Plan', '/app/subscribe.html']
  ];
  if (user.admin) links.push(['admin', 'Admin', '/app/admin.html']);
  const html = `
    <div class="app-nav">
      <a class="brand" href="/app/dashboard.html" style="color:inherit"><span class="logo">F</span>FX<span>Coach</span></a>
      <div class="links">${links.map(([p, label, href]) =>
        `<a href="${href}" class="${page === p ? 'active' : ''}">${label}</a>`).join('')}
      </div>
      <div class="small">Hi, <b>${escapeHtml(user.name)}</b> ${statusBadge(user.status)}
        <a href="#" id="logout" style="margin-left:10px;color:var(--muted)">Log out</a>
      </div>
    </div>`;
  holder.innerHTML = html;
  document.getElementById('logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmt(n, digits) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Number(n).toFixed(digits === undefined ? 2 : digits);
}

function fmtNum(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

async function initApp() {
  const user = await getMe();
  if (!user) return null;
  if (user.status === 'expired' && !location.pathname.endsWith('subscribe.html') && !location.pathname.endsWith('pay.html')) {
    location.href = '/app/subscribe.html';
    return null;
  }
  renderNav(user);
  return user;
}