import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare } from "miniflare";
import coreWorker from "./core/index.js";
import { decideLeave } from "./core/repositories/leaves.js";

import {
  applyCoreTestMigrations,
} from "./test-support/miniflare-core-migrations.mjs";

import {
  registerAdminDirectLeave,
} from "./core/repositories/admin-direct-leaves.js";

test("HR06G: real D1 administrative leave registration", async t => {
  const mf = new Miniflare({
    workers: [{
      config: {
        name: "admin-direct-leave-test",
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
            id: "admin-direct-leave-test",
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

  const owner = {
    userId: "leave-final-owner",
    uid: "leave-final-owner-uid",
    email: "owner@example.test",
    name: "Final Approver",
    role: "owner",
    employeeId: "owner-employee",
  };

  for (const [id, uid, email] of [
    [
      owner.userId,
      owner.uid,
      owner.email,
    ],
    [
      "another-owner",
      "another-owner-uid",
      "another@example.test",
    ],
  ]) {
    await db.prepare(`
      INSERT INTO app_users (
        id, firebase_uid, salon_id,
        email, display_name, primary_role,
        status, email_verified,
        created_at, updated_at
      )
      VALUES (
        ?, ?, 'main', ?, 'Test Owner',
        'owner', 'active', 1, ?, ?
      )
    `).bind(id, uid, email, now, now).run();
  }

  await db.prepare(`
    INSERT INTO approval_authorities (
      salon_id,
      authority_key,
      approver_user_id,
      assigned_by_user_id,
      assigned_at,
      updated_at
    )
    VALUES (
      'main',
      'hr.leave.final',
      ?,
      'another-owner',
      ?,
      ?
    )
  `).bind(owner.userId, now, now).run();

  for (const [id, uid] of [
    ["employee-1", "employee-1-uid"],
    ["employee-2", null],
    ["owner-employee", owner.uid],
  ]) {
    await db.prepare(`
      INSERT INTO employee_profiles (
        id, salon_id, name, firebase_uid,
        status, created_at, updated_at
      )
      VALUES (
        ?, 'main', ?, ?, 'active', ?, ?
      )
    `).bind(id, id, uid, now, now).run();

    await db.prepare(`
      INSERT INTO employee_employment (
        salon_id,
        employee_id,
        employment_status,
        start_date,
        leave_balance,
        created_at,
        updated_at
      )
      VALUES (
        'main', ?, 'active',
        '2025-01-01', 10, ?, ?
      )
    `).bind(id, now, now).run();
  }

  const input = {
    operationId: "direct-operation-1",
    employeeId: "employee-1",
    leaveType: "other",
    startDate: "2026-11-06",
    endDate: "2026-11-06",
    durationKind: "full_day",
    reason: "Administrative leave registration",
    manualLeavePolicy: {
      deductFromBalance: false,
      affectsPayroll: false,
    },
  };

  const register = (data = input, actor = owner) =>
    registerAdminDirectLeave(
      db,
      "main",
      data,
      actor
    );

  const leaveCount = async () => {
    const row = await db.prepare(`
      SELECT COUNT(*) AS count
      FROM employee_leaves
      WHERE salon_id = 'main'
    `).first();

    return Number(row.count);
  };

  // Unauthorized owner.
  await assert.rejects(
    () => register(input, {
      ...owner,
      userId: "another-owner",
      uid: "another-owner-uid",
      employeeId: "",
    }),
    /final_approver_required/
  );

  assert.equal(await leaveCount(), 0);
  console.log("PASS: final approval authority");

  // Self-approval.
  await assert.rejects(
    () => register({
      ...input,
      employeeId: "owner-employee",
    }),
    /self_approval_forbidden/
  );

  assert.equal(await leaveCount(), 0);
  console.log("PASS: self-approval forbidden");

  // Missing explicit manual policy.
  await assert.rejects(
    () => register({
      ...input,
      manualLeavePolicy: undefined,
    }),
    /explicit_manual_policy_required/
  );

  assert.equal(await leaveCount(), 0);
  console.log("PASS: explicit policy required");

  // Administrative registration.
  const approved = await register();

  assert.equal(approved.status, "approved");

  const row = await db.prepare(`
    SELECT *
    FROM employee_leaves
    WHERE id = ?
  `).bind(approved.id).first();

  assert.equal(row.registration_source, "admin_direct");
  assert.equal(row.registered_by_uid, owner.uid);
  assert.equal(row.employee_id, "employee-1");
  assert.equal(row.employee_uid, "employee-1-uid");
  assert.equal(row.request_id, null);
  assert.equal(row.decided_by_uid, owner.uid);
  assert.equal(row.legal_basis, "HR_MANUAL_POLICY");
  assert.equal(Number(row.deduct_from_balance), 0);
  assert.equal(Number(row.affects_payroll), 0);

  console.log("PASS: approved administrative leave");

  // Same operation must not create another leave.
  const replay = await register();

  assert.equal(replay.id, approved.id);
  assert.equal(await leaveCount(), 1);

  console.log("PASS: idempotent replay");

  // Same operation with modified financial policy.
  await assert.rejects(
    () => register({
      ...input,
      manualLeavePolicy: {
        deductFromBalance: true,
        affectsPayroll: false,
      },
    }),
    /registration_operation_conflict/
  );

  assert.equal(await leaveCount(), 1);
  console.log("PASS: financial policy replay conflict");

  // New operation, overlapping date.
  await assert.rejects(
    () => register({
      ...input,
      operationId: "direct-operation-overlap",
    }),
    /admin_direct_overlap/
  );

  assert.equal(await leaveCount(), 1);
  console.log("PASS: overlap blocked");

  // Employee with no Firebase account.
  const unlinked = await register({
    ...input,
    operationId: "direct-operation-2",
    employeeId: "employee-2",
  });

  const unlinkedRow = await db.prepare(`
    SELECT employee_uid, registered_by_uid
    FROM employee_leaves
    WHERE id = ?
  `).bind(unlinked.id).first();

  assert.equal(unlinkedRow.employee_uid, null);
  assert.equal(unlinkedRow.registered_by_uid, owner.uid);

  console.log("PASS: employee identity without Firebase");

  // Non-deducting leave preserves the balance.
  const employment = await db.prepare(`
    SELECT leave_balance
    FROM employee_employment
    WHERE salon_id = 'main'
      AND employee_id = 'employee-1'
  `).first();

  assert.equal(Number(employment.leave_balance), 10);

  console.log("PASS: leave balance preserved");

  // Direct SQL must not bypass overlap protection.
  await assert.rejects(
    () => db.prepare(`
      INSERT INTO employee_leaves (
        id, salon_id, employee_id,
        status, leave_type,
        start_date, end_date,
        days_count, duration_kind,
        created_at, updated_at
      )
      VALUES (
        'overlap-bypass',
        'main',
        'employee-1',
        'pending',
        'unpaid',
        '2026-11-06',
        '2026-11-06',
        1,
        'full_day',
        ?,
        ?
      )
    `).bind(now, now).run(),
    /admin_direct_leave_overlap/
  );

  console.log("PASS: SQL overlap guard");

  assert.equal(await leaveCount(), 2);

  console.log("HR06G_DIRECT_LEAVE_RUNTIME_VERIFIED");

  const readBalance = async () => {
    const row = await db.prepare(`
      SELECT leave_balance
      FROM employee_employment
      WHERE salon_id = 'main'
        AND employee_id = 'employee-1'
    `).first();

    return Number(row.leave_balance);
  };

  const readLedger = async leaveId => {
    const result = await db.prepare(`
      SELECT *
      FROM employee_leave_balance_ledger
      WHERE salon_id = 'main'
        AND employee_id = 'employee-1'
        AND source_type = 'leave_request'
        AND source_id = ?
    `).bind(leaveId).all();

    return result.results;
  };

  for (const [
    index,
    deductFromBalance,
    affectsPayroll,
  ] of [
    [1, false, false],
    [2, true, false],
    [3, false, true],
    [4, true, true],
  ]) {
    const date =
      `2026-11-${String(10 + index).padStart(2, "0")}`;

    const data = {
      ...input,
      operationId: `financial-operation-${index}`,
      startDate: date,
      endDate: date,
      reason: `Financial policy test ${index}`,
      manualLeavePolicy: {
        deductFromBalance,
        affectsPayroll,
      },
    };

    const before = await readBalance();

    const result = await register(data);

    assert.equal(result.status, "approved");

    const stored = await db.prepare(`
      SELECT *
      FROM employee_leaves
      WHERE salon_id = 'main'
        AND id = ?
    `).bind(result.id).first();

    assert.equal(
      Number(stored.deduct_from_balance),
      Number(deductFromBalance)
    );

    assert.equal(
      Number(stored.affects_payroll),
      Number(affectsPayroll)
    );

    assert.equal(
      stored.legal_basis,
      "HR_MANUAL_POLICY"
    );

    const expectedBalance =
      before - Number(deductFromBalance);

    assert.equal(
      await readBalance(),
      expectedBalance
    );

    const entries = await readLedger(result.id);

    assert.equal(
      entries.length,
      deductFromBalance ? 1 : 0
    );

    if (deductFromBalance) {
      assert.equal(
        Number(entries[0].change_amount),
        -1
      );

      assert.ok(stored.balance_adjustment_id);
    }

    // Replay must not deduct a second time.
    const replay = await register(data);

    assert.equal(replay.id, result.id);

    assert.equal(
      await readBalance(),
      expectedBalance
    );

    assert.equal(
      (await readLedger(result.id)).length,
      deductFromBalance ? 1 : 0
    );

    console.log(
      `PASS: financial policy ${index}`,
      JSON.stringify({
        deductFromBalance,
        affectsPayroll,
        before,
        after: expectedBalance,
      })
    );

    // Cancel through the canonical leave runtime.
    const cancellation = await decideLeave(
      db,
      "main",
      result.id,
      {
        status: "rejected",
        hrNote: "Synthetic administrative cancellation",
      },
      owner
    );

    assert.equal(
      cancellation.status,
      "rejected"
    );

    assert.equal(await readBalance(), before);

    if (deductFromBalance) {
      const reversal = await db.prepare(`
        SELECT *
        FROM employee_leave_balance_ledger
        WHERE salon_id = 'main'
          AND employee_id = 'employee-1'
          AND source_type = 'reversal'
          AND source_id = ?
      `).bind(entries[0].id).all();

      assert.equal(reversal.results.length, 1);

      assert.equal(
        Number(reversal.results[0].change_amount),
        1
      );
    }

    // Repeated cancellation must not restore twice.
    await decideLeave(
      db,
      "main",
      result.id,
      {
        status: "rejected",
        hrNote: "Synthetic cancellation replay",
      },
      owner
    );

    assert.equal(await readBalance(), before);

    // A cancelled registration cannot be resurrected.
    await assert.rejects(
      () => register(data),
      /invalid_transition/
    );

    console.log(
      `PASS: financial cancellation ${index}`
    );
  }

  assert.equal(await readBalance(), 10);

  console.log("HR06H_FINANCIAL_LIFECYCLE_VERIFIED");

  const env = {
    CORE_DB: db,
    SALON_ID: "main",
    FIREBASE_PROJECT_ID: "waves-hotel-dashboard",
    PACKAGES_AUTH_TEST_MODE: "true",
  };

  const http = async (
    method,
    path,
    body,
    uid = owner.uid,
    role = "owner"
  ) => {
    const response = await coreWorker.fetch(
      new Request(`https://core.test${path}`, {
        method,
        headers: {
          Authorization: `Bearer test:${uid}:${role}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
      }),
      env,
      {
        waitUntil() {},
        passThroughOnException() {},
      }
    );

    const payload = await response.json();

    console.log(
      "HR06M_HTTP",
      method,
      path,
      response.status,
      JSON.stringify(payload)
    );

    return {
      status: response.status,
      payload,
      data: payload.data ?? payload,
    };
  };

  const httpInput = {
    ...input,
    source: "admin_direct",
    operationId: "http-direct-operation",
    startDate: "2026-11-23",
    endDate: "2026-11-23",
    reason: "HTTP administrative registration test",
    manualLeavePolicy: {
      deductFromBalance: true,
      affectsPayroll: false,
    },
  };

  const httpCountBefore = await leaveCount();
  const httpBalanceBefore = await readBalance();

  // An owner without the final approval authority
  // cannot register a direct leave.

  const forbidden = await http(
    "POST",
    "/api/core/hr/leaves",
    httpInput,
    "another-owner-uid",
    "owner"
  );

  assert.equal(forbidden.status, 403);
  assert.equal(await leaveCount(), httpCountBefore);
  assert.equal(await readBalance(), httpBalanceBefore);

  console.log("PASS: HTTP final authority enforced");

  // The designated owner registers directly.

  const createdHttp = await http(
    "POST",
    "/api/core/hr/leaves",
    httpInput
  );

  assert.equal(createdHttp.status, 200);
  assert.equal(createdHttp.data.status, "approved");
  assert.ok(createdHttp.data.id);

  const httpLeaveId = createdHttp.data.id;

  const persistedHttp = await db.prepare(`
    SELECT *
    FROM employee_leaves
    WHERE salon_id = 'main'
      AND id = ?
  `).bind(httpLeaveId).first();

  assert.equal(
    persistedHttp.registration_source,
    "admin_direct"
  );

  assert.equal(
    persistedHttp.registered_by_uid,
    owner.uid
  );

  assert.equal(persistedHttp.request_id, null);

  assert.equal(
    await leaveCount(),
    httpCountBefore + 1
  );

  assert.equal(
    await readBalance(),
    httpBalanceBefore - 1
  );

  console.log("PASS: HTTP administrative registration");

  // Repeated HTTP submission must not duplicate effects.

  const httpReplay = await http(
    "POST",
    "/api/core/hr/leaves",
    httpInput
  );

  assert.equal(httpReplay.status, 200);
  assert.equal(httpReplay.data.id, httpLeaveId);

  assert.equal(
    await readBalance(),
    httpBalanceBefore - 1
  );

  assert.equal(
    (await readLedger(httpLeaveId)).length,
    1
  );

  console.log("PASS: HTTP idempotent replay");

  // A modified policy with the same operation ID
  // must be rejected.

  const httpConflict = await http(
    "POST",
    "/api/core/hr/leaves",
    {
      ...httpInput,
      manualLeavePolicy: {
        deductFromBalance: false,
        affectsPayroll: true,
      },
    }
  );

  assert.equal(httpConflict.status, 409);

  assert.equal(
    await readBalance(),
    httpBalanceBefore - 1
  );

  console.log("PASS: HTTP financial policy conflict");

  // Verify that the leave is exposed through the
  // canonical management reader.

  const httpList = await http(
    "GET",
    "/api/core/hr/leaves?employeeId=employee-1"
  );

  assert.equal(httpList.status, 200);
  assert.ok(Array.isArray(httpList.data));

  assert.ok(
    httpList.data.some(
      row =>
        row.id === httpLeaveId &&
        row.status === "approved"
    )
  );

  console.log("PASS: canonical HTTP leave visibility");

  // Cancellation must respect final approval authority.

  const forbiddenCancellation = await http(
    "POST",
    `/api/core/hr/leaves/${httpLeaveId}/reject`,
    { hrNote: "Unauthorized synthetic cancellation" },
    "another-owner-uid"
  );

  assert.equal(forbiddenCancellation.status, 403);

  assert.equal(
    await readBalance(),
    httpBalanceBefore - 1
  );

  const cancelledHttp = await http(
    "POST",
    `/api/core/hr/leaves/${httpLeaveId}/reject`,
    { hrNote: "Authorized synthetic cancellation" }
  );

  assert.equal(cancelledHttp.status, 200);
  assert.equal(cancelledHttp.data.status, "rejected");

  assert.equal(
    await readBalance(),
    httpBalanceBefore
  );

  console.log("PASS: HTTP cancellation and balance restoration");

  console.log("HR06M_HTTP_LIFECYCLE_VERIFIED");

  const events = await db.prepare(`
    SELECT *
    FROM employee_admin_leave_events
    WHERE salon_id = 'main'
      AND leave_id = ?
    ORDER BY id
  `).bind(httpLeaveId).all();

  assert.deepEqual(
    events.results.map(row => row.event_type),
    ["registered", "approved", "rejected"]
  );

  assert.deepEqual(
    events.results.map(row => row.resulting_status),
    ["pending", "approved", "rejected"]
  );

  for (const event of events.results) {
    assert.equal(event.actor_uid, owner.uid);
    assert.equal(event.employee_id, "employee-1");
    assert.equal(
      event.operation_id,
      httpInput.operationId
    );
  }

  const registrationSnapshot = JSON.parse(
    events.results[0].snapshot_json
  );

  assert.equal(
    registrationSnapshot.deductFromBalance,
    1
  );

  assert.equal(
    registrationSnapshot.affectsPayroll,
    0
  );

  assert.equal(
    registrationSnapshot.legalBasis,
    "HR_MANUAL_POLICY"
  );

  assert.equal(
    registrationSnapshot.reason,
    httpInput.reason
  );

  console.log("PASS: complete administrative event lifecycle");

  await assert.rejects(
    () => db.prepare(`
      UPDATE employee_admin_leave_events
      SET actor_uid = 'forged-actor'
      WHERE id = ?
    `).bind(events.results[0].id).run(),
    /admin_leave_event_immutable/
  );

  await assert.rejects(
    () => db.prepare(`
      DELETE FROM employee_admin_leave_events
      WHERE id = ?
    `).bind(events.results[0].id).run(),
    /admin_leave_event_immutable/
  );

  console.log("PASS: administrative event history immutable");

  const historyCount = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM employee_admin_leave_events
    WHERE salon_id = 'main'
      AND leave_id = ?
  `).bind(httpLeaveId).first();

  assert.equal(Number(historyCount.count), 3);

  console.log("PASS: rejected requests and replay create no duplicate events");

  console.log("HR06N_ADMINISTRATIVE_AUDIT_VERIFIED");

  // Simulate a lost acknowledgement after the database
  // has committed the registration INSERT.

  let injectedFailures = 0;

  const recoveringDb = {
    prepare(sql) {
      const prepared = db.prepare(sql);

      return {
        bind(...params) {
          return {
            sql,
            statement: prepared.bind(...params),
            first(...args) {
              return this.statement.first(...args);
            },
            all(...args) {
              return this.statement.all(...args);
            },
            run(...args) {
              return this.statement.run(...args);
            },
            raw(...args) {
              return this.statement.raw(...args);
            },
          };
        },
      };
    },

    async batch(statements) {
      const results = await db.batch(
        statements.map(item => item.statement)
      );

      if (
        injectedFailures === 0 &&
        statements.some(item =>
          /INSERT INTO employee_leaves\s*\(/i.test(item.sql)
        )
      ) {
        injectedFailures++;
        throw new Error(
          "HR06J_SYNTHETIC_COMMITTED_INSERT_ACK_LOSS"
        );
      }

      return results;
    },
  };

  const recoveryInput = {
    ...input,
    operationId: "ack-loss-operation",
    startDate: "2026-11-17",
    endDate: "2026-11-17",
    reason: "Synthetic acknowledgement loss",
    manualLeavePolicy: {
      deductFromBalance: true,
      affectsPayroll: false,
    },
  };

  const balanceBeforeRecovery = await readBalance();
  const countBeforeRecovery = await leaveCount();

  const recovered = await registerAdminDirectLeave(
    recoveringDb,
    "main",
    recoveryInput,
    owner
  );

  assert.equal(injectedFailures, 1);
  assert.equal(recovered.status, "approved");

  assert.equal(
    await leaveCount(),
    countBeforeRecovery + 1
  );

  assert.equal(
    await readBalance(),
    balanceBeforeRecovery - 1
  );

  const recoveredReplay = await register(
    recoveryInput
  );

  assert.equal(recoveredReplay.id, recovered.id);

  assert.equal(
    await readBalance(),
    balanceBeforeRecovery - 1
  );

  assert.equal(
    (await readLedger(recovered.id)).length,
    1
  );

  console.log(
    "PASS: committed INSERT acknowledgement loss recovered"
  );

  await decideLeave(
    db,
    "main",
    recovered.id,
    {
      status: "rejected",
      hrNote: "Synthetic recovery cleanup",
    },
    owner
  );

  assert.equal(
    await readBalance(),
    balanceBeforeRecovery
  );

  // Concurrent requests using the same operation ID.

  const concurrentInput = {
    ...input,
    operationId: "concurrent-same-operation",
    startDate: "2026-11-18",
    endDate: "2026-11-18",
    reason: "Synthetic concurrent replay",
    manualLeavePolicy: {
      deductFromBalance: true,
      affectsPayroll: false,
    },
  };

  const countBeforeConcurrent = await leaveCount();
  const balanceBeforeConcurrent = await readBalance();

  const concurrentResults = await Promise.allSettled([
    register(concurrentInput),
    register(concurrentInput),
  ]);

  const successful = concurrentResults.filter(
    item => item.status === "fulfilled"
  );

  assert.ok(
    successful.length >= 1,
    JSON.stringify(concurrentResults)
  );

  const canonical = await register(concurrentInput);

  assert.equal(canonical.status, "approved");

  for (const item of successful) {
    assert.equal(
      item.value.id,
      canonical.id
    );
  }

  assert.equal(
    await leaveCount(),
    countBeforeConcurrent + 1
  );

  assert.equal(
    await readBalance(),
    balanceBeforeConcurrent - 1
  );

  assert.equal(
    (await readLedger(canonical.id)).length,
    1
  );

  console.log(
    "PASS: concurrent operation cannot duplicate leave or balance deduction"
  );

  await decideLeave(
    db,
    "main",
    canonical.id,
    {
      status: "rejected",
      hrNote: "Synthetic concurrency cleanup",
    },
    owner
  );

  assert.equal(
    await readBalance(),
    balanceBeforeConcurrent
  );

  // Different operation IDs competing for the same date.

  const overlapInput = {
    ...input,
    startDate: "2026-11-19",
    endDate: "2026-11-19",
    reason: "Synthetic concurrent overlap",
  };

  const countBeforeOverlap = await leaveCount();

  const overlapping = await Promise.allSettled([
    register({
      ...overlapInput,
      operationId: "overlap-race-a",
    }),
    register({
      ...overlapInput,
      operationId: "overlap-race-b",
    }),
  ]);

  assert.equal(
    overlapping.filter(
      item => item.status === "fulfilled"
    ).length,
    1
  );

  const rejectedOverlap = overlapping.find(
    item => item.status === "rejected"
  );

  assert.match(
    String(rejectedOverlap.reason?.message),
    /admin_direct_overlap/
  );

  assert.equal(
    await leaveCount(),
    countBeforeOverlap + 1
  );

  assert.equal(await readBalance(), 10);

  console.log(
    "PASS: concurrent overlapping registrations blocked"
  );

  console.log(
    "HR06J_RECOVERY_AND_CONCURRENCY_VERIFIED"
  );
});
