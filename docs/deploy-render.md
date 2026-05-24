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

LINE image OCR is optional. Render's Node runtime may not include `tesseract`; keep `OCR_ENABLED=false` unless you have confirmed the binary and language packs are installed. With `OCR_ENABLED=false`, image records are still stored with `ocr_not_available` gaps and GPT will not guess image content.

LINE file text ingestion is enabled by default through `FILE_INGEST_ENABLED=true`. The MVP supports selectable-text PDFs and UTF-8 `txt`/`md`/`csv`/`json` files. `docx` and `xlsx` are safely marked `file_type_not_supported` in this first version unless parser dependencies are added later.

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

If OCR is enabled and tesseract is available, the image should also appear in `/gpt/news/today/summary` with `source=line_image_ocr`. If OCR is disabled or fails, it should appear as `source=line_image_manual` with `image_only`/`text_missing` data gaps.

For files, a readable PDF or text file should appear in `/gpt/news/today/summary` with `source=line_file_text`. Unsupported or unreadable files should still appear as `source=line_file_manual` with `file_only`/`text_missing` data gaps.

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
- `OCR provider missing`: install tesseract in the runtime or set `OCR_ENABLED=false`.
- `file_type_not_supported`: send selectable-text PDF, TXT, MD, CSV, or JSON, or add a parser for that Office format later.
