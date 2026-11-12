// Core-owned, salon-scoped approval authority, independent of the Owner role.
// Reusable authority keys allow later workflows to nominate their own single
// final approver without granting all owners automatic final-decision rights.
import { cleanText, dbBatch, dbFirst, nowIso } from '../d1.js';
import { AppError } from '../errors.js';
import { auditInsertStatement } from './audit.js';

export const FINAL_LEAVE_APPROVAL_KEY = 'hr.leave.final';

export async function getApprovalAuthority(db, salonId, authorityKey = FINAL_LEAVE_APPROVAL_KEY) {
  return dbFirst(db,
    `SELECT a.salon_id, a.authority_key, a.approver_user_id,
            a.assigned_by_user_id, a.assigned_at, a.updated_at,
            u.display_name AS approver_name, u.email AS approver_email,
            u.status AS approver_status, u.primary_role AS approver_role
       FROM approval_authorities a
       LEFT JOIN app_users u
         ON u.salon_id = a.salon_id AND u.id = a.approver_user_id
      WHERE a.salon_id = ? AND a.authority_key = ? LIMIT 1`,
    [salonId, authorityKey]
  );
}

export async function requireFinalLeaveAuthority(db, salonId, actor = {}, targetEmployeeId = '') {
  const assigned = await getApprovalAuthority(db, salonId);
  if (!assigned || !assigned.approver_user_id) {
    throw new AppError(409, 'core_approval_authority:not_configured',
      'A single final leave approver must be assigned before leave can be finalized.');
  }
  if (assigned.approver_user_id !== cleanText(actor.userId)
    || assigned.approver_status !== 'active'
    || assigned.approver_role !== 'owner') {
    throw new AppError(403, 'core_approval_authority:final_approver_required');
  }
  if (cleanText(targetEmployeeId) && cleanText(actor.employeeId)
    && cleanText(targetEmployeeId) === cleanText(actor.employeeId)) {
    throw new AppError(403, 'core_approval_authority:self_approval_forbidden');
  }
  return assigned;
}

export async function assignApprovalAuthority(db, salonId, authorityKey, targetUserId, actor = {}) {
  if (authorityKey !== FINAL_LEAVE_APPROVAL_KEY) {
    throw new AppError(400, 'core_approval_authority:unknown_authority');
  }
  if (cleanText(actor.role) !== 'owner' || !cleanText(actor.userId)) {
    throw new AppError(403, 'core_approval_authority:owner_required');
  }
  const target = await dbFirst(db,
    `SELECT id, primary_role, status FROM app_users
      WHERE salon_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1`,
    [salonId, cleanText(targetUserId)]
  );
  if (!target || target.primary_role !== 'owner' || target.status !== 'active') {
    throw new AppError(409, 'core_approval_authority:active_owner_required');
  }
  if (cleanText(actor.userId) === target.id) {
    throw new AppError(403, 'core_approval_authority:self_assignment_forbidden');
  }
  const existing = await getApprovalAuthority(db, salonId, authorityKey);
  // Initial assignment must be made by a *different* owner. After this,
  // only the incumbent final approver can delegate to another owner.
  if (existing && existing.approver_user_id !== cleanText(actor.userId)) {
    throw new AppError(403, 'core_approval_authority:delegation_requires_incumbent');
  }
  const now = nowIso();
  const audit = auditInsertStatement(salonId, {
    action: 'approval_authority_assigned',
    entityType: 'approval_authority',
    entityId: authorityKey,
    targetUserId: target.id,
    before: existing ? { approverUserId: existing.approver_user_id } : null,
    after: { approverUserId: target.id, authorityKey },
  }, actor);
  await dbBatch(db, [
    {
      sql: `INSERT INTO approval_authorities
          (salon_id, authority_key, approver_user_id, assigned_by_user_id, assigned_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(salon_id, authority_key) DO UPDATE SET
          approver_user_id = excluded.approver_user_id,
          assigned_by_user_id = excluded.assigned_by_user_id,
          assigned_at = excluded.assigned_at,
          updated_at = excluded.updated_at
        WHERE approval_authorities.approver_user_id = ?`,
      params: [salonId, authorityKey, target.id, cleanText(actor.userId), now, now, cleanText(actor.userId)],
    },
    // If assignment was concurrently changed, rollback this entire batch.
    {
      sql: "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('APPROVAL_AUTHORITY_CONFLICT', '$.value') END AS asserted",
      params: [],
    },
    audit.statement,
  ]);
  return getApprovalAuthority(db, salonId, authorityKey);
}
