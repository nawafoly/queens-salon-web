from pathlib import Path
import re


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'missing expected block: {label} ({path})')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def regex_once(path, pattern, repl, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    text, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'expected one regex match for {label}, got {count} ({path})')
    p.write_text(text, encoding='utf-8')


# Core finance repository: date-scoped, index-friendly income reads.
replace_once(
    'workers/core/repositories/finance.js',
    """function jsonObject(value) {
  if (!value) return '{}';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    } catch {
      return '{}';
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

export async function listIncome(db, salonId) {
  return dbAll(db, 'SELECT * FROM income_entries WHERE salon_id = ? ORDER BY occurred_at DESC LIMIT 500', [salonId]);
}
""",
    """function jsonObject(value) {
  if (!value) return '{}';
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
    } catch {
      return '{}';
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function dateScope(rawDate) {
  const date = cleanText(rawDate);
  if (!date) return null;
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new AppError(400, 'core_finance:invalid_date');
  const startDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== date) {
    throw new AppError(400, 'core_finance:invalid_date');
  }
  const endDate = new Date(startDate.getTime() + 86_400_000);
  return { date, start: startDate.toISOString(), end: endDate.toISOString() };
}

export async function listIncome(db, salonId, query = {}) {
  const scope = dateScope(query.date);
  if (!scope) {
    return dbAll(db, 'SELECT * FROM income_entries WHERE salon_id = ? ORDER BY occurred_at DESC LIMIT 500', [salonId]);
  }

  const occurredRows = await dbAll(
    db,
    `SELECT * FROM income_entries
      WHERE salon_id = ? AND occurred_at >= ? AND occurred_at < ?
      ORDER BY occurred_at DESC LIMIT 500`,
    [salonId, scope.start, scope.end]
  );
  const bookingRows = await dbAll(
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
  return [...byId.values()]
    .sort((a, b) => cleanText(b?.occurred_at).localeCompare(cleanText(a?.occurred_at)))
    .slice(0, 500);
}
""",
    'finance date-scoped income read',
)

# Dispatcher forwards query to the repository.
replace_once(
    'workers/core/index.js',
    '        return listIncome(db, ctx.salonId);',
    '        return listIncome(db, ctx.salonId, query);',
    'income query forwarding',
)

# Refund repository: date scope on refunded_at.
replace_once(
    'workers/core/repositories/refunds.js',
    """function invoiceStatus(total, paid) {
  if (paid <= 0) return 'unpaid';
  if (paid >= total) return 'paid';
  return 'partial';
}
""",
    """function invoiceStatus(total, paid) {
  if (paid <= 0) return 'unpaid';
  if (paid >= total) return 'paid';
  return 'partial';
}

function refundDateScope(rawDate) {
  const date = cleanText(rawDate);
  if (!date) return null;
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new AppError(400, 'core_refund:invalid_date');
  const startDate = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(startDate.getTime()) || startDate.toISOString().slice(0, 10) !== date) {
    throw new AppError(400, 'core_refund:invalid_date');
  }
  return {
    start: startDate.toISOString(),
    end: new Date(startDate.getTime() + 86_400_000).toISOString(),
  };
}
""",
    'refund date scope helper',
)
replace_once(
    'workers/core/repositories/refunds.js',
    """  if (optionalText(query.paymentId || query.payment_id)) {
    where.push('payment_id = ?');
    params.push(cleanText(query.paymentId || query.payment_id));
  }
  return dbAll(db, `SELECT * FROM refunds WHERE ${where.join(' AND ')} ORDER BY refunded_at DESC LIMIT 500`, params);
""",
    """  if (optionalText(query.paymentId || query.payment_id)) {
    where.push('payment_id = ?');
    params.push(cleanText(query.paymentId || query.payment_id));
  }
  const date = refundDateScope(query.date);
  if (date) {
    where.push('refunded_at >= ? AND refunded_at < ?');
    params.push(date.start, date.end);
  }
  return dbAll(db, `SELECT * FROM refunds WHERE ${where.join(' AND ')} ORDER BY refunded_at DESC LIMIT 500`, params);
""",
    'refund date filter',
)

# Frontend Core services expose the scoped query.
replace_once(
    'src/services/CoreFinanceService.ts',
    """  async listIncome(): Promise<CoreIncomeEntry[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/income"
    );
    return rows.map(mapCoreIncome);
  },
""",
    """  async listIncome(query: { date?: string } = {}): Promise<CoreIncomeEntry[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/income",
      { query }
    );
    return rows.map(mapCoreIncome);
  },
""",
    'CoreFinanceService scoped income',
)
replace_once(
    'src/services/CoreRefundService.ts',
    '  async list(query: { bookingId?: string; paymentId?: string } = {}): Promise<CoreRefund[]> {',
    '  async list(query: { bookingId?: string; paymentId?: string; date?: string } = {}): Promise<CoreRefund[]> {',
    'CoreRefundService date query',
)

