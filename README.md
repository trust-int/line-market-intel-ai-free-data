# line-market-intel-ai-free-data

個人自用的 LINE 市場情報與台股策略系統。核心原則很清楚：台股資料優先使用 TWSE、TPEx、MOPS 等免費官方公開來源；金十數據、華爾街見聞、富途新聞只接受 LINE 轉入、手動貼上或使用者上傳；Futu 行情 skeleton 預設關閉；不做自動下單。

## 現在進度與部署順序

目前狀態是 **Beta Live Running Candidate**。核心功能、production bring-up 檢查、E2E dry run、GPT Action、LINE push 骨架、DB bootstrap、TLS 診斷與 report persistence 都已完成；下一步是接真實 DB、LINE、TLS 憑證與部署環境。

第一次部署順序：

```bash
cp .env.production.example .env
# 填 DATABASE_URL / LINE secrets / GPT token

npm install
npm run build
npm test

npm run prod:check
npm run db:migrate
npm run db:check
npm run tls:diagnose
npm run live:check
npm run line:prod-check
npm run gpt:action:smoke
npm run first-live-run
```

重點限制：

- `AI_MODE=manual` 時不會呼叫 OpenAI。
- `AI_MODE=openai` 才會自動分析，且會受 cost guard 控制。
- `OFFICIAL_DATA_MODE=auto` 會 fallback，但會降低 `data_quality_score` 並標示 `source_status/data_gaps`。
- `OFFICIAL_DATA_MODE=fixture` 只能測試，不能用於交易判斷。
- 不使用付費資料 API。
- Futu disabled。
- 不自動下單。
- 沒有 backtest 且 sample size 未達 30，不輸出 `win_rate`。

部署文件：

- [Supabase](/C:/STOCK/docs/deploy-supabase.md)
- [Render](/C:/STOCK/docs/deploy-render.md)
- [Railway](/C:/STOCK/docs/deploy-railway.md)
- [VPS Docker](/C:/STOCK/docs/deploy-vps-docker.md)
- [First Live Run](/C:/STOCK/docs/first-live-run.md)
- [Environment Reference](/C:/STOCK/docs/env-reference.md)
- [Release Checklist](/C:/STOCK/docs/release-checklist.md)

## 功能

- LINE webhook 收文字、圖片、PDF、檔案與 unsend event
- LINE userId 以 HMAC-SHA256 hash 儲存
- 附件寫入 private local storage，可替換 Supabase Storage / S3
- provider policy 與 cost guard 預設阻擋付費資料 API
- `AI_MODE=manual`：完全不呼叫 OpenAI，只產出 `manual_gpt_pack`
- `AI_MODE=openai`：使用 OpenAI Responses API 前檢查每日請求數與成本上限
- TWSE / TPEx / MOPS public provider skeleton
- TWSE / TPEx 官方日行情、指數、市場廣度、三大法人、融資融券 mapping
- MOPS 重大訊息 provider mapping
- `daily_market_snapshots` 每日市場總表
- signal engine 先輸出規則訊號，再交給 manual pack / GPT 寫成人話
- Jin10 / WallStreetCN / Futu news manual providers
- Futu Market provider skeleton，預設 disabled，不購買行情卡，不提示購買
- 市場多空、可能走勢、大戶策略、族群、持股、當沖與風險分析骨架
- 盤前、盤中、盤後、週報排程
- Custom GPT Action API 與 OpenAPI schema
- Vitest 測試骨架

## 架構

```text
LINE 群組 / 手動資料 / 使用者上傳
  -> LINE Webhook + Manual Providers
  -> Private Storage + PostgreSQL/Supabase
  -> AI Extractor or Manual GPT Pack
  -> Normalizers
  -> Analysis Engine
  -> Reports + LINE Push + GPT Action API

TWSE / TPEx / MOPS official public sources
  -> Free Market Data Providers
  -> Market Data Normalizer
  -> Analysis Engine

Futu OpenD
  -> disabled by default
  -> quote-only skeleton if user already has free permission
```

## 為什麼不使用付費資料 API

本專案預設 `NO_PAID_DATA_API=true`、`DISABLE_PAID_MARKET_DATA=true`、`DISABLE_NEWS_SCRAPING=true`。任何 provider 只要標示 `paid=true`，或需要登入/權限但尚未由使用者確認，就會被 `provider-policy.ts` 關閉。

