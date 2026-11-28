-- Durable execution ownership for Core request idempotency.
-- Legacy pending rows remain unowned and fail closed.
-- Never infer execution ownership from age or request ID.

ALTER TABLE core_idempotency_operations
ADD COLUMN execution_token TEXT;

CREATE TRIGGER trg_core_idempotency_execution_owner_immutable
BEFORE UPDATE OF execution_token
ON core_idempotency_operations
WHEN OLD.execution_token IS NOT NEW.execution_token
BEGIN
  SELECT RAISE(
    ABORT,
    'core_idempotency:execution_owner_immutable'
  );
END;
