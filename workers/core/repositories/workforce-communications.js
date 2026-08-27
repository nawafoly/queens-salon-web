// CORE D1 ONLY — internal communications, notifications and recruitment.
// Firebase is authentication only and must never be used as an operational fallback.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  dbBatch,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';

const MESSAGE_KINDS = new Set(['hr_to_employee', 'employee_to_employee', 'system']);
const NOTIFICATION_TYPES = new Set(['leave', 'file', 'message', 'system', 'payroll', 'employee_request']);
const RECRUITMENT_STATUSES = new Set(['new', 'reviewing', 'interview', 'accepted', 'rejected', 'hired']);

function clampLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

function normalizedMessageKind(value) {
  const kind = cleanText(value).toLowerCase() || 'employee_to_employee';
  if (!MESSAGE_KINDS.has(kind)) throw new AppError(400, 'core_messages:invalid_kind');
  return kind;
}

function normalizedNotificationType(value) {
  const type = cleanText(value).toLowerCase() || 'system';
  if (!NOTIFICATION_TYPES.has(type)) throw new AppError(400, 'core_notifications:invalid_type');
  return type;
}

function normalizedRecruitmentStatus(value, fallback = 'new') {
  const status = cleanText(value).toLowerCase() || fallback;
  if (!RECRUITMENT_STATUSES.has(status)) throw new AppError(400, 'core_recruitment:invalid_status');
  return status;
}

async function resolveEmployeeIdForUid(db, salonId, firebaseUid) {
  const uid = cleanText(firebaseUid);
  if (!uid) return null;
  const row = await dbFirst(db, `SELECT l.employee_id
    FROM app_users u
    LEFT JOIN user_employee_links l
      ON l.salon_id = u.salon_id
     AND l.user_id = u.id
     AND l.link_status = 'active'
    WHERE u.salon_id = ? AND u.firebase_uid = ? AND u.status = 'active'
    LIMIT 1`, [salonId, uid]);
  return optionalText(row?.employee_id) || null;
}

async function assertActiveRecipient(db, salonId, uidValue) {
  const uid = requiredText(uidValue, 'recipientUid', 256);
  const row = await dbFirst(db, `SELECT u.id, u.firebase_uid, u.display_name, l.employee_id
    FROM app_users u
    LEFT JOIN user_employee_links l
      ON l.salon_id = u.salon_id
     AND l.user_id = u.id
     AND l.link_status = 'active'
    WHERE u.salon_id = ? AND u.firebase_uid = ? AND u.status = 'active'
    LIMIT 1`, [salonId, uid]);
  if (!row) throw new AppError(404, 'core_messages:recipient_not_found');
  return row;
}

function mapMessageRow(row) {
  const readBy = cleanText(row?.read_by_csv)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    ...row,
    read_by: Array.from(new Set(readBy)),
  };
}

export async function listEmployeeMessages(db, salonId, query = {}, actor = {}, options = {}) {
  const limit = clampLimit(query.limit || query.limitCount, 500, 1000);
  const actorUid = cleanText(actor.uid);
  const manageAll = options.manageAll === true;
  if (!manageAll && !actorUid) throw new AppError(403, 'core_messages:identity_required');

  const rows = await dbAll(db, `SELECT m.*, COALESCE(GROUP_CONCAT(r.reader_uid), '') AS read_by_csv
    FROM employee_messages m
    LEFT JOIN employee_message_reads r
      ON r.salon_id = m.salon_id AND r.message_id = m.id
    WHERE m.salon_id = ?
      ${manageAll ? '' : 'AND (m.sender_uid = ? OR m.recipient_uid = ?)'}
    GROUP BY m.id
    ORDER BY m.created_at DESC
    LIMIT ?`, manageAll ? [salonId, limit] : [salonId, actorUid, actorUid, limit]);
  return rows.map(mapMessageRow);
}

