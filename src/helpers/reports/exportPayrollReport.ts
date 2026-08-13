import type { PayrollEntryView } from "../../services/CorePayrollService.ts";
import type { PayrollSetupMissingKey } from "../hr/payrollCalculations.ts";

const MISSING_LABELS: Record<PayrollSetupMissingKey, string> = {
  employeeId: "معرف الموظفة غير محدد",
  baseSalary: "الراتب الأساسي غير محدد",
  workDays: "أيام العمل غير محددة",
  monthlyHours: "ساعات الشهر غير محددة",
  overtimeMultiplier: "معامل الأوفر تايم غير محدد",
};

function setupMissingLabels(entry: Pick<PayrollEntryView, "payrollSetupMissing">) {
  return entry.payrollSetupMissing.map((key) => MISSING_LABELS[key] || key);
}

export function payrollExportExclusionReason(entry: PayrollEntryView) {
  const reasons: string[] = [];
  if (!entry.payrollSetupComplete) {
    const missing = setupMissingLabels(entry);
    reasons.push(missing.length ? `إعداد الراتب غير مكتمل: ${missing.join("، ")}` : "إعداد الراتب غير مكتمل");
  }
  if (!(entry.baseSalaryHalalas > 0)) {
    reasons.push("الراتب الأساسي غير محدد");
  }
  return reasons.join("، ");
}

export function isPayrollExportEligible(entry: PayrollEntryView) {
  return !payrollExportExclusionReason(entry);
}
