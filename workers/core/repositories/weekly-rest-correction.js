import {
  dbFirst,
  dbBatch,
  dbRun,
  generatedId,
  nowIso,
  cleanText,
} from '../d1.js';

import { listAttendance } from './attendance.js';
import { attendanceWorkedMinutes } from './rest-holiday-compliance.js';

const TYPE = 'weekly_rest_due';
const MINUTES = 1440;
export const WEEKLY_REST_CORRECTION_FROM_DATE = '2026-08-31';

export async function reconcileCreditedWeeklyRest(
  db,
  salonId,
  employeeId,
  restDate,
  attendanceDb,
  actor = {},
  operationId
) {
  if (restDate < WEEKLY_REST_CORRECTION_FROM_DATE) {
    return { status: 'not_applicable' };
  }

  const assignment = await dbFirst(
    db,
    `SELECT id FROM employee_weekly_rest_work_assignments
      WHERE salon_id = ? AND employee_id = ?
        AND rest_date = ? AND status = 'completed'
      LIMIT 1`,
    [salonId, employeeId, restDate]
  );

  if (!assignment) return { status: 'not_applicable' };

  // Every reconciliation owns a monotonically increasing generation.
  // A newer reconciliation invalidates all older financial snapshots.
  const claim = await dbFirst(
    db,
    `UPDATE employee_weekly_rest_work_assignments
        SET correction_revision = correction_revision + 1,
            correction_pending = 1
      WHERE salon_id = ? AND id = ?
        AND status = 'completed'
      RETURNING correction_revision`,
    [salonId, assignment.id]
  );

  if (!claim) {
    throw new Error('weekly_rest_correction_claim_conflict');
  }

  const revision = Number(claim.correction_revision);

  async function finishCorrection(status, extra = {}) {
    const result = await dbRun(
      db,
      `UPDATE employee_weekly_rest_work_assignments
          SET correction_pending = 0
        WHERE salon_id = ? AND id = ?
          AND status = 'completed'
          AND correction_revision = ?`,
      [salonId, assignment.id, revision]
    );

    if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) {
      throw new Error('weekly_rest_correction_revision_conflict');
    }

    return { status, ...extra };
  }

  const event = await dbFirst(
    db,
    `SELECT * FROM employee_weekly_rest_events
      WHERE salon_id = ? AND employee_id = ?
        AND rest_date = ?
      LIMIT 1`,
    [salonId, employeeId, restDate]
  );

  // A completed assignment is not an ordinary non-applicable case.
  // Keep durable pending state when its financial evidence is invalid.
  if (!event) {
    throw new Error('weekly_rest_correction_event_missing');
  }

  if (event.status !== 'open') {
    throw new Error('weekly_rest_correction_event_not_open');
  }

  if (!event.entitlement_ledger_entry_id) {
    throw new Error('weekly_rest_correction_ledger_link_missing');
  }

  const attendance = attendanceWorkedMinutes(
    await listAttendance(
      db,
      salonId,
      { employeeId, date: restDate },
      attendanceDb
    ),
    restDate
  );

  const complete =
    attendance.complete && attendance.workedMinutes > 0;

  const active =
    event.restoration_status === 'owed' &&
    Number(event.substitute_rest_minutes) === MINUTES;

  const reversed =
    event.restoration_status === 'pending_review' &&
    Number(event.substitute_rest_minutes) === 0;

  const now = nowIso();
  const evidence = JSON.stringify(attendance);

  async function flagReview(reason) {
    await dbRun(
      db,
      `INSERT OR IGNORE INTO employee_labor_compliance_events (
         id, salon_id, employee_id, rule_code,
         severity, status, source_type, source_id,
         details_json, policy_version, created_by_uid, created_at
       )
       SELECT
         ?, ?, ?, 'weekly_rest_attendance_correction',
         'warning', 'open', 'weekly_rest_event', ?,
         ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1
         FROM employee_weekly_rest_work_assignments a
         WHERE a.salon_id = ?
           AND a.id = ?
           AND a.status = 'completed'
           AND a.correction_revision = ?
       )`,
      [
        'weekly-rest-correction:' + operationId,
        salonId,
        employeeId,
        event.id,
        JSON.stringify({ reason, restDate, operationId, attendance }),
        event.policy_version,
        cleanText(actor.uid) || null,
        now,
        salonId, assignment.id, revision,
      ]
    );

    return finishCorrection('review_required', { reason });
  }

  if ((complete && active) || (!complete && reversed)) {
    const result = await dbRun(
      db,
      `UPDATE employee_weekly_rest_events
          SET attendance_evidence_json = ?,
              worked_minutes = ?, updated_at = ?
        WHERE salon_id = ? AND id = ?
          AND entitlement_ledger_entry_id = ?
          AND restoration_status = ?
          AND substitute_rest_minutes = ?
          AND EXISTS (
            SELECT 1
              FROM employee_weekly_rest_work_assignments a
             WHERE a.salon_id = ?
               AND a.id = ?
               AND a.status = 'completed'
               AND a.correction_revision = ?
          )`,
      [
        evidence,
        attendance.workedMinutes,
        now,
        salonId,
        event.id,
        event.entitlement_ledger_entry_id,
        event.restoration_status,
        event.substitute_rest_minutes,
        salonId, assignment.id, revision,
      ]
    );

    if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) {
      throw new Error('weekly_rest_correction_revision_conflict');
    }

    return finishCorrection('unchanged');
  }

  if (!active && !reversed) {
    return flagReview('entitlement_not_available_for_automatic_correction');
  }

  const balance = await dbFirst(
    db,
    `SELECT * FROM employee_comp_time_balances
      WHERE salon_id = ? AND employee_id = ?
        AND entitlement_type = ?`,
    [salonId, employeeId, TYPE]
  );

  if (!balance) {
    return flagReview('balance_missing');
  }

  const last = await dbFirst(
    db,
    `SELECT * FROM employee_comp_time_ledger
      WHERE salon_id = ? AND employee_id = ?
        AND entitlement_type = ? AND id = ?`,
    [salonId, employeeId, TYPE, balance.last_entry_id]
  );

  const before = Number(balance.balance_minutes);
  const restoring = complete && reversed;

  if (restoring) {
    if (
      !last ||
      last.entry_kind !== 'debit' ||
      last.source_type !== 'weekly_rest_correction_reversal' ||
      last.source_id !== event.entitlement_ledger_entry_id ||
      Number(last.minutes) !== MINUTES
    ) {
      return flagReview('reversal_not_latest_balance_movement');
    }
  } else {
    if (
      !last ||
      last.id !== event.entitlement_ledger_entry_id ||
      last.entry_kind !== 'credit' ||
      Number(last.minutes) !== MINUTES ||
      before < MINUTES
    ) {
      return flagReview('entitlement_used_or_other_balance_activity');
    }
  }

  const entryId = generatedId('comp_time_entry');
  const entryKind = restoring ? 'credit' : 'debit';

  const sourceType = restoring
    ? 'weekly_rest_correction_restore'
    : 'weekly_rest_correction_reversal';

  const sourceId = restoring
    ? last.id
    : event.entitlement_ledger_entry_id;

  const after = restoring
    ? before + MINUTES
    : before - MINUTES;

  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_comp_time_balances
              SET balance_minutes = ?,
                  last_entry_id = ?,
                  version = version + 1,
                  updated_at = ?
            WHERE salon_id = ? AND employee_id = ?
              AND entitlement_type = ?
              AND version = ?
              AND balance_minutes = ?
              AND last_entry_id = ?
              AND EXISTS (
                SELECT 1 FROM employee_weekly_rest_events e
                 WHERE e.salon_id = ?
                   AND e.id = ?
                   AND e.status = 'open'
                   AND e.entitlement_ledger_entry_id = ?
                   AND e.restoration_status = ?
                   AND e.substitute_rest_minutes = ?
              )
              AND EXISTS (
                SELECT 1
                  FROM employee_weekly_rest_work_assignments a
                 WHERE a.salon_id = ?
                   AND a.id = ?
                   AND a.status = 'completed'
                   AND a.correction_revision = ?
              )
              AND NOT EXISTS (
                SELECT 1 FROM employee_comp_time_ledger l
                 WHERE l.salon_id = ?
                   AND l.entitlement_type = ?
                   AND l.source_type = ?
                   AND l.source_id = ?
                   AND l.entry_kind = ?
              )`,
      params: [
        after, entryId, now,
        salonId, employeeId, TYPE,
        balance.version, before, last.id,
        salonId, event.id,
        event.entitlement_ledger_entry_id,
        event.restoration_status,
        event.substitute_rest_minutes,
        salonId, assignment.id, revision,
        salonId, TYPE, sourceType, sourceId, entryKind,
      ],
    },
    {
      sql: `INSERT INTO employee_comp_time_ledger (
              id, salon_id, employee_id, entitlement_type,
              entry_kind, minutes, source_minutes,
              balance_before_minutes, balance_after_minutes,
              source_date, source_type, source_id,
              policy_version, note, created_by_uid,
              created_by_email, created_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              FROM employee_comp_time_balances
             WHERE salon_id = ? AND employee_id = ?
               AND entitlement_type = ? AND last_entry_id = ?`,
      params: [
        entryId, salonId, employeeId, TYPE,
        entryKind, MINUTES, attendance.workedMinutes,
        before, after, restDate, sourceType, sourceId,
        event.policy_version,
        'Weekly rest attendance correction: ' + operationId,
        cleanText(actor.uid) || null,
        cleanText(actor.email) || null,
        now,
        salonId, employeeId, TYPE, entryId,
      ],
    },
    {
      sql: `UPDATE employee_weekly_rest_events
              SET restoration_status = ?,
                  substitute_rest_minutes = ?,
                  entitlement_ledger_entry_id = ?,
                  attendance_evidence_json = ?,
                  worked_minutes = ?,
                  updated_at = ?
            WHERE salon_id = ? AND id = ?
              AND EXISTS (
                SELECT 1 FROM employee_comp_time_ledger
                 WHERE id = ? AND salon_id = ?
              )`,
      params: [
        restoring ? 'owed' : 'pending_review',
        restoring ? MINUTES : 0,
        restoring ? entryId : event.entitlement_ledger_entry_id,
        evidence,
        attendance.workedMinutes,
        now,
        salonId, event.id, entryId, salonId,
      ],
    },
  ]);

  const counts = results.map(
    result => Number(result?.meta?.changes ?? result?.changes ?? 0)
  );

  if (counts.every(count => count === 1)) {
    return finishCorrection(restoring ? 'restored' : 'reversed');
  }

  throw new Error('weekly_rest_correction_concurrency_conflict');
}