export async function createEmployeeMessage(db, salonId, data = {}, actor = {}, options = {}) {
  const senderUid = requiredText(actor.uid, 'senderUid', 256);
  const recipientUid = requiredText(data.recipientUid || data.recipient_uid, 'recipientUid', 256);
  if (senderUid === recipientUid) throw new AppError(400, 'core_messages:self_recipient');

  const recipient = await assertActiveRecipient(db, salonId, recipientUid);
  const now = nowIso();
  const id = requiredId(data.id || generatedId('message'));
  const conversationId = requiredText([senderUid, recipientUid].sort().join('__'), 'conversationId', 600);
  const body = requiredText(data.body, 'body', 8000);
  const kind = options.managementSender === true
    ? normalizedMessageKind(data.kind || 'hr_to_employee')
    : 'employee_to_employee';
  const senderEmployeeId = optionalText(actor.employeeId) || await resolveEmployeeIdForUid(db, salonId, senderUid);
  const recipientEmployeeId = optionalText(recipient.employee_id) || null;
  const row = {
    id,
    salon_id: salonId,
    conversation_id: conversationId,
    thread_id: conversationId,
    sender_uid: senderUid,
    sender_name: optionalText(actor.name || data.senderName || data.sender_name) || null,
    sender_employee_id: senderEmployeeId || null,
    recipient_uid: recipientUid,
    recipient_name: optionalText(recipient.display_name) || null,
    recipient_employee_id: recipientEmployeeId,
    body,
    kind,
    created_at: now,
    updated_at: now,
  };
  const statements = [
    {
      sql: `INSERT INTO employee_messages
        (id, salon_id, conversation_id, thread_id, sender_uid, sender_name, sender_employee_id,
         recipient_uid, recipient_name, recipient_employee_id, body, kind, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: Object.values(row),
    },
    {
      sql: `INSERT OR IGNORE INTO employee_message_reads
        (salon_id, message_id, reader_uid, read_at) VALUES (?, ?, ?, ?)`,
      params: [salonId, id, senderUid, now],
    },
  ];

  if (options.createNotification !== false) {
    const notification = buildEmployeeNotificationRow(salonId, {
      targetUid: recipientUid,
      targetEmployeeId: recipientEmployeeId,
      type: 'message',
      title: options.managementSender ? 'رسالة جديدة من الموارد البشرية' : 'رسالة داخلية جديدة',
      body: body.slice(0, 140),
      route: '/employee/messages',
    }, actor, now);
    statements.push({
      sql: `INSERT INTO employee_notifications
        (id, salon_id, target_uid, target_employee_id, type, title, body, route,
         created_by_uid, read_at, read_by_uid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: Object.values(notification),
    });
  }

  await dbBatch(db, statements);
  return mapMessageRow({ ...row, read_by_csv: senderUid });
}

export async function markEmployeeThreadRead(db, salonId, conversationIdValue, actor = {}) {
  const conversationId = requiredText(conversationIdValue, 'conversationId', 600);
  const readerUid = requiredText(actor.uid, 'readerUid', 256);
  const now = nowIso();
  await dbRun(db, `INSERT OR IGNORE INTO employee_message_reads
    (salon_id, message_id, reader_uid, read_at)
    SELECT salon_id, id, ?, ?
      FROM employee_messages
     WHERE salon_id = ?
       AND conversation_id = ?
       AND recipient_uid = ?`, [readerUid, now, salonId, conversationId, readerUid]);
  return { conversationId, readerUid, readAt: now };
}

function notificationBelongsToActor(row, actor = {}) {
  const actorUid = cleanText(actor.uid);
  const employeeId = cleanText(actor.employeeId);
  return Boolean(
    (actorUid && cleanText(row?.target_uid) === actorUid) ||
    (employeeId && cleanText(row?.target_employee_id) === employeeId)
  );
}

export async function listEmployeeNotifications(db, salonId, query = {}, actor = {}) {
  const actorUid = cleanText(actor.uid);
  const employeeId = cleanText(actor.employeeId);
  if (!actorUid && !employeeId) throw new AppError(403, 'core_notifications:identity_required');
  const limit = clampLimit(query.limit || query.limitCount, 100, 500);
  const rows = await dbAll(db, `SELECT * FROM employee_notifications
    WHERE salon_id = ?
      AND ((? <> '' AND target_uid = ?) OR (? <> '' AND target_employee_id = ?))
    ORDER BY created_at DESC
    LIMIT ?`, [salonId, actorUid, actorUid, employeeId, employeeId, limit]);
  return rows;
}

