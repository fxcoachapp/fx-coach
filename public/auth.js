(async function () {
  const err = document.getElementById('err');
  const form = document.getElementById('signupForm') || document.getElementById('loginForm');
  if (!form) return;
  const isSignup = !!document.getElementById('signupForm');

  let csrf = '';
  try {
    const p = /csrf=([^;]+)/.exec(document.cookie);
    if (p) csrf = decodeURIComponent(p[1]);
    if (!csrf) csrf = (await (await fetch('/api/csrf')).json()).token;
  } catch (e) { /* keep empty */ }

  const params = new URLSearchParams(location.search);
  if (params.get('error') === 'not_configured') {
    err.textContent = 'Google sign-in is not configured yet by the owner.';
    err.classList.add('show');
  } else if (params.get('error') === 'google_denied') {
    err.textContent = 'Google sign-in was cancelled.';
    err.classList.add('show');
  } else if (params.get('error') && params.get('error').startsWith('google')) {
    const detail = params.get('detail');
    err.textContent = 'Google sign-in failed' + (detail ? ' — ' + detail : '') + '. Please try again or use email.';
    err.classList.add('show');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.classList.remove('show');
    const btn = document.getElementById('submit');
    btn.disabled = true;
    btn.textContent = form.getAttribute('data-busy') || 'Please wait…';
    const body = isSignup
      ? { name: document.getElementById('name').value, email: document.getElementById('email').value, password: document.getElementById('password').value }
      : { email: document.getElementById('email').value, password: document.getElementById('password').value };
    try {
      const res = await fetch(isSignup ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed.');
      location.href = '/app/dashboard.html';
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.add('show');
      btn.disabled = false;
      btn.textContent = isSignup ? 'Create account' : 'Log in';
    }
  });
})();