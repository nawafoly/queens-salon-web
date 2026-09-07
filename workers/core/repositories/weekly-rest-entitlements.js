// CORE D1 ONLY — weekly-rest restoration entitlement.
// Working on a weekly-rest date is evidence. HR/system must confirm that the
// statutory 24-hour rest block is owed before a weekly_rest_due credit exists.

import {
  cleanText,
  dbFirst,
  dbRun,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  SA_LABOR_LIMITS,
  SA_LABOR_POLICY_VERSION,
} from '../../../src/helpers/hr/saLaborPolicy.js';
import {
  creditCompTime,
  debitCompTime,
  getCompTimeBalanceState,
} from './comp-time.js';

const WEEKLY_REST_MINUTES = SA_LABOR_LIMITS.weeklyRestMinimumHours * 60;

const HISTORICAL_OPENING_SOURCE_TYPE = 'historical_opening_balance';
const MAX_HISTORICAL_WEEKLY_REST_DAYS = 366;

function riyadhDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function historicalOpeningDays(value) {
  const days = Number(value);
  if (
    !Number.isInteger(days) ||
    days <= 0 ||
    days > MAX_HISTORICAL_WEEKLY_REST_DAYS
  ) {
    throw new AppError(
      400,
      'core_weekly_rest:historical_opening_invalid_days'
    );
  }
  return days;
}

function requiredHistoricalOpeningText(value, code, maxLength) {
  const text = cleanText(value);
  if (!text || text.length > maxLength) {
    throw new AppError(400, code);
  }
  return text;
}

function historicalOpeningSourceId(employeeId) {
  const id = `${employeeId}:historical-weekly-rest-opening`;
  if (id.length > 240) {
    throw new AppError(
      400,
      'core_weekly_rest:historical_opening_generated_source_id_too_long'
    );
  }
  return id;
}


function parseJson(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function confirmWeeklyRestDue(
  db,
  salonId,
  eventIdValue,
  actor = {},
  input = {}
) {
  const eventId = requiredId(eventIdValue, 'weeklyRestEventId');
  const event = await dbFirst(
    db,
    `SELECT * FROM employee_weekly_rest_events
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, eventId]
  );
  if (!event) throw new AppError(404, 'core_weekly_rest:event_not_found');
  if (cleanText(event.status).toLowerCase() === 'cancelled') {
    throw new AppError(409, 'core_weekly_rest:event_cancelled');
  }

  if (event.entitlement_ledger_entry_id) {
    return {
      event,
      state: await getCompTimeBalanceState(
        db,
        salonId,
        event.employee_id,
        'weekly_rest_due'
      ),
      idempotent: true,
    };
  }

  const evidence = parseJson(event.attendance_evidence_json);
  if (!evidence.complete || Number(event.worked_minutes || 0) <= 0) {
    throw new AppError(409, 'core_weekly_rest:complete_work_evidence_required');
  }

  const credit = await creditCompTime(
    db,
    salonId,
    {
      employeeId: event.employee_id,
      entitlementType: 'weekly_rest_due',
      minutes: WEEKLY_REST_MINUTES,
      sourceMinutes: Number(event.worked_minutes || 0),
      sourceDate: event.rest_date,
      sourceType: 'weekly_rest_event',
      sourceId: event.id,
      policyVersion: SA_LABOR_POLICY_VERSION,
      note:
        optionalText(input.note) ||
        'استحقاق راحة أسبوعية بديلة لمدة 24 ساعة متصلة',
    },
    actor
  );

  const now = nowIso();
  const result = await dbRun(
    db,
    `UPDATE employee_weekly_rest_events
        SET restoration_status = 'owed',
            substitute_rest_minutes = ?,
            entitlement_ledger_entry_id = ?,
            restoration_confirmed_at = ?,
            restoration_confirmed_by_uid = ?,
            updated_at = ?
      WHERE salon_id = ? AND id = ?
        AND entitlement_ledger_entry_id IS NULL
        AND status = 'open'`,
    [
      WEEKLY_REST_MINUTES,
      credit.entry.id,
      now,
      cleanText(actor.uid) || null,
      now,
      salonId,
      event.id,
    ]
  );

  if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) {
    const latest = await dbFirst(
      db,
      `SELECT * FROM employee_weekly_rest_events
        WHERE salon_id = ? AND id = ? LIMIT 1`,
      [salonId, event.id]
    );
    if (cleanText(latest?.entitlement_ledger_entry_id) === cleanText(credit.entry.id)) {
      return { event: latest, state: credit.state, idempotent: true };
    }
    throw new AppError(409, 'core_weekly_rest:confirmation_concurrency_conflict');
  }

  return {
    event: await dbFirst(
      db,
      `SELECT * FROM employee_weekly_rest_events
        WHERE salon_id = ? AND id = ? LIMIT 1`,
      [salonId, event.id]
    ),
    state: credit.state,
    idempotent: credit.idempotent,
  };
}


export async function setHistoricalWeeklyRestOpeningBalance(
  db,
  salonId,
  employeeIdValue,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const days = historicalOpeningDays(
    data.days ?? data.openingBalanceDays ?? data.opening_balance_days
  );
  const minutes = days * WEEKLY_REST_MINUTES;

  const effectiveDate = validDate(
    data.effectiveDate ||
      data.effective_date ||
      data.asOfDate ||
      data.as_of_date,
    'effectiveDate'
  );

  if (effectiveDate > riyadhDateKey()) {
    throw new AppError(
      400,
      'core_weekly_rest:historical_opening_effective_date_in_future'
    );
  }

  const reason = requiredHistoricalOpeningText(
    data.reason || data.note,
    'core_weekly_rest:historical_opening_reason_required',
    1500
  );

  const employment = await dbFirst(
    db,
    `SELECT employee_id, start_date
       FROM employee_employment
      WHERE salon_id = ? AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );

  if (!employment) {
    throw new AppError(
      404,
      'core_weekly_rest:employee_employment_not_found'
    );
  }

  const employmentStartDate = cleanText(employment.start_date);
  if (
    employmentStartDate &&
    effectiveDate < validDate(employmentStartDate, 'startDate')
  ) {
    throw new AppError(
      400,
      'core_weekly_rest:historical_opening_before_service_start'
    );
  }

  const sourceId = historicalOpeningSourceId(
    employeeId
  );

  const existing = await dbFirst(
    db,
    `SELECT *
       FROM employee_comp_time_ledger
      WHERE salon_id = ?
        AND employee_id = ?
        AND entitlement_type = 'weekly_rest_due'
        AND entry_kind = 'credit'
        AND source_type = ?
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [
      salonId,
      employeeId,
      HISTORICAL_OPENING_SOURCE_TYPE,
    ]
  );

  if (existing) {
    if (
      Number(existing.minutes || 0) !== minutes ||
      cleanText(existing.source_date) !== effectiveDate ||
      cleanText(existing.note) !== reason
    ) {
      throw new AppError(
        409,
        'core_weekly_rest:historical_opening_balance_already_exists'
      );
    }

    return {
      entry: existing,
      state: await getCompTimeBalanceState(
        db,
        salonId,
        employeeId,
        'weekly_rest_due'
      ),
      idempotent: true,
    };
  }

  // HISTORICAL_OPENING_DB_GUARD_V1
  // The partial unique index guarantees one opening credit per employee even
  // when concurrent historical-opening submissions race.
  try {
    return await creditCompTime(
      db,
      salonId,
      {
        employeeId,
        entitlementType: 'weekly_rest_due',
        minutes,
        sourceDate: effectiveDate,
        sourceType: HISTORICAL_OPENING_SOURCE_TYPE,
        sourceId,
        policyVersion: SA_LABOR_POLICY_VERSION,
        note: reason,
      },
      actor
    );
  } catch (error) {
    const raced = await dbFirst(
      db,
      `SELECT *
         FROM employee_comp_time_ledger
        WHERE salon_id = ?
          AND employee_id = ?
          AND entitlement_type = 'weekly_rest_due'
          AND entry_kind = 'credit'
          AND source_type = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
      [
        salonId,
        employeeId,
        HISTORICAL_OPENING_SOURCE_TYPE,
      ]
    );

    if (!raced) throw error;

    if (
      Number(raced.minutes || 0) !== minutes ||
      cleanText(raced.source_date) !== effectiveDate ||
      cleanText(raced.note) !== reason
    ) {
      throw new AppError(
        409,
        'core_weekly_rest:historical_opening_balance_already_exists'
      );
    }

    return {
      entry: raced,
      state: await getCompTimeBalanceState(
        db,
        salonId,
        employeeId,
        'weekly_rest_due'
      ),
      idempotent: true,
    };
  }
}

