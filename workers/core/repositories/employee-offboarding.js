// CORE D1 ONLY — do not add Firestore fallback.
// Canonical employee lifecycle termination. Firebase identity is preserved;
// Core D1 account/link state and the offboarding fence are operational authority.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  nowIso,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import { auditInsertStatement } from './audit.js';
import {
  employeeOffboardingAccountDisableStatement,
  planEmployeeOffboardingAccountAccess,
} from './accounts.js';

const CLOSED_PROFILE_STATUS = 'inactive';
const CLOSED_EMPLOYMENT_STATUS = 'inactive';
const CURRENT_LINK_STATUSES = new Set(['active', 'pending']);

function statusLower(value) {
  return cleanText(value).toLowerCase();
}

function requiredOffboardingReason(value) {
  const reason = cleanText(value);
  if (!reason) throw new AppError(400, 'core_hr:offboarding_reason_required');
  if (reason.length > 1000) throw new AppError(400, 'core_hr:offboarding_reason_invalid');
  return reason;
}

function requiredOffboardingEndDate(value) {
  const raw = cleanText(value);
  if (!raw) throw new AppError(400, 'core_hr:offboarding_end_date_required');
  return validDate(raw, 'endDate');
}

function riyadhBusinessDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new AppError(500, 'core_hr:offboarding_clock_invalid');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function bookingReference(row) {
  return cleanText(row?.public_id || row?.id);
}

async function bookingEvidenceSummary(db, salonId, employeeId, endDate, businessDate, mode) {
  const postEndConflict = mode === 'post_end';
  const predicate = postEndConflict
    ? `(
         LOWER(COALESCE(b.status, '')) = 'completed'
         OR b.completed_at IS NOT NULL
         OR (
           evidence.effective_booking_date < ?
           AND LOWER(COALESCE(b.status, '')) NOT IN ('cancelled','canceled','rejected')
         )
       )`
    : `evidence.effective_booking_date >= ?
       AND LOWER(COALESCE(b.status, '')) NOT IN ('completed','cancelled','canceled','rejected')
       AND b.completed_at IS NULL`;
  const fromSql = `
       FROM (
         SELECT b.id, b.public_id, b.booking_date AS effective_booking_date
           FROM bookings b
          WHERE b.salon_id = ?
            AND b.deleted_at IS NULL
            AND b.staff_id = ?
            AND b.booking_date > ?
         UNION ALL
         SELECT b.id, b.public_id, COALESCE(bi.booking_date, b.booking_date) AS effective_booking_date
           FROM bookings b
           JOIN booking_items bi
             ON bi.salon_id = b.salon_id
            AND bi.booking_id = b.id
          WHERE b.salon_id = ?
            AND b.deleted_at IS NULL
            AND bi.staff_id = ?
            AND COALESCE(bi.booking_date, b.booking_date) > ?
       ) evidence
       JOIN bookings b ON b.salon_id = ? AND b.id = evidence.id
      WHERE ${predicate}`;
  const params = [
    salonId,
    employeeId,
    endDate,
    salonId,
    employeeId,
    endDate,
    salonId,
    businessDate,
  ];
  const [countRow, rows] = await Promise.all([
    dbFirst(db, `SELECT COUNT(DISTINCT evidence.id) AS count ${fromSql}`, params),
    dbAll(
      db,
      `SELECT DISTINCT evidence.id, evidence.public_id, evidence.effective_booking_date, b.status
       ${fromSql}
       ORDER BY evidence.effective_booking_date, evidence.id
       LIMIT 20`,
      params
    ),
  ]);
  return {
    count: Math.max(0, Number(countRow?.count || 0)),
    bookingIds: rows.map(bookingReference).filter(Boolean),
  };
}

async function bookingConflictEvidence(db, salonId, employeeId, endDate, businessDate) {
  const [postEndDateActivity, upcomingOperational] = await Promise.all([
    bookingEvidenceSummary(db, salonId, employeeId, endDate, businessDate, 'post_end'),
    bookingEvidenceSummary(db, salonId, employeeId, endDate, businessDate, 'upcoming'),
  ]);
  return { postEndDateActivity, upcomingOperational };
}

