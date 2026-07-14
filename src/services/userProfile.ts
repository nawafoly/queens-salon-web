// src/services/userProfile.ts
import type { User } from "firebase/auth";
import { getAuth } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "./firebase";
import { writeAuditLog } from "./logService";
import { normalizeAuthRole } from "./authAccess";
import { writeStoredAuthSession } from "./localAuthSession";
import {
  buildPermissionOverrides,
  PERMISSION_SCHEMA_VERSION,
  getEffectiveAppPermissions,
  getRoleAppPermissions,
  normalizePermissionOverrides,
  type AppPermission,
  type PermissionOverrides,
} from "../helpers/permissions";

export type UiRole =
  | "owner"
  | "admin"
  | "hr"
  | "reception"
  | "staff"
  | "client"
  | "pending"
  | "guest";

export type UserProfile = {
  uid: string;
  email: string;
  name: string;
  phone: string;
  city: string;
  birthdate: string;
  avatarUrl?: string;
  clientId?: string;

  role: UiRole;

  membershipId?: string;
  membershipPercent?: number;

  active?: boolean;
  permissions?: AppPermission[];
  permissionOverrides?: PermissionOverrides;
  permissionVersion?: number;

  createdAt?: any;
  updatedAt?: any;
};

const SALON_ID = "main";

// ✅ salons/main/users/{uid} (Source of Truth)
function salonUserRef(uid: string) {
  return doc(db, "salons", SALON_ID, "users", uid);
}

// ✅ salons/main/user_invites (Invite SoT)
function invitesCol() {
  return collection(db, "salons", SALON_ID, "user_invites");
}

// (اختياري: توافق فقط - لا نعتمد عليه لتحديد role)
function rootUserRef(uid: string) {
  return doc(db, "users", uid);
}

function safeStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

function normalizeRole(roleRaw: unknown): UiRole {
  return normalizeAuthRole(roleRaw);
}

function buildDefaultName(role: UiRole) {
  if (role === "hr") return "Human Resources";
  if (role === "owner" || role === "admin") return "مدير الصالون";
  if (role === "reception" || role === "staff") return "موظفة";
  if (role === "client") return "عميلة";
  if (role === "pending") return "حساب إداري (بانتظار التفعيل)";
  return "مستخدم";
}

function buildPersistedDefaultName(role: UiRole) {
  // Avoid persisting a generic placeholder for clients.
  if (role === "client") return "";
  return buildDefaultName(role);
}

function isPlaceholderName(name: string, role: UiRole) {
  const n = String(name || "").trim();
  if (!n) return true;

  const defaults = new Set<string>([
    "مستخدم",
    "عميلة",
    "موظفة",
    "مدير الصالون",
    "حساب إداري (بانتظار التفعيل)",
    buildDefaultName(role),
  ]);

  return defaults.has(n);
}


function writeLocalCache(profile: UserProfile) {
  writeStoredAuthSession({
    uid: profile.uid,
    email: profile.email,
    role: profile.role,
    displayName: profile.name,
    phone: profile.phone,
    active: profile.active,
    permissions: profile.permissions,
    permissionOverrides: profile.permissionOverrides,
    permissionVersion: profile.permissionVersion,
    profile: profile as Record<string, any>,
  });
}

function stripUndefined(obj: Record<string, any>) {
  const out: Record<string, any> = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined) return;
    out[k] = v;
  });
  return out;
}

type InviteDoc = {
  email?: string;
  role?: string;
  active?: boolean;
  permissions?: unknown;
  permissionOverrides?: unknown;
  createdAt?: any;

  // tracking
  used?: boolean;
  usedAt?: any;
  usedByUid?: string;
};

/**
 * ✅ يبحث عن دعوة بناء على الإيميل (case-insensitive)
 * ويعيد أول دعوة غير مستخدمة إن وجدت
 */
