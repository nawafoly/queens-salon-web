// CORE D1 ONLY — canonical salary advance installment deferrals.
//
// Authoritative state:
// - salary_advances.first_deduction_month = original approved schedule
// - salary_advance_installments.payroll_month = current canonical schedule
// - salary_advance_installment_deferrals = immutable movement history
//
// The immutable event, installment schedule move, and any affected mutable
// Draft payroll projections are committed in one D1 batch. Payroll formulas
// remain owned exclusively by payroll.js and are precomputed via preview mode.

import {
  cleanText,
  dbBatch,
  dbFirst,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  buildPayrollEntryMutationStatement,
  listPayrollAdvanceDeductions,
  upsertPayrollEntry,
} from './payroll.js';

function payrollMonthValue(value, field) {
  const month = cleanText(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new AppError(
      400,
      `core_payroll:salary_advance_deferral_invalid_${field}`
    );
  }
  return month;
}

function requiredReason(value) {
  const reason = cleanText(value);
  if (!reason) {
    throw new AppError(
      400,
      'core_payroll:salary_advance_deferral_reason_required'
    );
  }
  return reason;
}

function requiredIdempotencyKey(data = {}) {
  const key = cleanText(data.idempotencyKey || data.idempotency_key);
  if (!key || key.length > 160) {
    throw new AppError(
      400,
      'core_payroll:salary_advance_deferral_idempotency_required'
    );
  }
  return key;
}

function requiredActor(actor = {}) {
  const info = {
    uid: optionalText(actor.uid) || null,
    email: optionalText(actor.email) || null,
  };

  if (!info.uid && !info.email) {
    throw new AppError(
      400,
      'core_payroll:salary_advance_deferral_actor_required'
    );
  }

  return info;
}

function lockedPayroll(row) {
  return Boolean(
    row &&
    ['approved', 'paid'].includes(
      cleanText(row.status || '').toLowerCase()
    )
  );
}

function lockedPeriod(row) {
  return Boolean(
    row &&
    [
      'closed',
      'approved',
      'paid',
      'locked',
      'posted',
      'posted_to_payroll',
    ].includes(cleanText(row.status || '').toLowerCase())
  );
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function deferralDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    salonId: row.salon_id,
    advanceId: row.advance_id,
    installmentId: row.installment_id,
    employeeId: row.employee_id,
    originalPayrollMonth: row.original_payroll_month,
    fromPayrollMonth: row.from_payroll_month,
    toPayrollMonth: row.to_payroll_month,
    amountHalalas: Number(row.amount_halalas || 0),
    fromPayrollEntryId: row.from_payroll_entry_id || null,
    toPayrollEntryId: row.to_payroll_entry_id || null,
    reason: row.reason,
    note: row.note || null,
    idempotencyKey: row.idempotency_key,
    source: row.source,
    deferredBy: {
      uid: row.created_by_uid || null,
      email: row.created_by_email || null,
    },
    deferredAt: row.created_at,
    createdByUid: row.created_by_uid || null,
    createdByEmail: row.created_by_email || null,
    createdAt: row.created_at,
  };
}

function installmentDto(row) {
  if (!row) return null;

  return {
    id: row.id,
    advanceId: row.advance_id,
    installmentNumber: Number(row.installment_number || 0),
    payrollMonth: row.payroll_month,
    amountHalalas: Number(row.amount_halalas || 0),
    status: row.status,
    payrollEntryId: row.payroll_entry_id || null,
    deductedAt: row.deducted_at || null,
    updatedAt: row.updated_at,
  };
}

async function getInstallment(db, salonId, installmentId) {
  return dbFirst(
    db,
    `SELECT sai.*,
            sa.employee_id,
            sa.payment_status,
            sa.first_deduction_month
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sai.id = ?
      LIMIT 1`,
    [salonId, installmentId]
  );
}

async function payrollEntryForMonth(
  db,
  salonId,
  employeeId,
  payrollMonth
) {
  return dbFirst(
    db,
    `SELECT *
       FROM payroll_entries
      WHERE salon_id = ?
        AND employee_id = ?
        AND payroll_month = ?
      LIMIT 1`,
    [salonId, employeeId, payrollMonth]
  );
}

