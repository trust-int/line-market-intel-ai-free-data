# Release Checklist

Use this before calling a deployment Production Live.

- [ ] `npm test` passed
- [ ] `npm run build` passed
- [ ] `npm run prod:check` has no blockers
- [ ] `npm run db:migrate` ok
- [ ] `npm run db:check` ok
- [ ] `npm run tls:diagnose` ok or TLS issue documented with `NODE_EXTRA_CA_CERTS` / CA fix
- [ ] `npm run live:check` ok or fallback documented with data quality lowered
- [ ] LINE webhook tested with real LINE request
- [ ] LINE command tested: `/成本`
- [ ] LINE command tested: `/觀察 2330 台積電`
- [ ] Image metadata ingestion tested
- [ ] PDF metadata ingestion tested
- [ ] `npm run gpt:action:smoke` passed
- [ ] `npm run e2e:daily -- today --mode=auto --push=false` passed
- [ ] `npm run first-live-run` passed
- [ ] Report generated in `outputs/reports`
- [ ] Manual GPT pack generated in `outputs/manual-packs`
- [ ] Report persisted to `strategy_reports` when DB is available
- [ ] Manual pack persisted to `manual_gpt_packs` when DB is available
- [ ] No paid data API enabled
- [ ] Futu disabled unless free permission is explicitly confirmed
- [ ] No automatic trading
- [ ] No `win_rate` without backtest `sample_size >= 30`
- [ ] `AI_MODE=manual` confirmed no OpenAI calls
- [ ] `OFFICIAL_DATA_MODE=fixture` not used for real market judgement