export async function adjustWeeklyRestDue(
  db,
  salonId,
  employeeIdValue,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const action = cleanText(data.action || data.actionType || data.action_type)
    .toLowerCase();

  if (!['credit', 'debit'].includes(action)) {
    throw new AppError(400, 'core_weekly_rest:invalid_adjustment_action');
  }

  const days = Number(data.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_HISTORICAL_WEEKLY_REST_DAYS) {
    throw new AppError(400, 'core_weekly_rest:invalid_adjustment_days');
  }

  const effectiveDate = validDate(
    data.effectiveDate ||
      data.effective_date ||
      data.operationDate ||
      data.operation_date,
    'effectiveDate'
  );

  if (effectiveDate > riyadhDateKey()) {
    throw new AppError(400, 'core_weekly_rest:adjustment_effective_date_in_future');
  }

  const reason = cleanText(data.reason || data.note);
  if (!reason || reason.length > 1500) {
    throw new AppError(400, 'core_weekly_rest:adjustment_reason_required');
  }

  const operationId = requiredId(
    data.operationId || data.operation_id,
    'operationId'
  );

  const mutation = {
    employeeId,
    entitlementType: 'weekly_rest_due',
    minutes: days * WEEKLY_REST_MINUTES,
    sourceMinutes: days * WEEKLY_REST_MINUTES,
    sourceDate: effectiveDate,
    sourceType: 'manual_adjustment',
    sourceId: operationId,
    policyVersion: SA_LABOR_POLICY_VERSION,
    note: reason,
  };

  return action === 'credit'
    ? creditCompTime(db, salonId, mutation, actor)
    : debitCompTime(db, salonId, mutation, actor);
}

export async function consumeWeeklyRestDue(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const sourceId = requiredId(data.sourceId || data.source_id, 'sourceId');
  const minutes = data.minutes == null ? WEEKLY_REST_MINUTES : Number(data.minutes);

  if (!Number.isInteger(minutes) || minutes !== WEEKLY_REST_MINUTES) {
    throw new AppError(409, 'core_weekly_rest:must_consume_24_consecutive_hours');
  }

  return debitCompTime(
    db,
    salonId,
    {
      employeeId,
      entitlementType: 'weekly_rest_due',
      minutes,
      sourceMinutes: minutes,
      sourceDate: cleanText(data.sourceDate || data.source_date) || null,
      sourceType: cleanText(data.sourceType || data.source_type) || 'weekly_rest_substitute_use',
      sourceId,
      policyVersion: SA_LABOR_POLICY_VERSION,
      note: optionalText(data.note) || 'استخدام راحة أسبوعية بديلة لمدة 24 ساعة متصلة',
    },
    actor
  );
}

export { WEEKLY_REST_MINUTES };
