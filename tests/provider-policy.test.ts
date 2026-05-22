import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { enforceProviderPolicy, type ProviderPolicy } from "../src/cost/provider-policy.js";
import { FutuMarketProvider } from "../src/providers/market/futu.provider.js";

describe("provider policy", () => {
  it("disables paid providers when NO_PAID_DATA_API=true", () => {
    const cfg = loadConfig({ NO_PAID_DATA_API: "true" } as NodeJS.ProcessEnv);
    const policy: ProviderPolicy = {
      name: "paid-test",
      category: "market",
      enabled: true,
      paid: true,
      requiresLogin: false,
      requiresPermission: false,
      termsChecked: false,
      licenseStatus: "unknown",
      allowedWhenNoPaidApi: false,
      mode: "automatic"
    };
    const resolved = enforceProviderPolicy(policy, cfg);
    expect(resolved.enabled).toBe(false);
    expect(resolved.reason).toBe("paid_provider_blocked_by_NO_PAID_DATA_API");
  });

  it("keeps Futu disabled when permission is unavailable", async () => {
    const futu = new FutuMarketProvider();
    const check = await futu.selfCheck();
    expect(check.status).toBe("disabled");
  });
});
