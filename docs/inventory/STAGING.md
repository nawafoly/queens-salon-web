# MALIKAT Inventory — isolated staging for PR #286

Status (2026-11-04): isolated Core Worker, Core D1 and Firebase Auth are active. Both Git branch-scoped Vercel Preview deployments rebuilt successfully at commit `a05acc9deec9d563ce87a4d28ec7524ef23de1bb`. Authenticated Inventory visual QA and final CI review remain necessary. This is **not production approval**.

## Stable PR #286 preview links

Use these **branch aliases**, which remain stable across commits and are explicitly allowlisted by staging Core CORS and test Firebase Auth:

- Primary: https://queens-salon-web-git-feat-inven-b73c85-nawafs-projects-05f9ecad.vercel.app/hr
- Secondary: https://queens-salon-web-gnxk-git-feat-3c418c-nawafs-projects-05f9ecad.vercel.app/hr

Avoid using the generated immutable Vercel deployment hostnames (`queens-salon-<build-id>-...` and `queens-salon-web-gnxk-<build-id>-...`) for browser QA. They are not on the exact staging CORS or Firebase authorized-domain allowlists, and may show a false-negative Core connection error. Do **not** relax CORS to a wildcard to make those hosts pass. Both stable aliases opened successfully on 2026-11-04 without new browser console errors; the authenticated inventory page is still awaiting a browser sign-in test.

## Resource fence

| Purpose | Staging-only resource |
| --- | --- |
| Worker | `malikat-staging-core-api` (`malikat-staging-core-api.maedin.workers.dev`) |
| Core D1 | `malikat-staging-core` (`3ffae051-12d6-4cce-a992-5e39245b80a3`) |
| Attendance D1 | `malikat-staging-attendance` (`a4bf6f14-2fc9-4796-96c9-c16e48440a55`) |
| R2 | `malikat-staging-files` |
| Tenant | `staging` |
| Firebase Auth | `malikat-staging-tests-2026` (Spark/free plan, Analytics off) |
| Worker config | `wrangler.core.staging.jsonc` (no cron triggers) |
| Synthetic fixture | `scripts/fixtures/staging-inventory-demo.sql` |
| Synthetic QA account seed | `scripts/fixtures/staging-auth-qa.sql` (UID only, **no password**) |

Never run staging fixtures against production `queens-salon-core` or deploy `wrangler.core.jsonc` during staging work. No production D1, Worker or R2 data was used.

## Local verification (safe)

The staging fixture was tested against a fresh local D1 with all 104 existing Core migrations. It creates synthetic catalog, staff, service, booking, recipe and movement data, including two products in one CATEGORY recipe, one unknown-cost material, and each of `WASTE_OUT`, `DAMAGED_OUT`, `EXPIRED_OUT`. No real clients, employees, passwords, or production data are copied.

```bash
node scripts/staging-inventory-ops.mjs check
node --test workers/staging-inventory-isolation.test.mjs workers/inventory-integration-282-285.test.mjs
npx wrangler deploy --config wrangler.core.staging.jsonc --dry-run
```

## Activation completed on 2026-11-04

- Applied **104 Core migrations** to isolated D1 `malikat-staging-core`.
- Seeded 8 synthetic inventory items and 15 ledger movements, including mixed-category consumption and waste/damage/expiry. Read-only remote reconciliation returned `items=8`, `movements=15`, `migrations=104`.
- Published the bundled Core ES module to `malikat-staging-core-api` using Cloudflare's official Worker Script Upload API. Wrangler's normal deploy was blocked by a metadata `403` under the Worker-scoped token, so the upload used the same staging-only bindings with exact metadata. Deployment ID: `4c070a67235a44c487a90e4de5ac53aa`.
- Created separate Firebase project and Web app; enabled Email/Password. Registered the four PR preview hostnames as authorized domains; did not enable Firebase Hosting, Google Analytics or a paid plan.
- Created **one synthetic QA user** `qa-inventory-pr286@malikat.test` and seeded its Firebase UID, `staging` account and employee link. Store/share its password separately; it must never enter Git.
- Smoke-tested Firebase sign-in (successful) and `GET /api/auth/me` against staging Core (HTTP 200 with `inventory.*` grants). Unauthenticated call returned 401. Preview-origin CORS preflight returned 204 with the matching allow-origin; the production web origin did **not** receive allow-origin.
- Set Preview environment variables scoped only to branch `feat/inventory-integration-282-285` in both Vercel projects, including Core, Firebase, and fail-closed attendance/partners URLs. Generic Preview and Production settings are unchanged.
- The temporary **account-wide D1 Write token was deleted** after seeding and tests. A separate Worker-only token expires November 11, 2026.

## Reproduction / future changes

1. Confirm the staging Worker name, D1 database IDs, R2 bucket, exact CORS list and Firebase project in `wrangler.core.staging.jsonc`.
2. For a **fresh empty staging database only**, use a temporary explicitly authorized D1 Write token (delete immediately after use):

   ```bash
   node scripts/staging-inventory-ops.mjs migrate --apply
   node scripts/staging-inventory-ops.mjs seed --apply
   node scripts/staging-inventory-ops.mjs seed-auth --apply
   ```

   Verify Firebase test UID matches the synthetic fixture before running `seed-auth`. The script refuses any other Firebase project.
3. For future Worker code changes, try `node scripts/staging-inventory-ops.mjs deploy --apply` with a Worker-scoped token. If Cloudflare again rejects Wrangler's metadata reads, the Worker Script Upload API supports ES-module multipart upload; validate bundled script and each D1/R2/text binding against the staging config before uploading. Never broaden token access solely to bypass a Wrangler metadata preflight.
4. Rebuild **only** PR #286 Preview after branch-scoped variables change.

## Remaining acceptance checks

- Branch-only Vercel settings were read back in both projects, confirming `VITE_CORE_WORKER_URL` and `VITE_FIREBASE_PROJECT_ID` point to staging. Both deployments finished `READY`; verify the actual compiled bundle when authenticated testing becomes available.
- Sign in with the test-only QA account and inspect the Inventory dashboard on desktop, mobile and iPad, including the cost report, category mixing, staff stock location and all three disposal reasons.
- Exercise mutation paths on **synthetic records only** and reconcile `inventory_stock_movements` with `inventory_stock_levels`; confirm an unfinished booking does not deduct inventory.
- Review CI and merge readiness separately. PR #286 stays a draft until reviewed; do not merge the four original PRs separately.

Vercel Preview deployment protection (SSO) is separate from Core CORS and Firebase login. Keep previews protected; log in to Vercel or use an approved protected-deployment access method for visual testing rather than relaxing production security.

PR #286 remains a draft. This workflow does not merge `main`, deploy the production Worker, or modify production D1/R2.
