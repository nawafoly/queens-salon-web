export type CorePayrollFinancialRow = {
  id: string;
  date: string;
  amount: number;
  category: string;
  title: string;
  note: string;
  addedBy: string;
  createdAtMs: number;
  employeeId?: string;
  employeeName: string;
  payrollMonth?: string;
  payrollKind: "salary" | "overtime";
};

export type CorePayrollFinancialProjectionMode = "recorded" | "calculated";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function moneyHalalas(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.round(number));
}

function payrollExpenseDate(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return "";
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return "";
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(Math.min(27, lastDay)).padStart(2, "0")}`;
}

function canonicalOvertimeHalalas(entry: any): number {
  // overtime_value_halalas and overtime_bonus_halalas are compatibility aliases.
  // They represent one amount and must never be added together.
  return moneyHalalas(
    entry?.overtimeValueHalalas ??
      entry?.overtime_value_halalas ??
      entry?.overtimeBonusHalalas ??
      entry?.overtime_bonus_halalas
  );
}

export function projectCorePayrollEntriesToFinancialRows(
  entries: readonly unknown[],
  mode: CorePayrollFinancialProjectionMode
): CorePayrollFinancialRow[] {
  const rows: CorePayrollFinancialRow[] = [];

  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const entry = rawEntry as any;
    const storedId = cleanText(entry?.id);
    const employeeId = cleanText(entry?.employeeId ?? entry?.employee_id);
    const employeeName = cleanText(entry?.employeeName ?? entry?.employee_name ?? employeeId ?? "") || "موظفة";
    const monthKey = cleanText(entry?.payrollMonth ?? entry?.payroll_month);

    if (!employeeId || !/^\d{4}-\d{2}$/.test(monthKey)) continue;
    if (mode === "recorded" && !storedId) continue;

    const netHalalas = moneyHalalas(
      entry?.netSalaryHalalas ??
        entry?.net_salary_halalas ??
        entry?.finalSalaryHalalas ??
        entry?.final_salary_halalas
    );
    const finalHalalas = moneyHalalas(
      entry?.finalSalaryHalalas ??
        entry?.final_salary_halalas ??
        entry?.netSalaryHalalas ??
        entry?.net_salary_halalas
    );
    const totalHalalas = mode === "recorded" ? finalHalalas : netHalalas;
    const overtimeHalalas = Math.min(totalHalalas, canonicalOvertimeHalalas(entry));
    const salaryHalalas = Math.max(0, totalHalalas - overtimeHalalas);
    const date = payrollExpenseDate(monthKey);
    if (!date) continue;

    const createdAtMs = Date.parse(`${date}T12:00:00`) || Date.now();
    const idBase = mode === "recorded" ? storedId : `${employeeId}_${monthKey}`;

    if (salaryHalalas > 0) {
      rows.push({
        id: mode === "recorded" ? `auto_payroll_salary_core_${idBase}` : `auto_payroll_salary_live_${idBase}`,
        date,
        amount: salaryHalalas / 100,
        category: "رواتب الموظفات",
        title: `${mode === "recorded" ? "راتب" : "صافي راتب"} ${employeeName} (${monthKey})`,
        note: mode === "recorded"
          ? "كشف راتب محفوظ في Malikat Core"
          : entry?.saved
            ? "صافي مسير محفوظ بعد الإضافات والخصومات"
            : "صافي مسير محسوب من Malikat Core",
        addedBy: mode === "recorded" ? "النظام (كشف راتب)" : "النظام (Malikat Core)",
        createdAtMs,
        employeeId,
        employeeName,
        payrollMonth: monthKey,
        payrollKind: "salary",
      });
    }

    if (overtimeHalalas > 0) {
      rows.push({
        id: mode === "recorded" ? `auto_payroll_overtime_core_${idBase}` : `auto_payroll_overtime_live_${idBase}`,
        date,
        amount: overtimeHalalas / 100,
        category: "أوفر تايم",
        title: `أوفر تايم ${employeeName} (${monthKey})`,
        note: mode === "recorded"
          ? "قيمة الأوفر تايم محفوظة في Malikat Core"
          : "قيمة الأوفر تايم ضمن صافي المسير المحسوب",
        addedBy: mode === "recorded" ? "النظام (كشف راتب)" : "النظام (Malikat Core)",
        createdAtMs,
        employeeId,
        employeeName,
        payrollMonth: monthKey,
        payrollKind: "overtime",
      });
    }
  }

  return rows;
}
