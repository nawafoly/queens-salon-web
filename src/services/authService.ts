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
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

/**
 * هذا الملف مسؤول فقط عن:
 * - Firebase Auth login
 * - Firebase Auth register (client)
 *
 * ✅ لا يقرأ صلاحيات/roles للأدارة
 * ✅ لا يبني Session محلي
 * (الـ session يتم في Login.tsx + userProfile.ts)
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
    // ✅ ثبّت الجلسة محليًا (مهم)
    await setPersistence(auth, browserLocalPersistence);

    const cred = await signInWithEmailAndPassword(auth, e, p);
    return cred.user;
  } catch (err: any) {
    const code = String(err?.code || "").toLowerCase();
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
      throw new Error("مفتاح Firebase غير صالح حاليًا. استخدم زر الدخول المؤقت للدخول إلى الداشبورد.");
    }
    throw new Error(err?.message || "فشل تسجيل الدخول.");
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
  if (!password || password.length < 6) throw new Error("كلمة المرور لازم 6 أحرف على الأقل.");

  // ✅ ثبّت الجلسة محليًا
  await setPersistence(auth, browserLocalPersistence);

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  // ✅ حدّث displayName في Firebase Auth
  await updateProfile(cred.user, { displayName: name });

  const membershipId = `client-${new Date().getFullYear()}-${uid.slice(0, 6)}`;

  const profileDoc = {
    uid,
    role: "client",
    name,
    displayName: name,
    email,
    phone: params.phone ?? "",
    city: params.city ?? "",
    birthdate: params.birthdate ?? "",
    membershipId,
    membershipPercent: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // ✅ 1) المسار المعتمد عندك
  await setDoc(doc(db, "salons", "main", "users", uid), profileDoc, { merge: true });

  // ✅ 2) ROOT users/{uid} (مهم عشان createOrLoadUserProfile يلقاه أولاً)
  await setDoc(doc(db, "users", uid), profileDoc, { merge: true });

  return cred.user;
}

/** (اختياري) لو تحتاج تسجيل خروج من Firebase */
export async function logoutFirebase() {
  await signOut(auth);
}
