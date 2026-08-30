const crypto = require('crypto');

const BINANCE_API = process.env.BINANCE_API_URL || 'https://api.binance.com';

function signQuery(query, secret) {
  const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');
  return query + '&signature=' + signature;
}

async function binanceFetch(pathname, queryParams, key, secret) {
  const query = Object.keys(queryParams)
    .sort()
    .map((k) => k + '=' + encodeURIComponent(queryParams[k]))
    .join('&') + '&timestamp=' + Date.now();
  const signed = signQuery(query, secret);
  const res = await fetch(BINANCE_API + pathname + '?' + signed, {
    headers: { 'X-MBX-APIKEY': key },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Binance API ' + res.status + ': ' + body.slice(0, 200));
  }
  return res.json();
}

const NETWORK_TO_BINANCE = { TRC20: 'TRX', BEP20: 'BSC', ERC20: 'ETH' };

async function fetchDepositAddress(coin, network) {
  const key = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_API_SECRET;
  if (!key || !secret) throw new Error('BINANCE_API_KEY / BINANCE_API_SECRET not set in server config.');
  const bn = NETWORK_TO_BINANCE[network] || network;
  const data = await binanceFetch('/sapi/v1/capital/deposit/address', { coin, network: bn }, key, secret);
  if (!data || !data.address) {
    const msg = data && (data.msg || data.error) ? JSON.stringify(data.msg || data.error) : 'no address returned';
    throw new Error('Binance: ' + msg);
  }
  return data;
}

module.exports = { fetchDepositAddress };