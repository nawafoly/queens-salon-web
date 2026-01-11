// src/services/userProfile.ts
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
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

  createdAt?: any;
  updatedAt?: any;
};

const SALON_ID = "main";

// ✅ salons/main/users/{uid} (Source of Truth)
function salonUserRef(uid: string) {
  return doc(db, "salons", SALON_ID, "users", uid);
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

  // ✅ أي قيمة غير معروفة = guest (أمان)
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

/**
 * ✅ createOrLoadUserProfile (FINAL ✅)
 * - Source of Truth: salons/main/users/{uid}
 * - Bootstrap Admin safety: nawafaaa0@gmail.com / nawafaaa6@gmail.com
 * - If missing doc:
 *    - bootstrap => admin
 *    - otherwise => client (AUTO ✅)
 * - ROOT users/{uid}: optional mirror فقط (لا يعتمد عليه للـ role)
 */
export async function createOrLoadUserProfile(user: User): Promise<UserProfile> {
  const uid = user.uid;

  const authEmail = safeStr(user.email).trim();
  const authDisplayName = safeStr(user.displayName).trim();

  const refSalon = salonUserRef(uid);
  const snapSalon = await getDoc(refSalon);

  // ✅ 1) موجود في المسار المعتمد (لا تغيّر role)
  if (snapSalon.exists()) {
    const data = snapSalon.data() as any;
    const role = normalizeRole(data?.role);

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
      membershipId: safeStr(data?.membershipId),
      membershipPercent:
        typeof data?.membershipPercent === "number" ? data.membershipPercent : 0,
      createdAt: data?.createdAt,
      updatedAt: data?.updatedAt,
    };

    // ✅ patch خفيف: فقط حقول ناقصة — بدون لمس role إذا موجود
    const patch: any = {};
    if (!safeStr(data?.email) && authEmail) patch.email = authEmail;
    if (!safeStr(data?.name) || data?.name === "مستخدم") patch.name = name;
    if (!safeStr(data?.displayName) || data?.displayName === "مستخدم") patch.displayName = name;

    // ⚠️ role: فقط لو ما كان موجود أصلاً
    if (!data?.role) patch.role = role;

    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp();
      await setDoc(refSalon, patch, { merge: true });
    }

    // ✅ (اختياري) mirror للـ ROOT للتوافق فقط بدون تغيير صلاحيات/role
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
    } catch {
      // تجاهل لو Rules تمنع
    }

    writeLocalCache(profile);
    return profile;
  }

  // ✅ 2) مفقود: أنشئ تلقائيًا حسب البريد (Bootstrap Admin Safety)
  const bootstrap = isBootstrapAdminEmail(authEmail);
  const role: UiRole = bootstrap ? "admin" : "client"; // ✅ AUTO client

  const name = authDisplayName || (bootstrap ? "مدير الصالون" : buildDefaultName(role));

  const membershipId =
    role === "client"
      ? `client-${new Date().getFullYear()}-${uid.slice(0, 6)}`
      : undefined;

  const profile: UserProfile = {
    uid,
    email: authEmail,
    name,
    phone: "",
    city: "",
    birthdate: "",
    role,
    membershipId,
    membershipPercent: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // ✅ اكتب في المسار المعتمد فقط
  await setDoc(
    refSalon,
    {
      ...stripUndefined(profile as any),
      displayName: name,
    },
    { merge: true }
  );

  // ✅ (اختياري) mirror للـ ROOT للتوافق فقط
  try {
    await setDoc(
      rootUserRef(uid),
      {
        uid,
        email: authEmail,
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
 * ✅ updateUserProfile (FINAL ✅)
 * - يحدث فقط في salons/main/users/{uid} (Source of Truth)
 * - ❌ ممنوع تعديل role من هنا (أمان)
 * - ويعمل mirror للـ ROOT (اختياري) بدون ما يلمس role
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
  const refSalon = salonUserRef(uid);

  const cleaned: any = {};
  Object.entries(updates).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") return;

    // ✅ أمان: لا تسمح بتغيير role من تحديثات العميلة
    if (k === "role") return;

    cleaned[k] = v;
  });

  cleaned.updatedAt = serverTimestamp();
  await setDoc(refSalon, cleaned, { merge: true });

  // ✅ mirror اختياري (بدون role)
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

  // ✅ حدّث الكاش المحلي
  try {
    const current = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    const merged = { ...(current || {}), ...updates, uid };

    // ✅ تأكيد: ما نغيّر role في الكاش من update
    if (merged?.role && updates?.role) {
      merged.role = current?.role || merged.role;
    }

    localStorage.setItem("user_profile_v1", JSON.stringify(merged));
    if (merged?.name) localStorage.setItem("userName", String(merged.name));
    if (merged?.role) localStorage.setItem("userRole", String(merged.role));
    if (merged?.email) localStorage.setItem("userEmail", String(merged.email));
    window.dispatchEvent(new Event("authChanged"));
  } catch {}
}

export function canAccessDashboard(role: UiRole): boolean {
  return role === "owner" || role === "admin" || role === "reception" || role === "staff";
}

// ✅ DEV ONLY: quick whoami to verify Firestore role (Source of Truth)
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
