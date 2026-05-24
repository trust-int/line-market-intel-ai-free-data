# Deploy On Render

Render is a simple first cloud target for this service. Use a Web Service with Node 20+ or Docker. Use Docker when you want LINE image OCR, because the Dockerfile installs tesseract and language packs.

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

LINE image OCR is optional. Render's Node runtime may not include `tesseract`; keep `OCR_ENABLED=false` for Node runtime. For OCR, switch the service runtime to Docker and set `OCR_ENABLED=true`. The project Dockerfile installs `tesseract-ocr`, `tesseract-ocr-eng`, and `tesseract-ocr-chi-tra`. With `OCR_ENABLED=false`, image records are still stored with `ocr_not_available` gaps and GPT will not guess image content.

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

## Render Docker Setup For OCR

If you want image OCR:

1. In Render service settings, change Runtime / Language to Docker, or create a new Web Service using Docker.
2. Dockerfile path:

```text
./Dockerfile
```

3. Build command and Start command are not needed for Docker runtime; Render uses the Dockerfile.
4. Add or update env:

```env
OCR_ENABLED=true
OCR_PROVIDER=tesseract
OCR_LANG=chi_tra
OCR_MAX_IMAGE_BYTES=1048576
OCR_MAX_IMAGE_PIXELS=2500000
OCR_TIMEOUT_MS=15000
```

Render Free memory is tight for tesseract, especially with `chi_tra+eng`. Use `chi_tra` and the size/pixel limits above for the first OCR rollout. If you need better English OCR or large screenshots, upgrade the instance before raising these limits.

5. Redeploy, then send a screenshot containing text to LINE.
6. Confirm `/gpt/news/today/summary` returns `source=line_image_ocr` and a non-null `summary`.

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
