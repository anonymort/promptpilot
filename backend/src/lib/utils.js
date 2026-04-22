export function nowIso() {
  return new Date().toISOString();
}

export function startOfCurrentUtcMonthIso(date = new Date()) {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function addMonths(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function badRequest(message, details = null) {
  return json({ ok: false, error: message, details }, 400);
}

export function unauthorized(message = "Unauthorized") {
  return json({ ok: false, error: message }, 401);
}

export function forbidden(message = "Forbidden") {
  return json({ ok: false, error: message }, 403);
}

export function conflict(message = "Conflict") {
  return json({ ok: false, error: message }, 409);
}

export function notFound(message = "Not found") {
  return json({ ok: false, error: message }, 404);
}

export function methodNotAllowed() {
  return json({ ok: false, error: "Method not allowed" }, 405, {
    Allow: "GET,POST,OPTIONS"
  });
}

export function serverError(message = "Internal server error") {
  return json({ ok: false, error: message }, 500);
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  const value = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isStrongEnoughPassword(password) {
  return typeof password === "string" && password.length >= 12;
}

export function trimPrompt(prompt) {
  return String(prompt || "").replace(/\s+/g, " ").trim();
}

export function randomCode(prefix = "") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (const n of arr) out += alphabet[n % alphabet.length];
  return prefix ? `${prefix}-${out}` : out;
}

export function cleanSite(site) {
  return String(site || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 80) || "unknown";
}

export function cleanMode(mode) {
  return String(mode || "general")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

export function isUniqueConstraintError(error) {
  const message = String(error?.message || "");
  return (
    message.includes("UNIQUE constraint failed") ||
    message.includes("SQLITE_CONSTRAINT") ||
    message.includes("PRIMARY KEY")
  );
}
