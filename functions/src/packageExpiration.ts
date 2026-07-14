import type * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

export async function expireClientPackagesInBatches(args: {
  db: admin.firestore.Firestore;
  salonId: string;
  now?: Timestamp;
  pageSize?: number;
  maxPages?: number;
  onBatchError?: (error: unknown, attempted: number) => void;
}) {
  const now = args.now || Timestamp.now();
  const pageSize = Math.min(450, Math.max(1, Math.floor(args.pageSize || 450)));
  const maxPages = Math.max(1, Math.floor(args.maxPages || 1000));
  const packages = args.db.collection("salons").doc(args.salonId).collection("client_packages");
  let expiredCount = 0;
  let failedCount = 0;
  let pages = 0;

  for (; pages < maxPages; pages += 1) {
    const snap = await packages
      .where("status", "==", "active")
      .where("expiresAt", "<=", now)
      .orderBy("expiresAt", "asc")
      .limit(pageSize)
      .get();
    if (snap.empty) break;
    const batch = args.db.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        status: "expired",
        expiredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    try {
      await batch.commit();
      expiredCount += snap.docs.length;
    } catch (error) {
      failedCount += snap.docs.length;
      args.onBatchError?.(error, snap.docs.length);
      throw error;
    }
    if (snap.size < pageSize) break;
  }

  return { expiredCount, failedCount, pages };
}
