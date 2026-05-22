import type { AppConfig } from "../config.js";
import { config } from "../config.js";

export type ProviderMode = "automatic" | "manual" | "disabled";
export type ProviderCategory = "news" | "market" | "line" | "storage" | "ai";

export type ProviderPolicy = {
  name: string;
  category: ProviderCategory;
  enabled: boolean;
  paid: boolean;
  requiresLogin: boolean;
  requiresPermission: boolean;
  termsChecked: boolean;
  licenseStatus: "official_public" | "user_provided" | "free_public" | "licensed" | "unknown";
  allowedWhenNoPaidApi: boolean;
  userAuthorized?: boolean;
  permissionConfirmed?: boolean;
  mode: ProviderMode;
  note?: string;
};

export type ProviderResolution = ProviderPolicy & {
  status: "enabled" | "disabled";
  reason?: string;
};

export function enforceProviderPolicy(
  policy: ProviderPolicy,
  appConfig: AppConfig = config
): ProviderResolution {
  const resolved: ProviderResolution = {
    ...policy,
    status: policy.enabled ? "enabled" : "disabled",
    reason: policy.enabled ? undefined : "provider_disabled_by_configuration"
  };

  if (appConfig.noPaidDataApi && policy.paid) {
    return disable(resolved, "paid_provider_blocked_by_NO_PAID_DATA_API");
  }

  if (appConfig.disablePaidMarketData && policy.category === "market" && policy.paid) {
    return disable(resolved, "paid_market_data_blocked");
  }

  if (appConfig.noPaidDataApi && !policy.allowedWhenNoPaidApi) {
    return disable(resolved, "provider_not_allowed_when_no_paid_api");
  }

  if (policy.requiresLogin && !policy.userAuthorized) {
    return disable(resolved, "login_required_but_user_not_authorized");
  }

  if (policy.requiresPermission && !policy.permissionConfirmed) {
    return disable(resolved, "permission_or_paid_data_required");
  }

  if (
    appConfig.disableNewsScraping &&
    policy.category === "news" &&
    policy.mode === "automatic" &&
    policy.licenseStatus !== "official_public"
  ) {
    return disable(resolved, "automatic_news_scraping_disabled");
  }

  if (policy.mode === "disabled") {
    return disable(resolved, "provider_mode_disabled");
  }

  return {
    ...resolved,
    enabled: true,
    status: "enabled",
    reason: undefined
  };
}

export function assertProviderAllowed(policy: ProviderPolicy, appConfig: AppConfig = config): ProviderResolution {
  const resolved = enforceProviderPolicy(policy, appConfig);
  if (resolved.status === "disabled") {
    throw new Error(`${policy.name} disabled: ${resolved.reason}`);
  }
  return resolved;
}

export function defaultProviderPolicies(appConfig: AppConfig = config): ProviderPolicy[] {
  return [
    {
      name: "jin10-manual",
      category: "news",
      enabled: appConfig.enableJin10Manual,
      paid: false,
      requiresLogin: false,
      requiresPermission: false,
      termsChecked: true,
      licenseStatus: "user_provided",
      allowedWhenNoPaidApi: true,
      mode: appConfig.enableJin10Manual ? "manual" : "disabled",
      note: "Only accepts user-provided LINE/manual/CSV content. No paid API or member scraping."
    },
    {
      name: "wallstreetcn-manual",
      category: "news",
      enabled: appConfig.enableWallStreetCnManual,
      paid: false,
      requiresLogin: false,
      requiresPermission: false,
      termsChecked: true,
      licenseStatus: "user_provided",
      allowedWhenNoPaidApi: true,
      mode: appConfig.enableWallStreetCnManual ? "manual" : "disabled",
      note: "Only accepts user-provided LINE/manual/CSV content. VIP/member content is not crawled."
    },
    {
      name: "futu-news-manual",
      category: "news",
      enabled: appConfig.enableFutuNewsManual,
      paid: false,
      requiresLogin: false,
      requiresPermission: false,
      termsChecked: true,
      licenseStatus: "user_provided",
      allowedWhenNoPaidApi: true,
      mode: appConfig.enableFutuNewsManual ? "manual" : "disabled",
      note: "Only accepts LINE/manual Futu news snippets unless free permission is proven."
    },
    {
      name: "twse-public",
      category: "market",
      enabled: appConfig.enableTwsePublic,
      paid: false,
      requiresLogin: false,
      requiresPermission: false,
      termsChecked: true,
      licenseStatus: "official_public",
      allowedWhenNoPaidApi: true,
      mode: appConfig.enableTwsePublic ? "automatic" : "disabled"
    },
    {
      name: "tpex-public",
      category: "market",
      enabled: appConfig.enableTpexPublic,
      paid: false,
      requiresLogin: false,
      requiresPermission: false,
      termsChecked: true,
      licenseStatus: "official_public",
      allowedWhenNoPaidApi: true,
      mode: appConfig.enableTpexPublic ? "automatic" : "disabled"
    },
    {
      name: "mops-public",
      category: "market",
      enabled: appConfig.enableMopsPublic,
      paid: false,
      requiresLogin: false,
      requiresPermission: false,
      termsChecked: true,
      licenseStatus: "official_public",
      allowedWhenNoPaidApi: true,
      mode: appConfig.enableMopsPublic ? "automatic" : "disabled"
    },
    {
      name: "futu-market",
      category: "market",
      enabled: appConfig.enableFutu && appConfig.futuPermissionConfirmed,
      paid: false,
      requiresLogin: true,
      requiresPermission: true,
      termsChecked: true,
      licenseStatus: "licensed",
      allowedWhenNoPaidApi: true,
      userAuthorized: appConfig.enableFutu,
      permissionConfirmed: appConfig.futuPermissionConfirmed,
      mode: appConfig.enableFutu && appConfig.futuPermissionConfirmed ? "automatic" : "disabled",
      note: "Never buys quote cards and never enables trading. Permission failures become data_unavailable_due_to_permission."
    },
    {
      name: "rss-public",
      category: "news",
      enabled: appConfig.enableRssPublic,
      paid: false,
      requiresLogin: false,
      requiresPermission: false,
      termsChecked: appConfig.enableRssPublic,
      licenseStatus: appConfig.enableRssPublic ? "free_public" : "unknown",
      allowedWhenNoPaidApi: true,
      mode: appConfig.enableRssPublic ? "automatic" : "disabled",
      note: "Use only explicitly free public RSS feeds with acceptable terms."
    }
  ];
}

function disable(policy: ProviderResolution, reason: string): ProviderResolution {
  return {
    ...policy,
    enabled: false,
    status: "disabled",
    mode: "disabled",
    reason
  };
}
