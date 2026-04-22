import { enhancePrompt } from "./lib/anthropic.js";
import {
  authenticateRequest,
  createPasswordRecord,
  createSession,
  deleteSession,
  sha256,
  verifyPassword
} from "./lib/auth.js";
import {
  beginWebhookEvent,
  classifyWebhookAction,
  extractWebhookSummary,
  findUserByEmail,
  finishWebhookEvent,
  grantDonationUnlock,
  revokeDonationUnlock,
  verifyWebhookSignature
} from "./lib/buymeacoffee.js";
import { redeemAccessCode } from "./lib/codes.js";
import { getCorsHeaders, handleCors } from "./lib/cors.js";
import { buildUsageSummary, getPlanQuota } from "./lib/plans.js";
import {
  consumeUsageReservation,
  getUsageCount,
  releaseUsageReservation,
  reserveUsageSlot
} from "./lib/usage.js";
import {
  badRequest,
  cleanMode,
  cleanSite,
  forbidden,
  isStrongEnoughPassword,
  isUniqueConstraintError,
  isValidEmail,
  json,
  methodNotAllowed,
  normalizeEmail,
  nowIso,
  notFound,
  randomCode,
  readJson,
  serverError,
  trimPrompt,
  unauthorized
} from "./lib/utils.js";

function usageLimitMessage(quota) {
  if (quota.window === "day") return "Daily usage limit reached";
  if (quota.window === "month") return "Monthly usage limit reached";
  return "Usage limit reached";
}

function usagePayloadFor(plan, used) {
  const usage = buildUsageSummary(plan, used);
  return {
    ...usage,
    usedThisMonth: usage.window === "month" ? usage.used : null,
    remainingThisMonth: usage.window === "month" ? usage.remaining : null,
    monthlyLimit: usage.window === "month" ? usage.limit : null
  };
}

