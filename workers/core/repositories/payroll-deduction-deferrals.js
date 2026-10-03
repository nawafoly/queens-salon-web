// CORE D1 ONLY — canonical partial payroll deduction deferrals.
//
// This domain records amounts intentionally not collected in a source payroll
// month. The future collection is represented by a canonical payroll
// obligation. Attendance-specific deferrals remain a separate domain.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  buildCanonicalPayrollObligationCreate,
} from './payroll-obligations.js';
import {
  normalizePayrollMonth,
} from '../../../src/helpers/hr/payrollObligationPolicy.js';

function payrollMonthValue(value) {
  try {
    return normalizePayrollMonth(value);
  } catch (error) {
    const code = cleanText(error?.message) || 'payroll_month_invalid';
    throw new AppError(
      400,
      code.startsWith('core_payroll:') ? code : `core_payroll:${code}`
    );
  }
}

function amountValue(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError(
      400,
      'core_payroll:partial_deduction_deferral_amount_invalid'
    );
  }
  return amount;
}

function requestKeyValue(value) {
  const requestKey = requiredId(value, 'requestKey');
  if (requestKey.length > 128) {
    throw new AppError(
      400,
      'core_payroll:partial_deduction_deferral_request_key_invalid'
    );
  }
  return requestKey;
}

function deferralDto(row) {
  return {
    id: row.id,
    salonId: row.salon_id,
    employeeId: row.employee_id,
    requestKey: row.request_key,
    sourcePayrollMonth: row.source_payroll_month,
    targetPayrollMonth: row.target_payroll_month,
    amountHalalas: Number(row.amount_halalas || 0),
    status: row.status,
    reason: row.reason,
    note: row.note || null,
    obligationId: row.obligation_id || null,
    createdByUid: row.created_by_uid || null,
    createdByEmail: row.created_by_email || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledByUid: row.cancelled_by_uid || null,
    cancelledByEmail: row.cancelled_by_email || null,
    cancelledAt: row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || null,
  };
}

function fakeDeferralRows(db) {
  if (!db?.__fakeD1 || typeof db.rows !== 'function') return null;
  try {
    return db.rows('payroll_deduction_deferrals');
  } catch {
    // Older broad Core fake fixtures predate this table. Treat the absent
    // fixture table as an empty deferral ledger so unrelated payroll tests
    // continue exercising their original behavior. Real D1 never uses this path.
    return [];
  }
}

export async function listPayrollDeductionDeferrals(
  db,
  salonId,
  query = {}
) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const sourcePayrollMonth = cleanText(
    query.sourcePayrollMonth || query.source_payroll_month
  );
  const status = cleanText(query.status).toLowerCase();

  const fakeRows = fakeDeferralRows(db);
  if (fakeRows) {
    return fakeRows
      .filter((row) => row.salon_id === salonId)
      .filter((row) => !employeeId || row.employee_id === employeeId)
      .filter(
        (row) =>
          !sourcePayrollMonth ||
          row.source_payroll_month === payrollMonthValue(sourcePayrollMonth)
      )
      .filter((row) => !status || cleanText(row.status).toLowerCase() === status)
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      .map(deferralDto);
  }

  const clauses = ['salon_id = ?'];
  const params = [salonId];

  if (employeeId) {
    clauses.push('employee_id = ?');
    params.push(employeeId);
  }

  if (sourcePayrollMonth) {
    clauses.push('source_payroll_month = ?');
    params.push(payrollMonthValue(sourcePayrollMonth));
  }

  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }

  const rows = await dbAll(
    db,
    `SELECT *
       FROM payroll_deduction_deferrals
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at ASC`,
    params
  );

  return rows.map(deferralDto);
}

export async function getActivePayrollDeductionDeferralTotal(
  db,
  salonId,
  query = {}
) {
  const employeeId = requiredId(
    query.employeeId || query.employee_id,
    'employeeId'
  );

  const sourcePayrollMonth = payrollMonthValue(
    query.sourcePayrollMonth ||
      query.source_payroll_month ||
      query.payrollMonth ||
      query.payroll_month
  );

  const fakeRows = fakeDeferralRows(db);
  if (fakeRows) {
    return fakeRows.reduce((total, row) => {
      if (
        row.salon_id !== salonId ||
        row.employee_id !== employeeId ||
        row.source_payroll_month !== sourcePayrollMonth ||
        cleanText(row.status).toLowerCase() !== 'active'
      ) {
        return total;
      }
      const amount = Number(row.amount_halalas || 0);
      return total + (Number.isSafeInteger(amount) && amount > 0 ? amount : 0);
    }, 0);
  }

  const row = await dbFirst(
    db,
    `SELECT COALESCE(SUM(amount_halalas), 0) AS amount_halalas
       FROM payroll_deduction_deferrals
      WHERE salon_id = ?
        AND employee_id = ?
        AND source_payroll_month = ?
        AND status = 'active'`,
    [salonId, employeeId, sourcePayrollMonth]
  );

  const amountHalalas = Number(row?.amount_halalas || 0);

  if (!Number.isSafeInteger(amountHalalas) || amountHalalas < 0) {
    throw new AppError(
      500,
      'core_payroll:partial_deduction_deferral_total_invalid'
    );
  }

  return amountHalalas;
}

