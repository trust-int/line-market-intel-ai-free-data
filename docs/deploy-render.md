# Deploy On Render

Render is a simple first cloud target for this service. Use a Web Service with Node 20+.

## Required Environment Variables

Copy every key from `.env.production.example` into Render Environment settings. Required values:

- `DATABASE_URL`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `USER_HASH_SECRET`
- `GPT_ACTION_BEARER_TOKEN`
- `NO_PAID_DATA_API=true`
- `DISABLE_PAID_MARKET_DATA=true`
- `DISABLE_NEWS_SCRAPING=true`
- `OFFICIAL_DATA_MODE=auto`
- `AI_MODE=manual`
- `ENABLE_FUTU=false`

If a corporate CA is required, set `NODE_EXTRA_CA_CERTS` and mount/provide the PEM file.

## Render Setup

1. Create a Web Service from the repository.
2. Build command:

```bash
npm install && npm run build
```

3. Start command:

```bash
npm start
```

4. Set health check path:

```text
/health/live
```

5. Add environment variables.

## Bring-up Commands

From a Render shell or one-off job:

```bash
npm run prod:check
npm run db:migrate
npm run db:check
npm run tls:diagnose
npm run live:check
npm run line:prod-check
npm run gpt:action:smoke
npm run bringup:live
npm run first-live-run
```

## LINE Webhook

Use:

```text
https://YOUR_RENDER_SERVICE.onrender.com/line/webhook
```

Then send:

- `/成本`
- `/觀察 2330 台積電`
- one image
- one PDF
- `/手動包`

Check DB `line_messages` and private storage metadata.

## Report Verification

Check:

```text
outputs/reports/<date>.md
outputs/manual-packs/<date>.md
outputs/first-live-run/latest.md
```

Also confirm Custom GPT can call `/gpt/reports/today` with Bearer auth.

## Safety Verification

`prod:check` must show paid market data disabled and Futu disabled. `AI_MODE=manual` will not call OpenAI. The system does not place orders and must not output `win_rate` without qualified backtests.

## Common Errors

- `DATABASE_URL missing`: add Supabase/PostgreSQL URL in Render env.
- `LINE webhook 401`: LINE signature secret mismatch.
- `tls_error`: confirm Render image has CA certificates; use `NODE_EXTRA_CA_CERTS` for custom CA.
- `GPT Action 401`: update Custom GPT Bearer token.
- `push target missing`: keep `ENABLE_LINE_PUSH=false` until `LINE_PUSH_TARGET_ID` is known.
