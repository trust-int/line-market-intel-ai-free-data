import { config } from "../../config.js";
import { type ProviderPolicy } from "../../cost/provider-policy.js";
import { ManualNewsProvider } from "./manual.provider.js";

export class FutuNewsManualProvider extends ManualNewsProvider {
  name = "futu-news-manual";
  protected sourceLabel = "futu-news";
  policy: ProviderPolicy = {
    name: this.name,
    category: "news",
    enabled: config.enableFutuNewsManual,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "user_provided",
    allowedWhenNoPaidApi: true,
    mode: config.enableFutuNewsManual ? "manual" : "disabled",
    note: "Accepts user-forwarded Futu news only unless free permission is confirmed."
  };
}
