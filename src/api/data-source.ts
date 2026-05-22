import express from "express";
import { defaultProviderPolicies, enforceProviderPolicy } from "../cost/provider-policy.js";
import { db } from "../db/client.js";

export function createDataSourceRouter() {
  const router = express.Router();
  router.get("/", async (_req, res) => {
    const configured = defaultProviderPolicies().map((policy) => enforceProviderPolicy(policy));
    res.json({ configured });
  });
  router.post("/sync-policy", async (_req, res) => {
    const policies = defaultProviderPolicies().map((policy) => enforceProviderPolicy(policy));
    for (const policy of policies) {
      await db.query(
        `insert into data_sources (name, provider_type, enabled, paid, requires_login, requires_permission, terms_checked, license_status, note)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (name) do update set enabled = excluded.enabled, paid = excluded.paid, requires_login = excluded.requires_login,
           requires_permission = excluded.requires_permission, terms_checked = excluded.terms_checked, license_status = excluded.license_status, note = excluded.note`,
        [
          policy.name,
          policy.category,
          policy.enabled,
          policy.paid,
          policy.requiresLogin,
          policy.requiresPermission,
          policy.termsChecked,
          policy.licenseStatus,
          policy.reason ?? policy.note
        ]
      );
    }
    res.json({ ok: true, count: policies.length });
  });
  return router;
}
