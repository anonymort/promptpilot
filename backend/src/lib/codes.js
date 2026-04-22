import { isKnownPlan, normalizePlan } from "./plans.js";
import { addMonths, conflict, isUniqueConstraintError, nowIso } from "./utils.js";

async function getAccessCodeRecord(env, code) {
  return await env.DB.prepare(`
    SELECT code, plan, months, max_redemptions, expires_at
    FROM access_codes
    WHERE code = ?
    LIMIT 1
  `).bind(code).first();
}

async function getRedemption(env, code) {
  return await env.DB.prepare(`
    SELECT code, user_id, claimed_at, granted_at
    FROM access_code_redemptions
    WHERE code = ?
    LIMIT 1
  `).bind(code).first();
}

async function getFreshUser(env, userId) {
  return await env.DB.prepare(`
    SELECT id, email, plan, plan_expires_at, status
    FROM users
    WHERE id = ?
    LIMIT 1
  `).bind(userId).first();
}

async function claimCode(env, code, userId) {
  try {
    await env.DB.prepare(`
      INSERT INTO access_code_redemptions (code, user_id, claimed_at, granted_at)
      VALUES (?, ?, ?, NULL)
    `).bind(code, userId, nowIso()).run();

    return await getRedemption(env, code);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return await getRedemption(env, code);
  }
}

export async function redeemAccessCode(env, user, code) {
  const record = await getAccessCodeRecord(env, code);
  if (!record) return conflict("Invalid code");
  if (Number(record.max_redemptions || 1) !== 1) {
    return conflict("This code format is not supported by this starter");
  }
  if (record.expires_at && new Date(record.expires_at) <= new Date()) {
    return conflict("Code has expired");
  }
  if (!isKnownPlan(record.plan)) return conflict("Code plan is invalid");

  const claim = await claimCode(env, code, user.id);
  if (!claim) return conflict("Code is not available");
  if (claim.user_id !== user.id) {
    return conflict("Code has already been fully redeemed");
  }

  if (claim.granted_at) {
    const currentUser = await getFreshUser(env, user.id);
    return {
      ok: true,
      user: {
        id: currentUser.id,
        email: currentUser.email,
        plan: currentUser.plan,
        planExpiresAt: currentUser.plan_expires_at
      }
    };
  }

  const currentUser = await getFreshUser(env, user.id);
  const now = nowIso();
  const baseDate = currentUser.plan_expires_at && new Date(currentUser.plan_expires_at) > new Date(now)
    ? currentUser.plan_expires_at
    : now;
  const newExpiry = addMonths(baseDate, Number(record.months || 12));
  const newPlan = normalizePlan(record.plan);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE users
      SET plan = ?, plan_expires_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(newPlan, newExpiry, now, user.id),
    env.DB.prepare(`
      UPDATE access_code_redemptions
      SET granted_at = COALESCE(granted_at, ?)
      WHERE code = ? AND user_id = ?
    `).bind(now, code, user.id),
    env.DB.prepare(`
      UPDATE access_codes
      SET redeemed_count = 1
      WHERE code = ?
    `).bind(code)
  ]);

  return {
    ok: true,
    user: {
      id: currentUser.id,
      email: currentUser.email,
      plan: newPlan,
      planExpiresAt: newExpiry
    }
  };
}
