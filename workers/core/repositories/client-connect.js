// CORE D1 ONLY — MALIKAT Connect runtime.
// The salon owns the relationship and conversation. Personal contact exchange is blocked before delivery.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';
import { inspectContactExchange } from './contact-exchange-guard.js';

const ACTIVE_CONVERSATION_STATUSES = new Set(['open', 'review', 'restricted']);
const SENDABLE_CONVERSATION_STATUSES = new Set(['open', 'review']);
const SECURITY_REVIEW_STATUSES = new Set([
  'new',
  'under_review',
  'safe',
  'warning_issued',
  'restricted',
  'closed',
]);

function clampLimit(value, fallback = 100, max = 500) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

function actorUid(actor = {}) {
  return cleanText(actor.uid || actor.identity?.uid);
}

function actorEmployeeId(actor = {}) {
  return cleanText(actor.employeeId || actor.employee_id);
}

function allowedActorKind(value) {
  const kind = cleanText(value).toLowerCase();
  if (!['client', 'staff', 'admin'].includes(kind)) {
    throw new AppError(400, 'core_client_connect:invalid_actor_kind');
  }
  return kind;
}

function conversationStatusForSecurityReview(status) {
  const normalized = cleanText(status).toLowerCase();
  if (normalized === 'under_review') return 'review';
  if (normalized === 'restricted') return 'restricted';
  if (normalized === 'closed') return 'closed';
  if (normalized === 'safe' || normalized === 'warning_issued') return 'open';
  return 'review';
}

export { conversationStatusForSecurityReview };

function blockedEvidenceSummary(body, inspection = {}) {
  const length = cleanText(body).length;
  return [
    `type=${cleanText(inspection.detectionType) || 'unknown'}`,
    `severity=${cleanText(inspection.severity) || 'unknown'}`,
    'content_withheld=true',
    `length=${length}`,
  ].join(';');
}

