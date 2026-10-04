import test from "node:test";
import assert from "node:assert/strict";

import { normalizeId, requiredId } from "./core/d1.js";

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
