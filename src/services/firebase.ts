// src/services/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// 🔐 Firebase config from Vite env
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// 🧪 Debug (يساعدك لو رجعت المشكلة)
console.log("Firebase Project:", firebaseConfig.projectId);

// 🛡️ منع إعادة التهيئة
const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// 🔐 Auth
export const auth = getAuth(app);

// 🗄️ Firestore
export const db = getFirestore(app);

// ✅ Debug helpers (DEV فقط)
if (import.meta.env.DEV) {
  (window as any).__fb = { auth, db };
}

export default app;
