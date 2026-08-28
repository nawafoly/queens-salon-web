// CORE D1 ONLY — atomic consumption/reversal of non-annual time entitlements.
// Annual leave is never touched here. Overtime comp and weekly-rest substitute
// consume their own minute ledgers and remain fully auditable.

import {
  changes,
  cleanText,
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
import { SA_LEAVE_TYPES } from '../../../src/helpers/hr/saLeaveEntitlements.js';
import { WEEKLY_REST_MINUTES } from './weekly-rest-entitlements.js';

function actorField(actor, field) {
  return optionalText(actor?.[field]) || null;
}

function entitlementForLeaveType(value) {
  const leaveType = cleanText(value).toLowerCase();
  if (leaveType === SA_LEAVE_TYPES.overtimeCompTimeUse) {
    return {
      leaveType,
      entitlementType: 'overtime_comp',
      requiredMinutes: null,
    };
  }
  if (leaveType === SA_LEAVE_TYPES.weeklyRestSubstituteUse) {
    return {
      leaveType,
      entitlementType: 'weekly_rest_due',
      requiredMinutes: WEEKLY_REST_MINUTES,
    };
  }
  throw new AppError(409, 'core_leave:not_time_entitlement_leave');
}

function requestedMinutes(leave, entitlement) {
  const minutes = Number(leave?.entitlement_minutes_requested || 0);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new AppError(409, 'core_leave:entitlement_minutes_required');
  }
  if (entitlement.requiredMinutes != null && minutes !== entitlement.requiredMinutes) {
    throw new AppError(409, 'core_leave:weekly_rest_requires_24h_block');
  }
  return minutes;
}

async function ensureBalanceRow(db, salonId, employeeId, entitlementType) {
  const now = nowIso();
  await dbRun(
    db,
    `INSERT OR IGNORE INTO employee_comp_time_balances (
       salon_id, employee_id, entitlement_type, balance_minutes,
       last_entry_id, version, updated_at
     ) VALUES (?, ?, ?, 0, NULL, 0, ?)`,
    [salonId, employeeId, entitlementType, now]
  );
  const row = await dbFirst(
    db,
    `SELECT * FROM employee_comp_time_balances
      WHERE salon_id = ? AND employee_id = ? AND entitlement_type = ?
      LIMIT 1`,
    [salonId, employeeId, entitlementType]
  );
  if (!row) throw new AppError(500, 'core_comp_time:balance_state_missing');
  return row;
}