金十數據與華爾街見聞不自動爬付費、VIP、會員內容；只整理使用者自己合法收到並轉入 LINE 或手動上傳的摘要與證據索引。富途只保留行情 skeleton，沒有交易功能，也不會提示購買行情卡。

## AI 模式

`AI_MODE=manual`

- 不呼叫 OpenAI API
- 只收資料、整理 CSV/Markdown、產出 `manual_gpt_pack`
- LINE push 只通知資料包完成，不推送 AI 策略結論

`AI_MODE=openai`

- 每次呼叫前先檢查 `MAX_OPENAI_DAILY_COST_USD` 與 `MAX_OPENAI_DAILY_REQUESTS`
- 超過上限會停止 AI 分析並改產出 `manual_gpt_pack`
- 成本估算寫入本地 ledger

## LINE Bot 設定

1. 在 LINE Developers 建立 Messaging API channel。
2. 設定 webhook URL：`https://你的網域/line/webhook`
3. 設定 `.env`：

```env
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
USER_HASH_SECRET=請換成長隨機字串
```

Webhook 會驗證 `X-Line-Signature`。圖片與檔案會立刻下載到 private storage，資料庫只保存 metadata 與 private path。

MVP 指令：

- `/盤前`
- `/盤中`
- `/盤後`
- `/週報`
- `/持股`
- `/觀察 2454`
- `/刪除觀察 2454`
- `/手動包`
- `/今日新聞`
- `/成本`

## Supabase / PostgreSQL

執行 [supabase/schema.sql](/C:/STOCK/supabase/schema.sql) 建立資料表。主要表包含：

- `data_sources`
- `line_messages`
- `news_events`
- `market_daily`
- `market_intraday`
- `daily_market_snapshots`
- `institutional_flows`
- `margin_short`
- `broker_branch_flows`
- `watchlist`
- `holdings`
- `strategy_reports`
- `trade_candidates`
- `manual_gpt_packs`
- `market_reports`
- `sector_strength`
- `ticker_candidates`
- `news_items`
- `data_source_status`
- `backtest_results`

設定：

```env
DATABASE_URL=postgresql://...
ADMIN_TOKEN=內部 ingest 用長隨機字串
GPT_ACTION_BEARER_TOKEN=Custom GPT Action Bearer token
```

執行 migration：

```bash
npm run db:migrate
```

若只想手動套這次 MVP migration，可在 PostgreSQL/Supabase SQL editor 執行 [supabase/migrations/004_market_intel_mvp.sql](/C:/STOCK/supabase/migrations/004_market_intel_mvp.sql)。

## 資料來源啟用方式

預設啟用：

- `ENABLE_TWSE_PUBLIC=true`
- `ENABLE_TPEX_PUBLIC=true`
- `ENABLE_MOPS_PUBLIC=true`
- `ENABLE_JIN10_MANUAL=true`
- `ENABLE_WALLSTREETCN_MANUAL=true`

預設關閉：

- `ENABLE_FUTU=false`
- `ENABLE_RSS_PUBLIC=false`

Futu 只有在使用者已安裝 OpenD、已登入、且已擁有不需額外購買的免費行情權限時，才可設定：

```env
ENABLE_FUTU=true
FUTU_PERMISSION_CONFIRMED=true
```

若權限不足，provider 只回 `permission_or_paid_data_required`，不提示購買。

## Live Fetch 實機驗證

某些開發環境會因 TLS / 系統憑證、公司代理、防火牆或 DNS 限制，導致 TWSE / TPEx / MOPS live fetch 失敗。這不是 provider mapping 失效，也不要用關閉 TLS 驗證的方式處理。

部署到使用者實機或雲端後，先跑：

```bash
npm run live:check
npm run live:check -- 2026-05-07
```

輸出會標示每個 provider：

- `ok`
- `tls_error`
- `network_error`
- `endpoint_changed`
- `data_schema_changed`
- `disabled`

Docker image 已安裝 `ca-certificates`。預設不要設定 `NODE_TLS_REJECT_UNAUTHORIZED=0`。若公司或雲端環境需要自訂根憑證，請使用 Node 官方支援的：

