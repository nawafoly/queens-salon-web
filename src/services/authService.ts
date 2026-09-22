// src/services/authService.ts
import type { User } from "firebase/auth";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { auth } from "./firebase";
import { clearStoredAuthSession } from "./localAuthSession";
import { coreApiRequest } from "./coreApiClient";

/**
 * هذا الملف مسؤول فقط عن:
 * - Firebase Auth login
 * - Firebase Auth register (client) + Core D1 profile provision
 *
 * ✅ لا يقرأ صلاحيات/roles للإدارة
 * ✅ لا يبني Session محلي
 * (الـ session يتم في Login.tsx + userProfile.ts)
 *
 * CORE D1 ONLY for profile writes — no Firestore fallback.
 */

function cleanEmail(v: string) {
  return String(v || "").trim().toLowerCase();
}

function isClientPlaceholderName(raw: string) {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ة/g, "ه");
  return (
    normalized === "عميله" ||
    normalized === "client" ||
    normalized === "user" ||
    normalized === "مستخدم"
  );
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  const e = cleanEmail(email);
  const p = String(password || "").trim();

  if (!e || !p) throw new Error("اكتب البريد وكلمة المرور.");

  try {
    await setPersistence(auth, browserLocalPersistence);

    const cred = await signInWithEmailAndPassword(auth, e, p);
    return cred.user;
  } catch (err: unknown) {
    const code = String((err as { code?: unknown } | null)?.code || "").toLowerCase();
    if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
      throw new Error("البريد أو كلمة المرور غير صحيحة.");
    }
    if (code.includes("auth/user-not-found")) {
      throw new Error("هذا البريد غير مسجل.");
    }
    if (code.includes("auth/too-many-requests")) {
      throw new Error("محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.");
    }
    if (code.includes("auth/network-request-failed")) {
      throw new Error("مشكلة اتصال بالشبكة. تأكد من الإنترنت.");
    }
    if (code.includes("auth/invalid-api-key")) {
      throw new Error("إعدادات Firebase غير صالحة حاليًا. راجع إعدادات المشروع.");
    }
    throw new Error(err instanceof Error ? err.message : "فشل تسجيل الدخول.");
  }
}

export async function registerClientWithEmail(params: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  city?: string;
  birthdate?: string;
}): Promise<User> {
  const name = String(params.name || "").trim();
  const email = cleanEmail(params.email);
  const password = String(params.password || "").trim();

  if (!name) throw new Error("الاسم مطلوب.");
  if (isClientPlaceholderName(name)) throw new Error("الرجاء كتابة الاسم الحقيقي.");
  if (!email || !email.includes("@")) throw new Error("صيغة البريد الإلكتروني غير صحيحة.");
  if (email.endsWith("@malikat.com")) {
    throw new Error("هذا البريد مخصص للحسابات الداخلية.");
  }
  if (!password || password.length < 6) throw new Error("كلمة المرور لازم 6 أحرف على الأقل.");

  await setPersistence(auth, browserLocalPersistence);

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name });

  // Force a fresh ID token so Core ensure-client sees the new Auth user.
  await cred.user.getIdToken(true);

  await coreApiRequest("/api/core/auth/ensure-client", {
    method: "POST",
    body: {
      name,
      email,
      phone: params.phone ?? "",
      city: params.city ?? "",
      birthdate: params.birthdate ?? "",
    },
  });

  return cred.user;
}

/** (اختياري) لو تحتاج تسجيل خروج من Firebase */
export async function logoutFirebase() {
  clearStoredAuthSession();
  try {
    await signOut(auth);
  } finally {
    clearStoredAuthSession();
  }
}
