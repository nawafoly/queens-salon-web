// src/services/userProfile.ts
import type { User } from "firebase/auth";
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

export type UiRole =
  | "owner"
  | "admin"
  | "reception"
  | "staff"
  | "client"
  | "guest";

export type UserProfile = {
  uid: string;
  email: string;
  name: string;
  phone: string;
  city: string;
  birthdate: string;

  role: UiRole;

  membershipId?: string;
  membershipPercent?: number;

  active?: boolean;

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
  const r = String(roleRaw || "").toLowerCase().trim();

  if (r === "administrator") return "admin";
  if (r === "receptionist" || r === "frontdesk" || r === "desk") return "reception";

  if (
    r === "owner" ||
    r === "admin" ||
    r === "reception" ||
    r === "staff" ||
    r === "client" ||
    r === "guest"
  ) {
    return r as UiRole;
  }

  return "guest";
}

function buildDefaultName(role: UiRole) {
  if (role === "owner" || role === "admin") return "مدير الصالون";
  if (role === "reception" || role === "staff") return "موظفة";
  if (role === "client") return "عميلة";
  return "مستخدم";
}

function isBootstrapAdminEmail(email: string) {
  const e = String(email || "").toLowerCase().trim();
  return e === "nawafaaa0@gmail.com" || e === "nawafaaa6@gmail.com";
}

function writeLocalCache(profile: UserProfile) {
  localStorage.setItem("user_profile_v1", JSON.stringify(profile));
  localStorage.setItem("userName", profile.name);
  localStorage.setItem("userRole", profile.role);
  if (profile.email) localStorage.setItem("userEmail", profile.email);

  // ✅ مهم: auth_user يعتمد عليه App.tsx/Dashboard
  localStorage.setItem(
    "auth_user",
    JSON.stringify({
      uid: profile.uid,
      email: profile.email,
      role: profile.role,
      displayName: profile.name,
    })
  );

  window.dispatchEvent(new Event("authChanged"));
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
 * - Bootstrap Admin safety: nawafaaa0@gmail.com / nawafaaa6@gmail.com => owner
 * - If missing users doc:
 *    1) إن وجد invite بالإيميل => role/active منها
 *    2) غير ذلك => client (AUTO)
 * - ROOT users/{uid}: optional mirror فقط (لا يعتمد عليه للـ role)
 */
export async function createOrLoadUserProfile(user: User): Promise<UserProfile> {
  const uid = user.uid;

  const authEmail = safeStr(user.email).trim();
  const emailLower = authEmail.toLowerCase();

  const authDisplayName = safeStr(user.displayName).trim();

  const refSalon = salonUserRef(uid);
  const snapSalon = await getDoc(refSalon);

  const isBootstrap = isBootstrapAdminEmail(emailLower);

  // ✅ 1) موجود: نقرأه ونرجع بدون لعب (إلا bootstrap يفرض owner)
  if (snapSalon.exists()) {
    const data = snapSalon.data() as any;

    let role = normalizeRole(data?.role);
    if (isBootstrap) role = "owner";

    let name =
      safeStr(data?.name).trim() ||
      safeStr(data?.displayName).trim() ||
      authDisplayName ||
      buildDefaultName(role);

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
      role,
      active: data?.active !== false,
      membershipId: safeStr(data?.membershipId),
      membershipPercent:
        typeof data?.membershipPercent === "number" ? data.membershipPercent : 0,
      createdAt: data?.createdAt,
      updatedAt: data?.updatedAt,
    };

    // ✅ patch خفيف: فقط حقول ناقصة — ولا نغير role إلا bootstrap
    const patch: any = {};
    if (!safeStr(data?.email) && authEmail) patch.email = authEmail;
    if (!safeStr(data?.name) || data?.name === "مستخدم") patch.name = name;
    if (!safeStr(data?.displayName) || data?.displayName === "مستخدم") patch.displayName = name;

    // role: فقط لو ما كان موجود أو bootstrap يفرض owner
    if (!data?.role) patch.role = role;
    if (isBootstrap && String(data?.role || "").toLowerCase().trim() !== "owner") patch.role = "owner";

    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp();
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
    } catch {}

    writeLocalCache(profile);
    return profile;
  }

  // ✅ 2) مفقود: قبل ما نقول client… نفحص Invite بالإيميل
  let role: UiRole = isBootstrap ? "owner" : "client";
  let active = true;

  let inviteId: string | null = null;

  if (!isBootstrap && emailLower) {
    try {
      const invite = await findInviteByEmail(emailLower);
      if (invite) {
        inviteId = invite.id;
        const invRole = normalizeRole(invite.data?.role);
        if (invRole !== "guest") role = invRole;
        active = invite.data?.active !== false; // لو false => Pending
      }
    } catch {
      // ignore
    }
  }

  const name =
    authDisplayName ||
    (role === "owner" || role === "admin" ? "مدير الصالون" : buildDefaultName(role));

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
    membershipId,
    membershipPercent: 0,
    createdAt: serverTimestamp(),
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
  } catch {}

  writeLocalCache(profile);
  return profile;
}

/**
 * ✅ updateUserProfile
 * - يحدث فقط في salons/main/users/{uid}
 * - ❌ ممنوع تعديل role/active من هنا
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
  const refSalon = salonUserRef(uid);

  const cleaned: any = {};
  Object.entries(updates).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") return;

    // ✅ أمان: لا تسمح بتغيير role/active من هنا
    if (k === "role") return;
    if (k === "active") return;

    cleaned[k] = v;
  });

  cleaned.updatedAt = serverTimestamp();
  await setDoc(refSalon, cleaned, { merge: true });

  // ✅ mirror اختياري (بدون role/active)
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
  } catch {}

  // ✅ تحديث الكاش المحلي
  try {
    const current = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    const merged = { ...(current || {}), ...updates, uid };

    // ✅ تأكيد: ما نغير role/active في الكاش من update
    if (current?.role) merged.role = current.role;
    if (typeof current?.active === "boolean") merged.active = current.active;

    localStorage.setItem("user_profile_v1", JSON.stringify(merged));
    if (merged?.name) localStorage.setItem("userName", String(merged.name));
    if (merged?.role) localStorage.setItem("userRole", String(merged.role));
    if (merged?.email) localStorage.setItem("userEmail", String(merged.email));

    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        uid: merged.uid,
        email: merged.email,
        role: merged.role,
        displayName: merged.name,
      })
    );

    window.dispatchEvent(new Event("authChanged"));
  } catch {}
}

export function canAccessDashboard(role: UiRole): boolean {
  return role === "owner" || role === "admin" || role === "reception" || role === "staff";
}

// ✅ DEV ONLY: quick whoami
export async function debugWhoAmI() {
  try {
    const { getAuth } = await import("firebase/auth");
    const { getDoc } = await import("firebase/firestore");

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

    return { uid: u.uid, email: u.email, data, role: normalizeRole(data?.role) };
  } catch (e) {
    console.error("❌ debugWhoAmI failed:", e);
    return null;
  }
}
