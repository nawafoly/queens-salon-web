// Canonical statutory sick-pay adjustment. Pure calendar-date arithmetic:
 // approved illness days remain excused attendance, while a separate wage
 // adjustment captures the 75% and unpaid statutory segments.

function calendarDayNumber(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('core_payroll:sick_leave_invalid_date');
  }
  const millis = Date.parse(`${text}T12:00:00.000Z`);
  if (!Number.isFinite(millis) ||
      new Date(millis).toISOString().slice(0, 10) !== text) {
    throw new Error('core_payroll:sick_leave_invalid_date');
  }
  return Math.floor(millis / 86400000);
}

function requiredSegments(leave, totalDays) {
  let segments;
  try {
    segments = typeof leave.pay_segments_json === 'string'
      ? JSON.parse(leave.pay_segments_json)
      : leave.pay_segments_json;
  } catch {
    throw new Error('core_payroll:sick_leave_pay_segments_invalid');
  }
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('core_payroll:sick_leave_pay_segments_missing');
  }
  const rates = [];
  let expectedOrdinal = Number(leave.sick_day_ordinal_from);
  if (!Number.isInteger(expectedOrdinal) || expectedOrdinal < 1) {
    throw new Error('core_payroll:sick_leave_start_ordinal_missing');
  }
  for (const segment of segments) {
    const from = Number(segment.ordinalFrom);
    const to = Number(segment.ordinalTo);
    const days = Number(segment.days);
    const rate = Number(segment.payRateBps);
    if (!Number.isInteger(from) || !Number.isInteger(to) ||
        from !== expectedOrdinal || to < from || to > 120 ||
        days !== to - from + 1 ||
        ![0, 7500, 10000].includes(rate) ||
        segment.reviewRequired === true ||
        (from <= 30 ? rate !== 10000 || to > 30 :
          from <= 90 ? rate !== 7500 || to > 90 : rate !== 0)) {
      throw new Error('core_payroll:sick_leave_pay_segments_invalid');
    }
    for (let ordinal = from; ordinal <= to; ordinal += 1) rates.push(rate);
    expectedOrdinal = to + 1;
  }
  if (rates.length !== totalDays ||
      Number(leave.days_count) !== totalDays ||
      Number(leave.sick_day_ordinal_to) !== expectedOrdinal - 1 ||
      String(leave.documentation_status || '').toLowerCase() !== 'verified') {
    throw new Error('core_payroll:sick_leave_pay_segments_incomplete');
  }
  return rates;
}

/**
 * Returns the unpaid-equivalent day count for *this payroll period*.
 * This is not absence: approved sick dates are excused from attendance.
 * One 75%-paid date contributes 0.25 wage-deduction day; one unpaid date
 * contributes 1. Recalled days never contribute. Never infer missing bands.
 */
export function statutorySickPayrollAdjustment({
  leaves = [], periodStart, periodEnd, recalledLeaveDates = new Set(),
} = {}) {
  const first = calendarDayNumber(periodStart);
  const last = calendarDayNumber(periodEnd);
  if (last < first) return { unpaidEquivalentDays: 0, affectedDays: 0 };
  let unitsBps = 0;
  let affectedDays = 0;
  const seen = new Set();
  for (const leave of leaves) {
    if (String(leave.status || '').toLowerCase() !== 'approved' ||
        String(leave.leave_type || '').toLowerCase() !== 'sick') continue;
    const start = calendarDayNumber(leave.start_date);
    const end = calendarDayNumber(leave.end_date);
    if (start > end) throw new Error('core_payroll:sick_leave_invalid_range');
    if (end < first || start > last) continue;
    if (String(leave.duration_kind || '').toLowerCase() !== 'full_day') {
      throw new Error('core_payroll:sick_leave_partial_requires_review');
    }
    // A single statutory-year segment allocation cannot be stretched across
    // the employee's next sick year. Require separate HR review/reallocation.
    if (leave.sick_year_start) {
      const yearStart = String(leave.sick_year_start);
      calendarDayNumber(yearStart);
      const nextAnniversary = new Date(`${yearStart}T12:00:00.000Z`);
      const originalMonth = nextAnniversary.getUTCMonth();
      nextAnniversary.setUTCFullYear(nextAnniversary.getUTCFullYear() + 1);
      if (nextAnniversary.getUTCMonth() !== originalMonth) {
        nextAnniversary.setUTCDate(0); // Feb 29 -> Feb 28.
      }
      const yearEndDay = Math.floor(nextAnniversary.getTime() / 86400000);
      if (start < calendarDayNumber(yearStart) || end >= yearEndDay) {
        throw new Error('core_payroll:sick_leave_crosses_statutory_year');
      }
    }
    const rates = requiredSegments(leave, end - start + 1);
    for (let day = Math.max(start, first); day <= Math.min(end, last); day += 1) {
      const dayKey = new Date(day * 86400000).toISOString().slice(0, 10);
      if (recalledLeaveDates.has(`${leave.id}|${dayKey}`)) continue;
      if (seen.has(dayKey)) {
        throw new Error('core_payroll:sick_leave_overlapping_approved_dates');
      }
      seen.add(dayKey);
      const overlap = leaves.some((candidate) =>
        candidate !== leave &&
        String(candidate.status || '').toLowerCase() === 'approved' &&
        String(candidate.start_date || '') <= dayKey &&
        String(candidate.end_date || '') >= dayKey &&
        !recalledLeaveDates.has(`${candidate.id}|${dayKey}`)
      );
      if (overlap) {
        throw new Error('core_payroll:sick_leave_overlapping_approved_leave');
      }
      const reduction = 10000 - rates[day - start];
      unitsBps += reduction;
      if (reduction > 0) affectedDays += 1;
    }
  }
  return { unpaidEquivalentDays: unitsBps / 10000, affectedDays };
}
