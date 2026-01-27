// src/services/firebase.ts
import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

function must(name: string) {
  const v = (import.meta as any).env?.[name];
  if (!v) {
    // خطأ واضح بدل ما نضيع وقت في "Missing permissions" وهو أصلاً config غلط
    throw new Error(`[Firebase ENV Missing] ${name} is not set in .env`);
  }
  return String(v);
}

const firebaseConfig = {
  apiKey: must("VITE_FIREBASE_API_KEY"),
  authDomain: must("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: must("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: must("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: must("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: must("VITE_FIREBASE_APP_ID"),
};

console.log("✅ Firebase Project:", firebaseConfig.projectId);
console.log("✅ Firebase AuthDomain:", firebaseConfig.authDomain);

// ✅ يمنع تهيئة مكررة (HMR / dev / build)
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// ✅ نفس Region حق الفنكشن (لو ما تستخدم Functions عادي تتركه)
export const functions = getFunctions(app, "us-central1");

// ✅ Debug فقط
if (import.meta.env.DEV) {
  (window as any).__fb = { app, auth, db, functions, firebaseConfig };
}

// ===== Settings Types (Salon UI) =====
export type UiPaymentMethod = "كاش" | "شبكة" | "تحويل";
export type BookingIncomeStatus = "confirmed" | "completed";

export type FinanceSettings = {
  expenseCategories: string[];
  paymentMethods: UiPaymentMethod[];
  currency: string;
  incomeBookingStatuses: BookingIncomeStatus[];
};
