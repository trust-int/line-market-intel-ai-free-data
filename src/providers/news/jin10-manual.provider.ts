import { config } from "../../config.js";
import { type ProviderPolicy } from "../../cost/provider-policy.js";
import { ManualNewsProvider } from "./manual.provider.js";

export class Jin10ManualProvider extends ManualNewsProvider {
  name = "jin10-manual";
  protected sourceLabel = "jin10";
  policy: ProviderPolicy = {
    name: this.name,
    category: "news",
    enabled: config.enableJin10Manual,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "user_provided",
    allowedWhenNoPaidApi: true,
    mode: config.enableJin10Manual ? "manual" : "disabled",
    note: "Accepts Jin10 screenshots/text/links from LINE or manual uploads only. No paid API."
  };
}
