# Deploy On Railway

Railway works well for quick Node + PostgreSQL deployments.

## Required Environment Variables

Set all variables from `.env.production.example` in Railway Variables:

```env
DATABASE_URL=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
USER_HASH_SECRET=
GPT_ACTION_BEARER_TOKEN=
NO_PAID_DATA_API=true
DISABLE_PAID_MARKET_DATA=true
DISABLE_NEWS_SCRAPING=true
OFFICIAL_DATA_MODE=auto
AI_MODE=manual
ENABLE_FUTU=false
ENABLE_LINE_PUSH=false
```

No real secret should be committed to the repository.

## Railway Setup

1. Create a new Railway project.
2. Add a PostgreSQL service or connect Supabase.
3. Add this repository as a service.
4. Build command:

```bash
npm install && npm run build
```

5. Start command:

```bash
npm start
```

6. Confirm public domain is enabled.

## Production Checks

Run:

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

Set LINE webhook URL:

```text
https://YOUR_RAILWAY_DOMAIN/line/webhook
```

Test with `/成本`, `/觀察 2330 台積電`, one image, one PDF, then `/手動包`.

## Report And GPT Action

Reports should appear under:

```text
outputs/reports/<date>.md
outputs/manual-packs/<date>.md
```

Export Action files:

```bash
npm run gpt:action:export
```

Use `outputs/gpt-action/openapi.yaml` and Bearer auth with `GPT_ACTION_BEARER_TOKEN`.

## Confirm No Paid Data API

`prod:check` should show:

- `NO_PAID_DATA_API=true`
- `DISABLE_PAID_MARKET_DATA=true`
- `DISABLE_NEWS_SCRAPING=true`
- `ENABLE_FUTU=false`

## Troubleshooting

- `db:check missing tables`: run `db:migrate`.
- `UNABLE_TO_VERIFY_LEAF_SIGNATURE`: update CA bundle or set `NODE_EXTRA_CA_CERTS`.
- `LINE secrets missing`: fill Railway variables and redeploy.
- `health/ready not_ready`: check `/health` blockers.
- `OFFICIAL_DATA_MODE=fixture`: only for testing, not real market judgement.
