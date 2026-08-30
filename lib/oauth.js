const crypto = require('crypto');
const { users } = require('./db');

function randomState() {
  return crypto.randomBytes(24).toString('hex');
}

function authUrl(state, redirectUri) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  const redirect = redirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

async function exchangeCode(code, redirectUri) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect = redirectUri || process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirect,
    grant_type: 'authorization_code'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('Google token exchange failed (' + res.status + ')');
  return res.json();
}

function decodeIdToken(idToken) {
  try {
    const parts = String(idToken || '').split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function fetchProfile(tokens) {
  const accessToken = tokens.access_token;
  const endpoints = [
    'https://www.googleapis.com/oauth2/v3/userinfo',
    'https://openidconnect.googleapis.com/v1/userinfo',
    'https://oauth2.googleapis.com/userinfo'
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + accessToken },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) return res.json();
    } catch (e) { /* try next */ }
  }
  const idClaims = decodeIdToken(tokens.id_token);
  if (idClaims && idClaims.email) {
    return {
      email: idClaims.email,
      email_verified: idClaims.email_verified === true || idClaims.email_verified === 'true',
      name: idClaims.name || '',
      sub: idClaims.sub
    };
  }
  throw new Error('Google profile fetch failed.');
}

function hashPassword(pw) { return pw; }

async function upsertGoogleUser(profile) {
  if (!profile.email) throw new Error('Google account has no email.');
  if (profile.email_verified !== true) throw new Error('Google email not verified.');
  const email = String(profile.email).toLowerCase();
  let user = users.findByEmail(email);
  if (user) return user;
  const isAdmin = !!process.env.ADMIN_EMAIL && String(process.env.ADMIN_EMAIL).toLowerCase() === email;
  user = {
    id: crypto.randomUUID(),
    name: profile.name || profile.email.split('@')[0],
    email,
    provider: 'google',
    passwordHash: null,
    admin: isAdmin,
    plan: 'trial',
    trialEnds: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    planEnds: null,
    watchlist: ['EURUSD', 'GBPUSD', 'USDJPY'],
    createdAt: new Date().toISOString()
  };
  await users.save(user);
  return user;
}

module.exports = { authUrl, exchangeCode, fetchProfile, upsertGoogleUser, randomState, hashPassword };