async function getUserByEmail(env, email) {
  return await env.DB.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`).bind(email).first();
}

async function recordUsage(env, { userId, site, mode, inputChars, outputChars }) {
  await env.DB.prepare(`
    INSERT INTO usage_logs (id, user_id, site, mode, input_chars, output_chars, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    site,
    mode,
    inputChars,
    outputChars,
    nowIso()
  ).run();
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  const cors = getCorsHeaders(request, env);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

async function requireAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token && token === env.ADMIN_BEARER_TOKEN;
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/healthz" && request.method === "GET") {
    return json({ ok: true, service: "promptpilot-api", time: nowIso() });
  }

  if (path === "/api/auth/register") {
    if (request.method !== "POST") return methodNotAllowed();

    const body = await readJson(request);
    if (!body) return badRequest("Invalid JSON body");

    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    if (!isValidEmail(email)) return badRequest("Valid email required");
    if (!isStrongEnoughPassword(password)) {
      return badRequest("Password must be at least 12 characters long");
    }

    const existing = await getUserByEmail(env, email);
    if (existing) return badRequest("An account with that email already exists");

    const { salt, hash } = await createPasswordRecord(password);
    const now = nowIso();
    const userId = crypto.randomUUID();

    await env.DB.prepare(`
      INSERT INTO users (id, email, password_hash, password_salt, plan, plan_expires_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'free', NULL, 'active', ?, ?)
    `).bind(userId, email, hash, salt, now, now).run();

    const session = await createSession(env, userId);

    return json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: userId,
        email,
        plan: "free",
        planExpiresAt: null
      }
    });
  }

  if (path === "/api/auth/login") {
    if (request.method !== "POST") return methodNotAllowed();

    const body = await readJson(request);
    if (!body) return badRequest("Invalid JSON body");

    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const user = await getUserByEmail(env, email);

    if (!user) return unauthorized("Invalid email or password");

    const ok = await verifyPassword(password, user.password_salt, user.password_hash);
    if (!ok) return unauthorized("Invalid email or password");
    if (user.status !== "active") return forbidden("Account is not active");

    const session = await createSession(env, user.id);

    return json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        plan: user.donation_unlocked_at ? "supporter" : user.plan,
        planExpiresAt: user.plan_expires_at
      }
    });
  }

  if (path === "/api/auth/logout") {
    if (request.method !== "POST") return methodNotAllowed();
    const user = await authenticateRequest(env, request);
    if (!user) return unauthorized();
    const auth = request.headers.get("Authorization") || "";
    const token = auth.slice(7).trim();
    await deleteSession(env, token);
    return json({ ok: true });
  }

  if (path === "/api/me") {
    if (request.method !== "GET") return methodNotAllowed();
    const user = await authenticateRequest(env, request);
    if (!user) return unauthorized();

    const quota = getPlanQuota(user.plan);
    const usageCount = quota.limit === null ? 0 : await getUsageCount(env, user.id, quota.window);

    return json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        plan: user.plan,
        planExpiresAt: user.planExpiresAt,
        status: user.status
      },
      usage: usagePayloadFor(user.plan, usageCount),
      billing: {
        buyMeACoffeeUrl: env.BUYMEACOFFEE_PAGE_URL || ""
      }
    });
  }

  if (path === "/api/redeem") {
    if (request.method !== "POST") return methodNotAllowed();

    const user = await authenticateRequest(env, request);
    if (!user) return unauthorized();

    const body = await readJson(request);
    if (!body) return badRequest("Invalid JSON body");

    const code = String(body.code || "").trim().toUpperCase();
    if (!code) return badRequest("Code is required");
    const result = await redeemAccessCode(env, user, code);
    if (result instanceof Response) return result;
    return json(result);
  }

  if (path === "/api/webhooks/buymeacoffee") {
    if (request.method !== "POST") return methodNotAllowed();
    if (!env.BUYMEACOFFEE_WEBHOOK_SECRET) {
      return forbidden("Buy Me a Coffee webhook is not configured");
    }

    const rawBody = await request.text();
    const signature = request.headers.get("x-signature-sha256") || "";
    const isValid = await verifyWebhookSignature(env.BUYMEACOFFEE_WEBHOOK_SECRET, rawBody, signature);
    if (!isValid) {
      return unauthorized("Invalid Buy Me a Coffee signature");
    }

    let payload;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return badRequest("Invalid webhook payload");
    }

    const summary = extractWebhookSummary(payload);
    const eventKey = summary.eventId || await sha256(rawBody);

    try {
      await beginWebhookEvent(env, eventKey, summary, rawBody);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return json({ ok: true, duplicate: true });
      }
      throw error;
    }

    const action = classifyWebhookAction(summary);
    const matchedUser = await findUserByEmail(env, summary.email);
    let finalAction = "ignored";

    if (!matchedUser) {
      finalAction = summary.email ? "ignored_no_matching_user" : "ignored_no_email";
    } else if (action === "grant") {
      await grantDonationUnlock(env, matchedUser.id, eventKey);
      finalAction = "granted_supporter";
    } else if (action === "revoke") {
      await revokeDonationUnlock(env, matchedUser.id);
      finalAction = "revoked_supporter";
    }

    await finishWebhookEvent(env, eventKey, {
      matchedUserId: matchedUser?.id || null,
      action: finalAction
    });

    return json({
      ok: true,
      action: finalAction
    });
  }

  if (path === "/api/enhance") {
    if (request.method !== "POST") return methodNotAllowed();

    const user = await authenticateRequest(env, request);
    if (!user) return unauthorized();
    if (user.status !== "active") return forbidden("Account is not active");

    const body = await readJson(request);
    if (!body) return badRequest("Invalid JSON body");

    const prompt = trimPrompt(body.prompt);
    const site = cleanSite(body.site);
    const mode = cleanMode(body.mode || "general");

    if (!prompt || prompt.length < 5) return badRequest("Prompt is too short");
    if (prompt.length > 6000) return badRequest("Prompt is too long");
    if (!["general", "landing-page", "dashboard", "mobile-ui", "form-flow"].includes(mode)) {
      return badRequest("Mode is invalid");
    }

    const quota = getPlanQuota(user.plan);
    const usageCount = quota.limit === null ? 0 : await getUsageCount(env, user.id, quota.window);

    const reservation = quota.limit === null ? null : await reserveUsageSlot(env, user.id, quota);
    if (quota.limit !== null && !reservation) {
      return forbidden(usageLimitMessage(quota));
    }

    let enhancedPrompt = "";

    try {
      enhancedPrompt = await enhancePrompt(env, { prompt, site, mode });

      await recordUsage(env, {
        userId: user.id,
        site,
        mode,
        inputChars: prompt.length,
        outputChars: enhancedPrompt.length
      });

      if (reservation) {
        await consumeUsageReservation(env, reservation.id);
      }
    } catch (error) {
      if (reservation) {
        await releaseUsageReservation(env, reservation.id);
      }
      throw error;
    }

    return json({
      ok: true,
      enhancedPrompt,
      usage: usagePayloadFor(user.plan, quota.limit === null ? 0 : usageCount + 1)
    });
  }

  if (path === "/api/admin/codes") {
    if (request.method !== "POST") return methodNotAllowed();
    if (!(await requireAdmin(request, env))) return unauthorized("Admin token required");

    const body = await readJson(request);
    if (!body) return badRequest("Invalid JSON body");

    const plan = normalizePlan(body.plan);
    const months = Math.max(1, Math.min(36, Number(body.months || 12)));
    const count = Math.max(1, Math.min(100, Number(body.count || 1)));
    const prefix = String(body.prefix || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const notes = String(body.notes || "").trim().slice(0, 500);

    const createdAt = nowIso();
    const codes = [];

    const statements = [];
    for (let i = 0; i < count; i += 1) {
      const code = randomCode(prefix);
      codes.push(code);
      statements.push(
        env.DB.prepare(`
          INSERT INTO access_codes (code, plan, months, max_redemptions, redeemed_count, expires_at, notes, created_at)
          VALUES (?, ?, ?, 1, 0, NULL, ?, ?)
        `).bind(code, plan, months, notes, createdAt)
      );
    }

    await env.DB.batch(statements);

    return json({
      ok: true,
      codes,
      plan,
      months
    });
  }

  return notFound();
}

export default {
  async fetch(request, env) {
    const preflight = handleCors(request, env);
    if (preflight) return preflight;

    try {
      const response = await route(request, env);
      return withCors(response, request, env);
    } catch (error) {
      console.error(error);
      const response = serverError("Unexpected server error");
      return withCors(response, request, env);
    }
  }
};
