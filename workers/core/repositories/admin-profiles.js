// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import { activeFlag, cleanText, dbAll, dbBatch, dbFirst, nowIso, optionalText, requiredId } from '../d1.js';
import { AppError } from '../errors.js';

export async function resolveAssignedRole(db, salonId, firebaseUid, fallbackRole = 'guest') {
  if (!firebaseUid) return fallbackRole;
  let rows = [];
  if (db.__fakeD1 && typeof db.rows === 'function') {
    try { rows = db.rows('role_assignments').filter((row) => row.salon_id === salonId && row.firebase_uid === firebaseUid && Number(row.active) === 1); } catch { return fallbackRole; }
  } else {
    rows = await dbAll(db, 'SELECT role FROM role_assignments WHERE salon_id = ? AND firebase_uid = ? AND active = 1', [salonId, firebaseUid]);
  }
  if (rows.some((row) => cleanText(row.role).toLowerCase() === 'revoked')) return 'guest';
  const priority = ['owner', 'admin', 'reception', 'staff', 'client'];
  for (const role of priority) if (rows.some((row) => cleanText(row.role).toLowerCase() === role)) return role;
  return fallbackRole;
}

export async function listAdminProfiles(db, salonId) {
  const profiles = await dbAll(db, 'SELECT * FROM admin_profiles WHERE salon_id = ? ORDER BY active DESC, display_name, email', [salonId]);
  return Promise.all(profiles.map(async (profile) => ({
    ...profile,
    roles: await dbAll(db, 'SELECT * FROM role_assignments WHERE salon_id = ? AND firebase_uid = ? ORDER BY role', [salonId, profile.firebase_uid]),
  })));
}

export async function upsertAdminProfile(db, salonId, data, actor = {}) {
  const uid = requiredId(data.firebaseUid || data.uid, 'firebaseUid');
  const now = nowIso();
  const existing = await dbFirst(db, 'SELECT * FROM admin_profiles WHERE salon_id = ? AND firebase_uid = ? LIMIT 1', [salonId, uid]);
  const row = {
    salon_id: salonId,
    firebase_uid: uid,
    username: optionalText(data.username) || null,
    display_name: optionalText(data.displayName || data.display_name) || null,
    email: optionalText(data.email) || null,
    employee_id: optionalText(data.employeeId || data.employee_id) || null,
    active: activeFlag(data.active, 1),
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  const statements = [{
    sql: `INSERT INTO admin_profiles
      (salon_id, firebase_uid, username, display_name, email, employee_id, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(salon_id, firebase_uid) DO UPDATE SET
        username = excluded.username, display_name = excluded.display_name, email = excluded.email,
        employee_id = excluded.employee_id, active = excluded.active, updated_at = excluded.updated_at`,
    params: Object.values(row),
  }];
  if (Array.isArray(data.roles)) {
    statements.push({ sql: 'DELETE FROM role_assignments WHERE salon_id = ? AND firebase_uid = ?', params: [salonId, uid] });
    for (const roleValue of data.roles) {
      const role = cleanText(typeof roleValue === 'string' ? roleValue : roleValue?.role).toLowerCase();
      if (!role) continue;
      statements.push({
        sql: `INSERT INTO role_assignments
          (salon_id, firebase_uid, role, scope, active, assigned_by_uid, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [salonId, uid, role, cleanText(roleValue?.scope || 'salon'), activeFlag(roleValue?.active, 1), optionalText(actor.uid) || null, now, now],
      });
    }
  }
  await dbBatch(db, statements);
  return (await listAdminProfiles(db, salonId)).find((profile) => profile.firebase_uid === uid) || row;
}


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
      sql: `INSERT INTO role_assignments
        (salon_id, firebase_uid, role, scope, active, assigned_by_uid, created_at, updated_at)
        VALUES (?, ?, 'revoked', 'account_deleted', 1, ?, ?, ?)`,
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
