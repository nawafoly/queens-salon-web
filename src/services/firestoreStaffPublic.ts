// src/services/firestoreStaffPublic.ts
import { db } from "./firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

export type StaffPublicDoc = {
  name: string;
  specialties: string[]; // قد تكون: ["شعر"] أو ["قسم الشعر"] أو ["الشعر"]
  active: boolean;

  // ✅ NEW: uid الحقيقي لحساب الموظفة (Firestore users uid)
  // (موجود عندك في المستند حسب الصورة)
  uid?: string;

  // ✅ NEW: لدعم أسماء قديمة/مستقبلية (اختياري)
  linkedUid?: string;
};

export type StaffPublicWithId = StaffPublicDoc & {
  id: string;
  // ✅ تأكيد وجودهم في النوع (اختياري)
  uid?: string;
  linkedUid?: string;
};

/** ✅ تطبيع عربي بسيط لتفادي اختلافات: (قسم/الـ/تشكيل/مسافات/ألف/ياء/ة) */
function normalizeArabic(input: any) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    // إزالة التشكيل
    .replace(/[\u064B-\u065F\u0670]/g, "")
    // توحيد الألف
    .replace(/[أإآ]/g, "ا")
    // توحيد الياء
    .replace(/ى/g, "ي")
    // توحيد التاء المربوطة
    .replace(/ة/g, "ه")
    // حذف "قسم" لو موجودة بالبداية
    .replace(/^قسم\s+/g, "")
    // حذف "ال" بالبداية (اختياري)
    .replace(/^ال+/g, "")
    // توحيد المسافات
    .replace(/\s+/g, " ");
}

export async function listActiveStaffBySpecialty(args: {
  salonId: string; // مثال: "main"
  specialty: string; // ✅ مثال: "شعر" أو "قسم الشعر"
}): Promise<StaffPublicWithId[]> {
  const colRef = collection(db, `salons/${args.salonId}/staff_public`);

  const wantedRaw = String(args.specialty || "").trim();
  if (!wantedRaw) return [];

  const wanted = normalizeArabic(wantedRaw);

  // ✅ نجلب كل الموظفات النشطات (بدون array-contains)
  const q = query(colRef, where("active", "==", true));
  const snaps = await getDocs(q);

  const all: StaffPublicWithId[] = snaps.docs.map((d) => {
    const data = d.data() as any;

    // ✅ NEW: نقرأ uid بأي اسم محتمل
    const uid = String(data?.uid || "").trim();
    const linkedUid = String(data?.linkedUid || data?.uid || "").trim();

    return {
      id: d.id,
      name: String(data?.name ?? "").trim(),
      specialties: Array.isArray(data?.specialties) ? data.specialties : [],
      active: Boolean(data?.active),

      // ✅ NEW
      uid: uid || undefined,
      linkedUid: linkedUid || undefined,
    };
  });

  // ✅ فلترة مرنة بالتطبيع
  return all.filter((staff) => {
    const specs = Array.isArray(staff.specialties) ? staff.specialties : [];
    return specs.some((sp) => normalizeArabic(sp) === wanted);
  });
}
