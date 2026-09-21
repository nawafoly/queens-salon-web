-- Tighten repeated-block security lookup for MALIKAT Connect.
-- The rate-limit query is scoped by salon + conversation + actor + recent time.

CREATE INDEX IF NOT EXISTS idx_client_connect_security_actor_recent
  ON client_connect_security_events(
    salon_id,
    conversation_id,
    actor_uid,
    detected_at DESC
  );