async function getConversation(db, salonId, conversationId) {
  const id = requiredId(conversationId, 'conversationId');
  const row = await dbFirst(
    db,
    'SELECT * FROM client_connect_conversations WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
  if (!row) throw new AppError(404, 'core_client_connect:conversation_not_found');
  return row;
}

function assertConversationAccess(conversation, access = {}) {
  if (access.manageAll === true) return;
  const clientId = cleanText(access.clientId || access.client_id);
  const employeeId = cleanText(access.employeeId || access.employee_id);
  if (clientId && cleanText(conversation.client_id) === clientId) return;
  if (employeeId && cleanText(conversation.assigned_staff_id) === employeeId) return;
  throw new AppError(403, 'core_client_connect:conversation_forbidden');
}

async function assertClientExists(db, salonId, clientId) {
  const id = requiredId(clientId, 'clientId');
  const row = await dbFirst(
    db,
    'SELECT id FROM clients WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
  if (!row) throw new AppError(404, 'core_client:not_found');
  return id;
}

async function requireClientConnectEnabled(db, salonId, clientIdValue) {
  const clientId = requiredId(clientIdValue, 'clientId');
  const preference = await dbFirst(
    db,
    'SELECT * FROM client_preferences WHERE salon_id = ? AND client_id = ? LIMIT 1',
    [salonId, clientId]
  );
  if (preference && Number(preference.connect_enabled) === 0) {
    throw new AppError(403, 'core_client_connect:disabled_for_client');
  }
  return preference || null;
}

async function resolveActiveStaff(db, salonId, staffIdValue) {
  const staffId = cleanText(staffIdValue);
  if (!staffId) return null;
  const row = await dbFirst(
    db,
    "SELECT id, name, firebase_uid, active, employment_status FROM staff WHERE salon_id = ? AND id = ? AND active = 1 LIMIT 1",
    [salonId, requiredId(staffId, 'staffId')]
  );
  const employment = cleanText(row?.employment_status).toLowerCase();
  if (!row || ['inactive', 'archived', 'deleted', 'terminated'].includes(employment)) {
    throw new AppError(409, 'core_client_connect:staff_unavailable');
  }
  return row;
}

async function managementNotificationRecipients(db, salonId, excludeUid = '') {
  const rows = await dbAll(
    db,
    "SELECT firebase_uid FROM app_users WHERE salon_id = ? AND status = 'active' AND deleted_at IS NULL AND primary_role IN ('owner','admin') AND firebase_uid IS NOT NULL AND TRIM(firebase_uid) <> ''",
    [salonId]
  );
  const excluded = cleanText(excludeUid);
  return Array.from(
    new Set(
      rows
        .map((row) => cleanText(row.firebase_uid))
        .filter((uid) => uid && uid !== excluded)
    )
  );
}

function notificationStatement({
  id,
  salonId,
  targetUid = null,
  targetEmployeeId = null,
  title,
  body,
  route,
  createdByUid = null,
  now,
}) {
  return {
    sql: 'INSERT INTO employee_notifications (id, salon_id, target_uid, target_employee_id, type, title, body, route, created_by_uid, read_at, read_by_uid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    params: [
      id,
      salonId,
      targetUid,
      targetEmployeeId,
      'system',
      title,
      body,
      route,
      createdByUid,
      null,
      null,
      now,
      now,
    ],
  };
}

export async function listClientConnectConversations(db, salonId, clientIdValue, query = {}) {
  const clientId = await assertClientExists(db, salonId, clientIdValue);
  const limit = clampLimit(query.limit, 50, 200);
  return dbAll(
    db,
    'SELECT c.*, s.name AS assigned_staff_name FROM client_connect_conversations c LEFT JOIN staff s ON s.salon_id = c.salon_id AND s.id = c.assigned_staff_id WHERE c.salon_id = ? AND c.client_id = ? ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC LIMIT ?',
    [salonId, clientId, limit]
  );
}

export async function openClientConnectConversation(db, salonId, clientIdValue, input = {}) {
  const clientId = await assertClientExists(db, salonId, clientIdValue);
  const preference = await requireClientConnectEnabled(db, salonId, clientId);

  const existing = await dbFirst(
    db,
    "SELECT * FROM client_connect_conversations WHERE salon_id = ? AND client_id = ? AND status IN ('open','review','restricted') ORDER BY updated_at DESC LIMIT 1",
    [salonId, clientId]
  );
  if (existing) return existing;

  const requestedStaffId =
    cleanText(input.staffId || input.staff_id) ||
    cleanText(preference?.preferred_staff_id);
  const staff = requestedStaffId
    ? await resolveActiveStaff(db, salonId, requestedStaffId)
    : null;

  const now = nowIso();
  const id = requiredId(input.id || generatedId('client_connect'), 'conversationId');
  await dbRun(
    db,
    'INSERT INTO client_connect_conversations (id, salon_id, client_id, assigned_staff_id, status, last_message_at, last_message_preview, created_at, updated_at, closed_at, closed_by_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, salonId, clientId, staff?.id || null, 'open', null, null, now, now, null, null]
  );
  return getConversation(db, salonId, id);
}

export async function listStaffConnectConversations(db, salonId, actor = {}, query = {}, options = {}) {
  const manageAll = options.manageAll === true;
  const employeeId = actorEmployeeId(actor);
  if (!manageAll && !employeeId) {
    throw new AppError(403, 'core_client_connect:employee_link_required');
  }
  const limit = clampLimit(query.limit, 100, 500);
  const status = cleanText(query.status).toLowerCase();
  if (status && !['open', 'review', 'restricted', 'closed'].includes(status)) {
    throw new AppError(400, 'core_client_connect:invalid_status');
  }

  const where = ['c.salon_id = ?'];
  const params = [salonId];
  if (!manageAll) {
    where.push('c.assigned_staff_id = ?');
    params.push(employeeId);
  }
  if (status) {
    where.push('c.status = ?');
    params.push(status);
  }
  params.push(limit);

  return dbAll(
    db,
    'SELECT c.*, cl.name AS client_name, s.name AS assigned_staff_name FROM client_connect_conversations c JOIN clients cl ON cl.salon_id = c.salon_id AND cl.id = c.client_id LEFT JOIN staff s ON s.salon_id = c.salon_id AND s.id = c.assigned_staff_id WHERE ' + where.join(' AND ') + ' ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC LIMIT ?',
    params
  );
}

export async function listConnectMessages(db, salonId, conversationId, access = {}, query = {}) {
  const conversation = await getConversation(db, salonId, conversationId);
  assertConversationAccess(conversation, access);
  const limit = clampLimit(query.limit, 200, 500);
  return dbAll(
    db,
    "SELECT id, salon_id, conversation_id, sender_kind, sender_uid, sender_client_id, sender_staff_id, body, delivery_status, created_at FROM client_connect_messages WHERE salon_id = ? AND conversation_id = ? AND delivery_status = 'sent' ORDER BY created_at ASC, id ASC LIMIT ?",
    [salonId, conversation.id, limit]
  );
}

export async function sendConnectMessage(db, salonId, conversationId, input = {}, actor = {}, access = {}) {
  const conversation = await getConversation(db, salonId, conversationId);
  assertConversationAccess(conversation, access);
  await requireClientConnectEnabled(db, salonId, conversation.client_id);

  const status = cleanText(conversation.status).toLowerCase();
  if (!SENDABLE_CONVERSATION_STATUSES.has(status)) {
    throw new AppError(409, status === 'restricted'
      ? 'core_client_connect:conversation_restricted'
      : 'core_client_connect:conversation_closed');
  }

  const body = requiredText(input.body, 'body', 4000);
  const senderKind = allowedActorKind(input.senderKind || input.sender_kind || access.actorKind);
  const uid = actorUid(actor);
  if (!uid) throw new AppError(401, 'core_auth:login_required');

  const recentRows = await dbAll(
    db,
    'SELECT body FROM client_connect_messages WHERE salon_id = ? AND conversation_id = ? AND sender_uid = ? ORDER BY created_at DESC, id DESC LIMIT 12',
    [salonId, conversation.id, uid]
  );
  const inspection = inspectContactExchange({
    body,
    recentBodies: recentRows.map((row) => row.body).reverse(),
    allowedDomains: ['malikat.com', 'queens-salon-web.vercel.app'],
  });

  const now = nowIso();
  const messageId = requiredId(input.id || generatedId('client_message'), 'messageId');
  const senderClientId = senderKind === 'client'
    ? cleanText(access.clientId || access.client_id) || cleanText(conversation.client_id)
    : null;
  const senderStaffId = senderKind === 'staff'
    ? cleanText(access.employeeId || access.employee_id) || actorEmployeeId(actor)
    : null;

  if (inspection.blocked) {
    const securityEventId = generatedId('client_connect_security');
    const windowStart = new Date(
      Date.parse(now) - 10 * 60 * 1000
    ).toISOString();
    const recentBlocked = await dbFirst(
      db,
      `SELECT COUNT(*) AS count
         FROM client_connect_security_events
        WHERE salon_id = ?
          AND conversation_id = ?
          AND actor_uid = ?
          AND detected_at >= ?`,
      [salonId, conversation.id, uid, windowStart]
    );
    const priorBlockedCount = Number(recentBlocked?.count || 0);
    const repeatedBlock = priorBlockedCount >= 2;
    const nextStatus =
      inspection.severity === 'critical' || repeatedBlock
        ? 'restricted'
        : 'review';
    const blockedBody = 'تم حجب محتوى الرسالة أمنيًا.';
    const evidenceSummary = blockedEvidenceSummary(body, inspection);
    const statements = [
      {
        sql: 'INSERT INTO client_connect_messages (id, salon_id, conversation_id, sender_kind, sender_uid, sender_client_id, sender_staff_id, body, delivery_status, blocked_reason, security_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [
          messageId,
          salonId,
          conversation.id,
          senderKind,
          uid,
          senderClientId,
          senderStaffId,
          blockedBody,
          'blocked',
          inspection.detectionType,
          securityEventId,
          now,
        ],
      },
      {
        sql: 'INSERT INTO client_connect_security_events (id, salon_id, conversation_id, message_id, actor_kind, actor_uid, detection_type, severity, review_status, evidence_text, detected_at, reviewed_at, reviewed_by_uid, resolution_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params: [
          securityEventId,
          salonId,
          conversation.id,
          messageId,
          senderKind,
          uid,
          inspection.detectionType,
          inspection.severity,
          'new',
          evidenceSummary,
          now,
          null,
          null,
          null,
        ],
      },
      {
        sql: 'UPDATE client_connect_conversations SET status = ?, last_message_at = ?, last_message_preview = ?, updated_at = ? WHERE salon_id = ? AND id = ?',
        params: [nextStatus, now, 'رسالة محجوبة أمنيًا', now, salonId, conversation.id],
      },
    ];

    if (priorBlockedCount === 0 || nextStatus === 'restricted') {
      const recipients = await managementNotificationRecipients(
        db,
        salonId,
        uid
      );
      for (const targetUid of recipients) {
        statements.push(notificationStatement({
          id: generatedId('notification'),
          salonId,
          targetUid,
          title:
            nextStatus === 'restricted'
              ? 'تم تقييد محادثة أمنيًا'
              : 'تنبيه أمني في محادثات العملاء',
          body:
            nextStatus === 'restricted'
              ? 'تكررت محاولات مشاركة بيانات تواصل خارج منصة ملكات وتم تقييد المحادثة للمراجعة.'
              : 'تم منع محاولة تبادل بيانات تواصل خارج منصة ملكات.',
          route: '/dashboard/messages',
          createdByUid: uid,
          now,
        }));
      }
    }

    await dbBatch(db, statements);
    return {
      blocked: true,
      delivered: false,
      messageId,
      securityEventId,
      detectionType: inspection.detectionType,
      severity: inspection.severity,
      conversationStatus: nextStatus,
      cooldownApplied: repeatedBlock,
      userMessage:
        nextStatus === 'restricted'
          ? 'تم إيقاف الإرسال مؤقتًا بعد تكرار محاولات مشاركة بيانات تواصل خارج منصة ملكات حتى تنتهي مراجعة الإدارة.'
          : 'لم يتم إرسال الرسالة لأنها تحتوي على بيانات تواصل خارج منصة ملكات.',
    };
  }

  const statements = [
    {
      sql: 'INSERT INTO client_connect_messages (id, salon_id, conversation_id, sender_kind, sender_uid, sender_client_id, sender_staff_id, body, delivery_status, blocked_reason, security_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      params: [
        messageId,
        salonId,
        conversation.id,
        senderKind,
        uid,
        senderClientId,
        senderStaffId,
        body,
        'sent',
        null,
        null,
        now,
      ],
    },
    {
      sql: 'UPDATE client_connect_conversations SET last_message_at = ?, last_message_preview = ?, updated_at = ? WHERE salon_id = ? AND id = ?',
      params: [now, body.slice(0, 140), now, salonId, conversation.id],
    },
  ];

  if (senderKind === 'client' && cleanText(conversation.assigned_staff_id)) {
    statements.push(notificationStatement({
      id: generatedId('notification'),
      salonId,
      targetEmployeeId: cleanText(conversation.assigned_staff_id),
      title: 'رسالة جديدة من عميلة',
      body: body.slice(0, 140),
      route: '/employee/messages',
      createdByUid: uid,
      now,
    }));
  }

  await dbBatch(db, statements);
  return {
    id: messageId,
    salon_id: salonId,
    conversation_id: conversation.id,
    sender_kind: senderKind,
    sender_uid: uid,
    sender_client_id: senderClientId,
    sender_staff_id: senderStaffId,
    body,
    delivery_status: 'sent',
    blocked_reason: null,
    security_event_id: null,
    created_at: now,
    blocked: false,
    delivered: true,
  };
}

