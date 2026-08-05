import assert from "node:assert";
import { submitAndApproveLeave } from "../src/services/employeeHub.helpers.ts";

test("submitAndApproveLeave calls create then approve with provided fns", async () => {
  let created = null;
  const createMock = async (payload) => {
    created = { id: "req-123", ...payload };
    return created;
  };
  let approved = null;
  const approveMock = async (payload) => {
    approved = payload;
    return { ok: true };
  };

  const data = {
    employeeUid: "uid-1",
    employeeId: "staff-1",
    employeeName: "Test",
    type: "emergency",
    fromDate: "2026-08-05",
    toDate: "2026-08-05",
    days: 1,
    note: "note",
    createdByUid: "admin-1",
    createdByName: "Admin",
  };

  const req = await submitAndApproveLeave(data, createMock, approveMock);
  assert.equal(req && req.id, "req-123");
  assert.equal(created && created.employeeId, "staff-1");
  assert.equal(approved && approved.requestId, "req-123");
  assert.equal(approved && approved.reviewerUid, "admin-1");
});
