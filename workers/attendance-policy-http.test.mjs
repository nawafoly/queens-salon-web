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

  const selfEndpoint =
    "/api/core/hr/employee-portal/attendance-policy";

  const selfRange =
    "?dateFrom=2026-11-14&dateTo=2026-11-26";

  const staffOptions = {
    uid: "policy-staff-uid",
    role: "staff"
  };

  // An unlinked account cannot access an employee policy.
  await call(selfEndpoint + selfRange, {
    ...staffOptions,
    expected: 403
  });

  // Link the existing staff account through the canonical API.
  await call(
    "/api/admin/accounts/policy-staff/employee-link",
    {
      method: "PUT",
      body: { employeeId }
    }
  );

  const ownAbsences = await call(
    "/api/core/hr/employee-portal/absences",
    staffOptions
  );

  assert.ok(
    Array.isArray(ownAbsences),
    "Existing absence endpoint must return absence rows"
  );

  await call(
    "/api/core/hr/employee-portal/absences?employeeId=another-employee",
    {
      ...staffOptions,
      expected: 403
    }
  );

  console.log("PASS: existing absence route remains independent");

  const ownPolicy = await call(
    selfEndpoint + selfRange,
    staffOptions
  );

  assert.equal(ownPolicy.employeeId, employeeId);
  assert.equal(ownPolicy.revision, active.revision);
  assert.equal(ownPolicy.dateFrom, "2026-11-14");
  assert.equal(ownPolicy.dateTo, "2026-11-26");
  assert.equal(ownPolicy.days.length, 13);

  assert.deepEqual(
    ownPolicy.days,
    active.snapshot.days.map(day => ({
      date: day.date,
      mode: day.mode
    }))
  );

  assert.deepEqual(
    Object.keys(ownPolicy).sort(),
    [
      "employeeId",
      "revision",
      "dateFrom",
      "dateTo",
      "days"
    ].sort()
  );

  for (const day of ownPolicy.days) {
    assert.deepEqual(
      Object.keys(day).sort(),
      ["date", "mode"]
    );
  }

  console.log("PASS: own policy matches canonical admin policy");
  console.log("PASS: administrative reasons and history are not exposed");

  for (const parameter of [
    "&employeeId=another-employee",
    "&employee_id=another-employee",
    `&employeeId=${employeeId}&employee_id=another-employee`
  ]) {
    await call(
      selfEndpoint + selfRange + parameter,
      {
        ...staffOptions,
        expected: 403
      }
    );
  }

  console.log("PASS: cross-employee access rejected");

  for (const invalidRange of [
    "",
    "?dateFrom=2026-11-14",
    "?dateFrom=2026-02-30&dateTo=2026-03-01",
    "?dateFrom=2026-11-26&dateTo=2026-11-14",
    "?dateFrom=2026-01-01&dateTo=2026-04-01"
  ]) {
    await call(
      selfEndpoint + invalidRange,
      {
        ...staffOptions,
        expected: 400
      }
    );
  }

  console.log("PASS: invalid and oversized ranges rejected");

  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const response = await worker.fetch(
      new Request(
        `http://core.test${selfEndpoint}${selfRange}`,
        {
          method,
          headers: {
            Authorization: "Bearer test:policy-staff-uid:staff",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            mode: "required",
            reason: "Unauthorized mutation test"
          })
        }
      ),
      env
    );

    assert.ok(
      [403, 404, 405].includes(response.status),
      `${method}: unexpected status ${response.status}`
    );
  }

  const afterUnauthorizedWrites = await readState();

  assert.equal(
    afterUnauthorizedWrites.revision,
    active.revision
  );

  assert.deepEqual(
    afterUnauthorizedWrites.snapshot,
    active.snapshot
  );

  console.log("PASS: self-service mutation attempts leave policy unchanged");

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

  const ownCancelled = await call(
    selfEndpoint + selfRange,
    staffOptions
  );

  assert.equal(
    ownCancelled.revision,
    cancelled.revision
  );

  assert.ok(
    ownCancelled.days.every(
      day => day.mode === "required"
    )
  );

  console.log("PASS: self-service reflects cancelled exemption");
  console.log("HR05J_HTTP_LIFECYCLE_VERIFIED");
  console.log("HR07C_SELF_SERVICE_HTTP_VERIFIED");
});
