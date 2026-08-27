import type { PayrollEntryView } from "../../services/CorePayrollService.ts";
import type { PayrollSetupMissingKey } from "../hr/payrollCalculations.ts";
import { payrollAttendanceReadiness } from "../hr/payrollReadiness.js";

const MISSING_LABELS: Record<PayrollSetupMissingKey, string> = {
  employeeId: "معرف الموظفة غير محدد",
  baseSalary: "الراتب الأساسي غير محدد",
  workDays: "أيام العمل غير محددة",
  monthlyHours: "ساعات الشهر غير محددة",
  overtimeMultiplier: "معامل الأوفر تايم غير محدد",
};

function setupMissingLabels(entry: Pick<PayrollEntryView, "payrollSetupMissing">) {
  return [
    ...new Set(
      entry.payrollSetupMissing
        .map((key) => String(MISSING_LABELS[key] || key).trim())
        .filter(Boolean)
    ),
  ];
}

export function payrollExportExclusionReason(entry: PayrollEntryView) {
  const reasons: string[] = [];
  const missingKeys = new Set(entry.payrollSetupMissing);
  if (!entry.payrollSetupComplete) {
    const missing = setupMissingLabels(entry);
    reasons.push(missing.length ? `إعداد الراتب غير مكتمل: ${missing.join("، ")}` : "إعداد الراتب غير مكتمل");
  }
  if (!(entry.baseSalaryHalalas > 0) && !missingKeys.has("baseSalary")) {
    reasons.push("الراتب الأساسي غير محدد");
  }

  const attendanceReadiness = payrollAttendanceReadiness(
    entry.attendanceSummary
  );
  if (!attendanceReadiness.ready) {
    reasons.push(attendanceReadiness.message);
  }

  return [
    ...new Set(
      reasons
        .map((reason) => String(reason || "").trim())
        .filter(Boolean)
    ),
  ].join("، ");
}

export function isPayrollExportEligible(entry: PayrollEntryView) {
  return !payrollExportExclusionReason(entry);
}
