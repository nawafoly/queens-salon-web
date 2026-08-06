import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  placeholders,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import { auditInsertStatement, recordAudit } from './audit.js';

const VALID_ROLES = new Set([
  'owner',
  'admin',
  'hr',
  'accountant',
  'reception',
  'staff',
  'pending',
  'guest',
  'client',
]);

const VALID_STATUSES = new Set(['active', 'disabled', 'pending', 'deleted']);
const ACTIVE_LINK_STATUS = 'active';

const ROLE_RANKS = {
  owner: 100,
  admin: 80,
  hr: 60,
  accountant: 55,
  reception: 40,
  staff: 30,
  pending: 10,
  client: 5,
  guest: 0,
};

const PRIVILEGED_STATUS_FALLBACK_ROLES = new Set(['owner', 'admin']);
const ADMIN_PERMISSION_FALLBACK = new Set([
  'workspace.dashboard.view',
  'employees.view',
  'employees.manage',
  'attendance.view',
  'attendance.records.create',
  'attendance.records.update',
  'attendance.settings.manage',
  'payroll.view',
  'payroll.manage',
  'targets.view',
  'targets.manage',
  'targets.approve',
  'targets.adjust',
  'targets.view_all',
  'targets.view_own',
  'admin_accounts.view',
  'admin_accounts.manage',
  'accounts.read',
  'accounts.create',
  'accounts.update',
  'accounts.disable',
  'accounts.restore',
  'accounts.reset_password',
  'roles.read',
  'roles.assign',
  'permissions.read',
  'permissions.manage',
  'employee_links.read',
  'employee_links.manage',
]);

function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}

export function normalizeAccountRole(value, fallback = 'pending') {
  const role = cleanText(value).toLowerCase();
  if (role === 'administrator' || role === 'manager' || role === 'super_admin' || role === 'super-admin') return 'admin';
  if (role === 'employee') return 'staff';
  if (role === 'receptionist' || role === 'frontdesk' || role === 'desk') return 'reception';
  if (role === 'finance' || role === 'accounting') return 'accountant';
  return VALID_ROLES.has(role) ? role : fallback;
}

function normalizeStatus(value, fallback = 'pending') {
  const status = cleanText(value).toLowerCase();
  return VALID_STATUSES.has(status) ? status : fallback;
}

function resolveAccountStatus(row) {
  const status = cleanText(row?.status || row?.account_status).toLowerCase();
  if (status === 'enabled') return 'active';
  if (status === 'archived') return 'deleted';
  if (status === 'inactive' || status === 'blocked') return 'disabled';
  if (VALID_STATUSES.has(status)) return status;
  if (row?.deleted_at) return 'deleted';

  const role = normalizeAccountRole(row?.primary_role, 'guest');
  if (PRIVILEGED_STATUS_FALLBACK_ROLES.has(role)) return 'active';

  return 'pending';
}

function boolInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback ? 1 : 0;
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function uniqueTexts(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function accountIdFrom(data) {
  return requiredId(data?.id || data?.userId || data?.user_id, 'accountId');
}

function actorInfo(actor) {
  return {
    uid: actor?.identity?.uid || actor?.uid || '',
    email: actor?.identity?.claims?.email || actor?.email || '',
    name: actor?.user?.display_name || actor?.name || '',
    role: actor?.role || actor?.user?.primary_role || '',
    userId: actor?.user?.id || actor?.userId || '',
    ip: actor?.requestMeta?.ip || actor?.ip || '',
    userAgent: actor?.requestMeta?.userAgent || actor?.userAgent || '',
  };
}

function assertSameSalon(salonId, row) {
  if (!row || row.salon_id !== salonId) throw new AppError(404, 'ACCOUNT_NOT_FOUND');
}

function isOwner(row) {
  return normalizeAccountRole(row?.primary_role, 'guest') === 'owner';
}

function roleRank(role) {
  return ROLE_RANKS[normalizeAccountRole(role, 'guest')] || 0;
}

export function isActiveOperationalAccount(row) {
  return row && resolveAccountStatus(row) === 'active' && !row.deleted_at;
}

export async function getPermissionCatalog(db) {
  return dbAll(db, 'SELECT * FROM permissions ORDER BY group_key, permission_key');
}

export async function getRoleCatalog(db, salonId) {
  return dbAll(db, 'SELECT * FROM roles WHERE salon_id = ? ORDER BY rank DESC, role_key', [salonId]);
}

export async function knownPermissionSet(db) {
  const rows = await dbAll(db, 'SELECT permission_key FROM permissions', []);
  const known = new Set(rows.map((row) => cleanText(row.permission_key)).filter(Boolean));
  ADMIN_PERMISSION_FALLBACK.forEach((permission) => known.add(permission));
  return known;
}

export async function getAccountById(db, salonId, id) {
  const accountId = requiredId(id, 'accountId');
  return dbFirst(db, 'SELECT * FROM app_users WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, accountId]);
}

export async function getAccountByFirebaseUid(db, salonId, firebaseUid) {
  const uid = cleanText(firebaseUid);
  if (!uid) return null;
  return dbFirst(db, 'SELECT * FROM app_users WHERE salon_id = ? AND firebase_uid = ? LIMIT 1', [salonId, uid]);
}

export async function getActiveEmployeeLink(db, salonId, userId) {
  const id = cleanText(userId);
  if (!id) return null;
  return dbFirst(
    db,
    `SELECT l.*, ep.name AS employee_name, ep.email AS employee_email, ep.phone_normalized AS employee_phone
       FROM user_employee_links l
       LEFT JOIN employee_profiles ep ON ep.salon_id = l.salon_id AND ep.id = l.employee_id
      WHERE l.salon_id = ? AND l.user_id = ? AND l.link_status = 'active'
      LIMIT 1`,
    [salonId, id]
  );
}

async function getRolePermissions(db, salonId, role) {
  const normalizedRole = normalizeAccountRole(role, 'guest');
  if (normalizedRole === 'owner') {
    const all = await getPermissionCatalog(db);
    return all.map((row) => row.permission_key);
  }
  const rows = await dbAll(
    db,
    'SELECT permission_key FROM role_permissions WHERE salon_id = ? AND role_key = ? ORDER BY permission_key',
    [salonId, normalizedRole]
  );
  const permissions = new Set(rows.map((row) => cleanText(row.permission_key)).filter(Boolean));
  if (normalizedRole === 'admin') {
    ADMIN_PERMISSION_FALLBACK.forEach((permission) => permissions.add(permission));
  }
  return [...permissions];
}

export async function getAccountPermissionBundle(db, salonId, account) {
  const rolePermissions = await getRolePermissions(db, salonId, account?.primary_role);
  const directRows = await dbAll(
    db,
    'SELECT permission_key, effect FROM user_permissions WHERE salon_id = ? AND user_id = ? ORDER BY permission_key',
    [salonId, account?.id || '']
  );
  const allow = directRows
    .filter((row) => row.effect === 'allow')
    .map((row) => cleanText(row.permission_key))
    .filter(Boolean);
  const deny = directRows
    .filter((row) => row.effect === 'deny')
    .map((row) => cleanText(row.permission_key))
    .filter(Boolean);
  if (normalizeAccountRole(account?.primary_role, 'guest') === 'owner') {
    return {
      rolePermissions,
      allowedPermissions: allow,
      deniedPermissions: deny,
      effectivePermissions: rolePermissions,
    };
  }
  const effective = new Set(rolePermissions);
  allow.forEach((permission) => effective.add(permission));
  deny.forEach((permission) => effective.delete(permission));
  return {
    rolePermissions,
    allowedPermissions: allow,
    deniedPermissions: deny,
    effectivePermissions: [...effective].sort(),
  };
}

export async function getEffectivePermissions(db, salonId, account) {
  return (await getAccountPermissionBundle(db, salonId, account)).effectivePermissions;
}

export async function touchAccountLogin(db, accountId) {
  if (!accountId) return;
  const now = nowIso();
  await dbRun(db, 'UPDATE app_users SET last_login_at = ?, updated_at = ? WHERE id = ?', [now, now, accountId]);
}

export function assertAccountCanAuthenticate(account) {
  if (!account) throw new AppError(403, 'ACCOUNT_NOT_PROVISIONED');
  const status = resolveAccountStatus(account);
  if (status === 'disabled') throw new AppError(403, 'ACCOUNT_DISABLED');
  if (status === 'pending') throw new AppError(403, 'ACCOUNT_PENDING');
  if (status === 'deleted' || account.deleted_at) throw new AppError(403, 'ACCOUNT_DELETED');
}

export function serializeEmployeeLink(link) {
  if (!link) return null;
  return {
    id: link.id,
    userId: link.user_id,
    employeeId: link.employee_id,
    status: link.link_status,
    linkedAt: link.linked_at,
    updatedAt: link.updated_at,
    unlinkedAt: link.unlinked_at,
    employee: link.employee_id
      ? {
          id: link.employee_id,
          name: link.employee_name || '',
          email: link.employee_email || '',
          phone: link.employee_phone || '',
        }
      : null,
  };
}

export function serializeAccount(row, permissionBundle = null, link = null) {
  const status = resolveAccountStatus(row);
  return {
    id: row.id,
    uid: row.firebase_uid || '',
    firebaseUid: row.firebase_uid || '',
    salonId: row.salon_id,
    email: row.email || '',
    phone: row.phone || '',
    displayName: row.display_name || '',
    primaryRole: row.primary_role,
    role: row.primary_role,
    status,
    active: status === 'active' && !row.deleted_at,
    emailVerified: Number(row.email_verified || 0) === 1,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    legacySource: row.legacy_source || '',
    legacyId: row.legacy_id || '',
    ...(permissionBundle
      ? {
          rolePermissions: permissionBundle.rolePermissions,
          allowedPermissions: permissionBundle.allowedPermissions,
          deniedPermissions: permissionBundle.deniedPermissions,
          permissions: permissionBundle.effectivePermissions,
          effectivePermissions: permissionBundle.effectivePermissions,
        }
      : {}),
    ...(link !== undefined ? { employeeLink: serializeEmployeeLink(link) } : {}),
  };
}

export async function serializeAuthMe(db, salonId, account) {
  const [permissionBundle, link, roles] = await Promise.all([
    getAccountPermissionBundle(db, salonId, account),
    getActiveEmployeeLink(db, salonId, account.id),
    getRoleCatalog(db, salonId),
  ]);
  return {
    user: serializeAccount(account, permissionBundle, link),
    roles: roles.map((role) => role.role_key),
    permissions: permissionBundle.effectivePermissions,
    employeeLink: serializeEmployeeLink(link),
  };
}

export function hasPermission(ctx, permission) {
  const role = normalizeAccountRole(ctx?.role || ctx?.user?.primary_role, 'guest');
  if (role === 'owner') return true;
  if (role === 'admin' && ADMIN_PERMISSION_FALLBACK.has(cleanText(permission))) return true;
  return new Set(ctx?.permissions || []).has(permission);
}

export function requirePermission(ctx, permission) {
  if (!hasPermission(ctx, permission)) {
    throw new AppError(403, 'core_auth:missing_permission', `Missing permission: ${permission}`);
  }
}

export function requireAnyPermission(ctx, permissions) {
  if (!permissions?.length || permissions.some((permission) => hasPermission(ctx, permission))) return;
  throw new AppError(403, 'core_auth:missing_permission', `Missing one of: ${permissions.join(', ')}`);
}

function protectOwnerTarget(actor, target, action) {
  if (!isOwner(target)) return;
  if (actor?.role === 'owner') return;
  throw new AppError(403, 'ACCOUNT_OWNER_PROTECTED', `Cannot ${action} an owner account`);
}

async function assertNotLastOwner(db, salonId, target, nextStatus = target?.status, nextRole = target?.primary_role) {
  const removingOwner =
    isOwner(target) &&
    (normalizeAccountRole(nextRole, 'guest') !== 'owner' || nextStatus !== 'active' || target.deleted_at);
  if (!removingOwner) return;
  const row = await dbFirst(
    db,
    `SELECT COUNT(*) AS count
       FROM app_users
      WHERE salon_id = ? AND primary_role = 'owner' AND status = 'active' AND deleted_at IS NULL AND id <> ?`,
    [salonId, target.id]
  );
  if (Number(row?.count || 0) < 1) throw new AppError(409, 'ACCOUNT_LAST_OWNER_PROTECTED');
}

function assertActorCanAssignRole(actor, target, nextRole) {
  const role = normalizeAccountRole(nextRole, 'guest');
  if (actor?.role === 'owner') return;
  if (role === 'owner') throw new AppError(403, 'ACCOUNT_ROLE_ASSIGN_FORBIDDEN');
  if (target && isOwner(target)) throw new AppError(403, 'ACCOUNT_OWNER_PROTECTED');
  if (roleRank(role) >= roleRank(actor?.role)) throw new AppError(403, 'ACCOUNT_ROLE_ASSIGN_FORBIDDEN');
}

async function accountBeforeBundle(db, salonId, target) {
  return serializeAccount(target, await getAccountPermissionBundle(db, salonId, target), await getActiveEmployeeLink(db, salonId, target.id));
}

export async function listAccounts(db, salonId, query = {}) {
  const includeDeleted = cleanText(query.includeDeleted || query.include_deleted).toLowerCase() === 'true';
  const scope = cleanText(query.scope).toLowerCase();
  const internalOnly = scope === 'internal';
  const rows = await dbAll(
    db,
    `SELECT * FROM app_users
      WHERE salon_id = ?
        ${includeDeleted ? '' : "AND status <> 'deleted' AND deleted_at IS NULL"}
        ${internalOnly ? "AND primary_role NOT IN ('client', 'guest')" : ''}
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'disabled' THEN 2 ELSE 3 END,
        display_name COLLATE NOCASE,
        email COLLATE NOCASE`,
    [salonId]
  );
  return Promise.all(rows.map(async (row) => {
    const [bundle, link] = await Promise.all([
      getAccountPermissionBundle(db, salonId, row),
      getActiveEmployeeLink(db, salonId, row.id),
    ]);
    return serializeAccount(row, bundle, link);
  }));
}

export async function getAccountDetail(db, salonId, id) {
  const account = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, account);
  return accountBeforeBundle(db, salonId, account);
}

export async function createAccount(db, salonId, data = {}, actor = {}) {
  const now = nowIso();
  const role = normalizeAccountRole(data.primaryRole || data.role, 'pending');
  const status = normalizeStatus(data.status, role === 'pending' ? 'pending' : 'active');
  assertActorCanAssignRole(actor, null, role);

  const firebaseUid = optionalText(data.firebaseUid || data.firebase_uid || data.uid) || null;
  const email = normalizeEmail(data.email);
  if (!firebaseUid && !email) throw new AppError(400, 'ACCOUNT_IDENTIFIER_REQUIRED');
  if (status === 'active' && !firebaseUid) throw new AppError(400, 'ACCOUNT_FIREBASE_UID_REQUIRED');

  const existing = firebaseUid
    ? await getAccountByFirebaseUid(db, salonId, firebaseUid)
    : await dbFirst(db, 'SELECT * FROM app_users WHERE salon_id = ? AND email = ? LIMIT 1', [salonId, email]);
  if (existing && existing.status !== 'deleted') throw new AppError(409, 'ACCOUNT_ALREADY_EXISTS');

  const row = {
    id: requiredId(data.id || generatedId('user'), 'accountId'),
    firebase_uid: firebaseUid,
    salon_id: salonId,
    email,
    phone: optionalText(data.phone) || null,
    display_name: optionalText(data.displayName || data.display_name || data.name) || email || firebaseUid,
    primary_role: role,
    status,
    email_verified: boolInt(data.emailVerified || data.email_verified, 0),
    last_login_at: null,
    created_at: now,
    updated_at: now,
    deleted_at: status === 'deleted' ? now : null,
    legacy_source: optionalText(data.legacySource || data.legacy_source) || null,
    legacy_id: optionalText(data.legacyId || data.legacy_id) || null,
  };

  await dbRun(
    db,
    `INSERT INTO app_users
      (id, firebase_uid, salon_id, email, phone, display_name, primary_role, status,
       email_verified, last_login_at, created_at, updated_at, deleted_at, legacy_source, legacy_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.firebase_uid,
      row.salon_id,
      row.email,
      row.phone,
      row.display_name,
      row.primary_role,
      row.status,
      row.email_verified,
      row.last_login_at,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.legacy_source,
      row.legacy_id,
    ]
  );
  const created = await getAccountById(db, salonId, row.id);
  await recordAudit(db, salonId, {
    action: 'account_created',
    entityType: 'app_user',
    entityId: created.id,
    targetUserId: created.id,
    after: serializeAccount(created),
  }, actorInfo(actor));
  return accountBeforeBundle(db, salonId, created);
}

export async function updateAccount(db, salonId, id, data = {}, actor = {}) {
  const target = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, target);
  protectOwnerTarget(actor, target, 'modify');
  const before = await accountBeforeBundle(db, salonId, target);

  const nextRole = data.primaryRole !== undefined || data.role !== undefined
    ? normalizeAccountRole(data.primaryRole || data.role, target.primary_role)
    : target.primary_role;
  if (nextRole !== target.primary_role) assertActorCanAssignRole(actor, target, nextRole);

  const nextStatus = data.status !== undefined ? normalizeStatus(data.status, target.status) : target.status;
  const nextFirebaseUid =
    data.firebaseUid !== undefined || data.firebase_uid !== undefined || data.uid !== undefined
      ? optionalText(data.firebaseUid || data.firebase_uid || data.uid) || null
      : target.firebase_uid;
  if (nextStatus === 'active' && !nextFirebaseUid) throw new AppError(400, 'ACCOUNT_FIREBASE_UID_REQUIRED');
  await assertNotLastOwner(db, salonId, target, nextStatus, nextRole);

  const fields = [];
  const params = [];
  const add = (column, value) => {
    fields.push(`${column} = ?`);
    params.push(value);
  };
  if (data.firebaseUid !== undefined || data.firebase_uid !== undefined || data.uid !== undefined) {
    const uid = optionalText(data.firebaseUid || data.firebase_uid || data.uid) || null;
    if (uid && uid !== target.firebase_uid) {
      const existingUid = await getAccountByFirebaseUid(db, salonId, uid);
      if (existingUid && existingUid.id !== target.id) throw new AppError(409, 'ACCOUNT_UID_CONFLICT');
    }
    add('firebase_uid', uid);
  }
  if (data.email !== undefined) add('email', normalizeEmail(data.email) || null);
  if (data.phone !== undefined) add('phone', optionalText(data.phone) || null);
  if (data.displayName !== undefined || data.display_name !== undefined || data.name !== undefined) {
    add('display_name', optionalText(data.displayName || data.display_name || data.name) || null);
  }
  if (nextRole !== target.primary_role) add('primary_role', nextRole);
  if (nextStatus !== target.status) {
    add('status', nextStatus);
    add('deleted_at', nextStatus === 'deleted' ? nowIso() : null);
  }
  if (data.emailVerified !== undefined || data.email_verified !== undefined) {
    add('email_verified', boolInt(data.emailVerified || data.email_verified, target.email_verified));
  }

  if (fields.length) {
    params.push(nowIso(), salonId, target.id);
    await dbRun(
      db,
      `UPDATE app_users SET ${fields.join(', ')}, updated_at = ? WHERE salon_id = ? AND id = ?`,
      params
    );
  }
  const updated = await getAccountById(db, salonId, target.id);
  const after = await accountBeforeBundle(db, salonId, updated);
  await recordAudit(db, salonId, {
    action: 'account_updated',
    entityType: 'app_user',
    entityId: updated.id,
    targetUserId: updated.id,
    before,
    after,
  }, actorInfo(actor));
  return after;
}

export async function disableAccount(db, salonId, id, actor = {}) {
  const target = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, target);
  protectOwnerTarget(actor, target, 'disable');
  await assertNotLastOwner(db, salonId, target, 'disabled', target.primary_role);
  return updateAccount(db, salonId, id, { status: 'disabled' }, actor);
}

export async function restoreAccount(db, salonId, id, actor = {}) {
  const target = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, target);
  protectOwnerTarget(actor, target, 'restore');
  return updateAccount(db, salonId, id, { status: 'active' }, actor);
}

export async function deleteAccount(db, salonId, id, actor = {}) {
  const target = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, target);
  protectOwnerTarget(actor, target, 'delete');
  await assertNotLastOwner(db, salonId, target, 'deleted', target.primary_role);
  return updateAccount(db, salonId, id, { status: 'deleted' }, actor);
}

async function validatePermissions(db, permissions) {
  const known = await knownPermissionSet(db);
  const unknown = uniqueTexts(permissions).filter((permission) => !known.has(permission));
  if (unknown.length) throw new AppError(400, 'ACCOUNT_UNKNOWN_PERMISSIONS', unknown.join(', '));
}

export async function replaceAccountPermissions(db, salonId, id, data = {}, actor = {}) {
  const target = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, target);
  protectOwnerTarget(actor, target, 'modify permissions for');
  if (actor?.user?.id === target.id && actor?.role !== 'owner') {
    throw new AppError(403, 'ACCOUNT_SELF_PERMISSION_CHANGE_FORBIDDEN');
  }

  const before = await accountBeforeBundle(db, salonId, target);
  const rolePermissions = new Set(await getRolePermissions(db, salonId, target.primary_role));
  const hasEffective =
    Array.isArray(data.permissions) ||
    Array.isArray(data.effectivePermissions) ||
    Array.isArray(data.effective_permissions);
  let allow = [];
  let deny = [];
  if (hasEffective) {
    const desired = new Set(uniqueTexts(data.permissions || data.effectivePermissions || data.effective_permissions));
    allow = [...desired].filter((permission) => !rolePermissions.has(permission));
    deny = [...rolePermissions].filter((permission) => !desired.has(permission));
  } else {
    allow = uniqueTexts(data.allow || data.allowedPermissions || data.allowed_permissions);
    deny = uniqueTexts(data.deny || data.deniedPermissions || data.denied_permissions);
  }

  await validatePermissions(db, [...allow, ...deny]);
  const actorPermissionSet = new Set(actor?.permissions || []);
  if (actor?.role !== 'owner') {
    const forbiddenGrant = allow.find((permission) => !actorPermissionSet.has(permission));
    if (forbiddenGrant) throw new AppError(403, 'ACCOUNT_PERMISSION_GRANT_FORBIDDEN', forbiddenGrant);
  }

  const now = nowIso();
  const statements = [
    { sql: 'DELETE FROM user_permissions WHERE salon_id = ? AND user_id = ?', params: [salonId, target.id] },
  ];
  for (const permission of allow) {
    statements.push({
      sql: `INSERT INTO user_permissions
        (id, salon_id, user_id, permission_key, effect, reason, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'allow', ?, ?, ?, ?)`,
      params: [
        generatedId('perm'),
        salonId,
        target.id,
        permission,
        optionalText(data.reason) || null,
        actor?.user?.id || null,
        now,
        now,
      ],
    });
  }
  for (const permission of deny) {
    statements.push({
      sql: `INSERT INTO user_permissions
        (id, salon_id, user_id, permission_key, effect, reason, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'deny', ?, ?, ?, ?)`,
      params: [
        generatedId('perm'),
        salonId,
        target.id,
        permission,
        optionalText(data.reason) || null,
        actor?.user?.id || null,
        now,
        now,
      ],
    });
  }

  const { statement } = auditInsertStatement(salonId, {
    action: 'account_permissions_replaced',
    entityType: 'app_user',
    entityId: target.id,
    targetUserId: target.id,
    before,
    after: { allow, deny },
  }, actorInfo(actor));
  statements.push(statement);
  await dbBatch(db, statements);
  const updated = await getAccountById(db, salonId, target.id);
  return accountBeforeBundle(db, salonId, updated);
}

async function findEmployee(db, salonId, employeeId) {
  const id = requiredId(employeeId, 'employeeId');
  const profile = await dbFirst(db, 'SELECT id, name, email, phone_normalized FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (profile) return profile;
  const staff = await dbFirst(db, 'SELECT id, name, NULL AS email, phone_normalized FROM staff WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (staff) return staff;
  throw new AppError(404, 'EMPLOYEE_NOT_FOUND');
}

export async function replaceEmployeeLink(db, salonId, id, data = {}, actor = {}) {
  const target = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, target);
  protectOwnerTarget(actor, target, 'change employee link for');
  const employee = await findEmployee(db, salonId, data.employeeId || data.employee_id);
  const before = await accountBeforeBundle(db, salonId, target);
  const now = nowIso();
  const linkId = requiredId(data.id || generatedId('link'), 'linkId');
  const statements = [
    {
      sql: `UPDATE user_employee_links
              SET link_status = 'unlinked', unlinked_at = ?, updated_at = ?
            WHERE salon_id = ? AND user_id = ? AND link_status = 'active'`,
      params: [now, now, salonId, target.id],
    },
    {
      sql: `UPDATE user_employee_links
              SET link_status = 'unlinked', unlinked_at = ?, updated_at = ?
            WHERE salon_id = ? AND employee_id = ? AND link_status = 'active'`,
      params: [now, now, salonId, employee.id],
    },
    {
      sql: `INSERT INTO user_employee_links
        (id, salon_id, user_id, employee_id, link_status, linked_by_user_id, linked_at, updated_at,
         unlinked_at, legacy_source, legacy_id)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          employee_id = excluded.employee_id,
          link_status = 'active',
          linked_by_user_id = excluded.linked_by_user_id,
          linked_at = excluded.linked_at,
          updated_at = excluded.updated_at,
          unlinked_at = NULL`,
      params: [
        linkId,
        salonId,
        target.id,
        employee.id,
        actor?.user?.id || null,
        now,
        now,
        optionalText(data.legacySource || data.legacy_source) || null,
        optionalText(data.legacyId || data.legacy_id) || null,
      ],
    },
  ];
  const { statement } = auditInsertStatement(salonId, {
    action: 'account_employee_link_replaced',
    entityType: 'user_employee_link',
    entityId: linkId,
    targetUserId: target.id,
    before,
    after: { userId: target.id, employeeId: employee.id },
  }, actorInfo(actor));
  statements.push(statement);
  await dbBatch(db, statements);
  return getActiveEmployeeLink(db, salonId, target.id).then(serializeEmployeeLink);
}

export async function deleteEmployeeLink(db, salonId, id, actor = {}) {
  const target = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, target);
  protectOwnerTarget(actor, target, 'unlink employee for');
  const before = await getActiveEmployeeLink(db, salonId, target.id);
  if (!before) return null;
  const now = nowIso();
  await dbRun(
    db,
    `UPDATE user_employee_links
        SET link_status = 'unlinked', unlinked_at = ?, updated_at = ?
      WHERE salon_id = ? AND id = ?`,
    [now, now, salonId, before.id]
  );
  await recordAudit(db, salonId, {
    action: 'account_employee_link_deleted',
    entityType: 'user_employee_link',
    entityId: before.id,
    targetUserId: target.id,
    before: serializeEmployeeLink(before),
    after: null,
  }, actorInfo(actor));
  return null;
}

export async function sendPasswordReset(db, salonId, id, env, actor = {}) {
  const target = await getAccountById(db, salonId, id);
  assertSameSalon(salonId, target);
  protectOwnerTarget(actor, target, 'reset password for');
  const email = normalizeEmail(target.email);
  if (!email) throw new AppError(400, 'ACCOUNT_EMAIL_REQUIRED');
  const apiKey = cleanText(env.FIREBASE_WEB_API_KEY || env.FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY);
  if (!apiKey) {
    await recordAudit(db, salonId, {
      action: 'account_password_reset_failed',
      entityType: 'app_user',
      entityId: target.id,
      targetUserId: target.id,
      meta: { reason: 'firebase_api_key_not_configured' },
    }, actorInfo(actor));
    throw new AppError(503, 'FIREBASE_RESET_NOT_CONFIGURED');
  }
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await recordAudit(db, salonId, {
      action: 'account_password_reset_failed',
      entityType: 'app_user',
      entityId: target.id,
      targetUserId: target.id,
      meta: { reason: payload?.error?.message || response.status },
    }, actorInfo(actor));
    throw new AppError(502, 'FIREBASE_RESET_FAILED');
  }
  await recordAudit(db, salonId, {
    action: 'account_password_reset_sent',
    entityType: 'app_user',
    entityId: target.id,
    targetUserId: target.id,
    after: { email },
  }, actorInfo(actor));
  return { sent: true, email };
}

export async function ensureRolePermissionSeedVisible(db, salonId) {
  const row = await dbFirst(db, 'SELECT COUNT(*) AS count FROM permissions', []);
  if (Number(row?.count || 0) < 1) throw new AppError(503, 'ACCOUNT_PERMISSION_SCHEMA_MISSING');
  const role = await dbFirst(db, 'SELECT role_key FROM roles WHERE salon_id = ? LIMIT 1', [salonId]);
  if (!role) throw new AppError(503, 'ACCOUNT_ROLE_SCHEMA_MISSING');
}
