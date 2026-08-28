// CORE D1 ONLY — canonical non-cash time entitlement ledger.
// Annual leave is intentionally excluded. Overtime comp, weekly-rest due and
// public-holiday overlap due remain separate legal/operational buckets.

import {
  changes,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import { SA_LABOR_POLICY_VERSION } from '../../../src/helpers/hr/saLaborPolicy.js';

const ENTITLEMENT_TYPES = new Set([
  'overtime_comp',
  'weekly_rest_due',
  'public_holiday_overlap_due',
]);

function entitlementType(value) {
  const type = cleanText(value).toLowerCase();
  if (!ENTITLEMENT_TYPES.has(type)) {
    throw new AppError(400, 'core_comp_time:invalid_entitlement_type');
  }
  return type;
}

function positiveMinutes(value) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 60 * 24 * 366) {
    throw new AppError(400, 'core_comp_time:invalid_minutes');
  }
  return minutes;
}

function sourceType(value) {
  const source = cleanText(value);
  if (!source || source.length > 120) {
    throw new AppError(400, 'core_comp_time:source_type_required');
  }
  return source;
}

function sourceId(value) {
  const id = cleanText(value);
  if (!id || id.length > 240) {
    throw new AppError(400, 'core_comp_time:source_id_required');
  }
  return id;
}

async function ensureBalanceRow(db, salonId, employeeId, type) {
  const now = nowIso();
  await dbRun(
    db,
    `INSERT OR IGNORE INTO employee_comp_time_balances (
       salon_id, employee_id, entitlement_type, balance_minutes,
       last_entry_id, version, updated_at
     ) VALUES (?, ?, ?, 0, NULL, 0, ?)`,
    [salonId, employeeId, type, now]
  );
  const row = await dbFirst(
    db,
    `SELECT * FROM employee_comp_time_balances
      WHERE salon_id = ? AND employee_id = ? AND entitlement_type = ?
      LIMIT 1`,
    [salonId, employeeId, type]
  );
  if (!row) throw new AppError(500, 'core_comp_time:balance_state_missing');
  return row;
}

async function existingSourceEntry(db, salonId, type, sourceTypeValue, sourceIdValue, entryKind) {
  return dbFirst(
    db,
    `SELECT * FROM employee_comp_time_ledger
      WHERE salon_id = ? AND entitlement_type = ?
        AND source_type = ? AND source_id = ? AND entry_kind = ?
      LIMIT 1`,
    [salonId, type, sourceTypeValue, sourceIdValue, entryKind]
  );
}

export async function getCompTimeBalanceState(
  db,
  salonId,
  employeeIdValue,
  entitlementTypeValue
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const type = entitlementType(entitlementTypeValue);
  const row = await ensureBalanceRow(db, salonId, employeeId, type);
  return {
    salonId,
    employeeId,
    entitlementType: type,
    balanceMinutes: Number(row.balance_minutes || 0),
    lastEntryId: cleanText(row.last_entry_id) || null,
    version: Number(row.version || 0),
    updatedAt: row.updated_at,
  };
}

export async function listCompTimeLedger(db, salonId, query = {}) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const typeRaw = cleanText(query.entitlementType || query.entitlement_type);
  const clauses = ['salon_id = ?'];
  const params = [salonId];
  if (employeeId) {
    clauses.push('employee_id = ?');
    params.push(employeeId);
  }
  if (typeRaw) {
    clauses.push('entitlement_type = ?');
    params.push(entitlementType(typeRaw));
  }
  return dbAll(
    db,
    `SELECT * FROM employee_comp_time_ledger
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC, id DESC LIMIT 1000`,
    params
  );
}

