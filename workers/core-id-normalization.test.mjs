import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeEmployeeProfileRows,
  canonicalizePayrollEntryRows,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  normalizeId,
  requiredId,
} from "./core/d1.js";

const arabicEmployeeId = "سميرة_دينار";
const encodedOnce = encodeURIComponent(arabicEmployeeId);
const encodedTwice = encodeURIComponent(encodedOnce);

test("Core ids normalize Arabic route ids from one URI-encoding layer", () => {
  assert.equal(normalizeId(encodedOnce), arabicEmployeeId);
  assert.equal(requiredId(encodedOnce, "employeeId"), arabicEmployeeId);
});

test("Core ids normalize legacy double-encoded Arabic route ids", () => {
  assert.equal(normalizeId(encodedTwice), arabicEmployeeId);
  assert.equal(requiredId(encodedTwice, "employeeId"), arabicEmployeeId);
});

test("Core ids preserve ordinary percent text and still reject path separators", () => {
  assert.equal(normalizeId("employee_100%20"), "employee_100%20");
  assert.equal(requiredId("employee_100%20", "employeeId"), "employee_100%20");
  assert.throws(
    () => requiredId("employee/other", "employeeId"),
    /employeeId is invalid/,
  );
});

test("employee profile lists collapse canonical and encoded aliases to one employee", () => {
  const rows = canonicalizeEmployeeProfileRows([
    { id: encodedOnce, name: "سميرة دينار", status: "active", marker: "legacy" },
    { id: arabicEmployeeId, name: "سميرة دينار", status: "active", marker: "canonical" },
    { id: encodedTwice, name: "سميرة دينار", status: "active", marker: "double-legacy" },
    { id: "employee_other", name: "موظفة أخرى", status: "active" },
  ]);

  assert.equal(rows.length, 2);
  const samira = rows.find((row) => row.id === arabicEmployeeId);
  assert.ok(samira);
  assert.equal(samira.marker, "canonical");
});

test("legacy-only employee profile aliases are exposed through the canonical id", () => {
  const rows = canonicalizeEmployeeProfileRows([
    { id: encodedTwice, name: "سميرة دينار", status: "active" },
  ]);
  assert.deepEqual(rows.map((row) => row.id), [arabicEmployeeId]);
});

test("employee point lookup falls back to a legacy encoded id and returns canonical identity", async () => {
  const db = {
    __fakeD1: true,
    async first(_sql, params) {
      const id = params.at(-1);
      if (id === encodedOnce) {
        return { id: encodedOnce, salon_id: "main", name: "سميرة دينار" };
      }
      return null;
    },
  };

  const row = await dbFirst(
    db,
    "SELECT * FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1",
    ["main", arabicEmployeeId],
  );

  assert.ok(row);
  assert.equal(row.id, arabicEmployeeId);
  assert.equal(row.name, "سميرة دينار");
});

test("canonical employee row wins regardless of list order", () => {
  for (const rows of [
    [
      { id: arabicEmployeeId, marker: "canonical" },
      { id: encodedOnce, marker: "legacy" },
    ],
    [
      { id: encodedOnce, marker: "legacy" },
      { id: arabicEmployeeId, marker: "canonical" },
    ],
  ]) {
    const collapsed = canonicalizeEmployeeProfileRows(rows);
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].id, arabicEmployeeId);
    assert.equal(collapsed[0].marker, "canonical");
  }
});

test("Core HR list query collapses Samira aliases before payroll sees them", async () => {
  const db = {
    __fakeD1: true,
    async all() {
      return [
        { id: encodedOnce, name: "سميرة دينار", status: "active", marker: "legacy" },
        { id: arabicEmployeeId, name: "سميرة دينار", status: "active", marker: "canonical" },
      ];
    },
  };

  const rows = await dbAll(
    db,
    "SELECT * FROM employee_profiles WHERE salon_id = ? ORDER BY status, name LIMIT 1000",
    ["main"],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, arabicEmployeeId);
  assert.equal(rows[0].marker, "canonical");
});

