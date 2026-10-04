import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeEmployeeProfileRows,
  dbFirst,
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
