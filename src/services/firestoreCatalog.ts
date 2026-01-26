// src/services/firestoreCatalog.ts
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
  } from "firebase/firestore";
  import { db } from "./firebase";
  
  const SALON_ID_DEFAULT = "main";
  
  /* =========================
     ✅ Types (متوافقة مع Booking.tsx الحالي)
     Booking يتوقع:
     SectionDoc: { id, الاسم }
     CategoryDoc: { id, الاسم, sectionId }
     ServiceDoc: { id, الاسم, sectionId, categoryId?, السعر, المدة }
  ========================= */
  export type SectionDoc = {
    id: string;
    الاسم: string;
    // حقول إضافية اختيارية
    order?: number;
    active?: boolean;
    createdAt?: any;
    updatedAt?: any;
  };
  
  export type CategoryDoc = {
    id: string;
    الاسم: string;
    sectionId: string;
    order?: number;
    active?: boolean;
    createdAt?: any;
    updatedAt?: any;
  };
  
  export type ServiceDoc = {
    id: string;
    الاسم: string;
    sectionId: string;
    categoryId?: string | null;
    السعر: number;
    المدة: number; // بالدقائق
    active?: boolean;
    createdAt?: any;
    updatedAt?: any;
  };
  
  function safeKey(s: string) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replaceAll("/", "-")
      .replace(/\s+/g, "_")
      .replace(/[^\w\u0600-\u06FF\-]/g, "");
  }
  
  /**
   * ✅ مسارات Firestore الصحيحة حسب مشروعك الحالي:
   * salons/{salonId}/service_sections
   * salons/{salonId}/services
   *
   * (ما عندنا categories حالياً - التصنيف اختياري)
   */
  function cols(salonId: string) {
    const sid = salonId || SALON_ID_DEFAULT;
    return {
      service_sections: ["salons", sid, "service_sections"] as const,
      services: ["salons", sid, "services"] as const,
    };
  }
  
  /* =========================
     ✅ READ
     - بدون where لتفادي composite indexes
     - فلترة محلية: active === true + الاسم موجود
  ========================= */
  
  export async function listActiveSections(
    salonId = SALON_ID_DEFAULT
  ): Promise<SectionDoc[]> {
    const { service_sections } = cols(salonId);
  
    // ✅ في بياناتك الحقل اسمه order
    const q = query(collection(db, ...service_sections), orderBy("order", "asc"));
    const snap = await getDocs(q);
  
    const list = snap.docs.map((d) => {
      const x = d.data() as any;
      return {
        id: d.id,
        الاسم: String(x?.name || ""),
        order: Number(x?.order ?? 999),
        active: x?.active !== false,
        createdAt: x?.createdAt,
        updatedAt: x?.updatedAt,
      } as SectionDoc;
    });
  
    return list.filter((s) => s.الاسم.trim() && s.active === true);
  }
  
  /**
   * ✅ categories غير موجودة عندك حالياً
   * عشان Booking ما ينكسر:
   * نرجع قائمة فاضية دايمًا
   */
  export async function listActiveCategoriesBySection(
    _sectionId: string,
    _salonId = SALON_ID_DEFAULT
  ): Promise<CategoryDoc[]> {
    return [];
  }
  
  export async function listActiveServices(
    params: { sectionId: string; categoryId?: string | null },
    salonId = SALON_ID_DEFAULT
  ): Promise<ServiceDoc[]> {
    const { services } = cols(salonId);
  
    const sid = String(params.sectionId || "").trim();
    const cid = params.categoryId ? String(params.categoryId).trim() : "";
  
    // ✅ في بياناتك غالبًا ما عندك "order" لكل خدمة، بس نحاول نرتب به لو موجود
    const q = query(collection(db, ...services), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
  
    const list = snap.docs.map((d) => {
      const x = d.data() as any;
  
      // ✅ تطبيع للمدة: durationMin
      const duration =
        Number(x?.durationMin ?? x?.duration ?? x?.المدة ?? 60) || 60;
  
      return {
        id: d.id,
        الاسم: String(x?.name || ""),
        sectionId: String(x?.sectionId || ""),
        categoryId: x?.categoryId ?? null,
        السعر: Number(x?.price ?? 0),
        المدة: Math.max(5, duration),
        active: x?.active !== false,
        createdAt: x?.createdAt,
        updatedAt: x?.updatedAt,
      } as ServiceDoc;
    });
  
    return list.filter((s) => {
      if (!s.الاسم.trim()) return false;
      if (s.active !== true) return false;
      if (String(s.sectionId || "").trim() !== sid) return false;
      if (cid && String(s.categoryId || "").trim() !== cid) return false;
      return true;
    });
  }
  
  /* =========================
     ✅ WRITE (Dashboard)
     نخلي Dashboard يكتب بنفس الشكل الحالي في Firestore
     - service_sections: name, order, active
     - services: name, sectionId, price, durationMin, active
  ========================= */
  
  export async function upsertSection(
    input: { id?: string; الاسم: string; ترتيب?: number; مفعل?: boolean },
    salonId = SALON_ID_DEFAULT
  ) {
    const { service_sections } = cols(salonId);
  
    // ✅ id لو موجود نخليه، غير كذا safeKey للاسم
    const id = String(input.id || "").trim() || safeKey(input.الاسم);
    const ref = doc(db, ...service_sections, id);
  
    const name = String(input.الاسم || "").trim();
    const order = Number(input.ترتيب ?? 1);
    const active = input.مفعل !== false;
  
    const snap = await getDoc(ref);
    const isNew = !snap.exists();
  
    await setDoc(
      ref,
      {
        name,
        order,
        active,
        updatedAt: serverTimestamp(),
        ...(isNew ? { createdAt: serverTimestamp() } : {}),
      },
      { merge: true }
    );
  
    return id;
  }
  
  /**
   * ✅ categories مو مستخدمة عندك الآن
   * نخليها موجودة عشان لو نحتاجها لاحقًا،
   * لكن حالياً نرمي error واضح لو أحد ناداها بالغلط.
   */
  export async function upsertCategory() {
    throw new Error("التصنيفات (categories) غير مفعّلة حالياً في هذا المشروع.");
  }
  
  export async function addService(
    input: {
      الاسم: string;
      sectionId: string;
      categoryId?: string | null;
      السعر: number;
      المدة: number; // بالدقائق
      ترتيب?: number; // غير مستخدم حالياً
      مفعل?: boolean;
    },
    salonId = SALON_ID_DEFAULT
  ) {
    const { services } = cols(salonId);
  
    const payload: any = {
      name: String(input.الاسم || "").trim(),
      sectionId: String(input.sectionId || "").trim(),
      categoryId: input.categoryId ? String(input.categoryId).trim() : null,
      price: Math.max(0, Number(input.السعر || 0)),
      durationMin: Math.max(5, Number(input.المدة || 0)),
      active: input.مفعل !== false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
  
    const res = await addDoc(collection(db, ...services), payload);
    return res.id;
  }
  
  export async function saveService(
    id: string,
    patch: Partial<Omit<ServiceDoc, "id">>,
    salonId = SALON_ID_DEFAULT
  ) {
    const { services } = cols(salonId);
    const ref = doc(db, ...services, String(id));
  
    // ✅ نحول patch للشكل الإنجليزي اللي عندك في Firestore
    const payload: any = { updatedAt: serverTimestamp() };
  
    if ((patch as any).الاسم != null) payload.name = String((patch as any).الاسم || "").trim();
    if ((patch as any).sectionId != null) payload.sectionId = String((patch as any).sectionId || "").trim();
    if ((patch as any).categoryId != null)
      payload.categoryId = (patch as any).categoryId ? String((patch as any).categoryId).trim() : null;
  
    if ((patch as any).السعر != null) payload.price = Math.max(0, Number((patch as any).السعر || 0));
    if ((patch as any).المدة != null) payload.durationMin = Math.max(5, Number((patch as any).المدة || 0));
    if ((patch as any).active != null) payload.active = (patch as any).active !== false;
  
    await setDoc(ref, payload, { merge: true });
  }
  