async function leaveById(db, salonId, leaveId) {
  return dbFirst(
    db,
    `SELECT * FROM employee_leaves
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, leaveId]
  );
}

async function ledgerByLeave(db, salonId, entitlementType, leaveId) {
  return dbFirst(
    db,
    `SELECT * FROM employee_comp_time_ledger
      WHERE salon_id = ? AND entitlement_type = ?
        AND source_type = 'leave_request' AND source_id = ?
        AND entry_kind = 'debit'
      LIMIT 1`,
    [salonId, entitlementType, leaveId]
  );
}

async function reversalByEntry(db, salonId, entitlementType, entryId) {
  return dbFirst(
    db,
    `SELECT * FROM employee_comp_time_ledger
      WHERE salon_id = ? AND entitlement_type = ?
        AND source_type = 'reversal' AND source_id = ?
        AND entry_kind = 'reversal'
      LIMIT 1`,
    [salonId, entitlementType, entryId]
  );
}

export async function approveTimeEntitlementLeave(
  db,
  salonId,
  leaveValue,
  decision = {},
  actor = {}
) {
  const leave = typeof leaveValue === 'object' && leaveValue
    ? leaveValue
    : await leaveById(db, salonId, requiredId(leaveValue, 'leaveId'));
  if (!leave) throw new AppError(404, 'core_leave:not_found');

  const entitlement = entitlementForLeaveType(leave.leave_type);
  const minutes = requestedMinutes(leave, entitlement);
  const currentStatus = cleanText(leave.status).toLowerCase();
  const existing = await ledgerByLeave(db, salonId, entitlement.entitlementType, leave.id);

  if (currentStatus === 'approved' && existing) {
    return {
      leave,
      ledgerEntry: existing,
      idempotent: true,
    };
  }
  if (currentStatus !== 'pending') {
    throw new AppError(409, 'core_leave:approval_requires_pending');
  }
  if (existing) {
    throw new AppError(409, 'core_leave:entitlement_consumption_state_drift');
  }

  const employeeId = requiredId(leave.employee_id, 'employeeId');
  const state = await ensureBalanceRow(
    db,
    salonId,
    employeeId,
    entitlement.entitlementType
  );
  const before = Number(state.balance_minutes || 0);
  if (before < minutes) {
    throw new AppError(409, 'core_comp_time:insufficient_balance');
  }

  const after = before - minutes;
  const entryId = generatedId('comp_time_entry');
  const now = nowIso();
  const note =
    optionalText(decision.hrNote || decision.hr_note || leave.employee_note) || null;

  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_comp_time_balances
               SET balance_minutes = ?, last_entry_id = ?,
                   version = version + 1, updated_at = ?
             WHERE salon_id = ? AND employee_id = ? AND entitlement_type = ?
               AND version = ? AND balance_minutes = ?`,
      params: [
        after,
        entryId,
        now,
        salonId,
        employeeId,
        entitlement.entitlementType,
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
            SELECT ?, ?, ?, ?, 'debit', ?, ?, ?, ?, NULL, ?,
                   'leave_request', ?, NULL, NULL, NULL, ?, ?, ?, ?, ?
              FROM employee_comp_time_balances balance
             WHERE balance.salon_id = ? AND balance.employee_id = ?
               AND balance.entitlement_type = ? AND balance.last_entry_id = ?
               AND NOT EXISTS (
                 SELECT 1 FROM employee_comp_time_ledger existing
                  WHERE existing.salon_id = ?
                    AND existing.entitlement_type = ?
                    AND existing.source_type = 'leave_request'
                    AND existing.source_id = ?
                    AND existing.entry_kind = 'debit'
               )`,
      params: [
        entryId,
        salonId,
        employeeId,
        entitlement.entitlementType,
        minutes,
        minutes,
        before,
        after,
        cleanText(leave.start_date) || null,
        leave.id,
        SA_LABOR_POLICY_VERSION,
        note,
        actorField(actor, 'uid'),
        actorField(actor, 'email'),
        now,
        salonId,
        employeeId,
        entitlement.entitlementType,
        entryId,
        salonId,
        entitlement.entitlementType,
        leave.id,
      ],
    },
    {
      sql: `UPDATE employee_leaves
               SET status = 'approved',
                   entitlement_minutes_applied = ?,
                   entitlement_ledger_entry_id = ?,
                   entitlement_source_type = 'comp_time_ledger',
                   entitlement_source_id = ?,
                   documentation_status = 'verified',
                   statutory_review_required = 0,
                   deduct_from_balance = 0,
                   affects_payroll = 0,
                   hr_note = ?,
                   decided_at = ?,
                   decided_by_uid = ?,
                   decided_by_email = ?,
                   decided_by_name = ?,
                   updated_at = ?
             WHERE salon_id = ? AND id = ? AND employee_id = ?
               AND leave_type = ? AND status = 'pending'
               AND entitlement_ledger_entry_id IS NULL
               AND EXISTS (
                 SELECT 1 FROM employee_comp_time_ledger ledger
                  WHERE ledger.salon_id = ? AND ledger.id = ?
                    AND ledger.employee_id = ?
                    AND ledger.entitlement_type = ?
                    AND ledger.entry_kind = 'debit'
               )`,
      params: [
        minutes,
        entryId,
        entryId,
        note,
        now,
        actorField(actor, 'uid'),
        actorField(actor, 'email'),
        actorField(actor, 'name'),
        now,
        salonId,
        leave.id,
        employeeId,
        entitlement.leaveType,
        salonId,
        entryId,
        employeeId,
        entitlement.entitlementType,
      ],
    },
  ]);

  if (
    changes(results?.[0]) !== 1 ||
    changes(results?.[1]) !== 1 ||
    changes(results?.[2]) !== 1
  ) {
    const latest = await leaveById(db, salonId, leave.id);
    const raced = await ledgerByLeave(
      db,
      salonId,
      entitlement.entitlementType,
      leave.id
    );
    if (cleanText(latest?.status) === 'approved' && raced) {
      return { leave: latest, ledgerEntry: raced, idempotent: true };
    }
    throw new AppError(409, 'core_leave:entitlement_consumption_concurrency_conflict');
  }

  return {
    leave: await leaveById(db, salonId, leave.id),
    ledgerEntry: await dbFirst(
      db,
      `SELECT * FROM employee_comp_time_ledger
        WHERE salon_id = ? AND id = ? LIMIT 1`,
      [salonId, entryId]
    ),
    idempotent: false,
  };
}

export async function cancelTimeEntitlementLeave(
  db,
  salonId,
  leaveValue,
  decision = {},
  actor = {}
) {
  const leave = typeof leaveValue === 'object' && leaveValue
    ? leaveValue
    : await leaveById(db, salonId, requiredId(leaveValue, 'leaveId'));
  if (!leave) throw new AppError(404, 'core_leave:not_found');

  const entitlement = entitlementForLeaveType(leave.leave_type);
  if (cleanText(leave.status).toLowerCase() !== 'approved') {
    throw new AppError(409, 'core_leave:cancellation_requires_approved');
  }

  const original = await ledgerByLeave(
    db,
    salonId,
    entitlement.entitlementType,
    leave.id
  );
  if (!original || cleanText(original.id) !== cleanText(leave.entitlement_ledger_entry_id)) {
    throw new AppError(409, 'core_leave:entitlement_ledger_missing');
  }

  const existingReversal = await reversalByEntry(
    db,
    salonId,
    entitlement.entitlementType,
    original.id
  );
  if (existingReversal) {
    const latest = await leaveById(db, salonId, leave.id);
    if (cleanText(latest?.status) === 'rejected') {
      return {
        leave: latest,
        originalLedgerEntry: original,
        reversalLedgerEntry: existingReversal,
        idempotent: true,
      };
    }
    throw new AppError(409, 'core_leave:entitlement_reversal_state_drift');
  }

  const employeeId = requiredId(leave.employee_id, 'employeeId');
  const minutes = Number(original.minutes || 0);
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new AppError(409, 'core_leave:invalid_entitlement_ledger_minutes');
  }

  const state = await ensureBalanceRow(
    db,
    salonId,
    employeeId,
    entitlement.entitlementType
  );
  const before = Number(state.balance_minutes || 0);
  const after = before + minutes;
  const reversalId = generatedId('comp_time_reversal');
  const now = nowIso();
  const note =
    optionalText(decision.hrNote || decision.hr_note) ||
    `Reversal of leave entitlement consumption ${leave.id}`;

  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_comp_time_balances
               SET balance_minutes = ?, last_entry_id = ?,
                   version = version + 1, updated_at = ?
             WHERE salon_id = ? AND employee_id = ? AND entitlement_type = ?
               AND version = ? AND balance_minutes = ?`,
      params: [
        after,
        reversalId,
        now,
        salonId,
        employeeId,
        entitlement.entitlementType,
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
            SELECT ?, ?, ?, ?, 'reversal', ?, ?, ?, ?,
                   conversion_ratio_milli, source_date,
                   'reversal', id, employee_consent_at,
                   employee_consent_reference, expires_at, ?, ?, ?, ?, ?
              FROM employee_comp_time_ledger original
             WHERE original.salon_id = ? AND original.id = ?
               AND original.employee_id = ?
               AND original.entitlement_type = ?
               AND original.entry_kind = 'debit'
               AND NOT EXISTS (
                 SELECT 1 FROM employee_comp_time_ledger existing
                  WHERE existing.salon_id = ?
                    AND existing.entitlement_type = ?
                    AND existing.source_type = 'reversal'
                    AND existing.source_id = original.id
                    AND existing.entry_kind = 'reversal'
               )`,
      params: [
        reversalId,
        salonId,
        employeeId,
        entitlement.entitlementType,
        minutes,
        Number(original.source_minutes || minutes),
        before,
        after,
        SA_LABOR_POLICY_VERSION,
        note,
        actorField(actor, 'uid'),
        actorField(actor, 'email'),
        now,
        salonId,
        original.id,
        employeeId,
        entitlement.entitlementType,
        salonId,
        entitlement.entitlementType,
      ],
    },
    {
      sql: `UPDATE employee_leaves
               SET status = 'rejected',
                   entitlement_source_type = 'comp_time_ledger_reversal',
                   entitlement_source_id = ?,
                   hr_note = ?,
                   decided_at = ?,
                   decided_by_uid = ?,
                   decided_by_email = ?,
                   decided_by_name = ?,
                   updated_at = ?
             WHERE salon_id = ? AND id = ? AND employee_id = ?
               AND leave_type = ? AND status = 'approved'
               AND entitlement_ledger_entry_id = ?
               AND EXISTS (
                 SELECT 1 FROM employee_comp_time_ledger reversal
                  WHERE reversal.salon_id = ? AND reversal.id = ?
                    AND reversal.entry_kind = 'reversal'
                    AND reversal.source_type = 'reversal'
                    AND reversal.source_id = ?
               )`,
      params: [
        reversalId,
        note,
        now,
        actorField(actor, 'uid'),
        actorField(actor, 'email'),
        actorField(actor, 'name'),
        now,
        salonId,
        leave.id,
        employeeId,
        entitlement.leaveType,
        original.id,
        salonId,
        reversalId,
        original.id,
      ],
    },
  ]);

  if (
    changes(results?.[0]) !== 1 ||
    changes(results?.[1]) !== 1 ||
    changes(results?.[2]) !== 1
  ) {
    const latest = await leaveById(db, salonId, leave.id);
    const raced = await reversalByEntry(
      db,
      salonId,
      entitlement.entitlementType,
      original.id
    );
    if (cleanText(latest?.status) === 'rejected' && raced) {
      return {
        leave: latest,
        originalLedgerEntry: original,
        reversalLedgerEntry: raced,
        idempotent: true,
      };
    }
    throw new AppError(409, 'core_leave:entitlement_reversal_concurrency_conflict');
  }

  return {
    leave: await leaveById(db, salonId, leave.id),
    originalLedgerEntry: original,
    reversalLedgerEntry: await dbFirst(
      db,
      `SELECT * FROM employee_comp_time_ledger
        WHERE salon_id = ? AND id = ? LIMIT 1`,
      [salonId, reversalId]
    ),
    idempotent: false,
  };
}