export async function assignConnectConversation(db, salonId, conversationId, staffIdValue, actor = {}) {
  const conversation = await getConversation(db, salonId, conversationId);
  const staff = await resolveActiveStaff(db, salonId, staffIdValue);
  const now = nowIso();
  await dbRun(
    db,
    'UPDATE client_connect_conversations SET assigned_staff_id = ?, updated_at = ? WHERE salon_id = ? AND id = ?',
    [staff.id, now, salonId, conversation.id]
  );
  await dbRun(
    db,
    'UPDATE client_preferences SET preferred_staff_id = COALESCE(preferred_staff_id, ?), preferred_staff_source = COALESCE(preferred_staff_source, ?), updated_by_uid = ?, updated_at = ? WHERE salon_id = ? AND client_id = ?',
    [staff.id, 'admin', actorUid(actor) || null, now, salonId, conversation.client_id]
  );
  return getConversation(db, salonId, conversation.id);
}

export async function listConnectSecurityEvents(db, salonId, query = {}) {
  const limit = clampLimit(query.limit, 100, 500);
  const reviewStatus = cleanText(query.reviewStatus || query.review_status).toLowerCase();
  if (reviewStatus && !SECURITY_REVIEW_STATUSES.has(reviewStatus)) {
    throw new AppError(400, 'core_client_connect:invalid_review_status');
  }
  const where = ['e.salon_id = ?'];
  const params = [salonId];
  if (reviewStatus) {
    where.push('e.review_status = ?');
    params.push(reviewStatus);
  }
  params.push(limit);
  return dbAll(
    db,
    'SELECT e.*, c.client_id, c.assigned_staff_id, c.status AS conversation_status, cl.name AS client_name, s.name AS assigned_staff_name FROM client_connect_security_events e JOIN client_connect_conversations c ON c.salon_id = e.salon_id AND c.id = e.conversation_id JOIN clients cl ON cl.salon_id = c.salon_id AND cl.id = c.client_id LEFT JOIN staff s ON s.salon_id = c.salon_id AND s.id = c.assigned_staff_id WHERE ' + where.join(' AND ') + ' ORDER BY e.detected_at DESC, e.id DESC LIMIT ?',
    params
  );
}

