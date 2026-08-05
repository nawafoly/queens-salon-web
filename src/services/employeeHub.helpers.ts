export async function applyBalanceAdjustmentForRequest(request: any, actor: any, applyFn: any, requestId?: string) {
  if (!applyFn || typeof applyFn !== "function") throw new Error("applyFn required");
  if (!request || !actor) return null;
  if (request.balanceAdjusted) return null; // idempotent
  const staffId = String(request.employeeId || "").trim();
  const days = Number.isFinite(Number(request.days)) ? Number(request.days) : 0;
  if (!staffId || days <= 0) return null;

  const deductTypes = new Set(["annual", "sick", "emergency"]);
  const shouldDeduct = deductTypes.has(String(request.type || "").toLowerCase());
  const actionType = shouldDeduct ? "deduct" : "add";

  const result = await applyFn({
    staffId,
    actionType,
    days: Math.abs(days),
    opDate: new Date().toISOString().slice(0, 10),
    note: `ربط مع طلب إجازة ${requestId || String(request.id || "").trim()}`,
    actor: {
      uid: String(actor.uid || "").trim(),
      role: actor.role,
      displayName: String(actor.displayName || actor.email || actor.uid || "").trim(),
      email: String(actor.email || "").trim(),
    },
  });

  return result || null;
}

export async function restoreBalanceForRequest(request: any, actor: any, applyFn: any, requestId?: string) {
  if (!applyFn || typeof applyFn !== "function") throw new Error("applyFn required");
  if (!request || !actor) return null;
  if (!request.balanceAdjusted) return null; // nothing to restore
  if (request.balanceRestored) return null; // idempotent
  const staffId = String(request.employeeId || "").trim();
  if (!staffId) return null;

  // determine reversal amount: if original change exists, reverse it; else use days and type
  const originalChange = Number(request.balanceAdjustmentChangeAmount || 0);
  if (originalChange === 0 && (!request.days || request.days <= 0)) return null;

  const days = originalChange !== 0 ? Math.abs(originalChange) : Math.abs(Number(request.days || 0));
  const originalType = String(request.type || "").toLowerCase();
  const deductTypes = new Set(["annual", "sick", "emergency"]);
  const originalWasDeduct = deductTypes.has(originalType);
  const actionType = originalWasDeduct ? "add" : "deduct";

  const result = await applyFn({
    staffId,
    actionType: actionType as any,
    days: Math.abs(days),
    opDate: new Date().toISOString().slice(0, 10),
    note: `leave_request_reversal:${requestId || String(request.id || "").trim()} reverses ${String(request.balanceAdjustmentEntryId || "").trim()}`,
    actor: {
      uid: String(actor.uid || "").trim(),
      role: actor.role,
      displayName: String(actor.displayName || actor.email || actor.uid || "").trim(),
      email: String(actor.email || "").trim(),
    },
  });

  return result || null;
}

export default {
  applyBalanceAdjustmentForRequest,
  restoreBalanceForRequest,
};

export async function submitAndApproveLeave(data: {
  employeeUid: string;
  employeeId: string;
  employeeName: string;
  type: string;
  fromDate: string;
  toDate: string;
  days: number;
  note?: string;
  createdByUid: string;
  createdByName?: string;
}, createFn: any, approveFn: any) {
  if (!createFn || typeof createFn !== "function") throw new Error("createFn required");
  if (!approveFn || typeof approveFn !== "function") throw new Error("approveFn required");
  const req = await createFn({
    employeeUid: data.employeeUid,
    employeeId: data.employeeId,
    employeeName: data.employeeName,
    type: data.type,
    fromDate: data.fromDate,
    toDate: data.toDate,
    days: data.days,
    note: data.note || "",
    createdByUid: data.createdByUid,
    createdByName: data.createdByName || "",
  });

  await approveFn({
    requestId: req.id,
    reviewerUid: data.createdByUid,
    reviewerName: data.createdByName || "",
    adjustLeaveBalance: false,
    adjustActor: undefined,
  });
  return req;
}
