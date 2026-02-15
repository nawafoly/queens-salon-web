// src/services/firebase.ts
import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

function readEnv(name: string, fallback: string) {
  const v = (import.meta as any).env?.[name];
  if (!v) {
    if (import.meta.env.DEV) {
      // نخلي التطبيق يشتغل في المعاينة بدل الشاشة السوداء
      console.error(`[Firebase ENV Missing] ${name} is not set in .env — using fallback in DEV.`);
    }
    return fallback;
  }
  return String(v);
}

const firebaseConfig = {
  apiKey: readEnv("VITE_FIREBASE_API_KEY", "dev-api-key"),
  authDomain: readEnv("VITE_FIREBASE_AUTH_DOMAIN", "dev.local"),
  projectId: readEnv("VITE_FIREBASE_PROJECT_ID", "dev-project"),
  storageBucket: readEnv("VITE_FIREBASE_STORAGE_BUCKET", "dev-project.appspot.com"),
  messagingSenderId: readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", "000000000000"),
  appId: readEnv("VITE_FIREBASE_APP_ID", "1:000000000000:web:dev"),
};
console.log("FB ENV CHECK:", {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
});


if (import.meta.env.DEV) {
  console.log("✅ Firebase Project:", firebaseConfig.projectId);
  console.log("✅ Firebase AuthDomain:", firebaseConfig.authDomain);
}

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export const functions = getFunctions(app, "us-central1");

if (import.meta.env.DEV) {
  (window as any).__fb = { app, auth, db, storage, functions, firebaseConfig };
}
