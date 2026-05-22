# 2026-05-07 台股 manual_gpt_pack

請根據下列固定模板撰寫報告。不可輸出勝率欄位，除非資料包明確提供 backtest 且 sample_size >= 30。不可建議自動下單。

## 1. 今日市場狀態
```json
{
  "trade_date": "2026-05-07",
  "taiex_close": 23500.25,
  "taiex_change_pct": 0.52,
  "otc_close": 250.5,
  "otc_change_pct": -0.3,
  "advance_count": 935,
  "decline_count": 772,
  "foreign_net_buy": 1250000,
  "investment_trust_net_buy": 180000,
  "dealer_net_buy": -45000,
  "margin_balance_change": 120,
  "short_balance_change": -25,
  "market_bias": "neutral",
  "risk_level": "low",
  "data_quality_score": 100
}
```

## 2. 多空判斷
```json
{
  "market_bias": "neutral",
  "market_phase": "pullback",
  "big_money_strategy": ["wait"],
  "risk_flags": [],
  "sector_strength": [],
  "ticker_candidates": [],
  "data_quality_score": 100
}
```

## 3. 可能走勢
- 請根據 market_phase、risk_flags、data_quality_score 推估，並標示失效條件。

## 4. 大戶策略推估
- 使用 signal-engine 的 big_money_strategy 作為主判斷，不要自行臆測。

## 5. 強勢族群
```json
[]
```

## 6. 續抱觀察
- 根據 holdings 或 watchlist 內容整理；資料不足就列資料缺口。

## 7. 當沖候選
```json
[]
```

## 8. 波段候選
- 只列 confidence_score，不列勝率。

## 9. 風險警訊
```json
[]
```

## 10. 資料缺口
```json
[]
```

## 11. 明日觀察重點
- 根據官方資料、MOPS 重大訊息與 LINE manual news 統整。

## 官方資料
### Institutional Flows
```json
[
  { "tradeDate": "2026-05-07", "market": "TWSE", "foreignNetBuy": 700000, "investmentTrustNetBuy": 300000, "dealerNetBuy": -30000 },
  { "tradeDate": "2026-05-07", "market": "TPEX", "foreignNetBuy": 100000, "investmentTrustNetBuy": -20000, "dealerNetBuy": 5000 }
]
```

### Margin / Short
```json
[
  { "tradeDate": "2026-05-07", "market": "TWSE", "marginBalanceChange": 120, "shortBalanceChange": -5 },
  { "tradeDate": "2026-05-07", "market": "TPEX", "marginBalanceChange": 100, "shortBalanceChange": -20 }
]
```

### MOPS Material News
```json
[
  {
    "source": "mops",
    "title": "2330 台積電 公告本公司董事會通過重大投資案",
    "tickers": ["2330"],
    "licenseStatus": "official_public"
  }
]
```

### LINE Manual News Events
```json
[
  {
    "source": "line",
    "title": "使用者轉傳新聞摘要",
    "tickers": ["2330"],
    "licenseStatus": "user_provided"
  }
]
```

### Uploaded Attachments Metadata
```json
[
  {
    "file_name": "line-image.jpg",
    "mime_type": "image/jpeg",
    "content_sha256": "example-sha256",
    "received_at": "2026-05-07T20:30:00+08:00"
  }
]
```
