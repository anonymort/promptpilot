import test from "node:test";
import assert from "node:assert/strict";

import worker from "../backend/src/index.js";
import { createTestDb } from "../test-support/d1.js";

function createEnv(overrides = {}) {
  return {
    DB: createTestDb(),
    USE_MOCK: "true",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: "claude-sonnet-4-6",
    ADMIN_BEARER_TOKEN: "admin-token",
    BUYMEACOFFEE_WEBHOOK_SECRET: "bmc-secret",
    BUYMEACOFFEE_PAGE_URL: "https://buymeacoffee.com/promptpilot",
    ALLOWED_ORIGINS: "*",
    ...overrides
  };
}

async function callApi(env, path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const request = new Request(`https://example.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const response = await worker.fetch(request, env);
  const json = await response.json();
  return { response, json };
}

async function registerUser(env, email) {
  const { response, json } = await callApi(env, "/api/auth/register", {
    method: "POST",
    body: {
      email,
      password: "correct horse battery staple"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(json.ok, true);
  return json;
}

async function signWebhookPayload(secret, payload) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function callBuyMeACoffeeWebhook(env, payload) {
  const raw = JSON.stringify(payload);
  const signature = await signWebhookPayload(env.BUYMEACOFFEE_WEBHOOK_SECRET, raw);
  const request = new Request("https://example.test/api/webhooks/buymeacoffee", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-signature-sha256": signature
    },
    body: raw
  });

  const response = await worker.fetch(request, env);
  const json = await response.json();
  return { response, json };
}

async function insertAccessCode(env, code, { plan = "starter", months = 12 } = {}) {
  await env.DB.prepare(`
    INSERT INTO access_codes (code, plan, months, max_redemptions, redeemed_count, expires_at, notes, created_at)
    VALUES (?, ?, ?, 1, 0, NULL, '', ?)
  `).bind(code, plan, months, new Date().toISOString()).run();
}

test("single-use access codes cannot be redeemed twice under competing requests", async () => {
  const env = createEnv();
  const alice = await registerUser(env, "alice@example.com");
  const bob = await registerUser(env, "bob@example.com");
  await insertAccessCode(env, "BETA-ONCEONLY");

  const [aliceRedeem, bobRedeem] = await Promise.all([
    callApi(env, "/api/redeem", {
      method: "POST",
      token: alice.token,
      body: { code: "BETA-ONCEONLY" }
    }),
    callApi(env, "/api/redeem", {
      method: "POST",
      token: bob.token,
      body: { code: "BETA-ONCEONLY" }
    })
  ]);

  const statuses = [aliceRedeem.response.status, bobRedeem.response.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409]);

  const codeRow = await env.DB.prepare(`
    SELECT redeemed_count FROM access_codes WHERE code = ?
  `).bind("BETA-ONCEONLY").first();
  assert.equal(codeRow.redeemed_count, 1);

  const claims = await env.DB.prepare(`
    SELECT code, user_id, granted_at FROM access_code_redemptions WHERE code = ?
  `).bind("BETA-ONCEONLY").run();
  assert.equal(claims.results.length, 1);
  assert.ok(claims.results[0].granted_at);
});

test("free plan is limited to 2 enhancements per day", async () => {
  const env = createEnv();
  const user = await registerUser(env, "quota@example.com");

  const userRow = await env.DB.prepare(`
    SELECT id FROM users WHERE email = ?
  `).bind("quota@example.com").first();

  const periodStart = new Date();
  periodStart.setUTCHours(0, 0, 0, 0);

  for (let slot = 1; slot <= 1; slot += 1) {
    await env.DB.prepare(`
      INSERT INTO usage_reservations (id, user_id, period_start, slot_number, status, created_at, consumed_at)
      VALUES (?, ?, ?, ?, 'consumed', ?, ?)
    `).bind(
      crypto.randomUUID(),
      userRow.id,
      periodStart.toISOString(),
      slot,
      new Date().toISOString(),
      new Date().toISOString()
    ).run();
  }

  const makeEnhance = () => callApi(env, "/api/enhance", {
    method: "POST",
    token: user.token,
    body: {
      site: "stitch",
      mode: "general",
      prompt: "pricing page for a B2B SaaS startup"
    }
  });

  const [first, second] = await Promise.all([makeEnhance(), makeEnhance()]);
  const statuses = [first.response.status, second.response.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 403]);
  assert.equal(second.json.error, "Daily usage limit reached");

  const usage = await callApi(env, "/api/me", { token: user.token });
  assert.equal(usage.json.usage.window, "day");
  assert.equal(usage.json.usage.limit, 2);
  assert.equal(usage.json.usage.used, 2);
  assert.equal(usage.json.usage.remaining, 0);
});

test("failed provider calls return a sanitized server error and release the reserved slot", async () => {
  const env = createEnv({
    USE_MOCK: "false",
    ANTHROPIC_API_KEY: "test-key"
  });
  const user = await registerUser(env, "provider@example.com");

  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  globalThis.fetch = async () => new Response("Sensitive upstream failure details", {
    status: 500,
    headers: {
      "content-type": "text/plain"
    }
  });
  console.error = () => {};

  try {
    const result = await callApi(env, "/api/enhance", {
      method: "POST",
      token: user.token,
      body: {
        site: "stitch",
        mode: "general",
        prompt: "design a sharper homepage"
      }
    });

    assert.equal(result.response.status, 500);
    assert.equal(result.json.error, "Unexpected server error");

    const me = await callApi(env, "/api/me", { token: user.token });
    assert.equal(me.json.usage.used, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test("successful Buy Me a Coffee support unlocks the supporter plan by matching email", async () => {
  const env = createEnv();
  const user = await registerUser(env, "supporter@example.com");

  const webhook = await callBuyMeACoffeeWebhook(env, {
    id: "evt_support_123",
    type: "support.created",
    status: "completed",
    supporter_email: "supporter@example.com",
    amount: "5.00",
    currency: "USD"
  });

  assert.equal(webhook.response.status, 200);
  assert.equal(webhook.json.action, "granted_supporter");

  const me = await callApi(env, "/api/me", { token: user.token });
  assert.equal(me.response.status, 200);
  assert.equal(me.json.user.plan, "supporter");
  assert.equal(me.json.usage.isUnlimited, true);
  assert.equal(me.json.billing.buyMeACoffeeUrl, "https://buymeacoffee.com/promptpilot");
});

test("Buy Me a Coffee succeeded status is treated as a successful donation", async () => {
  const env = createEnv();
  const user = await registerUser(env, "succeeded@example.com");

  const webhook = await callBuyMeACoffeeWebhook(env, {
    id: "evt_support_succeeded",
    type: "donation.created",
    status: "succeeded",
    supporter_email: "succeeded@example.com",
    amount: "5.00",
    currency: "USD"
  });

  assert.equal(webhook.response.status, 200);
  assert.equal(webhook.json.action, "granted_supporter");

  const me = await callApi(env, "/api/me", { token: user.token });
  assert.equal(me.response.status, 200);
  assert.equal(me.json.user.plan, "supporter");
  assert.equal(me.json.usage.isUnlimited, true);
});

test("duplicate Buy Me a Coffee webhooks are accepted without reprocessing", async () => {
  const env = createEnv();
  await registerUser(env, "repeat@example.com");

  const payload = {
    id: "evt_support_456",
    type: "support.created",
    status: "completed",
    supporter_email: "repeat@example.com"
  };

  const first = await callBuyMeACoffeeWebhook(env, payload);
  const second = await callBuyMeACoffeeWebhook(env, payload);

  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.equal(second.json.duplicate, true);

  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM buymeacoffee_events
    WHERE source_event_id = ?
  `).bind("evt_support_456").first();
  assert.equal(row.count, 1);
});
