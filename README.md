# PromptPilot Starter

A reviewable, low-cost starter kit for a **prompt enhancement** browser extension and backend.

This package deliberately avoids covert or deceptive behaviour. The extension never auto-submits, never silently rewrites text, and never runs on every site by default. The user must explicitly click to read the focused field, enhance it, review the result, and insert it back into the page.

## What is included

- `backend/` — Cloudflare Worker + D1 backend
- `extension/` — Chrome Manifest V3 extension using `activeTab`, `scripting`, and `storage`
- `docs/` — architecture, deployment, and privacy guidance

## Product shape

The extension is a **user-invoked assistant**:

1. User focuses a prompt field on a supported site.
2. User opens the extension popup and clicks **Read focused field**.
3. The popup reads the currently focused editable field from the active tab.
4. The popup sends the text to the backend.
5. The backend rewrites the prompt using a hidden server-side prompt library.
6. The user reviews the rewritten prompt in the popup.
7. The user clicks **Insert into page**.

There is no hidden interception, no auto-submit, and no invisible background rewriting.

## Quick start

### 1) Backend prerequisites

- Node.js 20+
- A Cloudflare account
- Wrangler CLI access via `npx wrangler`
- An Anthropic API key for production mode

### 2) Create the D1 database

From `backend/`:

```bash
npm install
npx wrangler login
npx wrangler d1 create promptpilot-db
```

Cloudflare will print a `database_id`. Paste that into `backend/wrangler.toml` for both `database_id` and, if you want local dev, set a `preview_database_id` string.

Example:

```toml
[[d1_databases]]
binding = "DB"
database_name = "promptpilot-db"
database_id = "PASTE_REAL_UUID_HERE"
preview_database_id = "promptpilot-db-preview"
```

### 3) Configure local secrets

Copy the example file:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars`:

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=claude-sonnet-4-6
USE_MOCK=false
ADMIN_BEARER_TOKEN=choose-a-long-random-admin-token
ALLOWED_ORIGINS=*
```

Notes:

- Set `USE_MOCK=true` if you want to run the full flow without calling Anthropic.
- `ALLOWED_ORIGINS=*` is acceptable here because the API uses bearer tokens rather than cookies. Tighten this later if you move to a fixed extension ID.

### 4) Apply migrations

Run locally first:

```bash
npx wrangler d1 migrations apply promptpilot-db --local
```

Then apply to the remote database:

```bash
npx wrangler d1 migrations apply promptpilot-db
```

### 5) Start local development

```bash
npm run dev
```

The Worker will start locally, usually on:

```text
http://127.0.0.1:8787
```

### 6) Load the extension

- Open `chrome://extensions`
- Enable **Developer mode**
- Click **Load unpacked**
- Select the `extension/` folder

### 7) Point the extension at your backend

- Click the extension icon
- Set **API base URL** to your backend URL, for example:
  - Local: `http://127.0.0.1:8787`
  - Production: `https://promptpilot-api.your-subdomain.workers.dev`

### 8) Create a user

From the extension popup:

- Register with email and password
- Or register, then redeem an access code after login

You can also create paid beta access codes with the admin endpoint. See below.

## Deployment

### Deploy the backend

From `backend/`:

```bash
npm run deploy
```

You will get a production Worker URL such as:

```text
https://promptpilot-api.<your-subdomain>.workers.dev
```

Update the extension popup API base URL to that address.

## Access codes instead of Stripe

This starter intentionally uses **manual access codes** rather than billing infrastructure. For a low-ticket, short-life product, this keeps costs and compliance surface area down.

You can sell:
- annual access manually,
- invite codes to early users,
- redemption codes delivered by Gumroad, Lemon Squeezy, or your own checkout later.

### Create an access code

Call the admin endpoint with your `ADMIN_BEARER_TOKEN`:

```bash
curl -X POST http://127.0.0.1:8787/api/admin/codes   -H "Content-Type: application/json"   -H "Authorization: Bearer YOUR_ADMIN_BEARER_TOKEN"   -d '{
    "plan": "starter",
    "months": 12,
    "count": 5,
    "prefix": "BETA"
  }'
```

Response example:

```json
{
  "ok": true,
  "codes": [
    "BETA-7F7Q7D6A",
    "BETA-8P4J1C2M"
  ]
}
```

Users can redeem a code in the extension popup after logging in.

## Default plans and limits

The Worker enforces monthly usage caps:

- `free` — 10 enhancements / month
- `starter` — 120 enhancements / month
- `pro` — 400 enhancements / month

Edit `backend/src/lib/plans.js` to change this.

## Supported enhancement modes

The backend currently supports:

- `general`
- `landing-page`
- `dashboard`
- `mobile-ui`
- `form-flow`

These are only server-side. They are not shipped inside the extension.

## Local API smoke test

Register:

```bash
curl -X POST http://127.0.0.1:8787/api/auth/register   -H "Content-Type: application/json"   -d '{"email":"test@example.com","password":"correct horse battery staple"}'
```

Login:

```bash
curl -X POST http://127.0.0.1:8787/api/auth/login   -H "Content-Type: application/json"   -d '{"email":"test@example.com","password":"correct horse battery staple"}'
```

Enhance:

```bash
curl -X POST http://127.0.0.1:8787/api/enhance   -H "Content-Type: application/json"   -H "Authorization: Bearer YOUR_SESSION_TOKEN"   -d '{
    "site": "stitch",
    "mode": "landing-page",
    "prompt": "pricing page for a B2B SaaS startup"
  }'
```

## File map

```text
promptpilot-starter/
├── README.md
├── backend/
│   ├── package.json
│   ├── wrangler.toml
│   ├── .dev.vars.example
│   ├── migrations/
│   │   └── 0001_init.sql
│   └── src/
│       ├── index.js
│       └── lib/
│           ├── anthropic.js
│           ├── auth.js
│           ├── cors.js
│           ├── plans.js
│           ├── prompts.js
│           └── utils.js
├── extension/
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.css
│   ├── popup.js
│   └── icons/
└── docs/
    ├── architecture.md
    ├── deployment.md
    └── privacy-policy-template.md
```

## Production notes

This is a deliberate MVP. Before real volume, you should add:

- email verification
- password reset
- bot protection on registration
- payment provider integration
- abuse detection
- stricter origin allowlists
- structured analytics
- legal pages and support workflow

## What this starter does not do

- It does not pretend to be an official integration.
- It does not bypass site controls.
- It does not auto-submit prompts.
- It does not use hidden background automation.
- It does not fingerprint devices.

That is intentional.
