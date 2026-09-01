import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("configured Core tenant cannot be overridden by request data", () => {
  const index = read("workers/core/index.js");

  assert.match(index, /CORE_TENANT_AUTHORITY_V1/);
  assert.match(index, /configuredSalonId/);
  assert.match(index, /requestedSalonId/);
  assert.match(index, /requestedSalonId !== configuredSalonId/);
  assert.match(index, /core_auth:tenant_mismatch/);

  const actorStart = index.indexOf("async function actor(");
  const actorEnd = index.indexOf("function match(", actorStart);
  assert.ok(actorStart >= 0 && actorEnd > actorStart);

  const actor = index.slice(actorStart, actorEnd);
  assert.match(actor, /const sid = salonId\(data \|\| \{\}, env\)/);
  assert.match(actor, /getAuthContext\(request, env, \{/);
  assert.match(actor, /salonId: sid/);
});

test("authenticated account and employee-link authority stays tenant scoped", () => {
  const auth = read("workers/core/auth-context.js");
  const identity = read("workers/core/account-identity.js");

  assert.match(auth, /AUTH_CONTEXT_TENANT_FENCE_V1/);
  assert.match(auth, /resolveAccountForVerifiedIdentity\(/);
  assert.match(identity, /getAccountByFirebaseUid\(db, salonId, uid\)/);
  assert.match(identity, /WHERE salon_id = \?/);
  assert.match(identity, /\[salonId, email\]/);
  assert.match(identity, /WHERE salon_id = \?\s*\n\s*AND id = \?/);
  assert.match(auth, /getEffectivePermissions\(db, salonId, account\)/);
  assert.match(auth, /getActiveEmployeeLink\(db, salonId, account\.id\)/);
  assert.match(auth, /salonId,/);
});

test("employee offboarding requires reason/date and records an auditable lifecycle operation", () => {
  const offboarding = read("workers/core/repositories/employee-offboarding.js");

  assert.match(offboarding, /requiredOffboardingReason/);
  assert.match(offboarding, /offboarding_reason_required/);
  assert.match(offboarding, /requiredOffboardingEndDate/);
  assert.match(offboarding, /offboarding_end_date_required/);
  assert.match(offboarding, /auditInsertStatement/);
  assert.match(offboarding, /employeeOffboardingAccountDisableStatement/);
  assert.match(offboarding, /offboarding_privileged_account_requires_manual_review/);
  assert.match(offboarding, /offboarding_future_bookings_require_reassignment/);
  assert.match(offboarding, /employee_offboarding_fences/);

  const tenantScopedQueries = offboarding.match(/salon_id\s*=\s*\?/g) || [];
  assert.ok(
    tenantScopedQueries.length >= 8,
    "offboarding lifecycle must keep all critical reads/writes tenant scoped"
  );
});

test("offboarding route is authorization-gated before destructive Core mutation", () => {
  const index = read("workers/core/index.js");

  const callIndex = index.indexOf("offboardHrEmployee(");
  assert.ok(callIndex >= 0, "offboard Core route must exist");

  const prelude = index.slice(Math.max(0, callIndex - 1800), callIndex);
  assert.match(
    prelude,
    /requirePermission\(|requireAnyPermission\(|requireRole\(/,
    "offboarding must be protected by Core authorization before mutation"
  );
});

test("Employee Workspace keeps termination separate from ordinary save", () => {
  const profile = read(
    "src/pages/dashboardEmployees/EmployeeProfilePageLayout.tsx"
  );
  const guard = read("workers/employee-workspace-dsv2-ux-guard.test.mjs");

  assert.match(profile, /dsv2-btn--danger/);
  assert.match(profile, /onClick=\{props\.onDelete\}/);
  assert.doesNotMatch(
    profile.slice(
      profile.indexOf("employees-v2-profile-savebar"),
      profile.indexOf("const savebarPortal")
    ),
    /props\.onDelete/
  );
  assert.match(guard, /employee offboarding is independent from save actions/);
});

test("client exposes explicit tenant-boundary errors instead of generic validation", () => {
  const client = read("src/services/coreApiClient.ts");
  assert.match(client, /core_auth:tenant_mismatch/);
  assert.match(client, /core_auth:tenant_context_required/);
});
