# Deployment

## Backend

From `backend/`:

```bash
npm install
npx wrangler login
npx wrangler d1 create promptpilot-db
```

Update `wrangler.toml` with the real D1 IDs.

Create local secrets:

```bash
cp .dev.vars.example .dev.vars
```

Run migrations:

```bash
npx wrangler d1 migrations apply promptpilot-db --local
npx wrangler d1 migrations apply promptpilot-db
```

Start local dev:

```bash
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Open the popup
6. Set the API base URL to your Worker URL
7. Register a user
8. Focus a prompt field on a page
9. Use **Read focused field**, **Enhance**, and **Insert into page**

## Optional hardening

- move from `ALLOWED_ORIGINS=*` to an explicit allowlist
- add turnstile or another anti-bot layer to registration
- replace access codes with paid checkout or tighten the Buy Me a Coffee webhook flow
- rotate admin tokens regularly
- add Worker Analytics Engine or another metrics sink