export async function findPayrollDeductionDeferralByRequest(
  db,
  salonId,
  employeeIdValue,
  requestKeyValueInput
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const requestKey = requestKeyValue(requestKeyValueInput);

  const fakeRows = fakeDeferralRows(db);
  if (fakeRows) {
    const row = fakeRows.find(
      (item) =>
        item.salon_id === salonId &&
        item.employee_id === employeeId &&
        item.request_key === requestKey
    );
    return row ? deferralDto(row) : null;
  }

  const row = await dbFirst(
    db,
    `SELECT *
       FROM payroll_deduction_deferrals
      WHERE salon_id = ?
        AND employee_id = ?
        AND request_key = ?
      LIMIT 1`,
    [salonId, employeeId, requestKey]
  );

  return row ? deferralDto(row) : null;
}

export async function createPayrollDeductionDeferralRecord(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(
    data.employeeId || data.employee_id,
    'employeeId'
  );

  const requestKey = requestKeyValue(
    data.requestKey || data.request_key
  );

  const sourcePayrollMonth = payrollMonthValue(
    data.sourcePayrollMonth ||
      data.source_payroll_month ||
      data.originalPayrollMonth ||
      data.original_payroll_month
  );

  const targetPayrollMonth = payrollMonthValue(
    data.targetPayrollMonth || data.target_payroll_month
  );

  if (targetPayrollMonth <= sourcePayrollMonth) {
    throw new AppError(
      400,
      'core_payroll:partial_deduction_deferral_target_month_invalid'
    );
  }

  const amountHalalas = amountValue(
    data.amountHalalas ?? data.amount_halalas
  );

  const reason = requiredText(data.reason, 'reason', 500);
  const note = optionalText(data.note) || null;

  const actorUid = cleanText(
    actor?.uid || actor?.identity?.uid
  );

  if (!actorUid) {
    throw new AppError(
      403,
      'core_payroll:partial_deduction_deferral_actor_required'
    );
  }

  const actorEmail =
    optionalText(
      actor?.email || actor?.identity?.claims?.email
    ) || null;

  const existing = await findPayrollDeductionDeferralByRequest(
    db,
    salonId,
    employeeId,
    requestKey
  );

  if (existing) {
    const same =
      existing.sourcePayrollMonth === sourcePayrollMonth &&
      existing.targetPayrollMonth === targetPayrollMonth &&
      existing.amountHalalas === amountHalalas &&
      existing.reason === reason &&
      (existing.note || null) === note;

    if (!same) {
      throw new AppError(
        409,
        'core_payroll:partial_deduction_deferral_idempotency_conflict'
      );
    }

    return existing;
  }

  const id = requiredId(
    data.id || generatedId('payroll_deduction_deferral'),
    'deferralId'
  );

  const obligationId = requiredId(
    data.obligationId ||
      data.obligation_id ||
      generatedId('payroll_obligation'),
    'obligationId'
  );

  const sourceRef =
    `payroll_deduction_deferral:${employeeId}:${requestKey}`;

  const obligationCreate =
    await buildCanonicalPayrollObligationCreate(
      db,
      salonId,
      {
        id: obligationId,
        employeeId,
        kind: 'payroll_deduction_deferral',
        originalPayrollMonth: sourcePayrollMonth,
        targetPayrollMonth,
        amountHalalas,
        reason,
        note,
        sourceType: 'payroll_deduction_deferral',
        sourceRef,
      },
      actor,
      {
        canonicalSourceType: 'payroll_deduction_deferral',
      }
    );

  const now = nowIso();

  const deferralStatement = {
    sql: `INSERT INTO payroll_deduction_deferrals (
            id,
            salon_id,
            employee_id,
            request_key,
            source_payroll_month,
            target_payroll_month,
            amount_halalas,
            status,
            reason,
            note,
            obligation_id,
            created_by_uid,
            created_by_email,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      id,
      salonId,
      employeeId,
      requestKey,
      sourcePayrollMonth,
      targetPayrollMonth,
      amountHalalas,
      reason,
      note,
      obligationCreate.obligationId,
      actorUid,
      actorEmail,
      now,
      now,
    ],
  };

  await dbBatch(
    db,
    [
      ...obligationCreate.statements,
      deferralStatement,
    ]
  );

  const created = await dbFirst(
    db,
    `SELECT *
       FROM payroll_deduction_deferrals
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, id]
  );

  if (!created) {
    throw new AppError(
      500,
      'core_payroll:partial_deduction_deferral_create_failed'
    );
  }

  return deferralDto(created);
}
