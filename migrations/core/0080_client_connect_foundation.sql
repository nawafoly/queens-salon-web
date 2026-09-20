-- MALIKAT Connect foundation.
-- Salon-owned communication between clients and specialists with security review.

CREATE TABLE IF NOT EXISTS client_preferences (
  salon_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  preferred_staff_id TEXT,
  preferred_staff_source TEXT CHECK (
    preferred_staff_source IS NULL OR preferred_staff_source IN ('client', 'behavior', 'admin')
  ),
  service_messages_enabled INTEGER NOT NULL DEFAULT 1 CHECK (service_messages_enabled IN (0, 1)),
  marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0, 1)),
  connect_enabled INTEGER NOT NULL DEFAULT 1 CHECK (connect_enabled IN (0, 1)),
  updated_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_preferences_staff
  ON client_preferences(salon_id, preferred_staff_id);

CREATE TABLE IF NOT EXISTS client_connect_conversations (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  assigned_staff_id TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'review', 'restricted', 'closed')),
  last_message_at TEXT,
  last_message_preview TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  closed_by_uid TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_connect_client
  ON client_connect_conversations(salon_id, client_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_connect_assigned_staff
  ON client_connect_conversations(salon_id, assigned_staff_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS client_connect_messages (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  sender_kind TEXT NOT NULL CHECK (sender_kind IN ('client', 'staff', 'admin', 'system')),
  sender_uid TEXT,
  sender_client_id TEXT,
  sender_staff_id TEXT,
  body TEXT NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'sent'
    CHECK (delivery_status IN ('sent', 'blocked')),
  blocked_reason TEXT,
  security_event_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_connect_messages_conversation
  ON client_connect_messages(salon_id, conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_client_connect_messages_sender
  ON client_connect_messages(salon_id, conversation_id, sender_uid, created_at DESC);

CREATE TABLE IF NOT EXISTS client_connect_security_events (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('client', 'staff', 'admin')),
  actor_uid TEXT,
  detection_type TEXT NOT NULL CHECK (
    detection_type IN (
      'phone_number',
      'split_phone_number',
      'email',
      'social_handle',
      'external_link',
      'numeric_fragment',
      'contact_exchange_language'
    )
  ),
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  review_status TEXT NOT NULL DEFAULT 'new'
    CHECK (review_status IN ('new', 'under_review', 'safe', 'warning_issued', 'restricted', 'closed')),
  evidence_text TEXT,
  detected_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by_uid TEXT,
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_client_connect_security_review
  ON client_connect_security_events(salon_id, review_status, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_client_connect_security_conversation
  ON client_connect_security_events(salon_id, conversation_id, detected_at DESC);
