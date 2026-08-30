const PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'AUDUSD', 'USDCHF', 'NZDUSD',
  'XAUUSD', 'USDTRY', 'USDMXN', 'EURJPY', 'EURGBP', 'GBPJPY', 'AUDJPY',
  'USDSGD', 'NZDUSD', 'EURNZD', 'GBPAUD', 'AUDNZD', 'EURCHF'
];

function pipInfo(pair) {
  const p = String(pair).toUpperCase();
  if (p === 'XAUUSD' || p === 'XAGUSD' || p === 'XAUXAU') return { pipSize: 0.01, pipValuePerLot: 10 };
  if (p.endsWith('JPY') || p.includes('JPY')) return { pipSize: 0.01, pipValuePerLot: 9.3 };
  return { pipSize: 0.0001, pipValuePerLot: 10 };
}

function positionSize({ balance, riskPercent, entry, stop, pair }) {
  const bal = parseFloat(balance);
  const risk = parseFloat(riskPercent);
  const p = String(pair).toUpperCase();
  const e = parseFloat(entry);
  const s = parseFloat(stop);
  const invalid = !isFinite(bal) || !isFinite(risk) || !isFinite(e) || !isFinite(s) || bal <= 0 || risk <= 0 || risk > 100 || e <= 0 || s <= 0;
  if (invalid) return { error: 'Check your inputs. Balance > 0, risk between 0 and 100, valid entry and stop.' };

  const riskUSD = bal * risk / 100;
  const { pipSize, pipValuePerLot } = pipInfo(p);
  const distancePips = Math.abs(e - s) / pipSize;
  if (distancePips === 0) return { error: 'Entry and stop cannot be equal.' };
  const lossPct = Math.abs(e - s) / e * 100;
  const riskPerLot = pipValuePerLot * distancePips;
  const lots = riskUSD / riskPerLot;
  const units = Math.round(lots * 100000);

  return {
    pair: p,
    riskUSD: round2(riskUSD),
    riskPercent: risk,
    distancePips: round2(distancePips),
    lossPctOfPrice: round2(lossPct),
    lots: round2(lots),
    units,
    pipValuePerLot,
    disclaimer: 'Approximate sizing for educational purposes. Check your broker\'s contract specifications.'
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { PAIRS, pipInfo, positionSize };