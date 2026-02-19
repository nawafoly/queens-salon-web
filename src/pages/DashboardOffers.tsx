// src/pages/DashboardOffers.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faTrash,
  faPen,
  faBan,
  faTag,
  faXmark,
  faWandMagicSparkles,
  faImage,
  faMagnifyingGlass,
  faCheck,
  faRotateLeft,
  faSkullCrossbones,
  faFilter,
} from "@fortawesome/free-solid-svg-icons";

import { pricingSections } from "./Pricing";

import "../styles/DashboardModals.css";
import "../styles/DashboardOffers.css";
import Modal from "../components/Modal";
import { db } from "../services/firebase";
import { collection, getDocs, orderBy, query } from "firebase/firestore";

// ✅ Firestore
import { listOffers, upsertOffer, removeOffer } from "../services/firestoreOffers";
import type { Offer, DiscountType, OfferAppliesTo, OfferSequenceStep } from "../services/firestoreOffers";
import {
  listAllPackages,
  upsertPackage,
  removePackage,
  type ServicePackageDoc,
  type PackageServiceItem,
} from "../services/firestorePackages";

type OfferForm = {
  title: string;
  code: string;
  discountType: DiscountType;
  value: number;
  startDate: string;
  endDate: string;
  active: boolean;
  imageUrl?: string;

  appliesTo: OfferAppliesTo;
  serviceIds: string[];
  sequenceSteps: OfferSequenceStep[];
};

type OfferFilterMode = "active_now" | "scheduled" | "expired" | "deleted";
type PackageServiceRow = {
  id: string;
  name: string;
  sectionId: string;
  categoryId: string;
  categoryName?: string;
  durationMin: number;
  price: number;
  active: boolean;
};
type PackageDraft = {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  active: boolean;
  serviceIds: string[];
  finalPrice: number;
  warnDiscountOverPercent: number;
};
type PackageListMode = "all" | "selected" | "unselected";

const MAX_IMAGE_MB = 2;
const MAX_PACKAGE_IMAGE_MB = 2;
const MAX_PACKAGE_DISCOUNT_WARN_PERCENT = 70;
const SALON_ID = "main";

// ✅ NEW: QS + 3 digits, no dash (مثال: QS123)
function generateCode(prefix = "QS") {
  const num = Math.floor(100 + Math.random() * 900); // 3 أرقام
  return `${prefix}${num}`;
}

