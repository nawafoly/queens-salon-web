import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, from, to) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(from)) throw new Error(`Missing expected source in ${path}`);
  await writeFile(path, source.replace(from, to), 'utf8');
}

const functionBlock = `
/**
 * ✅ Callable: adminDeleteUserAccount
 * - Deletes the Firebase Authentication identity permanently.
 * - Deletes only users/admin_users account documents.
 * - Preserves employee, booking, attendance and payroll records.
 */
export const adminDeleteUserAccount = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "لازم تسجل دخول.");

  const callerUid = request.auth.uid;
  const targetUid = String((request.data as any)?.uid || "").trim();
  if (!targetUid) throw new HttpsError("invalid-argument", "uid مطلوب.");
  if (targetUid === callerUid) {
    throw new HttpsError("failed-precondition", "لا يمكن حذف حسابك من هذه الصفحة.");
  }

  const caller = await admin.auth().getUser(callerUid);
  const callerEmail = String(caller.email || "").toLowerCase().trim();
  const callerRole = await getCallerRole(callerUid);
  const isBootstrap = isBootstrapEmail(callerEmail);
  if (!isBootstrap && !["owner", "admin"].includes(callerRole)) {
    throw new HttpsError("permission-denied", "غير مصرح. فقط Owner/Admin.");
  }

  let targetUser: admin.auth.UserRecord | null = null;
  try {
    targetUser = await admin.auth().getUser(targetUid);
  } catch (error: any) {
    if (String(error?.code || "") !== "auth/user-not-found") throw error;
  }

  const targetEmail = String(targetUser?.email || "").toLowerCase().trim();
  if (targetEmail === BOOTSTRAP_OWNER_EMAIL.toLowerCase()) {
    throw new HttpsError("permission-denied", "لا يمكن حذف حساب المالك الأساسي.");
  }

  const usersRef = db.collection("salons").doc(SALON_ID).collection("users").doc(targetUid);
  const adminRef = db.collection("salons").doc(SALON_ID).collection("admin_users").doc(targetUid);
  const [userSnap, adminSnap] = await Promise.all([usersRef.get(), adminRef.get()]);
  const targetRole = normalizeRole(
    userSnap.data()?.role || adminSnap.data()?.role || targetUser?.customClaims?.role
  );
  if (targetRole === "owner" && callerRole !== "owner" && !isBootstrap) {
    throw new HttpsError("permission-denied", "فقط المالك يستطيع حذف حساب مالك آخر.");
  }

  const batch = db.batch();
  batch.delete(usersRef);
  batch.delete(adminRef);
  await batch.commit();

  let authDeleted = false;
  if (targetUser) {
    await admin.auth().deleteUser(targetUid);
    authDeleted = true;
  }

  logger.info("[adminDeleteUserAccount] account permanently deleted", {
    callerUid,
    targetUid,
    targetEmail,
    targetRole,
    authDeleted,
    employeeRecordsDeleted: false,
  });

  return { ok: true, uid: targetUid, authDeleted, firestoreDeleted: true };
});
`;

await replaceOnce(
  'functions/src/index.ts',
  '\n/**\n * ✅ Callable: whoAmI\n */\n',
  `${functionBlock}\n/**\n * ✅ Callable: whoAmI\n */\n`,
);

await replaceOnce(
  'src/pages/settings/SettingsUsers.tsx',
  'import { writeAuditLog } from "../../services/logService";\n',
  'import { writeAuditLog } from "../../services/logService";\nimport { deleteAdminAccountPermanently } from "../../services/adminAccountDeletionService";\n',
);

const settingsPath = 'src/pages/settings/SettingsUsers.tsx';
let settings = await readFile(settingsPath, 'utf8');
const start = settings.indexOf('  const deleteUserAccount = async (uid: string) => {');
const end = settings.indexOf('  const restoreUserAccount = async (uid: string) => {', start);
if (start < 0 || end < 0) throw new Error('Could not locate deleteUserAccount block');
const replacement = `  const deleteUserAccount = async (uid: string) => {
    if (!canManageUsers) return;

    const row = users.find((x) => x.uid === uid);
    if (!row) return;

    if (!canEditTargetUser(row)) {
      toastMsg("❌ حذف حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن حذف حسابك من هنا", 2400);
      return;
    }

    const ok = confirm(
      \`حذف نهائي لحساب الدخول من Firebase Authentication وCloudflare D1.\\n\\nالحساب: \${row.email || uid}\\n\\nلن يتم حذف ملف الموظفة أو الحجوزات أو الحضور أو الرواتب. لا يمكن استعادة الحساب بعد المتابعة.\`
    );
    if (!ok) return;

    try {
      setUsersLoading(true);
      const actorUid = String((auth as any)?.currentUser?.uid || "").trim();
      await deleteAdminAccountPermanently(uid);
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
      if (selectedUserId === uid) setSelectedUserId("");
      if (editDraft?.uid === uid) setEditDraft(null);

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_deleted",
        entityType: "user",
        entityId: uid,
        description: "تم حذف حساب الدخول نهائيًا من Firebase وCloudflare",
        source: "dashboard",
        before: {
          email: row.email || null,
          role: row.role,
          active: row.active,
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || null,
        },
        after: {
          accountDeletedPermanently: true,
          authDeleted: true,
          coreD1Deleted: true,
          staffFileChanged: false,
        },
        meta: { actorUid },
      });

      toastMsg("✅ تم حذف حساب الدخول نهائيًا من السيرفر", 2600);
    } catch (e: any) {
      console.error("deleteUserAccount error:", e);
      const message = String(e?.message || "");
      if (message.includes("permission") || message.includes("صلاحية")) {
        toastMsg("❌ ليست لديك صلاحية الحذف النهائي", 2800);
      } else if (message.includes("login") || message.includes("جلسة")) {
        toastMsg("❌ انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة", 3000);
      } else {
        toastMsg("❌ تعذر إكمال الحذف النهائي. لم يتم حذف ملف الموظفة", 3000);
      }
    } finally {
      setUsersLoading(false);
    }
  };

`;
settings = settings.slice(0, start) + replacement + settings.slice(end);
await writeFile(settingsPath, settings, 'utf8');

