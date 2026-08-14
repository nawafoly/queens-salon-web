// CORE D1 ONLY — do not add Firestore fallback.
// Approved leave balance mutations are owned by Core D1.

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
  validTime,
} from '../d1.js';
import { AppError } from '../errors.js';

const LEAVE_BALANCE_SOURCE_TYPE = 'leave_request';
const MAX_LEAVE_DAYS = 3650;

function daysBetween(startDate, endDate) {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);

  const days =
    Math.floor(
      (end.getTime() - start.getTime()) / 86400000
    ) + 1;

  if (!Number.isFinite(days) || days < 1) {
    throw new AppError(
      400,
      'core_leave:invalid_range'
    );
  }

  return days;
}

function flag(value, fallback = 0) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback ? 1 : 0;
  }

  return (
    value === true ||
    value === 1 ||
    value === '1' ||
    value === 'true'
  )
    ? 1
    : 0;
}

function balanceDays(value) {
  const days = Number(value);

  if (
    !Number.isFinite(days) ||
    days <= 0 ||
    days > MAX_LEAVE_DAYS
  ) {
    throw new AppError(
      400,
      'core_leave:invalid_balance_days'
    );
  }

  if (Math.round(days * 2) !== days * 2) {
    throw new AppError(
      400,
      'core_leave:invalid_balance_days_increment'
    );
  }

  return Math.round(days * 2) / 2;
}

function actorField(actor, field) {
  return optionalText(actor?.[field]) || null;
}

async function leaveById(
  db,
  salonId,
  id
) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_leaves
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, id]
  );
}

async function employmentByEmployee(
  db,
  salonId,
  employeeId
) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );
}

async function ledgerBySource(
  db,
  salonId,
  sourceId
) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND source_type = ?
        AND source_id = ?
      LIMIT 1`,
    [
      salonId,
      LEAVE_BALANCE_SOURCE_TYPE,
      sourceId,
    ]
  );
}

async function reversalForEntry(
  db,
  salonId,
  entryId
) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_leave_balance_ledger
      WHERE salon_id = ?
        AND source_type = 'reversal'
        AND source_id = ?
      LIMIT 1`,
    [salonId, entryId]
  );
}

export async function listLeaves(
  db,
  salonId,
  query = {}
) {
  let rows = await dbAll(
    db,
    `SELECT *
       FROM employee_leaves
      WHERE salon_id = ?
      ORDER BY start_date DESC
      LIMIT 1000`,
    [salonId]
  );

  const employeeId = cleanText(
    query.employeeId || query.employee_id
  );

  const status = cleanText(
    query.status
  ).toLowerCase();

  if (employeeId) {
    rows = rows.filter(
      (row) => row.employee_id === employeeId
    );
  }

  if (status) {
    rows = rows.filter(
      (row) =>
        cleanText(row.status).toLowerCase() ===
        status
    );
  }

  return rows;
}

