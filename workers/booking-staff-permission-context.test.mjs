import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/DashboardBookings.tsx", "utf8");
const core = readFileSync("workers/core/index.js", "utf8");

test("booking item staff action uses the canonical permission context role", () => {
  assert.match(page, /const \{ role: permissionRole, hasPermission \} = usePermissions\(\)/);
  assert.match(page, /canCorrect=\{\(permissionRole === "owner" \|\| permissionRole === "admin"\) && hasPermission\("bookings.update"\) && hasPermission\("employees.manage"\)\}/);
  assert.doesNotMatch(page, /canCorrect=\{\(role === "owner" \|\| role === "admin"\)/);
});

test("Core retains owner-admin and both permission checks", () => {
  assert.match(core, /ctx\.role !== "owner" && ctx\.role !== "admin"/);
  assert.match(core, /requirePermission\(ctx, "bookings.update"\)/);
  assert.match(core, /requirePermission\(ctx, "employees.manage"\)/);
});
