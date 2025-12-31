// src/services/firestoreDebug.ts
import { auth, db } from "./firebase";
import { signInAnonymously } from "firebase/auth";
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
  salonCol: (name: string) => collection(db, "salons", SALON_ID, name),

  salonDoc: (name: string, id: string) => doc(db, "salons", SALON_ID, name, id),
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

console.log("window.__fs (salon scoped) ready ✅");
console.log("window.__salonCol / __salonAdd / __ping ready ✅");

declare global {
  interface Window {
    __auth?: typeof auth;
    __db?: typeof db;

    __whoami?: () => any;
    __anon?: () => Promise<any>;

    __testReadSlot?: (slotId?: string) => Promise<any>;
    __testWriteBooking?: () => Promise<any>;
  }
}

if (import.meta.env.DEV) {
  // expose raw instances
  window.__auth = auth;
  window.__db = db;

  // 1) من أنا؟ (هل فيه يوزر؟ هل هو anonymous؟)
  window.__whoami = () => {
    const u = auth.currentUser;
    return u
      ? {
          uid: u.uid,
          email: u.email,
          isAnonymous: u.isAnonymous,
          providerData: u.providerData,
        }
      : null;
  };

  // 2) سجل دخول Anonymous يدويًا
  window.__anon = async () => {
    const res = await signInAnonymously(auth);
    return { uid: res.user.uid, isAnonymous: res.user.isAnonymous };
  };

  // 3) اختبار قراءة booking_slots (ROOT) — غيّر slotId إذا تبغى
  window.__testReadSlot = async (slotId = "TEST_SLOT_DEBUG") => {
    const ref = doc(db, "booking_slots", slotId);
    const snap = await getDoc(ref);
    return { exists: snap.exists(), id: snap.id, data: snap.data() || null };
  };

  // 4) اختبار كتابة booking تجريبية في ROOT bookings
  window.__testWriteBooking = async () => {
    const colRef = collection(db, "bookings");
    const r = await addDoc(colRef, {
      channel: "client",
      createdBy: "client",
      clientName: "DEBUG",
      clientPhone: "0500000000",
      serviceName: "debug",
      date: "2026-01-01",
      time: "10:00",
      status: "pending",
      createdAt: serverTimestamp(),
    });
    return { id: r.id };
  };

  console.log(
    "firestoreDebug.ts: window.__auth / __db / __whoami / __anon / __testReadSlot / __testWriteBooking ready ✅"
  );
}
