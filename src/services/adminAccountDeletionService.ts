import { getFunctions, httpsCallable } from "firebase/functions";

import { auth } from "./firebase";
import { coreApiRequest } from "./coreApiClient";

function cleanUid(value: unknown) {
  return String(value || "").trim();
}

/**
 * Permanently removes an administrative login account while preserving the
 * employee operational/history records. Order matters:
 * 1) remove D1 admin role/profile and write a deny tombstone;
 * 2) delete Firebase Auth + users/admin_users through trusted Admin SDK.
 */
export async function deleteAdminAccountPermanently(uidRaw: string) {
  const uid = cleanUid(uidRaw);
  if (!uid) throw new Error("account_delete:uid_required");

  const currentUid = cleanUid(auth.currentUser?.uid);
  if (!currentUid) throw new Error("account_delete:login_required");
  if (currentUid === uid) throw new Error("account_delete:self_delete_forbidden");

  await coreApiRequest<{ uid: string; deleted: boolean }>(
    `/api/core/admin-profiles/${encodeURIComponent(uid)}`,
    { method: "DELETE" }
  );

  const callable = httpsCallable<
    { uid: string },
    { ok: boolean; uid: string; authDeleted: boolean }
  >(getFunctions(auth.app, "us-central1"), "adminDeleteUserAccount");

  const result = await callable({ uid });
  return result.data;
}
