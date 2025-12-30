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

  // (اختياري) لو عندك active في البيانات
  active?: boolean;
};

const SALON_ID = "main";

// ✅ Bootstrap Admin (طوق أمان)
const BOOTSTRAP_EMAIL = "nawafaaa0@gmail.com";

// ✅ المصدر الوحيد المعتمد للرول
function salonUserRef(uid: string) {
  return doc(db, "salons", SALON_ID, "users", uid);
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

function isBootstrap(user: User) {
  return safeStr(user.email).toLowerCase().trim() === BOOTSTRAP_EMAIL;
}

/**
 * ✅ createOrLoadUserProfile (SOURCE OF TRUTH = salons/main/users/{uid})
 * - يقرأ فقط من salons/main/users/{uid}
 * - لو ما لقى: ينشئ guest هناك (بدون لمس ROOT)
 * - Bootstrap email: يفرض role=owner حتى لو الوثيقة غلط
 */
export async function createOrLoadUserProfile(user: User): Promise<UserProfile> {
  const uid = user.uid;
  const ref = salonUserRef(uid);

  const snap = await getDoc(ref);

  const authEmail = safeStr(user.email);
  const authDisplayName = safeStr(user.displayName);

  // ✅ لو الوثيقة موجودة
  if (snap.exists()) {
    const data = snap.data() as any;

    // ✅ Bootstrap override
    const role: UiRole = isBootstrap(user) ? "owner" : normalizeRole(data?.role);

    let name =
      safeStr(data?.name).trim() ||
      safeStr(data?.displayName).trim() ||
      authDisplayName.trim() ||
      buildDefaultName(role);

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
      active: typeof data?.active === "boolean" ? data.active : true,
      createdAt: data?.createdAt,
      updatedAt: data?.updatedAt,
    };

    // ✅ Patch خفيف لو ناقص/Bootstrap needs role fix
    const patch: any = {};
    if (!safeStr(data?.email) && authEmail) patch.email = authEmail;
    if (!safeStr(data?.name) && name) patch.name = name;
    if (!safeStr(data?.displayName) && name) patch.displayName = name;

    // ✅ لو Bootstrap أو role ناقص/غلط
    if (isBootstrap(user) && normalizeRole(data?.role) !== "owner") patch.role = "owner";
    if (!data?.role) patch.role = role;

    if (Object.keys(patch).length) {
      patch.updatedAt = serverTimestamp();
      await setDoc(ref, patch, { merge: true });
    }

    // ✅ كاش محلي موحد
    localStorage.setItem("user_profile_v1", JSON.stringify(profile));
    localStorage.setItem("userName", profile.name);
    localStorage.setItem("userRole", profile.role);
    if (profile.email) localStorage.setItem("userEmail", profile.email);
    window.dispatchEvent(new Event("authChanged"));

    return profile;
  }

  // ✅ لا توجد وثيقة: أنشئ guest في salons/main/users
  const role: UiRole = isBootstrap(user) ? "owner" : "guest";
  const name = authDisplayName.trim() || buildDefaultName(role);

  const profile: UserProfile = {
    uid,
    email: authEmail,
    name,
    phone: "",
    city: "",
    birthdate: "",
    role,
    membershipId: "",
    membershipPercent: 0,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(
    ref,
    {
      ...profile,
      displayName: name,
    },
    { merge: true }
  );

  localStorage.setItem("user_profile_v1", JSON.stringify(profile));
  localStorage.setItem("userName", profile.name);
  localStorage.setItem("userRole", profile.role);
  if (profile.email) localStorage.setItem("userEmail", profile.email);
  window.dispatchEvent(new Event("authChanged"));

  return profile;
}

/**
 * ✅ updateUserProfile
 * - يحدث فقط في salons/main/users/{uid}
 */
export async function updateUserProfile(
  uid: string,
  updates: Partial<UserProfile>
) {
  const ref = salonUserRef(uid);

  const cleaned: any = {};
  Object.entries(updates).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") return;
    cleaned[k] = v;
  });

  cleaned.updatedAt = serverTimestamp();
  await setDoc(ref, cleaned, { merge: true });

  // ✅ تحديث الكاش المحلي
  try {
    const current = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    const merged = { ...(current || {}), ...updates, uid };
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
