// CORE D1 ONLY — Saudi statutory sick-leave year and pay-band runtime.

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
  calculateSickLeaveSegments,
} from '../../../src/helpers/hr/saLeaveEntitlements.js';

const STATUTORY_SICK_YEAR_DAYS = 120;
const EPSILON = 0.0001;

function actorField(actor, field) {
  return optionalText(actor?.[field]) || null;
}

function roundDays(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function dateParts(value, field) {
  const date = validDate(value, field);
  const [year, month, day] = date.split('-').map(Number);
  return { date, year, month, day };
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function sickYearEndExclusive(startDateValue) {
  const { year, month, day } = dateParts(startDateValue, 'sickYearStart');
  const nextYear = year + 1;
  if (month === 2 && day === 29 && !isLeapYear(nextYear)) {
    return formatDate(nextYear, 2, 28);
  }
  return formatDate(nextYear, month, day);
}

function normalizeFullSickDays(leave) {
  if (cleanText(leave?.duration_kind).toLowerCase() !== 'full_day') {
    throw new AppError(
      409,
      'core_sick_leave:partial_day_requires_hr_review'
    );
  }
  const days = Number(leave?.days_count);
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > STATUTORY_SICK_YEAR_DAYS
  ) {
    throw new AppError(
      409,
      'core_sick_leave:invalid_statutory_days'
    );
  }
  return days;
}

function documentationVerified(leave, decision = {}) {
  const status = cleanText(
    decision.documentationStatus ||
      decision.documentation_status ||
      leave?.documentation_status
  ).toLowerCase();
  return (
    decision.documentationVerified === true ||
    decision.documentation_verified === true ||
    status === 'verified'
  );
}

async function activeSegments(db, salonId, employeeId) {
  return dbAll(
    db,
    `SELECT *
       FROM employee_sick_leave_segments
      WHERE salon_id = ?
        AND employee_id = ?
        AND status = 'active'
      ORDER BY sick_year_start ASC, ordinal_from ASC`,
    [salonId, employeeId]
  );
}

async function yearStates(db, salonId, employeeId) {
  return dbAll(
    db,
    `SELECT *
       FROM employee_sick_leave_year_state
      WHERE salon_id = ?
        AND employee_id = ?
      ORDER BY sick_year_start DESC`,
    [salonId, employeeId]
  );
}

function sickYearForDate(states, segments, requestedStartDate) {
  const candidates = new Set([
    ...states.map((row) => cleanText(row.sick_year_start)),
    ...segments.map((row) => cleanText(row.sick_year_start)),
  ]);

  const active = Array.from(candidates)
    .filter(Boolean)
    .filter((start) => {
      if (start > requestedStartDate) return false;
      return requestedStartDate < sickYearEndExclusive(start);
    })
    .sort()
    .reverse()[0];

  return active || requestedStartDate;
}

function segmentsForYear(segments, sickYearStart) {
  return segments.filter(
    (row) => cleanText(row.sick_year_start) === sickYearStart
  );
}

function stateForYear(states, sickYearStart) {
  return (
    states.find(
      (row) => cleanText(row.sick_year_start) === sickYearStart
    ) || null
  );
}

export async function getSickLeaveState(
  db,
  salonId,
  employeeIdValue,
  query = {}
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const asOfDate = query.asOfDate || query.as_of_date
    ? validDate(query.asOfDate || query.as_of_date, 'asOfDate')
    : null;

  const [segments, states] = await Promise.all([
    activeSegments(db, salonId, employeeId),
    yearStates(db, salonId, employeeId),
  ]);

  let currentState = null;
  if (asOfDate) {
    currentState = states.find((row) => {
      const start = cleanText(row.sick_year_start);
      return start <= asOfDate && asOfDate < sickYearEndExclusive(start);
    }) || null;
  } else {
    currentState = states[0] || null;
  }

  if (!currentState) {
    return {
      employeeId,
      sickYearStart: null,
      sickYearEndExclusive: null,
      usedDays: 0,
      remainingStatutoryDays: STATUTORY_SICK_YEAR_DAYS,
      segments: [],
      policyVersion: SA_LABOR_POLICY_VERSION,
    };
  }

  const sickYearStart = cleanText(currentState.sick_year_start);
  const yearSegments = segmentsForYear(segments, sickYearStart);
  const segmentUsedDays = roundDays(
    yearSegments.reduce(
      (sum, row) => sum + Number(row.days || 0),
      0
    )
  );
  const stateUsedDays = roundDays(currentState.used_days || 0);
  const reviewRequired =
    Math.abs(segmentUsedDays - stateUsedDays) > EPSILON;

  return {
    employeeId,
    sickYearStart,
    sickYearEndExclusive: sickYearEndExclusive(sickYearStart),
    usedDays: stateUsedDays,
    segmentUsedDays,
    remainingStatutoryDays: Math.max(
      0,
      roundDays(STATUTORY_SICK_YEAR_DAYS - stateUsedDays)
    ),
    reviewRequired,
    reviewReason: reviewRequired
      ? 'sick_year_state_segment_mismatch'
      : null,
    version: Number(currentState.version || 0),
    segments: yearSegments,
    policyVersion: SA_LABOR_POLICY_VERSION,
  };
}

async function existingLeaveSegments(db, salonId, leaveId) {
  return dbAll(
    db,
    `SELECT *
       FROM employee_sick_leave_segments
      WHERE salon_id = ?
        AND leave_id = ?
        AND status = 'active'
      ORDER BY ordinal_from ASC`,
    [salonId, leaveId]
  );
}

export async function approveSickLeave(
  db,
  salonId,
  leave,
  decision = {},
  actor = {}
) {
  if (
    cleanText(leave?.leave_type).toLowerCase() !== 'sick' ||
    cleanText(leave?.status).toLowerCase() !== 'pending'
  ) {
    throw new AppError(
      409,
      'core_sick_leave:invalid_approval_state'
    );
  }

  if (!documentationVerified(leave, decision)) {
    throw new AppError(
      409,
      'core_sick_leave:documentation_verification_required'
    );
  }

  const employeeId = requiredId(leave.employee_id, 'employeeId');
  const leaveId = requiredId(leave.id, 'leaveId');
  const requestedDays = normalizeFullSickDays(leave);
  const startDate = validDate(leave.start_date, 'startDate');

  const existing = await existingLeaveSegments(
    db,
    salonId,
    leaveId
  );
  if (existing.length) {
    const latest = await dbFirst(
      db,
      `SELECT *
         FROM employee_leaves
        WHERE salon_id = ?
          AND id = ?
        LIMIT 1`,
      [salonId, leaveId]
    );
    if (cleanText(latest?.status).toLowerCase() === 'approved') {
      return {
        ...latest,
        sickLeaveState:
          await getSickLeaveState(
            db,
            salonId,
            employeeId,
            { asOfDate: startDate }
          ),
        idempotent: true,
      };
    }
  }

  const [segments, states] = await Promise.all([
    activeSegments(db, salonId, employeeId),
    yearStates(db, salonId, employeeId),
  ]);
  const sickYearStart = sickYearForDate(
    states,
    segments,
    startDate
  );
  const currentState = stateForYear(states, sickYearStart);
  const yearSegments = segmentsForYear(segments, sickYearStart);
  const segmentUsedDays = roundDays(
    yearSegments.reduce(
      (sum, row) => sum + Number(row.days || 0),
      0
    )
  );
  const expectedUsedDays = currentState
    ? roundDays(currentState.used_days || 0)
    : 0;
  const expectedVersion = currentState
    ? Number(currentState.version || 0)
    : 0;

  if (
    currentState &&
    Math.abs(segmentUsedDays - expectedUsedDays) > EPSILON
  ) {
    throw new AppError(
      409,
      'core_sick_leave:sick_year_state_segment_mismatch'
    );
  }

  const paySegments = calculateSickLeaveSegments({
    usedDaysBefore: expectedUsedDays,
    requestedDays,
  });

  if (
    !paySegments.length ||
    paySegments.some((segment) => segment.reviewRequired)
  ) {
    throw new AppError(
      409,
      'core_sick_leave:statutory_limit_review_required'
    );
  }

  const newUsedDays = roundDays(
    expectedUsedDays + requestedDays
  );
  if (newUsedDays > STATUTORY_SICK_YEAR_DAYS + EPSILON) {
    throw new AppError(
      409,
      'core_sick_leave:statutory_limit_review_required'
    );
  }

  const now = nowIso();
  const actorUid = actorField(actor, 'uid');
  const actorEmail = actorField(actor, 'email');
  const actorName =
    actorField(actor, 'name') ||
    actorField(actor, 'displayName');
  const note =
    optionalText(
      decision.hrNote ||
        decision.hr_note ||
        leave.employee_note
    ) || null;

  const segmentRows = paySegments.map((segment) => ({
    id: generatedId('sick_leave_segment'),
    ordinalFrom: segment.ordinalFrom,
    ordinalTo: segment.ordinalTo,
    days: segment.days,
    payRateBps: segment.payRateBps,
  }));

  const uniqueRates = Array.from(
    new Set(segmentRows.map((segment) => segment.payRateBps))
  );
  const leavePayRateBps =
    uniqueRates.length === 1 ? uniqueRates[0] : null;

  const statements = [
    {
      sql: `
        INSERT INTO employee_sick_leave_year_state (
          salon_id,
          employee_id,
          sick_year_start,
          used_days,
          version,
          last_leave_id,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, 0, 0, NULL, ?, ?)
        ON CONFLICT(salon_id, employee_id, sick_year_start)
        DO NOTHING
      `,
      params: [
        salonId,
        employeeId,
        sickYearStart,
        now,
        now,
      ],
    },
    {
      sql: `
        UPDATE employee_sick_leave_year_state
           SET used_days = ?,
               version = version + 1,
               last_leave_id = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND sick_year_start = ?
           AND used_days = ?
           AND version = ?
           AND used_days + ? <= 120
           AND EXISTS (
             SELECT 1
               FROM employee_leaves pending_leave
              WHERE pending_leave.salon_id = ?
                AND pending_leave.id = ?
                AND pending_leave.employee_id = ?
                AND pending_leave.status = 'pending'
                AND pending_leave.leave_type = 'sick'
           )
      `,
      params: [
        newUsedDays,
        leaveId,
        now,
        salonId,
        employeeId,
        sickYearStart,
        expectedUsedDays,
        expectedVersion,
        requestedDays,
        salonId,
        leaveId,
        employeeId,
      ],
    },
  ];

  for (const segment of segmentRows) {
    statements.push({
      sql: `
        INSERT INTO employee_sick_leave_segments (
          id,
          salon_id,
          employee_id,
          leave_id,
          sick_year_start,
          ordinal_from,
          ordinal_to,
          days,
          pay_rate_bps,
          policy_version,
          created_at,
          status
        )
        SELECT
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active'
        FROM employee_sick_leave_year_state state
        WHERE state.salon_id = ?
          AND state.employee_id = ?
          AND state.sick_year_start = ?
          AND state.used_days = ?
          AND state.last_leave_id = ?
          AND NOT EXISTS (
            SELECT 1
              FROM employee_sick_leave_segments existing
             WHERE existing.salon_id = ?
               AND existing.leave_id = ?
               AND existing.ordinal_from = ?
               AND existing.ordinal_to = ?
               AND existing.status = 'active'
          )
      `,
      params: [
        segment.id,
        salonId,
        employeeId,
        leaveId,
        sickYearStart,
        segment.ordinalFrom,
        segment.ordinalTo,
        segment.days,
        segment.payRateBps,
        SA_LABOR_POLICY_VERSION,
        now,
        salonId,
        employeeId,
        sickYearStart,
        newUsedDays,
        leaveId,
        salonId,
        leaveId,
        segment.ordinalFrom,
        segment.ordinalTo,
      ],
    });
  }

  statements.push({
    sql: `
      UPDATE employee_leaves
         SET status = 'approved',
             deduct_from_balance = 0,
             affects_payroll = ?,
             policy_version = ?,
             pay_rate_bps = ?,
             balance_bucket = 'sick_year',
             entitlement_source_type = 'sick_year',
             entitlement_source_id = ?,
             legal_basis = 'SA_LABOR_ARTICLE_117',
             documentation_status = 'verified',
             sick_year_start = ?,
             sick_day_ordinal_from = ?,
             sick_day_ordinal_to = ?,
             pay_segments_json = ?,
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
         AND leave_type = 'sick'
         AND EXISTS (
           SELECT 1
             FROM employee_sick_leave_year_state state
            WHERE state.salon_id = ?
              AND state.employee_id = ?
              AND state.sick_year_start = ?
              AND state.used_days = ?
              AND state.last_leave_id = ?
         )
         AND (
           SELECT COUNT(*)
             FROM employee_sick_leave_segments segment
            WHERE segment.salon_id = ?
              AND segment.leave_id = ?
              AND segment.status = 'active'
         ) = ?
    `,
    params: [
      segmentRows.some((segment) => segment.payRateBps < 10000)
        ? 1
        : 0,
      SA_LABOR_POLICY_VERSION,
      leavePayRateBps,
      sickYearStart,
      sickYearStart,
      segmentRows[0].ordinalFrom,
      segmentRows[segmentRows.length - 1].ordinalTo,
      JSON.stringify(paySegments),
      note,
      now,
      actorUid,
      actorEmail,
      actorName,
      now,
      salonId,
      leaveId,
      salonId,
      employeeId,
      sickYearStart,
      newUsedDays,
      leaveId,
      salonId,
      leaveId,
      segmentRows.length,
    ],
  });

  const results = await dbBatch(db, statements);
  if (changes(results?.[1]) < 1) {
    throw new AppError(
      409,
      'core_sick_leave:approval_concurrency_conflict'
    );
  }

  for (
    let index = 0;
    index < segmentRows.length;
    index += 1
  ) {
    if (changes(results?.[2 + index]) < 1) {
      throw new AppError(
        500,
        'core_sick_leave:segment_persistence_failed'
      );
    }
  }

  if (
    changes(results?.[2 + segmentRows.length]) < 1
  ) {
    throw new AppError(
      500,
      'core_sick_leave:approval_not_persisted'
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
    sickLeaveState:
      await getSickLeaveState(
        db,
        salonId,
        employeeId,
        { asOfDate: startDate }
      ),
    idempotent: false,
  };
}

export async function cancelApprovedSickLeave(
  db,
  salonId,
  leave,
  decision = {},
  actor = {}
) {
  if (
    cleanText(leave?.leave_type).toLowerCase() !== 'sick' ||
    cleanText(leave?.status).toLowerCase() !== 'approved'
  ) {
    throw new AppError(
      409,
      'core_sick_leave:invalid_cancellation_state'
    );
  }

  const employeeId = requiredId(leave.employee_id, 'employeeId');
  const leaveId = requiredId(leave.id, 'leaveId');
  const segments = await existingLeaveSegments(
    db,
    salonId,
    leaveId
  );

  if (!segments.length) {
    throw new AppError(
      409,
      'core_sick_leave:active_segments_missing'
    );
  }

  const sickYearStart = cleanText(segments[0].sick_year_start);
  if (
    segments.some(
      (segment) =>
        cleanText(segment.sick_year_start) !== sickYearStart
    )
  ) {
    throw new AppError(
      409,
      'core_sick_leave:mixed_sick_year_segments'
    );
  }

  const restoredDays = roundDays(
    segments.reduce(
      (sum, segment) => sum + Number(segment.days || 0),
      0
    )
  );
  const latestOrdinal = Math.max(
    ...segments.map((segment) => Number(segment.ordinal_to || 0))
  );
  const laterUsage = await dbFirst(
    db,
    `SELECT id, leave_id, ordinal_from
       FROM employee_sick_leave_segments
      WHERE salon_id = ?
        AND employee_id = ?
        AND sick_year_start = ?
        AND status = 'active'
        AND leave_id <> ?
        AND ordinal_from > ?
      ORDER BY ordinal_from ASC
      LIMIT 1`,
    [
      salonId,
      employeeId,
      sickYearStart,
      leaveId,
      latestOrdinal,
    ]
  );
  if (laterUsage) {
    throw new AppError(
      409,
      'core_sick_leave:later_usage_requires_rebuild'
    );
  }

  const state = await dbFirst(
    db,
    `SELECT *
       FROM employee_sick_leave_year_state
      WHERE salon_id = ?
        AND employee_id = ?
        AND sick_year_start = ?
      LIMIT 1`,
    [salonId, employeeId, sickYearStart]
  );

  if (!state) {
    throw new AppError(
      409,
      'core_sick_leave:sick_year_state_missing'
    );
  }

  const expectedUsedDays = roundDays(state.used_days || 0);
  const expectedVersion = Number(state.version || 0);
  if (expectedUsedDays + EPSILON < restoredDays) {
    throw new AppError(
      409,
      'core_sick_leave:invalid_reversal_usage'
    );
  }

  const newUsedDays = roundDays(
    expectedUsedDays - restoredDays
  );
  const now = nowIso();
  const actorUid = actorField(actor, 'uid');
  const actorEmail = actorField(actor, 'email');
  const actorName =
    actorField(actor, 'name') ||
    actorField(actor, 'displayName');
  const reason =
    optionalText(
      decision.hrNote ||
        decision.hr_note ||
        'إلغاء إجازة مرضية معتمدة'
    ) || null;

  const results = await dbBatch(db, [
    {
      sql: `
        UPDATE employee_sick_leave_year_state
           SET used_days = ?,
               version = version + 1,
               last_leave_id = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND employee_id = ?
           AND sick_year_start = ?
           AND used_days = ?
           AND version = ?
      `,
      params: [
        newUsedDays,
        `reversal:${leaveId}`,
        now,
        salonId,
        employeeId,
        sickYearStart,
        expectedUsedDays,
        expectedVersion,
      ],
    },
    {
      sql: `
        UPDATE employee_sick_leave_segments
           SET status = 'reversed',
               reversed_at = ?,
               reversed_by_uid = ?,
               reversal_reason = ?
         WHERE salon_id = ?
           AND leave_id = ?
           AND status = 'active'
           AND EXISTS (
             SELECT 1
               FROM employee_sick_leave_year_state state
              WHERE state.salon_id = ?
                AND state.employee_id = ?
                AND state.sick_year_start = ?
                AND state.used_days = ?
                AND state.last_leave_id = ?
           )
      `,
      params: [
        now,
        actorUid,
        reason,
        salonId,
        leaveId,
        salonId,
        employeeId,
        sickYearStart,
        newUsedDays,
        `reversal:${leaveId}`,
      ],
    },
    {
      sql: `
        UPDATE employee_leaves
           SET status = 'rejected',
               statutory_review_required = 0,
               hr_note = ?,
               decided_at = ?,
               decided_by_uid = ?,
               decided_by_email = ?,
               decided_by_name = ?,
               updated_at = ?
         WHERE salon_id = ?
           AND id = ?
           AND status = 'approved'
           AND leave_type = 'sick'
           AND NOT EXISTS (
             SELECT 1
               FROM employee_sick_leave_segments segment
              WHERE segment.salon_id = ?
                AND segment.leave_id = ?
                AND segment.status = 'active'
           )
      `,
      params: [
        reason,
        now,
        actorUid,
        actorEmail,
        actorName,
        now,
        salonId,
        leaveId,
        salonId,
        leaveId,
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
      'core_sick_leave:cancellation_concurrency_conflict'
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
    sickLeaveState:
      await getSickLeaveState(
        db,
        salonId,
        employeeId,
        { asOfDate: leave.start_date }
      ),
  };
}
