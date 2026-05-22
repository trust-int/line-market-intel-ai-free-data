# Deploy On VPS With Docker

Use this path when you want full control over the host, network, certificates, and storage.

## Required Environment Variables

Create `.env` from `.env.production.example`:

```bash
cp .env.production.example .env
```

Fill:

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

## Host Preparation

Install Docker and ensure CA certificates are current:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates
```

For Alpine-based hosts:

```bash
apk add --no-cache ca-certificates
```

For corporate/self-signed CA, store the PEM on the host and set:

```env
NODE_EXTRA_CA_CERTS=/app/certs/company-root-ca.pem
```

Do not use `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Build And Run

```bash
docker build -t line-market-intel-ai-free-data .
docker run --env-file .env -p 3000:3000 line-market-intel-ai-free-data
```

If using private storage on disk, mount a volume:

```bash
docker run --env-file .env -p 3000:3000 -v /srv/stock-data:/app/data line-market-intel-ai-free-data
```

## Bring-up

Run inside the container or with the same env:

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

Expose the service through HTTPS, then set:

```text
https://YOUR_DOMAIN/line/webhook
```

Verify `/health/live` returns 200 before enabling the LINE webhook.

## Confirm Output

Check:

```text
outputs/first-live-run/latest.md
outputs/reports/<date>.md
outputs/manual-packs/<date>.md
```

With DB ready, `report:save` should persist to `strategy_reports` and `manual_gpt_packs`.

## GPT Action

```bash
npm run gpt:action:export
npm run gpt:action:smoke
```

Use the public HTTPS URL and Bearer token in Custom GPT.

## Safety Checks

`prod:check` must keep paid data disabled, Futu disabled, and no automatic trading enabled. Reports may show `confidence_score`, but not `win_rate` unless a qualified backtest exists.

## Troubleshooting

- `UNABLE_TO_VERIFY_LEAF_SIGNATURE`: update host/container CA bundle or set `NODE_EXTRA_CA_CERTS`.
- `health/ready 503`: inspect `/health` for blockers.
- `LINE webhook invalid signature`: check `LINE_CHANNEL_SECRET`.
- `private storage not writable`: fix mounted volume permissions.
- `push target missing`: leave `ENABLE_LINE_PUSH=false` until target is known.