```env
NODE_EXTRA_CA_CERTS=/path/to/company-root-ca.pem
```

live fetch 失敗時，系統仍可使用 fixtures 驗證 mapping、LINE ingestion 與 manual pack；報告與 `manual_gpt_pack` 會列出 `data_gaps` / `source_status`，並降低 `data_quality_score`。

## Fixtures 驗證 Mapping

官方 provider 的 normalize 邏輯用 fixtures 測試：

```bash
npm test -- tests/official-providers.test.ts
```

fixtures 位於 [tests/fixtures](/C:/STOCK/tests/fixtures)，涵蓋 TWSE 日行情、三大法人、融資融券、TPEx 日行情、指數、三大法人、融資融券與 MOPS 重大訊息。

## Daily Snapshot

`daily_market_snapshots` 是每日市場總表。建立或重建今日 snapshot：

```bash
npm run snapshot:today
```

指定日期：

```bash
npm run snapshot -- 2026-05-07
```

job 會從 `market_daily`、`institutional_flows`、`margin_short`、`news_events` 彙整，並用 upsert 寫入，不會重複新增。

## Production E2E Dry Run

完整日流程 dry run：

```bash
npm run e2e:daily -- 2026-05-07
npm run e2e:daily -- 2026-05-07 --mode=auto
npm run e2e:daily -- 2026-05-07 --mode=live
npm run e2e:daily -- 2026-05-07 --mode=fixture
npm run e2e:daily -- today --push=false
```

流程會依序執行：

- `live:check`
- 官方資料收集；若 TWSE / TPEx / MOPS live fetch 失敗，改用 fixtures 驗證 mapping，並在 `source_status` / `data_gaps` 標示 fixture fallback
- 建立 daily market snapshot
- 計算 `sector_strength`
- 計算 `ticker_candidates`
- 產出 `manual_gpt_pack`
- 產出 strategy report
- 寫出 Markdown 報告到 `outputs/reports/<date>.md`

範例輸出：

```text
outputs/reports/2026-05-07.md
outputs/reports/2026-05-07.json
outputs/manual-packs/2026-05-07.md
outputs/source-status/2026-05-07.json
outputs/data-quality/2026-05-07.json
```

dry run 不會把 fixture 偽裝成正式 live data。任一 provider 失敗都不得讓流程 crash；報告會保留 provider 狀態、資料缺口，並降低資料品質分數。族群或個股資料不足時，報告會明確寫「資料不足」，不硬列強勢族群、當沖候選或波段候選。

## Beta Live Deploy Checklist

1. 設定 `.env`，至少包含 `DATABASE_URL`、LINE secrets、`USER_HASH_SECRET`。
2. 執行 Supabase/PostgreSQL schema 與 migrations。
3. 跑 `npm run live:check -- 2026-05-07`，確認 TWSE / TPEx / MOPS 狀態。
4. 跑 `npm run collect:official -- 2026-05-07 --mode=auto`。
5. 跑 `npm run e2e:daily -- 2026-05-07 --mode=auto --push=false`。
6. 跑 `npm run line:verify` 與 `npm run line:test-webhook`。
7. 設定 LINE webhook URL 後，用真實群組發文字、圖片、PDF 測試。
8. 跑 `npm run gpt:action:check`，確認 GPT Action endpoint 與 auth。
9. 確認報告不使用付費資料 API、不使用 Futu、不含交易執行指令、不輸出未回測勝率。

## OFFICIAL_DATA_MODE

```env
OFFICIAL_DATA_MODE=auto
```

可選值：

- `live`：只用 live fetch。任一官方來源失敗時，不使用 fixture，報告只列 `data_gaps/source_status`。
- `auto`：live 成功就用 live；live 失敗可用 fixture fallback，但必須標示 `fixture_fallback_from_xxx`，並降低 `data_quality_score`。
- `fixture`：只用 fixtures，僅供測試。報告會標示「測試資料，不可用於真實市場判斷」。

Production 不得偷偷使用 fixture。所有 fallback 都會寫入 `source_status`、`data_gaps` 與 `outputs/source-status/<date>.json`。

## Production Data Quality

資料品質由 [data-quality-engine.ts](/C:/STOCK/src/analysis/data-quality-engine.ts) 評估，輸出：

