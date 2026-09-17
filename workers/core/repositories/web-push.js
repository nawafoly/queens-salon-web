// CORE D1 ONLY — employee Web Push subscriptions and outbox delivery.

import { rawPayload, sendPushNotification } from '@mmmike/web-push/send';

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredText,
} from '../d1.js';
import { AppError } from '../errors.js';

const PUSH_ROUTE_FALLBACK = '/employee/notifications';

function requireHttpsEndpoint(value) {
  const endpoint = requiredText(value, 'endpoint', 4096);
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new AppError(400, 'core_push:invalid_endpoint');
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError(400, 'core_push:https_required');
  }
  return endpoint;
}

function pushConfig(env) {
  const publicKey = cleanText(env.VAPID_PUBLIC_KEY);
  const privateKey = cleanText(env.VAPID_PRIVATE_KEY);
  const subject = cleanText(env.VAPID_SUBJECT || 'https://queens-salon-web.vercel.app');
  return {
    enabled: Boolean(publicKey && privateKey && subject),
    publicKey,
    privateKey,
    subject,
  };
}

export function getEmployeePushPublicConfig(env) {
  const config = pushConfig(env);
  return {
    enabled: config.enabled,
    publicKey: config.enabled ? config.publicKey : '',
  };
}

export async function upsertEmployeePushSubscription(db, salonId, data = {}, actor = {}) {
  const targetUid = requiredText(actor.uid, 'targetUid', 256);
  const endpoint = requireHttpsEndpoint(data.endpoint);
  const p256dh = requiredText(data?.keys?.p256dh || data.p256dh, 'p256dh', 1024);
  const auth = requiredText(data?.keys?.auth || data.auth, 'auth', 512);
  const now = nowIso();
  const existing = await dbFirst(
    db,
    'SELECT id FROM web_push_subscriptions WHERE salon_id = ? AND endpoint = ? LIMIT 1',
    [salonId, endpoint],
  );
  const id = cleanText(existing?.id) || generatedId('push_subscription');

  await dbRun(
    db,
    `INSERT INTO web_push_subscriptions
      (id, salon_id, target_uid, target_employee_id, endpoint, p256dh, auth,
       user_agent, platform, active, last_success_at, last_error_at, last_error_code,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NULL, ?, ?)
     ON CONFLICT(salon_id, endpoint) DO UPDATE SET
       target_uid = excluded.target_uid,
       target_employee_id = excluded.target_employee_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       platform = excluded.platform,
       active = 1,
       last_error_at = NULL,
       last_error_code = NULL,
       updated_at = excluded.updated_at`,
    [
      id,
      salonId,
      targetUid,
      optionalText(actor.employeeId) || null,
      endpoint,
      p256dh,
      auth,
      optionalText(data.userAgent || data.user_agent) || null,
      optionalText(data.platform) || null,
      now,
      now,
    ],
  );

  return { id, active: true };
}

export async function removeEmployeePushSubscription(db, salonId, data = {}, actor = {}) {
  const targetUid = requiredText(actor.uid, 'targetUid', 256);
  const endpoint = requireHttpsEndpoint(data.endpoint);
  await dbRun(
    db,
    `UPDATE web_push_subscriptions
        SET active = 0, updated_at = ?
      WHERE salon_id = ? AND target_uid = ? AND endpoint = ?`,
    [nowIso(), salonId, targetUid, endpoint],
  );
  return { removed: true };
}

async function unreadCountForUid(db, salonId, uid) {
  const row = await dbFirst(
    db,
    `SELECT
      (
        SELECT COUNT(*)
          FROM employee_notifications n
         WHERE n.salon_id = ?
           AND n.read_at IS NULL
           AND (
             n.target_uid = ?
             OR n.target_employee_id IN (
               SELECT l.employee_id
                 FROM app_users u
                 JOIN user_employee_links l
                   ON l.salon_id = u.salon_id
                  AND l.user_id = u.id
                  AND l.link_status = 'active'
                WHERE u.salon_id = ?
                  AND u.firebase_uid = ?
                  AND u.status = 'active'
             )
           )
      )
      +
      (
        SELECT COUNT(*)
          FROM notification_records r
         WHERE r.salon_id = ?
           AND r.target_uid = ?
           AND r.notification_type = 'employee_request'
           AND r.is_read = 0
      ) AS unread_count`,
    [salonId, uid, salonId, uid, salonId, uid],
  );
  return Math.max(0, Number(row?.unread_count || 0));
}

async function activeSubscriptionsForUid(db, salonId, uid) {
  return dbAll(
    db,
    `SELECT id, endpoint, p256dh, auth
       FROM web_push_subscriptions
      WHERE salon_id = ? AND target_uid = ? AND active = 1
      ORDER BY updated_at DESC
      LIMIT 12`,
    [salonId, uid],
  );
}