async function findInviteByEmail(emailLower: string) {
  const email = String(emailLower || "").toLowerCase().trim();
  if (!email) return null;

  const q = query(invitesCol(), where("email", "==", email), limit(1));
  const snap = await getDocs(q);

  const d = snap.docs[0];
  if (!d) return null;

  const data = d.data() as InviteDoc;
  if (data?.used === true) return null;

  return { id: d.id, data };
}

/**
 * ✅ يطبّق الدعوة على users/{uid} ويعلّمها used
 */
async function consumeInvite(params: {
  inviteId: string;
  uid: string;
  emailLower: string;
}) {
  const { inviteId, uid, emailLower } = params;

  try {
    await setDoc(
      doc(db, "salons", SALON_ID, "user_invites", inviteId),
      {
        used: true,
        usedAt: serverTimestamp(),
        usedByUid: uid,
        usedByEmail: emailLower,
      },
      { merge: true }
    );
  } catch {
    // تجاهل (لو rules تمنع) لأن الأهم هو users doc
  }
}

/**
 * ✅ createOrLoadUserProfile (FINAL ✅ + Invites ✅)
 * - Source of Truth: salons/main/users/{uid}
 * - If missing users doc:
 *    1) إن وجد invite بالإيميل => role/active منها
 *    2) غير ذلك => client (AUTO)
 * - ROOT users/{uid}: optional mirror فقط (لا يعتمد عليه للـ role)
 *
 * ✅ FIX المطلوب:
 * - createdAt يثبت وقت الإنشاء فقط
 * - إذا doc موجود لكن createdAt ناقص (حسابات قديمة) نكتبه مرة واحدة فقط
 */
