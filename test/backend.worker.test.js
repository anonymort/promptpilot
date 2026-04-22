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

test("quota reservation blocks an extra concurrent enhance request at the monthly limit", async () => {
  const env = createEnv();
  const user = await registerUser(env, "quota@example.com");

  const userRow = await env.DB.prepare(`
    SELECT id FROM users WHERE email = ?
  `).bind("quota@example.com").first();

  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);

  for (let slot = 1; slot <= 9; slot += 1) {
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

  const usage = await callApi(env, "/api/me", { token: user.token });
  assert.equal(usage.json.usage.usedThisMonth, 10);
  assert.equal(usage.json.usage.remainingThisMonth, 0);
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
    assert.equal(me.json.usage.usedThisMonth, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});
