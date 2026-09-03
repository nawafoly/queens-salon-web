from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'missing expected block: {label} ({path})')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'workers/core/repositories/finance.js',
    """    `SELECT * FROM income_entries
      WHERE salon_id = ? AND occurred_at >= ? AND occurred_at < ?
      ORDER BY occurred_at DESC LIMIT 500`,
    [salonId, scope.start, scope.end]
""",
    """    `SELECT * FROM income_entries
      WHERE salon_id = ? AND (occurred_at = ? OR (occurred_at >= ? AND occurred_at < ?))
      ORDER BY occurred_at DESC LIMIT 500`,
    [salonId, scope.date, scope.start, scope.end]
""",
    'legacy date-only income compatibility',
)

replace_once(
    'workers/core/repositories/refunds.js',
    """  return {
    start: startDate.toISOString(),
    end: new Date(startDate.getTime() + 86_400_000).toISOString(),
  };
""",
    """  return {
    date,
    start: startDate.toISOString(),
    end: new Date(startDate.getTime() + 86_400_000).toISOString(),
  };
""",
    'refund date scope value',
)
replace_once(
    'workers/core/repositories/refunds.js',
    """  if (date) {
    where.push('refunded_at >= ? AND refunded_at < ?');
    params.push(date.start, date.end);
  }
""",
    """  if (date) {
    where.push('(refunded_at = ? OR (refunded_at >= ? AND refunded_at < ?))');
    params.push(date.date, date.start, date.end);
  }
""",
    'legacy date-only refund compatibility',
)

replace_once(
    'workers/d1-finance-read-scope.test.mjs',
    """  assert.match(finance, /occurred_at >= \\? AND occurred_at < \\?/);
  assert.match(finance, /b\\.booking_date = \\?/);
  assert.match(refunds, /refunded_at >= \\? AND refunded_at < \\?/);
""",
    """  assert.match(finance, /occurred_at = \\? OR \\(occurred_at >= \\? AND occurred_at < \\?\\)/);
  assert.match(finance, /b\\.booking_date = \\?/);
  assert.match(refunds, /refunded_at = \\? OR \\(refunded_at >= \\? AND refunded_at < \\?\\)/);
""",
    'legacy date-only regression contract',
)

print('legacy finance date compatibility applied')
