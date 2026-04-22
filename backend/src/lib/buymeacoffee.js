import { normalizeEmail, nowIso } from "./utils.js";

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stripSignaturePrefix(value) {
  return String(value || "").trim().replace(/^sha256=/i, "");
}

async function hmacSha256(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return new Uint8Array(signature);
}

export async function verifyWebhookSignature(secret, payload, signatureHeader) {
  if (!secret) return false;
  const signature = stripSignaturePrefix(signatureHeader);
  if (!signature) return false;

  const digest = await hmacSha256(secret, payload);
  const expectedHex = bytesToHex(digest);
  const expectedBase64 = btoa(String.fromCharCode(...digest));
  const expectedBase64Url = expectedBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  return (
    signature.toLowerCase() === expectedHex ||
    signature === expectedBase64 ||
    signature === expectedBase64Url
  );
}

function getNestedValue(object, path) {
  return path.split(".").reduce((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return current[segment];
    }
    return undefined;
  }, object);
}

function firstString(object, paths) {
  for (const path of paths) {
    const value = getNestedValue(object, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeEventType(payload) {
  return firstString(payload, [
    "type",
    "event",
    "event_type",
    "name",
    "trigger",
    "data.type",
    "data.event",
    "data.event_type"
  ]).toLowerCase();
}

function normalizePaymentStatus(payload) {
  return firstString(payload, [
    "status",
    "payment_status",
    "support.status",
    "data.status",
    "data.payment_status",
    "membership.status"
  ]).toLowerCase();
}

export function extractWebhookSummary(payload) {
  const eventType = normalizeEventType(payload);
  const status = normalizePaymentStatus(payload);
  const email = normalizeEmail(firstString(payload, [
    "email",
    "supporter_email",
    "payer_email",
    "data.email",
    "data.supporter_email",
    "data.payer_email",
    "supporter.email",
    "support.email",
    "membership.email",
    "member.email",
    "payload.email",
    "payload.supporter.email"
  ]));
  const eventId = firstString(payload, [
    "id",
    "event_id",
    "transaction_id",
    "support_id",
    "membership.id",
    "data.id",
    "data.event_id",
    "data.transaction_id"
  ]);
  const amount = firstString(payload, [
    "amount",
    "support_amount",
    "total_amount",
    "data.amount",
    "data.support_amount",
    "support.amount"
  ]);
  const currency = firstString(payload, [
    "currency",
    "currency_code",
    "data.currency",
    "support.currency"
  ]).toUpperCase();

  return {
    eventId,
    eventType,
    status,
    email,
    amount,
    currency
  };
}

export function classifyWebhookAction(summary) {
  const eventType = summary.eventType;
  const status = summary.status;

  const isRefund = /(refund|refunded|reversal|reversed|chargeback)/.test(eventType);
  const isCancellation = /(cancel|cancelled|canceled)/.test(eventType);
  if (isRefund || isCancellation) {
    return "revoke";
  }

  const isMembership = eventType.includes("membership");
  const isSupport = /(support|coffee|donation|contribution|purchase|transaction|payment)/.test(eventType);
  const looksSuccessful = !status || /(paid|success|succeed|completed|active|created|renewed|updated)/.test(status);

  if (looksSuccessful && (isMembership || isSupport)) {
    return "grant";
  }

  return "ignore";
}

export async function findUserByEmail(env, email) {
  if (!email) return null;
  return await env.DB.prepare(`
    SELECT id, email, plan, plan_expires_at, status, donation_unlocked_at
    FROM users
    WHERE email = ?
    LIMIT 1
  `).bind(email).first();
}

export async function beginWebhookEvent(env, eventKey, summary, rawBody) {
  await env.DB.prepare(`
    INSERT INTO buymeacoffee_events (
      event_key,
      source_event_id,
      event_type,
      event_status,
      email,
      amount,
      currency,
      matched_user_id,
      action,
      raw_body,
      received_at,
      processed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'received', ?, ?, NULL)
  `).bind(
    eventKey,
    summary.eventId || null,
    summary.eventType || "",
    summary.status || "",
    summary.email || null,
    summary.amount || null,
    summary.currency || null,
    rawBody,
    nowIso()
  ).run();
}

export async function finishWebhookEvent(env, eventKey, { matchedUserId = null, action = "ignored" } = {}) {
  await env.DB.prepare(`
    UPDATE buymeacoffee_events
    SET matched_user_id = ?, action = ?, processed_at = ?
    WHERE event_key = ?
  `).bind(matchedUserId, action, nowIso(), eventKey).run();
}

export async function grantDonationUnlock(env, userId, reference) {
  await env.DB.prepare(`
    UPDATE users
    SET donation_unlocked_at = COALESCE(donation_unlocked_at, ?),
        donation_source = 'buymeacoffee',
        donation_reference = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(nowIso(), reference, nowIso(), userId).run();
}

export async function revokeDonationUnlock(env, userId) {
  await env.DB.prepare(`
    UPDATE users
    SET donation_unlocked_at = NULL,
        donation_source = NULL,
        donation_reference = NULL,
        updated_at = ?
    WHERE id = ?
  `).bind(nowIso(), userId).run();
}