test("payroll lists collapse encoded aliases and prefer canonical row at equal status", () => {
  const rows = canonicalizePayrollEntryRows([
    {
      id: "legacy-draft",
      employee_id: encodedOnce,
      payroll_month: "2026-09",
      status: "draft",
      updated_at: "2026-10-02T10:00:00Z",
    },
    {
      id: "canonical-draft",
      employee_id: arabicEmployeeId,
      payroll_month: "2026-09",
      status: "draft",
      updated_at: "2026-10-01T10:00:00Z",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "canonical-draft");
  assert.equal(rows[0].employee_id, arabicEmployeeId);
});

test("finalized legacy payroll wins over canonical draft to prevent double processing", () => {
  const rows = canonicalizePayrollEntryRows([
    {
      id: "canonical-draft",
      employee_id: arabicEmployeeId,
      payroll_month: "2026-09",
      status: "draft",
      updated_at: "2026-10-03T10:00:00Z",
    },
    {
      id: "legacy-approved",
      employee_id: encodedOnce,
      payroll_month: "2026-09",
      status: "approved",
      updated_at: "2026-10-01T10:00:00Z",
    },
    {
      id: "double-paid",
      employee_id: encodedTwice,
      payroll_month: "2026-10",
      status: "paid",
      updated_at: "2026-10-04T10:00:00Z",
    },
  ]);

  assert.equal(rows.length, 2);
  const september = rows.find((row) => row.payroll_month === "2026-09");
  assert.equal(september.id, "legacy-approved");
  assert.equal(september.employee_id, arabicEmployeeId);
});

test("payroll list query exposes one canonical Samira payroll row per month", async () => {
  const db = {
    __fakeD1: true,
    async all() {
      return [
        { id: "legacy", employee_id: encodedOnce, payroll_month: "2026-09", status: "draft" },
        { id: "canonical", employee_id: arabicEmployeeId, payroll_month: "2026-09", status: "draft" },
      ];
    },
  };

  const rows = await dbAll(
    db,
    "SELECT * FROM payroll_entries WHERE salon_id = ? ORDER BY payroll_month DESC, employee_id LIMIT 2000",
    ["main"],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "canonical");
  assert.equal(rows[0].employee_id, arabicEmployeeId);
});

test("canonical payroll point lookup reuses the highest-finality legacy alias", async () => {
  const db = {
    __fakeD1: true,
    async first(_sql, params) {
      const employeeId = params[1];
      if (employeeId === arabicEmployeeId) {
        return {
          id: "canonical-draft",
          employee_id: arabicEmployeeId,
          payroll_month: "2026-09",
          status: "draft",
        };
      }
      if (employeeId === encodedOnce) {
        return {
          id: "legacy-approved",
          employee_id: encodedOnce,
          payroll_month: "2026-09",
          status: "approved",
        };
      }
      return null;
    },
  };

  const row = await dbFirst(
    db,
    "SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? LIMIT 1",
    ["main", arabicEmployeeId, "2026-09"],
  );

  assert.equal(row.id, "legacy-approved");
  assert.equal(row.employee_id, encodedOnce);
});

test("payroll upsert mutation targets an existing legacy alias instead of creating a second row", async () => {
  let captured = null;
  const db = {
    __fakeD1: true,
    async first(_sql, params) {
      if (params[1] === encodedOnce) {
        return {
          id: "legacy-payroll",
          employee_id: encodedOnce,
          payroll_month: "2026-09",
          status: "draft",
        };
      }
      return null;
    },
    async run(_sql, params) {
      captured = params;
      return { changes: 1 };
    },
  };

  await dbRun(
    db,
    `INSERT INTO payroll_entries
      (id, salon_id, employee_id, payroll_month)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(salon_id, employee_id, payroll_month) DO UPDATE SET
        payroll_month = excluded.payroll_month`,
    ["new-canonical-payroll", "main", arabicEmployeeId, "2026-09"],
  );

  assert.deepEqual(captured, [
    "legacy-payroll",
    "main",
    encodedOnce,
    "2026-09",
  ]);
});

test("batched payroll mutations also reuse the physical legacy alias", async () => {
  let captured = null;
  const db = {
    __fakeD1: true,
    async first(_sql, params) {
      if (params[1] === encodedOnce) {
        return {
          id: "legacy-payroll",
          employee_id: encodedOnce,
          payroll_month: "2026-09",
          status: "draft",
        };
      }
      return null;
    },
    async batch(statements) {
      captured = statements;
      return [{ changes: 1 }];
    },
  };

  await dbBatch(db, [
    {
      sql: `INSERT INTO payroll_entries
        (id, salon_id, employee_id, payroll_month)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(salon_id, employee_id, payroll_month) DO UPDATE SET
          payroll_month = excluded.payroll_month`,
      params: ["new-canonical-payroll", "main", arabicEmployeeId, "2026-09"],
    },
  ]);

  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0].params, [
    "legacy-payroll",
    "main",
    encodedOnce,
    "2026-09",
  ]);
});