export async function createLeave(
  db,
  salonId,
  data,
  actor = {}
) {
  const startDate = validDate(
    data.startDate || data.start_date,
    'startDate'
  );

  const endDate = validDate(
    data.endDate || data.end_date,
    'endDate'
  );

  if (endDate < startDate) {
    throw new AppError(
      400,
      'core_leave:invalid_range'
    );
  }

  const durationKind =
    cleanText(
      data.durationKind ||
        data.duration_kind
    ).toLowerCase() === 'partial'
      ? 'partial'
      : 'full_day';

  if (
    durationKind === 'partial' &&
    startDate !== endDate
  ) {
    throw new AppError(
      400,
      'core_leave:partial_single_day'
    );
  }

  const partialStartTime =
    durationKind === 'partial'
      ? validTime(
          data.partialStartTime ||
            data.partial_start_time,
          'partialStartTime'
        )
      : null;

  const partialEndTime =
    durationKind === 'partial'
      ? validTime(
          data.partialEndTime ||
            data.partial_end_time,
          'partialEndTime'
        )
      : null;

  if (
    durationKind === 'partial' &&
    partialStartTime >= partialEndTime
  ) {
    throw new AppError(
      400,
      'core_leave:invalid_partial_range'
    );
  }

  const requestedStatus = cleanText(
    data.status || 'pending'
  ).toLowerCase();

  // No caller may bypass the approval lifecycle.
  if (requestedStatus !== 'pending') {
    throw new AppError(
      400,
      'core_leave:create_status_must_be_pending'
    );
  }

  const rawDays = Number(
    data.daysCount ??
      data.days_count ??
      daysBetween(startDate, endDate)
  );

  if (
    !Number.isFinite(rawDays) ||
    rawDays <= 0 ||
    rawDays > MAX_LEAVE_DAYS
  ) {
    throw new AppError(
      400,
      'core_leave:invalid_days_count'
    );
  }

  const deductFromBalance = flag(
    data.deductFromBalance ??
      data.deduct_from_balance,
    0
  );

  const affectsPayroll = flag(
    data.affectsPayroll ??
      data.affects_payroll,
    0
  );

  // Balance-affecting leave is restricted to half-day
  // increments. Non-deducting partial leave may preserve
  // its fractional operational duration.
  const daysCount =
    deductFromBalance
      ? balanceDays(rawDays)
      : Math.round(rawDays * 1000) / 1000;

  const now = nowIso();

  const row = {
    id: requiredId(
      data.id || generatedId('leave')
    ),
    salon_id: salonId,
    employee_id: requiredId(
      data.employeeId || data.employee_id,
      'employeeId'
    ),
    employee_uid:
      optionalText(
        data.employeeUid ||
          data.employee_uid ||
          actor.uid
      ) || null,
    employee_name:
      optionalText(
        data.employeeName ||
          data.employee_name
      ) || null,
    employee_email:
      optionalText(
        data.employeeEmail ||
          data.employee_email
      ) || null,
    status: 'pending',
    leave_type:
      cleanText(
        data.leaveType ||
          data.leave_type ||
          'annual'
      ) || 'annual',
    start_date: startDate,
    end_date: endDate,
    days_count: daysCount,
    duration_kind: durationKind,
    partial_start_time: partialStartTime,
    partial_end_time: partialEndTime,
    request_id:
      optionalText(
        data.requestId ||
          data.request_id
      ) || null,
    deduct_from_balance: deductFromBalance,
    affects_payroll: affectsPayroll,
    balance_adjustment_id: null,
    employee_note:
      optionalText(
        data.employeeNote ||
          data.employee_note
      ) || null,
    hr_note:
      optionalText(
        data.hrNote ||
          data.hr_note
      ) || null,
    decided_at: null,
    decided_by_uid: null,
    decided_by_email: null,
    decided_by_name: null,
    created_at: now,
    updated_at: now,
  };

  await dbBatch(db, [
    {
      sql: `
        INSERT INTO employee_leaves (
          id,
          salon_id,
          employee_id,
          employee_uid,
          employee_name,
          employee_email,
          status,
          leave_type,
          start_date,
          end_date,
          days_count,
          duration_kind,
          partial_start_time,
          partial_end_time,
          request_id,
          deduct_from_balance,
          affects_payroll,
          balance_adjustment_id,
          employee_note,
          hr_note,
          decided_at,
          decided_by_uid,
          decided_by_email,
          decided_by_name,
          created_at,
          updated_at
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?
        )
      `,
      params: Object.values(row),
    },
  ]);

  return row;
}

