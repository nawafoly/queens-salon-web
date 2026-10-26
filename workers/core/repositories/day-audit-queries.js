// MALIKAT Core. Pure SQL builder for bounded financial day-audit reads.
// A cursor must use exactly the same accounting timestamp as filtering/order.

export const DAY_AUDIT_PAGE_SIZE = 250;

export function buildDayAuditPageQuery(kind, salonId, date, cursor = null) {
  if (kind !== 'income' && kind !== 'refund') {
    throw new Error('Invalid day audit row kind');
  }

  const income = kind === 'income';
  const alias = income ? 'i' : 'r';
  const table = income ? 'income_entries' : 'refunds';
  const accountingTimestamp = income
    ? 'i.occurred_at'
    : "COALESCE(NULLIF(TRIM(r.refunded_at), ''), r.created_at)";

  const projection = income
    ? 'i.*, b.booking_date AS booking_date'
    : `r.*, ${accountingTimestamp} AS audit_cursor_timestamp`;

  // A legacy booking may be referenced only by source + income row ID.
  const bookingJoin = income
    ? `LEFT JOIN bookings b
         ON b.salon_id = i.salon_id
        AND b.id = CASE
          WHEN COALESCE(TRIM(i.booking_id), '') <> ''
            THEN i.booking_id
          WHEN LOWER(COALESCE(TRIM(i.source), ''))
            IN ('booking', 'invoice', 'حجز', 'فاتورة')
            THEN i.id
          ELSE NULL
        END`
    : '';

  const params = [salonId, date];
  const cursorClause = cursor
    ? `AND (
         ${accountingTimestamp} < ?
         OR (${accountingTimestamp} = ? AND ${alias}.id < ?)
       )`
    : '';

  if (cursor) {
    if (typeof cursor.timestamp !== 'string' || !cursor.timestamp ||
        typeof cursor.id !== 'string' || !cursor.id) {
      throw new Error('Invalid day audit cursor');
    }
    params.push(cursor.timestamp, cursor.timestamp, cursor.id);
  }

  return {
    sql: `SELECT ${projection}
            FROM ${table} ${alias}
            ${bookingJoin}
           WHERE ${alias}.salon_id = ?
             AND date(${accountingTimestamp}, '+3 hours') = ?
             ${cursorClause}
           ORDER BY ${accountingTimestamp} DESC, ${alias}.id DESC
           LIMIT ${DAY_AUDIT_PAGE_SIZE}`,
    params,
    cursorColumn: income ? 'occurred_at' : 'audit_cursor_timestamp',
  };
}
