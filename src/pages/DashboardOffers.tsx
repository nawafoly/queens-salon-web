import DashboardNumberInputV2 from "../components/dashboard-v2/DashboardNumberInputV2";
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
import { DashboardDatePickerV2, DashboardSelectV2 } from "../components/dashboard-v2";
import "../styles/dashboard-v2/dashboard-v2.css";
import { CoreCatalogService } from "../services/CoreCatalogService";
import {
  PackageService,
  type Package as CorePackage,
} from "../services/PackageService";

// Core-only offers and package catalog.
import { listOffers, upsertOffer, removeOffer } from "../services/firestoreOffers";
import type { Offer, DiscountType, OfferAppliesTo, OfferSequenceStep } from "../services/firestoreOffers";
type DashboardPackage = CorePackage & { id: string };

type OfferForm = {
  title: string;
  description: string;
  code: string;
  discountType: DiscountType;
  value: number;
  priceBefore: number;
  priceAfter: number;
  startDate: string;
  endDate: string;
  active: boolean;
  published: boolean;
  status: "draft" | "scheduled" | "active" | "expired" | "disabled";
  sortOrder: number;
  ctaLabel: string;
  ctaUrl: string;
  targetScope: "all" | "specific";
  targetClientIdsText: string;
  imageUrl?: string;

  usageLimit: number;
  minOrder: number;
  maxDiscount: number;
  perClientLimit: number;

  appliesTo: OfferAppliesTo;
  serviceIds: string[];
  categoryIds: string[];
  sequenceSteps: OfferSequenceStep[];
};

type OfferFilterMode = "all" | "active_now" | "scheduled" | "expired" | "deleted";
type PackageServiceRow = {
  id: string;
  name: string;
  sectionId: string;
  sectionTitle?: string;
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
  saleEnabled: boolean;
  startDate: string;
  endDate: string;
  serviceIds: string[];
  sessionsCount: number;
  price: number;
  validityDays: number;
  terms: string;
  audienceScope: string;
  targetClientIdsText: string;
  sortOrder: number;
};
type PackageListMode = "all" | "selected" | "unselected";

const OFFER_STATUS_OPTIONS = [
  { value: "draft", label: "مسودة" },
  { value: "scheduled", label: "مجدول" },
  { value: "active", label: "نشط" },
  { value: "expired", label: "منتهي" },
  { value: "disabled", label: "موقوف" },
] as const;

const MAX_IMAGE_MB = 2;
const MAX_PACKAGE_IMAGE_MB = 2;
const SALON_ID = "main";

