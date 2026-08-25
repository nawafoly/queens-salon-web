import { CoreHrService } from "./CoreHrService";

export type ArchiveEmployeeInput = {
  employeeId: string;
  endDate: string;
  reason: string;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function archiveEmployee(input: ArchiveEmployeeInput) {
  const employeeId = clean(input.employeeId);
  const endDate = clean(input.endDate);
  const reason = clean(input.reason);
  if (!employeeId) throw new Error("معرّف الموظفة مفقود؛ لم يتم إنهاء الخدمة.");
  if (!endDate) throw new Error("تاريخ آخر يوم عمل مطلوب.");
  if (!reason) throw new Error("سبب إنهاء الخدمة مطلوب.");

  // The browser sends lifecycle intent only. Core owns account/link revocation,
  // staff projection, schedule closure, booking blockers and audit logging.
  return CoreHrService.offboardEmployee(employeeId, { endDate, reason });
}
