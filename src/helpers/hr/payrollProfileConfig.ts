export type StaffPayrollMethod =
  | "hours_from_salary"
  | "invoice_percentage";

export type StaffOvertimeHoursBasis =
  | "regular"
  | "season";

export type NormalizedPayrollConfig = {
  monthlySalary: number;
  method: StaffPayrollMethod;
  daysPerMonth: number;
  baseHoursPerDay: number;
  seasonBaseHoursPerDay: number;
  autoSeasonOvertimeBasis: boolean;
  hoursBasis: StaffOvertimeHoursBasis;
  overtimePercent: number;
  invoicePercent: number;
};

function safeNumber(
  value: unknown,
  fallback: number
): number {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

export function normalizePayrollConfig(
  raw: any
): NormalizedPayrollConfig {
  const method: StaffPayrollMethod =
    String(
      raw?.overtimeMethod ||
      ""
    ).trim() ===
    "invoice_percentage"
      ? "invoice_percentage"
      : "hours_from_salary";

  const hoursBasis: StaffOvertimeHoursBasis =
    String(
      raw?.overtimeHoursBasis ||
      ""
    ).trim() === "season"
      ? "season"
      : "regular";

  return {
    monthlySalary:
      Math.max(
        0,
        safeNumber(
          raw?.monthlySalary,
          0
        )
      ),

    method,

    daysPerMonth:
      Math.max(
        1,
        safeNumber(
          raw?.overtimeDaysPerMonth,
          30
        )
      ),

    baseHoursPerDay:
      Math.max(
        1,
        safeNumber(
          raw?.overtimeBaseHoursPerDay,
          8
        )
      ),

    seasonBaseHoursPerDay:
      Math.max(
        1,
        safeNumber(
          raw?.overtimeSeasonBaseHoursPerDay,
          6
        )
      ),

    autoSeasonOvertimeBasis:
      raw?.autoSeasonOvertimeBasis ===
      true,

    hoursBasis,

    overtimePercent:
      Math.max(
        0,
        safeNumber(
          raw?.overtimePercent,
          0
        )
      ),

    invoicePercent:
      Math.max(
        0,
        safeNumber(
          raw?.overtimeInvoicePercent,
          0
        )
      ),
  };
}
