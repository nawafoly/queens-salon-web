import { AppError } from './errors.js';
import { FirestoreRestClient } from './firestore-rest.js';
import { cleanText, requiredDocumentId, salonPath, timestampMs, timestampNow } from './validation.js';

export async function expireClientPackages(env, controller) {
  const projectId = cleanText(env.FIREBASE_PROJECT_ID);
  if (!projectId) throw new AppError(503, "packages_auth:project_not_configured");
  const db = new FirestoreRestClient(env, projectId);
  const salonId = requiredDocumentId(env.SALON_ID || "main", "salonId");
  const nowMs = Date.now();
  let offset = 0;
  let scanned = 0;
  let expired = 0;
  const pageSize = 300;
  while (scanned < 3000) {
    const rows = await db.query(salonPath(salonId), "client_packages", [["status", "EQUAL", "active"]], pageSize, offset);
    if (!rows.length) break;
    scanned += rows.length;
    offset += rows.length;
    for (const row of rows) {
      if (controller?.signal?.aborted) return { ok: false, scanned, expired, aborted: true };
      const expiresAtMs = timestampMs(row.data?.expiresAt);
      if (expiresAtMs === undefined || expiresAtMs >= nowMs) continue;
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(row.path);
        if (!fresh.exists || fresh.data?.status !== "active") return;
        const freshExpiry = timestampMs(fresh.data?.expiresAt);
        if (freshExpiry === undefined || freshExpiry >= nowMs) return;
        tx.update(row.path, { status: "expired", updatedAt: timestampNow(), expiredAt: timestampNow() });
        expired += 1;
      });
    }
    if (rows.length < pageSize) break;
  }
  console.log("packages_worker_cron_expire", { scanned, expired });
  return { ok: true, scanned, expired };
}
