// CORE D1 ONLY — canonical Saudi annual-leave entitlement/read model.
// employee_employment.leave_balance is a compatibility projection only.
// Legal entitlement is derived from service-date accrual + canonical ledger events.

import {
  changes,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import { SA_LABOR_POLICY_VERSION } from '../../../src/helpers/hr/saLaborPolicy.js';
import {
  annualLeaveServiceYear,
  calculateAnnualLeaveAccrual,
  calculateAnnualLeaveLiveAccrual,
  calculateAnnualLeaveLiveAccrualRange,
  calculateAnnualLeaveAvailable,
} from '../../../src/helpers/hr/saLeaveEntitlements.js';

const MAX_ANNUAL_BALANCE_DAYS = 3650;
const EPSILON = 0.0001;

function roundDays(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function halfDayValue(value, field, { allowZero = false } = {}) {
  const days = Number(value);
  if (
    !Number.isFinite(days) ||
    days < (allowZero ? 0 : 0.5) ||
    days > MAX_ANNUAL_BALANCE_DAYS ||
    Math.round(days * 2) !== days * 2
  ) {
    throw new AppError(
      400,
      `core_annual_leave:invalid_${field}`,
      `${field} must use 0.5 day increments`
    );
  }
  return Math.round(days * 2) / 2;
}

function actorField(actor, field) {
  return optionalText(actor?.[field]) || null;
}

function riyadhDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function parseMetadata(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function mapLedgerEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    actionType: row.action_type,
    days: Number(row.days || 0),
    changeAmount: Number(row.change_amount || 0),
    balanceBefore: Number(row.balance_before || 0),
    balanceAfter: Number(row.balance_after || 0),
    operationDate: row.operation_date,
    effectiveDate: row.effective_date || row.operation_date,
    entryCode: row.entry_code || null,
    sourceType: row.source_type,
    sourceId: row.source_id || null,
    note: row.note || '',
    serviceYearStart: row.service_year_start || null,
    serviceYearEnd: row.service_year_end || null,
    policyVersion: row.policy_version || null,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
    deletedAt: row.deleted_at || null,
  };
}

async function employmentFor(db, salonId, employeeId) {
  return dbFirst(
    db,
    `SELECT employee_id,
            start_date,
            employment_status,
            annual_leave_contract_days,
            annual_leave_accrual_mode,
            leave_balance,
            leave_balance_last_entry_id,
            annual_leave_legacy_projection_updated_at
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );
}

async function requireEmployment(db, salonId, employeeId) {
  const row = await employmentFor(db, salonId, employeeId);
  if (!row) {
    throw new AppError(
      404,
      'core_annual_leave:employee_employment_not_found'
    );
  }
  return row;
}

async function canonicalLedgerRows(db, salonId, employeeId, asOfDate) {
  return dbAll(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND employee_id = ?
        AND deleted_at IS NULL
        AND entry_code IS NOT NULL
        AND COALESCE(effective_date, operation_date) <= ?
      ORDER BY
        COALESCE(effective_date, operation_date) ASC,
        created_at ASC,
        id ASC`,
    [salonId, employeeId, asOfDate]
  );
}

async function legacyLedgerEvidence(db, salonId, employeeId) {
  return dbFirst(
    db,
    `SELECT id, source_type, source_id, operation_date, created_at
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND employee_id = ?
        AND deleted_at IS NULL
        AND entry_code IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [salonId, employeeId]
  );
}

function openingFromRows(rows) {
  return (
    rows
      .filter((row) => row.entry_code === 'OPENING_BALANCE')
      .sort((left, right) => {
        const effective = cleanText(right.effective_date).localeCompare(
          cleanText(left.effective_date)
        );
        if (effective) return effective;
        return cleanText(right.created_at).localeCompare(
          cleanText(left.created_at)
        );
      })[0] || null
  );
}

function rowsAfterOpening(rows, opening) {
  if (!opening) {
    return rows.filter((row) => row.entry_code !== 'OPENING_BALANCE');
  }

  return rows.filter((row) => {
    if (row.id === opening.id || row.entry_code === 'OPENING_BALANCE') {
      return false;
    }

    // The opening row supersedes only events that were already known when the
    // anchor was recorded. A later HR correction can legitimately carry an
    // earlier effective date and must still change the current canonical
    // balance; created_at preserves when that historical truth was recorded.
    if (cleanText(row.created_at) < cleanText(opening.created_at)) {
      return false;
    }

    return true;
  });
}

export async function getAnnualLeaveState(
  db,
  salonId,
  employeeIdValue,
  query = {}
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const liveAccrualRequested = query.liveAccrual === true;
  const liveAsOfDateTime = liveAccrualRequested
    ? cleanText(query.asOfDateTime || query.as_of_date_time) ||
      new Date().toISOString()
    : null;
  const liveAsOfInstant = liveAccrualRequested
    ? new Date(liveAsOfDateTime)
    : null;

  if (
    liveAsOfInstant &&
    Number.isNaN(liveAsOfInstant.getTime())
  ) {
    throw new AppError(
      400,
      'core_annual_leave:invalid_as_of_date_time'
    );
  }

  const asOfDate = validDate(
    liveAsOfInstant
      ? riyadhDateKey(liveAsOfInstant)
      : query.asOfDate || query.as_of_date || riyadhDateKey(),
    'asOfDate'
  );

  const employment = await requireEmployment(
    db,
    salonId,
    employeeId
  );

  const startDate = cleanText(employment.start_date);
  const legacyBalanceDays = roundDays(employment.leave_balance || 0);

  if (!startDate) {
    return {
      employeeId,
      asOfDate,
      reviewRequired: true,
      reviewReason: 'service_start_date_required',
      legacyBalanceDays,
      leaveBalance: legacyBalanceDays,
      availableDays: null,
      entries: [],
    };
  }

  let normalizedStartDate;
  try {
    normalizedStartDate = validDate(startDate, 'startDate');
  } catch {
    return {
      employeeId,
      asOfDate,
      reviewRequired: true,
      reviewReason: 'service_start_date_invalid',
      legacyBalanceDays,
      leaveBalance: legacyBalanceDays,
      availableDays: null,
      entries: [],
    };
  }

  if (asOfDate < normalizedStartDate) {
    return {
      employeeId,
      asOfDate,
      startDate: normalizedStartDate,
      reviewRequired: true,
      reviewReason: 'as_of_before_service_start',
      legacyBalanceDays,
      leaveBalance: legacyBalanceDays,
      availableDays: null,
      entries: [],
    };
  }

  const [rows, legacyEvidence] = await Promise.all([
    canonicalLedgerRows(
      db,
      salonId,
      employeeId,
      asOfDate
    ),
    legacyLedgerEvidence(
      db,
      salonId,
      employeeId
    ),
  ]);

  const opening = openingFromRows(rows);
  const postOpeningRows = rowsAfterOpening(rows, opening);
  const hasCanonicalActivity = rows.some(
    (row) => row.entry_code !== 'OPENING_BALANCE'
  );

  // Opening balance is an optional migration aid, not a prerequisite for
  // canonical accrual. When no opening anchor exists, Core derives the
  // balance from service-date accrual plus canonical ledger movements.
  const openingRequired = false;

  const currentAccrual = calculateAnnualLeaveAccrual({
    startDate: normalizedStartDate,
    asOfDate,
    contractAnnualDays:
      employment.annual_leave_contract_days,
  });

  const liveCurrentAccrual = liveAccrualRequested
    ? calculateAnnualLeaveLiveAccrual({
        startDate: normalizedStartDate,
        asOfDateTime: liveAsOfDateTime,
        contractAnnualDays:
          employment.annual_leave_contract_days,
      })
    : null;

  const effectiveCurrentAccrual =
    liveCurrentAccrual || currentAccrual;

  if (openingRequired) {
    return {
      employeeId,
      asOfDate,
      startDate: normalizedStartDate,
      accrualMode:
        employment.annual_leave_accrual_mode ||
        'service_anniversary',
      policyVersion: SA_LABOR_POLICY_VERSION,
      reviewRequired: true,
      reviewReason: 'opening_balance_required',
      legacyBalanceDays,
      leaveBalance: legacyBalanceDays,
      earnedCurrentServiceYearDays:
        effectiveCurrentAccrual.accruedDays,
      annualEntitlementDays:
        effectiveCurrentAccrual.annualEntitlementDays,
      serviceYearStart:
        effectiveCurrentAccrual.serviceYearStart,
      serviceYearEnd:
        effectiveCurrentAccrual.serviceYearEnd,
      openingBalance: null,
      usedDays: null,
      availableDays: null,
      entries: rows.map(mapLedgerEntry),
    };
  }

  const postOpeningNetDays = roundDays(
    postOpeningRows.reduce(
      (sum, row) => sum + Number(row.change_amount || 0),
      0
    )
  );

  const openingBalanceDays = opening
    ? Number(opening.change_amount || opening.days || 0)
    : 0;

  const availability = calculateAnnualLeaveAvailable({
    startDate: normalizedStartDate,
    asOfDate,
    contractAnnualDays:
      employment.annual_leave_contract_days,
    openingBalanceEffectiveDate:
      opening?.effective_date || null,
    openingBalanceDays,
    postOpeningNetDays,
  });
  const liveAccrualSinceAnchor = liveAccrualRequested
    ? calculateAnnualLeaveLiveAccrualRange({
        startDate: normalizedStartDate,
        asOfDateTime: liveAsOfDateTime,
        contractAnnualDays:
          employment.annual_leave_contract_days,
        fromExclusiveDate: availability.openingApplied
          ? availability.openingBalanceEffectiveDate
          : null,
      })
    : null;

  const effectiveAccruedSinceAnchorDays =
    liveAccrualSinceAnchor
      ? roundDays(liveAccrualSinceAnchor.accruedDays)
      : availability.accruedSinceAnchorDays;

  const effectiveAvailableDays = liveAccrualSinceAnchor
    ? roundDays(
        availability.openingBalanceDays +
          liveAccrualSinceAnchor.accruedDays +
          availability.postOpeningNetDays
      )
    : availability.availableDays;

  const usedDays = roundDays(
    postOpeningRows
      .filter((row) => row.entry_code === 'LEAVE_USED')
      .reduce(
        (sum, row) =>
          sum + Math.abs(Number(row.change_amount || 0)),
        0
      )
  );

  const reversedDays = roundDays(
    postOpeningRows
      .filter((row) => row.entry_code === 'LEAVE_REVERSAL')
      .reduce(
        (sum, row) =>
          sum + Math.max(0, Number(row.change_amount || 0)),
        0
      )
  );

  return {
    employeeId,
    asOfDate,
    startDate: normalizedStartDate,
    accrualMode:
      employment.annual_leave_accrual_mode ||
      'service_anniversary',
    policyVersion: SA_LABOR_POLICY_VERSION,
    reviewRequired: false,
    reviewReason: null,
    legacyBalanceDays,
    leaveBalance: legacyBalanceDays,
    openingBalance: mapLedgerEntry(opening),
    openingBalanceDays: opening
      ? roundDays(openingBalanceDays)
      : 0,
    earnedCurrentServiceYearDays:
      effectiveCurrentAccrual.accruedDays,
    accruedSinceAnchorDays:
      effectiveAccruedSinceAnchorDays,
    annualEntitlementDays:
      effectiveCurrentAccrual.annualEntitlementDays,
    statutoryEntitlementDays:
      effectiveCurrentAccrual.statutoryEntitlementDays,
    contractualEntitlementDays:
      effectiveCurrentAccrual.contractualEntitlementDays,
    serviceYearStart:
      effectiveCurrentAccrual.serviceYearStart,
    serviceYearEnd:
      effectiveCurrentAccrual.serviceYearEnd,
    usedDays,
    reversedDays,
    postOpeningNetDays,
    availableDays: effectiveAvailableDays,
    entries: rows.map(mapLedgerEntry),
    compatibilityProjectionUpdatedAt:
      employment.annual_leave_legacy_projection_updated_at ||
      null,
  };
}

async function openingBySource(
  db,
  salonId,
  sourceId
) {
  if (!sourceId) return null;
  return dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND entry_code = 'OPENING_BALANCE'
        AND source_type = 'opening_balance'
        AND source_id = ?
      LIMIT 1`,
    [salonId, sourceId]
  );
}

async function activeOpening(
  db,
  salonId,
  employeeId
) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND employee_id = ?
        AND entry_code = 'OPENING_BALANCE'
        AND deleted_at IS NULL
      LIMIT 1`,
    [salonId, employeeId]
  );
}

export async function setAnnualLeaveOpeningBalance(
  db,
  salonId,
  employeeIdValue,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(
    employeeIdValue,
    'employeeId'
  );
  const rawOpeningDays = Number(
    data.days ?? data.openingBalanceDays
  );
  if (
    !Number.isFinite(rawOpeningDays) ||
    rawOpeningDays < 0 ||
    rawOpeningDays > MAX_ANNUAL_BALANCE_DAYS
  ) {
    throw new AppError(
      400,
      'core_annual_leave:invalid_opening_balance_days'
    );
  }
  // Opening anchors can be derived from prorated accrual, so they must retain
  // sub-half-day precision. Manual corrections remain half-day constrained.
  const days = roundDays(rawOpeningDays);
  const effectiveDate = validDate(
    data.effectiveDate ||
      data.effective_date ||
      data.operationDate ||
      data.operation_date ||
      riyadhDateKey(),
    'effectiveDate'
  );
  const reason = cleanText(
    data.reason || data.note
  );
  if (!reason || reason.length > 1500) {
    throw new AppError(
      400,
      'core_annual_leave:opening_reason_required'
    );
  }

  const employment = await requireEmployment(
    db,
    salonId,
    employeeId
  );
  const startDate = validDate(
    employment.start_date,
    'startDate'
  );
  if (effectiveDate < startDate) {
    throw new AppError(
      400,
      'core_annual_leave:opening_before_service_start'
    );
  }
  if (effectiveDate > riyadhDateKey()) {
    throw new AppError(
      400,
      'core_annual_leave:opening_effective_date_in_future'
    );
  }

  const sourceId = requiredId(
    data.operationId ||
      data.operation_id ||
      generatedId('annual_opening_operation'),
    'operationId'
  );

  const existingSource = await openingBySource(
    db,
    salonId,
    sourceId
  );
  if (existingSource) {
    if (cleanText(existingSource.employee_id) !== employeeId) {
      throw new AppError(
        409,
        'core_annual_leave:opening_source_employee_mismatch'
      );
    }
    return {
      state: await getAnnualLeaveState(
        db,
        salonId,
        employeeId,
        { asOfDate: effectiveDate }
      ),
      entry: mapLedgerEntry(existingSource),
      idempotent: true,
    };
  }

  const existingOpening = await activeOpening(
    db,
    salonId,
    employeeId
  );
  if (existingOpening) {
    throw new AppError(
      409,
      'core_annual_leave:opening_balance_already_exists'
    );
  }

  const serviceYear = annualLeaveServiceYear(
    startDate,
    effectiveDate
  );
  const id = requiredId(
    data.id || generatedId('annual_opening_balance'),
    'id'
  );
  const now = nowIso();
  const legacyBefore = roundDays(
    employment.leave_balance || 0
  );
  const expectedLastEntryId =
    cleanText(
      employment.leave_balance_last_entry_id
    ) || null;

  const metadata = JSON.stringify({
    reason,
    legacyProjectionBeforeDays: legacyBefore,
    source: 'manual_hr_opening_balance',
  });

  const actorUid = actorField(actor, 'uid');
  const actorEmail = actorField(actor, 'email');
  const actorName =
    actorField(actor, 'name') ||
    actorField(actor, 'displayName');

  const results = await dbBatch(db, [
    {
      sql: `
        UPDATE employee_employment
           SET leave_balance = ?,
               leave_balance_last_entry_id = ?,
               annual_leave_legacy_projection_updated_at = ?,
               updated_by_uid = ?,
               updated_by_email = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND (
             (? IS NULL AND leave_balance_last_entry_id IS NULL) OR
             leave_balance_last_entry_id = ?
           )
           AND NOT EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger opening
              WHERE opening.salon_id = ?
                AND opening.employee_id = ?
                AND opening.entry_code = 'OPENING_BALANCE'
                AND opening.deleted_at IS NULL
           )
      `,
      params: [
        days,
        id,
        now,
        actorUid,
        actorEmail,
        now,
        salonId,
        employeeId,
        expectedLastEntryId,
        expectedLastEntryId,
        salonId,
        employeeId,
      ],
    },
    {
      sql: `
        INSERT INTO employee_leave_balance_ledger (
          id,
          salon_id,
          employee_id,
          action_type,
          days,
          change_amount,
          balance_before,
          balance_after,
          operation_date,
          note,
          source_type,
          source_id,
          created_by_uid,
          created_by_email,
          created_by_name,
          created_at,
          entry_code,
          effective_date,
          service_year_start,
          service_year_end,
          policy_version,
          metadata_json
        )
        SELECT
          ?,
          ?,
          employment.employee_id,
          'add',
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          'opening_balance',
          ?,
          ?,
          ?,
          ?,
          ?,
          'OPENING_BALANCE',
          ?,
          ?,
          ?,
          ?,
          ?
        FROM employee_employment employment
        WHERE employment.salon_id = ?
          AND employment.employee_id = ?
          AND employment.leave_balance_last_entry_id = ?
          AND NOT EXISTS (
            SELECT 1
              FROM employee_leave_balance_ledger opening
             WHERE opening.salon_id = ?
               AND opening.employee_id = ?
               AND opening.entry_code = 'OPENING_BALANCE'
               AND opening.deleted_at IS NULL
          )
      `,
      params: [
        id,
        salonId,
        days,
        days,
        legacyBefore,
        days,
        effectiveDate,
        reason,
        sourceId,
        actorUid,
        actorEmail,
        actorName,
        now,
        effectiveDate,
        serviceYear.serviceYearStart,
        serviceYear.serviceYearEnd,
        SA_LABOR_POLICY_VERSION,
        metadata,
        salonId,
        employeeId,
        id,
        salonId,
        employeeId,
      ],
    },
  ]);

  if (
    changes(results?.[0]) < 1 ||
    changes(results?.[1]) < 1
  ) {
    const idempotent = await openingBySource(
      db,
      salonId,
      sourceId
    );
    if (idempotent) {
      return {
        state: await getAnnualLeaveState(
          db,
          salonId,
          employeeId,
          { asOfDate: effectiveDate }
        ),
        entry: mapLedgerEntry(idempotent),
        idempotent: true,
      };
    }

    throw new AppError(
      409,
      'core_annual_leave:opening_balance_not_applied'
    );
  }

  const entry = await dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, id]
  );

  return {
    state: await getAnnualLeaveState(
      db,
      salonId,
      employeeId,
      { asOfDate: effectiveDate }
    ),
    entry: mapLedgerEntry(entry),
    idempotent: false,
  };
}

async function annualCorrectionBySource(
  db,
  salonId,
  sourceId
) {
  if (!sourceId) return null;

  return dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND entry_code = 'MANUAL_CORRECTION'
        AND source_type = 'manual_adjustment'
        AND source_id = ?
      LIMIT 1`,
    [salonId, sourceId]
  );
}

