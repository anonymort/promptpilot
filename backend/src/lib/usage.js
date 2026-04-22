import { isUniqueConstraintError, nowIso, startOfCurrentUtcMonthIso } from "./utils.js";

const STALE_RESERVATION_MS = 10 * 60 * 1000;

export async function getMonthlyUsageCount(env, userId, now = new Date()) {
  const periodStart = startOfCurrentUtcMonthIso(now);
  await cleanupStaleUsageReservations(env, userId, now);

  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM usage_reservations
    WHERE user_id = ? AND period_start = ?
  `).bind(userId, periodStart).first();

  return Number(row?.count || 0);
}

export async function cleanupStaleUsageReservations(env, userId, now = new Date()) {
  const staleBefore = new Date(now.getTime() - STALE_RESERVATION_MS).toISOString();
  await env.DB.prepare(`
    DELETE FROM usage_reservations
    WHERE user_id = ?
      AND status = 'reserved'
      AND created_at < ?
  `).bind(userId, staleBefore).run();
}

export async function reserveUsageSlot(env, userId, monthlyLimit, now = new Date()) {
  const periodStart = startOfCurrentUtcMonthIso(now);
  await cleanupStaleUsageReservations(env, userId, now);

  for (let slot = 1; slot <= monthlyLimit; slot += 1) {
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
