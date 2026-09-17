-- Malikat employee Web Push subscriptions and durable outbox.
-- Core D1 remains the authority for notification state. Push is delivery only.

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  target_uid TEXT NOT NULL,
  target_employee_id TEXT,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  platform TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_success_at TEXT,
  last_error_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_target
  ON web_push_subscriptions(salon_id, target_uid, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS web_push_outbox (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  route TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_push_outbox_pending
  ON web_push_outbox(salon_id, delivered_at, next_attempt_at, created_at);

CREATE TRIGGER IF NOT EXISTS trg_employee_notifications_web_push_uid
AFTER INSERT ON employee_notifications
WHEN NEW.target_uid IS NOT NULL AND TRIM(NEW.target_uid) <> ''
BEGIN
  INSERT OR IGNORE INTO web_push_outbox
    (id, salon_id, source_type, source_id, target_uid, title, body, route,
     attempts, next_attempt_at, delivered_at, last_error, created_at, updated_at)
  VALUES
    ('employee_notification:' || NEW.id, NEW.salon_id, 'employee_notification', NEW.id,
     NEW.target_uid, NEW.title, NEW.body, COALESCE(NEW.route, '/employee/notifications'),
     0, NULL, NULL, NULL, NEW.created_at, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_notifications_web_push_employee
AFTER INSERT ON employee_notifications
WHEN (NEW.target_uid IS NULL OR TRIM(NEW.target_uid) = '')
  AND NEW.target_employee_id IS NOT NULL
  AND TRIM(NEW.target_employee_id) <> ''
BEGIN
  INSERT OR IGNORE INTO web_push_outbox
    (id, salon_id, source_type, source_id, target_uid, title, body, route,
     attempts, next_attempt_at, delivered_at, last_error, created_at, updated_at)
  SELECT
    'employee_notification:' || NEW.id,
    NEW.salon_id,
    'employee_notification',
    NEW.id,
    au.firebase_uid,
    NEW.title,
    NEW.body,
    COALESCE(NEW.route, '/employee/notifications'),
    0,
    NULL,
    NULL,
    NULL,
    NEW.created_at,
    NEW.updated_at
  FROM user_employee_links l
  JOIN app_users au
    ON au.salon_id = l.salon_id
   AND au.id = l.user_id
   AND au.status = 'active'
  WHERE l.salon_id = NEW.salon_id
    AND l.employee_id = NEW.target_employee_id
    AND l.link_status = 'active'
    AND au.firebase_uid IS NOT NULL
    AND TRIM(au.firebase_uid) <> ''
  LIMIT 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_request_notifications_web_push
AFTER INSERT ON notification_records
WHEN NEW.notification_type = 'employee_request'
  AND NEW.target_uid IS NOT NULL
  AND TRIM(NEW.target_uid) <> ''
BEGIN
  INSERT OR IGNORE INTO web_push_outbox
    (id, salon_id, source_type, source_id, target_uid, title, body, route,
     attempts, next_attempt_at, delivered_at, last_error, created_at, updated_at)
  VALUES
    ('employee_request:' || NEW.id, NEW.salon_id, 'employee_request', NEW.id,
     NEW.target_uid, NEW.title, NEW.body,
     CASE
       WHEN NEW.related_id IS NOT NULL AND TRIM(NEW.related_id) <> ''
         THEN '/employee/requests/' || NEW.related_id
       ELSE '/employee/requests'
     END,
     0, NULL, NULL, NULL, NEW.created_at, NEW.updated_at);
END;
