// src/services/firestoreDebug.ts
import { auth, db } from "./firebase";
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

const SALON_ID = "main";

if (import.meta.env.DEV) {
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
