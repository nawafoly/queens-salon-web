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