async function payrollPeriodForMonth(db, salonId, payrollMonth) {
  return dbFirst(
    db,
    `SELECT *
       FROM payroll_periods
      WHERE salon_id = ?
        AND payroll_month = ?
      LIMIT 1`,
    [salonId, payrollMonth]
  );
}

async function getDeferralByIdempotency(
  db,
  salonId,
  idempotencyKey
) {
  return dbFirst(
    db,
    `SELECT *
       FROM salary_advance_installment_deferrals
      WHERE salon_id = ?
        AND idempotency_key = ?
      LIMIT 1`,
    [salonId, idempotencyKey]
  );
}

async function originalPayrollMonthForInstallment(
  db,
  salonId,
  installmentId,
  fallbackPayrollMonth
) {
  const firstEvent = await dbFirst(
    db,
    `SELECT original_payroll_month
       FROM salary_advance_installment_deferrals
      WHERE salon_id = ?
        AND installment_id = ?
      ORDER BY created_at, id
      LIMIT 1`,
    [salonId, installmentId]
  );

  return payrollMonthValue(
    firstEvent?.original_payroll_month || fallbackPayrollMonth,
    'original_payroll_month'
  );
}

function sameIdempotentRequest(
  event,
  installmentId,
  targetPayrollMonth,
  reason,
  note
) {
  return Boolean(
    event &&
    cleanText(event.installment_id) === installmentId &&
    cleanText(event.to_payroll_month) === targetPayrollMonth &&
    cleanText(event.reason) === reason &&
    cleanText(event.note) === cleanText(note)
  );
}

function mapIntegrityError(error) {
  const message = cleanText(error?.message || error?.code);

  const mappings = [
    [
      'salary_advance_deferral_installment_not_scheduled_or_source_mismatch',
      'core_payroll:salary_advance_deferral_source_conflict',
    ],
    [
      'salary_advance_deferral_original_month_mismatch',
      'core_payroll:salary_advance_deferral_original_month_conflict',
    ],
    [
      'salary_advance_deferral_source_payroll_link_mismatch',
      'core_payroll:salary_advance_deferral_source_payroll_link_mismatch',
    ],
    [
      'salary_advance_deferral_source_payroll_locked',
      'core_payroll:salary_advance_deferral_source_payroll_locked',
    ],
    [
      'salary_advance_deferral_target_payroll_locked',
      'core_payroll:salary_advance_deferral_target_payroll_locked',
    ],
    [
      'salary_advance_deferral_source_period_locked',
      'core_payroll:salary_advance_deferral_source_period_locked',
    ],
    [
      'salary_advance_deferral_target_period_locked',
      'core_payroll:salary_advance_deferral_target_period_locked',
    ],
    [
      'salary_advance_deferral_source_projection_stale',
      'core_payroll:salary_advance_deferral_source_projection_stale',
    ],
    [
      'salary_advance_deferral_target_projection_stale',
      'core_payroll:salary_advance_deferral_target_projection_stale',
    ],
    [
      'salary_advance_installment_payroll_month_requires_canonical_deferral',
      'core_payroll:salary_advance_deferral_integrity_conflict',
    ],
  ];

  for (const [needle, code] of mappings) {
    if (message.includes(needle)) {
      return new AppError(409, code);
    }
  }

  return error;
}

function payrollSnapshot(row) {
  if (!row) {
    return {
      id: null,
      updatedAt: null,
      advancesHalalas: null,
      totalDeductionsHalalas: null,
      netSalaryHalalas: null,
      finalSalaryHalalas: null,
    };
  }

  return {
    id: row.id,
    updatedAt: row.updated_at || null,
    advancesHalalas: Number(row.advances_halalas || 0),
    totalDeductionsHalalas: Number(row.total_deductions_halalas || 0),
    netSalaryHalalas: Number(row.net_salary_halalas || 0),
    finalSalaryHalalas: Number(row.final_salary_halalas || 0),
  };
}

async function canonicalAdvanceHalalasForMonth(
  db,
  salonId,
  employeeId,
  payrollMonth
) {
  const rows = await listPayrollAdvanceDeductions(
    db,
    salonId,
    { employeeId, payrollMonth }
  );
  const value = Number(rows[0]?.amount_halalas || 0);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError(
      500,
      'core_payroll:salary_advance_deferral_invalid_canonical_advance_total'
    );
  }

  return value;
}

