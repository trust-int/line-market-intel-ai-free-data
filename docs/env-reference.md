# Environment Reference

Use `.env.production.example` as the production baseline:

```bash
cp .env.production.example .env
```

## Required

| Variable | Required | Notes |
|---|---:|---|
| `NODE_ENV=production` | yes | Production runtime. |
| `PORT=3000` | yes | HTTP port. |
| `TZ=Asia/Taipei` | yes | Keeps daily reports aligned to Taiwan market time. |
| `DATABASE_URL` | yes | Supabase/PostgreSQL connection string. |
| `NO_PAID_DATA_API=true` | yes | Must stay true. |
| `DISABLE_PAID_MARKET_DATA=true` | yes | Must stay true. |
| `DISABLE_NEWS_SCRAPING=true` | yes | Jin10/WallStreetCN remain manual/LINE only. |
| `OFFICIAL_DATA_MODE=auto` | yes | `auto`, `live`, or `fixture`. |
| `AI_MODE=manual` | yes | `manual` does not call OpenAI. |
| `LINE_CHANNEL_SECRET` | yes | From LINE Developers. |
| `LINE_CHANNEL_ACCESS_TOKEN` | yes | From LINE Developers. |
| `USER_HASH_SECRET` | yes | Long random secret for HMAC user hashing. |
| `GPT_ACTION_BEARER_TOKEN` | yes | Bearer token for Custom GPT Action. |
| `ADMIN_TOKEN` | yes | Bearer token for internal ingest endpoints such as `/internal/ingest/news`; do not expose to GPT Actions. |

## Optional

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_LINE_PUSH=false` | false | Enable only after `LINE_PUSH_TARGET_ID` is known. |
| `LINE_PUSH_TARGET_ID` | empty | groupId/userId target for report push. |
| `LINE_TEST_TARGET_ID` | empty | target for `line:send-test-reply`. |
| `NODE_EXTRA_CA_CERTS` | empty | PEM file for corporate/self-signed CA chains. |
| `MAX_OPENAI_DAILY_COST_USD=1.00` | 1.00 | Used only when `AI_MODE=openai`. |
| `MAX_OPENAI_DAILY_REQUESTS=300` | 300 | Used only when `AI_MODE=openai`. |

## Data Mode

- `OFFICIAL_DATA_MODE=live`: live fetch only. Failures become `data_gaps`; no fixture fallback.
- `OFFICIAL_DATA_MODE=auto`: live first; fixture fallback is allowed but clearly marked and lowers `data_quality_score`.
- `OFFICIAL_DATA_MODE=fixture`: test data only. Reports must not be used for real market judgement.

## Safety Defaults

- `AI_MODE=manual` does not call OpenAI.
- `ENABLE_FUTU=false`; do not enable unless free permission is already confirmed.
- No automatic order placement exists.
- Reports must not output `win_rate` unless backtest `sample_size >= 30`.

## Deployment Checklist Using This Env

After filling `.env`, run:

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

Set LINE webhook to:

```text
https://YOUR_DOMAIN/line/webhook
```

Confirm reports under `outputs/reports`, manual packs under `outputs/manual-packs`, and Custom GPT Action access through `/gpt/reports/today`. Common blockers are missing `DATABASE_URL`, missing LINE secrets, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, and `GPT Action 401`.
