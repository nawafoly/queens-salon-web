-- Canonical internal communications, employee notifications and recruitment.
-- Core D1 owns operational records. Firebase remains authentication-only.

CREATE TABLE IF NOT EXISTS employee_messages (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  thread_id TEXT,
  sender_uid TEXT NOT NULL,
  sender_name TEXT,
  sender_employee_id TEXT,
  recipient_uid TEXT NOT NULL,
  recipient_name TEXT,
  recipient_employee_id TEXT,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'employee_to_employee'
    CHECK (kind IN ('hr_to_employee', 'employee_to_employee', 'system')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employee_messages_conversation
  ON employee_messages(salon_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_messages_sender
  ON employee_messages(salon_id, sender_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_messages_recipient
  ON employee_messages(salon_id, recipient_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS employee_message_reads (
  salon_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  reader_uid TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, message_id, reader_uid)
);
CREATE INDEX IF NOT EXISTS idx_employee_message_reads_reader
  ON employee_message_reads(salon_id, reader_uid, read_at DESC);

CREATE TABLE IF NOT EXISTS employee_notifications (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  target_uid TEXT,
  target_employee_id TEXT,
  type TEXT NOT NULL DEFAULT 'system'
    CHECK (type IN ('leave', 'file', 'message', 'system', 'payroll', 'employee_request')),
  title TEXT NOT NULL,
  body TEXT,
  route TEXT,
  created_by_uid TEXT,
  read_at TEXT,
  read_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (target_uid IS NOT NULL AND TRIM(target_uid) <> '') OR
    (target_employee_id IS NOT NULL AND TRIM(target_employee_id) <> '')
  )
);
CREATE INDEX IF NOT EXISTS idx_employee_notifications_uid
  ON employee_notifications(salon_id, target_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_notifications_employee
  ON employee_notifications(salon_id, target_employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employee_notifications_unread
  ON employee_notifications(salon_id, read_at, created_at DESC);

CREATE TABLE IF NOT EXISTS recruitment_applications (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  role_applied TEXT,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'reviewing', 'interview', 'accepted', 'rejected', 'hired')),
  notes TEXT,
  message TEXT,
  source TEXT,
  reviewed_at TEXT,
  reviewed_by_uid TEXT,
  hired_at TEXT,
  hired_by_uid TEXT,
  hired_uid TEXT,
  hired_employee_id TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recruitment_applications_status
  ON recruitment_applications(salon_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recruitment_applications_email
  ON recruitment_applications(salon_id, email, created_at DESC);
