# Architecture

## Goal

Keep the extension dumb and reviewable. Keep all useful prompt logic on the server.

## Extension

The extension uses only:

- `activeTab`
- `scripting`
- `storage`

It does not use persistent content scripts, broad host permissions, or auto-running page logic.

### Flow

1. User focuses a text field in a design tool.
2. User clicks the extension icon.
3. Popup injects a tiny function into the current tab to read the focused field.
4. Popup sends the captured text to the backend.
5. Popup displays the enhanced result.
6. User clicks to insert the result back into the page.

This is intentionally explicit and user-driven.

## Backend

The backend is a Cloudflare Worker with D1.

### Responsibilities

- register and login
- bearer-token session issuance
- access code redemption
- plan gating
- monthly usage enforcement
- prompt enhancement via Anthropic
- mock mode for testing without model cost

### Why Cloudflare Worker + D1

- low fixed cost
- simple deployment
- global edge runtime
- no long-lived VM to manage
- small enough for a disposable MVP

## Data model

### `users`

Holds identity, password record, and plan.

### `sessions`

Stores hashed bearer tokens with expiry.

### `access_codes`

Lets you sell or distribute annual access without having to wire full subscription billing on day one.

### `usage_logs`

Used for monthly cap enforcement and basic analytics.

## Security posture

This is a starter, not a hardened identity system.

What it does:

- stores only salted password hashes
- stores only hashed session tokens
- uses bearer tokens rather than cookies
- keeps prompt logic server-side

What it does not do yet:

- password reset
- email verification
- anti-automation / anti-abuse protections
- fraud detection
- payment dispute handling

## Product constraints

This is suitable for an intentionally short-life, low-cost MVP.
If it starts to work, the next changes should be:

1. stricter CORS allowlist
2. billing integration
3. abuse monitoring
4. support tooling
5. model-cost dashboards