function throwBookingConflict(evidence, employeeId, endDate, businessDate) {
  if (evidence.postEndDateActivity.count > 0) {
    throw new AppError(
      409,
      'core_hr:offboarding_post_end_date_activity_conflict',
      'Requested end date conflicts with finalized or historical post-end-date activity',
      {
        employeeId,
        endDate,
        businessDate,
        ...evidence.postEndDateActivity,
      }
    );
  }
  if (evidence.upcomingOperational.count > 0) {
    throw new AppError(
      409,
      'core_hr:offboarding_future_bookings_require_reassignment',
      'Upcoming operational bookings must be reassigned before employee offboarding',
      {
        employeeId,
        endDate,
        businessDate,
        ...evidence.upcomingOperational,
      }
    );
  }
}

function accountFromJoinedLink(row) {
  if (!cleanText(row?.account_id)) return null;
  return {
    id: row.account_id,
    salon_id: row.salon_id,
    firebase_uid: row.account_firebase_uid || null,
    email: row.account_email || null,
    display_name: row.account_display_name || null,
    primary_role: row.primary_role || null,
    status: row.account_status || null,
    deleted_at: row.account_deleted_at || null,
  };
}

async function loadLifecycleFacts(db, salonId, employeeId) {
  const [profile, employment, staff, links, schedules, assignments, exceptions, fence] = await Promise.all([
    dbFirst(db, 'SELECT * FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, employeeId]),
    dbFirst(db, 'SELECT * FROM employee_employment WHERE salon_id = ? AND employee_id = ? LIMIT 1', [salonId, employeeId]),
    dbFirst(db, 'SELECT * FROM staff WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, employeeId]),
    dbAll(
      db,
      `SELECT l.*,
              u.id AS account_id,
              u.status AS account_status,
              u.primary_role,
              u.firebase_uid AS account_firebase_uid,
              u.email AS account_email,
              u.display_name AS account_display_name,
              u.deleted_at AS account_deleted_at
         FROM user_employee_links l
         LEFT JOIN app_users u
           ON u.salon_id = l.salon_id
          AND u.id = l.user_id
        WHERE l.salon_id = ? AND l.employee_id = ?
        ORDER BY l.updated_at DESC, l.id DESC`,
      [salonId, employeeId]
    ),
    dbAll(db, 'SELECT * FROM hr_work_schedules WHERE salon_id = ? AND employee_id = ? ORDER BY weekday, effective_from, id', [salonId, employeeId]),
    dbAll(db, 'SELECT * FROM hr_shift_assignments WHERE salon_id = ? AND employee_id = ? ORDER BY effective_from, id', [salonId, employeeId]),
    dbAll(db, 'SELECT * FROM hr_schedule_exceptions WHERE salon_id = ? AND employee_id = ? ORDER BY date_from, id', [salonId, employeeId]),
    dbFirst(db, 'SELECT * FROM employee_offboarding_fences WHERE salon_id = ? AND employee_id = ? LIMIT 1', [salonId, employeeId]),
  ]);
  return { profile, employment, staff, links, schedules, assignments, exceptions, fence };
}

async function loadCandidateAccounts(db, salonId, employeeId, profile, staff, links) {
  const candidates = new Map();
  const evidence = new Map();
  const add = (account, source) => {
    if (!account?.id) return;
    candidates.set(account.id, account);
    const sources = evidence.get(account.id) || new Set();
    sources.add(source);
    evidence.set(account.id, sources);
  };

  for (const link of links) {
    add(accountFromJoinedLink(link), `employee_link:${statusLower(link.link_status) || 'unknown'}`);
  }

  for (const [uid, source] of [
    [cleanText(profile?.firebase_uid), 'employee_profile.firebase_uid'],
    [cleanText(staff?.firebase_uid), 'staff.firebase_uid'],
  ]) {
    if (!uid) continue;
    const account = await dbFirst(
      db,
      'SELECT * FROM app_users WHERE salon_id = ? AND firebase_uid = ? LIMIT 1',
      [salonId, uid]
    );
    add(account, source);
  }

  const plans = [];
  for (const account of candidates.values()) {
    const currentLinks = await dbAll(
      db,
      `SELECT id, employee_id, link_status
         FROM user_employee_links
        WHERE salon_id = ? AND user_id = ? AND link_status IN ('active','pending')
        ORDER BY updated_at DESC, id DESC`,
      [salonId, account.id]
    );
    const otherEmployeeLinks = currentLinks.filter((row) => cleanText(row.employee_id) !== employeeId);
    if (otherEmployeeLinks.length) {
      throw new AppError(
        409,
        'core_hr:offboarding_account_identity_conflict',
        'Linked identity is currently associated with another employee and requires manual review',
        {
          employeeId,
          userId: account.id,
          role: cleanText(account.primary_role) || null,
          otherEmployeeIds: [...new Set(otherEmployeeLinks.map((row) => cleanText(row.employee_id)).filter(Boolean))],
          evidence: [...(evidence.get(account.id) || [])],
        }
      );
    }

    const plan = planEmployeeOffboardingAccountAccess(account);
    if (plan.mode === 'manual_review') {
      throw new AppError(
        409,
        'core_hr:offboarding_privileged_account_requires_manual_review',
        'Linked account has privileged or non-employee access and must be reviewed separately',
        {
          employeeId,
          userId: account.id,
          role: plan.role,
          status: plan.status,
          evidence: [...(evidence.get(account.id) || [])],
        }
      );
    }
    plans.push({
      account,
      ...plan,
      evidence: [...(evidence.get(account.id) || [])],
    });
  }
  return plans;
}

function scheduleNeedsConvergence(row, endDate) {
  const from = cleanText(row.effective_from);
  const to = cleanText(row.effective_to);
  if (from && from > endDate) return Number(row.active) === 1;
  return !to || to > endDate;
}

function assignmentNeedsConvergence(row, endDate) {
  if (statusLower(row.status) !== 'published') return false;
  const from = cleanText(row.effective_from);
  const to = cleanText(row.effective_to);
  if (from && from > endDate) return true;
  return !to || to > endDate;
}

function exceptionNeedsConvergence(row, endDate) {
  if (!['approved', 'active'].includes(statusLower(row.status))) return false;
  const from = cleanText(row.date_from);
  const to = cleanText(row.date_to);
  if (from && from > endDate) return true;
  return Boolean(to && to > endDate);
}

function embeddedInvariantCode(error) {
  const message = cleanText(error?.message);
  return [
    'core_hr:offboarding_post_end_date_activity_conflict',
    'core_hr:offboarding_future_bookings_require_reassignment',
  ].find((code) => message.includes(code)) || '';
}

export async function offboardHrEmployee(
  db,
  salonId,
  employeeIdValue,
  data = {},
  actor = {},
  options = {}
) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const endDate = requiredOffboardingEndDate(data.endDate ?? data.end_date);
  const reason = requiredOffboardingReason(data.reason);
  const businessDate = riyadhBusinessDate(options.now ?? new Date());
  if (endDate > businessDate) {
    throw new AppError(
      409,
      'core_hr:offboarding_future_end_date_not_supported',
      'Immediate offboarding does not support a future end date',
      { employeeId, endDate, businessDate }
    );
  }

  const now = options.now ? new Date(options.now).toISOString() : nowIso();
  const facts = await loadLifecycleFacts(db, salonId, employeeId);
  const { profile, employment, staff, links, schedules, assignments, exceptions, fence } = facts;
  if (!profile || !employment) throw new AppError(404, 'core_hr:employee_not_found');

  const existingEndDate = cleanText(employment.end_date);
  if (existingEndDate && existingEndDate !== endDate) {
    throw new AppError(
      409,
      'core_hr:offboarding_end_date_conflict',
      'Existing employment end date differs from requested end date',
      { employeeId, existingEndDate, requestedEndDate: endDate }
    );
  }
  if (fence && cleanText(fence.end_date) && cleanText(fence.end_date) !== endDate) {
    throw new AppError(
      409,
      'core_hr:offboarding_fence_end_date_conflict',
      'Existing offboarding fence end date differs from requested end date',
      { employeeId, existingFenceEndDate: cleanText(fence.end_date), requestedEndDate: endDate }
    );
  }
  const startDate = cleanText(employment.start_date);
  if (startDate && endDate < startDate) {
    throw new AppError(409, 'core_hr:offboarding_end_date_before_start_date', undefined, {
      employeeId,
      startDate,
      endDate,
    });
  }

  const bookingEvidence = await bookingConflictEvidence(db, salonId, employeeId, endDate, businessDate);
  throwBookingConflict(bookingEvidence, employeeId, endDate, businessDate);

  const accountPlans = await loadCandidateAccounts(db, salonId, employeeId, profile, staff, links);
  const currentTargetLinks = links.filter((row) => CURRENT_LINK_STATUSES.has(statusLower(row.link_status)));

  const profileConverged = statusLower(profile.status) === CLOSED_PROFILE_STATUS;
  const employmentConverged =
    statusLower(employment.employment_status) === CLOSED_EMPLOYMENT_STATUS && existingEndDate === endDate;
  const staffConverged = !staff || (
    Number(staff.active) !== 1 &&
    Number(staff.show_on_booking) !== 1 &&
    statusLower(staff.employment_status) === CLOSED_EMPLOYMENT_STATUS
  );
  const accountsConverged = accountPlans.every((plan) => plan.mode !== 'disable');
  const linksConverged = currentTargetLinks.length === 0;
  const schedulesConverged = !schedules.some((row) => scheduleNeedsConvergence(row, endDate));
  const assignmentsConverged = !assignments.some((row) => assignmentNeedsConvergence(row, endDate));
  const exceptionsConverged = !exceptions.some((row) => exceptionNeedsConvergence(row, endDate));
  const fenceConverged = Boolean(
    fence && statusLower(fence.status) === 'offboarded' && cleanText(fence.end_date) === endDate
  );

  const alreadyConverged =
    profileConverged &&
    employmentConverged &&
    staffConverged &&
    accountsConverged &&
    linksConverged &&
    schedulesConverged &&
    assignmentsConverged &&
    exceptionsConverged &&
    fenceConverged;

  if (alreadyConverged) {
    return {
      employee_id: employeeId,
      end_date: endDate,
      status: CLOSED_EMPLOYMENT_STATUS,
      idempotent: true,
      future_bookings: bookingEvidence.upcomingOperational,
      post_end_date_activity: bookingEvidence.postEndDateActivity,
    };
  }

  const statements = [
    {
      sql: `INSERT INTO employee_offboarding_fences
        (salon_id, employee_id, end_date, business_date, status, actor_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'offboarded', ?, ?, ?)
       ON CONFLICT(salon_id, employee_id) DO UPDATE SET
         end_date = excluded.end_date,
         business_date = excluded.business_date,
         status = 'offboarded',
         actor_user_id = excluded.actor_user_id,
         updated_at = excluded.updated_at`,
      params: [salonId, employeeId, endDate, businessDate, cleanText(actor.userId) || null, now, now],
    },
    {
      sql: `UPDATE employee_profiles
               SET status = 'inactive', updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [now, salonId, employeeId],
    },
    {
      sql: `UPDATE employee_employment
               SET employment_status = 'inactive', end_date = ?,
                   updated_by_uid = ?, updated_by_email = ?, updated_at = ?
             WHERE salon_id = ? AND employee_id = ?`,
      params: [endDate, cleanText(actor.uid) || null, cleanText(actor.email) || null, now, salonId, employeeId],
    },
  ];

  if (staff) {
    statements.push({
      sql: `UPDATE staff
               SET active = 0, show_on_booking = 0,
                   employment_status = 'inactive', updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [now, salonId, employeeId],
    });
  }

  const accountEffects = [];
  for (const plan of accountPlans) {
    accountEffects.push({
      userId: plan.account.id,
      previousStatus: plan.status,
      role: plan.role,
      action: plan.mode,
      firebaseUidPreserved: plan.account.firebase_uid || null,
      evidence: plan.evidence,
    });
    if (plan.mode !== 'disable') continue;
    statements.push(employeeOffboardingAccountDisableStatement(salonId, plan.account.id, now));
    statements.push(auditInsertStatement(salonId, {
      action: 'account_disabled_by_employee_offboarding',
      entityType: 'app_user',
      entityId: plan.account.id,
      targetUserId: plan.account.id,
      description: 'Core account disabled by canonical employee offboarding lifecycle.',
      source: 'core-hr-offboarding',
      before: {
        status: plan.status,
        role: plan.role,
        firebaseUid: plan.account.firebase_uid || null,
      },
      after: {
        status: 'disabled',
        role: plan.role,
        firebaseUid: plan.account.firebase_uid || null,
      },
      meta: { employeeId, reason },
    }, actor).statement);
  }

  const linkEffects = [];
  for (const link of currentTargetLinks) {
    statements.push({
      sql: `UPDATE user_employee_links
               SET link_status = 'unlinked',
                   unlinked_at = COALESCE(unlinked_at, ?),
                   updated_at = ?
             WHERE salon_id = ? AND id = ? AND link_status IN ('active','pending')`,
      params: [now, now, salonId, link.id],
    });
    linkEffects.push({
      linkId: link.id,
      userId: link.user_id,
      previousStatus: link.link_status,
      newStatus: 'unlinked',
    });
  }

  let schedulesEnded = 0;
  let futureSchedulesDisabled = 0;
  for (const row of schedules) {
    const from = cleanText(row.effective_from);
    const to = cleanText(row.effective_to);
    if (from && from > endDate) {
      if (Number(row.active) === 1) {
        statements.push({
          sql: `UPDATE hr_work_schedules
                   SET active = 0, updated_at = ?
                 WHERE salon_id = ? AND id = ? AND active = 1`,
          params: [now, salonId, row.id],
        });
        futureSchedulesDisabled += 1;
      }
      continue;
    }
    if (!to || to > endDate) {
      statements.push({
        sql: `UPDATE hr_work_schedules
                 SET effective_to = ?, updated_at = ?
               WHERE salon_id = ? AND id = ?`,
        params: [endDate, now, salonId, row.id],
      });
      schedulesEnded += 1;
    }
  }

  let assignmentsEnded = 0;
  let futureAssignmentsCancelled = 0;
  for (const row of assignments) {
    if (statusLower(row.status) !== 'published') continue;
    const from = cleanText(row.effective_from);
    const to = cleanText(row.effective_to);
    if (from && from > endDate) {
      statements.push({
        sql: `UPDATE hr_shift_assignments
                 SET status = 'cancelled', reason = ?, updated_at = ?
               WHERE salon_id = ? AND id = ? AND status = 'published'`,
        params: [`${reason} [EMPLOYEE_OFFBOARDED]`, now, salonId, row.id],
      });
      futureAssignmentsCancelled += 1;
      continue;
    }
    if (!to || to > endDate) {
      statements.push({
        sql: `UPDATE hr_shift_assignments
                 SET effective_to = ?, updated_at = ?
               WHERE salon_id = ? AND id = ? AND status = 'published'`,
        params: [endDate, now, salonId, row.id],
      });
      assignmentsEnded += 1;
    }
  }

  let exceptionsEnded = 0;
  let futureExceptionsCancelled = 0;
  for (const row of exceptions) {
    if (!['approved', 'active'].includes(statusLower(row.status))) continue;
    const from = cleanText(row.date_from);
    const to = cleanText(row.date_to);
    if (from && from > endDate) {
      statements.push({
        sql: `UPDATE hr_schedule_exceptions
                 SET status = 'cancelled', enabled = 0, updated_at = ?
               WHERE salon_id = ? AND id = ?`,
        params: [now, salonId, row.id],
      });
      futureExceptionsCancelled += 1;
      continue;
    }
    if (to && to > endDate) {
      statements.push({
        sql: `UPDATE hr_schedule_exceptions
                 SET date_to = ?, updated_at = ?
               WHERE salon_id = ? AND id = ?`,
        params: [endDate, now, salonId, row.id],
      });
      exceptionsEnded += 1;
    }
  }

  const lifecycleAudit = auditInsertStatement(salonId, {
    action: 'employee_offboarded',
    entityType: 'employee',
    entityId: employeeId,
    description: 'Canonical Core employee offboarding completed or converged partial lifecycle drift.',
    source: 'core-hr-offboarding',
    before: {
      profileStatus: profile.status,
      employmentStatus: employment.employment_status,
      endDate: employment.end_date || null,
      staff: staff ? {
        active: staff.active,
        showOnBooking: staff.show_on_booking,
        employmentStatus: staff.employment_status,
      } : null,
      fence: fence ? {
        status: fence.status,
        endDate: fence.end_date,
      } : null,
    },
    after: {
      profileStatus: CLOSED_PROFILE_STATUS,
      employmentStatus: CLOSED_EMPLOYMENT_STATUS,
      endDate,
      staff: staff ? { active: 0, showOnBooking: 0, employmentStatus: CLOSED_EMPLOYMENT_STATUS } : null,
      fence: { status: 'offboarded', endDate },
    },
    meta: {
      reason,
      businessDate,
      futureBookingCheck: bookingEvidence.upcomingOperational,
      postEndDateActivityCheck: bookingEvidence.postEndDateActivity,
      accounts: accountEffects,
      employeeLinks: linkEffects,
      scheduleEffects: {
        schedulesEnded,
        futureSchedulesDisabled,
        assignmentsEnded,
        futureAssignmentsCancelled,
        exceptionsEnded,
        futureExceptionsCancelled,
      },
      partialDriftConverged: true,
      firebaseIdentityDeleted: false,
    },
  }, actor);
  statements.push(lifecycleAudit.statement);

  try {
    await dbBatch(db, statements);
  } catch (error) {
    const invariantCode = embeddedInvariantCode(error);
    if (invariantCode) {
      // The failed D1 batch is rolled back. Re-read only to provide safe UI details;
      // this SELECT is not the success invariant and cannot make a failed batch succeed.
      const racedEvidence = await bookingConflictEvidence(db, salonId, employeeId, endDate, businessDate);
      if (invariantCode === 'core_hr:offboarding_post_end_date_activity_conflict') {
        throwBookingConflict({
          postEndDateActivity: racedEvidence.postEndDateActivity,
          upcomingOperational: { count: 0, bookingIds: [] },
        }, employeeId, endDate, businessDate);
      }
      throwBookingConflict({
        postEndDateActivity: { count: 0, bookingIds: [] },
        upcomingOperational: racedEvidence.upcomingOperational,
      }, employeeId, endDate, businessDate);
    }
    throw error;
  }

  return {
    employee_id: employeeId,
    end_date: endDate,
    status: CLOSED_EMPLOYMENT_STATUS,
    idempotent: false,
    account_effects: accountEffects,
    employee_link_effects: linkEffects,
    schedule_effects: {
      schedules_ended: schedulesEnded,
      future_schedules_disabled: futureSchedulesDisabled,
      assignments_ended: assignmentsEnded,
      future_assignments_cancelled: futureAssignmentsCancelled,
      exceptions_ended: exceptionsEnded,
      future_exceptions_cancelled: futureExceptionsCancelled,
    },
    future_bookings: bookingEvidence.upcomingOperational,
    post_end_date_activity: bookingEvidence.postEndDateActivity,
  };
}

export const __stage11OffboardingTest = {
  riyadhBusinessDate,
};
