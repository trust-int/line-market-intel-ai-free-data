import express from "express";
import { config } from "../config.js";
import { CostGuard } from "../cost/cost-guard.js";
import { defaultProviderPolicies, enforceProviderPolicy } from "../cost/provider-policy.js";

export function createAdminRouter() {
  const router = express.Router();

  router.get("/health", async (_req, res) => {
    const usage = await new CostGuard().readUsage();
    res.json({
      ok: true,
      ai_mode: config.aiMode,
      no_paid_data_api: config.noPaidDataApi,
      disable_paid_market_data: config.disablePaidMarketData,
      paid_data_api_used: false,
      openai_usage: usage
    });
  });

  router.get("/provider-policy", (_req, res) => {
    res.json(defaultProviderPolicies().map((policy) => enforceProviderPolicy(policy)));
  });

  return router;
}
