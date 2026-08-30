let __csrf = '';
let __csrfRefreshing = false;
async function ensureCsrf(force) {
  try {
    if (force || !__csrf) {
      if (__csrfRefreshing) {
        await __csrfRefreshing;
        return __csrf;
      }
      __csrfRefreshing = (async () => {
        const p = /csrf=([^;]+)/.exec(document.cookie);
        if (force || !p) __csrf = decodeURIComponent(p ? p[1] : '');
        if (!__csrf) __csrf = (await (await fetch('/api/csrf')).json()).token;
      })();
      await __csrfRefreshing;
      __csrfRefreshing = false;
    }
  } catch (e) { /* ignore */ }
  return __csrf;
}

async function getMe() {
  try {
    const res = await fetch('/api/auth/me', { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (res.status === 401) { location.href = '/login.html'; return null; }
    const data = await res.json();
    return data.user || null;
  } catch {
    return null;
  }
}

async function api(path, method, body, _retried) {
  const opts = { method: method || 'GET', headers: { 'Accept': 'application/json' } };
  opts.headers['X-CSRF-Token'] = await ensureCsrf();
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, Object.assign(opts, { signal: AbortSignal.timeout(20000) }));
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Not logged in.'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 && !_retried && /security token/i.test(data.error || '')) {
    await ensureCsrf(true);
    return api(path, method, body, true);
  }
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
  if (user.status === 'active' || user.admin) links.splice(1, 0, ['guide', 'Guide', '/app/guide.html']);
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

function renderSupport() {
  if (document.getElementById('supportWidget')) return;
  const FAQ = [
    { q: 'How does payment work?', a: 'Choose a network (TRC-20 is fastest), pay the exact USD amount in USDT to the address shown, then press "I sent it". Access unlocks automatically within about a minute — or by the owner if a network is slow.' },
    { q: 'What happens when my subscription ends?', a: 'Your access locks automatically. Go to Plan, pay again and your premium time is added to the time you have left. Nothing is deleted.' },
    { q: 'How do I earn free days from invites?', a: 'Open Invite in the menu, copy your personal link and share it. For every 5 friends who sign up with your link AND subscribe, you get 15 extra days free.' },
    { q: 'How do I use the Journal?', a: 'Log each trade with pair, direction, entry, exit and stop-loss. The AI coach then reviews your habits and scores your discipline daily on the Dashboard.' },
    { q: 'What does the Calculator do?', a: 'It converts your account size and risk percentage into the exact lot size and pip value for any pair — so you never risk more than you planned.' },
    { q: 'Is my money and data safe?', a: 'Payments go to your owner’s verified wallet by QR. Passwords are hashed, sessions are HttpOnly, and every action outside payments needs a security token. You can always ask the owner to manually confirm a payment.' }
  ];
  const w = document.createElement('div');
  w.id = 'supportWidget';
  w.innerHTML = `
    <button class="sup-fab" id="supFab" aria-label="Help"><span>?</span></button>
    <div class="sup-panel hidden" id="supPanel">
      <div class="sup-head">Help &amp; FAQ<button class="sup-x" id="supX">×</button></div>
      <div class="sup-body">
        ${FAQ.map((f, i) => `
          <div class="faq">
            <button class="faq-q" data-i="${i}">${escapeHtml(f.q)}<span class="faq-arrow">▾</span></button>
            <div class="faq-a hidden">${f.a}</div>
          </div>`).join('')}
      </div>
      <div class="sup-foot">Still stuck? <a href="mailto:support@fxcoach.io?subject=Help%20request">Email support</a></div>
    </div>`;
  document.body.appendChild(w);
  const panel = document.getElementById('supPanel');
  const toggle = () => panel.classList.toggle('hidden');
  document.getElementById('supFab').addEventListener('click', toggle);
  document.getElementById('supX').addEventListener('click', () => panel.classList.add('hidden'));
  panel.querySelectorAll('.faq-q').forEach((btn) => btn.addEventListener('click', () => {
    const a = btn.nextElementSibling;
    a.classList.toggle('hidden');
    btn.querySelector('.faq-arrow').textContent = a.classList.contains('hidden') ? '▾' : '▴';
  }));
}

function fmt(n, digits) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Number(n).toFixed(digits === undefined ? 2 : digits);
}

function fmtNum(n) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function celebrate(ms) {
  const colors = ['#8b5cf6', '#22c55e', '#38bdf8', '#f0b90b', '#f87171', '#fbbf24'];
  const duration = ms || 3200;
  for (let i = 0; i < 70; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.background = colors[i % colors.length];
    p.style.left = Math.random() * 100 + 'vw';
    p.style.animationDuration = (2 + Math.random() * 2) + 's';
    p.style.animationDelay = (Math.random() * 0.7) + 's';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), duration);
  }
}

async function initApp() {
  const user = await getMe();
  if (!user) {
    const b = document.createElement('div');
    b.className = 'session-banner';
    b.innerHTML = '⚠ Session error — please <a href="/login.html" style="color:inherit;text-decoration:underline;font-weight:700">log in again</a>.';
    document.body.prepend(b);
    return null;
  }
  if (user.status === 'expired' && !location.pathname.endsWith('subscribe.html') && !location.pathname.endsWith('pay.html')) {
    location.href = '/app/subscribe.html';
    return null;
  }
  renderNav(user);
  renderSupport();
  return user;
}