async function markSubscriptionSuccess(db, salonId, id, now) {
  await dbRun(
    db,
    `UPDATE web_push_subscriptions
        SET last_success_at = ?, last_error_at = NULL, last_error_code = NULL, updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [now, now, salonId, id],
  );
}

async function markSubscriptionGone(db, salonId, id, now) {
  await dbRun(
    db,
    `UPDATE web_push_subscriptions
        SET active = 0, last_error_at = ?, last_error_code = 'gone', updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [now, now, salonId, id],
  );
}

async function markSubscriptionError(db, salonId, id, now, error) {
  const statusCode = Number(error?.statusCode || 0);
  const code = statusCode ? `push_http_${statusCode}` : cleanText(error?.name || 'push_error').slice(0, 100);
  await dbRun(
    db,
    `UPDATE web_push_subscriptions
        SET last_error_at = ?, last_error_code = ?, updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [now, code || 'push_error', now, salonId, id],
  );
}

function retryAt(attempts) {
  const seconds = Math.min(3600, Math.max(30, 30 * (2 ** Math.min(6, attempts))));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function deliverOutboxRow(db, salonId, row, env) {
  const config = pushConfig(env);
  if (!config.enabled) return { skipped: 'not_configured' };

  const subscriptions = await activeSubscriptionsForUid(db, salonId, row.target_uid);
  const now = nowIso();

  if (!subscriptions.length) {
    await dbRun(
      db,
      `UPDATE web_push_outbox
          SET delivered_at = ?, last_error = 'no_active_subscription', updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [now, now, salonId, row.id],
    );
    return { delivered: 0, noSubscription: true };
  }

  const badge = await unreadCountForUid(db, salonId, row.target_uid);
  const payload = rawPayload(JSON.stringify({
    title: cleanText(row.title) || 'Queens Salon',
    body: cleanText(row.body) || 'لديك تحديث جديد',
    url: cleanText(row.route) || PUSH_ROUTE_FALLBACK,
    tag: `${cleanText(row.source_type) || 'notification'}:${cleanText(row.source_id) || row.id}`,
    badge,
  }));

  let delivered = 0;
  let gone = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      const accepted = await sendPushNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        payload,
        {
          publicKey: config.publicKey,
          privateKey: config.privateKey,
          subject: config.subject,
        },
        {
          ttl: 86400,
          urgency: 'normal',
          timeoutMs: 10000,
        },
      );

      if (accepted) {
        delivered += 1;
        await markSubscriptionSuccess(db, salonId, subscription.id, now);
      } else {
        gone += 1;
        await markSubscriptionGone(db, salonId, subscription.id, now);
      }
    } catch (error) {
      failed += 1;
      await markSubscriptionError(db, salonId, subscription.id, now, error);
    }
  }

  if (delivered > 0 || gone === subscriptions.length) {
    await dbRun(
      db,
      `UPDATE web_push_outbox
          SET delivered_at = ?, attempts = attempts + 1,
              last_error = ?, updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [
        now,
        failed ? `partial_failure:${failed}` : null,
        now,
        salonId,
        row.id,
      ],
    );
  } else {
    const attempts = Number(row.attempts || 0) + 1;
    await dbRun(
      db,
      `UPDATE web_push_outbox
          SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [attempts, retryAt(attempts), `delivery_failed:${failed}`, now, salonId, row.id],
    );
  }

  return { delivered, gone, failed };
}

export async function flushEmployeeWebPushOutbox(db, salonId, env, options = {}) {
  if (!pushConfig(env).enabled) return { enabled: false, processed: 0 };

  const limit = Math.max(1, Math.min(50, Number(options.limit || 25)));
  const rows = await dbAll(
    db,
    `SELECT *
       FROM web_push_outbox
      WHERE salon_id = ?
        AND delivered_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?`,
    [salonId, nowIso(), limit],
  );

  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await deliverOutboxRow(db, salonId, row, env);
      delivered += Number(result?.delivered || 0);
      failed += Number(result?.failed || 0);
    } catch (error) {
      failed += 1;
      const now = nowIso();
      const attempts = Number(row.attempts || 0) + 1;
      await dbRun(
        db,
        `UPDATE web_push_outbox
            SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
          WHERE salon_id = ? AND id = ?`,
        [
          attempts,
          retryAt(attempts),
          cleanText(error?.message || error?.name || 'push_error').slice(0, 500),
          now,
          salonId,
          row.id,
        ],
      );
    }
  }

  return {
    enabled: true,
    processed: rows.length,
    delivered,
    failed,
  };
}
