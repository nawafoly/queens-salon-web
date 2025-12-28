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

// ✅ ROOT users/{uid}
function rootUserRef(uid: string) {
  return doc(db, "users", uid);
}

// ✅ salons/main/users/{uid}
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

  // ✅ بدل ما نرجّع client لأي شيء غريب، نخليه guest
  // (عشان ما ينقلب owner إلى client بسبب قيمة غير متوقعة)
  return "guest";
}

function buildDefaultName(role: UiRole) {
  if (role === "owner" || role === "admin") return "مدير الصالون";
  if (role === "reception" || role === "staff") return "موظفة";
  if (role === "client") return "عميلة";
  return "مستخدم";
}

/**
 * ✅ createOrLoadUserProfile
 * - يقرأ أولاً من users/{uid}
 * - ثم fallback إلى salons/main/users/{uid}
 * - إذا ما لقى الاثنين: ينشئ client في users/{uid}
 */
export async function createOrLoadUserProfile(user: User): Promise<UserProfile> {
  const uid = user.uid;

  const refRoot = rootUserRef(uid);
  const refSalon = salonUserRef(uid);

  const snapRoot = await getDoc(refRoot);
  const snapSalon = snapRoot.exists() ? null : await getDoc(refSalon);

  const authEmail = safeStr(user.email);
  const authDisplayName = safeStr(user.displayName);

  // ✅ اختر المصدر الصحيح
  const snap = snapRoot.exists() ? snapRoot : snapSalon;
  const ref = snapRoot.exists() ? refRoot : refSalon;

  if (snap && snap.exists()) {
    const data = snap.data() as any;
    const role = normalizeRole(data?.role);

    let name =
      safeStr(data?.name).trim() ||
      safeStr(data?.displayName).trim() ||
      authDisplayName.trim() ||
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

    // ✅ patch خفيف لو ناقص بيانات
    const patch: any = {};
    if (!safeStr(data?.email) && authEmail) patch.email = authEmail;
    if (!safeStr(data?.name) || data?.name === "مستخدم") patch.name = name;
    if (!safeStr(data?.displayName) || data?.displayName === "مستخدم") patch.displayName = name;
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

  // ✅ لا يوجد أي وثيقة: أنشئ client (ROOT)
  const role: UiRole = "client";
  const name = authDisplayName.trim() || buildDefaultName(role);
  const membershipId = `client-${new Date().getFullYear()}-${uid.slice(0, 6)}`;

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

  await setDoc(
    refRoot,
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
 * - يحدث في users/{uid} إذا موجود
 * - وإلا يحدث في salons/main/users/{uid}
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>) {
  const refRoot = rootUserRef(uid);
  const refSalon = salonUserRef(uid);

  const rootSnap = await getDoc(refRoot);
  const targetRef = rootSnap.exists() ? refRoot : refSalon;

  const cleaned: any = {};
  Object.entries(updates).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && v.trim() === "") return;
    cleaned[k] = v;
  });

  cleaned.updatedAt = serverTimestamp();
  await setDoc(targetRef, cleaned, { merge: true });

  // ✅ حدّث الكاش المحلي
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
