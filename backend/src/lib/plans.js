const PLAN_LIMITS = {
  free: 10,
  starter: 120,
  pro: 400
};

export function getPlanLimit(plan) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

export function isKnownPlan(plan) {
  return Object.prototype.hasOwnProperty.call(PLAN_LIMITS, plan);
}

export function normalizePlan(plan) {
  const value = String(plan || "free").trim().toLowerCase();
  return isKnownPlan(value) ? value : "free";
}
