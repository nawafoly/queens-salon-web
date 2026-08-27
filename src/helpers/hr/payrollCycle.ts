export const PAYROLL_CLOSE_DAY = 27;

function normalizeIsoDate(
  value: unknown
): string {
  const text =
    String(value ?? "").trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(
    text
  )
    ? text
    : "";
}

function monthStartDate(
  monthKey: string
): Date | null {
  const text =
    String(monthKey || "").trim();

  if (
    !/^\d{4}-\d{2}$/.test(
      text
    )
  ) {
    return null;
  }

  const year =
    Number(
      text.slice(0, 4)
    );

  const month =
    Number(
      text.slice(5, 7)
    );

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  return new Date(
    year,
    month - 1,
    1
  );
}

function monthKeyFromDate(
  dateIso: string
): string {
  const normalized =
    normalizeIsoDate(
      dateIso
    );

  return normalized
    ? normalized.slice(0, 7)
    : "";
}

function shiftMonthKey(
  monthKey: string,
  delta: number
): string {
  const start =
    monthStartDate(
      monthKey
    );

  if (
    !start ||
    !Number.isFinite(delta)
  ) {
    return "";
  }

  const next =
    new Date(
      start.getFullYear(),
      start.getMonth() +
        delta,
      1
    );

  return (
    next.getFullYear() +
    "-" +
    String(
      next.getMonth() + 1
    ).padStart(2, "0")
  );
}

export function payrollCycleKeyFromDate(
  dateIso: string,
  closeDay = PAYROLL_CLOSE_DAY
): string {
  const date =
    normalizeIsoDate(
      dateIso
    );

  if (!date) {
    return "";
  }

  const monthKey =
    monthKeyFromDate(
      date
    );

  const day =
    Number(
      date.slice(8, 10)
    );

  if (
    !monthKey ||
    !Number.isFinite(day)
  ) {
    return "";
  }

  if (day > closeDay) {
    return (
      shiftMonthKey(
        monthKey,
        1
      ) ||
      monthKey
    );
  }

  return monthKey;
}

export function payrollCycleRangeForMonthKey(
  monthKey: string,
  closeDay = PAYROLL_CLOSE_DAY
): {
  from: string;
  to: string;
} | null {
  const currentStart =
    monthStartDate(
      monthKey
    );

  if (!currentStart) {
    return null;
  }

  const currentYear =
    currentStart.getFullYear();

  const currentMonth =
    currentStart.getMonth();

  const currentLastDay =
    new Date(
      currentYear,
      currentMonth + 1,
      0
    ).getDate();

  const cycleEndDay =
    Math.max(
      1,
      Math.min(
        closeDay,
        currentLastDay
      )
    );

  const to =
    currentYear +
    "-" +
    String(
      currentMonth + 1
    ).padStart(2, "0") +
    "-" +
    String(
      cycleEndDay
    ).padStart(2, "0");

  const previousStart =
    new Date(
      currentYear,
      currentMonth - 1,
      1
    );

  const previousYear =
    previousStart.getFullYear();

  const previousMonth =
    previousStart.getMonth();

  const previousLastDay =
    new Date(
      previousYear,
      previousMonth + 1,
      0
    ).getDate();

  const cycleStartDay =
    Math.max(
      1,
      Math.min(
        closeDay + 1,
        previousLastDay
      )
    );

  const from =
    previousYear +
    "-" +
    String(
      previousMonth + 1
    ).padStart(2, "0") +
    "-" +
    String(
      cycleStartDay
    ).padStart(2, "0");

  return {
    from,
    to,
  };
}
