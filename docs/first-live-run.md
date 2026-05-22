# First Live Run

This is the first production wiring pass after deployment. It does not add strategies, OCR, dashboard, or backtest. It verifies DB, LINE, TLS, official data, report generation, report persistence, and GPT Action readiness.

## Prerequisites

```bash
cp .env.production.example .env
```

Fill:

- `DATABASE_URL`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `USER_HASH_SECRET`
- `GPT_ACTION_BEARER_TOKEN`
- `OFFICIAL_DATA_MODE=auto`
- `AI_MODE=manual`
- `NO_PAID_DATA_API=true`
- `DISABLE_PAID_MARKET_DATA=true`
- `ENABLE_FUTU=false`

## Run

```bash
npm install
npm run build
npm test
npm run first-live-run
```

The script continues even if one step fails. It writes:

```text
outputs/first-live-run/latest.json
outputs/first-live-run/latest.md
```

## Internal Flow

`first-live-run` runs:

1. `prod:check`
2. `db:migrate`
3. `db:check`
4. `tls:diagnose`
5. `live:check`
6. `line:prod-check`
7. `gpt:action:smoke`
8. `e2e:daily today --mode=auto --push=false`
9. `report:save today postmarket`
10. `bringup:live`

## Verify DB

```bash
npm run db:migrate
npm run db:check
```

Expected tables include `market_daily`, `daily_market_snapshots`, `strategy_reports`, `manual_gpt_packs`, `holdings`, and `watchlist`.

## Verify Official Data

```bash
npm run tls:diagnose
npm run live:check
```

If `UNABLE_TO_VERIFY_LEAF_SIGNATURE` appears, fix CA certificates or set `NODE_EXTRA_CA_CERTS`. Do not disable TLS verification.

## Verify LINE

```bash
npm run line:prod-check
npm run line:test-webhook
```

After deployment, configure:

```text
https://YOUR_DOMAIN/line/webhook
```

Then test `/成本`, `/觀察 2330 台積電`, image, PDF, and `/手動包`.

## Verify Reports

Check:

```text
outputs/reports/<date>.md
outputs/reports/<date>.json
outputs/manual-packs/<date>.md
outputs/data-quality/<date>.json
```

If DB is ready:

```bash
npm run report:load -- today postmarket
```

## Verify GPT Action

```bash
npm run gpt:action:export
npm run gpt:action:smoke
```

Custom GPT should call `/gpt/reports/today` and `/gpt/holdings` with Bearer auth.

## Verify Safety

Confirm:

- No paid data API is enabled.
- Futu is disabled.
- No automatic trading exists.
- No `win_rate` appears without qualified backtest sample size.
- `AI_MODE=manual` does not call OpenAI.

## Common Errors

- `DATABASE_URL missing`: configure DB, rerun `db:migrate`.
- `LINE secrets missing`: fill LINE env and redeploy.
- `GPT Action 401`: token mismatch.
- `live:check tls_error`: CA bundle or `NODE_EXTRA_CA_CERTS` issue.
- `OFFICIAL_DATA_MODE=fixture`: testing only, not trading judgement.
