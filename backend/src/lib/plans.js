const PLAN_QUOTAS = {
  free: {
    window: "day",
    limit: 2
  },
  starter: {
    window: "month",
    limit: 120
  },
  pro: {
    window: "month",
    limit: 400
  },
  supporter: {
    window: "unlimited",
    limit: null
  }
};

export function getPlanQuota(plan) {
  return PLAN_QUOTAS[plan] ?? PLAN_QUOTAS.free;
}

export function isKnownPlan(plan) {
  return Object.prototype.hasOwnProperty.call(PLAN_QUOTAS, plan);
}

export function normalizePlan(plan) {
  const value = String(plan || "free").trim().toLowerCase();
  return isKnownPlan(value) ? value : "free";
}

export function buildUsageSummary(plan, used) {
  const quota = getPlanQuota(plan);
  return {
    window: quota.window,
    limit: quota.limit,
    used,
    remaining: quota.limit === null ? null : Math.max(0, quota.limit - used),
    isUnlimited: quota.limit === null
  };
}
