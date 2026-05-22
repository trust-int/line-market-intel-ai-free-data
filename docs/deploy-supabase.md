# Deploy With Supabase

Supabase is the recommended first database because the project already ships a PostgreSQL-compatible schema.

## Required Environment

Create `.env` from `.env.production.example` and fill:

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
```

Do not put real secrets in git.

## Steps

1. Create a Supabase project.
2. Copy the pooled PostgreSQL connection string into `DATABASE_URL`.
3. Install dependencies and verify build:

```bash
npm install
npm run build
npm test
```

4. Run production checks:

```bash
npm run prod:check
npm run db:migrate
npm run db:check
```

5. Validate official data and TLS:

```bash
npm run tls:diagnose
npm run live:check
```

6. Validate LINE and GPT Action:

```bash
npm run line:prod-check
npm run gpt:action:smoke
```

7. Run the full first live run:

```bash
npm run bringup:live
npm run first-live-run
```

## LINE Webhook

Set the LINE webhook URL to:

```text
https://YOUR_DOMAIN/line/webhook
```

Then:

1. Enable Use webhook.
2. Add the bot to the test group.
3. Send `/成本`.
4. Send `/觀察 2330 台積電`.
5. Send one image and one PDF.
6. Confirm `line_messages` and private storage metadata were written.

## Confirm Reports

After `first-live-run`, check:

```text
outputs/reports/<date>.md
outputs/manual-packs/<date>.md
outputs/first-live-run/latest.md
```

If DB is ready, `strategy_reports` and `manual_gpt_packs` should also have rows.

## GPT Action

Export setup files:

```bash
npm run gpt:action:export
```

Use `outputs/gpt-action/openapi.yaml` in the Custom GPT Action, set Bearer token to `GPT_ACTION_BEARER_TOKEN`, then test:

- `/gpt/reports/today`
- `/gpt/holdings`

## Paid Data Confirmation

Run:

```bash
npm run prod:check
```

Confirm:

- `NO_PAID_DATA_API=true`
- `DISABLE_PAID_MARKET_DATA=true`
- `DISABLE_NEWS_SCRAPING=true`
- `ENABLE_FUTU=false`

## Troubleshooting

- `DATABASE_URL missing`: fill Supabase connection string, then run `db:migrate`.
- `missing tables`: run `npm run db:migrate`, then `npm run db:check`.
- `UNABLE_TO_VERIFY_LEAF_SIGNATURE`: install/update CA certificates or set `NODE_EXTRA_CA_CERTS`; never use `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- `LINE missing_secrets`: fill LINE channel secret/access token and `USER_HASH_SECRET`.
- `GPT Action 401`: check Bearer token matches `GPT_ACTION_BEARER_TOKEN`.
