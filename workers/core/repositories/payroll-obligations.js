// CORE D1 ONLY — employee payroll obligations, recurring deductions, deferrals and installments.
// This domain is intentionally separate from payroll carryovers and statutory GOSI.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  assertDeferrableDeductionKind,
  buildDeferredDeduction,
  buildInstallmentPlan,
  normalizePayrollMonth,
  payrollObligationDeductionItem,
  payrollObligationDeductionTotal,
  withoutPayrollObligationDeductionItems,
} from '../../../src/helpers/hr/payrollObligationPolicy.js';

const RECURRING_STATUSES = new Set(['active', 'paused', 'ended', 'cancelled']);
const OBLIGATION_OPEN_STATUSES = new Set(['open', 'scheduled', 'partially_settled']);
const RESERVED_CANONICAL_OBLIGATION_SOURCE_TYPES = new Set(['attendance']);

function money(value, field = 'amount') {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    throw new AppError(400, `core_payroll:${field}_invalid`);
  }
  return Math.round(number);
}

function actorValues(actor = {}) {
  return {
    uid: optionalText(actor.uid) || null,
    email: optionalText(actor.email) || null,
  };
}

function requiredReason(value) {
  const reason = cleanText(value);
  if (!reason) throw new AppError(400, 'core_payroll:deduction_reason_required');
  return reason;
}

function policyValue(callback, fallbackCode = 'payroll_obligation_policy_invalid') {
  try {
    return callback();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const rawCode = cleanText(error?.message) || fallbackCode;
    const code = rawCode.startsWith('core_payroll:')
      ? rawCode
      : `core_payroll:${rawCode}`;
    throw new AppError(400, code);
  }
}

function deferrableDeductionKind(value) {
  return policyValue(
    () => assertDeferrableDeductionKind(value),
    'deduction_kind_invalid'
  );
}

function payrollMonthValue(value) {
  return policyValue(
    () => normalizePayrollMonth(value),
    'payroll_month_invalid'
  );
}

function requiredActorInfo(actor = {}) {
  const info = actorValues(actor);
  if (!info.uid && !info.email) {
    throw new AppError(400, 'core_payroll:deduction_actor_required');
  }
  return info;
}

function recurringStatus(value, fallback = 'active') {
  const status = cleanText(value || fallback).toLowerCase();
  if (!RECURRING_STATUSES.has(status)) {
    throw new AppError(400, 'core_payroll:recurring_deduction_status_invalid');
  }
  return status;
}