- `score`
- `level`: `high` / `medium` / `low` / `fixture_only` / `insufficient`
- `reasons`
- `source_status`
- `data_gaps`

規則摘要：

- 官方 live 全成功：高分。
- 官方 live 部分成功：中低分。
- 官方 live 全失敗但使用 fixture fallback：`fixture_only`，不可因 fixture 完整而給高分。
- 只有 LINE/manual news：低分。
- 只有 metadata、沒有 OCR/市場資料：低分。
- 無資料：`0`。

## Official Data Collector

正式收官方資料：

```bash
npm run collect:official:today
npm run collect:official -- 2026-05-07
npm run collect:official:range -- 2026-05-01 2026-05-07
```

collector 會依 `OFFICIAL_DATA_MODE` 或 `--mode=` 執行 TWSE / TPEx / MOPS，並 upsert：

- `market_daily`
- `institutional_flows`
- `margin_short`
- `news_events`
- `daily_market_snapshots`

來源會標成 `twse_live`、`tpex_live`、`mops_live` 或 `twse_fixture`、`tpex_fixture`、`mops_fixture`。

## Manual GPT Pack

manual 模式下不呼叫 OpenAI API。產出的資料包包含：

- 今日市場狀態
- 多空判斷
- 可能走勢
- 大戶策略推估
- 強勢族群
- 續抱觀察
- 當沖候選
- 波段候選
- 風險警訊
- 資料缺口
- 明日觀察重點
- 官方資料、法人、融資融券、MOPS、LINE manual news、attachments metadata
- `data_source_status`
- `cost_guard_status`

範例在 [manual_gpt_pack.example.md](/C:/STOCK/docs/examples/manual_gpt_pack.example.md)。

## Custom GPT Action

OpenAPI 檔案在 [openapi/gpt-action.yaml](/C:/STOCK/openapi/gpt-action.yaml)。

所有 `/gpt/*` endpoint 需要：

```http
Authorization: Bearer <GPT_ACTION_BEARER_TOKEN>
```

可查：

- `GET /gpt/market-calendar/today`
- `GET /gpt/reports/today/summary`
- `GET /gpt/signals/today`
- `GET /gpt/reports/today`
- `GET /gpt/reports/:date`
- `GET /gpt/tickers/:ticker/today`
- `GET /gpt/tickers/:ticker/history?days=20`
- `GET /gpt/sectors/today`
- `GET /gpt/candidates/today?type=momentum`
- `GET /gpt/holdings`
- `GET /gpt/news/today/summary?limit=20`
- `GET /gpt/news/today`
- `GET /gpt/sources/status`
- `GET /gpt/manual-pack/:date`
- `POST /gpt/query`

API 只回傳使用者自己的資料與摘要，不回傳付費報告全文，不暴露 LINE userId。

新的 compact endpoints 是給 GPT 優先使用，避免 `/gpt/reports/today` 與 `/gpt/manual-pack/:date` payload 過大。`/gpt/sectors/today`、`/gpt/candidates/today` 與新聞 summary 在沒有資料時會回 `data_available`、`empty_reason` 與 `data_gaps`，不產生假資料。

內部新聞寫入端點：

```http
POST /internal/ingest/news
Authorization: Bearer <ADMIN_TOKEN>
```

這個 endpoint 只供 crawler/admin 寫入 `news_items`，不要加到 Custom GPT Actions schema。建議流程是：

```text
crawler -> POST /internal/ingest/news -> news_items -> GET /gpt/news/today/summary -> GPT
```

候選股與族群 MVP builder：

```bash
npm run build:candidates -- today momentum
npm run build:sectors -- today
```

Render 必要環境變數至少包含：

