// src/services/firebase.ts
import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FB_API_KEY ?? "").trim(),
  authDomain: (import.meta.env.VITE_FB_AUTH_DOMAIN ?? "").trim(),
  projectId: (import.meta.env.VITE_FB_PROJECT_ID ?? "").trim(),
  storageBucket: (import.meta.env.VITE_FB_STORAGE_BUCKET ?? "").trim(),
  messagingSenderId: (import.meta.env.VITE_FB_MESSAGING_SENDER_ID ?? "").trim(),
  appId: (import.meta.env.VITE_FB_APP_ID ?? "").trim(),
};

// ✅ تحذير واضح لو env ناقصة (بدون ما يسبب كراش صامت)
const required = [
  ["VITE_FB_API_KEY", firebaseConfig.apiKey],
  ["VITE_FB_AUTH_DOMAIN", firebaseConfig.authDomain],
  ["VITE_FB_PROJECT_ID", firebaseConfig.projectId],
  ["VITE_FB_APP_ID", firebaseConfig.appId],
] as const;

const missing = required.filter(([, v]) => !v).map(([k]) => k);

if (missing.length) {
  console.warn("❌ Missing Firebase env vars:", missing.join(", "));
}

console.log("Firebase Project:", firebaseConfig.projectId || "undefined");

// ✅ يمنع تهيئة مكررة (HMR / dev / build)
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// ✅ مهم: نفس Region حق الفنكشن
export const functions = getFunctions(app, "us-central1");

// ✅ Debug فقط (بدون emulators)
if (import.meta.env.DEV) {
  (window as any).__fb = { auth, db, functions };
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
