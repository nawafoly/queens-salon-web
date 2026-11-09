export type AttendanceOperationResult = {
  attendanceApplied?: boolean;
  fullyCompleted?: boolean;
  operation?: { id: string; status: "pending" | "completed" | "needs_attention"; attempts?: number };
};

const requestKeys = new Map<string,string>();

// Retain the same key after a timeout, a lost response, or a page reload.
// A changed request gets its own key; the server rejects concurrent corrections
// until the employee's preceding financial reconciliation has completed.
export async function attendanceOperationRequest(userId: string, body: Record<string,unknown>) {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(body)));
  const key = `attendance-operation:${userId}:${Array.from(new Uint8Array(digest),b => b.toString(16).padStart(2,"0")).join("")}`;
  let operationId = requestKeys.get(key);
  try { operationId ||= sessionStorage.getItem(key) || undefined; } catch { /* Memory fallback for restricted storage. */ }
  operationId ||= crypto.randomUUID();
  requestKeys.set(key,operationId);
  try { sessionStorage.setItem(key,operationId); } catch { /* Memory fallback. */ }
  return {
    body: {...body,operationId},
    finish(result: AttendanceOperationResult) {
      if (result.fullyCompleted !== true) return;
      requestKeys.delete(key);
      try { sessionStorage.removeItem(key); } catch { /* Memory fallback. */ }
    },
  };
}

export function attendanceReconciliationMessage(result: AttendanceOperationResult, english = false) {
  if (result.fullyCompleted !== false) return "";
  return english
    ? `Attendance was saved. Financial reconciliation ${result.operation?.status === "needs_attention" ? "needs administrator review" : "is pending and will retry automatically"}. Reference: ${result.operation?.id || ""}`
    : `تم حفظ تعديل الحضور. ${result.operation?.status === "needs_attention" ? "التسوية المالية تحتاج مراجعة الإدارة" : "التسوية المالية قيد الاستكمال وستُعاد محاولتها تلقائيًا"}. المرجع: ${result.operation?.id || ""}`;
}
