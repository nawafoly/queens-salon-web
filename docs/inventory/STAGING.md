# MALIKAT Inventory — isolated staging for PR #286

Status: resources allocated; remote Core code, D1 migrations, Firebase test authentication and Vercel preview wiring are **not yet active**.

## Resource fence

| Purpose | Staging-only resource |
| --- | --- |
| Worker | `malikat-staging-core-api` (`malikat-staging-core-api.maedin.workers.dev`) |
| Core D1 | `malikat-staging-core` (`3ffae051-12d6-4cce-a992-5e39245b80a3`) |
| Attendance D1 | `malikat-staging-attendance` (`a4bf6f14-2fc9-4796-96c9-c16e48440a55`) |
| R2 | `malikat-staging-files` |
| Tenant | `staging` |
| Worker config | `wrangler.core.staging.jsonc` (no cron triggers) |
| Synthetic fixture | `scripts/fixtures/staging-inventory-demo.sql` |

Never run the staging fixture against production `queens-salon-core` or deploy the production `wrangler.core.jsonc` when working on staging. The current staging Worker created through the Cloudflare UI still contains its initial placeholder code.

## Local verification (safe)

The staging fixture was tested against a fresh local D1 with all 104 existing Core migrations. It creates synthetic catalog, staff, service, booking, recipe and movement data, including two products in one CATEGORY recipe, one unknown-cost material, and each of `WASTE_OUT`, `DAMAGED_OUT`, `EXPIRED_OUT`. No real clients, employees, passwords, or production data are copied.

```bash
node scripts/staging-inventory-ops.mjs check
node --test workers/staging-inventory-isolation.test.mjs workers/inventory-integration-282-285.test.mjs
npx wrangler deploy --config wrangler.core.staging.jsonc --dry-run
```

## Remote activation order (not completed)

1. Authenticate **Wrangler** with limited access to the new staging resources. Do not use a broad account token if a scoped token is possible.
2. Create/configure a **separate Firebase Auth test project** (enable email/password, test-only accounts). Put its project ID into the staging Worker and its public Firebase web configuration into the **PR branch-scoped** Vercel preview variables. Never reuse the production Firebase project `waves-hotel-dashboard` for this step.
3. Confirm the code and D1 bindings from `wrangler.core.staging.jsonc` point only to staging resources. With authenticated Wrangler:

   ```bash
   node scripts/staging-inventory-ops.mjs migrate --apply
   node scripts/staging-inventory-ops.mjs seed --apply
   node scripts/staging-inventory-ops.mjs deploy --apply
   ```

   `FIREBASE_PROJECT_ID` must be set to the isolated test project's ID in the staging Worker after deployment if it is not supplied by an explicitly staging-only config. The Core auth endpoints fail closed without it.
4. Provision test accounts in staging D1 with `salon_id='staging'` and Firebase UIDs from the test Auth project; do not grant real production accounts access. Role metadata and grants for the `staging` tenant are provided by the synthetic fixture.
5. On both Vercel projects, scope `VITE_CORE_WORKER_URL=https://malikat-staging-core-api.maedin.workers.dev` and the test Firebase `VITE_FIREBASE_*` values **only** to Git branch `feat/inventory-integration-282-285` under Preview. Rebuild the PR preview after changing build-time variables. The current previews still point to production Core; do not rewire until staging Core works.
6. Check CORS preflight against the exact PR preview origins, sign-in, inventory tab and cost report on desktop, mobile and iPad; verify no stock deduction occurs when creating a booking and that a confirmed consumption creates precisely the expected ledger lines.

Vercel Preview deployment protection (SSO) is separate from Core CORS and Firebase login. Keep previews protected; log in to Vercel or use an approved protected-deployment access method for visual testing rather than relaxing production security.

PR #286 remains a draft. This workflow does not merge `main`, deploy the production Worker, or modify production D1/R2.