async function approveWithoutBalance(
  db,
  salonId,
  leave,
  decision,
  actor
) {
  const now = nowIso();

  const statements = [
    {
      sql: `
        UPDATE employee_leaves
           SET status = 'approved',
               hr_note = ?,
               decided_at = ?,
               decided_by_uid = ?,
               decided_by_email = ?,
               decided_by_name = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND status = 'pending'
      `,
      params: [
        optionalText(
          decision.hrNote ||
            decision.hr_note
        ) ||
          leave.hr_note ||
          null,
        now,
        actorField(actor, 'uid'),
        actorField(actor, 'email'),
        actorField(actor, 'name'),
        now,
        salonId,
        leave.id,
      ],
    },
  ];

  if (
    cleanText(
      leave.duration_kind
    ).toLowerCase() !== 'partial'
  ) {
    statements.push({
      sql: `
        UPDATE staff
           SET leave_start_date = ?,
               leave_end_date = ?,
               leave_note = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND EXISTS (
             SELECT 1
               FROM employee_leaves current_leave
              WHERE current_leave.salon_id = ?
                AND current_leave.id = ?
                AND current_leave.status = 'approved'
           )
      `,
      params: [
        leave.start_date,
        leave.end_date,
        optionalText(
          decision.hrNote ||
            decision.hr_note ||
            leave.employee_note
        ) || null,
        now,
        salonId,
        leave.employee_id,
        salonId,
        leave.id,
      ],
    });
  }

  const results = await dbBatch(
    db,
    statements
  );

  if (changes(results?.[0]) < 1) {
    const latest = await leaveById(
      db,
      salonId,
      leave.id
    );

    if (latest?.status === 'approved') {
      return {
        ...latest,
        idempotent: true,
      };
    }

    throw new AppError(
      409,
      'core_leave:approval_not_applied'
    );
  }

  return leaveById(
    db,
    salonId,
    leave.id
  );
}

async function approveWithBalance(
  db,
  salonId,
  leave,
  decision,
  actor
) {
  const days = balanceDays(
    leave.days_count
  );

  const adjustmentId = requiredId(
    leave.balance_adjustment_id ||
      generatedId('leave_balance'),
    'balanceAdjustmentId'
  );

  const now = nowIso();

  const actorUid =
    actorField(actor, 'uid');
  const actorEmail =
    actorField(actor, 'email');
  const actorName =
    actorField(actor, 'name');

  const note =
    optionalText(
      decision.hrNote ||
        decision.hr_note ||
        leave.employee_note
    ) || null;

  const statements = [
    {
      sql: `
        UPDATE employee_employment
           SET leave_balance =
                 leave_balance - ?,
               leave_balance_last_entry_id = ?,
               updated_by_uid = ?,
               updated_by_email = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND leave_balance >= ?
           AND EXISTS (
             SELECT 1
               FROM employee_leaves pending_leave
              WHERE pending_leave.salon_id = ?
                AND pending_leave.id = ?
                AND pending_leave.employee_id = ?
                AND pending_leave.status = 'pending'
                AND pending_leave.deduct_from_balance = 1
                AND pending_leave.balance_adjustment_id IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger existing
              WHERE existing.salon_id = ?
                AND existing.source_type = ?
                AND existing.source_id = ?
           )
      `,
      params: [
        days,
        adjustmentId,
        actorUid,
        actorEmail,
        now,
        salonId,
        leave.employee_id,
        days,
        salonId,
        leave.id,
        leave.employee_id,
        salonId,
        LEAVE_BALANCE_SOURCE_TYPE,
        leave.id,
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
          created_at
        )
        SELECT
          ?,
          ?,
          employment.employee_id,
          'deduct',
          ?,
          ?,
          employment.leave_balance + ?,
          employment.leave_balance,
          ?,
          ?,
          ?,
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
          AND pending_leave.balance_adjustment_id IS NULL
      `,
      params: [
        adjustmentId,
        salonId,
        days,
        -days,
        days,
        now.slice(0, 10),
        note,
        LEAVE_BALANCE_SOURCE_TYPE,
        leave.id,
        actorUid,
        actorEmail,
        actorName,
        now,
        salonId,
        leave.employee_id,
        adjustmentId,
        leave.id,
      ],
    },
    {
      sql: `
        UPDATE employee_leaves
           SET status = 'approved',
               balance_adjustment_id = ?,
               hr_note = ?,
               decided_at = ?,
               decided_by_uid = ?,
               decided_by_email = ?,
               decided_by_name = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND status = 'pending'
           AND EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger ledger
              WHERE ledger.salon_id = ?
                AND ledger.id = ?
                AND ledger.source_type = ?
                AND ledger.source_id = ?
           )
      `,
      params: [
        adjustmentId,
        note,
        now,
        actorUid,
        actorEmail,
        actorName,
        now,
        salonId,
        leave.id,
        salonId,
        adjustmentId,
        LEAVE_BALANCE_SOURCE_TYPE,
        leave.id,
      ],
    },
  ];

  if (
    cleanText(
      leave.duration_kind
    ).toLowerCase() !== 'partial'
  ) {
    statements.push({
      sql: `
        UPDATE staff
           SET leave_start_date = ?,
               leave_end_date = ?,
               leave_note = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND EXISTS (
             SELECT 1
               FROM employee_leaves approved_leave
              WHERE approved_leave.salon_id = ?
                AND approved_leave.id = ?
                AND approved_leave.status = 'approved'
                AND approved_leave.balance_adjustment_id = ?
           )
      `,
      params: [
        leave.start_date,
        leave.end_date,
        note,
        now,
        salonId,
        leave.employee_id,
        salonId,
        leave.id,
        adjustmentId,
      ],
    });
  }

  const results = await dbBatch(
    db,
    statements
  );

  if (changes(results?.[0]) < 1) {
    const latest = await leaveById(
      db,
      salonId,
      leave.id
    );

    if (latest?.status === 'approved') {
      return {
        ...latest,
        idempotent: true,
      };
    }

    const employment =
      await employmentByEmployee(
        db,
        salonId,
        leave.employee_id
      );

    if (!employment) {
      throw new AppError(
        404,
        'core_leave:employee_employment_not_found'
      );
    }

    if (
      Number(
        employment.leave_balance || 0
      ) < days
    ) {
      throw new AppError(
        409,
        'core_leave:insufficient_balance'
      );
    }

    throw new AppError(
      409,
      'core_leave:approval_not_applied'
    );
  }

  if (
    changes(results?.[1]) < 1 ||
    changes(results?.[2]) < 1
  ) {
    throw new AppError(
      500,
      'core_leave:approval_incomplete'
    );
  }

  return leaveById(
    db,
    salonId,
    leave.id
  );
}

async function rejectPendingLeave(
  db,
  salonId,
  leave,
  decision,
  actor
) {
  const now = nowIso();

  const result = await dbBatch(db, [
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
           AND status = 'pending'
      `,
      params: [
        optionalText(
          decision.hrNote ||
            decision.hr_note
        ) ||
          leave.hr_note ||
          null,
        now,
        actorField(actor, 'uid'),
        actorField(actor, 'email'),
        actorField(actor, 'name'),
        now,
        salonId,
        leave.id,
      ],
    },
  ]);

  if (changes(result?.[0]) < 1) {
    const latest = await leaveById(
      db,
      salonId,
      leave.id
    );

    if (latest?.status === 'rejected') {
      return {
        ...latest,
        idempotent: true,
      };
    }

    throw new AppError(
      409,
      'core_leave:rejection_not_applied'
    );
  }

  return leaveById(
    db,
    salonId,
    leave.id
  );
}

