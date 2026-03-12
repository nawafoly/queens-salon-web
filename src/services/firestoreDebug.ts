// src/services/firestoreDebug.ts
import { auth, db, functions } from "./firebase";
import { httpsCallable } from "firebase/functions";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  addDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { backfillAvailabilityDaysFromBookingSlots } from "./firestoreAvailabilityBackfill";

const SALON_ID = "main";

if (import.meta.env.DEV) {
  const adminBackfillAvailabilityDaysFromBookingSlots = async (opts: any) => {
    const fn = httpsCallable(functions, "adminBackfillAvailabilityDaysFromBookingSlots", {
      timeout: 60 * 60 * 1000,
    });
    const res = await fn(opts || {});
    return (res as any)?.data;
  };

  // ✅ أدوات Debug مربوطة بالهيكلة الصحيحة (salons/main)
  (window as any).__fs = {
    auth,
    db,

    // refs
    doc,
    collection,
    query,
    where,
    orderBy,
    limit,

    // ops
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    serverTimestamp,
    // ⚠️ Client-side backfill uses Firestore rules and may fail by design.
    backfillAvailabilityDaysFromBookingSlots,
    // ✅ Server-side backfill (Admin SDK) — recommended.
    adminBackfillAvailabilityDaysFromBookingSlots,

    // helpers خاصة بالصالون
    salonCol: (name: string) =>
      collection(db, "salons", SALON_ID, name),

    salonDoc: (name: string, id: string) =>
      doc(db, "salons", SALON_ID, name, id),
  };

  // ✅ اختصارات سريعة
  (window as any).__db = db;
  (window as any).__salonCol = (name: string) =>
    collection(db, "salons", SALON_ID, name);

  (window as any).__salonAdd = (name: string, data: any) =>
    addDoc(collection(db, "salons", SALON_ID, name), {
      ...data,
      createdAt: serverTimestamp(),
    });

  // ✅ Ping آمن (يتحقق من اتصال الصالون فقط)
  (window as any).__ping = async () => {
    const snap = await getDocs(
      query(collection(db, "salons", SALON_ID, "bookings"), limit(1))
    );
    return snap.size;
  };
}