- `DATABASE_URL`
- `ADMIN_TOKEN`
- `GPT_ACTION_BEARER_TOKEN`
- 既有 LINE secrets：`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`USER_HASH_SECRET`

curl 驗收範例：

```bash
curl -s https://line-market-intel-ai-free-data.onrender.com/gpt/market-calendar/today -H "Authorization: Bearer $GPT_ACTION_BEARER_TOKEN"
curl -s https://line-market-intel-ai-free-data.onrender.com/gpt/reports/today/summary -H "Authorization: Bearer $GPT_ACTION_BEARER_TOKEN"
curl -s https://line-market-intel-ai-free-data.onrender.com/gpt/signals/today -H "Authorization: Bearer $GPT_ACTION_BEARER_TOKEN"
curl -s https://line-market-intel-ai-free-data.onrender.com/gpt/sectors/today -H "Authorization: Bearer $GPT_ACTION_BEARER_TOKEN"
curl -s "https://line-market-intel-ai-free-data.onrender.com/gpt/candidates/today?type=momentum" -H "Authorization: Bearer $GPT_ACTION_BEARER_TOKEN"
curl -s "https://line-market-intel-ai-free-data.onrender.com/gpt/news/today/summary?limit=20" -H "Authorization: Bearer $GPT_ACTION_BEARER_TOKEN"
curl -s https://line-market-intel-ai-free-data.onrender.com/gpt/sources/status -H "Authorization: Bearer $GPT_ACTION_BEARER_TOKEN"
```

內部 ingest 測試：

```bash
curl -X POST https://line-market-intel-ai-free-data.onrender.com/internal/ingest/news \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":"test-news-001","source":"manual_test","title":"測試新聞標題","summary":null,"full_text":null,"source_url":"https://example.com/test","related_tickers":[],"related_sectors":[],"event_type":"other","importance":"medium","is_mops":false,"data_quality_score":45,"data_gaps":["summary_missing","full_text_missing"],"interpretation_limit":"title_only"}]}'
```

檢查本地 GPT Action 可用性：

```bash
npm run gpt:action:check
```

建立 Custom GPT Action 時，把 [openapi/gpt-action.yaml](/C:/STOCK/openapi/gpt-action.yaml) 貼到 Action schema，Auth 使用 Bearer token，token 對應 `.env` 的 `GPT_ACTION_BEARER_TOKEN`。缺 token 時 endpoint 必須回 `401`。

## LINE Production Setup Checklist

1. 建立 LINE Messaging API channel。
2. 設定 webhook URL：`https://你的網域/line/webhook`。
3. 開啟 use webhook。
4. 加 bot 到群組。
5. 群組公告資料收集用途。
6. 跑 `npm run line:verify`。
7. 發一則文字測試。
8. 發一張圖片測試。
9. 發一個 PDF 測試。
10. 確認 DB / storage 有資料。

本地 fixture 測試：

```bash
npm run line:test-webhook
```

LINE userId 必須 HMAC hash 後保存；附件只存 private storage path，Custom GPT API 不暴露 private path。

## Holdings / Watchlist Commands

支援：

```text
/持股
/持股 新增 6526 達發 成本 725 股數 1 策略 波段
/持股 刪除 6526
/持股 更新 6526 成本 710 股數 2
/觀察
/觀察 2492 華新科 被動元件
/觀察 2377 微星 低基期 獲利改善
/刪除觀察 2492
```

持股與觀察名單會寫入 group/user scope。群組回覆不公開敏感成本資訊；成本只用於個人研究與續抱觀察，不做交易執行。

## LINE Push Report

預設不推送：

```env
ENABLE_LINE_PUSH=false
LINE_PUSH_TARGET_ID=
```

手動推送：

```bash
npm run push:report -- 2026-05-07 postmarket
```

`AI_MODE=manual` 時只推 manual_gpt_pack 完成、report path、`data_quality_score` 與 `data_gaps` 摘要。若 `data_quality_score < 50`，推送必須標示「資料品質不足」。訊息不含勝率欄位，也不含交易執行建議。

## Production Environment Bring-up

部署前先跑完整環境檢查：

```bash
npm run prod:check
```

會檢查：

- `DATABASE_URL`
- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `USER_HASH_SECRET`
- `GPT_ACTION_BEARER_TOKEN`
- `OFFICIAL_DATA_MODE`
- `AI_MODE`
- `NO_PAID_DATA_API`
- `DISABLE_PAID_MARKET_DATA`
- `ENABLE_FUTU`
- `ENABLE_LINE_PUSH`
- `LINE_PUSH_TARGET_ID`，僅在 push enabled 時必填
- DB 連線與必要 schema
- private storage path 可寫
- paid data provider / Futu policy

輸出：

```text
outputs/prod-check/latest.json
outputs/prod-check/latest.md
```