export async function createOrLoadUserProfile(user: User): Promise<UserProfile> {
  const uid = user.uid;

  const authEmail = safeStr(user.email).trim();
  const emailLower = authEmail.toLowerCase();

  const authDisplayName = safeStr(user.displayName).trim();

  const refSalon = salonUserRef(uid);
  const snapSalon = await getDoc(refSalon);

  // ✅ 1) موجود: الدور والتفعيل يأتيان من وثيقة المستخدم فقط.
  if (snapSalon.exists()) {
    const data = snapSalon.data() as any;

    const active = data?.active !== false && data?.isActive !== false;
    const role = normalizeRole(data?.role);
    const permissionOverrides = normalizePermissionOverrides(data?.permissionOverrides);
    const permissions = getEffectiveAppPermissions({
      role,
      permissions: data?.permissions,
      permissionOverrides,
      permissionVersion: data?.permissionVersion,
    });

    const dataName = safeStr(data?.name).trim();
    const dataDisplayName = safeStr(data?.displayName).trim();
    const storedNameCandidate = dataName || dataDisplayName;

    let name =
      storedNameCandidate ||
      authDisplayName ||
      buildPersistedDefaultName(role);

    // لو الاسم الموجود في الدوك افتراضي وعندنا displayName من Auth، خذ اسم Auth
    if (authDisplayName && isPlaceholderName(storedNameCandidate, role)) {
      name = authDisplayName;
    }
    if (role === "client" && !authDisplayName && isPlaceholderName(name, role)) {
      name = "";
    }


    if ((role === "owner" || role === "admin") && (!name || name === "مستخدم")) {
      name = "مدير الصالون";
    }

    const profile: UserProfile = {
      uid,
      email: safeStr(data?.email) || authEmail,
      name,
      phone: safeStr(data?.phone),
      city: safeStr(data?.city),
      birthdate: safeStr(data?.birthdate),
      avatarUrl: safeStr(data?.avatarUrl),
      clientId: safeStr(data?.clientId) || undefined,
      role,
      active,
      permissions,
      permissionOverrides,
      permissionVersion: PERMISSION_SCHEMA_VERSION,
      membershipId: safeStr(data?.membershipId),
      membershipPercent:
        typeof data?.membershipPercent === "number" ? data.membershipPercent : 0,
      createdAt: data?.createdAt,
      updatedAt: data?.updatedAt,
    };

    // ✅ patch خفيف: فقط حقول ناقصة
    // IMPORTANT: do not mutate role/active here for non-bootstrap users
    // because rules block self privilege changes by design.
    const patch: any = {};
    if (!safeStr(data?.email) && authEmail) patch.email = authEmail;
    const storedName = safeStr(data?.name).trim();
    const storedDisplayName = safeStr(data?.displayName).trim();
    
    if (authDisplayName && isPlaceholderName(storedName, role)) patch.name = name;
    if (authDisplayName && isPlaceholderName(storedDisplayName, role)) patch.displayName = name;
    
    // لو كانت فاضية تمامًا
    if (!storedName && name) patch.name = name;
    if (!storedDisplayName && name) patch.displayName = name;
    

    // ✅ FIX: لو createdAt ناقص (حساب قديم) نكتبه مرة وحدة فقط
    if (!data?.createdAt) patch.createdAt = serverTimestamp();

    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp(); // ✅ فقط updatedAt يتغير كل مرة
      await setDoc(refSalon, patch, { merge: true });
    }

    // ✅ mirror للـ ROOT للتوافق فقط بدون تغيير صلاحيات/role
    try {
      await setDoc(
        rootUserRef(uid),
        {
          uid,
          email: profile.email,
          displayName: profile.name,
          name: profile.name,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch { }

    writeLocalCache(profile);
    return profile;
  }

  // ✅ 2) مفقود: نفحص الدعوة أولًا، وإلا ننشئ حساب عميل.
  let role: UiRole = "client";
  let active = true;

  let inviteId: string | null = null;
  let inviteData: InviteDoc | null = null;

  if (emailLower) {
    try {
      const invite = await findInviteByEmail(emailLower);
      if (invite) {
        inviteId = invite.id;
        inviteData = invite.data;
        const invRole = normalizeRole(inviteData?.role);
        if (invRole !== "guest") role = invRole;

        active = inviteData?.active !== false;

        // ✅ لو الدعوة غير مفعلة => Pending
        if (!active) role = "pending";
      }
    } catch {
      // ignore
    }
  }

  const name = authDisplayName || buildPersistedDefaultName(role);
  const permissionOverrides = normalizePermissionOverrides(inviteData?.permissionOverrides);
  const invitePermissions =
    inviteData
      ? getEffectiveAppPermissions({
          role,
          permissions: inviteData.permissions,
          permissionOverrides,
          permissionVersion: (inviteData as any)?.permissionVersion,
        })
      : [];
  const permissions = invitePermissions.length ? invitePermissions : getRoleAppPermissions(role);
  const finalPermissionOverrides = invitePermissions.length
    ? permissionOverrides
    : buildPermissionOverrides(role, permissions);

  const membershipId =
    role === "client"
      ? `client-${new Date().getFullYear()}-${uid.slice(0, 6)}`
      : undefined;

  const profile: UserProfile = {
    uid,
    email: emailLower,
    name,
    phone: "",
    city: "",
    birthdate: "",
    role,
    active,
    permissions,
    permissionOverrides: finalPermissionOverrides,
    permissionVersion: PERMISSION_SCHEMA_VERSION,
    membershipId,
    membershipPercent: 0,
    createdAt: serverTimestamp(), // ✅ وقت إنشاء الحساب فقط
    updatedAt: serverTimestamp(),
  };

  // ✅ اكتب في المسار المعتمد
  await setDoc(
    refSalon,
    {
      ...stripUndefined(profile as any),
      displayName: name,
    },
    { merge: true }
  );

  // ✅ علّم الدعوة used (لو كانت موجودة)
  if (inviteId) {
    await consumeInvite({ inviteId, uid, emailLower });
  }

  // ✅ mirror اختياري للـ ROOT
  try {
    await setDoc(
      rootUserRef(uid),
      {
        uid,
        email: emailLower,
        displayName: name,
        name,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch { }

  writeLocalCache(profile);
  return profile;
}

/**
 * ✅ updateUserProfile
 * - يحدث فقط في salons/main/users/{uid}
 * - ❌ ممنوع تعديل role/active/createdAt من هنا
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
  const refSalon = salonUserRef(uid);
  const beforeSnap = await getDoc(refSalon);
  const before = beforeSnap.exists() ? (beforeSnap.data() as any) : null;

  const cleaned: any = {};
  Object.entries(updates).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") return;

    // ✅ أمان: لا تسمح بتغيير role/active/createdAt من هنا
    if (k === "role") return;
    if (k === "active") return;
    if (k === "createdAt") return; // ✅ FIX

    cleaned[k] = v;
  });

  cleaned.updatedAt = serverTimestamp();
  await setDoc(refSalon, cleaned, { merge: true });

  try {
    await writeAuditLog({
      salonId: SALON_ID,
      action: "client_updated",
      entityType: "client",
      entityId: uid,
      description: "تم تعديل بروفايل العميلة",
      source: "client_app",
      before,
      after: cleaned,
      meta: {
        fields: Object.keys(cleaned).filter((k) => k !== "updatedAt"),
      },
    });
  } catch {
    // ignore
  }

  // ✅ mirror اختياري (بدون role/active/createdAt)
  try {
    const mirror: any = {};
    if (typeof cleaned.email === "string") mirror.email = cleaned.email;
    if (typeof cleaned.name === "string") {
      mirror.name = cleaned.name;
      mirror.displayName = cleaned.name;
    }
    mirror.updatedAt = serverTimestamp();

    if (Object.keys(mirror).length) {
      await setDoc(rootUserRef(uid), mirror, { merge: true });
    }
  } catch { }

  // ✅ تحديث الكاش المحلي عبر الكاتب المركزي فقط.
  try {
    const current = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    const merged = { ...(current || {}), ...updates, uid };

    // لا نغير role/active/createdAt في الكاش من updateUserProfile.
    if (current?.role) merged.role = current.role;
    if (typeof current?.active === "boolean") merged.active = current.active;
    if (current?.createdAt) merged.createdAt = current.createdAt;

    writeStoredAuthSession({
      uid,
      email: safeStr(merged?.email),
      role: normalizeRole(merged?.role),
      displayName: safeStr(merged?.name || merged?.displayName),
      phone: safeStr(merged?.phone),
      active: typeof merged?.active === "boolean" ? merged.active : undefined,
      permissions: Array.isArray(merged?.permissions) ? merged.permissions : undefined,
      permissionOverrides: normalizePermissionOverrides(merged?.permissionOverrides),
      permissionVersion: Number(merged?.permissionVersion || 0) || undefined,
      profile: merged,
    });
  } catch { }
}

export function canAccessDashboard(role: UiRole): boolean {
  return role === "owner" || role === "admin" || role === "hr" || role === "reception" || role === "staff";
}

// ✅ DEV ONLY: quick whoami
export async function debugWhoAmI() {
  try {
    const auth = getAuth();
    const u = auth.currentUser;

    if (!u) {
      console.log("❌ No auth user (currentUser is null)");
      return null;
    }

    const ref = salonUserRef(u.uid);
    const snap = await getDoc(ref);

    const data = snap.exists() ? (snap.data() as any) : null;

    console.log("✅ AUTH:", { uid: u.uid, email: u.email });
    console.log("✅ salons/main/users doc exists:", snap.exists());
    console.log("✅ salons/main/users data:", data);
    console.log("✅ normalized role:", normalizeRole(data?.role));
    console.log("✅ active:", data?.active !== false);

    return { uid: u.uid, email: u.email, data, role: normalizeRole(data?.role) };
  } catch (e) {
    console.error("❌ debugWhoAmI failed:", e);
    return null;
  }
}
