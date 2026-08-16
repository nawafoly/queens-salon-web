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

export type CorePayrollFinancialProjectionMode =
  | "recorded"
  | "calculated";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function moneyHalalas(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.round(number));
}

function payrollExpenseDate(monthKey: string): string {
  if (!/^\\d{4}-\\d{2}$/.test(monthKey)) return "";

  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return "";
  }

  const lastDay =
    new Date(year, month, 0).getDate();

  const day =
    Math.min(27, lastDay);

  return (
    monthKey +
    "-" +
    String(day).padStart(2, "0")
  );
}

export function projectCorePayrollEntriesToFinancialRows(
  entries: readonly unknown[],
  mode: CorePayrollFinancialProjectionMode
): CorePayrollFinancialRow[] {
  const rows: CorePayrollFinancialRow[] = [];

  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const entry = rawEntry as any;

    const storedId =
      cleanText(entry?.id);

    const employeeId =
      cleanText(
        entry?.employeeId ??
        entry?.employee_id
      );

    const employeeName =
      cleanText(
        entry?.employeeName ??
        entry?.employee_name ??
        employeeId ??
        ""
      ) ||
      "\u0645\u0648\u0638\u0641\u0629";

    const monthKey =
      cleanText(
        entry?.payrollMonth ??
        entry?.payroll_month
      );

    if (
      !employeeId ||
      !/^\\d{4}-\\d{2}$/.test(monthKey)
    ) {
      continue;
    }

    if (
      mode === "recorded" &&
      !storedId
    ) {
      continue;
    }

    const netHalalas =
      moneyHalalas(
        entry?.netSalaryHalalas ??
        entry?.net_salary_halalas ??
        entry?.finalSalaryHalalas ??
        entry?.final_salary_halalas
      );

    const finalHalalas =
      moneyHalalas(
        entry?.finalSalaryHalalas ??
        entry?.final_salary_halalas ??
        entry?.netSalaryHalalas ??
        entry?.net_salary_halalas
      );

    const totalHalalas =
      mode === "recorded"
        ? finalHalalas
        : netHalalas;

    const rawOvertimeHalalas =
      moneyHalalas(
        entry?.overtimeValueHalalas ??
        entry?.overtime_value_halalas
      ) +
      moneyHalalas(
        entry?.overtimeBonusHalalas ??
        entry?.overtime_bonus_halalas
      );

    const overtimeHalalas =
      Math.min(
        totalHalalas,
        rawOvertimeHalalas
      );

    const salaryHalalas =
      Math.max(
        0,
        totalHalalas -
        overtimeHalalas
      );

    const date =
      payrollExpenseDate(
        monthKey
      );

    if (!date) continue;

    const createdAtMs =
      Date.parse(
        date + "T12:00:00"
      ) ||
      Date.now();

    const idBase =
      mode === "recorded"
        ? storedId
        : employeeId + "_" + monthKey;

    if (salaryHalalas > 0) {
      rows.push({
        id:
          mode === "recorded"
            ? "auto_payroll_salary_core_" + idBase
            : "auto_payroll_salary_live_" + idBase,
        date,
        amount:
          salaryHalalas / 100,
        category:
          "\u0631\u0648\u0627\u062a\u0628 \u0627\u0644\u0645\u0648\u0638\u0641\u0627\u062a",
        title:
          (
            mode === "recorded"
              ? "\u0631\u0627\u062a\u0628 "
              : "\u0635\u0627\u0641\u064a \u0631\u0627\u062a\u0628 "
          ) +
          employeeName +
          " (" +
          monthKey +
          ")",
        note:
          mode === "recorded"
            ? "\u0643\u0634\u0641 \u0631\u0627\u062a\u0628 \u0645\u062d\u0641\u0648\u0638 \u0641\u064a Malikat Core"
            : entry?.saved
              ? "\u0635\u0627\u0641\u064a \u0645\u0633\u064a\u0631 \u0645\u062d\u0641\u0648\u0638 \u0628\u0639\u062f \u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062a \u0648\u0627\u0644\u062e\u0635\u0648\u0645\u0627\u062a"
              : "\u0635\u0627\u0641\u064a \u0645\u0633\u064a\u0631 \u0645\u062d\u0633\u0648\u0628 \u0645\u0646 Malikat Core",
        addedBy:
          mode === "recorded"
            ? "\u0627\u0644\u0646\u0638\u0627\u0645 (\u0643\u0634\u0641 \u0631\u0627\u062a\u0628)"
            : "\u0627\u0644\u0646\u0638\u0627\u0645 (Malikat Core)",
        createdAtMs,
        employeeId,
        employeeName,
        payrollMonth:
          monthKey,
        payrollKind:
          "salary",
      });
    }

    if (overtimeHalalas > 0) {
      rows.push({
        id:
          mode === "recorded"
            ? "auto_payroll_overtime_core_" + idBase
            : "auto_payroll_overtime_live_" + idBase,
        date,
        amount:
          overtimeHalalas / 100,
        category:
          "\u0623\u0648\u0641\u0631 \u062a\u0627\u064a\u0645",
        title:
          "\u0623\u0648\u0641\u0631 \u062a\u0627\u064a\u0645 " +
          employeeName +
          " (" +
          monthKey +
          ")",
        note:
          mode === "recorded"
            ? "\u0642\u064a\u0645\u0629 \u0627\u0644\u0623\u0648\u0641\u0631 \u062a\u0627\u064a\u0645 \u0645\u062d\u0641\u0648\u0638\u0629 \u0641\u064a Malikat Core"
            : "\u0642\u064a\u0645\u0629 \u0627\u0644\u0623\u0648\u0641\u0631 \u062a\u0627\u064a\u0645 \u0636\u0645\u0646 \u0635\u0627\u0641\u064a \u0627\u0644\u0645\u0633\u064a\u0631 \u0627\u0644\u0645\u062d\u0633\u0648\u0628",
        addedBy:
          mode === "recorded"
            ? "\u0627\u0644\u0646\u0638\u0627\u0645 (\u0643\u0634\u0641 \u0631\u0627\u062a\u0628)"
            : "\u0627\u0644\u0646\u0638\u0627\u0645 (Malikat Core)",
        createdAtMs,
        employeeId,
        employeeName,
        payrollMonth:
          monthKey,
        payrollKind:
          "overtime",
      });
    }
  }

  return rows;
}
