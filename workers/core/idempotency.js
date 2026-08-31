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

  // Binary file content is excluded from the JSON replay ledger.
  if (
    /\/files\/[^/]+\/content$/.test(pathname)
  ) {
    return false;
  }

  return true;
}

export async function requestFingerprint(request) {
  const url = new URL(request.url);
  const body = await request.clone().text();
  const raw = [
    String(request.method || "GET").toUpperCase(),
    url.pathname,
    url.search,
    body,
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
  requestId
) {
  const now = isoNow();

  const inserted = await db
    .prepare(
      [
        "INSERT OR IGNORE INTO core_idempotency_operations",
        "(salon_id, operation_id, request_fingerprint, state,",
        " first_request_id, last_request_id, created_at, updated_at)",
        "VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)",
      ].join(" ")
    )
    .bind(
      salonId,
      operationId,
      fingerprint,
      requestId,
      requestId,
      now,
      now
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
      ].join(" ")
    )
    .bind(
      requestId,
      now,
      salonId,
      operationId
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
  responseBody
) {
  const now = isoNow();

  await db
    .prepare(
      [
        "UPDATE core_idempotency_operations",
        "SET state = 'completed', response_status = ?, response_body = ?,",
        " last_request_id = ?, completed_at = ?, updated_at = ?",
        "WHERE salon_id = ? AND operation_id = ?",
        "AND request_fingerprint = ? AND state = 'pending'",
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
      fingerprint
    )
    .run();
}

export async function abandonIdempotentOperation(
  db,
  salonId,
  operationId,
  fingerprint
) {
  await db
    .prepare(
      [
        "DELETE FROM core_idempotency_operations",
        "WHERE salon_id = ? AND operation_id = ?",
        "AND request_fingerprint = ? AND state = 'pending'",
      ].join(" ")
    )
    .bind(
      salonId,
      operationId,
      fingerprint
    )
    .run();
}