function roundToTwoDecimals(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function hasAtMostTwoDecimals(value: unknown): boolean {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  return Math.abs(number * 100 - Math.round(number * 100)) < 1e-8;
}

const offerFieldLabels: Record<string, string> = {
  value: "قيمة الخصم",
  usageLimit: "إجمالي مرات الاستخدام",
  usedCount: "عدد مرات الاستخدام الحالية",
  minOrderHalalas: "الحد الأدنى للطلب",
  maxDiscountHalalas: "الحد الأعلى للخصم",
  perClientLimit: "الحد لكل عميلة",
  priceBeforeHalalas: "السعر قبل الخصم",
  priceAfterHalalas: "السعر بعد الخصم",
  sortOrder: "ترتيب الظهور",
};

function getOfferSaveErrorMessage(error: any): string {
  const serverMessage = String(error?.details?.message || error?.details?.error || "").trim();
  const field = Object.keys(offerFieldLabels).find((key) => serverMessage.startsWith(`${key} `));
  if (field) {
    const requirement = error?.code === "core_validation:invalid_integer"
      ? "يجب أن تكون قيمته عددًا صحيحًا ضمن النطاق المسموح."
      : "القيمة المدخلة غير صحيحة.";
    return `${offerFieldLabels[field]}: ${requirement}`;
  }
  if (error?.code === "core_validation:invalid_integer") {
    return "أحد الحقول العددية غير صحيح. راجع حدود الاستخدام والأسعار وترتيب الظهور.";
  }
  if (error?.code === "core_validation:invalid_number") {
    return "قيمة الخصم غير صحيحة. استخدم رقمًا موجبًا وبحد أقصى منزلتين عشريتين.";
  }
  return String(error?.message || "تعذر حفظ العرض في قاعدة البيانات.");
}

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

function resolveSectionLabel(raw: string) {
  const src = String(raw || "").trim();
  const x = normalizeGroupLabel(src);
  const lower = src.toLowerCase();
  const map: Record<string, string> = {
    services: "الخدمات",
    service: "الخدمات",
    "nail care": "العناية بالأظافر",
    nails: "العناية بالأظافر",
    hair: "العناية بالشعر",
    coloring: "الصبغات والمعالجات",
    makeup: "المكياج",
    consultation: "استشارة",
    blowdry: "استشوار",
  };
  if (map[lower]) return map[lower];
  if (hasArabicText(x)) return x.replace(/[A-Za-z]+/g, " ").replace(/\s+/g, " ").trim();
  return "قسم عام";
}

function resolveCategoryLabel(raw: string) {
  const src = String(raw || "").trim();
  const preferred = src.includes(">") ? src.split(">").pop() || src : src;
  const x = humanizeLabel(preferred);
  if (hasArabicText(x)) return x.replace(/[A-Za-z]+/g, " ").replace(/\s+/g, " ").trim();
  const mapped = normalizeGroupLabel(x);
  if (hasArabicText(mapped)) return mapped.replace(/[A-Za-z]+/g, " ").replace(/\s+/g, " ").trim();
  return "غير محدد";
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function pickDocLabel(raw: any, fallback = ""): string {
  const keys = ["nameAr", "titleAr", "labelAr", "الاسم", "name", "title", "label", "categoryName", "category"];
  for (const k of keys) {
    const v = String(raw?.[k] ?? "").trim();
    if (v) return v;
  }
  return String(fallback || "").trim();
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

function isPackageLinkedOffer(o: any) {
  return (
    o &&
    (Number(o?.packageFinalPrice || 0) > 0 ||
      Number(o?.packageBaseTotalPrice || 0) > 0 ||
      Number(o?.packageTotalDurationMin || 0) > 0)
  );
}

function isPackageExpiredByToday(p: CorePackage) {
  const end = String(p?.endsAt || "").trim();
  if (!end) return false;
  return todayISO() > end;
}

function isPackageScheduledByToday(p: CorePackage) {
  const start = String(p?.startsAt || "").trim();
  if (!start) return false;
  return todayISO() < start;
}

function isPackageActiveNow(p: CorePackage) {
  if (!p || p.active === false || p.saleEnabled === false) return false;
  if (isPackageScheduledByToday(p)) return false;
  if (isPackageExpiredByToday(p)) return false;
  return true;
}

function getPackageStatusLabel(p: CorePackage) {
  if (isPackageExpiredByToday(p)) return "منتهي";
  if (p?.active === false) return "موقوف";
  if (p?.saleEnabled === false) return "غير معروض للبيع";
  if (isPackageScheduledByToday(p)) return "مجدول";
  return "نشط";
}

const DashboardOffers: React.FC = () => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [packagesCatalog, setPackagesCatalog] = useState<DashboardPackage[]>([]);
  const [packageServices, setPackageServices] = useState<PackageServiceRow[]>([]);
  const [sectionNameById, setSectionNameById] = useState<Record<string, string>>({});
  const [categoryNameById, setCategoryNameById] = useState<Record<string, string>>({});
  const [packageServiceSearch, setPackageServiceSearch] = useState("");
  const [packageListMode, setPackageListMode] = useState<PackageListMode>("all");
  const [packageOpenGroups, setPackageOpenGroups] = useState<Record<string, boolean>>({});
  const [editingPackageId, setEditingPackageId] = useState("");
  const [packageFormOpen, setPackageFormOpen] = useState(false);
  const [packagePickedImageName, setPackagePickedImageName] = useState("");
  const [packageDraft, setPackageDraft] = useState<PackageDraft>({
    id: "",
    name: "",
    description: "",
    imageUrl: "",
    active: true,
    saleEnabled: true,
    startDate: "",
    endDate: "",
    serviceIds: [],
    sessionsCount: 1,
    price: 0,
    validityDays: 30,
    terms: "",
    audienceScope: "all",
    targetClientIdsText: "",
    sortOrder: 0,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);

  const [queryText, setQueryText] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [servicesPickerOpen, setServicesPickerOpen] = useState(false);
  const [sequenceEditorOpen, setSequenceEditorOpen] = useState(false);
  const [pickedImageName, setPickedImageName] = useState("");
  const [filterMode, setFilterMode] = useState<OfferFilterMode>("all");
  const [inlineNotice, setInlineNotice] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const packageFormRef = useRef<HTMLDivElement | null>(null);
  const offerFormRef = useRef<HTMLDivElement | null>(null);

  const [form, setForm] = useState<OfferForm>({
    title: "",
    description: "",
    code: "",
    discountType: "fixed",
    value: 0,
    priceBefore: 0,
    priceAfter: 0,
    startDate: "",
    endDate: "",
    active: true,
    published: true,
    status: "active",
    sortOrder: 0,
    ctaLabel: "احجزي الآن",
    ctaUrl: "",
    targetScope: "all",
    targetClientIdsText: "",
    imageUrl: "",
    usageLimit: 0,
    minOrder: 0,
    maxDiscount: 0,
    perClientLimit: 0,
    appliesTo: "all",
    serviceIds: [],
    categoryIds: [],
    sequenceSteps: [],
  });

  const showNotice = (text: string, type: "error" | "success" = "error") => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setInlineNotice({ type, text: String(text || "").trim() });
    noticeTimerRef.current = window.setTimeout(() => setInlineNotice(null), 4200);
  };

  useEffect(() => {
    if (form.appliesTo !== "services") {
      setServicesPickerOpen(false);
      setServiceSearch("");
    }
  }, [form.appliesTo]);


  // قائمة الخدمات من Core Catalog بنفس المعرّف المستخدم في الحجز
  const servicesFlat: FlatService[] = useMemo(() => {
    return (packageServices || [])
      .filter((s) => s.active !== false)
      .map((s) => ({
        id: String(s.id || "").trim(),
        sectionId: String(s.sectionId || "").trim(),
        sectionTitle:
          String((s as any).sectionTitle || "").trim() ||
          String(sectionNameById[String(s.sectionId || "").trim()] || "").trim() ||
          String(s.sectionId || "").trim(),
        category:
          String(s.categoryName || "").trim() ||
          String(categoryNameById[String(s.categoryId || "").trim()] || "").trim() ||
          String(s.categoryId || "").trim() ||
          "عام",
        name: String(s.name || "").trim(),
        basePrice: Math.max(0, Number(s.price || 0)),
      }))
      .filter((s) => s.id && s.name);
  }, [packageServices, sectionNameById, categoryNameById]);

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

  const offerCategories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; servicesCount: number }>();
    packageServices.forEach((service) => {
      const id = String(service.categoryId || "").trim();
      if (!id) return;
      const name =
        String(service.categoryName || "").trim() ||
        String(categoryNameById[id] || "").trim() ||
        resolveCategoryLabel(id);
      const current = map.get(id);
      map.set(id, {
        id,
        name,
        servicesCount: Number(current?.servicesCount || 0) + 1,
      });
    });
    return Array.from(map.values()).sort((a, b) =>
      new Intl.Collator("ar", { sensitivity: "base" }).compare(a.name, b.name)
    );
  }, [packageServices, categoryNameById]);

  const selectedOfferServices = useMemo(
    () =>
      form.serviceIds
        .map((id) => serviceById.get(String(id || "").trim()))
        .filter(Boolean) as FlatService[],
    [form.serviceIds, serviceById]
  );

  const offerEditorComputed = useMemo(() => {
    const priceBefore = Math.max(0, Number(form.priceBefore || 0));
    const priceAfter = Math.max(0, Number(form.priceAfter || 0));
    const rawDiscount = Math.max(0, Number(form.value || 0));
    const calculatedDiscount =
      form.discountType === "percent"
        ? priceBefore * Math.min(rawDiscount, 100) / 100
        : rawDiscount;
    const suggestedPriceAfter = Math.max(0, priceBefore - calculatedDiscount);
    const explicitSaving = priceBefore > 0 && priceAfter >= 0
      ? Math.max(0, priceBefore - priceAfter)
      : calculatedDiscount;
    const serviceValue = selectedOfferServices.reduce(
      (sum, service) => sum + Math.max(0, Number(service.basePrice || 0)),
      0
    );
    const dateStatus = isScheduledByToday(form)
      ? "مجدول"
      : isExpiredByToday(form)
        ? "منتهي"
        : form.active
          ? "نشط"
          : "موقوف";

    return {
      priceBefore,
      priceAfter,
      calculatedDiscount,
      suggestedPriceAfter,
      explicitSaving,
      serviceValue,
      dateStatus,
    };
  }, [form, selectedOfferServices]);

  const offerEditorChecks = useMemo(() => {
    const scopeReady =
      form.appliesTo === "all" ||
      (form.appliesTo === "services" && form.serviceIds.length > 0) ||
      (form.appliesTo === "categories" && form.categoryIds.length > 0);
    const targetIds = form.targetClientIdsText
      .split(/[،,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const items = [
      { label: "عنوان العرض والكود مكتملان", ready: Boolean(form.title.trim() && form.code.trim()) },
      { label: "قيمة الخصم صحيحة", ready: Number(form.value) > 0 && (form.discountType !== "percent" || Number(form.value) <= 100) },
      { label: "فترة العرض صحيحة", ready: !form.startDate || !form.endDate || form.startDate <= form.endDate },
      { label: "نطاق التطبيق محدد", ready: scopeReady },
      { label: "الاستهداف جاهز", ready: form.targetScope === "all" || targetIds.length > 0 },
    ];
    return {
      items,
      readyCount: items.filter((item) => item.ready).length,
      isReady: items.every((item) => item.ready),
    };
  }, [form]);

  const refresh = async () => {
    try {
      const [
        offersData,
        packagesData,
        servicesSource,
        sectionsSource,
        categoriesSource,
      ] = await Promise.all([
        listOffers(SALON_ID, "core"),
        PackageService.getAll(),
        CoreCatalogService.listServices({ activeOnly: false }),
        CoreCatalogService.listSections(false),
        CoreCatalogService.listCategories(false),
      ]);

      const safePackages = (Array.isArray(packagesData) ? packagesData : [])
        .filter((pkg): pkg is DashboardPackage => Boolean(String(pkg?.id || "").trim()))
        .map((pkg) => ({ ...pkg, id: String(pkg.id || "").trim() }));

      const packageIds = new Set(safePackages.map((pkg) => pkg.id));
      const filteredOffers = (Array.isArray(offersData) ? offersData : []).filter(
        (offer: any) => {
          const offerId = String(offer?.id || "").trim();
          if (offerId && packageIds.has(offerId)) return false;
          return !isPackageLinkedOffer(offer);
        }
      );

      setOffers(filteredOffers);
      setPackagesCatalog(safePackages);

      const secMap: Record<string, string> = {};
      sectionsSource.forEach((row) => {
        const id = String(row.id || "").trim();
        const label = String(row.name || "").trim();
        if (id && label) secMap[id] = label;
      });
      setSectionNameById(secMap);

      const catMap: Record<string, string> = {};
      categoriesSource.forEach((row) => {
        const id = String(row.id || "").trim();
        const label = String(row.name || "").trim();
        if (id && label) catMap[id] = label;
      });
      setCategoryNameById(catMap);

      const srvRows: PackageServiceRow[] = servicesSource
        .map((row) => ({
          id: String(row.id || "").trim(),
          name: String(row.name || "").trim(),
          sectionId: String(row.sectionId || "").trim(),
          sectionTitle: String(
            secMap[String(row.sectionId || "").trim()] ||
              row.sectionId ||
              ""
          ).trim(),
          categoryId: String(row.categoryId || "").trim(),
          categoryName:
            String(
              catMap[String(row.categoryId || "").trim()] ||
                row.categoryId ||
                ""
            ).trim() || undefined,
          durationMin: Math.max(0, Number(row.durationMinutes || 0)),
          price: Math.max(0, Number(row.priceHalalas || 0) / 100),
          active: row.active !== false,
        }))
        .filter((row) => row.id && row.name && row.active !== false);

      setPackageServices(srvRows);
    } catch (error: any) {
      console.error(
        "Core offers/packages load failed:",
        error?.code,
        error?.message,
        error
      );
      showNotice("تعذر تحميل العروض أو الباقات من Core API.");
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
      if (filterMode === "all") return !isDeleted(o);
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
  const packageStats = useMemo(() => {
    const total = packagesCatalog.length;
    const activeNowCount = packagesCatalog.filter((pkg) =>
      isPackageActiveNow(pkg)
    ).length;
    const saleEnabledCount = packagesCatalog.filter(
      (pkg) => pkg.saleEnabled !== false
    ).length;
    return { total, activeNowCount, saleEnabledCount };
  }, [packagesCatalog]);

  const openAdd = () => {
    setPackageFormOpen(false);
    setEditingPackageId("");
    setEditing(null);
    setServiceSearch("");
    setServicesPickerOpen(false);
    setSequenceEditorOpen(false);
    setPickedImageName("");

    setForm({
      title: "",
      description: "",
      code: generateCode(),
      discountType: "fixed",
      value: 0,
      priceBefore: 0,
      priceAfter: 0,
      startDate: "",
      endDate: "",
      active: true,
      published: true,
      status: "active",
      sortOrder: 0,
      ctaLabel: "احجزي الآن",
      ctaUrl: "",
      targetScope: "all",
      targetClientIdsText: "",
      imageUrl: "",
      usageLimit: 0,
      minOrder: 0,
      maxDiscount: 0,
      perClientLimit: 0,
      appliesTo: "all",
      serviceIds: [],
      categoryIds: [],
      sequenceSteps: [],
    });

    setOpen(true);
    window.requestAnimationFrame(() => {
      offerFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const openEdit = (o: Offer) => {
    setPackageFormOpen(false);
    setEditingPackageId("");
    setEditing(o);
    setServiceSearch("");
    setServicesPickerOpen(false);
    setSequenceEditorOpen(Array.isArray((o as any).sequenceSteps) && (o as any).sequenceSteps.length > 0);
    setPickedImageName((o as any).imageUrl ? "تم اختيار صورة" : "");

    setForm({
      title: (o as any).title || "",
      description: (o as any).description || "",
      code: (o as any).code || "",
      discountType: ((o as any).discountType as DiscountType) || "fixed",
      value: Number((o as any).value || 0),
      priceBefore: Number((o as any).priceBeforeHalalas || 0) / 100,
      priceAfter: Number((o as any).priceAfterHalalas || 0) / 100,
      startDate: (o as any).startDate || "",
      endDate: (o as any).endDate || "",
      active: Boolean((o as any).active),
      published: (o as any).published !== false,
      status: (["draft", "scheduled", "active", "expired", "disabled"].includes(String((o as any).status)) ? String((o as any).status) : ((o as any).active ? "active" : "disabled")) as OfferForm["status"],
      sortOrder: Number((o as any).sortOrder || 0),
      ctaLabel: (o as any).ctaLabel || "احجزي الآن",
      ctaUrl: (o as any).ctaUrl || "",
      targetScope: (o as any).targetScope === "specific" ? "specific" : "all",
      targetClientIdsText: Array.isArray((o as any).targetClientIds) ? (o as any).targetClientIds.join(", ") : "",
      imageUrl: (o as any).imageUrl || "",
      usageLimit: Math.max(0, Number((o as any).usageLimit || 0)),
      minOrder: Math.max(0, Number((o as any).minOrderHalalas || 0) / 100),
      maxDiscount: Math.max(0, Number((o as any).maxDiscountHalalas || 0) / 100),
      perClientLimit: Math.max(0, Number((o as any).perClientLimit || 0)),
      appliesTo: ((o as any).appliesTo as OfferAppliesTo) || "all",
      serviceIds: Array.isArray((o as any).serviceIds) ? (o as any).serviceIds : [],
      categoryIds: Array.isArray((o as any).categoryIds) ? (o as any).categoryIds : [],
      sequenceSteps: normalizeSequenceSteps((o as any).sequenceSteps, Array.isArray((o as any).serviceIds) ? (o as any).serviceIds : []),
    });

    setOpen(true);
    window.requestAnimationFrame(() => {
      offerFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const close = () => {
    setOpen(false);
    setEditing(null);
    setServiceSearch("");
    setServicesPickerOpen(false);
    setSequenceEditorOpen(false);
  };

  const save = async () => {
    if (!form.title.trim()) return showNotice("اكتب عنوان العرض");
    if (!form.code.trim()) return showNotice("اكتب الكود أو اضغط توليد");
    const discountValue = Number(form.value);
    if (!Number.isFinite(discountValue) || discountValue <= 0) return showNotice("قيمة الخصم لازم تكون رقمًا أكبر من صفر");
    if (!hasAtMostTwoDecimals(discountValue)) return showNotice("قيمة الخصم تقبل منزلتين عشريتين كحد أقصى");
    if (form.discountType === "percent" && discountValue > 100) return showNotice("النسبة المئوية لا تتجاوز 100%");
    if (form.startDate && form.endDate && form.startDate > form.endDate) return showNotice("تاريخ البداية لازم يكون قبل النهاية");
    if (form.priceBefore < 0 || form.priceAfter < 0) return showNotice("أسعار العرض لا يمكن أن تكون سالبة");
    if (form.priceBefore > 0 && form.priceAfter > form.priceBefore) return showNotice("السعر بعد الخصم يجب ألا يتجاوز السعر السابق");
    const targetClientIds = form.targetClientIdsText.split(/[،,\n]/).map((item) => item.trim()).filter(Boolean);
    if (form.targetScope === "specific" && targetClientIds.length === 0) return showNotice("أدخلي معرف عميلة واحدة على الأقل للاستهداف المحدد");

    if (form.appliesTo === "services" && form.serviceIds.length === 0) {
      return showNotice("اختر خدمة واحدة على الأقل أو اجعل العرض على جميع الخدمات");
    }
    if (form.appliesTo === "categories" && form.categoryIds.length === 0) {
      return showNotice("اختر تصنيفًا واحدًا على الأقل أو غيّر نطاق العرض");
    }
    if (form.usageLimit < 0 || form.minOrder < 0 || form.maxDiscount < 0 || form.perClientLimit < 0) {
      return showNotice("حدود الاستخدام والطلب والخصم لا يمكن أن تكون سالبة");
    }

    const normalizedSeq = normalizeSequenceSteps(form.sequenceSteps, form.serviceIds);

    try {
      const id = (editing as any)?.id || makeOfferId();

      // ✅ لو كنت تعدل عرض محذوف: رجّعه (امسح deletedAt)
      const deletedAt = (editing as any)?.deletedAt ? null : undefined;

      const payload: any = {
        id,
        title: form.title.trim(),
        description: form.description.trim(),
        code: form.code.trim(),
        discountType: form.discountType,
        value: roundToTwoDecimals(discountValue),
        priceBeforeHalalas: Math.round(Number(form.priceBefore || 0) * 100),
        priceAfterHalalas: Math.round(Number(form.priceAfter || 0) * 100),
        startDate: form.startDate || "",
        endDate: form.endDate || "",
        active: Boolean(form.active),
        published: Boolean(form.published),
        status: form.status,
        sortOrder: Math.max(0, Math.floor(Number(form.sortOrder || 0))),
        ctaLabel: form.ctaLabel.trim() || "احجزي الآن",
        ctaUrl: form.ctaUrl.trim(),
        targetScope: form.targetScope,
        targetClientIds,
        imageUrl: form.imageUrl || "",

        usageLimit: Number(form.usageLimit || 0) > 0 ? Math.floor(Number(form.usageLimit || 0)) : null,
        minOrderHalalas: Number(form.minOrder || 0) > 0 ? Math.round(Number(form.minOrder || 0) * 100) : null,
        maxDiscountHalalas: Number(form.maxDiscount || 0) > 0 ? Math.round(Number(form.maxDiscount || 0) * 100) : null,
        perClientLimit: Number(form.perClientLimit || 0) > 0 ? Math.floor(Number(form.perClientLimit || 0)) : null,

        appliesTo: form.appliesTo,
        serviceIds: form.appliesTo === "services" ? normalizedSeq.map((s) => String(s.serviceId || "").trim()).filter(Boolean) : [],
        categoryIds: form.appliesTo === "categories" ? form.categoryIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
        sequenceSteps: form.appliesTo === "services" ? normalizedSeq : [],

        usageCount: Math.max(0, Math.floor(Number((editing as any)?.usageCount || 0))),
        createdAt: (editing as any)?.createdAt,

        ...(deletedAt === null ? { deletedAt: null } : {}),
      };

      await upsertOffer(payload, SALON_ID);
      await refresh();
      close();
    } catch (e: any) {
      console.error("❌ upsertOffer error:", e?.code, e?.message, e);
      showNotice(getOfferSaveErrorMessage(e));
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

  const toggleOfferCategory = (id: string) => {
    setForm((prev) => ({
      ...prev,
      categoryIds: prev.categoryIds.includes(id)
        ? prev.categoryIds.filter((item) => item !== id)
        : [...prev.categoryIds, id],
    }));
  };

  const selectAllVisibleOfferServices = () => {
    const ids = servicesFiltered.map((service) => service.id);
    if (!ids.length) return;
    setForm((prev) => {
      const nextIds = Array.from(new Set([...prev.serviceIds, ...ids]));
      const currentSteps = normalizeSequenceSteps(prev.sequenceSteps, prev.serviceIds);
      const stepIds = new Set(currentSteps.map((step) => String(step.serviceId || "").trim()));
      const nextSteps = [...currentSteps];
      ids.forEach((id) => {
        if (!stepIds.has(id)) {
          nextSteps.push({ serviceId: id, orderIndex: nextSteps.length, gapAfterMin: 0 });
        }
      });
      return {
        ...prev,
        serviceIds: nextIds,
        sequenceSteps: nextSteps.map((step, index) => ({ ...step, orderIndex: index })),
      };
    });
  };

  const clearVisibleOfferServices = () => {
    const visibleIds = new Set(servicesFiltered.map((service) => service.id));
    setForm((prev) => {
      const nextIds = prev.serviceIds.filter((id) => !visibleIds.has(id));
      const nextSteps = normalizeSequenceSteps(prev.sequenceSteps, prev.serviceIds)
        .filter((step) => !visibleIds.has(String(step.serviceId || "").trim()))
        .map((step, index) => ({ ...step, orderIndex: index }));
      return { ...prev, serviceIds: nextIds, sequenceSteps: nextSteps };
    });
  };

  const calculateOfferPriceAfter = () => {
    if (offerEditorComputed.priceBefore <= 0) {
      showNotice("أدخل السعر قبل الخصم أولًا");
      return;
    }
    setForm((prev) => ({
      ...prev,
      priceAfter: Number(offerEditorComputed.suggestedPriceAfter.toFixed(2)),
    }));
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

    const price = Math.max(0, Number(packageDraft.price || 0));
    const sessionsCount = Math.max(
      1,
      Math.floor(Number(packageDraft.sessionsCount || 1))
    );
    const validityDays = Math.max(
      1,
      Math.floor(Number(packageDraft.validityDays || 1))
    );

    return {
      picked,
      price,
      sessionsCount,
      validityDays,
      averageSessionPrice: sessionsCount > 0 ? price / sessionsCount : 0,
    };
  }, [packageDraft, packageServiceMap]);

  const packageEditorChecks = useMemo(() => {
    const startDate = String(packageDraft.startDate || "").trim();
    const endDate = String(packageDraft.endDate || "").trim();
    const items = [
      { label: "اسم الباقة مكتمل", ready: Boolean(String(packageDraft.name || "").trim()) },
      { label: "تم اختيار خدمة واحدة على الأقل", ready: packageComputed.picked.length > 0 },
      { label: "السعر وعدد الجلسات صالحان", ready: packageComputed.price >= 0 && packageComputed.sessionsCount > 0 },
      { label: "فترة الإتاحة صحيحة", ready: !startDate || !endDate || startDate <= endDate },
    ];

    return {
      items,
      readyCount: items.filter((item) => item.ready).length,
      isReady: items.every((item) => item.ready),
    };
  }, [packageDraft, packageComputed]);
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
  const groupPackageServices = (rows: PackageServiceRow[]) => {
    const groups = new Map<string, { title: string; services: PackageServiceRow[] }>();
    rows.forEach((s) => {
      const sectionTitle = normalizeGroupLabel(
        String((s as any).sectionTitle || "").trim() ||
          String(sectionNameById[String(s.sectionId || "").trim()] || "").trim() ||
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
  const selectedPackageGroups = useMemo(() => groupPackageServices(selectedPackageServices), [selectedPackageServices, sectionNameById]);
  const unselectedPackageGroups = useMemo(() => groupPackageServices(unselectedPackageServices), [unselectedPackageServices, sectionNameById]);
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
      saleEnabled: true,
      startDate: "",
      endDate: "",
      serviceIds: [],
      sessionsCount: 1,
      price: 0,
      validityDays: 30,
      terms: "",
      audienceScope: "all",
      targetClientIdsText: "",
      sortOrder: 0,
    });
  };
  const startCreatePackage = () => {
    close();
    resetPackageDraft();
    setPackageFormOpen(true);
    window.requestAnimationFrame(() => {
      packageFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const togglePackageForm = () => {
    if (packageFormOpen) {
      setPackageFormOpen(false);
      return;
    }
    startCreatePackage();
  };
  const toggleOfferModal = () => {
    if (open) {
      close();
      return;
    }
    openAdd();
  };
  const openPackageForEdit = (pkg: DashboardPackage) => {
    close();
    setEditingPackageId(String(pkg.id || "").trim());
    setPackageFormOpen(true);
    setPackagePickedImageName(
      String(pkg.imageUrl || "").trim() ? "تم اختيار صورة" : ""
    );
    setPackageDraft({
      id: String(pkg.id || "").trim(),
      name: String(pkg.name || "").trim(),
      description: String(pkg.description || "").trim(),
      imageUrl: String(pkg.imageUrl || "").trim(),
      active: pkg.active !== false,
      saleEnabled: pkg.saleEnabled !== false,
      startDate: String(pkg.startsAt || "").trim(),
      endDate: String(pkg.endsAt || "").trim(),
      serviceIds: Array.isArray(pkg.serviceIds) ? pkg.serviceIds : [],
      sessionsCount: Math.max(1, Number(pkg.sessionsCount || 1)),
      price: Math.max(0, Number(pkg.price || 0)),
      validityDays: Math.max(1, Number(pkg.validityDays || 30)),
      terms: String(pkg.terms || "").trim(),
      audienceScope: String(pkg.audienceScope || "all").trim() || "all",
      targetClientIdsText: Array.isArray(pkg.targetClientIds)
        ? pkg.targetClientIds.join(", ")
        : "",
      sortOrder: Math.max(0, Number(pkg.sortOrder || 0)),
    });
    window.requestAnimationFrame(() => {
      packageFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
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
    const isUpdateMode = Boolean(String(editingPackageId || "").trim());
    const name = String(packageDraft.name || "").trim();
    const startDate = String(packageDraft.startDate || "").trim();
    const endDate = String(packageDraft.endDate || "").trim();
    const sessionsCount = Math.max(
      1,
      Math.floor(Number(packageDraft.sessionsCount || 1))
    );
    const price = Math.max(0, Number(packageDraft.price || 0));
    const validityDays = Math.max(
      1,
      Math.floor(Number(packageDraft.validityDays || 1))
    );

    if (!name) return showNotice("اكتب اسم الباقة");
    if (startDate && endDate && startDate > endDate) {
      return showNotice("تاريخ بداية الباقة يجب أن يكون قبل تاريخ الانتهاء");
    }
    if (endDate && endDate < todayISO()) {
      return showNotice("تاريخ انتهاء الباقة يجب أن يكون اليوم أو بعده");
    }
    if (!packageComputed.picked.length) {
      return showNotice("اختر خدمة واحدة على الأقل");
    }
    if (sessionsCount <= 0) {
      return showNotice("عدد الجلسات يجب أن يكون أكبر من صفر");
    }
    if (price < 0) {
      return showNotice("سعر الباقة لا يمكن أن يكون سالبًا");
    }

    const id =
      String(packageDraft.id || "").trim() || buildId(`pkg_${name}`);
    const targetClientIds = packageDraft.targetClientIdsText
      .split(/[،,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);

    const payload: CorePackage = {
      id,
      name,
      description:
        String(packageDraft.description || "").trim() || undefined,
      imageUrl: String(packageDraft.imageUrl || "").trim() || undefined,
      active: packageDraft.active !== false,
      saleEnabled: packageDraft.saleEnabled !== false,
      startsAt: startDate || undefined,
      endsAt: endDate || undefined,
      serviceIds: packageComputed.picked.map((service) =>
        String(service.id || "").trim()
      ),
      allowedServiceIds: packageComputed.picked.map((service) =>
        String(service.id || "").trim()
      ),
      sessionsCount,
      price,
      validityDays,
      terms: String(packageDraft.terms || "").trim() || undefined,
      audienceScope:
        String(packageDraft.audienceScope || "all").trim() || "all",
      targetClientIds,
      sortOrder: Math.max(
        0,
        Math.floor(Number(packageDraft.sortOrder || 0))
      ),
    };

    try {
      if (isUpdateMode) {
        await PackageService.update(editingPackageId, payload);
      } else {
        await PackageService.add(payload);
      }

      // لا ننشئ عرضًا موازيًا للباقة. ننظف فقط أي سجل قديم حمل نفس المعرف.
      void removeOffer(id, SALON_ID).catch(() => undefined);

      await refresh();
      resetPackageDraft();
      if (isUpdateMode) setPackageFormOpen(false);
      showNotice(
        isUpdateMode ? "تم تحديث الباقة بنجاح" : "تم حفظ الباقة بنجاح",
        "success"
      );
    } catch (error: any) {
      console.error(
        "Core package save failed:",
        error?.code,
        error?.message,
        error
      );
      showNotice("تعذر حفظ الباقة في Core API.");
    }
  };

  const deletePackageById = async (idRaw: string) => {
    const id = String(idRaw || "").trim();
    if (!id) return;
    if (!confirm("هل أنت متأكد من حذف هذه الباقة؟")) return;

    try {
      await PackageService.remove(id);
      await removeOffer(id, SALON_ID).catch(() => undefined);
      await refresh();
      if (editingPackageId === id) resetPackageDraft();
      showNotice("تم حذف الباقة", "success");
    } catch (error: any) {
      console.error(
        "Core package delete failed:",
        error?.code,
        error?.message,
        error
      );
      showNotice("تعذر حذف الباقة من Core API.");
    }
  };

  const togglePackageActive = async (pkg: DashboardPackage) => {
    const id = String(pkg.id || "").trim();
    if (!id) return;

    if (isPackageExpiredByToday(pkg)) {
      openPackageForEdit(pkg);
      showNotice(
        "الباقة منتهية. عدّل تاريخ الانتهاء إلى اليوم أو بعده ثم احفظها."
      );
      return;
    }

    const currentlyAvailable =
      pkg.active !== false && pkg.saleEnabled !== false;

    try {
      await PackageService.update(id, {
        ...pkg,
        active: currentlyAvailable ? false : true,
        saleEnabled: currentlyAvailable
          ? pkg.saleEnabled !== false
          : true,
      });
      await refresh();
    } catch (error: any) {
      console.error(
        "Core package status update failed:",
        error?.code,
        error?.message,
        error
      );
      showNotice("تعذر تحديث حالة الباقة.");
    }
  };

  return (
    <main className="dsv2-page dsv2-offers-page" dir="rtl">
      {inlineNotice ? (
        <div
          className={`offers-inline-notice offers-inline-notice--${inlineNotice.type}`}
          role="alert"
        >
          {inlineNotice.text}
        </div>
      ) : null}
      {/* Enterprise hero */}
      <div className="offers-header offers-enterprise-hero">
        <div className="offers-head-main">
          <span className="offers-kicker">COMMERCIAL WORKSPACE</span>
          <h1>
            <FontAwesomeIcon icon={faTag} /> العروض والباقات
          </h1>
          <p className="offers-sub">
            إدارة الحملات الترويجية والكوبونات والباقات من مساحة موحدة، مع متابعة الحالة والتواريخ والاستخدام.
          </p>
        </div>

        <div className="offers-hero-actions" aria-label="إجراءات العروض والباقات">
          <button
            className="dash-pill dash-pill-primary offers-hero-action offers-hero-action--primary"
            type="button"
            onClick={toggleOfferModal}
            aria-expanded={open}
          >
            <FontAwesomeIcon icon={open ? faXmark : faPlus} />
            {open ? "إغلاق نموذج العرض" : "إضافة عرض"}
          </button>
          <button
            className="dash-pill dash-pill-outline offers-hero-action"
            type="button"
            onClick={togglePackageForm}
            aria-expanded={packageFormOpen}
          >
            <FontAwesomeIcon icon={faTag} />
            {packageFormOpen ? "إغلاق نموذج الباقة" : "إنشاء باقة"}
          </button>
          <button
            className="dash-pill dash-pill-outline offers-hero-action offers-hero-action--refresh"
            type="button"
            onClick={refresh}
          >
            <FontAwesomeIcon icon={faRotateLeft} /> تحديث
          </button>
        </div>
      </div>

      <div className="offers-section offers-section--stats offers-enterprise-kpis">
        <article className="offers-enterprise-kpi offers-enterprise-kpi--primary">
          <span className="offers-enterprise-kpi__icon"><FontAwesomeIcon icon={faCheck} /></span>
          <div className="offers-enterprise-kpi__copy">
            <span>العروض النشطة</span>
            <strong>{stats.activeNowCount}</strong>
            <small>من أصل {stats.total} عرض</small>
          </div>
        </article>

        <article className="offers-enterprise-kpi">
          <span className="offers-enterprise-kpi__icon"><FontAwesomeIcon icon={faWandMagicSparkles} /></span>
          <div className="offers-enterprise-kpi__copy">
            <span>العروض المجدولة</span>
            <strong>{stats.scheduledCount}</strong>
            <small>{stats.expiredCount} منتهٍ أو موقوف</small>
          </div>
        </article>

        <article className="offers-enterprise-kpi">
          <span className="offers-enterprise-kpi__icon"><FontAwesomeIcon icon={faTag} /></span>
          <div className="offers-enterprise-kpi__copy">
            <span>الباقات النشطة</span>
            <strong>{packageStats.activeNowCount}</strong>
            <small>من أصل {packageStats.total} باقة</small>
          </div>
        </article>

        <article className="offers-enterprise-kpi">
          <span className="offers-enterprise-kpi__icon"><FontAwesomeIcon icon={faImage} /></span>
          <div className="offers-enterprise-kpi__copy">
            <span>المعروض للبيع</span>
            <strong>{packageStats.saleEnabledCount}</strong>
            <small>{stats.used} عروض مستخدمة</small>
          </div>
        </article>
      </div>

      <div className="offers-card dsv2-card dsv2-card--padded offers-section offers-section--packages-list">
        <div className="offers-card-title offers-section-heading">
          <span><FontAwesomeIcon icon={faTag} /> الباقات المحفوظة</span>
          <span className="offers-section-count">{packagesCatalog.length}</span>
        </div>
        <div className="offers-section-note">إدارة الباقات الجاهزة للبيع، جلساتها، أسعارها وصلاحيتها من مكان واحد.</div>
        {!packagesCatalog.length ? (
          <div className="offers-hint">لا توجد باكيجات محفوظة</div>
        ) : (
          <div className="pkg-offers-grid">
            {packagesCatalog.map((p) => {
              const isEditingThis = editingPackageId === String(p.id || "").trim();
              const pkgExpired = isPackageExpiredByToday(p);
              const pkgScheduled = isPackageScheduledByToday(p);
              const pkgActiveNow = isPackageActiveNow(p);
              const pkgStatus = getPackageStatusLabel(p);
              const packageActionLabel = pkgExpired ? "تجديد" : pkgActiveNow || pkgScheduled ? "إيقاف" : "تفعيل";
              const packageActionIcon = pkgExpired ? faPen : pkgActiveNow || pkgScheduled ? faBan : faCheck;
              const packageActionClass =
                pkgExpired ? "dash-pill-outline" : pkgActiveNow || pkgScheduled ? "dash-pill-warning" : "dash-pill-success";
              return (
                <div key={p.id} className={`pkg-offer-card ${isEditingThis ? "is-editing" : ""} ${pkgExpired ? "is-expired" : ""}`}>
                  <div className="pkg-offer-inner">
                    <div className="pkg-offer-image-wrap">
                      {String(p.imageUrl || "").trim() ? (
                        <img className="pkg-offer-image" src={String(p.imageUrl)} alt={String(p.name || p.id || "package")} />
                      ) : (
                        <div className="pkg-offer-image pkg-offer-image--empty">—</div>
                      )}
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الاسم</div>
                      <div className="pkg-offer-value">{p.name || p.id}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الخدمات</div>
                      <div className="pkg-offer-value">{Array.isArray(p.serviceIds) ? p.serviceIds.length : 0}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">السعر</div>
                      <div className="pkg-offer-value">{Math.round(Number(p.price || 0))} ر.س</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">عدد الجلسات</div>
                      <div className="pkg-offer-value">{Math.max(1, Number(p.sessionsCount || 1))}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الصلاحية</div>
                      <div className="pkg-offer-value">
                        {p.validityDays ? `${p.validityDays} يوم` : "—"}
                      </div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">يبدأ</div>
                      <div className="pkg-offer-value">{String(p.startsAt || "").trim() || "—"}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">ينتهي</div>
                      <div className="pkg-offer-value">{String(p.endsAt || "").trim() || "—"}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الحالة</div>
                      <div className="pkg-offer-value"><span className={`offers-status-badge ${pkgActiveNow ? "is-active" : pkgScheduled ? "is-scheduled" : "is-muted"}`}>{pkgStatus}</span></div>
                    </div>
                    {!!String(p.description || "").trim() && (
                      <div className="pkg-offer-row">
                        <div className="pkg-offer-label">الوصف</div>
                        <div className="pkg-offer-value pkg-offer-desc">{String(p.description)}</div>
                      </div>
                    )}
                    <div className="of-actions of-actions--card">
                      <button
                        type="button"
                        className="dash-pill dash-pill-outline dash-pill-sm"
                        onClick={() => openPackageForEdit(p)}
                      >
                        <FontAwesomeIcon icon={faPen} /> تعديل
                      </button>
                      <button
                        type="button"
                        className={`dash-pill ${packageActionClass} dash-pill-sm`}
                        onClick={() => togglePackageActive(p)}
                        title={packageActionLabel}
                      >
                        <FontAwesomeIcon icon={packageActionIcon} />
                        {` ${packageActionLabel}`}
                      </button>
                      <button
                        type="button"
                        className="dash-pill dash-pill-danger dash-pill-sm"
                        onClick={() => deletePackageById(p.id)}
                      >
                        <FontAwesomeIcon icon={faTrash} /> حذف
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {packageFormOpen && (
        <div
          ref={packageFormRef}
          className={`offers-card dsv2-card offers-section offers-section--package-form pkgm package-editor-v4 ${editingPackageId ? "is-editing" : "is-creating"}`}
        >
          <header className="package-editor__header">
            <div className="package-editor__heading">
              <span className="package-editor__heading-icon" aria-hidden="true">
                <FontAwesomeIcon icon={editingPackageId ? faPen : faTag} />
              </span>
              <div>
                <span className="package-editor__eyebrow">
                  {editingPackageId ? "PACKAGE EDITOR · UPDATE" : "PACKAGE EDITOR · NEW"}
                </span>
                <h2>{editingPackageId ? "تعديل الباقة" : "إنشاء باقة جديدة"}</h2>
                <p>
                  أدخل البيانات التجارية، حدّد الخدمات، ثم راجع الملخص قبل الحفظ.
                  سيتم تحديث نفس السجل عند التعديل.
                </p>
              </div>
            </div>

            <div className="package-editor__header-actions">
              <button
                type="button"
                className="dash-pill dash-pill-outline"
                onClick={() => setPackageFormOpen(false)}
              >
                <FontAwesomeIcon icon={faXmark} /> إغلاق
              </button>
              <button
                type="button"
                className="dash-pill dash-pill-outline"
                onClick={resetPackageDraft}
              >
                <FontAwesomeIcon icon={faRotateLeft} /> تفريغ
              </button>
              <button
                type="button"
                className="dash-pill dash-pill-primary package-editor__save-top"
                onClick={savePackageDraft}
              >
                <FontAwesomeIcon icon={faCheck} />
                {editingPackageId ? "حفظ التعديلات" : "إنشاء الباقة"}
              </button>
            </div>
          </header>

          <div className="package-editor__layout">
            <main className="package-editor__main">
              <section className="package-editor__section">
                <div className="package-editor__section-head">
                  <span className="package-editor__step">01</span>
                  <div>
                    <h3>البيانات الأساسية</h3>
                    <p>الاسم والوصف اللذان سيظهران للعميلة وفي لوحة الإدارة.</p>
                  </div>
                </div>

                <div className="package-editor__grid package-editor__grid--identity">
                  <div className="pkgm__field package-editor__field--wide">
                    <label>اسم الباقة <em>مطلوب</em></label>
                    <input
                      value={packageDraft.name}
                      placeholder="مثال: باقة العناية الشهرية"
                      onChange={(e) =>
                        setPackageDraft((p) => ({ ...p, name: e.target.value }))
                      }
                    />
                    <small>استخدم اسمًا واضحًا وقصيرًا يسهل تمييزه في الحجز.</small>
                  </div>

                  <div className="pkgm__field">
                    <label>المعرف الداخلي</label>
                    <input
                      value={packageDraft.id}
                      placeholder="يُنشأ تلقائيًا عند تركه فارغًا"
                      onChange={(e) =>
                        setPackageDraft((p) => ({ ...p, id: e.target.value }))
                      }
                    />
                    <small>للاستخدام التقني فقط، ولا يظهر للعميلة.</small>
                  </div>

                  <div className="pkgm__field package-editor__field--wide">
                    <label>وصف الباقة</label>
                    <textarea
                      value={packageDraft.description}
                      placeholder="اكتب فائدة الباقة وما الذي تحصل عليه العميلة..."
                      onChange={(e) =>
                        setPackageDraft((p) => ({ ...p, description: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </section>

              <section className="package-editor__section">
                <div className="package-editor__section-head">
                  <span className="package-editor__step">02</span>
                  <div>
                    <h3>التسعير والجلسات</h3>
                    <p>اضبط سعر البيع، الرصيد، مدة الصلاحية وترتيب الظهور.</p>
                  </div>
                </div>

                <div className="package-editor__commercial-grid">
                  <div className="pkgm__field package-editor__commercial-field is-price">
                    <label>سعر الباقة</label>
                    <div className="package-editor__input-suffix">
                      <DashboardNumberInputV2
                        min={0}
                        value={packageDraft.price}
                        onChange={(e) =>
                          setPackageDraft((p) => ({
                            ...p,
                            price: Math.max(0, Number(e.target.value || 0)),
                          }))
                        }
                      />
                      <span>ر.س</span>
                    </div>
                  </div>

                  <div className="pkgm__field package-editor__commercial-field">
                    <label>عدد الجلسات</label>
                    <div className="package-editor__input-suffix">
                      <DashboardNumberInputV2
                        min={1}
                        value={packageDraft.sessionsCount}
                        onChange={(e) =>
                          setPackageDraft((p) => ({
                            ...p,
                            sessionsCount: Math.max(
                              1,
                              Math.floor(Number(e.target.value || 1))
                            ),
                          }))
                        }
                      />
                      <span>جلسة</span>
                    </div>
                  </div>

                  <div className="pkgm__field package-editor__commercial-field">
                    <label>مدة الصلاحية</label>
                    <div className="package-editor__input-suffix">
                      <DashboardNumberInputV2
                        min={1}
                        value={packageDraft.validityDays}
                        onChange={(e) =>
                          setPackageDraft((p) => ({
                            ...p,
                            validityDays: Math.max(
                              1,
                              Math.floor(Number(e.target.value || 1))
                            ),
                          }))
                        }
                      />
                      <span>يوم</span>
                    </div>
                  </div>

                  <div className="pkgm__field package-editor__commercial-field">
                    <label>ترتيب الظهور</label>
                    <DashboardNumberInputV2
                      min={0}
                      value={packageDraft.sortOrder}
                      onChange={(e) =>
                        setPackageDraft((p) => ({
                          ...p,
                          sortOrder: Math.max(
                            0,
                            Math.floor(Number(e.target.value || 0))
                          ),
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="package-editor__commercial-note">
                  <FontAwesomeIcon icon={faWandMagicSparkles} />
                  <span>
                    متوسط سعر الجلسة حاليًا
                    <strong>{packageComputed.averageSessionPrice.toFixed(2)} ر.س</strong>
                  </span>
                </div>
              </section>

              <section className="package-editor__section">
                <div className="package-editor__section-head">
                  <span className="package-editor__step">03</span>
                  <div>
                    <h3>الإتاحة والنشر</h3>
                    <p>حدد فترة ظهور الباقة وحالتها في البيع والحجز.</p>
                  </div>
                </div>

                <div className="package-editor__availability-grid">
                  <div className="pkgm__field">
                    <label>تاريخ البداية</label>
                    <DashboardDatePickerV2
                      value={packageDraft.startDate}
                      onChange={(value) =>
                        setPackageDraft((p) => ({ ...p, startDate: value }))
                      }
                    />
                  </div>
                  <div className="pkgm__field">
                    <label>تاريخ الانتهاء</label>
                    <DashboardDatePickerV2
                      value={packageDraft.endDate}
                      onChange={(value) =>
                        setPackageDraft((p) => ({ ...p, endDate: value }))
                      }
                    />
                  </div>
                </div>

                <div className="package-editor__toggle-grid">
                  <label className={`package-editor__toggle-card ${packageDraft.active !== false ? "is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={packageDraft.active !== false}
                      onChange={() =>
                        setPackageDraft((p) => ({ ...p, active: !p.active }))
                      }
                    />
                    <span className="package-editor__toggle-mark">
                      <FontAwesomeIcon icon={faCheck} />
                    </span>
                    <span>
                      <strong>الباقة مفعّلة</strong>
                      <small>تُعامل كسجل نشط داخل النظام.</small>
                    </span>
                  </label>

                  <label className={`package-editor__toggle-card ${packageDraft.saleEnabled !== false ? "is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={packageDraft.saleEnabled !== false}
                      onChange={() =>
                        setPackageDraft((p) => ({
                          ...p,
                          saleEnabled: !p.saleEnabled,
                        }))
                      }
                    />
                    <span className="package-editor__toggle-mark">
                      <FontAwesomeIcon icon={faTag} />
                    </span>
                    <span>
                      <strong>معروضة للبيع والحجز</strong>
                      <small>تظهر في القنوات المسموح لها ببيع الباقات.</small>
                    </span>
                  </label>
                </div>
              </section>

              <section className="package-editor__section package-editor__section--media">
                <div className="package-editor__section-head">
                  <span className="package-editor__step">04</span>
                  <div>
                    <h3>الصورة والشروط</h3>
                    <p>ارفع صورة مناسبة وأضف شروط الاستخدام عند الحاجة.</p>
                  </div>
                </div>

                <div className="package-editor__media-layout">
                  <label className={`package-editor__upload ${packageDraft.imageUrl ? "has-image" : ""}`}>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) =>
                        onPickPackageImage(e.target.files?.[0] || null)
                      }
                    />
                    {packageDraft.imageUrl ? (
                      <img src={packageDraft.imageUrl} alt="معاينة صورة الباقة" />
                    ) : (
                      <span className="package-editor__upload-icon">
                        <FontAwesomeIcon icon={faImage} />
                      </span>
                    )}
                    <span className="package-editor__upload-copy">
                      <strong>{packageDraft.imageUrl ? "تغيير صورة الباقة" : "رفع صورة الباقة"}</strong>
                      <small>{packagePickedImageName || `PNG أو JPG · أقل من ${MAX_PACKAGE_IMAGE_MB}MB`}</small>
                    </span>
                  </label>

                  <div className="package-editor__media-fields">
                    <div className="pkgm__field">
                      <label>شروط استخدام الباقة</label>
                      <textarea
                        value={packageDraft.terms}
                        placeholder="مثال: غير قابلة للتحويل، الحجز المسبق مطلوب..."
                        onChange={(e) =>
                          setPackageDraft((p) => ({ ...p, terms: e.target.value }))
                        }
                      />
                    </div>
                    {packageDraft.imageUrl && (
                      <button
                        type="button"
                        className="dash-pill dash-pill-danger package-editor__remove-image"
                        onClick={() => {
                          setPackagePickedImageName("");
                          setPackageDraft((p) => ({ ...p, imageUrl: "" }));
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} /> إزالة الصورة
                      </button>
                    )}
                  </div>
                </div>
              </section>

              <section className="package-editor__section package-editor__section--services">
                <div className="package-editor__section-head package-editor__section-head--services">
                  <span className="package-editor__step">05</span>
                  <div>
                    <h3>الخدمات المشمولة</h3>
                    <p>اختر الخدمات التي يمكن للعميلة استخدام رصيد الجلسات عليها.</p>
                  </div>
                  <span className="package-editor__count-badge">
                    {packageComputed.picked.length} محددة
                  </span>
                </div>

                <div className="package-editor__service-tools">
                  <div className="package-editor__service-search">
                    <FontAwesomeIcon icon={faMagnifyingGlass} />
                    <input
                      type="text"
                      value={packageServiceSearch}
                      onChange={(e) => setPackageServiceSearch(e.target.value)}
                      placeholder="ابحث باسم الخدمة أو السعر أو المدة..."
                    />
                  </div>
                  <div className="pkgm__services-actions">
                    <button
                      type="button"
                      className="dash-pill dash-pill-outline dash-pill-sm"
                      onClick={selectAllVisiblePackageServices}
                    >
                      تحديد النتائج
                    </button>
                    <button
                      type="button"
                      className="dash-pill dash-pill-outline dash-pill-sm"
                      onClick={clearVisiblePackageServices}
                    >
                      إلغاء النتائج
                    </button>
                  </div>
                </div>

                <div className="package-editor__service-tabs">
                  <button
                    type="button"
                    className={packageListMode === "all" ? "is-active" : ""}
                    onClick={() => setPackageListMode("all")}
                  >
                    جميع الخدمات <span>{filteredPackageServices.length}</span>
                  </button>
                  <button
                    type="button"
                    className={packageListMode === "selected" ? "is-active" : ""}
                    onClick={() => setPackageListMode("selected")}
                  >
                    المحددة <span>{selectedPackageServices.length}</span>
                  </button>
                  <button
                    type="button"
                    className={packageListMode === "unselected" ? "is-active" : ""}
                    onClick={() => setPackageListMode("unselected")}
                  >
                    غير المحددة <span>{unselectedPackageServices.length}</span>
                  </button>
                </div>

                {!!packageComputed.picked.length && (
                  <div className="package-editor__selected-strip">
                    <span className="package-editor__selected-icon">
                      <FontAwesomeIcon icon={faCheck} />
                    </span>
                    <div>
                      <strong>{packageComputed.picked.length} خدمة ضمن الباقة</strong>
                      <p>
                        {packageComputed.picked
                          .slice(0, 5)
                          .map((service) => service.name)
                          .join("، ")}
                        {packageComputed.picked.length > 5 ? " ..." : ""}
                      </p>
                    </div>
                  </div>
                )}

                <div className="pkgm__services package-editor__services-list">
                  {[...visibleSelectedGroups, ...visibleUnselectedGroups].map((group, gi) => {
                    const firstUnselectedIdx = visibleSelectedGroups.length;
                    const isUnselectedGroup =
                      gi >= firstUnselectedIdx && visibleSelectedGroups.length > 0;
                    const groupKey = `${isUnselectedGroup ? "unselected" : "selected"}::${group.title}`;
                    const openByDefault = !isUnselectedGroup;
                    const isOpen = isPackageGroupOpen(groupKey, openByDefault);
                    const selectedInGroup = group.services.filter((service) =>
                      packageDraft.serviceIds.includes(service.id)
                    ).length;

                    return (
                      <div key={groupKey} className="pkgm__group package-editor__service-group">
                        <button
                          type="button"
                          className="pkgm__group-toggle"
                          onClick={() => togglePackageGroup(groupKey)}
                        >
                          <span className="pkgm__group-toggle-label">
                            <strong>{group.title}</strong>
                            <small>
                              {group.services.length} خدمة
                              {selectedInGroup > 0 ? ` · ${selectedInGroup} محددة` : ""}
                            </small>
                          </span>
                          <span className="pkgm__group-toggle-caret" aria-hidden="true">
                            {isOpen ? "−" : "+"}
                          </span>
                        </button>

                        {isOpen ? (
                          <div className="pkgm__group-items">
                            {group.services.map((service) => {
                              const selected = packageDraft.serviceIds.includes(service.id);
                              const sectionText = resolveSectionLabel(service.sectionId || "");
                              const categoryText = resolveCategoryLabel(
                                service.categoryName || service.categoryId || ""
                              );

                              return (
                                <button
                                  key={service.id}
                                  type="button"
                                  className={`pkgm__service pkgm__service-row package-editor__service-row ${selected ? "is-selected" : ""}`}
                                  onClick={() => toggleDraftServiceId(service.id)}
                                  aria-pressed={selected}
                                >
                                  <span className="package-editor__service-check">
                                    {selected ? <FontAwesomeIcon icon={faCheck} /> : null}
                                  </span>
                                  <span className="pkgm__service-main">
                                    <span className="pkgm__service-name">{service.name}</span>
                                    <span className="pkgm__service-meta">
                                      {sectionText} · {categoryText} · {service.durationMin} دقيقة
                                    </span>
                                  </span>
                                  <span className="package-editor__service-price">
                                    {service.price} <small>ر.س</small>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {!filteredPackageServices.length && (
                    <div className="pkgm__empty">لا توجد خدمات مطابقة للبحث</div>
                  )}
                  {filteredPackageServices.length > 0 &&
                    !visibleSelectedGroups.length &&
                    !visibleUnselectedGroups.length && (
                      <div className="pkgm__empty">
                        {packageListMode === "selected"
                          ? "لا توجد خدمات محددة حسب البحث الحالي"
                          : "كل الخدمات الحالية محددة بالفعل"}
                      </div>
                    )}
                </div>
              </section>
            </main>

            <aside className="package-editor__aside">
              <div className="package-editor__preview-card">
                <div className="package-editor__preview-media">
                  {packageDraft.imageUrl ? (
                    <img src={packageDraft.imageUrl} alt="صورة الباقة" />
                  ) : (
                    <span><FontAwesomeIcon icon={faImage} /></span>
                  )}
                  <div className="package-editor__preview-badges">
                    <span className={packageDraft.active !== false ? "is-live" : "is-off"}>
                      {packageDraft.active !== false ? "مفعّلة" : "موقوفة"}
                    </span>
                    <span className={packageDraft.saleEnabled !== false ? "is-sale" : "is-off"}>
                      {packageDraft.saleEnabled !== false ? "متاحة للبيع" : "غير معروضة"}
                    </span>
                  </div>
                </div>

                <div className="package-editor__preview-body">
                  <span className="package-editor__preview-label">معاينة الباقة</span>
                  <h3>{String(packageDraft.name || "").trim() || "اسم الباقة"}</h3>
                  <p>
                    {String(packageDraft.description || "").trim() ||
                      "سيظهر وصف الباقة هنا بعد إدخاله."}
                  </p>

                  <div className="package-editor__preview-kpis">
                    <div><strong>{packageComputed.picked.length}</strong><span>خدمة</span></div>
                    <div><strong>{packageComputed.sessionsCount}</strong><span>جلسة</span></div>
                    <div><strong>{packageComputed.validityDays}</strong><span>يوم</span></div>
                  </div>

                  <div className="package-editor__price-box">
                    <span>سعر البيع</span>
                    <strong>{packageComputed.price.toFixed(2)} <small>ر.س</small></strong>
                    <em>{packageComputed.averageSessionPrice.toFixed(2)} ر.س للجلسة</em>
                  </div>

                  <dl className="package-editor__preview-details">
                    <div><dt>بداية الإتاحة</dt><dd>{packageDraft.startDate || "غير محدد"}</dd></div>
                    <div><dt>نهاية الإتاحة</dt><dd>{packageDraft.endDate || "غير محدد"}</dd></div>
                    <div><dt>ترتيب الظهور</dt><dd>{packageDraft.sortOrder || 0}</dd></div>
                  </dl>
                </div>
              </div>

              <div className={`package-editor__readiness ${packageEditorChecks.isReady ? "is-ready" : ""}`}>
                <div className="package-editor__readiness-head">
                  <div>
                    <span>جاهزية الحفظ</span>
                    <strong>{packageEditorChecks.readyCount} / {packageEditorChecks.items.length}</strong>
                  </div>
                  <span className="package-editor__readiness-score">
                    {Math.round((packageEditorChecks.readyCount / packageEditorChecks.items.length) * 100)}%
                  </span>
                </div>
                <div className="package-editor__readiness-bar">
                  <span
                    style={
                      {
                        "--dsv2-offers-readiness": `${(packageEditorChecks.readyCount / packageEditorChecks.items.length) * 100}%`,
                      } as React.CSSProperties
                    }
                  />
                </div>
                <ul>
                  {packageEditorChecks.items.map((item) => (
                    <li key={item.label} className={item.ready ? "is-ready" : ""}>
                      <span>{item.ready ? <FontAwesomeIcon icon={faCheck} /> : "·"}</span>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="package-editor__aside-actions">
                <button
                  type="button"
                  className="dash-pill dash-pill-primary"
                  onClick={savePackageDraft}
                >
                  <FontAwesomeIcon icon={faCheck} />
                  {editingPackageId ? "حفظ التعديلات" : "إنشاء الباقة"}
                </button>
                <button
                  type="button"
                  className="dash-pill dash-pill-outline"
                  onClick={() => setPackageFormOpen(false)}
                >
                  إلغاء والعودة
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* Filters + Add */}
      <div className="offers-card dsv2-card dsv2-card--padded offers-section offers-section--filters">
        <div className="offers-card-title">
          <FontAwesomeIcon icon={faFilter} /> مركز العروض
        </div>
        <div className="offers-section-note">اعرض الحملات حسب حالتها، ثم ابحث مباشرة بالعنوان أو كود الخصم.</div>

        <div className="offers-row offers-row--filters">
          <div className="offers-filter-pills">
            <button
              type="button"
              className={`dash-pill dash-pill-sm ${filterMode === "all" ? "dash-pill-primary" : "dash-pill-outline"}`}
              onClick={() => setFilterMode("all")}
            >
              كل العروض ({Math.max(0, stats.total - stats.deletedCount)})
            </button>

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

        </div>

      </div>


      {/* Table */}
      <div className="offers-table-card dsv2-card dsv2-card--padded offers-section offers-section--offers-table">
        <div className="offers-card-title offers-section-heading">
          <span><FontAwesomeIcon icon={faTag} /> نتائج العروض</span>
          <span className="offers-section-count">{filteredOffers.length}</span>
        </div>
        {filteredOffers.length === 0 ? (
          <div className="offers-hint">لا توجد عروض مطابقة لهذا التصنيف. اختر «كل العروض» لعرض السارية والمجدولة والمنتهية.</div>
        ) : (
          <div className="pkg-offers-grid offers-as-packages-grid">
            {filteredOffers.map((o: any) => {
              const deleted = isDeleted(o);
              const scheduled = isScheduledByToday(o) && !isExpiredByToday(o) && !deleted;
              const expired = isExpiredByToday(o) && !deleted;
              const statusLabel = deleted ? "محذوف" : scheduled ? "مجدول" : expired ? "منتهي" : o.active ? "نشط" : "موقوف";

              return (
                <div key={o.id} className={`pkg-offer-card offers-like-package-card ${deleted ? "is-deleted" : ""}`}>
                  <div className="pkg-offer-inner">
                    <div className="pkg-offer-image-wrap">
                      {o.imageUrl ? (
                        <img className="pkg-offer-image" src={o.imageUrl} alt="offer" />
                      ) : (
                        <div className="pkg-offer-image pkg-offer-image--empty">—</div>
                      )}
                    </div>

                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">العنوان</div>
                      <div className="pkg-offer-value">{o.title}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الكود</div>
                      <div className="pkg-offer-value">{o.code || "—"}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الخصم</div>
                      <div className="pkg-offer-value">{o.discountType === "percent" ? `${o.value}%` : `${o.value} ريال`}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الفترة</div>
                      <div className="pkg-offer-value">{o.startDate || "—"} → {o.endDate || "—"}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الحالة</div>
                      <div className="pkg-offer-value"><span className={`offers-status-badge ${deleted ? "is-deleted" : scheduled ? "is-scheduled" : expired || !o.active ? "is-muted" : "is-active"}`}>{statusLabel}</span></div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">الاستخدام</div>
                      <div className="pkg-offer-value">{o.usageCount || 0}</div>
                    </div>
                    <div className="pkg-offer-row">
                      <div className="pkg-offer-label">النطاق</div>
                      <div className="pkg-offer-value">{(o.appliesTo || "all") === "services" ? "خدمات محددة" : "الكل"}</div>
                    </div>

                    <div className="of-actions of-actions--card">
                      {!deleted && (
                        <>
                          <button className="dash-pill dash-pill-outline dash-pill-sm" type="button" onClick={() => openEdit(o)}>
                            <FontAwesomeIcon icon={faPen} /> تعديل
                          </button>
                          <button
                            className={`dash-pill ${o.active ? "dash-pill-warning" : "dash-pill-success"} dash-pill-sm`}
                            type="button"
                            onClick={() => toggleActive(o)}
                            title={o.active ? "إيقاف" : "تفعيل"}
                          >
                            <FontAwesomeIcon icon={o.active ? faBan : faCheck} />
                            {o.active ? " إيقاف" : " تفعيل"}
                          </button>
                          <button className="dash-pill dash-pill-danger dash-pill-sm" type="button" onClick={() => softDelete(o)}>
                            <FontAwesomeIcon icon={faTrash} /> حذف
                          </button>
                        </>
                      )}

                      {deleted && (
                        <>
                          <button className="dash-pill dash-pill-success dash-pill-sm" type="button" onClick={() => restore(o)}>
                            <FontAwesomeIcon icon={faRotateLeft} /> استرجاع
                          </button>
                          <button className="dash-pill dash-pill-danger dash-pill-sm" type="button" onClick={() => hardDelete(o)}>
                            <FontAwesomeIcon icon={faSkullCrossbones} /> حذف نهائي
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Offer Editor V5 */}
      {open && (
        <div
          ref={offerFormRef}
          className={`offers-card dsv2-card offers-section offers-section--offer-form offer-editor-v5 ${editing ? "is-editing" : "is-creating"}`}
        >
          <header className="offer-editor__header">
            <div className="offer-editor__heading">
              <span className="offer-editor__heading-icon" aria-hidden="true">
                <FontAwesomeIcon icon={faTag} />
              </span>
              <div>
                <span className="offer-editor__eyebrow">OFFER MANAGEMENT</span>
                <h2>{editing ? "تعديل العرض" : "إنشاء عرض جديد"}</h2>
                <p>
                  إدارة بيانات العرض، التسعير، حدود الاستخدام، النطاق، الاستهداف، النشر والصورة من مساحة عمل واحدة.
                </p>
              </div>
            </div>

            <div className="offer-editor__header-actions">
              <button className="dash-pill dash-pill-outline" type="button" onClick={close}>
                <FontAwesomeIcon icon={faXmark} /> إغلاق
              </button>
              <button className="dash-pill dash-pill-primary offer-editor__save-top" type="button" onClick={save}>
                <FontAwesomeIcon icon={faCheck} /> حفظ العرض
              </button>
            </div>
          </header>

          <div className="offer-editor__layout">
            <main className="offer-editor__main">
              <section className="offer-editor__section">
                <div className="offer-editor__section-head">
                  <span className="offer-editor__step">01</span>
                  <div>
                    <h3>هوية العرض</h3>
                    <p>البيانات التي تظهر للعميلة في التطبيق وصفحات العروض.</p>
                  </div>
                </div>

                <div className="offer-editor__grid offer-editor__grid--identity">
                  <div className="offer-editor__field">
                    <label>عنوان العرض <em>مطلوب</em></label>
                    <input
                      value={form.title}
                      onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                      placeholder="مثال: عرض نهاية الأسبوع"
                    />
                    <small>اكتب عنوانًا واضحًا ومباشرًا يسهل فهمه.</small>
                  </div>

                  <div className="offer-editor__field">
                    <label>كود العرض <em>مطلوب</em></label>
                    <div className="offer-editor__code-row">
                      <input
                        value={form.code}
                        onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                        placeholder="QS123"
                      />
                      <button
                        className="dash-pill dash-pill-outline"
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, code: generateCode() }))}
                      >
                        <FontAwesomeIcon icon={faWandMagicSparkles} /> توليد
                      </button>
                    </div>
                    <small>يُستخدم عند تطبيق العرض بالكوبون أو داخل الحجز.</small>
                  </div>

                  <div className="offer-editor__field offer-editor__field--wide">
                    <label>وصف العرض</label>
                    <textarea
                      rows={4}
                      value={form.description}
                      onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="اكتب وصفًا مختصرًا، شروط الاستفادة، وما الذي تحصل عليه العميلة..."
                    />
                    <small>الوصف هو المكان الأنسب لشرح الشروط والملاحظات للعميلة.</small>
                  </div>
                </div>
              </section>

              <section className="offer-editor__section">
                <div className="offer-editor__section-head">
                  <span className="offer-editor__step">02</span>
                  <div>
                    <h3>الخصم والتسعير</h3>
                    <p>حدد آلية الخصم والأسعار المعروضة وحدود الحماية المالية.</p>
                  </div>
                </div>

                <div className="offer-editor__discount-selector" role="group" aria-label="نوع الخصم">
                  <button
                    type="button"
                    className={form.discountType === "fixed" ? "is-active" : ""}
                    onClick={() => setForm((prev) => ({ ...prev, discountType: "fixed" }))}
                  >
                    <strong>مبلغ ثابت</strong>
                    <span>خصم قيمة محددة بالريال</span>
                  </button>
                  <button
                    type="button"
                    className={form.discountType === "percent" ? "is-active" : ""}
                    onClick={() => setForm((prev) => ({ ...prev, discountType: "percent" }))}
                  >
                    <strong>نسبة مئوية</strong>
                    <span>خصم نسبة من قيمة الخدمة</span>
                  </button>
                </div>

                <div className="offer-editor__commercial-grid">
                  <div className="offer-editor__field offer-editor__commercial-field is-primary">
                    <label>قيمة الخصم <em>مطلوب</em></label>
                    <div className="offer-editor__input-suffix">
                      <DashboardNumberInputV2
                        min={0}
                        max={form.discountType === "percent" ? 100 : undefined}
                        step="0.01"
                        value={form.value}
                        onChange={(e) => setForm((prev) => ({ ...prev, value: Number(e.target.value) }))}
                      />
                      <span>{form.discountType === "percent" ? "%" : "ريال"}</span>
                    </div>
                  </div>

                  <div className="offer-editor__field offer-editor__commercial-field">
                    <label>السعر قبل الخصم</label>
                    <div className="offer-editor__input-suffix">
                      <DashboardNumberInputV2
                        min={0}
                        step="0.01"
                        value={form.priceBefore}
                        onChange={(e) => setForm((prev) => ({ ...prev, priceBefore: Number(e.target.value) }))}
                      />
                      <span>ريال</span>
                    </div>
                  </div>

                  <div className="offer-editor__field offer-editor__commercial-field">
                    <label>السعر بعد الخصم</label>
                    <div className="offer-editor__input-suffix">
                      <DashboardNumberInputV2
                        min={0}
                        step="0.01"
                        value={form.priceAfter}
                        onChange={(e) => setForm((prev) => ({ ...prev, priceAfter: Number(e.target.value) }))}
                      />
                      <span>ريال</span>
                    </div>
                  </div>

                  <div className="offer-editor__field offer-editor__commercial-field">
                    <label>ترتيب الظهور</label>
                    <DashboardNumberInputV2
                      min={0}
                      value={form.sortOrder}
                      onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                    />
                  </div>
                </div>

                <div className="offer-editor__pricing-summary">
                  <div>
                    <span>الخصم المحسوب</span>
                    <strong>{offerEditorComputed.calculatedDiscount.toFixed(2)} ريال</strong>
                  </div>
                  <div>
                    <span>السعر المقترح بعد الخصم</span>
                    <strong>{offerEditorComputed.suggestedPriceAfter.toFixed(2)} ريال</strong>
                  </div>
                  <div>
                    <span>التوفير الظاهر</span>
                    <strong>{offerEditorComputed.explicitSaving.toFixed(2)} ريال</strong>
                  </div>
                  <button type="button" className="dash-pill dash-pill-outline" onClick={calculateOfferPriceAfter}>
                    احتساب السعر تلقائيًا
                  </button>
                </div>

                <div className="offer-editor__limits-grid">
                  <div className="offer-editor__field">
                    <label>إجمالي مرات الاستخدام</label>
                    <DashboardNumberInputV2
                      min={0}
                      value={form.usageLimit}
                      onChange={(e) => setForm((prev) => ({ ...prev, usageLimit: Number(e.target.value) }))}
                    />
                    <small>ضع 0 لعدم تحديد حد إجمالي.</small>
                  </div>
                  <div className="offer-editor__field">
                    <label>الحد لكل عميلة</label>
                    <DashboardNumberInputV2
                      min={0}
                      value={form.perClientLimit}
                      onChange={(e) => setForm((prev) => ({ ...prev, perClientLimit: Number(e.target.value) }))}
                    />
                    <small>ضع 0 للسماح بدون حد فردي.</small>
                  </div>
                  <div className="offer-editor__field">
                    <label>الحد الأدنى للطلب</label>
                    <div className="offer-editor__input-suffix">
                      <DashboardNumberInputV2
                        min={0}
                        step="0.01"
                        value={form.minOrder}
                        onChange={(e) => setForm((prev) => ({ ...prev, minOrder: Number(e.target.value) }))}
                      />
                      <span>ريال</span>
                    </div>
                  </div>
                  <div className="offer-editor__field">
                    <label>الحد الأعلى للخصم</label>
                    <div className="offer-editor__input-suffix">
                      <DashboardNumberInputV2
                        min={0}
                        step="0.01"
                        value={form.maxDiscount}
                        onChange={(e) => setForm((prev) => ({ ...prev, maxDiscount: Number(e.target.value) }))}
                      />
                      <span>ريال</span>
                    </div>
                  </div>
                </div>
              </section>

              <section className="offer-editor__section">
                <div className="offer-editor__section-head">
                  <span className="offer-editor__step">03</span>
                  <div>
                    <h3>الفترة وحالة النشر</h3>
                    <p>تحكم في موعد ظهور العرض وحالته داخل النظام وتطبيق العميلة.</p>
                  </div>
                </div>

                <div className="offer-editor__grid">
                  <div className="offer-editor__field">
                    <label>تاريخ البداية</label>
                    <DashboardDatePickerV2
                      value={form.startDate}
                      onChange={(value) => setForm((prev) => ({ ...prev, startDate: value }))}
                    />
                  </div>
                  <div className="offer-editor__field">
                    <label>تاريخ النهاية</label>
                    <DashboardDatePickerV2
                      value={form.endDate}
                      onChange={(value) => setForm((prev) => ({ ...prev, endDate: value }))}
                    />
                  </div>
                  <div className="offer-editor__field">
                    <label>حالة النشر</label>
                    <DashboardSelectV2
                      options={OFFER_STATUS_OPTIONS}
                      value={form.status}
                      onChange={(value) => setForm((prev) => ({ ...prev, status: value as OfferForm["status"] }))}
                    />
                  </div>
                  <div className="offer-editor__status-card">
                    <span>الحالة الفعلية حسب التاريخ</span>
                    <strong>{offerEditorComputed.dateStatus}</strong>
                  </div>
                </div>

                <div className="offer-editor__toggle-grid">
                  <label className={`offer-editor__toggle-card ${form.active ? "is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                    />
                    <span>
                      <strong>تفعيل العرض</strong>
                      <small>يسمح للنظام بتطبيق الخصم خلال فترة العرض.</small>
                    </span>
                    <i>{form.active ? "مفعّل" : "موقوف"}</i>
                  </label>

                  <label className={`offer-editor__toggle-card ${form.published ? "is-on" : ""}`}>
                    <input
                      type="checkbox"
                      checked={form.published}
                      onChange={(e) => setForm((prev) => ({ ...prev, published: e.target.checked }))}
                    />
                    <span>
                      <strong>النشر للعميلات</strong>
                      <small>إظهار العرض في تطبيق العميلة وصفحات العروض.</small>
                    </span>
                    <i>{form.published ? "منشور" : "مخفي"}</i>
                  </label>
                </div>
              </section>

              <section className="offer-editor__section">
                <div className="offer-editor__section-head">
                  <span className="offer-editor__step">04</span>
                  <div>
                    <h3>الجمهور وزر الإجراء</h3>
                    <p>حدد من يمكنه رؤية العرض وإلى أين ينتقل زر الحجز.</p>
                  </div>
                </div>

                <div className="offer-editor__choice-grid offer-editor__choice-grid--two">
                  <button
                    type="button"
                    className={form.targetScope === "all" ? "is-active" : ""}
                    onClick={() => setForm((prev) => ({ ...prev, targetScope: "all", targetClientIdsText: "" }))}
                  >
                    <strong>جميع العميلات</strong>
                    <span>عرض عام متاح لكل الحسابات المؤهلة.</span>
                  </button>
                  <button
                    type="button"
                    className={form.targetScope === "specific" ? "is-active" : ""}
                    onClick={() => setForm((prev) => ({ ...prev, targetScope: "specific" }))}
                  >
                    <strong>عميلات محددات</strong>
                    <span>استهداف قائمة معرفات أو حسابات بعينها.</span>
                  </button>
                </div>

                {form.targetScope === "specific" && (
                  <div className="offer-editor__field offer-editor__field--spaced">
                    <label>معرفات العميلات المستهدفات <em>مطلوب للنطاق المحدد</em></label>
                    <textarea
                      rows={3}
                      value={form.targetClientIdsText}
                      onChange={(e) => setForm((prev) => ({ ...prev, targetClientIdsText: e.target.value }))}
                      placeholder="clientId أو Firebase UID، مفصولة بفواصل أو أسطر"
                    />
                  </div>
                )}

                <div className="offer-editor__grid offer-editor__grid--action">
                  <div className="offer-editor__field">
                    <label>نص زر الإجراء</label>
                    <input
                      value={form.ctaLabel}
                      onChange={(e) => setForm((prev) => ({ ...prev, ctaLabel: e.target.value }))}
                      placeholder="احجزي الآن"
                    />
                  </div>
                  <div className="offer-editor__field">
                    <label>رابط الإجراء</label>
                    <input
                      value={form.ctaUrl}
                      onChange={(e) => setForm((prev) => ({ ...prev, ctaUrl: e.target.value }))}
                      placeholder="/booking أو رابط داخلي"
                    />
                  </div>
                </div>
              </section>

              <section className="offer-editor__section offer-editor__section--scope">
                <div className="offer-editor__section-head">
                  <span className="offer-editor__step">05</span>
                  <div>
                    <h3>نطاق تطبيق العرض</h3>
                    <p>حدد ما إذا كان الخصم عامًا أو مرتبطًا بخدمات أو تصنيفات محددة.</p>
                  </div>
                </div>

                <div className="offer-editor__choice-grid offer-editor__choice-grid--three">
                  <button
                    type="button"
                    className={form.appliesTo === "all" ? "is-active" : ""}
                    onClick={() => setForm((prev) => ({ ...prev, appliesTo: "all", serviceIds: [], categoryIds: [], sequenceSteps: [] }))}
                  >
                    <strong>كل الخدمات</strong>
                    <span>يطبق العرض على كامل كتالوج الصالون.</span>
                  </button>
                  <button
                    type="button"
                    className={form.appliesTo === "services" ? "is-active" : ""}
                    onClick={() => setForm((prev) => ({ ...prev, appliesTo: "services", categoryIds: [] }))}
                  >
                    <strong>خدمات محددة</strong>
                    <span>{form.serviceIds.length} خدمة محددة حاليًا.</span>
                  </button>
                  <button
                    type="button"
                    className={form.appliesTo === "categories" ? "is-active" : ""}
                    onClick={() => setForm((prev) => ({ ...prev, appliesTo: "categories", serviceIds: [], sequenceSteps: [] }))}
                  >
                    <strong>تصنيفات محددة</strong>
                    <span>{form.categoryIds.length} تصنيف محدد حاليًا.</span>
                  </button>
                </div>

                {form.appliesTo === "services" && (
                  <div className="offer-editor__scope-panel">
                    <div className="offer-editor__service-toolbar">
                      <div>
                        <strong>اختيار الخدمات</strong>
                        <span>{form.serviceIds.length} من {servicesFlat.length} خدمة</span>
                      </div>
                      <div className="offer-editor__toolbar-actions">
                        <button type="button" className="dash-pill dash-pill-outline dash-pill-sm" onClick={selectAllVisibleOfferServices}>
                          تحديد الظاهر
                        </button>
                        <button type="button" className="dash-pill dash-pill-outline dash-pill-sm" onClick={clearVisibleOfferServices}>
                          إلغاء الظاهر
                        </button>
                        <button
                          type="button"
                          className="dash-pill dash-pill-outline dash-pill-sm"
                          onClick={() => setServicesPickerOpen((current) => !current)}
                        >
                          {servicesPickerOpen ? "إخفاء القائمة" : "عرض القائمة"}
                        </button>
                      </div>
                    </div>

                    {form.serviceIds.length > 0 && (
                      <div className="offer-editor__selected-summary">
                        <span>الخدمات المختارة</span>
                        <strong>{selectedOfferServices.map((service) => service.name).join("، ") || `${form.serviceIds.length} خدمة`}</strong>
                      </div>
                    )}

                    {servicesPickerOpen && (
                      <>
                        <div className="offer-editor__service-search">
                          <FontAwesomeIcon icon={faMagnifyingGlass} />
                          <input
                            value={serviceSearch}
                            onChange={(e) => setServiceSearch(e.target.value)}
                            placeholder="ابحث باسم الخدمة أو القسم أو السعر..."
                          />
                        </div>

                        <div className="offer-editor__service-groups">
                          {servicesGrouped.length === 0 ? (
                            <div className="offer-editor__empty">لا توجد خدمات مطابقة للبحث.</div>
                          ) : (
                            servicesGrouped.map(([groupName, list]) => (
                              <div key={groupName} className="offer-editor__service-group">
                                <div className="offer-editor__service-group-head">
                                  <strong>{groupName}</strong>
                                  <span>{list.length} خدمة</span>
                                </div>
                                <div className="offer-editor__service-list">
                                  {list.map((service) => {
                                    const selected = form.serviceIds.includes(service.id);
                                    return (
                                      <label key={service.id} className={`offer-editor__service-row ${selected ? "is-selected" : ""}`}>
                                        <input type="checkbox" checked={selected} onChange={() => toggleServiceId(service.id)} />
                                        <span className="offer-editor__service-check"><FontAwesomeIcon icon={faCheck} /></span>
                                        <span className="offer-editor__service-copy">
                                          <strong>{service.name}</strong>
                                          <small>{service.sectionTitle} · {service.category}</small>
                                        </span>
                                        <span className="offer-editor__service-price">{service.basePrice.toFixed(2)} ريال</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    )}

                    {form.serviceIds.length > 0 && (
                      <div className="offer-editor__sequence-panel">
                        <button
                          type="button"
                          className="offer-editor__sequence-toggle"
                          onClick={() => setSequenceEditorOpen((current) => !current)}
                        >
                          <span>
                            <strong>إعداد تسلسل الخدمات</strong>
                            <small>اختياري للحجوزات التي تعتمد ترتيبًا وفواصل زمنية.</small>
                          </span>
                          <b>{sequenceEditorOpen ? "إخفاء" : "فتح"}</b>
                        </button>

                        {sequenceEditorOpen && (
                          <div className="offer-editor__sequence-table-wrap">
                            <table className="offer-editor__sequence-table">
                              <thead>
                                <tr>
                                  <th>الترتيب</th>
                                  <th>الخدمة</th>
                                  <th>الفاصل بعد الخدمة</th>
                                  <th>اسم بديل</th>
                                  <th>تحريك</th>
                                </tr>
                              </thead>
                              <tbody>
                                {normalizeSequenceSteps(form.sequenceSteps, form.serviceIds).map((step, index, rows) => {
                                  const service = serviceById.get(String(step.serviceId || "").trim());
                                  return (
                                    <tr key={`offer-sequence-${step.serviceId}`}>
                                      <td>{index + 1}</td>
                                      <td>{step.titleSnapshot || service?.name || step.serviceId}</td>
                                      <td>
                                        <div className="offer-editor__input-suffix">
                                          <DashboardNumberInputV2
                                            min={0}
                                            value={Math.max(0, Number(step.gapAfterMin || 0))}
                                            onChange={(e) => updateSequenceStepGap(step.serviceId, Number(e.target.value || 0))}
                                          />
                                          <span>دقيقة</span>
                                        </div>
                                      </td>
                                      <td>
                                        <input
                                          value={String(step.titleSnapshot || "")}
                                          placeholder={service?.name || "اسم اختياري"}
                                          onChange={(e) => updateSequenceStepTitle(step.serviceId, e.target.value)}
                                        />
                                      </td>
                                      <td>
                                        <div className="offer-editor__move-actions">
                                          <button type="button" disabled={index === 0} onClick={() => moveSequenceStep(step.serviceId, -1)}>↑</button>
                                          <button type="button" disabled={index === rows.length - 1} onClick={() => moveSequenceStep(step.serviceId, 1)}>↓</button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {form.appliesTo === "categories" && (
                  <div className="offer-editor__scope-panel">
                    <div className="offer-editor__category-head">
                      <div>
                        <strong>اختيار التصنيفات</strong>
                        <span>{form.categoryIds.length} من {offerCategories.length} تصنيف</span>
                      </div>
                      <div className="offer-editor__toolbar-actions">
                        <button
                          type="button"
                          className="dash-pill dash-pill-outline dash-pill-sm"
                          onClick={() => setForm((prev) => ({ ...prev, categoryIds: offerCategories.map((category) => category.id) }))}
                        >
                          تحديد الكل
                        </button>
                        <button
                          type="button"
                          className="dash-pill dash-pill-outline dash-pill-sm"
                          onClick={() => setForm((prev) => ({ ...prev, categoryIds: [] }))}
                        >
                          إلغاء الكل
                        </button>
                      </div>
                    </div>

                    <div className="offer-editor__category-grid">
                      {offerCategories.map((category) => {
                        const selected = form.categoryIds.includes(category.id);
                        return (
                          <button
                            key={category.id}
                            type="button"
                            className={selected ? "is-selected" : ""}
                            onClick={() => toggleOfferCategory(category.id)}
                          >
                            <span className="offer-editor__category-check"><FontAwesomeIcon icon={faCheck} /></span>
                            <strong>{category.name}</strong>
                            <small>{category.servicesCount} خدمة</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>

              <section className="offer-editor__section offer-editor__section--media">
                <div className="offer-editor__section-head">
                  <span className="offer-editor__step">06</span>
                  <div>
                    <h3>صورة العرض</h3>
                    <p>ارفع صورة واضحة ومتناسقة مع هوية الصالون؛ الحد الأعلى {MAX_IMAGE_MB}MB.</p>
                  </div>
                </div>

                <div className="offer-editor__media-layout">
                  <label className={`offer-editor__upload ${form.imageUrl ? "has-image" : ""}`}>
                    <input type="file" accept="image/*" onChange={(e) => onPickImage(e.target.files?.[0] || null)} />
                    {form.imageUrl ? (
                      <img src={form.imageUrl} alt="معاينة صورة العرض" />
                    ) : (
                      <span className="offer-editor__upload-placeholder">
                        <FontAwesomeIcon icon={faImage} />
                        <strong>اختيار صورة العرض</strong>
                        <small>PNG أو JPG أو WEBP</small>
                      </span>
                    )}
                  </label>

                  <div className="offer-editor__media-copy">
                    <span>الملف الحالي</span>
                    <strong>{pickedImageName || (form.imageUrl ? "صورة محفوظة" : "لم يتم اختيار صورة")}</strong>
                    <p>يفضل استخدام صورة أفقية واضحة بدون نصوص صغيرة لضمان ظهور جيد في الجوال.</p>
                    {form.imageUrl && (
                      <button
                        className="dash-pill dash-pill-danger"
                        type="button"
                        onClick={() => {
                          setPickedImageName("");
                          setForm((prev) => ({ ...prev, imageUrl: "" }));
                        }}
                      >
                        <FontAwesomeIcon icon={faTrash} /> إزالة الصورة
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </main>

            <aside className="offer-editor__aside">
              <div className="offer-editor__preview-card">
                <div className="offer-editor__preview-media">
                  {form.imageUrl ? (
                    <img src={form.imageUrl} alt="معاينة العرض" />
                  ) : (
                    <div className="offer-editor__preview-empty"><FontAwesomeIcon icon={faImage} /></div>
                  )}
                  <div className="offer-editor__preview-badges">
                    <span>{form.published ? "منشور" : "مخفي"}</span>
                    <span>{offerEditorComputed.dateStatus}</span>
                  </div>
                </div>

                <div className="offer-editor__preview-body">
                  <span className="offer-editor__preview-label">معاينة العرض</span>
                  <h3>{form.title.trim() || "عنوان العرض"}</h3>
                  <p>{form.description.trim() || "سيظهر وصف العرض هنا للعميلة."}</p>

                  <div className="offer-editor__discount-box">
                    <strong>
                      {Number(form.value || 0).toFixed(form.discountType === "percent" ? 0 : 2)}
                      {form.discountType === "percent" ? "%" : " ريال"}
                    </strong>
                    <span>قيمة الخصم</span>
                  </div>

                  {(offerEditorComputed.priceBefore > 0 || offerEditorComputed.priceAfter > 0) && (
                    <div className="offer-editor__preview-prices">
                      <span>{offerEditorComputed.priceBefore.toFixed(2)} ريال</span>
                      <strong>{offerEditorComputed.priceAfter.toFixed(2)} ريال</strong>
                    </div>
                  )}

                  <dl className="offer-editor__preview-details">
                    <div><dt>الكود</dt><dd>{form.code || "—"}</dd></div>
                    <div><dt>الفترة</dt><dd>{form.startDate || "مفتوحة"} — {form.endDate || "مفتوحة"}</dd></div>
                    <div><dt>النطاق</dt><dd>{form.appliesTo === "all" ? "كل الخدمات" : form.appliesTo === "services" ? `${form.serviceIds.length} خدمة` : `${form.categoryIds.length} تصنيف`}</dd></div>
                    <div><dt>الجمهور</dt><dd>{form.targetScope === "all" ? "جميع العميلات" : "عميلات محددات"}</dd></div>
                    <div><dt>الاستخدام</dt><dd>{form.usageLimit > 0 ? `${form.usageLimit} مرة` : "غير محدود"}</dd></div>
                    <div><dt>لكل عميلة</dt><dd>{form.perClientLimit > 0 ? `${form.perClientLimit} مرة` : "غير محدود"}</dd></div>
                  </dl>

                  <button type="button" className="offer-editor__preview-cta">
                    {form.ctaLabel.trim() || "احجزي الآن"}
                  </button>
                </div>
              </div>

              <div className={`offer-editor__readiness ${offerEditorChecks.isReady ? "is-ready" : ""}`}>
                <div className="offer-editor__readiness-head">
                  <div>
                    <span>جاهزية العرض</span>
                    <strong>{offerEditorChecks.isReady ? "جاهز للحفظ" : "يحتاج مراجعة"}</strong>
                  </div>
                  <b>{offerEditorChecks.readyCount}/{offerEditorChecks.items.length}</b>
                </div>
                <div className="offer-editor__readiness-bar">
                  <span
                    style={
                      {
                        "--dsv2-offers-readiness": `${(offerEditorChecks.readyCount / offerEditorChecks.items.length) * 100}%`,
                      } as React.CSSProperties
                    }
                  />
                </div>
                <ul>
                  {offerEditorChecks.items.map((item) => (
                    <li key={item.label} className={item.ready ? "is-ready" : ""}>
                      <span><FontAwesomeIcon icon={faCheck} /></span>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="offer-editor__aside-summary">
                <span>قيمة الخدمات المحددة</span>
                <strong>{offerEditorComputed.serviceValue.toFixed(2)} ريال</strong>
                <small>قيمة إرشادية محسوبة من أسعار الخدمات المختارة.</small>
              </div>

              <div className="offer-editor__aside-actions">
                <button className="dash-pill dash-pill-primary" type="button" onClick={save}>
                  <FontAwesomeIcon icon={faCheck} /> حفظ العرض
                </button>
                <button className="dash-pill dash-pill-outline" type="button" onClick={close}>
                  إلغاء
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}
    </main>
  );
};

export default DashboardOffers;



