// src/services/authService.ts
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

/**
 * هذا الملف مسؤول فقط عن:
 * - Firebase Auth login
 * - Firebase Auth register
 *
 * ❌ لا يخزن role
 * ❌ لا يقرأ Firestore
 * ❌ لا يكتب localStorage
 */

export async function loginWithEmail(email: string, password: string) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function registerClientWithEmail(params: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  city?: string;
  birthdate?: string;
}) {
  const cred = await createUserWithEmailAndPassword(
    auth,
    params.email,
    params.password
  );

  const uid = cred.user.uid;

  await updateProfile(cred.user, { displayName: params.name });

  await setDoc(
    doc(db, "salons", "main", "users", uid),
    {
      uid,
      role: "client",
      name: params.name,
      displayName: params.name,
      email: params.email,
      phone: params.phone ?? "",
      city: params.city ?? "",
      birthdate: params.birthdate ?? "",
      membershipId: `client-${new Date().getFullYear()}-${uid.slice(0, 6)}`,
      membershipPercent: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  return cred.user;
}
