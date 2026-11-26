import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare } from "miniflare";

import worker from "./core/index.js";

import {
  applyCoreTestMigrations,
} from "./test-support/miniflare-core-migrations.mjs";

test("HR05J: attendance policy HTTP lifecycle and authorization", async t => {
  const mf = new Miniflare({
    workers: [{
      config: {
        name: "core-policy-http-test",
        compatibilityDate: "2026-06-24",
        manifest: {
          mainModule: "script-0.mjs",
          modulesRoot: process.cwd(),
          modules: {
            "script-0.mjs": {
              type: "esm",
              contents: 'export default { fetch() { return new Response("ok"); } }',
            },
          },
        },
        env: {
          CORE_DB: {
            type: "d1",
            id: "core-policy-http-test",
          },
        },
        exports: {},
      },
      dev: {
        rootPath: process.cwd(),
      },
    }],
  });

  t.after(() => mf.dispose());

  const db = await mf.getD1Database("CORE_DB");

  await applyCoreTestMigrations(db);

  const now = "2026-01-01T00:00:00.000Z";
  const employeeId = "policy-http-employee";

  await db.prepare(`
    INSERT INTO app_users (
      id, firebase_uid, salon_id, email,
      display_name, primary_role, status,
      email_verified, created_at, updated_at
    ) VALUES
      (?, ?, 'main', ?, ?, ?, 'active', 1, ?, ?)
  `).bind(
    "policy-owner",
    "policy-owner-uid",
    "owner@example.test",
    "Policy Owner",
    "owner",
    now,
    now
  ).run();

  await db.prepare(`
    INSERT INTO app_users (
      id, firebase_uid, salon_id, email,
      display_name, primary_role, status,
      email_verified, created_at, updated_at
    ) VALUES
      (?, ?, 'main', ?, ?, ?, 'active', 1, ?, ?)
  `).bind(
    "policy-staff",
    "policy-staff-uid",
    "staff@example.test",
    "Policy Staff",
    "staff",
    now,
    now
  ).run();

  await db.prepare(`
    INSERT INTO employee_profiles (
      id, salon_id, name, status,
      created_at, updated_at
    )
    VALUES (?, 'main', 'Policy Test Employee', 'active', ?, ?)
  `).bind(employeeId, now, now).run();

  await db.prepare(`
    INSERT INTO employee_employment (
      salon_id, employee_id,
      employment_status,
      attendance_payroll_mode,
      created_at, updated_at
    )
    VALUES ('main', ?, 'active', 'required', ?, ?)
  `).bind(employeeId, now, now).run();

  const env = {
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
    SALON_ID: "main",
    CORE_DB: db,
  };

  const endpoint =
    `/api/core/hr/employees/${employeeId}/attendance-policy`;

  async function call(
    path,
    {
      method = "GET",
      body,
      uid = "policy-owner-uid",
      role = "owner",
      expected = 200,
    } = {}
  ) {
    const response = await worker.fetch(
      new Request(`http://core.test${path}`, {
        method,
        headers: {
          Authorization: `Bearer test:${uid}:${role}`,
          "Content-Type": "application/json",
        },
        ...(body !== undefined
          ? { body: JSON.stringify(body) }
          : {}),
      }),
      env
    );

    const result = await response.json();

    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${JSON.stringify(result)}`
    );

    return result.data;
  }

  const readState = () =>
    call(
      endpoint +
      "?dateFrom=2026-11-14&dateTo=2026-11-26"
    );

  const modeAt = (state, date) =>
    state.snapshot.days.find(day => day.date === date)?.mode;

  // Initial canonical policy.
  const before = await readState();

  assert.equal(before.employeeId, employeeId);
  assert.equal(modeAt(before, "2026-11-15"), "required");

  // Unauthorized account cannot read or mutate policy.
  await call(endpoint, {
    uid: "policy-staff-uid",
    role: "staff",
    expected: 403,
  });

  const input = {
    mode: "exempt",
    effectiveFrom: "2026-11-15",
    effectiveTo: "2026-11-25",
    reason: "Synthetic HTTP exemption test",
  };

  await call(endpoint, {
    method: "POST",
    uid: "policy-staff-uid",
    role: "staff",
    body: input,
    expected: 403,
  });

  // Retroactive exemption creation.
  const created = await call(endpoint, {
    method: "POST",
    body: input,
  });

  assert.ok(created.id);

  const active = await readState();

  assert.equal(active.authority, "effective_dated");
  assert.ok(active.revision > before.revision);
  assert.equal(modeAt(active, "2026-11-14"), "required");
  assert.equal(modeAt(active, "2026-11-15"), "exempt");
  assert.equal(modeAt(active, "2026-11-25"), "exempt");
  assert.equal(modeAt(active, "2026-11-26"), "required");

  const periodEndpoint =
    `${endpoint}/${encodeURIComponent(created.id)}`;

  // End exemption while preserving historical coverage.
  const updated = await call(periodEndpoint, {
    method: "PATCH",
    body: {
      version: created.version,
      effectiveTo: "2026-11-20",
    },
  });

  const ended = await readState();

  assert.ok(ended.revision > active.revision);
  assert.equal(modeAt(ended, "2026-11-20"), "exempt");
  assert.equal(modeAt(ended, "2026-11-21"), "required");

  // DELETE must preserve version and cancellation reason.
  await call(periodEndpoint, {
    method: "DELETE",
    body: {
      version: updated.version,
      reason: "Synthetic HTTP cancellation",
    },
  });

  const cancelled = await readState();

  assert.ok(cancelled.revision > ended.revision);

  assert.ok(
    cancelled.snapshot.days.every(
      day => day.mode === "required"
    )
  );

  assert.ok(
    cancelled.periods.some(
      period =>
        period.id === created.id &&
        period.status === "cancelled"
    )
  );

  console.log("HR05J_HTTP_LIFECYCLE_VERIFIED");
});