function makeOfferId() {
  const anyCrypto: any = globalThis.crypto as any;
  if (anyCrypto?.randomUUID) return `O-${anyCrypto.randomUUID()}`;
  return `O-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function buildId(raw: string) {
  const s = String(raw || "").trim().toLowerCase();
  const cleaned = s.replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_-]/gu, "");
  return cleaned.replace(/^_+|_+$/g, "");
}

function humanizeLabel(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasArabicText(value: string) {
  return /[\u0600-\u06FF]/.test(value);
}

function normalizeGroupLabel(raw: string) {
  const base = humanizeLabel(raw);
  if (!base) return "";
  const dict: Record<string, string> = {
    hair: "قسم الشعر",
    "hair care": "العناية بالشعر",
    coloring: "قسم الصبغات",
    "hair color treatments": "الصبغات والمعالجات",
    makeup: "قسم المكياج",
    "make up": "قسم المكياج",
    nails: "قسم الأظافر",
    waxing: "قسم الشمع",
    consultation: "استشارة",
    blowdry: "استشوار",
  };
  const direct = dict[base.toLowerCase()];
  if (direct) return direct;
  if (hasArabicText(base) && /[A-Za-z]/.test(base)) {
    return base.replace(/[A-Za-z]+/g, " ").replace(/\s+/g, " ").trim();
  }
  return base;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function extractMinPrice(priceText: string): number {
  const cleaned = String(priceText || "").replace(/[^\d\-]/g, "");
  if (!cleaned) return 0;

  const parts = cleaned
    .split("-")
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  if (!parts.length) return 0;
  return Math.min(...parts);
}

type FlatService = {
  id: string;
  sectionId: string;
  sectionTitle: string;
  category: string;
  name: string;
  basePrice: number;
};

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isExpiredByToday(o: any) {
  const end = String(o?.endDate || "").trim();
  if (!end) return false;
  return todayISO() > end;
}

function isScheduledByToday(o: any) {
  const start = String(o?.startDate || "").trim();
  if (!start) return false;
  return todayISO() < start;
}

function isDeleted(o: any) {
  return Boolean(o?.deletedAt);
}

function isActiveNow(o: any) {
  if (!o?.active) return false;
  if (isDeleted(o)) return false;
  if (isScheduledByToday(o)) return false;
  if (isExpiredByToday(o)) return false;
  return true;
}

const DashboardOffers: React.FC = () => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [packagesCatalog, setPackagesCatalog] = useState<ServicePackageDoc[]>([]);
  const [packageServices, setPackageServices] = useState<PackageServiceRow[]>([]);
  const [packageServiceSearch, setPackageServiceSearch] = useState("");
  const [packageListMode, setPackageListMode] = useState<PackageListMode>("all");
  const [packageOpenGroups, setPackageOpenGroups] = useState<Record<string, boolean>>({});
  const [editingPackageId, setEditingPackageId] = useState("");
  const [packagePickedImageName, setPackagePickedImageName] = useState("");
  const [packageDraft, setPackageDraft] = useState<PackageDraft>({
    id: "",
    name: "",
    description: "",
    imageUrl: "",
    active: true,
    serviceIds: [],
    finalPrice: 0,
    warnDiscountOverPercent: MAX_PACKAGE_DISCOUNT_WARN_PERCENT,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);

  const [queryText, setQueryText] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [pickedImageName, setPickedImageName] = useState("");
  const [filterMode, setFilterMode] = useState<OfferFilterMode>("active_now");
  const [inlineNotice, setInlineNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const [form, setForm] = useState<OfferForm>({
    title: "",
    code: "",
    discountType: "fixed",
    value: 0,
    startDate: "",
    endDate: "",
    active: true,
    imageUrl: "",
    appliesTo: "all",
    serviceIds: [],
    sequenceSteps: [],
  });

  /* =========================
     ✅ Custom Dropdown: Discount Type
  ========================= */
  const [discountOpen, setDiscountOpen] = useState(false);
  const discountWrapRef = useRef<HTMLDivElement | null>(null);
  const showNotice = (text: string, type: "error" | "success" = "error") => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setInlineNotice({ type, text: String(text || "").trim() });
    noticeTimerRef.current = window.setTimeout(() => setInlineNotice(null), 4200);
  };


  const discountOptions = useMemo(
    () => [
      { value: "fixed" as DiscountType, label: "مبلغ ثابت" },
      { value: "percent" as DiscountType, label: "نسبة مئوية" },
    ],
    []
  );

  const discountLabel = discountOptions.find((o) => o.value === form.discountType)?.label || "اختر";

  useEffect(() => {
    if (!discountOpen) return;

    const onDown = (e: MouseEvent) => {
      const el = discountWrapRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setDiscountOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDiscountOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [discountOpen]);


  // ✅ قائمة خدمات مطابقة للي في Booking (نفس id)
  const servicesFlat: FlatService[] = useMemo(() => {
    const out: FlatService[] = [];
    Object.entries(pricingSections).forEach(([sectionId, section]) => {
      section.services.forEach((cat, catIdx) => {
        cat.items.forEach((it, itemIdx) => {
          const id = `${sectionId}-${catIdx}-${itemIdx}`;
          out.push({
            id,
            sectionId,
            sectionTitle: section.title,
            category: cat.category,
            name: `${cat.category} - ${it.name}`,
            basePrice: extractMinPrice(it.price),
          });
        });
      });
    });
    return out;
  }, []);

  const servicesFiltered = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase();
    if (!q) return servicesFlat;

    return servicesFlat.filter((s) => {
      const a = `${s.sectionTitle} ${s.category} ${s.name}`.toLowerCase();
      return a.includes(q) || String(s.basePrice).includes(q);
    });
  }, [servicesFlat, serviceSearch]);

  const servicesGrouped = useMemo(() => {
    const map = new Map<string, FlatService[]>();
    servicesFiltered.forEach((s) => {
      const key = `${s.sectionTitle} — ${s.category}`;
      const arr = map.get(key) || [];
      arr.push(s);
      map.set(key, arr);
    });
    return Array.from(map.entries());
  }, [servicesFiltered]);
  const serviceById = useMemo(() => {
    const m = new Map<string, FlatService>();
    servicesFlat.forEach((s) => m.set(String(s.id || "").trim(), s));
    return m;
  }, [servicesFlat]);

  const normalizeSequenceSteps = (raw: any, fallbackServiceIds: string[] = []): OfferSequenceStep[] => {
    const fromRaw = Array.isArray(raw) ? raw : [];
    const mapped = fromRaw
      .map((x: any, idx: number) => ({
        serviceId: String(x?.serviceId || "").trim(),
        orderIndex: Number.isFinite(Number(x?.orderIndex)) ? Number(x.orderIndex) : idx,
        gapAfterMin: Math.max(0, Number(x?.gapAfterMin || 0)),
        titleSnapshot: String(x?.titleSnapshot || "").trim() || undefined,
      }))
      .filter((x) => x.serviceId)
      .sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0))
      .map((x, idx) => ({ ...x, orderIndex: idx }));

    if (mapped.length) return mapped;
    return (fallbackServiceIds || [])
      .map((id, idx) => ({
        serviceId: String(id || "").trim(),
        orderIndex: idx,
        gapAfterMin: 0,
      }))
      .filter((x) => x.serviceId);
  };

  const refresh = async () => {
    try {
      const [offersData, packagesData, servicesSnap] = await Promise.all([
        listOffers(SALON_ID),
        listAllPackages(SALON_ID),
        getDocs(query(collection(db, "salons", SALON_ID, "services"), orderBy("name", "asc"))),
      ]);
      setOffers(Array.isArray(offersData) ? offersData : []);
      setPackagesCatalog(Array.isArray(packagesData) ? packagesData : []);
      const srvRows: PackageServiceRow[] = servicesSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .map((x: any) => ({
          id: String(x.id || "").trim(),
          name: String(x.name || "").trim(),
          sectionId: String(x.sectionId || "").trim(),
          categoryId: String(x.categoryId || "").trim(),
          categoryName: String(x.categoryName || x.category || "").trim() || undefined,
          durationMin: Math.max(0, Number(x.durationMin || 0)),
          price: Math.max(0, Number(x.price || 0)),
          active: x.active !== false,
        }))
        .filter((x) => x.id && x.name && x.active !== false);
      setPackageServices(srvRows);
    } catch (e: any) {
      console.error("❌ listOffers error:", e?.code, e?.message, e);
      showNotice("تعذر تحميل العروض من قاعدة البيانات.");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filteredOffers = useMemo(() => {
    const q = queryText.trim().toLowerCase();

    let base = [...offers];

    // ✅ فلترة حسب التبويب
    base = base.filter((o: any) => {
      if (filterMode === "active_now") return isActiveNow(o);
      if (filterMode === "scheduled") return !isDeleted(o) && Boolean(o.active) && isScheduledByToday(o);
      if (filterMode === "expired")
        return !isDeleted(o) && (isExpiredByToday(o) || (!o.active && !isScheduledByToday(o)));
      if (filterMode === "deleted") return isDeleted(o);
      return true;
    });

    // ✅ بحث
    if (q) {
      base = base.filter((o: any) => {
        const title = String(o.title || "").toLowerCase();
        const code = String(o.code || "").toLowerCase();
        return title.includes(q) || code.includes(q);
      });
    }

    // ✅ ترتيب
    base.sort((a: any, b: any) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    return base;
  }, [offers, queryText, filterMode]);

  const stats = useMemo(() => {
    const total = offers.filter((o: any) => !isDeleted(o)).length;
    const activeNowCount = offers.filter((o: any) => isActiveNow(o)).length;
    const scheduledCount = offers.filter((o: any) => !isDeleted(o) && Boolean(o.active) && isScheduledByToday(o)).length;
    const expiredCount = offers.filter(
      (o: any) => !isDeleted(o) && (isExpiredByToday(o) || (!o.active && !isScheduledByToday(o)))
    ).length;
    const deletedCount = offers.filter((o: any) => isDeleted(o)).length;

    const used = offers.filter((o: any) => Number(o.usageCount || 0) > 0).length;

    return { total, activeNowCount, scheduledCount, expiredCount, deletedCount, used };
  }, [offers]);

  const openAdd = () => {
    setEditing(null);
    setServiceSearch("");
    setPickedImageName("");
    setDiscountOpen(false);

    setForm({
      title: "",
      code: generateCode(),
      discountType: "fixed",
      value: 0,
      startDate: "",
      endDate: "",
      active: true,
      imageUrl: "",
      appliesTo: "all",
      serviceIds: [],
      sequenceSteps: [],
    });

    setOpen(true);
  };

  const openEdit = (o: Offer) => {
    setEditing(o);
    setServiceSearch("");
    setPickedImageName((o as any).imageUrl ? "تم اختيار صورة" : "");
    setDiscountOpen(false);

    setForm({
      title: (o as any).title || "",
      code: (o as any).code || "",
      discountType: ((o as any).discountType as DiscountType) || "fixed",
      value: Number((o as any).value || 0),
      startDate: (o as any).startDate || "",
      endDate: (o as any).endDate || "",
      active: Boolean((o as any).active),
      imageUrl: (o as any).imageUrl || "",
      appliesTo: ((o as any).appliesTo as OfferAppliesTo) || "all",
      serviceIds: Array.isArray((o as any).serviceIds) ? (o as any).serviceIds : [],
      sequenceSteps: normalizeSequenceSteps((o as any).sequenceSteps, Array.isArray((o as any).serviceIds) ? (o as any).serviceIds : []),
    });

    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setServiceSearch("");
    setDiscountOpen(false);
  };

  const save = async () => {
    if (!form.title.trim()) return showNotice("اكتب عنوان العرض");
    if (!form.code.trim()) return showNotice("اكتب الكود أو اضغط توليد");
    if (Number(form.value) <= 0) return showNotice("قيمة الخصم لازم تكون أكبر من صفر");
    if (form.discountType === "percent" && Number(form.value) > 100) return showNotice("النسبة المئوية لا تتجاوز 100%");
    if (form.startDate && form.endDate && form.startDate > form.endDate) return showNotice("تاريخ البداية لازم يكون قبل النهاية");

    if (form.appliesTo === "services" && form.serviceIds.length === 0) {
      return showNotice("اختر خدمة واحدة على الأقل أو خلّه ينطبق على الجميع");
    }

    const normalizedSeq = normalizeSequenceSteps(form.sequenceSteps, form.serviceIds);

    try {
      const id = (editing as any)?.id || makeOfferId();

      // ✅ لو كنت تعدل عرض محذوف: رجّعه (امسح deletedAt)
      const deletedAt = (editing as any)?.deletedAt ? null : undefined;

      const payload: any = {
        id,
        title: form.title.trim(),
        code: form.code.trim(),
        discountType: form.discountType,
        value: Number(form.value),
        startDate: form.startDate || "",
        endDate: form.endDate || "",
        active: Boolean(form.active),
        imageUrl: form.imageUrl || "",

        appliesTo: form.appliesTo,
        serviceIds: form.appliesTo === "services" ? normalizedSeq.map((s) => String(s.serviceId || "").trim()).filter(Boolean) : [],
        sequenceSteps: form.appliesTo === "services" ? normalizedSeq : [],

        usageCount: Number((editing as any)?.usageCount || 0),
        createdAt: (editing as any)?.createdAt,

        ...(deletedAt === null ? { deletedAt: null } : {}),
      };

      await upsertOffer(payload, SALON_ID);
      await refresh();
      close();
    } catch (e: any) {
      console.error("❌ upsertOffer error:", e?.code, e?.message, e);
      showNotice(
        `تعذر حفظ العرض في قاعدة البيانات.\n\ncode: ${String(e?.code || "—")}\nmessage: ${String(
          e?.message || "—"
        )}`
      );
    }
  };

  const toggleActive = async (o: Offer) => {
    try {
      const current = Boolean((o as any).active);
      await upsertOffer({ ...(o as any), id: (o as any).id, active: !current }, SALON_ID);
      await refresh();
    } catch (e: any) {
      console.error("❌ toggleActive error:", e?.code, e?.message, e);
      showNotice("تعذر تحديث حالة العرض.");
    }
  };

  // ✅ حذف ناعم (Soft Delete) بدل حذف نهائي
  const softDelete = async (o: Offer) => {
    if (Number((o as any).usageCount || 0) > 0) return showNotice("لا يمكن حذف عرض مستخدم");
    if (!confirm("حذف العرض (نقل للمحذوفات)؟")) return;

    try {
      await upsertOffer(
        { ...(o as any), id: (o as any).id, active: false, deletedAt: Date.now() } as any,
        SALON_ID
      );
      await refresh();
    } catch (e: any) {
      console.error("❌ softDelete error:", e?.code, e?.message, e);
      showNotice("تعذر حذف العرض.");
    }
  };

  const restore = async (o: Offer) => {
    if (!confirm("استرجاع العرض من المحذوفات؟")) return;

    try {
      await upsertOffer({ ...(o as any), id: (o as any).id, deletedAt: null } as any, SALON_ID);
      await refresh();
      setFilterMode("active_now");
    } catch (e: any) {
      console.error("❌ restore error:", e?.code, e?.message, e);
      showNotice("تعذر استرجاع العرض.");
    }
  };

  // ✅ حذف نهائي (اختياري فقط من تبويب المحذوفات)
  const hardDelete = async (o: Offer) => {
    if (Number((o as any).usageCount || 0) > 0) return showNotice("لا يمكن حذف عرض مستخدم");
    if (!confirm("⚠️ حذف نهائي؟ لا يمكن التراجع")) return;

    try {
      await removeOffer((o as any).id, SALON_ID);
      await refresh();
    } catch (e: any) {
      console.error("❌ removeOffer error:", e?.code, e?.message, e);
      showNotice("تعذر حذف العرض نهائيًا.");
    }
  };

  const onPickImage = async (file: File | null) => {
    if (!file) return;

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_IMAGE_MB) {
      showNotice(`حجم الصورة لازم يكون أقل من ${MAX_IMAGE_MB}MB`);
      return;
    }

    setPickedImageName(file.name);

    const b64 = await fileToBase64(file);
    setForm((p) => ({ ...p, imageUrl: b64 }));
  };

  const toggleServiceId = (id: string) => {
    setForm((p) => {
      const exists = p.serviceIds.includes(id);
      const next = exists ? p.serviceIds.filter((x) => x !== id) : [...p.serviceIds, id];
      const currentSteps = normalizeSequenceSteps(p.sequenceSteps, p.serviceIds);
      const nextSteps = exists
        ? currentSteps.filter((s) => String(s.serviceId || "").trim() !== id).map((s, idx) => ({ ...s, orderIndex: idx }))
        : [...currentSteps, { serviceId: id, orderIndex: currentSteps.length, gapAfterMin: 0 }];
      return { ...p, serviceIds: next, sequenceSteps: nextSteps };
    });
  };

  const moveSequenceStep = (serviceId: string, dir: -1 | 1) => {
    setForm((p) => {
      const steps = normalizeSequenceSteps(p.sequenceSteps, p.serviceIds);
      const idx = steps.findIndex((s) => String(s.serviceId || "").trim() === String(serviceId || "").trim());
      if (idx < 0) return p;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= steps.length) return p;
      const next = [...steps];
      const temp = next[idx];
      next[idx] = next[nextIdx];
      next[nextIdx] = temp;
      return {
        ...p,
        sequenceSteps: next.map((s, i) => ({ ...s, orderIndex: i })),
        serviceIds: next.map((s) => String(s.serviceId || "").trim()).filter(Boolean),
      };
    });
  };

  const updateSequenceStepGap = (serviceId: string, value: number) => {
    setForm((p) => {
      const steps = normalizeSequenceSteps(p.sequenceSteps, p.serviceIds).map((s) =>
        String(s.serviceId || "").trim() === String(serviceId || "").trim()
          ? { ...s, gapAfterMin: Math.max(0, Number(value || 0)) }
          : s
      );
      return { ...p, sequenceSteps: steps };
    });
  };

  const updateSequenceStepTitle = (serviceId: string, value: string) => {
    setForm((p) => {
      const steps = normalizeSequenceSteps(p.sequenceSteps, p.serviceIds).map((s) =>
        String(s.serviceId || "").trim() === String(serviceId || "").trim()
          ? { ...s, titleSnapshot: String(value || "").trim() || undefined }
          : s
      );
      return { ...p, sequenceSteps: steps };
    });
  };

  const packageServiceMap = useMemo(() => {
    const m = new Map<string, PackageServiceRow>();
    packageServices.forEach((s) => m.set(String(s.id), s));
    return m;
  }, [packageServices]);
  const packageComputed = useMemo(() => {
    const picked = (packageDraft.serviceIds || [])
      .map((id) => packageServiceMap.get(String(id || "").trim()))
      .filter(Boolean) as PackageServiceRow[];
    const baseTotalPrice = picked.reduce((sum, s) => sum + Math.max(0, Number(s.price || 0)), 0);
    const totalDurationMin = picked.reduce((sum, s) => sum + Math.max(0, Number(s.durationMin || 0)), 0);
    const finalPrice = Math.max(0, Number(packageDraft.finalPrice || 0));
    const discountAmount = Math.max(0, baseTotalPrice - finalPrice);
    const discountPercent = baseTotalPrice > 0 ? (discountAmount / baseTotalPrice) * 100 : 0;
    const warnOver = Math.max(0, Number(packageDraft.warnDiscountOverPercent || 0));
    return {
      picked,
      baseTotalPrice,
      totalDurationMin,
      finalPrice,
      discountAmount,
      discountPercent,
      warnOver,
      isHighDiscount: warnOver > 0 && discountPercent > warnOver,
      suggestedPrice: baseTotalPrice > 0 ? Math.max(0, Math.round(baseTotalPrice * (1 - warnOver / 100))) : 0,
    };
  }, [packageDraft, packageServiceMap]);
  const filteredPackageServices = useMemo(() => {
    const q = String(packageServiceSearch || "").trim().toLowerCase();
    if (!q) return packageServices;
    return packageServices.filter((s) => {
      const hay = `${s.name} ${s.price} ${s.durationMin}`.toLowerCase();
      return hay.includes(q);
    });
  }, [packageServices, packageServiceSearch]);
  const selectedPackageServices = useMemo(
    () => filteredPackageServices.filter((s) => packageDraft.serviceIds.includes(s.id)),
    [filteredPackageServices, packageDraft.serviceIds]
  );
  const unselectedPackageServices = useMemo(
    () => filteredPackageServices.filter((s) => !packageDraft.serviceIds.includes(s.id)),
    [filteredPackageServices, packageDraft.serviceIds]
  );
  const sectionTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    Object.entries(pricingSections).forEach(([secId, sec]) => {
      map.set(String(secId || "").trim(), String(sec?.title || "").trim());
    });
    return map;
  }, []);
  const groupPackageServices = (rows: PackageServiceRow[]) => {
    const groups = new Map<string, { title: string; services: PackageServiceRow[] }>();
    rows.forEach((s) => {
      const sectionTitle = normalizeGroupLabel(
        sectionTitleMap.get(String(s.sectionId || "").trim()) ||
          String(s.sectionId || "").trim() ||
          "قسم غير محدد"
      );
      const categoryTitle = normalizeGroupLabel(
        String(s.categoryName || "").trim() ||
          String(s.categoryId || "").trim() ||
          "تصنيف غير محدد"
      );
      const same =
        categoryTitle === sectionTitle ||
        categoryTitle.replace(/^قسم\s+/, "") === sectionTitle.replace(/^قسم\s+/, "");
      const fullTitle = same ? sectionTitle : `${sectionTitle} > ${categoryTitle}`;
      const key = `${sectionTitle}__${categoryTitle}`;
      const current = groups.get(key) || { title: fullTitle, services: [] };
      current.services.push(s);
      groups.set(key, current);
    });
    const collator = new Intl.Collator("ar", { sensitivity: "base", numeric: true });
    return Array.from(groups.values())
      .map((g) => ({
        ...g,
        services: [...g.services].sort((a, b) => collator.compare(String(a.name || ""), String(b.name || ""))),
      }))
      .sort((a, b) => collator.compare(a.title, b.title));
  };
  const selectedPackageGroups = useMemo(() => groupPackageServices(selectedPackageServices), [selectedPackageServices, sectionTitleMap]);
  const unselectedPackageGroups = useMemo(() => groupPackageServices(unselectedPackageServices), [unselectedPackageServices, sectionTitleMap]);
  const visibleSelectedGroups = useMemo(
    () => (packageListMode === "unselected" ? [] : selectedPackageGroups),
    [packageListMode, selectedPackageGroups]
  );
  const visibleUnselectedGroups = useMemo(
    () => (packageListMode === "selected" ? [] : unselectedPackageGroups),
    [packageListMode, unselectedPackageGroups]
  );
  const isPackageGroupOpen = (key: string, defaultOpen: boolean) => {
    const saved = packageOpenGroups[key];
    return typeof saved === "boolean" ? saved : defaultOpen;
  };
  const togglePackageGroup = (key: string) => {
    setPackageOpenGroups((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  };
  const selectAllVisiblePackageServices = () => {
    const visibleIds = filteredPackageServices.map((s) => s.id);
    if (!visibleIds.length) return;
    setPackageDraft((prev) => ({
      ...prev,
      serviceIds: Array.from(new Set([...prev.serviceIds, ...visibleIds])),
    }));
  };
  const clearVisiblePackageServices = () => {
    const visibleIds = new Set(filteredPackageServices.map((s) => s.id));
    setPackageDraft((prev) => ({
      ...prev,
      serviceIds: prev.serviceIds.filter((id) => !visibleIds.has(id)),
    }));
  };
  const resetPackageDraft = () => {
    setEditingPackageId("");
    setPackagePickedImageName("");
    setPackageDraft({
      id: "",
      name: "",
      description: "",
      imageUrl: "",
      active: true,
      serviceIds: [],
      finalPrice: 0,
      warnDiscountOverPercent: MAX_PACKAGE_DISCOUNT_WARN_PERCENT,
    });
  };
  const openPackageForEdit = (pkg: ServicePackageDoc) => {
    setEditingPackageId(String(pkg.id || "").trim());
    setPackagePickedImageName(String(pkg.imageUrl || "").trim() ? "تم اختيار صورة" : "");
    setPackageDraft({
      id: String(pkg.id || "").trim(),
      name: String(pkg.name || "").trim(),
      description: String(pkg.description || "").trim(),
      imageUrl: String(pkg.imageUrl || "").trim(),
      active: pkg.active !== false,
      serviceIds: Array.isArray(pkg.serviceIds) ? pkg.serviceIds : [],
      finalPrice: Math.max(0, Number(pkg.finalPrice || 0)),
      warnDiscountOverPercent: Math.max(0, Number(pkg.warnDiscountOverPercent || MAX_PACKAGE_DISCOUNT_WARN_PERCENT)),
    });
  };
  const toggleDraftServiceId = (serviceId: string) => {
    const id = String(serviceId || "").trim();
    if (!id) return;
    setPackageDraft((prev) => {
      const exists = prev.serviceIds.includes(id);
      return { ...prev, serviceIds: exists ? prev.serviceIds.filter((x) => x !== id) : [...prev.serviceIds, id] };
    });
  };
  const onPickPackageImage = async (file: File | null) => {
    if (!file) return;
    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_PACKAGE_IMAGE_MB) {
      showNotice(`حجم صورة الباكيج يجب أن يكون أقل من ${MAX_PACKAGE_IMAGE_MB}MB`);
      return;
    }
    const b64 = await fileToBase64(file);
    setPackagePickedImageName(file.name);
    setPackageDraft((prev) => ({ ...prev, imageUrl: b64 }));
  };
  const savePackageDraft = async () => {
    const name = String(packageDraft.name || "").trim();
    if (!name) return showNotice("اكتب اسم الباكيج");
    if (!packageComputed.picked.length) return showNotice("اختر خدمة واحدة على الأقل");
    if (packageComputed.totalDurationMin <= 0) return showNotice("مدة الباكيج غير صحيحة");
    const id = String(packageDraft.id || "").trim() || buildId(`pkg_${name}`);
    const services: PackageServiceItem[] = packageComputed.picked.map((s) => ({
      serviceId: String(s.id || "").trim(),
      serviceName: String(s.name || "").trim(),
      sectionId: String(s.sectionId || "").trim() || undefined,
      categoryId: String(s.categoryId || "").trim() || undefined,
      price: Math.max(0, Number(s.price || 0)),
      durationMin: Math.max(0, Number(s.durationMin || 0)),
    }));
    await upsertPackage(
      {
        id,
        name,
        description: String(packageDraft.description || "").trim() || undefined,
        imageUrl: String(packageDraft.imageUrl || "").trim() || undefined,
        active: packageDraft.active !== false,
        serviceIds: services.map((x) => x.serviceId),
        services,
        baseTotalPrice: packageComputed.baseTotalPrice,
        totalDurationMin: packageComputed.totalDurationMin,
        finalPrice: packageComputed.finalPrice,
        discountAmount: packageComputed.discountAmount,
        discountPercent: packageComputed.discountPercent,
        warnDiscountOverPercent: packageComputed.warnOver || MAX_PACKAGE_DISCOUNT_WARN_PERCENT,
      },
      SALON_ID
    );
    const sequenceSteps = services.map((s, idx) => ({
      serviceId: String(s.serviceId || "").trim(),
      orderIndex: idx,
      gapAfterMin: 0,
      titleSnapshot: String(s.serviceName || "").trim() || undefined,
    }));
    await upsertOffer(
      {
        id,
        title: name,
        code: String(id || "").trim().toUpperCase(),
        discountType: "fixed",
        value: 0,
        startDate: "",
        endDate: "",
        active: packageDraft.active !== false,
        imageUrl: String(packageDraft.imageUrl || "").trim() || "",
        appliesTo: "services",
        serviceIds: sequenceSteps.map((x) => x.serviceId),
        sequenceSteps,
        usageCount: 0,
        packageFinalPrice: packageComputed.finalPrice,
        packageBaseTotalPrice: packageComputed.baseTotalPrice,
        packageTotalDurationMin: packageComputed.totalDurationMin,
        packageDescription: String(packageDraft.description || "").trim() || undefined,
      } as any,
      SALON_ID
    );
    await refresh();
    resetPackageDraft();
  };
  const deletePackageById = async (idRaw: string) => {
    const id = String(idRaw || "").trim();
    if (!id) return;
    if (!confirm("هل أنت متأكد من حذف هذا الباكيج؟")) return;
    await removePackage(id, SALON_ID);
    await refresh();
    if (editingPackageId === id) resetPackageDraft();
  };

  return (
    <div className="dashboard-skin offers-page">
      {inlineNotice ? (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            borderRadius: 12,
            padding: "10px 14px",
            fontWeight: 700,
            background: inlineNotice.type === "success" ? "rgba(22,163,74,0.12)" : "rgba(127,29,29,0.10)",
            color: inlineNotice.type === "success" ? "#166534" : "#7f1d1d",
            border: inlineNotice.type === "success" ? "1px solid rgba(22,163,74,0.25)" : "1px solid rgba(127,29,29,0.22)",
          }}
        >
          {inlineNotice.text}
        </div>
      ) : null}
      {/* Header */}
      <div className="offers-header">
        <div className="offers-head-main">
          <h1>
            <FontAwesomeIcon icon={faTag} /> العروض والكوبونات
          </h1>
          <p className="offers-sub">فلترة: سارية / مجدولة / منتهية / محذوفة + نطاق (الكل/خدمات)</p>
          <div className="offers-kpis">
            <div className="offers-kpi">
              <span>إجمالي العروض</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="offers-kpi">
              <span>السارية الآن</span>
              <strong>{stats.activeNowCount}</strong>
            </div>
            <div className="offers-kpi">
              <span>المستخدمة</span>
              <strong>{stats.used}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="offers-card pkgm">
        <div className="offers-card-title"><FontAwesomeIcon icon={faTag} /> 4) الباكيجات (Package Offer)</div>
        <div className="pkgm__row">
          <div className="pkgm__field">
            <label>معرف الباكيج (اختياري)</label>
            <input value={packageDraft.id} placeholder="pkg_hair_skin_combo" onChange={(e) => setPackageDraft((p) => ({ ...p, id: buildId(e.target.value) }))} />
          </div>
          <div className="pkgm__field">
            <label>اسم الباكيج</label>
            <input value={packageDraft.name} placeholder="مثال: باكيج العناية الشامل" onChange={(e) => setPackageDraft((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="pkgm__field">
            <label>سعر الباكيج النهائي</label>
            <input type="number" min={0} value={packageDraft.finalPrice} onChange={(e) => setPackageDraft((p) => ({ ...p, finalPrice: Math.max(0, Number(e.target.value || 0)) }))} />
          </div>
        </div>
        <div className="pkgm__field">
          <label>وصف العرض</label>
          <textarea value={packageDraft.description} placeholder="وصف مختصر للعرض" onChange={(e) => setPackageDraft((p) => ({ ...p, description: e.target.value }))} />
        </div>
        <div className="pkgm__row pkgm__row--center">
          <label className="dash-pill dash-pill-outline" style={{ cursor: "pointer" }}>
            اختيار صورة الباكيج
            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPickPackageImage(e.target.files?.[0] || null)} />
          </label>
          <span className="offers-hint">{packagePickedImageName || `أقل من ${MAX_PACKAGE_IMAGE_MB}MB`}</span>
          {packageDraft.imageUrl && (
            <button type="button" className="dash-pill dash-pill-danger" onClick={() => { setPackagePickedImageName(""); setPackageDraft((p) => ({ ...p, imageUrl: "" })); }}>
              إزالة الصورة
            </button>
          )}
          <label className="of-checkline" style={{ marginInlineStart: "auto" }}>
            <input type="checkbox" checked={packageDraft.active !== false} onChange={() => setPackageDraft((p) => ({ ...p, active: !p.active }))} />
            <span>مفعل في صفحة الحجز</span>
          </label>
        </div>
        <div className="pkgm__row">
          <div className="pkgm__field" style={{ maxWidth: 240 }}>
            <label>تنبيه إذا الخصم تجاوز (%)</label>
            <input
              type="number"
              min={0}
              max={95}
              value={packageDraft.warnDiscountOverPercent}
              onChange={(e) =>
                setPackageDraft((p) => ({
                  ...p,
                  warnDiscountOverPercent: Math.max(
                    0,
                    Math.min(95, Number(e.target.value || 0))
                  ),
                }))
              }
            />
          </div>
        </div>
        <div className="pkgm__services-toolbar">
          <input
            type="text"
            value={packageServiceSearch}
            onChange={(e) => setPackageServiceSearch(e.target.value)}
            placeholder="ابحث عن خدمة داخل الباكيج..."
          />
          <div className="pkgm__services-actions">
            <button type="button" className="dash-pill dash-pill-outline dash-pill-sm" onClick={selectAllVisiblePackageServices}>
              تحديد الكل
            </button>
            <button type="button" className="dash-pill dash-pill-outline dash-pill-sm" onClick={clearVisiblePackageServices}>
              إلغاء المحدد
            </button>
          </div>
        </div>
        <div className="pkgm__list-mode">
          <button
            type="button"
            className={`dash-pill dash-pill-sm ${packageListMode === "all" ? "dash-pill-primary" : "dash-pill-outline"}`}
            onClick={() => setPackageListMode("all")}
          >
            الكل
          </button>
          <button
            type="button"
            className={`dash-pill dash-pill-sm ${packageListMode === "selected" ? "dash-pill-primary" : "dash-pill-outline"}`}
            onClick={() => setPackageListMode("selected")}
          >
            المحددة فقط
          </button>
          <button
            type="button"
            className={`dash-pill dash-pill-sm ${packageListMode === "unselected" ? "dash-pill-primary" : "dash-pill-outline"}`}
            onClick={() => setPackageListMode("unselected")}
          >
            غير المحددة
          </button>
        </div>
        {!!selectedPackageServices.length && (
          <div className="pkgm__selected-summary">
            <strong>المحدد الآن:</strong> {selectedPackageServices.length} خدمة
            <span className="pkgm__selected-names">
              {selectedPackageServices
                .slice(0, 4)
                .map((s) => s.name)
                .join("، ")}
              {selectedPackageServices.length > 4 ? " ..." : ""}
            </span>
          </div>
        )}
        <div className="pkgm__services">
          {visibleSelectedGroups.length > 0 && (
            <div className="pkgm__group-title">الخدمات المحددة ({selectedPackageServices.length})</div>
          )}
          {visibleSelectedGroups.map((group, idx) => {
            const key = `sel::${group.title}`;
            const open = isPackageGroupOpen(key, idx === 0);
            return (
            <div key={group.title} className="pkgm__group">
              <button type="button" className="pkgm__group-toggle" onClick={() => togglePackageGroup(key)}>
                <span className="pkgm__group-toggle-label">{group.title}</span>
                <span className="pkgm__group-toggle-caret">{open ? "−" : "+"}</span>
              </button>
              {open && (
                <div className="pkgm__group-items">
                  {group.services.map((s) => (
                    <button key={s.id} type="button" className="pkgm__service is-selected pkgm__service-row" onClick={() => toggleDraftServiceId(s.id)}>
                      <div className="pkgm__service-main">
                        <span className="pkgm__service-name">{s.name}</span>
                        <span className="pkgm__service-meta">{s.price} ر.س • {s.durationMin} د</span>
                      </div>
                      <span className="pkgm__service-status">
                        <FontAwesomeIcon icon={faCheck} /> محدد
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )})}
          {visibleUnselectedGroups.length > 0 && <div className="pkgm__group-title">باقي الخدمات ({unselectedPackageServices.length})</div>}
          {visibleUnselectedGroups.map((group, idx) => {
            const key = `unsel::${group.title}`;
            const open = isPackageGroupOpen(key, idx === 0 && !visibleSelectedGroups.length);
            return (
            <div key={group.title} className="pkgm__group">
              <button type="button" className="pkgm__group-toggle" onClick={() => togglePackageGroup(key)}>
                <span className="pkgm__group-toggle-label">{group.title}</span>
                <span className="pkgm__group-toggle-caret">{open ? "−" : "+"}</span>
              </button>
              {open && (
                <div className="pkgm__group-items">
                  {group.services.map((s) => (
                    <button key={s.id} type="button" className="pkgm__service pkgm__service-row" onClick={() => toggleDraftServiceId(s.id)}>
                      <div className="pkgm__service-main">
                        <span className="pkgm__service-name">{s.name}</span>
                        <span className="pkgm__service-meta">{s.price} ر.س • {s.durationMin} د</span>
                      </div>
                      <span className="pkgm__service-status">اختيار</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )})}
          {!filteredPackageServices.length && <div className="pkgm__empty">لا توجد خدمات مطابقة للبحث</div>}
        </div>
        <div className="pkgm__stats">
          <span>الخدمات المختارة: {packageComputed.picked.length}</span>
          <span>إجمالي قبل الخصم: {Math.round(packageComputed.baseTotalPrice)} ر.س</span>
          <span>مدة الباكيج: {Math.round(packageComputed.totalDurationMin)} دقيقة</span>
          <span>قيمة الخصم: {Math.round(packageComputed.discountAmount)} ر.س</span>
          <span>نسبة الخصم: {packageComputed.discountPercent.toFixed(1)}%</span>
        </div>
        {packageComputed.isHighDiscount && (
          <div className="pkgm__warn">
            الخصم الحالي {packageComputed.discountPercent.toFixed(1)}% أعلى من الحد ({packageComputed.warnOver}%).
            سعر مقترح: {packageComputed.suggestedPrice} ر.س. يمكنك الحفظ كما هو.
          </div>
        )}
        <div className="pkgm__actions">
          <button type="button" className="dash-pill dash-pill-primary" onClick={savePackageDraft}>{editingPackageId ? "تحديث الباكيج" : "حفظ الباكيج"}</button>
          {editingPackageId && (
            <button type="button" className="dash-pill dash-pill-primary" onClick={savePackageDraft}>
              حفظ التعديلات
            </button>
          )}
          <button type="button" className="dash-pill dash-pill-outline" onClick={resetPackageDraft}>تفريغ النموذج</button>
        </div>
        <div className="table-responsive" style={{ marginTop: 10 }}>
          <table className="offers-table">
            <thead>
              <tr>
                <th>الاسم</th><th>الخدمات</th><th>السعر قبل</th><th>السعر النهائي</th><th>المدة</th><th>الخصم</th><th>تعديل</th><th>حذف</th>
              </tr>
            </thead>
            <tbody>
              {packagesCatalog.map((p) => (
                <tr key={p.id}>
                  <td data-label="الاسم">{p.name || p.id}</td>
                  <td data-label="الخدمات">{Array.isArray(p.serviceIds) ? p.serviceIds.length : 0}</td>
                  <td data-label="السعر قبل">{Math.round(Number(p.baseTotalPrice || 0))} ر.س</td>
                  <td data-label="السعر النهائي">{Math.round(Number(p.finalPrice || 0))} ر.س</td>
                  <td data-label="المدة">{Math.round(Number(p.totalDurationMin || 0))} د</td>
                  <td data-label="الخصم">{Number(p.discountPercent || 0).toFixed(1)}%</td>
                  <td data-label="تعديل"><button type="button" className="dash-pill dash-pill-outline dash-pill-sm" onClick={() => openPackageForEdit(p)}>تعديل</button></td>
                  <td data-label="حذف"><button type="button" className="dash-pill dash-pill-danger dash-pill-sm" onClick={() => deletePackageById(p.id)}>حذف</button></td>
                </tr>
              ))}
              {!packagesCatalog.length && <tr><td colSpan={8} style={{ textAlign: "center", padding: 12 }}>لا توجد باكيجات محفوظة</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters + Add */}
      <div className="offers-card">
        <div className="offers-card-title">
          <FontAwesomeIcon icon={faFilter} /> فلترة + بحث
        </div>

        <div className="offers-row offers-row--filters">
          <div className="offers-filter-pills">
            <button
              type="button"
              className={`dash-pill dash-pill-sm ${filterMode === "active_now" ? "dash-pill-primary" : "dash-pill-outline"}`}
              onClick={() => setFilterMode("active_now")}
            >
              سارية الآن ({stats.activeNowCount})
            </button>

            <button
              type="button"
              className={`dash-pill dash-pill-sm ${filterMode === "scheduled" ? "dash-pill-primary" : "dash-pill-outline"}`}
              onClick={() => setFilterMode("scheduled")}
            >
              مجدولة ({stats.scheduledCount})
            </button>

            <button
              type="button"
              className={`dash-pill dash-pill-sm ${filterMode === "expired" ? "dash-pill-primary" : "dash-pill-outline"}`}
              onClick={() => setFilterMode("expired")}
            >
              منتهية/موقوفة ({stats.expiredCount})
            </button>

            <button
              type="button"
              className={`dash-pill dash-pill-sm ${filterMode === "deleted" ? "dash-pill-danger" : "dash-pill-outline"}`}
              onClick={() => setFilterMode("deleted")}
            >
              محذوفة ({stats.deletedCount})
            </button>
          </div>

          <div className="offers-search offers-search--wide">
            <FontAwesomeIcon className="offers-search-ic" icon={faMagnifyingGlass} />
            <input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="بحث بالعنوان أو الكود..." />
          </div>

          <button className="dash-pill dash-pill-primary offers-add-btn" type="button" onClick={openAdd}>
            <FontAwesomeIcon icon={faPlus} /> إضافة عرض
          </button>
        </div>

        <div className="offers-hint">
          إجمالي (بدون المحذوف): {stats.total} — عروض مستخدمة: {stats.used}
        </div>
      </div>


      {/* Table */}
      <div className="offers-table-card">
        <div className="table-responsive">
          <table className="offers-table">
            <thead>
              <tr>
                <th>صورة</th>
                <th>العنوان</th>
                <th>الكود</th>
                <th>الخصم</th>
                <th>الفترة</th>
                <th>الحالة</th>
                <th>الاستخدام</th>
                <th>النطاق</th>
                <th>تحكم</th>
              </tr>
            </thead>

            <tbody>
              {filteredOffers.length === 0 ? (
                <tr>
                  <td colSpan={9} data-label=" " style={{ textAlign: "center", padding: 16 }}>
                    لا توجد عروض مطابقة
                  </td>
                </tr>

              ) : (
                filteredOffers.map((o: any) => {
                  const deleted = isDeleted(o);
                  const scheduled = isScheduledByToday(o) && !isExpiredByToday(o) && !deleted;
                  const expired = isExpiredByToday(o) && !deleted;

                  const statusLabel = deleted ? "محذوف" : scheduled ? "مجدول" : expired ? "منتهي" : o.active ? "نشط" : "موقوف";

                  return (
                    <tr key={o.id} style={{ verticalAlign: "middle" }}>
                      <td data-label="صورة">
                        {o.imageUrl ? (
                          <img className="of-img" src={o.imageUrl} alt="offer" />
                        ) : (
                          <span style={{ opacity: 0.6 }}>—</span>
                        )}
                      </td>

                      <td data-label="العنوان">{o.title}</td>

                      <td data-label="الكود">{o.code}</td>

                      <td data-label="الخصم">
                        {o.discountType === "percent" ? `${o.value}%` : `${o.value} ريال`}
                      </td>

                      <td data-label="الفترة">
                        {o.startDate || "—"} → {o.endDate || "—"}
                      </td>

                      <td data-label="الحالة">{statusLabel}</td>

                      <td data-label="الاستخدام">{o.usageCount || 0}</td>

                      <td data-label="النطاق">
                        {(o.appliesTo || "all") === "services" ? "خدمات محددة" : "الكل"}
                      </td>

                      <td data-label="تحكم">
                        <div className="of-actions" style={{ flexWrap: "wrap" }}>
                          {!deleted && (
                            <>
                              <button
                                className="dash-pill dash-pill-outline dash-pill-sm"
                                type="button"
                                onClick={() => openEdit(o)}
                              >
                                <FontAwesomeIcon icon={faPen} /> تعديل
                              </button>

                              <button
                                className={`dash-pill ${o.active ? "dash-pill-warning" : "dash-pill-success"
                                  } dash-pill-sm`}
                                type="button"
                                onClick={() => toggleActive(o)}
                                title={o.active ? "إيقاف" : "تفعيل"}
                              >
                                <FontAwesomeIcon icon={o.active ? faBan : faCheck} />
                                {o.active ? " إيقاف" : " تفعيل"}
                              </button>

                              <button
                                className="dash-pill dash-pill-danger dash-pill-sm"
                                type="button"
                                onClick={() => softDelete(o)}
                              >
                                <FontAwesomeIcon icon={faTrash} /> حذف
                              </button>
                            </>
                          )}

                          {deleted && (
                            <>
                              <button
                                className="dash-pill dash-pill-success dash-pill-sm"
                                type="button"
                                onClick={() => restore(o)}
                              >
                                <FontAwesomeIcon icon={faRotateLeft} /> استرجاع
                              </button>

                              <button
                                className="dash-pill dash-pill-danger dash-pill-sm"
                                type="button"
                                onClick={() => hardDelete(o)}
                              >
                                <FontAwesomeIcon icon={faSkullCrossbones} /> حذف نهائي
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );

                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      <Modal
        open={open}
        onClose={close}
        ariaLabel={editing ? "Edit offer" : "Add offer"}
        overlayClassName="dash-modal-overlay offers-modal-overlay"
        panelClassName="dash-modal offers-modal offers-modal--fullscreen"
      >
            {/* Header (Fixed) */}
            <div className="of-modal-head">
              <div className="of-modal-title">
                <h3>{editing ? "تعديل عرض" : "إضافة عرض"}</h3>
                <span className="of-modal-sub">املأ البيانات ثم اختر النطاق والصورة</span>
              </div>

              <button className="dash-pill dash-pill-outline dash-pill-sm" type="button" onClick={close}>
                <FontAwesomeIcon icon={faXmark} /> إغلاق
              </button>
            </div>

            {/* Body */}
            <div className="of-form">
              <div className="of-section">
                <div className="of-grid-2a">
                  <div>
                    <label>العنوان</label>
                    <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="مثال: خصم نهاية الأسبوع" />
                  </div>

                  <div className="of-field-inline">
                    <div style={{ flex: 1 }}>
                      <label>الكود</label>
                      <input value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))} placeholder="QS123" />
                    </div>

                    <button
                      className="dash-pill dash-pill-outline dash-pill-sm"
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, code: generateCode() }))}
                      title="توليد كود"
                    >
                      <FontAwesomeIcon icon={faWandMagicSparkles} /> توليد
                    </button>
                  </div>
                </div>

                <div className="of-grid-3">
                  <div>
                    <label>نوع الخصم</label>

                    {/* ✅ Custom Dropdown بدل select */}
                    <div className="dash-dd-wrap" ref={discountWrapRef}>
                      <button type="button" className="dash-select" onClick={() => setDiscountOpen((s) => !s)} aria-expanded={discountOpen}>
                        {discountLabel}
                      </button>

                      {discountOpen && (
                        <div className="dash-dd-menu" role="listbox">
                          {discountOptions.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              className={`dash-dd-item ${form.discountType === opt.value ? "is-active" : ""}`}
                              onClick={() => {
                                setForm((p) => ({ ...p, discountType: opt.value }));
                                setDiscountOpen(false);
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <label>القيمة</label>
                    <input
                      type="number"
                      value={form.value}
                      onChange={(e) => setForm((p) => ({ ...p, value: Number(e.target.value) }))}
                      placeholder="مثال: 50"
                    />
                  </div>

                  <div className="of-switch">
                    <label className="of-checkline">
                      <input type="checkbox" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} />
                      <span>العرض نشط</span>
                    </label>
                  </div>
                </div>

                <div className="of-grid-2">
                  <div>
                    <label>تاريخ البداية</label>
                    <input type="date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))} />
                  </div>

                  <div>
                    <label>تاريخ النهاية</label>
                    <input type="date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* نطاق العرض */}
              <div className="of-section of-scope">
                <div className="of-scope-top">
                  <div className="of-scope-title">نطاق العرض</div>
                  <div className="of-scope-hint">اختر “خدمات محددة” إذا تبي العرض على خدمات بعينها.</div>
                </div>

                <div className="of-scope-pills">
                  <label className="of-pill">
                    <input
                      type="radio"
                      name="offerScope"
                      checked={form.appliesTo === "all"}
                      onChange={() => setForm((p) => ({ ...p, appliesTo: "all", serviceIds: [], sequenceSteps: [] }))}
                    />
                    <span>ينطبق على جميع الخدمات</span>
                  </label>

                  <label className="of-pill">
                    <input
                      type="radio"
                      name="offerScope"
                      checked={form.appliesTo === "services"}
                      onChange={() => setForm((p) => ({ ...p, appliesTo: "services" }))}
                    />
                    <span>ينطبق على خدمات محددة</span>
                  </label>
                </div>

                {form.appliesTo === "services" && (
                  <>
                    <div className="of-services-search">
                      <FontAwesomeIcon className="of-services-ic" icon={faMagnifyingGlass} />
                      <input value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder="بحث داخل الخدمات..." />
                    </div>

                    <div className="of-services-box">
                      <table className="of-services-table">
                        <thead>
                          <tr>
                            <th style={{ width: 76 }}>اختيار</th>
                            <th>الخدمة</th>
                            <th style={{ width: 120 }}>السعر</th>
                          </tr>
                        </thead>

                        <tbody>
                          {servicesGrouped.length === 0 ? (
                            <tr>
                              <td colSpan={3} style={{ textAlign: "center", padding: 14 }}>
                                لا توجد خدمات
                              </td>
                            </tr>
                          ) : (
                            servicesGrouped.map(([groupName, list]) => (
                              <React.Fragment key={groupName}>
                                <tr className="of-group-row">
                                  <td colSpan={3}>{groupName}</td>
                                </tr>

                                {list.map((s) => (
                                  <tr key={s.id}>
                                    <td>
                                      <label className="of-check">
                                        <input
                                          type="checkbox"
                                          checked={form.serviceIds.includes(s.id)}
                                          onChange={() => toggleServiceId(s.id)}
                                        />
                                      </label>
                                    </td>
                                    <td>{s.name}</td>
                                    <td>{s.basePrice} ريال</td>
                                  </tr>
                                ))}
                              </React.Fragment>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {normalizeSequenceSteps(form.sequenceSteps, form.serviceIds).length > 0 && (
                      <div className="of-services-box" style={{ marginTop: 12 }}>
                        <div className="offers-hint" style={{ marginBottom: 8 }}>
                          تسلسل العرض (`sequenceSteps`) - مصدر الحقيقة للحجز التسلسلي
                        </div>
                        <table className="of-services-table">
                          <thead>
                            <tr>
                              <th style={{ width: 90 }}>الترتيب</th>
                              <th>الخدمة</th>
                              <th style={{ width: 140 }}>gapAfterMin</th>
                              <th>titleSnapshot</th>
                              <th style={{ width: 130 }}>تحكم</th>
                            </tr>
                          </thead>
                          <tbody>
                            {normalizeSequenceSteps(form.sequenceSteps, form.serviceIds).map((step, idx, arr) => {
                              const svc = serviceById.get(String(step.serviceId || "").trim());
                              const label = String(
                                step.titleSnapshot ||
                                  svc?.name ||
                                  step.serviceId
                              ).trim();
                              return (
                                <tr key={`seq-step-${step.serviceId}`}>
                                  <td>{idx + 1}</td>
                                  <td>{label}</td>
                                  <td>
                                    <input
                                      type="number"
                                      min={0}
                                      value={Math.max(0, Number(step.gapAfterMin || 0))}
                                      onChange={(e) => updateSequenceStepGap(step.serviceId, Number(e.target.value || 0))}
                                    />
                                  </td>
                                  <td>
                                    <input
                                      value={String(step.titleSnapshot || "")}
                                      placeholder={String(svc?.name || "اسم بديل اختياري")}
                                      onChange={(e) => updateSequenceStepTitle(step.serviceId, e.target.value)}
                                    />
                                  </td>
                                  <td>
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <button
                                        type="button"
                                        className="dash-pill dash-pill-outline dash-pill-sm"
                                        disabled={idx === 0}
                                        onClick={() => moveSequenceStep(step.serviceId, -1)}
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        className="dash-pill dash-pill-outline dash-pill-sm"
                                        disabled={idx === arr.length - 1}
                                        onClick={() => moveSequenceStep(step.serviceId, 1)}
                                      >
                                        ↓
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* صورة العرض */}
              <div className="of-section">
                <label className="of-label-inline">
                  <FontAwesomeIcon icon={faImage} /> صورة العرض <span className="of-mute">(أقل من {MAX_IMAGE_MB}MB)</span>
                </label>

                <div className="of-file-row">
                  <label className="of-file-btn">
                    <input type="file" accept="image/*" onChange={(e) => onPickImage(e.target.files?.[0] || null)} />
                    اختيار ملف
                  </label>

                  <div className="of-file-name">{pickedImageName || "لم يتم اختيار أي ملف"}</div>
                </div>

                {form.imageUrl ? (
                  <div className="of-image-preview">
                    <img src={form.imageUrl} alt="preview" />
                    <button
                      className="dash-pill dash-pill-outline dash-pill-sm"
                      type="button"
                      onClick={() => {
                        setPickedImageName("");
                        setForm((p) => ({ ...p, imageUrl: "" }));
                      }}
                    >
                      إزالة الصورة
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Footer (Fixed) */}
            <div className="of-modal-actions">
              <button className="dash-pill dash-pill-primary" type="button" onClick={save}>
                حفظ
              </button>
              <button className="dash-pill dash-pill-outline" type="button" onClick={close}>
                إلغاء
              </button>
            </div>
      </Modal>
    </div>
  );
};

export default DashboardOffers;