狀態分成 `ready`、`warning`、`blocker`，並附 `suggested_fix`。缺 `DATABASE_URL`、缺 LINE secrets、`ENABLE_LINE_PUSH=true` 但缺 target、`ENABLE_FUTU=true` 但未確認免費權限、`NO_PAID_DATA_API=false` 都會列為 blocker。

## Required Environment Variables

Production 最少需要：

```env
DATABASE_URL=
LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=
USER_HASH_SECRET=
GPT_ACTION_BEARER_TOKEN=
OFFICIAL_DATA_MODE=auto
AI_MODE=manual
NO_PAID_DATA_API=true
DISABLE_PAID_MARKET_DATA=true
DISABLE_NEWS_SCRAPING=true
ENABLE_FUTU=false
ENABLE_LINE_PUSH=false
LINE_PUSH_TARGET_ID=
```

若環境有公司代理或自簽 CA，可額外設定：

```env
NODE_EXTRA_CA_CERTS=/path/to/company-root-ca.pem
```

不要設定 `NODE_TLS_REJECT_UNAUTHORIZED=0`。

## DB Migration / Check / Seed

```bash
npm run db:migrate
npm run db:check
npm run db:seed:dev
```

- `db:migrate` 會執行 [supabase/schema.sql](/C:/STOCK/supabase/schema.sql)，使用 `create table if not exists`，已存在 table 不會失敗。
- `db:check` 會檢查 production 必要 table 是否存在。
- `db:seed:dev` 只在非 production 或 `SEED_DEV_DATA=true` 時可執行，寫入 `2026-05-07` fixture 資料與範例觀察名單 `2330 台積電`，不寫入敏感持股成本。

缺 `DATABASE_URL` 時這些指令不會 crash，會輸出明確錯誤。

## TLS Diagnostics

若 `live:check` 出現 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 或其他 TLS 問題：

```bash
npm run tls:diagnose
```

輸出：

```text
outputs/tls-diagnose/latest.json
outputs/tls-diagnose/latest.md
```

內容包含 Node version、platform、OpenSSL version、`NODE_EXTRA_CA_CERTS`、`NODE_TLS_REJECT_UNAUTHORIZED`、provider URL、TLS error code 與修正建議。

修正方向：

- Ubuntu / Debian：安裝或更新 `ca-certificates`。
- Alpine：安裝 `ca-certificates`。
- macOS：更新系統憑證與 Node runtime。
- 公司代理 / 自簽憑證：取得公司 root CA PEM，設定 `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`。
- Dockerfile 已安裝 `ca-certificates`。
- 不要關閉 TLS 驗證。

## Real LINE Webhook Setup

Production bring-up 指令：

```bash
npm run line:prod-check
npm run line:send-test-reply
```

真實 LINE webhook 測試流程：

1. 部署服務。
2. 設定 LINE webhook URL。
3. 開啟 Use webhook。
4. 加 bot 到群組。
5. 群組公告 bot 收集用途。
6. 發送 `/成本`。
7. 發送 `/觀察 2330 台積電`。
8. 發一張測試圖片。
9. 發一個測試 PDF。
10. 檢查 DB `line_messages`。
11. 檢查 private storage。
12. 執行 `/手動包`。

`line:send-test-reply` 需要 `LINE_TEST_TARGET_ID`，沒有 target 時只提示如何取得 groupId/userId，不暴露 secrets，也不發送持股敏感資訊。

## Report Persistence

E2E 產出檔案後會嘗試把報告寫進 DB：

- `strategy_reports`
- `manual_gpt_packs`

手動操作：

```bash
npm run report:save -- 2026-05-07 postmarket
npm run report:load -- 2026-05-07 postmarket
```

若 DB 不可用，不會中斷報告輸出；檔案仍會保留在：

```text
outputs/reports/<date>.md
outputs/reports/<date>.json
outputs/manual-packs/<date>.md
```

報告會標示 `db_unavailable`。GPT Action endpoints 會優先讀 DB，DB 沒資料或不可用時再讀 `outputs` fallback。

## GPT Action Production Setup

輸出可直接貼到 Custom GPT 的 Action schema：

```bash
npm run gpt:action:export
npm run gpt:action:smoke
```

輸出：

