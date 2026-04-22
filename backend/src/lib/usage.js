import {
  isUniqueConstraintError,
  nowIso,
  startOfCurrentUtcDayIso,
  startOfCurrentUtcMonthIso
} from "./utils.js";

const STALE_RESERVATION_MS = 10 * 60 * 1000;

function periodStartForWindow(window, now = new Date()) {
  if (window === "day") return startOfCurrentUtcDayIso(now);
  return startOfCurrentUtcMonthIso(now);
}

export async function getUsageCount(env, userId, window = "month", now = new Date()) {
  const periodStart = periodStartForWindow(window, now);
  await cleanupStaleUsageReservations(env, userId, window, now);

  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM usage_reservations
    WHERE user_id = ? AND period_start = ?
  `).bind(userId, periodStart).first();

  return Number(row?.count || 0);
}

export async function cleanupStaleUsageReservations(env, userId, window = "month", now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_RESERVATION_MS).toISOString();
  const periodStart = periodStartForWindow(window, now);
  await env.DB.prepare(`
    DELETE FROM usage_reservations
    WHERE user_id = ?
      AND period_start = ?
      AND status = 'reserved'
      AND created_at < ?
  `).bind(userId, periodStart, staleBefore).run();
}

export async function reserveUsageSlot(env, userId, quota, now = new Date()) {
  if (!quota || quota.limit === null) return null;

  const periodStart = periodStartForWindow(quota.window, now);
  await cleanupStaleUsageReservations(env, userId, quota.window, now);

  for (let slot = 1; slot <= quota.limit; slot += 1) {
    const reservationId = crypto.randomUUID();

    try {
      const result = await env.DB.prepare(`
        INSERT INTO usage_reservations (id, user_id, period_start, slot_number, status, created_at, consumed_at)
        VALUES (?, ?, ?, ?, 'reserved', ?, NULL)
      `).bind(reservationId, userId, periodStart, slot, nowIso()).run();

      if (result.meta?.changes === 1) {
        return { id: reservationId, periodStart, slotNumber: slot };
      }
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  return null;
}

export async function consumeUsageReservation(env, reservationId) {
  await env.DB.prepare(`
    UPDATE usage_reservations
    SET status = 'consumed', consumed_at = ?
    WHERE id = ?
  `).bind(nowIso(), reservationId).run();
}

export async function releaseUsageReservation(env, reservationId) {
  await env.DB.prepare(`
    DELETE FROM usage_reservations
    WHERE id = ? AND status = 'reserved'
  `).bind(reservationId).run();
}