async function rejectApprovedWithoutBalance(
  db,
  salonId,
  leave,
  decision,
  actor
) {
  const now = nowIso();

  const statements = [
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
      `,
      params: [
        optionalText(
          decision.hrNote ||
            decision.hr_note
        ) ||
          leave.hr_note ||
          null,
        now,
        actorField(actor, 'uid'),
        actorField(actor, 'email'),
        actorField(actor, 'name'),
        now,
        salonId,
        leave.id,
      ],
    },
  ];

  if (
    cleanText(
      leave.duration_kind
    ).toLowerCase() !== 'partial'
  ) {
    statements.push({
      sql: `
        UPDATE staff
           SET leave_start_date = NULL,
               leave_end_date = NULL,
               leave_note = NULL,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND leave_start_date = ?
           AND leave_end_date = ?
      `,
      params: [
        now,
        salonId,
        leave.employee_id,
        leave.start_date,
        leave.end_date,
      ],
    });
  }

  const results = await dbBatch(
    db,
    statements
  );

  if (changes(results?.[0]) < 1) {
    const latest = await leaveById(
      db,
      salonId,
      leave.id
    );

    if (latest?.status === 'rejected') {
      return {
        ...latest,
        idempotent: true,
      };
    }

    throw new AppError(
      409,
      'core_leave:rejection_not_applied'
    );
  }

  return leaveById(
    db,
    salonId,
    leave.id
  );
}

async function rejectApprovedWithBalance(
  db,
  salonId,
  leave,
  decision,
  actor
) {
  const originalId = requiredId(
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
        AND source_type = ?
        AND source_id = ?
      LIMIT 1`,
    [
      salonId,
      originalId,
      leave.employee_id,
      LEAVE_BALANCE_SOURCE_TYPE,
      leave.id,
    ]
  );

  if (!original) {
    throw new AppError(
      409,
      'core_leave:balance_adjustment_missing'
    );
  }

  const existingReversal =
    await reversalForEntry(
      db,
      salonId,
      originalId
    );

  if (
    original.deleted_at ||
    existingReversal
  ) {
    const latest = await leaveById(
      db,
      salonId,
      leave.id
    );

    if (latest?.status === 'rejected') {
      return {
        ...latest,
        idempotent: true,
      };
    }

    throw new AppError(
      409,
      'core_leave:reversal_state_mismatch'
    );
  }

  const originalChange = Number(
    original.change_amount || 0
  );

  if (
    !Number.isFinite(originalChange) ||
    originalChange >= 0
  ) {
    throw new AppError(
      409,
      'core_leave:invalid_balance_adjustment'
    );
  }

  const restoredDays =
    Math.abs(originalChange);

  const reversalId = requiredId(
    generatedId(
      'leave_balance_reversal'
    ),
    'reversalId'
  );

  const now = nowIso();

  const actorUid =
    actorField(actor, 'uid');
  const actorEmail =
    actorField(actor, 'email');
  const actorName =
    actorField(actor, 'name');

  const note =
    optionalText(
      decision.hrNote ||
        decision.hr_note ||
        'إلغاء إجازة معتمدة واسترجاع الرصيد'
    ) || null;

  const statements = [
    {
      sql: `
        UPDATE employee_employment
           SET leave_balance =
                 leave_balance + ?,
               leave_balance_last_entry_id = ?,
               updated_by_uid = ?,
               updated_by_email = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND EXISTS (
             SELECT 1
               FROM employee_leaves approved_leave
              WHERE approved_leave.salon_id = ?
                AND approved_leave.id = ?
                AND approved_leave.employee_id = ?
                AND approved_leave.status = 'approved'
                AND approved_leave.balance_adjustment_id = ?
           )
           AND EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger original
              WHERE original.salon_id = ?
                AND original.id = ?
                AND original.deleted_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger reversal
              WHERE reversal.salon_id = ?
                AND reversal.source_type = 'reversal'
                AND reversal.source_id = ?
           )
      `,
      params: [
        restoredDays,
        reversalId,
        actorUid,
        actorEmail,
        now,
        salonId,
        leave.employee_id,
        salonId,
        leave.id,
        leave.employee_id,
        originalId,
        salonId,
        originalId,
        salonId,
        originalId,
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
          created_at
        )
        SELECT
          ?,
          ?,
          original.employee_id,
          'add',
          ?,
          ?,
          employment.leave_balance - ?,
          employment.leave_balance,
          ?,
          ?,
          'reversal',
          original.id,
          ?,
          ?,
          ?,
          ?
        FROM employee_leave_balance_ledger original
        JOIN employee_employment employment
          ON employment.salon_id =
               original.salon_id
         AND employment.employee_id =
               original.employee_id
        WHERE original.salon_id = ?
          AND original.id = ?
          AND original.deleted_at IS NULL
          AND employment.leave_balance_last_entry_id = ?
          AND NOT EXISTS (
            SELECT 1
              FROM employee_leave_balance_ledger existing
             WHERE existing.salon_id =
                     original.salon_id
               AND existing.source_type =
                     'reversal'
               AND existing.source_id =
                     original.id
          )
      `,
      params: [
        reversalId,
        salonId,
        restoredDays,
        restoredDays,
        restoredDays,
        now.slice(0, 10),
        note,
        actorUid,
        actorEmail,
        actorName,
        now,
        salonId,
        originalId,
        reversalId,
      ],
    },
    {
      sql: `
        UPDATE employee_leave_balance_ledger
           SET deleted_at = ?,
               deleted_by_uid = ?,
               deleted_by_email = ?,
               deleted_by_name = ?,
               delete_reason = ?
         WHERE salon_id = ?
           AND id = ?
           AND deleted_at IS NULL
           AND EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger reversal
              WHERE reversal.salon_id = ?
                AND reversal.id = ?
                AND reversal.source_type =
                      'reversal'
                AND reversal.source_id = ?
           )
      `,
      params: [
        now,
        actorUid,
        actorEmail,
        actorName,
        note,
        salonId,
        originalId,
        salonId,
        reversalId,
        originalId,
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
           AND EXISTS (
             SELECT 1
               FROM employee_leave_balance_ledger reversal
              WHERE reversal.salon_id = ?
                AND reversal.id = ?
                AND reversal.source_type =
                      'reversal'
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
        leave.id,
        salonId,
        reversalId,
        originalId,
      ],
    },
  ];

  if (
    cleanText(
      leave.duration_kind
    ).toLowerCase() !== 'partial'
  ) {
    statements.push({
      sql: `
        UPDATE staff
           SET leave_start_date = NULL,
               leave_end_date = NULL,
               leave_note = NULL,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND leave_start_date = ?
           AND leave_end_date = ?
           AND EXISTS (
             SELECT 1
               FROM employee_leaves rejected_leave
              WHERE rejected_leave.salon_id = ?
                AND rejected_leave.id = ?
                AND rejected_leave.status = 'rejected'
           )
      `,
      params: [
        now,
        salonId,
        leave.employee_id,
        leave.start_date,
        leave.end_date,
        salonId,
        leave.id,
      ],
    });
  }

  const results = await dbBatch(
    db,
    statements
  );

  if (changes(results?.[0]) < 1) {
    const latest = await leaveById(
      db,
      salonId,
      leave.id
    );

    if (latest?.status === 'rejected') {
      return {
        ...latest,
        idempotent: true,
      };
    }

    throw new AppError(
      409,
      'core_leave:reversal_not_applied'
    );
  }

  if (
    changes(results?.[1]) < 1 ||
    changes(results?.[2]) < 1 ||
    changes(results?.[3]) < 1
  ) {
    throw new AppError(
      500,
      'core_leave:reversal_incomplete'
    );
  }

  return leaveById(
    db,
    salonId,
    leave.id
  );
}

export async function decideLeave(
  db,
  salonId,
  idValue,
  decision,
  actor = {}
) {
  const id = requiredId(
    idValue,
    'leaveId'
  );

  const status = cleanText(
    decision.status
  ).toLowerCase();

  if (
    !['approved', 'rejected'].includes(
      status
    )
  ) {
    throw new AppError(
      400,
      'core_leave:invalid_decision'
    );
  }

  const leave = await leaveById(
    db,
    salonId,
    id
  );

  if (!leave) {
    throw new AppError(
      404,
      'core_leave:not_found'
    );
  }

  if (leave.status === status) {
    return {
      ...leave,
      idempotent: true,
    };
  }

  if (status === 'approved') {
    if (leave.status !== 'pending') {
      throw new AppError(
        409,
        'core_leave:invalid_transition'
      );
    }

    if (
      Number(
        leave.deduct_from_balance || 0
      ) === 1
    ) {
      return approveWithBalance(
        db,
        salonId,
        leave,
        decision,
        actor
      );
    }

    return approveWithoutBalance(
      db,
      salonId,
      leave,
      decision,
      actor
    );
  }

  // Rejected pending request: no balance ever moved.
  if (leave.status === 'pending') {
    return rejectPendingLeave(
      db,
      salonId,
      leave,
      decision,
      actor
    );
  }

  // Rejecting an already approved leave is the canonical
  // cancellation path. Restore balance exactly once when
  // this leave had deducted it.
  if (leave.status === 'approved') {
    if (
      Number(
        leave.deduct_from_balance || 0
      ) === 1
    ) {
      if (!leave.balance_adjustment_id) {
        throw new AppError(
          409,
          'core_leave:balance_adjustment_missing'
        );
      }

      return rejectApprovedWithBalance(
        db,
        salonId,
        leave,
        decision,
        actor
      );
    }

    return rejectApprovedWithoutBalance(
      db,
      salonId,
      leave,
      decision,
      actor
    );
  }

  throw new AppError(
    409,
    'core_leave:invalid_transition'
  );
}