await replaceOnce(
  'workers/core/repositories/admin-profiles.js',
  "import { activeFlag, cleanText, dbAll, dbBatch, dbFirst, nowIso, optionalText, requiredId } from '../d1.js';\n",
  "import { activeFlag, cleanText, dbAll, dbBatch, dbFirst, nowIso, optionalText, requiredId } from '../d1.js';\nimport { AppError } from '../errors.js';\n",
);
await replaceOnce(
  'workers/core/repositories/admin-profiles.js',
  "  const priority = ['owner', 'admin', 'reception', 'staff', 'client'];\n",
  "  if (rows.some((row) => cleanText(row.role).toLowerCase() === 'revoked')) return 'guest';\n  const priority = ['owner', 'admin', 'reception', 'staff', 'client'];\n",
);
let profiles = await readFile('workers/core/repositories/admin-profiles.js', 'utf8');
profiles += `

export async function deleteAdminProfile(db, salonId, firebaseUid, actor = {}) {
  const uid = requiredId(firebaseUid, 'firebaseUid');
  const actorUid = cleanText(actor.uid);
  const actorRole = cleanText(actor.role).toLowerCase();
  if (actorUid && actorUid === uid) throw new AppError(409, 'core_admin:cannot_delete_self');

  const existing = await dbFirst(db, 'SELECT * FROM admin_profiles WHERE salon_id = ? AND firebase_uid = ? LIMIT 1', [salonId, uid]);
  const targetRoles = await dbAll(db, 'SELECT role FROM role_assignments WHERE salon_id = ? AND firebase_uid = ? AND active = 1', [salonId, uid]);
  const targetEmail = cleanText(existing?.email).toLowerCase();
  const targetIsOwner = targetRoles.some((row) => cleanText(row.role).toLowerCase() === 'owner');
  if (targetEmail === 'nawafaaa0@gmail.com') throw new AppError(403, 'core_admin:bootstrap_owner_protected');
  if (targetIsOwner && actorRole !== 'owner') throw new AppError(403, 'core_admin:owner_delete_requires_owner');

  const now = nowIso();
  await dbBatch(db, [
    { sql: 'DELETE FROM role_assignments WHERE salon_id = ? AND firebase_uid = ?', params: [salonId, uid] },
    {
      sql: \`INSERT INTO role_assignments
        (salon_id, firebase_uid, role, scope, active, assigned_by_uid, created_at, updated_at)
        VALUES (?, ?, 'revoked', 'account_deleted', 1, ?, ?, ?)\`,
      params: [salonId, uid, optionalText(actor.uid) || null, now, now],
    },
    { sql: 'DELETE FROM admin_profiles WHERE salon_id = ? AND firebase_uid = ?', params: [salonId, uid] },
  ]);

  return {
    firebase_uid: uid,
    deleted: true,
    revoked: true,
    existed: Boolean(existing),
    employee_id: existing?.employee_id || null,
  };
}
`;
await writeFile('workers/core/repositories/admin-profiles.js', profiles, 'utf8');

await replaceOnce(
  'workers/core/index.js',
  'import {\n  listAdminProfiles,\n',
  'import {\n  deleteAdminProfile,\n  listAdminProfiles,\n',
);
await replaceOnce(
  'workers/core/index.js',
  '    name: ctx.identity?.claims?.name || "",\n',
  '    name: ctx.identity?.claims?.name || "",\n    role: ctx.role,\n',
);
await replaceOnce(
  'workers/core/index.js',
  '      if (["POST", "PATCH"].includes(method)) return upsertAdminProfile(db, ctx.salonId, route.id ? { ...body, firebaseUid: route.id } : body, actorInfo);\n',
  '      if (["POST", "PATCH"].includes(method)) return upsertAdminProfile(db, ctx.salonId, route.id ? { ...body, firebaseUid: route.id } : body, actorInfo);\n      if (method === "DELETE" && route.id) return deleteAdminProfile(db, ctx.salonId, route.id, actorInfo);\n',
);

console.log('Permanent account deletion implementation applied.');
