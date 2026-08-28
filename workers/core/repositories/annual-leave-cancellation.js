// CORE D1 ONLY — canonical annual-leave cancellation/reversal.
// Approved annual leave is reversed with a new ledger event; the original usage
// entry is preserved for audit and is never silently deleted.

import {
  changes,
  cleanText,
  dbBatch,
  dbFirst,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import { SA_LABOR_POLICY_VERSION } from '../../../src/helpers/hr/saLaborPolicy.js';
import { annualLeaveServiceYear } from '../../../src/helpers/hr/saLeaveEntitlements.js';
import { getAnnualLeaveState } from './annual-leave.js';

function actorField(actor, field) {
  return optionalText(actor?.[field]) || null;
}

function riyadhDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function roundDays(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

export async function cancelApprovedAnnualLeave(
  db,
  salonId,
  leave,
  decision = {},
  actor = {}
) {
  if (
    cleanText(leave?.leave_type).toLowerCase() !== 'annual' ||
    cleanText(leave?.status).toLowerCase() !== 'approved'
  ) {
    throw new AppError(
      409,
      'core_annual_leave:invalid_cancellation_state'
    );
  }

  const employeeId = requiredId(leave.employee_id, 'employeeId');
  const leaveId = requiredId(leave.id, 'leaveId');
  const adjustmentId = requiredId(
    leave.balance_adjustment_id,
    'balanceAdjustmentId'
  );

  const original = await dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND id = ?
        AND employee_id = ?
        AND entry_code = 'LEAVE_USED'
        AND source_type = 'leave_request'
        AND source_id = ?
        AND deleted_at IS NULL
      LIMIT 1`,
    [
      salonId,
      adjustmentId,
      employeeId,
      leaveId,
    ]
  );

  if (!original) {
    throw new AppError(
      409,
      'core_annual_leave:canonical_usage_entry_missing'
    );
  }

  const existingReversal = await dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND entry_code = 'LEAVE_REVERSAL'
        AND source_type = 'leave_reversal'
        AND source_id = ?
      LIMIT 1`,
    [salonId, adjustmentId]
  );

  if (existingReversal) {
    const latest = await dbFirst(
      db,
      `SELECT *
         FROM employee_leaves
        WHERE salon_id = ?
          AND id = ?
        LIMIT 1`,
      [salonId, leaveId]
    );
    if (cleanText(latest?.status).toLowerCase() === 'rejected') {
      return {
        ...latest,
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

  const restoredDays = Math.abs(
    Number(original.change_amount || 0)
  );
  if (!Number.isFinite(restoredDays) || restoredDays <= 0) {
    throw new AppError(
      409,
      'core_annual_leave:invalid_usage_entry'
    );
  }

  const asOfDate = cleanText(
    decision.entitlementAsOfDate ||
      decision.entitlement_as_of_date
  ) || riyadhDateKey();
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

  const employment = await dbFirst(
    db,
    `SELECT leave_balance_last_entry_id
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );
  if (!employment) {
    throw new AppError(
      404,
      'core_annual_leave:employee_employment_not_found'
    );
  }

  const expectedLastEntryId =
    cleanText(employment.leave_balance_last_entry_id) || null;
  const reversalId = requiredId(
    generatedId('annual_leave_reversal'),
    'reversalId'
  );
  const now = nowIso();
  const newAvailable = roundDays(
    Number(state.availableDays || 0) + restoredDays
  );
  const serviceYear = annualLeaveServiceYear(
    state.startDate,
    asOfDate
  );
  const note =
    optionalText(
      decision.hrNote ||
        decision.hr_note ||
        'إلغاء إجازة سنوية معتمدة واسترجاع الاستحقاق'
    ) || null;

  const actorUid = actorField(actor, 'uid');
  const actorEmail = actorField(actor, 'email');
  const actorName =
    actorField(actor, 'name') || actorField(actor, 'displayName');

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
               FROM employee_leaves approved_leave
              WHERE approved_leave.salon_id = ?
                AND approved_leave.id = ?
                AND approved_leave.employee_id = ?
                AND approved_leave.status = 'approved'
                AND approved_leave.leave_type = 'annual'
                AND approved_leave.balance_adjustment_id = ?
           )
           AND NOT EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger reversal
              WHERE reversal.salon_id = ?
                AND reversal.entry_code = 'LEAVE_REVERSAL'
                AND reversal.source_type = 'leave_reversal'
                AND reversal.source_id = ?
           )
      `,
      params: [
        newAvailable,
        reversalId,
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
        adjustmentId,
        salonId,
        adjustmentId,
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
          ?, ?, employment.employee_id,
          'add', ?, ?, ?, ?, ?, ?,
          'leave_reversal', ?, ?, ?, ?, ?,
          'LEAVE_REVERSAL', ?, ?, ?, ?, ?
        FROM employee_employment employment
        WHERE employment.salon_id = ?
          AND employment.employee_id = ?
          AND employment.leave_balance_last_entry_id = ?
          AND NOT EXISTS (
            SELECT 1
              FROM employee_leave_balance_ledger existing
             WHERE existing.salon_id = ?
               AND existing.entry_code = 'LEAVE_REVERSAL'
               AND existing.source_type = 'leave_reversal'
               AND existing.source_id = ?
          )
      `,
      params: [
        reversalId,
        salonId,
        restoredDays,
        restoredDays,
        state.availableDays,
        newAvailable,
        asOfDate,
        note,
        adjustmentId,
        actorUid,
        actorEmail,
        actorName,
        now,
        asOfDate,
        serviceYear.serviceYearStart,
        serviceYear.serviceYearEnd,
        SA_LABOR_POLICY_VERSION,
        JSON.stringify({
          originalUsageEntryId: adjustmentId,
          leaveId,
        }),
        salonId,
        employeeId,
        reversalId,
        salonId,
        adjustmentId,
      ],
    },
    {
      sql: `
        UPDATE employee_leaves
           SET status = 'rejected',
               hr_note = ?,
               decided_at = ?,
               decided_by_uid = ?,
               decided_by_email = ?,
               decided_by_name = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND status = 'approved'
           AND leave_type = 'annual'
           AND balance_adjustment_id = ?
           AND EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger reversal
              WHERE reversal.salon_id = ?
                AND reversal.id = ?
                AND reversal.entry_code = 'LEAVE_REVERSAL'
                AND reversal.source_type = 'leave_reversal'
                AND reversal.source_id = ?
           )
      `,
      params: [
        note,
        now,
        actorUid,
        actorEmail,
        actorName,
        now,
        salonId,
        leaveId,
        adjustmentId,
        salonId,
        reversalId,
        adjustmentId,
      ],
    },
  ]);

  if (
    changes(results?.[0]) < 1 ||
    changes(results?.[1]) < 1 ||
    changes(results?.[2]) < 1
  ) {
    throw new AppError(
      409,
      'core_annual_leave:cancellation_concurrency_conflict'
    );
  }

  const cancelled = await dbFirst(
    db,
    `SELECT *
       FROM employee_leaves
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, leaveId]
  );

  return {
    ...cancelled,
    annualLeaveState:
      await getAnnualLeaveState(
        db,
        salonId,
        employeeId
      ),
    idempotent: false,
  };
}
