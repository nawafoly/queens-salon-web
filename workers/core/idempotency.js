// CORE D1 ONLY â€” request idempotency and replay ledger.

function clean(value) {
  return String(value ?? "").trim();
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function isoNow() {
  return new Date().toISOString();
}

export function normalizeOperationId(value) {
  const operationId = clean(value);

  if (!operationId) return "";

  if (
    operationId.length > 128 ||
    !/^[A-Za-z0-9._:-]+$/.test(operationId)
  ) {
    return "";
  }

  return operationId;
}

export function shouldUseIdempotency(request, operationId) {
  const method = String(request.method || "GET").toUpperCase();

  if (!operationId) return false;
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;

  const pathname = new URL(request.url).pathname;

  // Weekly rest rescheduling owns its durable operation identity.
  // Always execute current authorization and domain replay checks.
  // Never serve a cached financial response before authorization.
  if (
    /^\/api\/core\/hr\/weekly-rest\/rescheduling(?:\/[^/]+\/cancel)?$/.test(pathname)
  ) {
    return false;
  }

  // The administrative wallet uses POST for lookups and must read current balances.
  if (/^\/api\/(?:core\/)?packages\/client-wallet\/?$/.test(pathname)) {
    return false;
  }

  // Booking creation owns idempotency through the caller-supplied booking id
  // and the atomic booking/package transaction. Running it through the generic
  // HTTP ledger can strand a pending key after a Worker interruption and can
  // replay before current booking authorization is evaluated.
  if (
    method === "POST" &&
    /^\/api\/core\/(?:internal\/)?bookings\/?$/.test(pathname)
  ) {
    return false;
  }

  // Binary file content is excluded from the JSON replay ledger.
  if (
    /\/files\/[^/]+\/content$/.test(pathname)
  ) {
    return false;
  }

  return true;
}

export async function requestFingerprint(request, actorScope) {
  const url = new URL(request.url);
  const body = await request.clone().text();
  const raw = [
    String(request.method || "GET").toUpperCase(),
    url.pathname,
    url.search,
    body,
    ...(actorScope ? [actorScope] : []),
  ].join("\n");

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function beginIdempotentOperation(
  db,
  salonId,
  operationId,
  fingerprint,
  requestId,
  executionToken
) {
  if (!clean(executionToken)) {
    throw new Error(
      "core_idempotency:execution_token_required"
    );
  }

  const now = isoNow();

  const inserted = await db
    .prepare(
      [
        "INSERT OR IGNORE INTO core_idempotency_operations",
        "(salon_id, operation_id, request_fingerprint, state,",
        " first_request_id, last_request_id, created_at, updated_at, execution_token)",
        "VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?)",
      ].join(" ")
    )
    .bind(
      salonId,
      operationId,
      fingerprint,
      requestId,
      requestId,
      now,
      now,
      executionToken
    )
    .run();

  if (changes(inserted) > 0) {
    return { action: "proceed" };
  }

  const existing = await db
    .prepare(
      [
        "SELECT request_fingerprint, state, response_status, response_body",
        "FROM core_idempotency_operations",
        "WHERE salon_id = ? AND operation_id = ?",
        "LIMIT 1",
      ].join(" ")
    )
    .bind(salonId, operationId)
    .first();

  if (!existing) {
    return { action: "in_progress" };
  }

  if (
    clean(existing.request_fingerprint) !==
    clean(fingerprint)
  ) {
    return { action: "conflict" };
  }

  await db
    .prepare(
      [
        "UPDATE core_idempotency_operations",
        "SET last_request_id = ?, updated_at = ?",
        "WHERE salon_id = ? AND operation_id = ?",
        "AND request_fingerprint = ?",
      ].join(" ")
    )
    .bind(
      requestId,
      now,
      salonId,
      operationId,
      fingerprint
    )
    .run();

  if (
    clean(existing.state) === "completed" &&
    Number.isInteger(Number(existing.response_status)) &&
    clean(existing.response_body)
  ) {
    return {
      action: "replay",
      status: Number(existing.response_status),
      responseBody: String(existing.response_body),
    };
  }

  return { action: "in_progress" };
}

export async function completeIdempotentOperation(
  db,
  salonId,
  operationId,
  fingerprint,
  requestId,
  status,
  responseBody,
  executionToken
) {
  if (!clean(executionToken)) return false;

  const now = isoNow();

  const result = await db
    .prepare(
      [
        "UPDATE core_idempotency_operations",
        "SET state = 'completed', response_status = ?, response_body = ?,",
        " last_request_id = ?, completed_at = ?, updated_at = ?",
        "WHERE salon_id = ? AND operation_id = ?",
        "AND request_fingerprint = ? AND state = 'pending'",
        "AND execution_token = ?",
      ].join(" ")
    )
    .bind(
      Number(status),
      String(responseBody || "{}"),
      requestId,
      now,
      now,
      salonId,
      operationId,
      fingerprint,
      executionToken
    )
    .run();

  return changes(result) === 1;
}

export async function abandonIdempotentOperation(
  db,
  salonId,
  operationId,
  fingerprint,
  executionToken
) {
  if (!clean(executionToken)) return false;

  const result = await db
    .prepare(
      [
        "DELETE FROM core_idempotency_operations",
        "WHERE salon_id = ? AND operation_id = ?",
        "AND request_fingerprint = ? AND state = 'pending'",
        "AND execution_token = ?",
      ].join(" ")
    )
    .bind(
      salonId,
      operationId,
      fingerprint,
      executionToken
    )
    .run();

  return changes(result) === 1;
}

// These statements must execute in the SAME atomic D1 batch as
// the associated business mutation, never in a separate batch.
//
// A stale or missing execution owner aborts the entire batch.
// This contract is not a general pending-operation takeover.

export function atomicIdempotencyCompletionStatements({
  salonId,
  operationId,
  fingerprint,
  requestId,
  executionToken,
  status,
  responseBody,
}) {
  for (const value of [
    salonId,
    operationId,
    fingerprint,
    requestId,
    executionToken,
  ]) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(
        "core_idempotency:invalid_commit_identity"
      );
    }
  }

  if (normalizeOperationId(operationId) !== operationId) {
    throw new Error(
      "core_idempotency:invalid_commit_identity"
    );
  }

  if (
    !Number.isInteger(status) ||
    status < 200 ||
    status >= 300 ||
    status === 204 ||
    status === 205
  ) {
    throw new Error(
      "core_idempotency:invalid_commit_status"
    );
  }

  if (typeof responseBody !== "string") {
    throw new Error(
      "core_idempotency:invalid_commit_response"
    );
  }

  let payload;

  try {
    payload = JSON.parse(responseBody);
  } catch {
    throw new Error(
      "core_idempotency:invalid_commit_response"
    );
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.ok === false
  ) {
    throw new Error(
      "core_idempotency:invalid_commit_response"
    );
  }

  const now = isoNow();

  return [
    {
      sql: `UPDATE core_idempotency_operations
        SET state = 'completed',
            response_status = ?,
            response_body = ?,
            last_request_id = ?,
            completed_at = ?,
            updated_at = ?
        WHERE salon_id = ?
          AND operation_id = ?
          AND request_fingerprint = ?
          AND execution_token = ?
          AND state = 'pending'`,
      params: [
        status,
        responseBody,
        requestId,
        now,
        now,
        salonId,
        operationId,
        fingerprint,
        executionToken,
      ],
    },
    {
      // A failed ownership comparison must abort every
      // preceding business write in the transaction.
      sql: `INSERT INTO core_idempotency_operations
        (salon_id, operation_id, request_fingerprint,
         state, first_request_id, last_request_id,
         created_at, updated_at)
        SELECT NULL, ?, ?, 'pending', ?, ?, ?, ?
        WHERE changes() <> 1`,
      params: [
        operationId,
        fingerprint,
        requestId,
        requestId,
        now,
        now,
      ],
    },
  ];
}
