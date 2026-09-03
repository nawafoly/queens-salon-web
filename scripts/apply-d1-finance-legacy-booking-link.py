from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'missing expected block: {label} ({path})')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'workers/core/repositories/finance.js',
    """  const bookingRows = await dbAll(
    db,
    `SELECT i.*
       FROM bookings b
       JOIN income_entries i
         ON i.salon_id = b.salon_id AND i.booking_id = b.id
      WHERE b.salon_id = ? AND b.booking_date = ? AND b.deleted_at IS NULL
      ORDER BY i.occurred_at DESC LIMIT 500`,
    [salonId, scope.date]
  );

  const byId = new Map();
  for (const row of [...occurredRows, ...bookingRows]) byId.set(cleanText(row?.id), row);
""",
    """  const bookingRows = await dbAll(
    db,
    `SELECT i.*
       FROM bookings b
       JOIN income_entries i
         ON i.salon_id = b.salon_id AND i.booking_id = b.id
      WHERE b.salon_id = ? AND b.booking_date = ? AND b.deleted_at IS NULL
      ORDER BY i.occurred_at DESC LIMIT 500`,
    [salonId, scope.date]
  );
  const legacyBookingRows = await dbAll(
    db,
    `SELECT i.*
       FROM bookings b
       JOIN income_entries i
         ON i.salon_id = b.salon_id AND i.id = b.id
      WHERE b.salon_id = ? AND b.booking_date = ? AND b.deleted_at IS NULL
        AND (i.booking_id IS NULL OR TRIM(i.booking_id) = '')
        AND LOWER(TRIM(COALESCE(i.source, ''))) IN ('booking', 'invoice', 'حجز', 'فاتورة')
      ORDER BY i.occurred_at DESC LIMIT 500`,
    [salonId, scope.date]
  );

  const byId = new Map();
  for (const row of [...occurredRows, ...bookingRows, ...legacyBookingRows]) byId.set(cleanText(row?.id), row);
""",
    'legacy document-id booking linkage',
)

replace_once(
    'workers/d1-finance-read-scope.test.mjs',
    """  assert.match(finance, /b\\.booking_date = \\?/);
  assert.match(refunds, /refunded_at = \\? OR \\(refunded_at >= \\? AND refunded_at < \\?\\)/);
""",
    """  assert.match(finance, /b\\.booking_date = \\?/);
  assert.match(finance, /i\\.id = b\\.id/);
  assert.match(finance, /i\\.booking_id IS NULL OR TRIM\\(i\\.booking_id\\) = ''/);
  assert.match(finance, /'booking', 'invoice', 'حجز', 'فاتورة'/);
  assert.match(refunds, /refunded_at = \\? OR \\(refunded_at >= \\? AND refunded_at < \\?\\)/);
""",
    'legacy booking-link regression contract',
)

print('legacy booking-link compatibility applied')
