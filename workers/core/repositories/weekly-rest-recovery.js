import { reconcileCreditedWeeklyRest } from './weekly-rest-correction.js';
import { dbAll, dbRun, cleanText, validDate } from '../d1.js';
import {
  reconcileAssignedWeeklyRestWork,
} from './leave-rest-workflows.js';

export const APPROVED_WEEKLY_REST_RECOVERY_FROM_DATE = '2026-08-31';

export async function recoverAssignedWeeklyRestWork(
  db,
  salonId,
  externalAttendanceDb,
  options = {}
) {
  const fromDate = cleanText(options.fromDate);

  if (!fromDate) {
    return { enabled: false, processed: 0 };
  }

  validDate(fromDate, 'fromDate');

  if (!externalAttendanceDb) {
    throw new Error('weekly_rest_recovery_attendance_unavailable');
  }

  const now = options.now || new Date();

  const localNow = new Date(
    now.getTime() + 3 * 60 * 60 * 1000
  ).toISOString().slice(0, 19);

  const today = localNow.slice(0, 10);

  const employeeId = cleanText(options.employeeId);
  const restDate = cleanText(options.restDate);

  if (Boolean(employeeId) !== Boolean(restDate)) {
    throw new Error('weekly_rest_recovery_invalid_target');
  }

  if (restDate) validDate(restDate, 'restDate');

  const targetSql = employeeId
    ? 'AND a.employee_id = ? AND a.rest_date = ?'
    : '';

  const candidateSql = `FROM employee_weekly_rest_work_assignments a
      WHERE a.salon_id = ?
        AND (
          a.status = 'assigned'
          OR (
            a.status = 'completed'
            AND a.correction_pending = 1
          )
        )
        AND a.rest_date >= ?
        AND a.rest_date <= ?
        ${targetSql}
        AND datetime(
          a.rest_date || ' ' || a.end_time,
          CASE
            WHEN a.end_time <= a.start_time
              THEN '+1 day'
            ELSE '+0 day'
          END
        ) <= datetime(?)
        AND (
          (a.status = 'completed' AND a.correction_pending = 1)
          OR NOT EXISTS (
          SELECT 1
            FROM employee_comp_time_ledger l
           WHERE l.salon_id = a.salon_id
             AND l.employee_id = a.employee_id
             AND l.entitlement_type = 'weekly_rest_due'
             AND l.entry_kind = 'credit'
             AND (
               (
                 l.source_type <> 'weekly_rest_event'
                 AND l.source_date = a.rest_date
               )
               OR (
                 l.source_type = 'historical_opening_balance'
                 AND l.source_date >= a.rest_date
               )
             )
          )
        )
  `;

  const params = [
    salonId,
    fromDate,
    today,
    ...(employeeId ? [employeeId, restDate] : []),
    localNow,
  ];
  const batchSize = 20;

  const counts = await dbAll(
    db,
    `SELECT COUNT(*) AS total ${candidateSql}`,
    params
  );

  const total = Number(counts[0]?.total || 0);
  const pages = Math.max(1, Math.ceil(total / batchSize));
  const cycle = Math.floor(now.getTime() / 300000);
  const offset = (cycle % pages) * batchSize;

  const assignments = await dbAll(
    db,
    `SELECT a.id, a.employee_id, a.rest_date, a.status, a.correction_pending
     ${candidateSql}
     ORDER BY a.rest_date DESC, a.id
     LIMIT ? OFFSET ?`,
    [...params, batchSize, offset]
  );

  const summary = {
    enabled: true,
    candidates: assignments.length,
    processed: 0,
    credited: 0,
    pending: 0,
    failed: 0,
    batchLimitReached: total > batchSize,
  };

  const reconcile =
    options.reconcile || reconcileAssignedWeeklyRestWork;

  for (const assignment of assignments) {
    summary.processed += 1;

    try {
      if (
        assignment.status === 'completed' &&
        Number(assignment.correction_pending) === 1
      ) {
        const correction = await reconcileCreditedWeeklyRest(
          db,
          salonId,
          assignment.employee_id,
          assignment.rest_date,
          externalAttendanceDb,
          { uid: 'system:weekly-rest-recovery' },
          `pending-correction:${assignment.id}`
        );

        if (correction.status === 'not_applicable') {
          throw new Error('weekly_rest_pending_event_missing');
        }

        // Pending state is finalized by the correction engine.

        summary.corrected = (summary.corrected || 0) + 1;
        continue;
      }

      if (!options.reconcile && assignment.status === 'assigned') {
        const confirmed = await dbAll(
          db,
          `SELECT e.id, e.entitlement_ledger_entry_id, l.id AS ledger_id
             FROM employee_weekly_rest_events e
             JOIN employee_comp_time_ledger l
               ON l.salon_id = e.salon_id
              AND l.employee_id = e.employee_id
              AND l.source_id = e.id
              AND l.source_date = e.rest_date
              AND (
                e.entitlement_ledger_entry_id IS NULL
                OR l.id = e.entitlement_ledger_entry_id
              )
            WHERE e.salon_id = ?
              AND e.employee_id = ?
              AND e.rest_date = ?
              AND e.status = 'open'
              AND l.entitlement_type = 'weekly_rest_due'
              AND l.entry_kind = 'credit'
              AND l.source_type = 'weekly_rest_event'
              AND l.minutes = 1440
              AND l.source_id = e.id
            LIMIT 1`,
          [salonId, assignment.employee_id, assignment.rest_date]
        );

        if (confirmed.length) {
          const existingCredit = confirmed[0];

          if (!existingCredit.entitlement_ledger_entry_id) {
            await dbRun(
              db,
              `UPDATE employee_weekly_rest_events
                  SET entitlement_ledger_entry_id = ?,
                      restoration_status = 'owed',
                      substitute_rest_minutes = 1440,
                      restoration_confirmed_at = COALESCE(
                        restoration_confirmed_at, ?
                      ),
                      restoration_confirmed_by_uid = COALESCE(
                        restoration_confirmed_by_uid,
                        'system:weekly-rest-recovery'
                      ),
                      updated_at = ?
                WHERE salon_id = ?
                  AND id = ?
                  AND employee_id = ?
                  AND rest_date = ?
                  AND status = 'open'
                  AND entitlement_ledger_entry_id IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM employee_comp_time_ledger l
                    WHERE l.id = ?
                      AND l.salon_id = ?
                      AND l.employee_id = ?
                      AND l.entitlement_type = 'weekly_rest_due'
                      AND l.entry_kind = 'credit'
                      AND l.source_type = 'weekly_rest_event'
                      AND l.source_id = ?
                      AND l.source_date = ?
                      AND l.minutes = 1440
                  )`,
              [
                existingCredit.ledger_id,
                now.toISOString(),
                now.toISOString(),
                salonId,
                existingCredit.id,
                assignment.employee_id,
                assignment.rest_date,
                existingCredit.ledger_id,
                salonId,
                assignment.employee_id,
                existingCredit.id,
                assignment.rest_date,
              ]
            );

            const linked = await dbAll(
              db,
              `SELECT id
                 FROM employee_weekly_rest_events
                WHERE salon_id = ?
                  AND id = ?
                  AND entitlement_ledger_entry_id = ?
                LIMIT 1`,
              [
                salonId,
                existingCredit.id,
                existingCredit.ledger_id,
              ]
            );

            if (!linked.length) {
              throw new Error('weekly_rest_ledger_link_conflict');
            }
          }

          await dbRun(
            db,
            `UPDATE employee_weekly_rest_work_assignments
                SET status = 'completed',
                    correction_pending = 1,
                    completed_at = ?,
                    updated_at = ?
              WHERE salon_id = ? AND id = ?
                AND status = 'assigned'`,
            [
              now.toISOString(),
              now.toISOString(),
              salonId,
              assignment.id,
            ]
          );

          const correction = await reconcileCreditedWeeklyRest(
            db,
            salonId,
            assignment.employee_id,
            assignment.rest_date,
            externalAttendanceDb,
            { uid: 'system:weekly-rest-recovery' },
            `unfinished-confirmation:${assignment.id}`
          );

          if (correction.status === 'not_applicable') {
            throw new Error('weekly_rest_unfinished_event_missing');
          }

          // Pending state is finalized by the correction engine.

          summary.corrected = (summary.corrected || 0) + 1;
          continue;
        }
      }

      const result = await reconcile(
        db,
        salonId,
        assignment.employee_id,
        assignment.rest_date,
        { uid: 'system:weekly-rest-recovery' },
        externalAttendanceDb,
        { weeklyRestRecoveryAssignmentId: assignment.id }
      );

      if (result?.entitlement) {
        summary.credited += 1;
      } else {
        summary.pending += 1;
      }
    } catch {
      summary.failed += 1;
    }
  }

  console.log(JSON.stringify({
    event: 'weekly_rest_recovery_summary',
    ...summary,
  }));

  return summary;
}
