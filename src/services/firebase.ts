// src/services/firebase.ts

import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
};


console.log("Firebase Project:", import.meta.env.VITE_FIREBASE_PROJECT_ID);

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

/** طرق الدفع في الإعدادات (واجهة) */
export type UiPaymentMethod = "كاش" | "شبكة" | "تحويل";

/** حالات الحجز التي تُحسب كدخل */
export type BookingIncomeStatus = "confirmed" | "completed";

/** إعدادات المالية */
export type FinanceSettings = {
  expenseCategories: string[];
  paymentMethods: UiPaymentMethod[];
  currency: string;
  incomeBookingStatuses: BookingIncomeStatus[];
};