function appendDeferralAudit(existing, eventId, actor, at) {
  const auditLog = parseJsonArray(existing.audit_log_json);
  auditLog.push({
    action: 'canonical_recalculation_after_salary_advance_deferral',
    sourceRef: eventId,
    byUid: optionalText(actor.uid) || null,
    byEmail: optionalText(actor.email) || null,
    at,
  });
  return auditLog;
}

async function preparePayrollProjection(
  db,
  salonId,
  existing,
  canonicalAdvanceHalalas,
  eventId,
  actor,
  at,
  options
) {
  if (!existing) {
    return {
      preview: null,
      statement: null,
      result: {
        payrollMonth: null,
        status: 'not_found',
        payrollEntryId: null,
        error: null,
      },
    };
  }

  const preview = await upsertPayrollEntry(
    db,
    salonId,
    {
      ...existing,
      id: existing.id,
      employeeId: existing.employee_id,
      employeeName: existing.employee_name,
      payrollMonth: existing.payroll_month,
      periodId: existing.period_id,
      status: existing.status || 'draft',
      additions: parseJsonArray(existing.additions_json),
      deductions: parseJsonArray(existing.deductions_json),
      notes: existing.notes,
      auditLog: appendDeferralAudit(existing, eventId, actor, at),
      skipTargetBonus: true,
    },
    actor,
    {
      ...options,
      previewOnly: true,
      internalCanonicalAdvanceHalalas: canonicalAdvanceHalalas,
    }
  );

  return {
    preview,
    statement: buildPayrollEntryMutationStatement(preview),
    result: {
      payrollMonth: existing.payroll_month,
      status: 'refreshed',
      payrollEntryId: existing.id,
      error: null,
    },
  };
}

async function buildExistingResult(
  db,
  salonId,
  event,
  installmentId
) {
  const currentInstallment = await getInstallment(
    db,
    salonId,
    installmentId
  );

  if (!currentInstallment) {
    throw new AppError(
      500,
      'core_payroll:salary_advance_deferral_installment_missing_after_event'
    );
  }

  const payrollRefresh = [];
  for (const [payrollMonth, payrollEntryId] of [
    [event.from_payroll_month, event.from_payroll_entry_id],
    [event.to_payroll_month, event.to_payroll_entry_id],
  ]) {
    payrollRefresh.push({
      payrollMonth,
      status: payrollEntryId ? 'already_applied' : 'not_found',
      payrollEntryId: payrollEntryId || null,
      error: null,
    });
  }

  return {
    deferral: deferralDto(event),
    installment: installmentDto(currentInstallment),
    payrollRefresh,
    idempotent: true,
  };
}

function assertProjectionPersisted(actual, preview, code) {
  if (!preview) return;
  if (
    !actual ||
    cleanText(actual.id) !== cleanText(preview.id) ||
    Number(actual.advances_halalas || 0) !== Number(preview.advances_halalas || 0) ||
    Number(actual.total_deductions_halalas || 0) !== Number(preview.total_deductions_halalas || 0) ||
    Number(actual.net_salary_halalas || 0) !== Number(preview.net_salary_halalas || 0) ||
    Number(actual.final_salary_halalas || 0) !== Number(preview.final_salary_halalas || 0)
  ) {
    throw new AppError(500, code);
  }
}

