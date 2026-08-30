const PLAN_PRICE = 10;
const PLAN_CURRENCY = 'USD';
const TRIAL_DAYS = 7;
const REFERRAL_THRESHOLD = 5;
const REFERRAL_BONUS_DAYS = 15;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function extendPremium(user, days) {
  const base = user.planEnds && new Date(user.planEnds).getTime() > Date.now()
    ? new Date(user.planEnds).getTime()
    : Date.now();
  user.plan = 'active';
  user.planEnds = new Date(base + days * 24 * 60 * 60 * 1000).toISOString();
}

function accessStatus(user) {
  const now = Date.now();
  if (!user) return 'none';
  if (user.plan === 'active') {
    if (user.planEnds && new Date(user.planEnds).getTime() > now) return 'active';
    return 'expired';
  }
  if (user.plan === 'trial') {
    if (user.trialEnds && new Date(user.trialEnds).getTime() > now) return 'trial';
    return 'expired';
  }
  return 'expired';
}

function renewalDate(currentPlanEnds) {
  const base = currentPlanEnds && new Date(currentPlanEnds).getTime() > Date.now()
    ? new Date(currentPlanEnds).getTime()
    : Date.now();
  return new Date(base + MONTH_MS).toISOString();
}

module.exports = { PLAN_PRICE, PLAN_CURRENCY, TRIAL_DAYS, MONTH_MS, REFERRAL_THRESHOLD, REFERRAL_BONUS_DAYS, accessStatus, renewalDate, extendPremium };