function recurringDto(row) {
  return {
    id: row.id,
    salonId: row.salon_id,
    employeeId: row.employee_id,
    title: row.title,
    deductionKind: row.deduction_kind,
    amountHalalas: Number(row.amount_halalas || 0),
    cadence: row.cadence,
    startPayrollMonth: row.start_payroll_month,
    endPayrollMonth: row.end_payroll_month || null,
    status: row.status,
    reason: row.reason,
    note: row.note || null,
    sourceType: row.source_type,
    sourceRef: row.source_ref || null,
    createdByUid: row.created_by_uid || null,
    createdByEmail: row.created_by_email || null,
    updatedByUid: row.updated_by_uid || null,
    updatedByEmail: row.updated_by_email || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function installmentDto(row) {
  return {
    id: row.id,
    obligationId: row.obligation_id,
    sequenceNo: Number(row.sequence_no || 0),
    targetPayrollMonth: row.target_payroll_month,
    amountHalalas: Number(row.amount_halalas || 0),
    status: row.status,
    appliedPayrollEntryId: row.applied_payroll_entry_id || null,
    appliedAt: row.applied_at || null,
    deferredFromInstallmentId: row.deferred_from_installment_id || null,
    supersededByInstallmentId: row.superseded_by_installment_id || null,
    decisionReason: row.decision_reason,
    note: row.note || null,
    createdByUid: row.created_by_uid || null,
    createdByEmail: row.created_by_email || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function obligationDto(row, installments = []) {
  return {
    id: row.id,
    salonId: row.salon_id,
    employeeId: row.employee_id,
    recurringDeductionId: row.recurring_deduction_id || null,
    obligationKind: row.obligation_kind,
    sourceType: row.source_type,
    sourceRef: row.source_ref || null,
    originalPayrollMonth: row.original_payroll_month,
    originalAmountHalalas: Number(row.original_amount_halalas || 0),
    remainingAmountHalalas: Number(row.remaining_amount_halalas || 0),
    status: row.status,
    reason: row.reason,
    note: row.note || null,
    createdByUid: row.created_by_uid || null,
    createdByEmail: row.created_by_email || null,
    cancelledByUid: row.cancelled_by_uid || null,
    cancelledByEmail: row.cancelled_by_email || null,
    cancelledAt: row.cancelled_at || null,
    cancellationReason: row.cancellation_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    installments,
  };
}

async function assertTargetMonthMutable(db, salonId, employeeId, payrollMonth) {
  const row = await dbFirst(
    db,
    `SELECT id, status
       FROM payroll_entries
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?
      LIMIT 1`,
    [salonId, employeeId, payrollMonth]
  );
  if (row && ['approved', 'paid'].includes(cleanText(row.status).toLowerCase())) {
    throw new AppError(409, 'core_payroll:obligation_target_payroll_locked');
  }
}

function recurringObligationId(salonId, recurringId, payrollMonth) {
  const salonKey = cleanText(salonId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const recurringKey = cleanText(recurringId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `payroll_obligation_recurring_${salonKey}_${recurringKey}_${payrollMonth.replace('-', '')}`;
}

function recurringInstallmentId(salonId, recurringId, payrollMonth) {
  const salonKey = cleanText(salonId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const recurringKey = cleanText(recurringId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `payroll_installment_recurring_${salonKey}_${recurringKey}_${payrollMonth.replace('-', '')}`;
}

export async function listPayrollRecurringDeductions(db, salonId, query = {}) {
  let rows = await dbAll(
    db,
    `SELECT *
       FROM employee_recurring_deductions
      WHERE salon_id = ?
      ORDER BY employee_id, start_payroll_month DESC, created_at DESC`,
    [salonId]
  );
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const status = cleanText(query.status).toLowerCase();
  if (employeeId) rows = rows.filter((row) => cleanText(row.employee_id) === employeeId);
  if (status) rows = rows.filter((row) => cleanText(row.status).toLowerCase() === status);
  return rows.map(recurringDto);
}

export async function savePayrollRecurringDeduction(db, salonId, data = {}, actor = {}, id = '') {
  const existingId = cleanText(id || data.id);
  const existing = existingId
    ? await dbFirst(
        db,
        'SELECT * FROM employee_recurring_deductions WHERE salon_id = ? AND id = ? LIMIT 1',
        [salonId, existingId]
      )
    : null;
  if (existingId && !existing) throw new AppError(404, 'core_payroll:recurring_deduction_not_found');
  const employeeId = requiredId(
    data.employeeId || data.employee_id || existing?.employee_id,
    'employeeId'
  );
  if (existing && cleanText(existing.employee_id) !== employeeId) {
    throw new AppError(409, 'core_payroll:recurring_deduction_employee_mismatch');
  }

  const title = requiredText(data.title ?? existing?.title, 'title');
  const deductionKind = deferrableDeductionKind(
    data.deductionKind ?? data.deduction_kind ?? existing?.deduction_kind
  );
  const amountHalalas = money(data.amountHalalas ?? data.amount_halalas ?? existing?.amount_halalas, 'deduction_amount');
  if (amountHalalas <= 0) throw new AppError(400, 'core_payroll:deduction_amount_required');
  const startPayrollMonth = payrollMonthValue(
    data.startPayrollMonth ?? data.start_payroll_month ?? existing?.start_payroll_month
  );
  const hasEndPayrollMonth =
    Object.prototype.hasOwnProperty.call(data, 'endPayrollMonth') ||
    Object.prototype.hasOwnProperty.call(data, 'end_payroll_month');
  const endValue = data.endPayrollMonth ?? data.end_payroll_month;
  const endPayrollMonth = !hasEndPayrollMonth
    ? existing?.end_payroll_month || null
    : cleanText(endValue)
      ? payrollMonthValue(endValue)
      : null;
  if (endPayrollMonth && endPayrollMonth < startPayrollMonth) {
    throw new AppError(400, 'core_payroll:recurring_deduction_end_before_start');
  }
  if (!existing) {
    const lockedOverlap = await dbFirst(
      db,
      `SELECT payroll_month
         FROM payroll_entries
        WHERE salon_id = ?
          AND employee_id = ?
          AND status IN ('approved', 'paid')
          AND payroll_month >= ?
          AND (? IS NULL OR payroll_month <= ?)
        ORDER BY payroll_month
        LIMIT 1`,
      [salonId, employeeId, startPayrollMonth, endPayrollMonth, endPayrollMonth]
    );
    if (lockedOverlap) {
      throw new AppError(409, 'core_payroll:recurring_deduction_overlaps_locked_payroll');
    }
  }
  const status = recurringStatus(data.status, existing?.status || 'active');
  const reason = requiredReason(data.reason ?? existing?.reason);
  const note = data.note === undefined ? existing?.note || null : optionalText(data.note) || null;
  const sourceType = optionalText(data.sourceType ?? data.source_type ?? existing?.source_type) || 'manual';
  const sourceRef = data.sourceRef === undefined && data.source_ref === undefined
    ? existing?.source_ref || null
    : optionalText(data.sourceRef ?? data.source_ref) || null;
  const now = nowIso();
  const actorInfo = requiredActorInfo(actor);
  const rowId = existing?.id || requiredId(generatedId('payroll_recurring_deduction'));

  await dbRun(
    db,
    `INSERT INTO employee_recurring_deductions
      (id, salon_id, employee_id, title, deduction_kind, amount_halalas, cadence,
       start_payroll_month, end_payroll_month, status, reason, note, source_type, source_ref,
       created_by_uid, created_by_email, updated_by_uid, updated_by_email, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'monthly', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       deduction_kind = excluded.deduction_kind,
       amount_halalas = excluded.amount_halalas,
       start_payroll_month = excluded.start_payroll_month,
       end_payroll_month = excluded.end_payroll_month,
       status = excluded.status,
       reason = excluded.reason,
       note = excluded.note,
       source_type = excluded.source_type,
       source_ref = excluded.source_ref,
       updated_by_uid = excluded.updated_by_uid,
       updated_by_email = excluded.updated_by_email,
       updated_at = excluded.updated_at`,
    [
      rowId,
      salonId,
      employeeId,
      title,
      deductionKind,
      amountHalalas,
      startPayrollMonth,
      endPayrollMonth,
      status,
      reason,
      note,
      sourceType,
      sourceRef,
      existing?.created_by_uid || actorInfo.uid,
      existing?.created_by_email || actorInfo.email,
      actorInfo.uid,
      actorInfo.email,
      existing?.created_at || now,
      now,
    ]
  );

  const saved = await dbFirst(
    db,
    'SELECT * FROM employee_recurring_deductions WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, rowId]
  );
  return recurringDto(saved);
}

export async function listPayrollObligations(db, salonId, query = {}) {
  let rows = await dbAll(
    db,
    `SELECT *
       FROM employee_payroll_obligations
      WHERE salon_id = ?
      ORDER BY original_payroll_month DESC, created_at DESC`,
    [salonId]
  );
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const status = cleanText(query.status).toLowerCase();
  if (employeeId) rows = rows.filter((row) => cleanText(row.employee_id) === employeeId);
  if (status) rows = rows.filter((row) => cleanText(row.status).toLowerCase() === status);
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const installmentRows = await dbAll(
    db,
    `SELECT *
       FROM employee_payroll_obligation_installments
      WHERE salon_id = ? AND obligation_id IN (${placeholders})
      ORDER BY obligation_id, sequence_no`,
    [salonId, ...ids]
  );
  const byObligation = new Map();
  for (const row of installmentRows) {
    const list = byObligation.get(row.obligation_id) || [];
    list.push(installmentDto(row));
    byObligation.set(row.obligation_id, list);
  }
  return rows.map((row) => obligationDto(row, byObligation.get(row.id) || []));
}

function initialInstallmentRows(input, actor) {
  const kind = deferrableDeductionKind(input.kind);
  const originalPayrollMonth = payrollMonthValue(input.originalPayrollMonth);
  const amountHalalas = money(input.amountHalalas, 'deduction_amount');
  if (amountHalalas <= 0) throw new AppError(400, 'core_payroll:deduction_amount_required');
  const reason = requiredReason(input.reason);
  const actorInfo = requiredActorInfo(actor);

  if (Array.isArray(input.installments) && input.installments.length) {
    try {
      const plan = buildInstallmentPlan({
        kind,
        originalPayrollMonth,
        amountHalalas,
        reason,
        note: input.note,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        createdByUid: actorInfo.uid,
        createdByEmail: actorInfo.email,
        installments: input.installments,
      });
      return plan.installments.map((item) => ({
        targetPayrollMonth: item.targetPayrollMonth,
        amountHalalas: item.amountHalalas,
        decisionReason: reason,
      }));
    } catch (error) {
      throw new AppError(400, `core_payroll:${cleanText(error?.message) || 'invalid_installment_plan'}`);
    }
  }

  const targetPayrollMonth = payrollMonthValue(input.targetPayrollMonth || originalPayrollMonth);
  if (targetPayrollMonth < originalPayrollMonth) {
    throw new AppError(400, 'core_payroll:deduction_target_before_original');
  }
  if (targetPayrollMonth > originalPayrollMonth) {
    try {
      buildDeferredDeduction({
        kind,
        originalPayrollMonth,
        targetPayrollMonth,
        amountHalalas,
        reason,
        note: input.note,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        createdByUid: actorInfo.uid,
        createdByEmail: actorInfo.email,
      });
    } catch (error) {
      throw new AppError(400, `core_payroll:${cleanText(error?.message) || 'invalid_deferred_deduction'}`);
    }
  }
  return [{ targetPayrollMonth, amountHalalas, decisionReason: reason }];
}


export function attendanceDeductionSourceRef(
  employeeIdValue,
  originalPayrollMonthValue
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const originalPayrollMonth = payrollMonthValue(originalPayrollMonthValue);

  return `attendance_missing_hours:${employeeId}:${originalPayrollMonth}`;
}

export async function getCanonicalAttendanceDeductionDeferral(
  db,
  salonId,
  query = {}
) {
  const employeeId = requiredId(
    query.employeeId || query.employee_id,
    'employeeId'
  );

  const originalPayrollMonth = payrollMonthValue(
    query.originalPayrollMonth ||
      query.original_payroll_month ||
      query.payrollMonth ||
      query.payroll_month
  );

  const canonicalAmountHalalas = money(
    query.canonicalAmountHalalas ??
      query.canonical_amount_halalas ??
      0,
    'attendance_deduction_amount'
  );

  const sourceRef = attendanceDeductionSourceRef(
    employeeId,
    originalPayrollMonth
  );

  const rows = await dbAll(
    db,
    `SELECT *
       FROM employee_payroll_obligations
      WHERE salon_id = ?
        AND employee_id = ?
        AND source_type = 'attendance'
        AND source_ref = ?
        AND status <> 'cancelled'
      ORDER BY created_at, id`,
    [salonId, employeeId, sourceRef]
  );

  if (rows.length > 1) {
    throw new AppError(
      409,
      'core_payroll:attendance_deferral_duplicate_authority'
    );
  }

  if (!rows.length) return null;

  const row = rows[0];

  if (
    cleanText(row.obligation_kind) !== 'attendance_missing_hours' ||
    cleanText(row.original_payroll_month) !== originalPayrollMonth
  ) {
    throw new AppError(
      409,
      'core_payroll:attendance_deferral_identity_mismatch'
    );
  }

  if (
    Number(row.original_amount_halalas || 0) !==
    canonicalAmountHalalas
  ) {
    throw new AppError(
      409,
      'core_payroll:attendance_deferral_snapshot_stale'
    );
  }

  const installmentRows = await dbAll(
    db,
    `SELECT *
       FROM employee_payroll_obligation_installments
      WHERE salon_id = ?
        AND obligation_id = ?
      ORDER BY sequence_no, created_at, id`,
    [salonId, row.id]
  );

  return obligationDto(
    row,
    installmentRows.map(installmentDto)
  );
}

export async function createCanonicalAttendanceDeductionObligation(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(
    data.employeeId || data.employee_id,
    'employeeId'
  );

  const originalPayrollMonth = payrollMonthValue(
    data.originalPayrollMonth || data.original_payroll_month
  );

  const targetPayrollMonth = payrollMonthValue(
    data.targetPayrollMonth || data.target_payroll_month
  );

  if (targetPayrollMonth <= originalPayrollMonth) {
    throw new AppError(
      400,
      'core_payroll:attendance_deferral_target_must_be_future'
    );
  }

  const amountHalalas = money(
    data.amountHalalas ??
      data.amount_halalas ??
      data.originalAmountHalalas ??
      data.original_amount_halalas,
    'attendance_deduction_amount'
  );

  if (amountHalalas <= 0) {
    throw new AppError(
      400,
      'core_payroll:attendance_deduction_amount_required'
    );
  }

  return createPayrollObligation(
    db,
    salonId,
    {
      employeeId,
      kind: 'attendance_missing_hours',
      originalPayrollMonth,
      targetPayrollMonth,
      amountHalalas,
      reason: data.reason,
      note: data.note,
      sourceType: 'attendance',
      sourceRef: attendanceDeductionSourceRef(
        employeeId,
        originalPayrollMonth
      ),
    },
    actor,
    { canonicalSourceType: 'attendance' }
  );
}

export async function createPayrollObligation(db, salonId, data = {}, actor = {}, options = {}) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const kind = deferrableDeductionKind(data.kind || data.obligationKind || data.obligation_kind);
  const originalPayrollMonth = payrollMonthValue(data.originalPayrollMonth || data.original_payroll_month);
  const amountHalalas = money(data.amountHalalas ?? data.originalAmountHalalas ?? data.original_amount_halalas, 'deduction_amount');
  if (amountHalalas <= 0) throw new AppError(400, 'core_payroll:deduction_amount_required');
  const reason = requiredReason(data.reason);
  const note = optionalText(data.note) || null;
  const sourceType = optionalText(data.sourceType || data.source_type) || 'manual';
  const sourceRef = optionalText(data.sourceRef || data.source_ref) || null;

  const normalizedSourceType = cleanText(sourceType).toLowerCase();
  const allowedCanonicalSourceType = cleanText(options.canonicalSourceType).toLowerCase();

  if (
    RESERVED_CANONICAL_OBLIGATION_SOURCE_TYPES.has(normalizedSourceType) &&
    allowedCanonicalSourceType !== normalizedSourceType
  ) {
    throw new AppError(
      403,
      'core_payroll:attendance_obligation_requires_canonical_path'
    );
  }

  if (sourceRef) {
    const idempotentExisting = await dbFirst(
      db,
      `SELECT * FROM employee_payroll_obligations
        WHERE salon_id = ? AND employee_id = ? AND source_type = ? AND source_ref = ?
        ORDER BY created_at DESC LIMIT 1`,
      [salonId, employeeId, sourceType, sourceRef]
    );
    if (idempotentExisting && !(sourceType === 'attendance' && cleanText(idempotentExisting.status).toLowerCase() === 'cancelled')) {
      const matchesExisting =
        cleanText(idempotentExisting.obligation_kind) === kind &&
        cleanText(idempotentExisting.original_payroll_month) === originalPayrollMonth &&
        Number(idempotentExisting.original_amount_halalas || 0) === amountHalalas &&
        cleanText(idempotentExisting.reason) === reason;
      if (!matchesExisting) {
        throw new AppError(409, 'core_payroll:obligation_idempotency_conflict');
      }
      return (await listPayrollObligations(db, salonId, { employeeId })).find(
        (item) => item.id === idempotentExisting.id
      );
    }
  }
  const actorInfo = requiredActorInfo(actor);
  const installments = initialInstallmentRows({
    kind,
    originalPayrollMonth,
    amountHalalas,
    reason,
    note,
    sourceType,
    sourceRef,
    targetPayrollMonth: data.targetPayrollMonth || data.target_payroll_month,
    installments: data.installments,
  }, actor);

  for (const installment of installments) {
    await assertTargetMonthMutable(db, salonId, employeeId, installment.targetPayrollMonth);
  }

  const now = nowIso();
  const obligationId = requiredId(generatedId('payroll_obligation'));
  const statements = [
    {
      sql: `INSERT INTO employee_payroll_obligations
        (id, salon_id, employee_id, recurring_deduction_id, obligation_kind, source_type, source_ref,
         original_payroll_month, original_amount_halalas, remaining_amount_halalas, status, reason, note,
         created_by_uid, created_by_email, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
      params: [
        obligationId,
        salonId,
        employeeId,
        kind,
        sourceType,
        sourceRef,
        originalPayrollMonth,
        amountHalalas,
        amountHalalas,
        reason,
        note,
        actorInfo.uid,
        actorInfo.email,
        now,
        now,
      ],
    },
  ];
  installments.forEach((installment, index) => {
    statements.push({
      sql: `INSERT INTO employee_payroll_obligation_installments
        (id, salon_id, obligation_id, sequence_no, target_payroll_month, amount_halalas, status,
         decision_reason, note, created_by_uid, created_by_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
      params: [
        requiredId(generatedId('payroll_obligation_installment')),
        salonId,
        obligationId,
        index + 1,
        installment.targetPayrollMonth,
        installment.amountHalalas,
        installment.decisionReason,
        note,
        actorInfo.uid,
        actorInfo.email,
        now,
        now,
      ],
    });
  });
  await dbBatch(db, statements);
  return (await listPayrollObligations(db, salonId, { employeeId })).find((row) => row.id === obligationId);
}

export async function deferPayrollObligationInstallment(db, salonId, installmentIdValue, data = {}, actor = {}) {
  const installmentId = requiredId(installmentIdValue, 'installmentId');
  const row = await dbFirst(
    db,
    `SELECT i.*, o.employee_id, o.obligation_kind, o.status AS obligation_status
       FROM employee_payroll_obligation_installments i
       JOIN employee_payroll_obligations o
         ON o.salon_id = i.salon_id AND o.id = i.obligation_id
      WHERE i.salon_id = ? AND i.id = ?
      LIMIT 1`,
    [salonId, installmentId]
  );
  if (!row) throw new AppError(404, 'core_payroll:obligation_installment_not_found');
  if (cleanText(row.status) !== 'scheduled') throw new AppError(409, 'core_payroll:obligation_installment_not_scheduled');
  if (!OBLIGATION_OPEN_STATUSES.has(cleanText(row.obligation_status))) {
    throw new AppError(409, 'core_payroll:obligation_not_open');
  }
  const kind = deferrableDeductionKind(row.obligation_kind);
  const targetPayrollMonth = payrollMonthValue(data.targetPayrollMonth || data.target_payroll_month);
  const currentTarget = payrollMonthValue(row.target_payroll_month);
  if (targetPayrollMonth <= currentTarget) {
    throw new AppError(400, 'core_payroll:deferred_deduction_target_must_be_later');
  }
  const reason = requiredReason(data.reason);
  const note = optionalText(data.note) || null;
  const actorInfo = requiredActorInfo(actor);

  try {
    buildDeferredDeduction({
      kind,
      originalPayrollMonth: currentTarget,
      targetPayrollMonth,
      amountHalalas: Number(row.amount_halalas || 0),
      reason,
      note,
      createdByUid: actorInfo.uid,
      createdByEmail: actorInfo.email,
      sourceType: 'payroll_obligation',
      sourceRef: installmentId,
    });
  } catch (error) {
    throw new AppError(400, `core_payroll:${cleanText(error?.message) || 'invalid_deferred_deduction'}`);
  }

  await assertTargetMonthMutable(db, salonId, row.employee_id, currentTarget);
  await assertTargetMonthMutable(db, salonId, row.employee_id, targetPayrollMonth);
  const duplicate = await dbFirst(
    db,
    `SELECT id FROM employee_payroll_obligation_installments
      WHERE salon_id = ? AND obligation_id = ? AND target_payroll_month = ? AND status = 'scheduled'
      LIMIT 1`,
    [salonId, row.obligation_id, targetPayrollMonth]
  );
  if (duplicate) throw new AppError(409, 'core_payroll:obligation_installment_target_duplicate');
  const sequenceRow = await dbFirst(
    db,
    `SELECT COALESCE(MAX(sequence_no), 0) AS max_sequence
       FROM employee_payroll_obligation_installments
      WHERE salon_id = ? AND obligation_id = ?`,
    [salonId, row.obligation_id]
  );
  const newId = requiredId(generatedId('payroll_obligation_installment'));
  const now = nowIso();
  await dbBatch(db, [
    {
      sql: `UPDATE employee_payroll_obligation_installments
               SET status = 'deferred', superseded_by_installment_id = ?, updated_at = ?
             WHERE salon_id = ? AND id = ? AND status = 'scheduled'`,
      params: [newId, now, salonId, installmentId],
    },
    {
      sql: `INSERT INTO employee_payroll_obligation_installments
        (id, salon_id, obligation_id, sequence_no, target_payroll_month, amount_halalas, status,
         deferred_from_installment_id, decision_reason, note, created_by_uid, created_by_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        newId,
        salonId,
        row.obligation_id,
        Number(sequenceRow?.max_sequence || 0) + 1,
        targetPayrollMonth,
        Number(row.amount_halalas || 0),
        installmentId,
        reason,
        note,
        actorInfo.uid,
        actorInfo.email,
        now,
        now,
      ],
    },
    {
      sql: `UPDATE employee_payroll_obligations SET updated_at = ? WHERE salon_id = ? AND id = ?`,
      params: [now, salonId, row.obligation_id],
    },
  ]);
  const obligations = await listPayrollObligations(db, salonId, { employeeId: row.employee_id });
  return obligations.find((item) => item.id === row.obligation_id);
}

export async function cancelPayrollObligation(db, salonId, obligationIdValue, data = {}, actor = {}) {
  const obligationId = requiredId(obligationIdValue, 'obligationId');
  const row = await dbFirst(
    db,
    'SELECT * FROM employee_payroll_obligations WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, obligationId]
  );
  if (!row) throw new AppError(404, 'core_payroll:obligation_not_found');
  if (['settled', 'cancelled'].includes(cleanText(row.status))) return obligationDto(row, []);
  const reason = requiredReason(data.reason || data.cancellationReason || data.cancellation_reason);
  const scheduled = await dbAll(
    db,
    `SELECT * FROM employee_payroll_obligation_installments
      WHERE salon_id = ? AND obligation_id = ? AND status = 'scheduled'`,
    [salonId, obligationId]
  );
  for (const installment of scheduled) {
    await assertTargetMonthMutable(db, salonId, row.employee_id, installment.target_payroll_month);
  }
  const actorInfo = requiredActorInfo(actor);
  const now = nowIso();
  await dbBatch(db, [
    {
      sql: `UPDATE employee_payroll_obligation_installments
               SET status = 'cancelled', updated_at = ?
             WHERE salon_id = ? AND obligation_id = ? AND status = 'scheduled'`,
      params: [now, salonId, obligationId],
    },
    {
      sql: `UPDATE employee_payroll_obligations
               SET status = 'cancelled', cancelled_by_uid = ?, cancelled_by_email = ?,
                   cancelled_at = ?, cancellation_reason = ?, updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [actorInfo.uid, actorInfo.email, now, reason, now, salonId, obligationId],
    },
  ]);
  return (await listPayrollObligations(db, salonId, { employeeId: row.employee_id })).find((item) => item.id === obligationId);
}

async function activeRecurringForMonth(db, salonId, employeeId, payrollMonth) {
  const rows = await dbAll(
    db,
    `SELECT * FROM employee_recurring_deductions
      WHERE salon_id = ?
        AND employee_id = ?
        AND status = 'active'
        AND start_payroll_month <= ?
        AND (end_payroll_month IS NULL OR end_payroll_month = '' OR end_payroll_month >= ?)
      ORDER BY created_at, id`,
    [salonId, employeeId, payrollMonth, payrollMonth]
  );
  return rows;
}

export async function materializeRecurringPayrollObligations(db, salonId, employeeId, payrollMonth, actor = {}) {
  const targetMonth = payrollMonthValue(payrollMonth);
  await assertTargetMonthMutable(db, salonId, employeeId, targetMonth);
  const recurringRows = await activeRecurringForMonth(db, salonId, employeeId, targetMonth);
  if (!recurringRows.length) return [];
  const now = nowIso();
  const actorInfo = actorValues(actor);
  const statements = [];
  for (const recurring of recurringRows) {
    const obligationId = recurringObligationId(salonId, recurring.id, targetMonth);
    const installmentId = recurringInstallmentId(salonId, recurring.id, targetMonth);
    statements.push(
      {
        sql: `INSERT OR IGNORE INTO employee_payroll_obligations
          (id, salon_id, employee_id, recurring_deduction_id, obligation_kind, source_type, source_ref,
           original_payroll_month, original_amount_halalas, remaining_amount_halalas, status, reason, note,
           created_by_uid, created_by_email, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'recurring_deduction', ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
        params: [
          obligationId,
          salonId,
          employeeId,
          recurring.id,
          recurring.deduction_kind,
          recurring.id,
          targetMonth,
          Number(recurring.amount_halalas || 0),
          Number(recurring.amount_halalas || 0),
          recurring.reason,
          recurring.note || null,
          actorInfo.uid || recurring.created_by_uid || null,
          actorInfo.email || recurring.created_by_email || null,
          now,
          now,
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO employee_payroll_obligation_installments
          (id, salon_id, obligation_id, sequence_no, target_payroll_month, amount_halalas, status,
           decision_reason, note, created_by_uid, created_by_email, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, 'scheduled', ?, ?, ?, ?, ?, ?)`,
        params: [
          installmentId,
          salonId,
          obligationId,
          targetMonth,
          Number(recurring.amount_halalas || 0),
          recurring.reason,
          recurring.note || null,
          actorInfo.uid || recurring.created_by_uid || null,
          actorInfo.email || recurring.created_by_email || null,
          now,
          now,
        ],
      }
    );
  }
  if (statements.length) await dbBatch(db, statements);
  return recurringRows.map(recurringDto);
}

async function actualScheduledRows(db, salonId, employeeId, payrollMonth) {
  const employeeFilter = employeeId ? ' AND o.employee_id = ?' : '';
  return dbAll(
    db,
    `SELECT i.*, o.employee_id, o.recurring_deduction_id, o.obligation_kind, o.source_type AS obligation_source_type,
            o.source_ref AS obligation_source_ref, o.original_payroll_month, o.reason AS obligation_reason,
            o.note AS obligation_note, o.status AS obligation_status, r.title AS recurring_title
       FROM employee_payroll_obligation_installments i
       JOIN employee_payroll_obligations o
         ON o.salon_id = i.salon_id AND o.id = i.obligation_id
       LEFT JOIN employee_recurring_deductions r
         ON r.salon_id = o.salon_id AND r.id = o.recurring_deduction_id
      WHERE i.salon_id = ?${employeeFilter}
        AND i.target_payroll_month = ?
        AND i.status = 'scheduled'
        AND o.status IN ('open', 'scheduled', 'partially_settled')
      ORDER BY o.employee_id, i.created_at, i.id`,
    employeeId ? [salonId, employeeId, payrollMonth] : [salonId, payrollMonth]
  );
}

function deductionDtoFromActual(row) {
  const deduction = payrollObligationDeductionItem({
    obligationId: row.obligation_id,
    installmentId: row.id,
    recurringDeductionId: row.recurring_deduction_id || null,
    obligationKind: row.obligation_kind,
    title: row.recurring_title || row.obligation_reason,
    amountHalalas: Number(row.amount_halalas || 0),
    originalPayrollMonth: row.original_payroll_month,
    targetPayrollMonth: row.target_payroll_month,
    reason: row.obligation_reason,
    note: row.obligation_note || row.note || null,
    sourceType: row.obligation_source_type,
    sourceRef: row.obligation_source_ref,
  });
  return {
    ...deduction,
    employeeId: row.employee_id,
    status: row.status,
    sequenceNo: Number(row.sequence_no || 0),
    synthetic: false,
  };
}

async function syntheticRecurringDeductions(db, salonId, employeeId, payrollMonth) {
  const recurringRows = employeeId
    ? await activeRecurringForMonth(db, salonId, employeeId, payrollMonth)
    : await dbAll(
        db,
        `SELECT * FROM employee_recurring_deductions
          WHERE salon_id = ?
            AND status = 'active'
            AND start_payroll_month <= ?
            AND (end_payroll_month IS NULL OR end_payroll_month = '' OR end_payroll_month >= ?)
          ORDER BY employee_id, created_at, id`,
        [salonId, payrollMonth, payrollMonth]
      );
  const result = [];
  for (const recurring of recurringRows) {
    const recurringEmployeeId = cleanText(recurring.employee_id);
    const existing = await dbFirst(
      db,
      `SELECT id
         FROM employee_payroll_obligations
        WHERE salon_id = ? AND employee_id = ? AND recurring_deduction_id = ? AND original_payroll_month = ?
        LIMIT 1`,
      [salonId, recurringEmployeeId, recurring.id, payrollMonth]
    );
    if (existing) continue;
    const obligationId = recurringObligationId(salonId, recurring.id, payrollMonth);
    const installmentId = recurringInstallmentId(salonId, recurring.id, payrollMonth);
    result.push({
      ...payrollObligationDeductionItem({
        obligationId,
        installmentId,
        recurringDeductionId: recurring.id,
        obligationKind: recurring.deduction_kind,
        title: recurring.title,
        amountHalalas: Number(recurring.amount_halalas || 0),
        originalPayrollMonth: payrollMonth,
        targetPayrollMonth: payrollMonth,
        reason: recurring.reason,
        note: recurring.note || null,
        sourceType: 'recurring_deduction',
        sourceRef: recurring.id,
      }),
      employeeId: recurringEmployeeId,
      status: 'scheduled',
      sequenceNo: 1,
      synthetic: true,
    });
  }
  return result;
}

export async function listPayrollObligationDeductions(db, salonId, query = {}, options = {}) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const payrollMonth = payrollMonthValue(query.payrollMonth || query.payroll_month);
  if (options.materializeRecurring === true) {
    if (!employeeId) throw new AppError(400, 'core_payroll:employee_id_required_for_materialization');
    await materializeRecurringPayrollObligations(db, salonId, employeeId, payrollMonth, options.actor || {});
  }
  const actual = (await actualScheduledRows(db, salonId, employeeId, payrollMonth)).map(deductionDtoFromActual);
  if (options.materializeRecurring === true) return actual;
  const synthetic = await syntheticRecurringDeductions(db, salonId, employeeId, payrollMonth);
  return [...actual, ...synthetic].sort((a, b) => cleanText(a.label).localeCompare(cleanText(b.label), 'ar'));
}

function obligationItemsFromEntry(entry) {
  let items = [];
  try {
    const parsed = JSON.parse(cleanText(entry?.deductions_json) || '[]');
    if (Array.isArray(parsed)) items = parsed;
  } catch {}
  return items.filter((item) => cleanText(item?.sourceType ?? item?.source_type) === 'payroll_obligation' || cleanText(item?.kind) === 'payroll_obligation');
}

function itemKey(item) {
  return `${cleanText(item?.installmentId ?? item?.installment_id ?? item?.sourceRef ?? item?.source_ref)}|${money(item?.amountHalalas ?? item?.amount_halalas ?? item?.amount)}`;
}

export async function assertPayrollObligationSnapshotCurrent(db, salonId, entry) {
  const employeeId = requiredId(entry.employee_id || entry.employeeId, 'employeeId');
  const payrollMonth = payrollMonthValue(entry.payroll_month || entry.payrollMonth);
  const canonical = await listPayrollObligationDeductions(db, salonId, { employeeId, payrollMonth });
  const snapshotItems = obligationItemsFromEntry(entry);
  const canonicalKeys = canonical.map(itemKey).sort();
  const snapshotKeys = snapshotItems.map(itemKey).sort();
  if (JSON.stringify(canonicalKeys) !== JSON.stringify(snapshotKeys)) {
    throw new AppError(409, 'core_payroll:obligation_snapshot_stale');
  }
  return true;
}

export async function canonicalizePayrollObligationDeductions(db, salonId, data, actor = {}) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const payrollMonth = payrollMonthValue(data.payrollMonth || data.payroll_month);
  const canonical = await listPayrollObligationDeductions(
    db,
    salonId,
    { employeeId, payrollMonth },
    { materializeRecurring: true, actor }
  );
  const submitted = Array.isArray(data.deductions)
    ? data.deductions
    : Array.isArray(data.salaryDeductions)
      ? data.salaryDeductions
      : [];
  const deductions = [
    ...withoutPayrollObligationDeductionItems(submitted),
    ...canonical,
  ];
  return {
    deductions,
    obligationDeductions: canonical,
    obligationDeductionHalalas: payrollObligationDeductionTotal(canonical),
  };
}

export async function payrollObligationPaidStatements(
  db,
  salonId,
  entry,
  paidAt = nowIso(),
  options = {}
) {
  await assertPayrollObligationSnapshotCurrent(db, salonId, entry);
  const items = obligationItemsFromEntry(entry);
  if (!items.length) return [];
  const installmentIds = Array.from(
    new Set(
      items
        .map((item) =>
          cleanText(
            item.installmentId ??
              item.installment_id ??
              item.sourceRef ??
              item.source_ref
          )
        )
        .filter(Boolean)
    )
  );
  if (!installmentIds.length) return [];

  const placeholders = installmentIds.map(() => '?').join(',');
  const rows = await dbAll(
    db,
    `SELECT i.*, o.employee_id
       FROM employee_payroll_obligation_installments i
       JOIN employee_payroll_obligations o
         ON o.salon_id = i.salon_id AND o.id = i.obligation_id
      WHERE i.salon_id = ? AND i.id IN (${placeholders})`,
    [salonId, ...installmentIds]
  );
  if (rows.length !== installmentIds.length) {
    throw new AppError(
      409,
      'core_payroll:obligation_installment_missing'
    );
  }

  const snapshotTotal = payrollObligationDeductionTotal(items);
  const canonicalTotal = rows.reduce(
    (sum, row) => sum + money(row.amount_halalas),
    0
  );
  if (snapshotTotal !== canonicalTotal) {
    throw new AppError(
      409,
      'core_payroll:obligation_deduction_mismatch'
    );
  }

  for (const row of rows) {
    if (cleanText(row.status) !== 'scheduled') {
      throw new AppError(
        409,
        'core_payroll:obligation_installment_not_scheduled'
      );
    }
    if (cleanText(row.employee_id) !== cleanText(entry.employee_id)) {
      throw new AppError(
        409,
        'core_payroll:obligation_employee_mismatch'
      );
    }
    if (
      cleanText(row.target_payroll_month) !==
      cleanText(entry.payroll_month)
    ) {
      throw new AppError(
        409,
        'core_payroll:obligation_month_mismatch'
      );
    }
  }

  const requirePayrollPaid = options.requirePayrollPaid === true;
  const payrollPaidGuard = requirePayrollPaid
    ? ` AND EXISTS (
          SELECT 1
            FROM payroll_entries pe
           WHERE pe.salon_id = ?
             AND pe.id = ?
             AND pe.status = 'paid'
        )`
    : '';

  const byObligation = new Map();
  for (const row of rows) {
    byObligation.set(
      row.obligation_id,
      (byObligation.get(row.obligation_id) || 0) +
        money(row.amount_halalas)
    );
  }

  const statements = rows.map((row) => ({
    sql: `UPDATE employee_payroll_obligation_installments
             SET status = 'applied',
                 applied_payroll_entry_id = ?,
                 applied_at = ?,
                 updated_at = ?
           WHERE salon_id = ?
             AND id = ?
             AND status = 'scheduled'${payrollPaidGuard}`,
    params: [
      entry.id,
      paidAt,
      paidAt,
      salonId,
      row.id,
      ...(requirePayrollPaid ? [salonId, entry.id] : []),
    ],
  }));

  for (const [obligationId, amountHalalas] of byObligation.entries()) {
    statements.push({
      sql: `UPDATE employee_payroll_obligations
               SET remaining_amount_halalas =
                     MAX(0, remaining_amount_halalas - ?),
                   status = CASE
                     WHEN remaining_amount_halalas <= ?
                       THEN 'settled'
                     ELSE 'partially_settled'
                   END,
                   updated_at = ?
             WHERE salon_id = ?
               AND id = ?${payrollPaidGuard}`,
      params: [
        amountHalalas,
        amountHalalas,
        paidAt,
        salonId,
        obligationId,
        ...(requirePayrollPaid ? [salonId, entry.id] : []),
      ],
    });
  }

  return statements;
}

export async function payrollObligationPaymentReversalStatements(
  db,
  salonId,
  entry,
  reversedAt = nowIso(),
  options = {}
) {
  const payrollEntryId = cleanText(entry?.id);
  if (!payrollEntryId) {
    throw new AppError(
      400,
      'core_payroll:payment_reversal_entry_required'
    );
  }

  const rows = await dbAll(
    db,
    `SELECT
       i.id,
       i.obligation_id,
       i.amount_halalas,
       i.status,
       i.applied_payroll_entry_id,
       o.employee_id,
       o.original_amount_halalas,
       o.remaining_amount_halalas,
       o.status AS obligation_status
     FROM employee_payroll_obligation_installments i
     JOIN employee_payroll_obligations o
       ON o.salon_id = i.salon_id
      AND o.id = i.obligation_id
    WHERE i.salon_id = ?
      AND i.applied_payroll_entry_id = ?
      AND i.status = 'applied'`,
    [salonId, payrollEntryId]
  );

  if (!rows.length) return [];

  for (const row of rows) {
    if (cleanText(row.employee_id) !== cleanText(entry.employee_id)) {
      throw new AppError(
        409,
        'core_payroll:payment_reversal_obligation_employee_mismatch'
      );
    }
    if (cleanText(row.obligation_status) === 'cancelled') {
      throw new AppError(
        409,
        'core_payroll:payment_reversal_obligation_cancelled'
      );
    }
  }

  const requirePayrollApproved =
    options.requirePayrollApproved === true;
  const payrollApprovedGuard = requirePayrollApproved
    ? ` AND EXISTS (
          SELECT 1
            FROM payroll_entries pe
           WHERE pe.salon_id = ?
             AND pe.id = ?
             AND pe.status = 'approved'
        )`
    : '';

  const byObligation = new Map();
  const installmentIdsByObligation = new Map();
  for (const row of rows) {
    byObligation.set(
      row.obligation_id,
      (byObligation.get(row.obligation_id) || 0) +
        money(row.amount_halalas)
    );
    const ids =
      installmentIdsByObligation.get(row.obligation_id) || [];
    ids.push(row.id);
    installmentIdsByObligation.set(row.obligation_id, ids);
  }

  const statements = rows.map((row) => ({
    sql: `UPDATE employee_payroll_obligation_installments
             SET status = 'scheduled',
                 applied_payroll_entry_id = NULL,
                 applied_at = NULL,
                 updated_at = ?
           WHERE salon_id = ?
             AND id = ?
             AND status = 'applied'
             AND applied_payroll_entry_id = ?${payrollApprovedGuard}`,
    params: [
      reversedAt,
      salonId,
      row.id,
      payrollEntryId,
      ...(requirePayrollApproved
        ? [salonId, payrollEntryId]
        : []),
    ],
  }));

  for (const [obligationId, amountHalalas] of byObligation.entries()) {
    const installmentIds =
      installmentIdsByObligation.get(obligationId) || [];
    const placeholders = installmentIds.map(() => '?').join(',');

    statements.push({
      sql: `UPDATE employee_payroll_obligations
               SET remaining_amount_halalas =
                     MIN(
                       original_amount_halalas,
                       remaining_amount_halalas + ?
                     ),
                   status = CASE
                     WHEN remaining_amount_halalas + ? >=
                          original_amount_halalas
                       THEN 'scheduled'
                     ELSE 'partially_settled'
                   END,
                   updated_at = ?
             WHERE salon_id = ?
               AND id = ?
               AND status <> 'cancelled'
               AND COALESCE(updated_at, '') <> ?
               AND EXISTS (
                 SELECT 1
                   FROM employee_payroll_obligation_installments i
                  WHERE i.salon_id = ?
                    AND i.obligation_id = ?
                    AND i.id IN (${placeholders})
                    AND i.status = 'scheduled'
                    AND i.applied_payroll_entry_id IS NULL
                    AND i.updated_at = ?
               )${payrollApprovedGuard}`,
      params: [
        amountHalalas,
        amountHalalas,
        reversedAt,
        salonId,
        obligationId,
        reversedAt,
        salonId,
        obligationId,
        ...installmentIds,
        reversedAt,
        ...(requirePayrollApproved
          ? [salonId, payrollEntryId]
          : []),
      ],
    });
  }

  return statements;
}