export async function deferSalaryAdvanceInstallment(
  db,
  salonId,
  installmentIdValue,
  data = {},
  actor = {},
  options = {}
) {
  const installmentId = requiredId(
    installmentIdValue,
    'installmentId'
  );

  const targetPayrollMonth = payrollMonthValue(
    data.targetPayrollMonth || data.target_payroll_month,
    'target_payroll_month'
  );

  const reason = requiredReason(data.reason);
  const note = optionalText(data.note) || null;
  const idempotencyKey = requiredIdempotencyKey(data);
  const actorInfo = requiredActor(actor);

  const existingEvent = await getDeferralByIdempotency(
    db,
    salonId,
    idempotencyKey
  );

  if (existingEvent) {
    if (
      !sameIdempotentRequest(
        existingEvent,
        installmentId,
        targetPayrollMonth,
        reason,
        note
      )
    ) {
      throw new AppError(
        409,
        'core_payroll:salary_advance_deferral_idempotency_conflict'
      );
    }

    return buildExistingResult(
      db,
      salonId,
      existingEvent,
      installmentId
    );
  }

  const installment = await getInstallment(
    db,
    salonId,
    installmentId
  );

  if (!installment) {
    throw new AppError(
      404,
      'core_payroll:salary_advance_installment_not_found'
    );
  }

  if (cleanText(installment.status) !== 'scheduled') {
    throw new AppError(
      409,
      'core_payroll:salary_advance_installment_not_scheduled'
    );
  }

  if (
    ['cancelled', 'voided', 'repaid'].includes(
      cleanText(installment.payment_status).toLowerCase()
    )
  ) {
    throw new AppError(
      409,
      'core_payroll:salary_advance_not_open'
    );
  }

  const fromPayrollMonth = payrollMonthValue(
    installment.payroll_month,
    'source_payroll_month'
  );
  const originalPayrollMonth = await originalPayrollMonthForInstallment(
    db,
    salonId,
    installmentId,
    fromPayrollMonth
  );

  if (targetPayrollMonth <= fromPayrollMonth) {
    throw new AppError(
      400,
      'core_payroll:salary_advance_deferral_target_must_be_later'
    );
  }

  const [sourcePayroll, targetPayroll, sourcePeriod, targetPeriod] =
    await Promise.all([
      payrollEntryForMonth(
        db,
        salonId,
        installment.employee_id,
        fromPayrollMonth
      ),
      payrollEntryForMonth(
        db,
        salonId,
        installment.employee_id,
        targetPayrollMonth
      ),
      payrollPeriodForMonth(db, salonId, fromPayrollMonth),
      payrollPeriodForMonth(db, salonId, targetPayrollMonth),
    ]);

  if (lockedPayroll(sourcePayroll)) {
    throw new AppError(
      409,
      'core_payroll:salary_advance_deferral_source_payroll_locked'
    );
  }

  if (lockedPayroll(targetPayroll)) {
    throw new AppError(
      409,
      'core_payroll:salary_advance_deferral_target_payroll_locked'
    );
  }

  if (lockedPeriod(sourcePeriod)) {
    throw new AppError(
      409,
      'core_payroll:salary_advance_deferral_source_period_locked'
    );
  }

  if (lockedPeriod(targetPeriod)) {
    throw new AppError(
      409,
      'core_payroll:salary_advance_deferral_target_period_locked'
    );
  }

  if (
    installment.payroll_entry_id &&
    (
      !sourcePayroll ||
      cleanText(sourcePayroll.id) !==
        cleanText(installment.payroll_entry_id)
    )
  ) {
    throw new AppError(
      409,
      'core_payroll:salary_advance_deferral_source_payroll_link_mismatch'
    );
  }

  const installmentAmount = Number(installment.amount_halalas || 0);
  if (!Number.isSafeInteger(installmentAmount) || installmentAmount <= 0) {
    throw new AppError(
      409,
      'core_payroll:salary_advance_deferral_source_conflict'
    );
  }

  const [sourceAdvanceHalalas, targetAdvanceHalalas] = await Promise.all([
    canonicalAdvanceHalalasForMonth(
      db,
      salonId,
      installment.employee_id,
      fromPayrollMonth
    ),
    canonicalAdvanceHalalasForMonth(
      db,
      salonId,
      installment.employee_id,
      targetPayrollMonth
    ),
  ]);

  if (sourceAdvanceHalalas < installmentAmount) {
    throw new AppError(
      409,
      'core_payroll:salary_advance_deferral_source_conflict'
    );
  }

  const postSourceAdvanceHalalas = sourceAdvanceHalalas - installmentAmount;
  const postTargetAdvanceHalalas = targetAdvanceHalalas + installmentAmount;

  if (!Number.isSafeInteger(postTargetAdvanceHalalas)) {
    throw new AppError(
      500,
      'core_payroll:salary_advance_deferral_advance_total_overflow'
    );
  }

  const eventId = requiredId(
    generatedId('salary_advance_deferral'),
    'deferralId'
  );
  const now = nowIso();

  const [sourceProjection, targetProjection] = await Promise.all([
    preparePayrollProjection(
      db,
      salonId,
      sourcePayroll,
      postSourceAdvanceHalalas,
      eventId,
      actorInfo,
      now,
      options
    ),
    preparePayrollProjection(
      db,
      salonId,
      targetPayroll,
      postTargetAdvanceHalalas,
      eventId,
      actorInfo,
      now,
      options
    ),
  ]);

  const sourceSnapshot = payrollSnapshot(sourcePayroll);
  const targetSnapshot = payrollSnapshot(targetPayroll);

  const statements = [
    {
      sql: `INSERT INTO salary_advance_installment_deferrals
        (id, salon_id, advance_id, installment_id, employee_id,
         original_payroll_month, from_payroll_month, to_payroll_month,
         amount_halalas, from_installment_updated_at,
         from_installment_payroll_entry_id,
         from_payroll_entry_id, to_payroll_entry_id,
         from_payroll_entry_updated_at, to_payroll_entry_updated_at,
         from_payroll_advances_halalas, to_payroll_advances_halalas,
         reason, note, source, idempotency_key,
         created_by_uid, created_by_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        eventId,
        salonId,
        installment.advance_id,
        installment.id,
        installment.employee_id,
        originalPayrollMonth,
        fromPayrollMonth,
        targetPayrollMonth,
        installmentAmount,
        installment.updated_at || '',
        installment.payroll_entry_id || null,
        sourceSnapshot.id,
        targetSnapshot.id,
        sourceSnapshot.updatedAt,
        targetSnapshot.updatedAt,
        sourceSnapshot.advancesHalalas,
        targetSnapshot.advancesHalalas,
        reason,
        note,
        'core_api',
        idempotencyKey,
        actorInfo.uid,
        actorInfo.email,
        now,
      ],
    },
  ];

  if (sourceProjection.statement) statements.push(sourceProjection.statement);
  if (targetProjection.statement) statements.push(targetProjection.statement);

  try {
    await dbBatch(db, statements);
  } catch (error) {
    const message = cleanText(error?.message || error?.code);

    if (
      message.includes(
        'salary_advance_installment_deferrals.salon_id'
      ) &&
      message.includes('idempotency_key')
    ) {
      const racedEvent = await getDeferralByIdempotency(
        db,
        salonId,
        idempotencyKey
      );

      if (
        sameIdempotentRequest(
          racedEvent,
          installmentId,
          targetPayrollMonth,
          reason,
          note
        )
      ) {
        return buildExistingResult(
          db,
          salonId,
          racedEvent,
          installmentId
        );
      }

      throw new AppError(
        409,
        'core_payroll:salary_advance_deferral_idempotency_conflict'
      );
    }

    throw mapIntegrityError(error);
  }

  const [event, currentInstallment, sourceAfter, targetAfter] =
    await Promise.all([
      dbFirst(
        db,
        `SELECT *
           FROM salary_advance_installment_deferrals
          WHERE salon_id = ?
            AND id = ?
          LIMIT 1`,
        [salonId, eventId]
      ),
      getInstallment(db, salonId, installmentId),
      payrollEntryForMonth(
        db,
        salonId,
        installment.employee_id,
        fromPayrollMonth
      ),
      payrollEntryForMonth(
        db,
        salonId,
        installment.employee_id,
        targetPayrollMonth
      ),
    ]);

  if (!event || !currentInstallment) {
    throw new AppError(
      500,
      'core_payroll:salary_advance_deferral_persistence_failed'
    );
  }

  if (cleanText(currentInstallment.payroll_month) !== targetPayrollMonth) {
    throw new AppError(
      500,
      'core_payroll:salary_advance_deferral_schedule_not_applied'
    );
  }

  const expectedTargetPayrollEntryId = targetPayroll?.id || null;
  if (
    cleanText(currentInstallment.payroll_entry_id) !==
    cleanText(expectedTargetPayrollEntryId)
  ) {
    throw new AppError(
      500,
      'core_payroll:salary_advance_deferral_target_link_not_applied'
    );
  }

  assertProjectionPersisted(
    sourceAfter,
    sourceProjection.preview,
    'core_payroll:salary_advance_deferral_source_projection_not_applied'
  );
  assertProjectionPersisted(
    targetAfter,
    targetProjection.preview,
    'core_payroll:salary_advance_deferral_target_projection_not_applied'
  );

  return {
    deferral: deferralDto(event),
    installment: installmentDto(currentInstallment),
    payrollRefresh: [
      {
        ...sourceProjection.result,
        payrollMonth: fromPayrollMonth,
      },
      {
        ...targetProjection.result,
        payrollMonth: targetPayrollMonth,
      },
    ],
    idempotent: false,
  };
}
