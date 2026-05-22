import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { CostGuard } from "../cost/cost-guard.js";
import { generateDailyReport } from "../reports/daily.js";
import { generateIntradayReport } from "../reports/intraday.js";
import { generateWeeklyReport } from "../reports/weekly.js";
import { generateManualReportPack } from "../reports/manual-pack.js";
import { todayTaipei } from "../utils/date.js";

export type LineCommandResult = {
  handled: boolean;
  command?: string;
  replyText?: string;
};

export type LineCommandScope = {
  scopeType?: "user" | "group" | "room";
  scopeId?: string;
  userHash?: string;
};

export async function handleLineCommand(
  rawText: string,
  deps: { database?: Queryable; scope?: LineCommandScope } = {}
): Promise<LineCommandResult> {
  const text = rawText.trim();
  if (!text.startsWith("/")) return { handled: false };
  const tokens = text.split(/\s+/);
  const [command, ...args] = tokens;
  const arg = args[0];
  const database = deps.database ?? db;
  const scope = deps.scope ?? {};

  switch (command) {
    case "/盤前":
      await generateManualReportPack("premarket");
      return done(command, "盤前 manual_gpt_pack 已產生。");
    case "/盤中":
      await generateIntradayReport({ date: todayTaipei() });
      return done(command, "盤中 manual_gpt_pack 已產生。");
    case "/盤後":
      await generateDailyReport({ date: todayTaipei() });
      return done(command, "盤後 manual_gpt_pack 已產生。");
    case "/週報":
      await generateWeeklyReport({ date: todayTaipei() });
      return done(command, "週報 manual_gpt_pack 已產生。");
    case "/持股": {
      if (arg === "新增") return addHolding(database, scope, args);
      if (arg === "更新") return updateHolding(database, scope, args);
      if (arg === "刪除") return deleteHolding(database, scope, args);
      const rows = await database.query<{ ticker: string; name?: string; qty?: number }>(
        scopedSql("select ticker, name, qty from holdings where active = true", scope) + " order by ticker",
        scopedParams([], scope)
      );
      return done(command, rows.rows.length ? rows.rows.map((row) => `${row.ticker} ${row.name ?? ""} ${row.qty ?? ""}`.trim()).join("\n") : "目前沒有 active holdings。");
    }
    case "/觀察": {
      if (!arg) {
        const rows = await database.query<{ ticker: string; name?: string; themes?: string[] }>(
          scopedSql("select ticker, name, themes from watchlist where active = true", scope) + " order by ticker",
          scopedParams([], scope)
        );
        return done(command, rows.rows.length ? rows.rows.map((row) => `${row.ticker} ${row.name ?? ""} ${(row.themes ?? []).join(" ")}`.trim()).join("\n") : "目前沒有 active watchlist。");
      }
      if (!/^\d{4}$/.test(arg)) return done(command, "格式：/觀察 2454 名稱 題材");
      const name = args[1] && !looksLikeTheme(args[1]) ? args[1] : undefined;
      const themes = args.slice(name ? 2 : 1);
      await database.query(
        `insert into watchlist (ticker, name, themes, source, active, scope_type, scope_id, user_hash)
         values ($1, $2, $3, 'line_command', true, $4, $5, $6)
         on conflict (ticker) do update set name = coalesce(excluded.name, watchlist.name), themes = excluded.themes, active = true, source = 'line_command'`,
        [arg, name, themes, scope.scopeType, scope.scopeId, scope.userHash]
      );
      return done(command, `已加入觀察：${arg}`);
    }
    case "/刪除觀察":
      if (!arg || !/^\d{4}$/.test(arg)) return done(command, "格式：/刪除觀察 2454");
      await database.query(scopedSql("update watchlist set active = false where ticker = $1", scope), scopedParams([arg], scope));
      return done(command, `已刪除觀察：${arg}`);
    case "/手動包":
      await generateManualReportPack("ad_hoc");
      return done(command, "手動包已產生。");
    case "/今日新聞": {
      const rows = await database.query<{ source: string; title?: string }>(
        "select source, title from news_events where fetched_at::date = $1 order by fetched_at desc limit 20",
        [todayTaipei()]
      );
      return done(command, rows.rows.length ? rows.rows.map((row) => `[${row.source}] ${row.title ?? ""}`).join("\n") : "今日尚無新聞摘要。");
    }
    case "/成本": {
      const usage = await new CostGuard().readUsage();
      return done(command, `AI requests: ${usage.openaiRequests}\nEstimated cost: ${usage.estimatedCostUsd}\nPaid data API used: false`);
    }
    default:
      return { handled: false };
  }
}

