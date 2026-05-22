import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import type { InstitutionalFlow } from "../providers/market/provider.js";

export class InstitutionalFlowsRepo {
  constructor(private readonly database: Queryable = db) {}

  async upsertInstitutionalFlows(rows: InstitutionalFlow[]): Promise<number> {
    let count = 0;
    for (const row of rows) {
      await this.database.query(
        `insert into institutional_flows (
          trade_date, ticker, foreign_net, investment_trust_net, dealer_net, total_net, source
        ) values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (trade_date, ticker, source) do update set
          foreign_net = excluded.foreign_net,
          investment_trust_net = excluded.investment_trust_net,
          dealer_net = excluded.dealer_net,
          total_net = excluded.total_net`,
        [
          row.tradeDate,
          row.ticker,
          row.foreignNet,
          row.investmentTrustNet,
          row.dealerNet,
          row.totalNet,
          row.source
        ]
      );
      count += 1;
    }
    return count;
  }
}