function buildEmployeeNotificationRow(salonId, data = {}, actor = {}, now = nowIso()) {
  const targetUid = optionalText(data.targetUid || data.target_uid) || null;
  const targetEmployeeId = optionalText(data.targetEmployeeId || data.target_employee_id) || null;
  if (!targetUid && !targetEmployeeId) throw new AppError(400, 'core_notifications:target_required');
  return {
    id: requiredId(data.id || generatedId('notification')),
    salon_id: salonId,
    target_uid: targetUid,
    target_employee_id: targetEmployeeId,
    type: normalizedNotificationType(data.type),
    title: requiredText(data.title, 'title', 500),
    body: optionalText(data.body) || null,
    route: optionalText(data.route) || null,
    created_by_uid: optionalText(actor.uid) || null,
    read_at: null,
    read_by_uid: null,
    created_at: now,
    updated_at: now,
  };
}

export async function createEmployeeNotification(db, salonId, data = {}, actor = {}) {
  const row = buildEmployeeNotificationRow(salonId, data, actor);
  await dbRun(db, `INSERT INTO employee_notifications
    (id, salon_id, target_uid, target_employee_id, type, title, body, route,
     created_by_uid, read_at, read_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
  return row;
}

export async function markEmployeeNotificationRead(db, salonId, idValue, actor = {}) {
  const id = requiredId(idValue);
  const row = await dbFirst(db, 'SELECT * FROM employee_notifications WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!row) throw new AppError(404, 'core_notifications:not_found');
  if (!notificationBelongsToActor(row, actor)) throw new AppError(403, 'core_notifications:not_owned');
  if (row.read_at) return row;
  const now = nowIso();
  await dbRun(db, `UPDATE employee_notifications
    SET read_at = ?, read_by_uid = ?, updated_at = ?
    WHERE salon_id = ? AND id = ?`, [now, cleanText(actor.uid) || null, now, salonId, id]);
  return dbFirst(db, 'SELECT * FROM employee_notifications WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
}

export async function markAllEmployeeNotificationsRead(db, salonId, actor = {}) {
  const actorUid = cleanText(actor.uid);
  const employeeId = cleanText(actor.employeeId);
  if (!actorUid && !employeeId) throw new AppError(403, 'core_notifications:identity_required');
  const now = nowIso();
  await dbRun(db, `UPDATE employee_notifications
    SET read_at = COALESCE(read_at, ?), read_by_uid = COALESCE(read_by_uid, ?), updated_at = ?
    WHERE salon_id = ?
      AND read_at IS NULL
      AND ((? <> '' AND target_uid = ?) OR (? <> '' AND target_employee_id = ?))`,
    [now, actorUid || null, now, salonId, actorUid, actorUid, employeeId, employeeId]);
  return { readAt: now };
}

export async function listRecruitmentApplications(db, salonId, query = {}) {
  const limit = clampLimit(query.limit || query.limitCount, 240, 1000);
  const status = cleanText(query.status).toLowerCase();
  if (status) normalizedRecruitmentStatus(status);
  return dbAll(db, `SELECT * FROM recruitment_applications
    WHERE salon_id = ? ${status ? 'AND status = ?' : ''}
    ORDER BY created_at DESC
    LIMIT ?`, status ? [salonId, status, limit] : [salonId, limit]);
}

export async function createRecruitmentApplication(db, salonId, data = {}, actor = {}) {
  const now = nowIso();
  const email = requiredText(data.email, 'email', 500).toLowerCase();
  if (!email.includes('@')) throw new AppError(400, 'core_recruitment:invalid_email');
  const row = {
    id: requiredId(data.id || generatedId('recruitment')),
    salon_id: salonId,
    full_name: requiredText(data.fullName || data.full_name || data.name, 'fullName', 500),
    email,
    phone: optionalText(data.phone) || null,
    role_applied: optionalText(data.roleApplied || data.role_applied || data.role) || null,
    status: 'new',
    notes: optionalText(data.notes) || null,
    message: optionalText(data.message) || null,
    source: optionalText(data.source || 'manual') || null,
    reviewed_at: null,
    reviewed_by_uid: null,
    hired_at: null,
    hired_by_uid: null,
    hired_uid: null,
    hired_employee_id: null,
    created_by_uid: optionalText(actor.uid) || null,
    created_at: now,
    updated_at: now,
  };
  await dbRun(db, `INSERT INTO recruitment_applications
    (id, salon_id, full_name, email, phone, role_applied, status, notes, message, source,
     reviewed_at, reviewed_by_uid, hired_at, hired_by_uid, hired_uid, hired_employee_id,
     created_by_uid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, Object.values(row));
  return row;
}

export async function patchRecruitmentApplication(db, salonId, idValue, data = {}, actor = {}) {
  const id = requiredId(idValue);
  const existing = await dbFirst(db, 'SELECT * FROM recruitment_applications WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!existing) throw new AppError(404, 'core_recruitment:not_found');

  const status = data.status === undefined ? existing.status : normalizedRecruitmentStatus(data.status, existing.status);
  const now = nowIso();
  const statusChanged = status !== existing.status;
  const reviewedAt = statusChanged ? now : existing.reviewed_at;
  const reviewedByUid = statusChanged ? optionalText(actor.uid) || existing.reviewed_by_uid : existing.reviewed_by_uid;
  const movedToHired = status === 'hired' && existing.status !== 'hired';
  const hiredAt = movedToHired ? now : existing.hired_at;
  const hiredByUid = movedToHired ? optionalText(actor.uid) || existing.hired_by_uid : existing.hired_by_uid;

  const next = {
    full_name: data.fullName === undefined && data.full_name === undefined ? existing.full_name : requiredText(data.fullName || data.full_name, 'fullName', 500),
    email: data.email === undefined ? existing.email : requiredText(data.email, 'email', 500).toLowerCase(),
    phone: data.phone === undefined ? existing.phone : optionalText(data.phone) || null,
    role_applied: data.roleApplied === undefined && data.role_applied === undefined ? existing.role_applied : optionalText(data.roleApplied || data.role_applied) || null,
    status,
    notes: data.notes === undefined ? existing.notes : optionalText(data.notes) || null,
    message: data.message === undefined ? existing.message : optionalText(data.message) || null,
    source: data.source === undefined ? existing.source : optionalText(data.source) || null,
    reviewed_at: reviewedAt,
    reviewed_by_uid: reviewedByUid,
    hired_at: hiredAt,
    hired_by_uid: hiredByUid,
    hired_uid: data.hiredUid === undefined && data.hired_uid === undefined ? existing.hired_uid : optionalText(data.hiredUid || data.hired_uid) || null,
    hired_employee_id: data.hiredEmployeeId === undefined && data.hired_employee_id === undefined ? existing.hired_employee_id : optionalText(data.hiredEmployeeId || data.hired_employee_id) || null,
  };
  if (next.email && !next.email.includes('@')) throw new AppError(400, 'core_recruitment:invalid_email');

  await dbRun(db, `UPDATE recruitment_applications SET
    full_name = ?, email = ?, phone = ?, role_applied = ?, status = ?, notes = ?, message = ?, source = ?,
    reviewed_at = ?, reviewed_by_uid = ?, hired_at = ?, hired_by_uid = ?, hired_uid = ?, hired_employee_id = ?, updated_at = ?
    WHERE salon_id = ? AND id = ?`, [
      next.full_name, next.email, next.phone, next.role_applied, next.status, next.notes, next.message, next.source,
      next.reviewed_at, next.reviewed_by_uid, next.hired_at, next.hired_by_uid, next.hired_uid, next.hired_employee_id,
      now, salonId, id,
    ]);
  return dbFirst(db, 'SELECT * FROM recruitment_applications WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
}