async function mutateEntitlement(
  db,
  salonId,
  data = {},
  actor = {},
  entryKind
) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const type = entitlementType(data.entitlementType || data.entitlement_type);
  const minutes = positiveMinutes(data.minutes);
  const sourceTypeValue = sourceType(data.sourceType || data.source_type);
  const sourceIdValue = sourceId(data.sourceId || data.source_id);

  const existing = await existingSourceEntry(
    db,
    salonId,
    type,
    sourceTypeValue,
    sourceIdValue,
    entryKind
  );
  if (existing) {
    return {
      entry: existing,
      state: await getCompTimeBalanceState(db, salonId, employeeId, type),
      idempotent: true,
    };
  }

  const state = await ensureBalanceRow(db, salonId, employeeId, type);
  const before = Number(state.balance_minutes || 0);
  if (entryKind === 'debit' && before < minutes) {
    throw new AppError(409, 'core_comp_time:insufficient_balance');
  }
  const after = entryKind === 'credit' ? before + minutes : before - minutes;
  const entryId = requiredId(data.id || generatedId('comp_time_entry'), 'entryId');
  const now = nowIso();
  const actorUid = cleanText(actor.uid) || null;
  const actorEmail = cleanText(actor.email) || null;
  const expiresAt = cleanText(data.expiresAt || data.expires_at) || null;
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) {
    throw new AppError(400, 'core_comp_time:invalid_expires_at');
  }
  const consentAt = cleanText(data.employeeConsentAt || data.employee_consent_at) || null;
  if (consentAt && !Number.isFinite(Date.parse(consentAt))) {
    throw new AppError(400, 'core_comp_time:invalid_employee_consent_at');
  }

  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_comp_time_balances
               SET balance_minutes = ?, last_entry_id = ?, version = version + 1, updated_at = ?
             WHERE salon_id = ? AND employee_id = ? AND entitlement_type = ?
               AND version = ? AND balance_minutes = ?`,
      params: [
        after,
        entryId,
        now,
        salonId,
        employeeId,
        type,
        Number(state.version || 0),
        before,
      ],
    },
    {
      sql: `INSERT INTO employee_comp_time_ledger (
              id, salon_id, employee_id, entitlement_type, entry_kind,
              minutes, source_minutes, balance_before_minutes, balance_after_minutes,
              conversion_ratio_milli, source_date, source_type, source_id,
              employee_consent_at, employee_consent_reference, expires_at,
              policy_version, note, created_by_uid, created_by_email, created_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            FROM employee_comp_time_balances balance
            WHERE balance.salon_id = ? AND balance.employee_id = ?
              AND balance.entitlement_type = ? AND balance.last_entry_id = ?
              AND NOT EXISTS (
                SELECT 1 FROM employee_comp_time_ledger existing
                WHERE existing.salon_id = ? AND existing.entitlement_type = ?
                  AND existing.source_type = ? AND existing.source_id = ?
                  AND existing.entry_kind = ?
              )`,
      params: [
        entryId,
        salonId,
        employeeId,
        type,
        entryKind,
        minutes,
        Math.max(0, Math.round(Number(data.sourceMinutes || data.source_minutes || 0) || 0)),
        before,
        after,
        data.conversionRatioMilli == null && data.conversion_ratio_milli == null
          ? null
          : Math.max(0, Math.round(Number(data.conversionRatioMilli ?? data.conversion_ratio_milli) || 0)),
        cleanText(data.sourceDate || data.source_date) || null,
        sourceTypeValue,
        sourceIdValue,
        consentAt,
        cleanText(data.employeeConsentReference || data.employee_consent_reference) || null,
        expiresAt,
        cleanText(data.policyVersion || data.policy_version) || SA_LABOR_POLICY_VERSION,
        optionalText(data.note) || null,
        actorUid,
        actorEmail,
        now,
        salonId,
        employeeId,
        type,
        entryId,
        salonId,
        type,
        sourceTypeValue,
        sourceIdValue,
        entryKind,
      ],
    },
  ]);

  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1) {
    const raced = await existingSourceEntry(
      db,
      salonId,
      type,
      sourceTypeValue,
      sourceIdValue,
      entryKind
    );
    if (raced) {
      return {
        entry: raced,
        state: await getCompTimeBalanceState(db, salonId, employeeId, type),
        idempotent: true,
      };
    }
    throw new AppError(409, 'core_comp_time:concurrency_conflict');
  }

  const entry = await dbFirst(
    db,
    `SELECT * FROM employee_comp_time_ledger WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, entryId]
  );
  return {
    entry,
    state: await getCompTimeBalanceState(db, salonId, employeeId, type),
    idempotent: false,
  };
}

export async function creditCompTime(db, salonId, data = {}, actor = {}) {
  return mutateEntitlement(db, salonId, data, actor, 'credit');
}

export async function debitCompTime(db, salonId, data = {}, actor = {}) {
  return mutateEntitlement(db, salonId, data, actor, 'debit');
}

export { ENTITLEMENT_TYPES };