export async function getConnectSecurityEventContext(db, salonId, eventIdValue) {
  const eventId = requiredId(eventIdValue, 'securityEventId');
  const event = await dbFirst(
    db,
    'SELECT e.*, c.client_id, c.assigned_staff_id, c.status AS conversation_status, cl.name AS client_name, s.name AS assigned_staff_name FROM client_connect_security_events e JOIN client_connect_conversations c ON c.salon_id = e.salon_id AND c.id = e.conversation_id JOIN clients cl ON cl.salon_id = c.salon_id AND cl.id = c.client_id LEFT JOIN staff s ON s.salon_id = c.salon_id AND s.id = c.assigned_staff_id WHERE e.salon_id = ? AND e.id = ? LIMIT 1',
    [salonId, eventId]
  );
  if (!event) throw new AppError(404, 'core_client_connect:security_event_not_found');

  const messages = await dbAll(
    db,
    'SELECT * FROM client_connect_messages WHERE salon_id = ? AND conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT 500',
    [salonId, event.conversation_id]
  );
  return { event, messages };
}

export async function reviewConnectSecurityEvent(db, salonId, eventIdValue, input = {}, actor = {}) {
  const eventId = requiredId(eventIdValue, 'securityEventId');
  const reviewStatus = cleanText(input.reviewStatus || input.review_status).toLowerCase();
  if (!SECURITY_REVIEW_STATUSES.has(reviewStatus) || reviewStatus === 'new') {
    throw new AppError(400, 'core_client_connect:invalid_review_status');
  }

  const current = await dbFirst(
    db,
    'SELECT * FROM client_connect_security_events WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, eventId]
  );
  if (!current) throw new AppError(404, 'core_client_connect:security_event_not_found');

  const now = nowIso();
  const resolutionNotes = optionalText(input.resolutionNotes || input.resolution_notes) || null;
  const conversationStatus = conversationStatusForSecurityReview(reviewStatus);

  await dbBatch(db, [
    {
      sql: 'UPDATE client_connect_security_events SET review_status = ?, reviewed_at = ?, reviewed_by_uid = ?, resolution_notes = ? WHERE salon_id = ? AND id = ?',
      params: [reviewStatus, now, actorUid(actor) || null, resolutionNotes, salonId, eventId],
    },
    {
      sql: 'UPDATE client_connect_conversations SET status = ?, updated_at = ?, closed_at = ?, closed_by_uid = ? WHERE salon_id = ? AND id = ?',
      params: [
        conversationStatus,
        now,
        conversationStatus === 'closed' ? now : null,
        conversationStatus === 'closed' ? actorUid(actor) || null : null,
        salonId,
        current.conversation_id,
      ],
    },
  ]);

  return getConnectSecurityEventContext(db, salonId, eventId);
}

export function isActiveConnectConversationStatus(value) {
  return ACTIVE_CONVERSATION_STATUSES.has(cleanText(value).toLowerCase());
}