function assertAnnualCorrectionReplay(
  existing,
  employeeId,
  action,
  days,
  effectiveDate,
  reason
) {
  if (
    cleanText(existing.employee_id) !== employeeId
  ) {
    throw new AppError(
      409,
      'core_annual_leave:adjustment_source_employee_mismatch'
    );
  }

  if (
    cleanText(existing.action_type) !== action ||
    Math.abs(Number(existing.days || 0) - days) > EPSILON ||
    cleanText(existing.effective_date) !== effectiveDate ||
    cleanText(existing.note) !== reason
  ) {
    throw new AppError(
      409,
      'core_annual_leave:adjustment_operation_mismatch'
    );
  }
}

export async function adjustAnnualLeaveBalance(
  db,
  salonId,
  employeeIdValue,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(
    employeeIdValue,
    'employeeId'
  );

  const action = cleanText(
    data.action ||
      data.actionType ||
      data.action_type
  ).toLowerCase();

  if (!['add', 'deduct'].includes(action)) {
    throw new AppError(
      400,
      'core_annual_leave:invalid_adjustment_action'
    );
  }

  const days = halfDayValue(
    data.days,
    'adjustment_days'
  );

  const effectiveDate = validDate(
    data.effectiveDate ||
      data.effective_date ||
      data.operationDate ||
      data.operation_date,
    'effectiveDate'
  );

  const today = riyadhDateKey();

  if (effectiveDate > today) {
    throw new AppError(
      400,
      'core_annual_leave:adjustment_effective_date_in_future'
    );
  }

  const reason = cleanText(
    data.reason || data.note
  );

  if (!reason || reason.length > 1500) {
    throw new AppError(
      400,
      'core_annual_leave:adjustment_reason_required'
    );
  }

  const operationId = requiredId(
    data.operationId ||
      data.operation_id,
    'operationId'
  );

  const existing = await annualCorrectionBySource(
    db,
    salonId,
    operationId
  );

  if (existing) {
    assertAnnualCorrectionReplay(
      existing,
      employeeId,
      action,
      days,
      effectiveDate,
      reason
    );

    return {
      state: await getAnnualLeaveState(
        db,
        salonId,
        employeeId
      ),
      entry: mapLedgerEntry(existing),
      idempotent: true,
    };
  }

  const state = await getAnnualLeaveState(
    db,
    salonId,
    employeeId
  );

  if (
    state.reviewRequired ||
    !Number.isFinite(Number(state.availableDays))
  ) {
    throw new AppError(
      409,
      `core_annual_leave:${
        state.reviewReason ||
        'state_review_required'
      }`
    );
  }

  if (effectiveDate < state.startDate) {
    throw new AppError(
      400,
      'core_annual_leave:adjustment_before_service_start'
    );
  }

  const before = roundDays(
    state.availableDays
  );

  const changeAmount =
    action === 'add' ? days : -days;

  const after = roundDays(
    before + changeAmount
  );

  if (after < -EPSILON) {
    throw new AppError(
      409,
      'core_annual_leave:insufficient_available_entitlement'
    );
  }

  const employment = await requireEmployment(
    db,
    salonId,
    employeeId
  );

  const expectedLastEntryId =
    cleanText(
      employment.leave_balance_last_entry_id
    ) || null;

  const id = requiredId(
    data.id ||
      generatedId('annual_leave_adjustment'),
    'id'
  );

  const serviceYear =
    annualLeaveServiceYear(
      state.startDate,
      effectiveDate
    );

  const now = nowIso();

  const actorUid = actorField(actor, 'uid');
  const actorEmail =
    actorField(actor, 'email');
  const actorName =
    actorField(actor, 'name') ||
    actorField(actor, 'displayName');

  const metadata = JSON.stringify({
    correctionAction: action,
    recordedDate: today,
    effectiveDate,
    canonicalBalanceBeforeDays: before,
    canonicalBalanceAfterDays: after,
    source: 'manual_hr_adjustment',
  });

  const results = await dbBatch(db, [
    {
      sql: `
        UPDATE employee_employment
           SET leave_balance = ?,
               leave_balance_last_entry_id = ?,
               annual_leave_legacy_projection_updated_at = ?,
               updated_by_uid = ?,
               updated_by_email = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND (
             (? IS NULL AND leave_balance_last_entry_id IS NULL) OR
             leave_balance_last_entry_id = ?
           )
           AND NOT EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger existing
              WHERE existing.salon_id = ?
                AND existing.entry_code = 'MANUAL_CORRECTION'
                AND existing.source_type = 'manual_adjustment'
                AND existing.source_id = ?
           )
      `,
      params: [
        after,
        id,
        now,
        actorUid,
        actorEmail,
        now,
        salonId,
        employeeId,
        expectedLastEntryId,
        expectedLastEntryId,
        salonId,
        operationId,
      ],
    },
    {
      sql: `
        INSERT INTO employee_leave_balance_ledger (
          id,
          salon_id,
          employee_id,
          action_type,
          days,
          change_amount,
          balance_before,
          balance_after,
          operation_date,
          note,
          source_type,
          source_id,
          created_by_uid,
          created_by_email,
          created_by_name,
          created_at,
          entry_code,
          effective_date,
          service_year_start,
          service_year_end,
          policy_version,
          metadata_json
        )
        SELECT
          ?,
          ?,
          employment.employee_id,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          'manual_adjustment',
          ?,
          ?,
          ?,
          ?,
          ?,
          'MANUAL_CORRECTION',
          ?,
          ?,
          ?,
          ?,
          ?
        FROM employee_employment employment
        WHERE employment.salon_id = ?
          AND employment.employee_id = ?
          AND employment.leave_balance_last_entry_id = ?
          AND NOT EXISTS (
            SELECT 1
              FROM employee_leave_balance_ledger existing
             WHERE existing.salon_id = ?
               AND existing.entry_code = 'MANUAL_CORRECTION'
               AND existing.source_type = 'manual_adjustment'
               AND existing.source_id = ?
          )
      `,
      params: [
        id,
        salonId,
        action,
        days,
        changeAmount,
        before,
        after,
        today,
        reason,
        operationId,
        actorUid,
        actorEmail,
        actorName,
        now,
        effectiveDate,
        serviceYear.serviceYearStart,
        serviceYear.serviceYearEnd,
        SA_LABOR_POLICY_VERSION,
        metadata,
        salonId,
        employeeId,
        id,
        salonId,
        operationId,
      ],
    },
  ]);

  if (
    changes(results?.[0]) < 1 ||
    changes(results?.[1]) < 1
  ) {
    const raced =
      await annualCorrectionBySource(
        db,
        salonId,
        operationId
      );

    if (raced) {
      assertAnnualCorrectionReplay(
        raced,
        employeeId,
        action,
        days,
        effectiveDate,
        reason
      );

      return {
        state: await getAnnualLeaveState(
          db,
          salonId,
          employeeId
        ),
        entry: mapLedgerEntry(raced),
        idempotent: true,
      };
    }

    throw new AppError(
      409,
      'core_annual_leave:adjustment_concurrency_conflict'
    );
  }

  const entry = await dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, id]
  );

  return {
    state: await getAnnualLeaveState(
      db,
      salonId,
      employeeId
    ),
    entry: mapLedgerEntry(entry),
    idempotent: false,
  };
}
async function annualUsageByLeave(
  db,
  salonId,
  leaveId
) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND entry_code = 'LEAVE_USED'
        AND source_type = 'leave_request'
        AND source_id = ?
      LIMIT 1`,
    [salonId, leaveId]
  );
}

export async function approveAnnualLeave(
  db,
  salonId,
  leave,
  decision = {},
  actor = {}
) {
  if (
    !['annual', 'emergency'].includes(
      cleanText(leave?.leave_type).toLowerCase()
    ) ||
    cleanText(leave?.status).toLowerCase() !==
      'pending'
  ) {
    throw new AppError(
      409,
      'core_annual_leave:invalid_approval_state'
    );
  }

  const employeeId = requiredId(
    leave.employee_id,
    'employeeId'
  );
  const leaveId = requiredId(
    leave.id,
    'leaveId'
  );
  const days = halfDayValue(
    leave.days_count,
    'leave_days'
  );

  const existingUsage = await annualUsageByLeave(
    db,
    salonId,
    leaveId
  );
  if (existingUsage) {
    const latestLeave = await dbFirst(
      db,
      `SELECT *
         FROM employee_leaves
        WHERE salon_id = ?
          AND id = ?
        LIMIT 1`,
      [salonId, leaveId]
    );

    if (cleanText(latestLeave?.status) === 'approved') {
      return {
        ...latestLeave,
        annualLeaveState:
          await getAnnualLeaveState(
            db,
            salonId,
            employeeId
          ),
        idempotent: true,
      };
    }
  }

  const asOfDate = validDate(
    decision.entitlementAsOfDate ||
      decision.entitlement_as_of_date ||
      riyadhDateKey(),
    'entitlementAsOfDate'
  );
  const effectiveDate = validDate(
    leave.start_date,
    'effectiveDate'
  );
  const recordedDate = riyadhDateKey();

  const state = await getAnnualLeaveState(
    db,
    salonId,
    employeeId,
    { asOfDate }
  );

  if (state.reviewRequired) {
    throw new AppError(
      409,
      `core_annual_leave:${state.reviewReason}`
    );
  }

  if (
    Number(state.availableDays || 0) + EPSILON <
    days
  ) {
    throw new AppError(
      409,
      'core_annual_leave:insufficient_available_entitlement'
    );
  }

  const employment = await requireEmployment(
    db,
    salonId,
    employeeId
  );
  const expectedLastEntryId =
    cleanText(
      employment.leave_balance_last_entry_id
    ) || null;

  const adjustmentId = requiredId(
    leave.balance_adjustment_id ||
      generatedId('annual_leave_usage'),
    'balanceAdjustmentId'
  );
  const now = nowIso();
  const newAvailable = roundDays(
    Number(state.availableDays || 0) -
      days
  );
  const serviceYear = annualLeaveServiceYear(
    state.startDate,
    effectiveDate
  );

  const note =
    optionalText(
      decision.hrNote ||
        decision.hr_note ||
        leave.employee_note
    ) || null;
  const actorUid = actorField(actor, 'uid');
  const actorEmail = actorField(actor, 'email');
  const actorName =
    actorField(actor, 'name') ||
    actorField(actor, 'displayName');

  const metadata = JSON.stringify({
    annualLeaveStartDate: leave.start_date,
    annualLeaveEndDate: leave.end_date,
    entitlementAsOfDate: asOfDate,
    recordedDate,
    effectiveDate,
    accruedSinceAnchorDays:
      state.accruedSinceAnchorDays,
    openingBalanceDays:
      state.openingBalanceDays,
    postOpeningNetDays:
      state.postOpeningNetDays,
  });

  const results = await dbBatch(db, [
    {
      sql: `
        UPDATE employee_employment
           SET leave_balance = ?,
               leave_balance_last_entry_id = ?,
               annual_leave_legacy_projection_updated_at = ?,
               updated_by_uid = ?,
               updated_by_email = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND (
             (? IS NULL AND leave_balance_last_entry_id IS NULL) OR
             leave_balance_last_entry_id = ?
           )
           AND EXISTS (
             SELECT 1
               FROM employee_leaves pending_leave
              WHERE pending_leave.salon_id = ?
                AND pending_leave.id = ?
                AND pending_leave.employee_id = ?
                AND pending_leave.status = 'pending'
                AND pending_leave.leave_type IN ('annual', 'emergency')
           )
           AND NOT EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger existing
              WHERE existing.salon_id = ?
                AND existing.entry_code = 'LEAVE_USED'
                AND existing.source_type = 'leave_request'
                AND existing.source_id = ?
           )
      `,
      params: [
        newAvailable,
        adjustmentId,
        now,
        actorUid,
        actorEmail,
        now,
        salonId,
        employeeId,
        expectedLastEntryId,
        expectedLastEntryId,
        salonId,
        leaveId,
        employeeId,
        salonId,
        leaveId,
      ],
    },
    {
      sql: `
        INSERT INTO employee_leave_balance_ledger (
          id,
          salon_id,
          employee_id,
          action_type,
          days,
          change_amount,
          balance_before,
          balance_after,
          operation_date,
          note,
          source_type,
          source_id,
          created_by_uid,
          created_by_email,
          created_by_name,
          created_at,
          entry_code,
          effective_date,
          service_year_start,
          service_year_end,
          policy_version,
          metadata_json
        )
        SELECT
          ?,
          ?,
          employment.employee_id,
          'deduct',
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          'leave_request',
          ?,
          ?,
          ?,
          ?,
          ?,
          'LEAVE_USED',
          ?,
          ?,
          ?,
          ?,
          ?
        FROM employee_employment employment
        JOIN employee_leaves pending_leave
          ON pending_leave.salon_id =
               employment.salon_id
         AND pending_leave.employee_id =
               employment.employee_id
        WHERE employment.salon_id = ?
          AND employment.employee_id = ?
          AND employment.leave_balance_last_entry_id = ?
          AND pending_leave.id = ?
          AND pending_leave.status = 'pending'
          AND pending_leave.leave_type IN ('annual', 'emergency')
      `,
      params: [
        adjustmentId,
        salonId,
        days,
        -days,
        state.availableDays,
        newAvailable,
        recordedDate,
        note,
        leaveId,
        actorUid,
        actorEmail,
        actorName,
        now,
        effectiveDate,
        serviceYear.serviceYearStart,
        serviceYear.serviceYearEnd,
        SA_LABOR_POLICY_VERSION,
        metadata,
        salonId,
        employeeId,
        adjustmentId,
        leaveId,
      ],
    },
    {
      sql: `
        UPDATE employee_leaves
           SET status = 'approved',
               deduct_from_balance = 1,
               affects_payroll = 0,
               balance_adjustment_id = ?,
               policy_version = ?,
               pay_rate_bps = 10000,
               balance_bucket = 'annual',
               legal_basis = CASE
                 WHEN leave_type = 'emergency' THEN 'COMPANY_POLICY_ANNUAL_BALANCE'
                 ELSE 'SA_LABOR_ARTICLE_109'
               END,
               documentation_status = 'not_required',
               statutory_review_required = 0,
               hr_note = ?,
               decided_at = ?,
               decided_by_uid = ?,
               decided_by_email = ?,
               decided_by_name = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND status = 'pending'
           AND leave_type IN ('annual', 'emergency')
           AND EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger ledger
              WHERE ledger.salon_id = ?
                AND ledger.id = ?
                AND ledger.entry_code = 'LEAVE_USED'
                AND ledger.source_type = 'leave_request'
                AND ledger.source_id = ?
           )
      `,
      params: [
        adjustmentId,
        SA_LABOR_POLICY_VERSION,
        note,
        now,
        actorUid,
        actorEmail,
        actorName,
        now,
        salonId,
        leaveId,
        salonId,
        adjustmentId,
        leaveId,
      ],
    },
  ]);

  if (
    changes(results?.[0]) < 1 ||
    changes(results?.[1]) < 1 ||
    changes(results?.[2]) < 1
  ) {
    const idempotent = await annualUsageByLeave(
      db,
      salonId,
      leaveId
    );
    const latestLeave = await dbFirst(
      db,
      `SELECT *
         FROM employee_leaves
        WHERE salon_id = ?
          AND id = ?
        LIMIT 1`,
      [salonId, leaveId]
    );
    if (
      idempotent &&
      cleanText(latestLeave?.status) ===
        'approved'
    ) {
      return {
        ...latestLeave,
        annualLeaveState:
          await getAnnualLeaveState(
            db,
            salonId,
            employeeId
          ),
        idempotent: true,
      };
    }

    throw new AppError(
      409,
      'core_annual_leave:approval_concurrency_conflict'
    );
  }

  const approved = await dbFirst(
    db,
    `SELECT *
       FROM employee_leaves
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, leaveId]
  );

  return {
    ...approved,
    annualLeaveState:
      await getAnnualLeaveState(
        db,
        salonId,
        employeeId
      ),
    idempotent: false,
  };
}