```text
outputs/gpt-action/openapi.yaml
outputs/gpt-action/setup.md
```

Custom GPT 設定步驟：

1. 建立 Custom GPT。
2. 加入 Action。
3. 貼上 `outputs/gpt-action/openapi.yaml` 或 [openapi/gpt-action.yaml](/C:/STOCK/openapi/gpt-action.yaml)。
4. 設定 Bearer token，值為 `GPT_ACTION_BEARER_TOKEN`。
5. 測試 `/gpt/reports/today`。
6. 測試 `/gpt/holdings`。

`gpt:action:smoke` 會檢查 auth 401、reports、manual pack、holdings、不得暴露 raw LINE userId、不得回傳付費全文。

## Bringup Live Command

完整部署前檢查：

```bash
npm run bringup:live
```

流程：

1. `prod:check`
2. `db:check`
3. `live:check`
4. 若 live fetch 是 TLS error，執行 `tls:diagnose`
5. `line:prod-check`
6. `gpt:action:smoke`
7. `e2e:daily today --mode=auto --push=false`

輸出：

```text
outputs/bringup/latest.md
outputs/bringup/latest.json
```

即使 DB、LINE secrets、live fetch 或 GPT Action 尚未設定完成，也不會 crash；報告會列出 blockers、warnings 與下一步。

## 報告與回測限制

報告可產生：

- 盤前
- 盤中
- 盤後
- 週報

內容包含市場多空、可能走勢、大戶策略、重大消息、族群、續抱標的、當沖標的、波段標的、觸發條件、風險與資料缺口。

沒有 backtest 前不輸出勝率；樣本數 `< 30` 也不輸出 `win_rate`。系統只會輸出 `confidence_score`。

signal engine 會先產生規則式結構化結果，GPT 只負責寫成人話報告。若 `big_money_strategy = ["wait"]`，報告不得自行臆測誘多、誘空、吃貨或出貨；若 `sector_strength` 或 `ticker_candidates` 為空，不得硬列強勢族群、當沖或波段標的。

## Troubleshooting

`network_error`：檢查 DNS、防火牆、代理或官方站台暫時不可用。可先跑 `npm run live:check -- <date>` 看 URL、latency、content-type 與 response sample。

`tls_error`：確認作業系統根憑證或 Docker `ca-certificates`。需要企業 CA 時設定 `NODE_EXTRA_CA_CERTS`；不要設定 `NODE_TLS_REJECT_UNAUTHORIZED=0`。

`endpoint_changed` / `http_404`：官方 endpoint 可能改版，更新 provider URL 與 fixture。

`schema_changed`：官方 JSON 欄位可能改版，更新 normalize mapping 與 tests fixtures。

不使用付費資料 API。Futu 預設 disabled。不做交易執行。沒有 backtest 且 sample_size >= 30 前，不輸出 `win_rate`。

## 開發

```bash
npm install
npm run dev
npm test
npm run build
```

預設服務在 `http://localhost:3000`。

## 部署

1. 複製 `.env.example` 成 `.env`
2. 設定 `DATABASE_URL`
3. 在 Supabase/PostgreSQL 執行 `supabase/schema.sql`
4. 設定 LINE webhook
5. 依需求設定 `AI_MODE=manual` 或 `AI_MODE=openai`
6. 使用 Docker 或 Node 20 啟動

```bash
docker build -t line-market-intel-ai-free-data .
docker run --env-file .env -p 3000:3000 line-market-intel-ai-free-data
```

## 隱私與安全

- LINE userId 不以明文保存
- 原始附件不公開
- 付費/會員/授權不明內容不自動爬取
- 不公開付費法人報告全文
- Custom GPT API 需要 Bearer token
- 不做自動下單，不含交易 API

## 目前狀態

目前是 **Beta Live Running Candidate**：程式架構、E2E production dry run、三種資料模式、LINE 指令、GPT Action 檢查、LINE push 骨架、data quality、fixture fallback、report persistence、production bring-up 檢查都已具備。

還不是 Production Live。正式上線前仍需在真實環境設定 `DATABASE_URL`、LINE secrets、`GPT_ACTION_BEARER_TOKEN`、live fetch 憑證鏈與 LINE push target，並用 `npm run bringup:live` 確認 blockers 已清空。