# Shared income mapper plus date-scoped facade.
regex_once(
    'src/services/CoreIncomeService.ts',
    r'''export async function listAllIncomeCore\(\): Promise<IncomeItem\[]> \{\n  const \[incomeRows, refundRows\] = await Promise\.all\(\[\n    CoreFinanceService\.listIncome\(\),\n    CoreRefundService\.list\(\),\n  \]\);\n\n  const income = incomeRows\.map\(coreIncomeToLegacy\);\n  const existingIds = new Set\(income\.map\(\(item\) => String\(item\.id \|\| ""\)\.trim\(\)\)\);\n  const refunds = refundRows\n    \.filter\(\(row\) => String\(row\.status \|\| "completed"\)\.trim\(\)\.toLowerCase\(\) === "completed"\)\n    \.filter\(\(row\) => !existingIds\.has\(String\(row\.id \|\| ""\)\.trim\(\)\)\)\n    \.map\(coreRefundToLegacy\);\n\n  return \[\.\.\.income, \.\.\.refunds\]\.sort\(\n    \(a, b\) => Number\(b\.createdAt \|\| 0\) - Number\(a\.createdAt \|\| 0\)\n  \);\n\}''',
    '''function mergeCoreIncomeRows(\n  incomeRows: import("../types/coreApi").CoreIncomeEntry[],\n  refundRows: import("../types/coreApi").CoreRefund[]\n): IncomeItem[] {\n  const income = incomeRows.map(coreIncomeToLegacy);\n  const existingIds = new Set(income.map((item) => String(item.id || "").trim()));\n  const refunds = refundRows\n    .filter((row) => String(row.status || "completed").trim().toLowerCase() === "completed")\n    .filter((row) => !existingIds.has(String(row.id || "").trim()))\n    .map(coreRefundToLegacy);\n\n  return [...income, ...refunds].sort(\n    (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)\n  );\n}\n\nexport async function listAllIncomeCore(): Promise<IncomeItem[]> {\n  const [incomeRows, refundRows] = await Promise.all([\n    CoreFinanceService.listIncome(),\n    CoreRefundService.list(),\n  ]);\n  return mergeCoreIncomeRows(incomeRows, refundRows);\n}\n\nexport async function listIncomeForDateCore(date: string): Promise<IncomeItem[]> {\n  const dateKey = String(date || "").trim();\n  const [incomeRows, refundRows] = await Promise.all([\n    CoreFinanceService.listIncome({ date: dateKey }),\n    CoreRefundService.list({ date: dateKey }),\n  ]);\n  return mergeCoreIncomeRows(incomeRows, refundRows);\n}''',
    'CoreIncomeService date-scoped facade',
)

# Day Audit stops loading the full income/refund history.
replace_once(
    'src/pages/DashboardDayAudit.tsx',
    'import { listAllIncomeCore } from "../services/CoreIncomeService";',
    'import { listIncomeForDateCore } from "../services/CoreIncomeService";',
    'DayAudit scoped import',
)
replace_once(
    'src/pages/DashboardDayAudit.tsx',
    '    listAllIncomeCore(),',
    '    listIncomeForDateCore(dateKey),',
    'DayAudit scoped income load',
)

# Migration indexes: avoid scan amplification as finance history grows.
Path('migrations/core/0058_finance_read_scope_indexes.sql').write_text(
    """-- D1 read-scope indexes for date-scoped finance surfaces.\nCREATE INDEX IF NOT EXISTS idx_core_income_booking_occurred\n  ON income_entries(salon_id, booking_id, occurred_at);\n\nCREATE INDEX IF NOT EXISTS idx_core_refunds_refunded\n  ON refunds(salon_id, refunded_at);\n""",
    encoding='utf-8'
)

# Focused regression contract.
Path('workers/d1-finance-read-scope.test.mjs').write_text(
    """import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\n\nconst finance = readFileSync('workers/core/repositories/finance.js', 'utf8');\nconst refunds = readFileSync('workers/core/repositories/refunds.js', 'utf8');\nconst dispatcher = readFileSync('workers/core/index.js', 'utf8');\nconst financeService = readFileSync('src/services/CoreFinanceService.ts', 'utf8');\nconst incomeService = readFileSync('src/services/CoreIncomeService.ts', 'utf8');\nconst dayAudit = readFileSync('src/pages/DashboardDayAudit.tsx', 'utf8');\nconst migration = readFileSync('migrations/core/0058_finance_read_scope_indexes.sql', 'utf8');\n\ntest('day audit uses date-scoped Core finance reads', () => {\n  assert.match(dispatcher, /listIncome\\(db, ctx\\.salonId, query\\)/);\n  assert.match(finance, /occurred_at >= \\? AND occurred_at < \\?/);\n  assert.match(finance, /b\\.booking_date = \\?/);\n  assert.match(refunds, /refunded_at >= \\? AND refunded_at < \\?/);\n  assert.match(financeService, /listIncome\\(query: \\{ date\\?: string \\} = \\{\\}\\)/);\n  assert.match(incomeService, /listIncomeForDateCore/);\n  assert.match(dayAudit, /listIncomeForDateCore\\(dateKey\\)/);\n  assert.doesNotMatch(dayAudit, /listAllIncomeCore/);\n});\n\ntest('finance scope has supporting D1 indexes', () => {\n  assert.match(migration, /income_entries\\(salon_id, booking_id, occurred_at\\)/);\n  assert.match(migration, /refunds\\(salon_id, refunded_at\\)/);\n});\n""",
    encoding='utf-8'
)

# Make the focused contract part of the integrity gate.
replace_once(
    '.github/workflows/operational-integrity-hardening.yml',
    """      - name: Fixed interval polling guard
        run: node scripts/check-fixed-interval-polling.mjs

      - name: Dependency audit
""",
    """      - name: Fixed interval polling guard
        run: node scripts/check-fixed-interval-polling.mjs

      - name: D1 finance read-scope guard
        run: node --test workers/d1-finance-read-scope.test.mjs

      - name: Dependency audit
""",
    'integrity finance scope gate',
)

print('d1 finance read-scope codemod applied')
