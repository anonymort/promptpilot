import { addMonths, nowIso } from "./utils.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function randomToken(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function pbkdf2(password, saltBytes, iterations = 120000) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256"
    },
    key,
    256
  );

  return bytesToBase64Url(new Uint8Array(bits));
}

export async function createPasswordRecord(password) {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = bytesToBase64Url(saltBytes);
  const hash = await pbkdf2(password, saltBytes);
  return { salt, hash };
}

export async function verifyPassword(password, salt, expectedHash) {
  const actual = await pbkdf2(password, base64UrlToBytes(salt));
  return actual === expectedHash;
}

export function readBearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim() || null;
}

export async function createSession(env, userId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const now = nowIso();
  const expiresAt = addMonths(now, 1);

  await env.DB.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    tokenHash,
    now,
    expiresAt,
    now
  ).run();

  return {
    token,
    expiresAt
  };
}

export async function deleteSession(env, token) {
  const tokenHash = await sha256(token);
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
}

export async function authenticateRequest(env, request) {
  const token = readBearerToken(request);
  if (!token) return null;

  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT
      users.id,
      users.email,
      users.plan,
      users.plan_expires_at,
      users.status,
      sessions.id AS session_id,
      sessions.expires_at AS session_expires_at
    FROM sessions
    INNER JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first();

  if (!row) return null;
  const now = new Date();

  if (row.session_expires_at && new Date(row.session_expires_at) <= now) {
    await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.session_id).run();
    return null;
  }

  let effectivePlan = row.plan || "free";
  if (row.plan_expires_at && new Date(row.plan_expires_at) <= now && effectivePlan !== "free") {
    effectivePlan = "free";
    await env.DB.prepare(`
      UPDATE users
      SET plan = 'free', plan_expires_at = NULL, updated_at = ?
      WHERE id = ?
    `).bind(nowIso(), row.id).run();
  }

  await env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`)
    .bind(nowIso(), row.session_id)
    .run();

  return {
    id: row.id,
    email: row.email,
    plan: effectivePlan,
    planExpiresAt: row.plan_expires_at,
    status: row.status
  };
}