function done(command: string, replyText: string): LineCommandResult {
  return { handled: true, command, replyText };
}

async function addHolding(database: Queryable, scope: LineCommandScope, args: string[]): Promise<LineCommandResult> {
  const ticker = args[1];
  if (!ticker || !/^\d{4}$/.test(ticker)) return done("/持股", "格式：/持股 新增 6526 達發 成本 725 股數 1 策略 波段");
  const name = args[2] && !["成本", "股數", "策略"].includes(args[2]) ? args[2] : undefined;
  const avgCost = numberAfter(args, "成本");
  const qty = numberAfter(args, "股數");
  const strategy = valueAfter(args, "策略");
  await database.query(
    `insert into holdings (ticker, name, avg_cost, qty, strategy, active, scope_type, scope_id, user_hash)
     values ($1,$2,$3,$4,$5,true,$6,$7,$8)
     on conflict (ticker, scope_type, scope_id) do update set
       name = coalesce(excluded.name, holdings.name),
       avg_cost = excluded.avg_cost,
       qty = excluded.qty,
       strategy = excluded.strategy,
       active = true`,
    [ticker, name, avgCost, qty, strategy, scope.scopeType, scope.scopeId, scope.userHash]
  );
  return done("/持股", `已更新持股：${ticker}。成本資訊不在群組公開。`);
}

async function updateHolding(database: Queryable, scope: LineCommandScope, args: string[]): Promise<LineCommandResult> {
  const ticker = args[1];
  if (!ticker || !/^\d{4}$/.test(ticker)) return done("/持股", "格式：/持股 更新 6526 成本 710 股數 2");
  const avgCost = numberAfter(args, "成本");
  const qty = numberAfter(args, "股數");
  await database.query(
    scopedSql("update holdings set avg_cost = coalesce($2, avg_cost), qty = coalesce($3, qty), active = true where ticker = $1", scope),
    scopedParams([ticker, avgCost, qty], scope)
  );
  return done("/持股", `已更新持股：${ticker}。`);
}

async function deleteHolding(database: Queryable, scope: LineCommandScope, args: string[]): Promise<LineCommandResult> {
  const ticker = args[1];
  if (!ticker || !/^\d{4}$/.test(ticker)) return done("/持股", "格式：/持股 刪除 6526");
  await database.query(scopedSql("update holdings set active = false where ticker = $1", scope), scopedParams([ticker], scope));
  return done("/持股", `已刪除持股：${ticker}`);
}

function scopedSql(sql: string, scope: LineCommandScope): string {
  if (!scope.scopeType || !scope.scopeId) return sql;
  const keyword = sql.toLowerCase().includes(" where ") ? " and" : " where";
  return `${sql}${keyword} scope_type = $${scopeParamIndex(sql)} and scope_id = $${scopeParamIndex(sql) + 1}`;
}

function scopedParams(params: unknown[], scope: LineCommandScope): unknown[] {
  if (!scope.scopeType || !scope.scopeId) return params;
  return [...params, scope.scopeType, scope.scopeId];
}

function scopeParamIndex(sql: string): number {
  const matches = sql.match(/\$\d+/g) ?? [];
  return matches.length + 1;
}

function numberAfter(args: string[], key: string): number | undefined {
  const index = args.indexOf(key);
  if (index < 0) return undefined;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}

function valueAfter(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

function looksLikeTheme(value: string): boolean {
  return ["半導體", "被動元件", "低基期", "AI", "獲利改善"].includes(value);
}
