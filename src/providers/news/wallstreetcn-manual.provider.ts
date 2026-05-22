import { config } from "../../config.js";
import { type ProviderPolicy } from "../../cost/provider-policy.js";
import { ManualNewsProvider } from "./manual.provider.js";

export class WallStreetCnManualProvider extends ManualNewsProvider {
  name = "wallstreetcn-manual";
  protected sourceLabel = "wallstreetcn";
  policy: ProviderPolicy = {
    name: this.name,
    category: "news",
    enabled: config.enableWallStreetCnManual,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "user_provided",
    allowedWhenNoPaidApi: true,
    mode: config.enableWallStreetCnManual ? "manual" : "disabled",
    note: "Accepts WallStreetCN screenshots/text/links from LINE or manual uploads only. No VIP/member crawling."
  };
}
