import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import { AppSettingsService } from "../../services/AppSettingsService";

import "../../styles/DashboardModals.css";
import "../../styles/stylesSettings/DashboardSettings.css";
import "../../styles/stylesSettings/SettingsCatalog.css";
import {
  PackageService,
  normalizePackageServiceIds,
} from "../../services/PackageService";

const SALON_ID = "main";
const SECTIONS = ["salons", SALON_ID, "service_sections"] as const;
const CATEGORIES = ["salons", SALON_ID, "service_categories"] as const;
const SERVICES = ["salons", SALON_ID, "services"] as const;

function buildId(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/^_+|_+$/g, "");
}
function clampInt(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function parseNumberInput(raw: string, fallback = 0) {
  if (raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
function toMillisSafe(v: any) {
  if (!v) return 0;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (typeof v?.seconds === "number") return Number(v.seconds) * 1000;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmtTs(v: any) {
  const ms = toMillisSafe(v);
  if (!ms) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ms));
}
function money(v: number) {
  return new Intl.NumberFormat("ar-SA", {
    maximumFractionDigits: 2,
  }).format(Math.max(0, Number(v || 0)));
}

type SectionRow = {
  id: string;
  name: string;
  active: boolean;
  order: number;
  createdAt?: any;
  updatedAt?: any;
};
type CategoryRow = {
  id: string;
  sectionId: string;
  name: string;
  active: boolean;
  order: number;
  createdAt?: any;
  updatedAt?: any;
};
type ServiceRow = {
  id: string;
  sectionId: string;
  categoryId: string;
  name: string;
  durationMin: number;
  price: number;
  seasonPrice?: number | null;
  active: boolean;
  createdAt?: any;
  updatedAt?: any;
};

type PackageRow = {
  id: string;
  name: string;
  serviceIds: string[];
  sessionsCount: number;
  price: number;
  active: boolean;
  createdAt?: any;
  updatedAt?: any;
};

type ListMode = "sections" | "services";
type DetailsMode = "view" | "edit";
type DetailsTab = "overview" | "pricing" | "variants" | "audit";
type FilterStatus = "all" | "active" | "inactive";
type ComposerMode = null | "section" | "service";
type ServiceComposerSpot = "pricing" | "variants";

const DEFAULT_PACKAGE_SESSIONS = 10;

function resetPackageFormState(setters: {
  setPackageName: (value: string) => void;
  setPackageServiceIds: (value: string[]) => void;
  setPackageSessionsCount: (value: number) => void;
  setPackagePrice: (value: number) => void;
  setPackageActive: (value: boolean) => void;
  setEditingPackageId: (value: string | null) => void;
}) {
  setters.setPackageName("");
  setters.setPackageServiceIds([]);
  setters.setPackageSessionsCount(DEFAULT_PACKAGE_SESSIONS);
  setters.setPackagePrice(0);
  setters.setPackageActive(true);
  setters.setEditingPackageId(null);
}

export default function SettingsCatalog(props: { hasAdminPower: boolean }) {
  const navigate = useNavigate();
  const { hasAdminPower } = props;

  const [catalogMsg, setCatalogMsg] = useState("");
  const [secLoading, setSecLoading] = useState(false);
  const [catLoading, setCatLoading] = useState(false);
  const [srvLoading, setSrvLoading] = useState(false);
  const [pkgLoading, setPkgLoading] = useState(false);
  const [seasonLoading, setSeasonLoading] = useState(false);

  const [sections, setSections] = useState<SectionRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);

  const [packageName, setPackageName] = useState("");
  const [packageServiceIds, setPackageServiceIds] = useState<string[]>([]);
  const [packageSessionsCount, setPackageSessionsCount] =
    useState<number>(DEFAULT_PACKAGE_SESSIONS);
  const [packagePrice, setPackagePrice] = useState<number>(0);
  const [packageActive, setPackageActive] = useState(true);
  const [packageSaving, setPackageSaving] = useState(false);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(
    null
  );

  const [activeListMode, setActiveListMode] =
    useState<ListMode>("sections");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<DetailsMode>("view");
  const [activeTab, setActiveTab] = useState<DetailsTab>("overview");
  const [sectionServiceCategoryId, setSectionServiceCategoryId] =
    useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<FilterStatus>("all");
  const [serviceSectionFilter, setServiceSectionFilter] =
    useState("all");

  const [composerMode, setComposerMode] =
    useState<ComposerMode>(null);
  const [serviceComposerSpot, setServiceComposerSpot] =
    useState<ServiceComposerSpot>("pricing");
  const [newSection, setNewSection] = useState({
    name: "",
    order: 1,
    active: true,
  });
  const [newService, setNewService] = useState({
    sectionId: "",
    categoryId: "",
    name: "",
    durationMin: 60,
    price: 0,
    seasonPrice: null as number | null,
    active: true,
  });
  const [newCategoryName, setNewCategoryName] = useState("");

  const [sectionDraft, setSectionDraft] = useState<SectionRow | null>(
    null
  );
  const [serviceDraft, setServiceDraft] = useState<ServiceRow | null>(
    null
  );
  const [openedServiceIdInSection, setOpenedServiceIdInSection] =
    useState<string | null>(null);
  const [openedServiceModeInSection, setOpenedServiceModeInSection] =
    useState<DetailsMode>("view");
  const [openedServiceDraftInSection, setOpenedServiceDraftInSection] =
    useState<ServiceRow | null>(null);
  const openedServicePanelRef = useRef<HTMLDivElement | null>(null);
  const [variantsServicesCategoryId, setVariantsServicesCategoryId] =
    useState("");
  const variantsServicesPanelRef = useRef<HTMLDivElement | null>(null);
  const [variantsPanelRenderKey, setVariantsPanelRenderKey] =
    useState(0);
  const [serviceViewRenderKey, setServiceViewRenderKey] =
    useState(0);

  const [seasonPricingEnabled, setSeasonPricingEnabled] =
    useState(false);
  const [seasonPricingFrom, setSeasonPricingFrom] = useState("");
  const [seasonPricingTo, setSeasonPricingTo] = useState("");

  const showMsg = (msg: string, ms = 1800) => {
    setCatalogMsg(msg);
    if (ms > 0) setTimeout(() => setCatalogMsg(""), ms);
  };

  const sectionById = useMemo(
    () => new Map(sections.map((x) => [x.id, x] as const)),
    [sections]
  );
  const categoryById = useMemo(
    () => new Map(categories.map((x) => [x.id, x] as const)),
    [categories]
  );
  const serviceById = useMemo(
    () => new Map(services.map((x) => [x.id, x] as const)),
    [services]
  );
  const selectedPackageServiceIds = useMemo(
    () => normalizePackageServiceIds(packageServiceIds),
    [packageServiceIds]
  );
  const nextSectionOrder = useMemo(
    () =>
      sections.length
        ? Math.max(...sections.map((s) => Number(s.order || 0))) + 1
        : 1,
    [sections]
  );

  const selectedSectionLive = useMemo(() => {
    if (!selectedId) return null;
    if (activeListMode === "sections") {
      return sections.find((x) => x.id === selectedId) || null;
    }
    const srv = services.find((x) => x.id === selectedId) || null;
    return srv
      ? sectionById.get(String(srv.sectionId || "").trim()) || null
      : null;
  }, [activeListMode, selectedId, sections, services, sectionById]);

  const selectedServiceLive = useMemo(() => {
    if (activeListMode !== "services" || !selectedId) return null;
    return services.find((x) => x.id === selectedId) || null;
  }, [activeListMode, selectedId, services]);

  const selectedSectionId = String(selectedSectionLive?.id || "").trim();

  const categoriesInSection = useMemo(
    () =>
      categories
        .filter(
          (c) => String(c.sectionId || "").trim() === selectedSectionId
        )
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [categories, selectedSectionId]
  );

  const servicesInSelectedCategory = useMemo(() => {
    const cid = String(sectionServiceCategoryId || "").trim();
    if (!cid) return [];
    return services
      .filter(
        (s) =>
          String(s.sectionId || "").trim() === selectedSectionId &&
          String(s.categoryId || "").trim() === cid
      )
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "ar")
      );
  }, [services, selectedSectionId, sectionServiceCategoryId]);

  const selectedCategoryForServices = useMemo(
    () =>
      categoriesInSection.find((c) => c.id === sectionServiceCategoryId) ||
      null,
    [categoriesInSection, sectionServiceCategoryId]
  );

  const servicesInVariantsCategory = useMemo(() => {
    const cid = String(variantsServicesCategoryId || "").trim();
    if (!cid) return [];
    return services
      .filter(
        (s) =>
          String(s.sectionId || "").trim() === selectedSectionId &&
          String(s.categoryId || "").trim() === cid
      )
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "ar")
      );
  }, [services, selectedSectionId, variantsServicesCategoryId]);

  const selectedCategoryForVariantsServices = useMemo(
    () =>
      categoriesInSection.find((c) => c.id === variantsServicesCategoryId) ||
      null,
    [categoriesInSection, variantsServicesCategoryId]
  );

  const openedServiceLiveInSection = useMemo(() => {
    if (!openedServiceIdInSection) return null;
    return (
      services.find(
        (s) =>
          s.id === openedServiceIdInSection &&
          String(s.sectionId || "").trim() === selectedSectionId
      ) || null
    );
  }, [services, openedServiceIdInSection, selectedSectionId]);

  const composerCategories = useMemo(
    () =>
      categories
        .filter(
          (c) =>
            String(c.sectionId || "").trim() ===
            String(newService.sectionId || "").trim()
        )
        .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [categories, newService.sectionId]
  );

  const filteredSections = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    return sections
      .filter((s) =>
        statusFilter === "all"
          ? true
          : statusFilter === "active"
            ? s.active
            : !s.active
      )
      .filter(
        (s) =>
          !q ||
          String(s.id).toLowerCase().includes(q) ||
          String(s.name).toLowerCase().includes(q)
      )
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }, [sections, search, statusFilter]);

  const filteredServices = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    return services
      .filter((s) =>
        statusFilter === "all"
          ? true
          : statusFilter === "active"
            ? s.active
            : !s.active
      )
      .filter((s) =>
        serviceSectionFilter === "all"
          ? true
          : String(s.sectionId || "").trim() === serviceSectionFilter
      )
      .filter((s) => {
        if (!q) return true;
        const sec = String(
          sectionById.get(String(s.sectionId || "").trim())?.name || ""
        ).toLowerCase();
        const cat = String(
          categoryById.get(String(s.categoryId || "").trim())?.name || ""
        ).toLowerCase();
        return (
          String(s.id || "").toLowerCase().includes(q) ||
          String(s.name || "").toLowerCase().includes(q) ||
          sec.includes(q) ||
          cat.includes(q)
        );
      })
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "ar")
      );
  }, [
    services,
    search,
    statusFilter,
    serviceSectionFilter,
    sectionById,
    categoryById,
  ]);

  useEffect(() => {
    void loadCatalog();
    void loadSeasonSettings();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const exists =
      activeListMode === "sections"
        ? sections.some((x) => x.id === selectedId)
        : services.some((x) => x.id === selectedId);
    if (!exists) setSelectedId(null);
  }, [activeListMode, selectedId, sections, services]);

  useEffect(() => {
    setMode("view");
    setActiveTab(activeListMode === "sections" ? "variants" : "overview");
    if (activeListMode === "sections") {
      const row = selectedId
        ? sections.find((x) => x.id === selectedId) || null
        : null;
      setSectionDraft(row ? { ...row } : null);
      setServiceDraft(null);
    } else {
      const row = selectedId
        ? services.find((x) => x.id === selectedId) || null
        : null;
      setServiceDraft(row ? { ...row } : null);
      setSectionDraft(null);
    }
  }, [activeListMode, selectedId]);

  useEffect(() => {
    if (composerMode !== "section") return;
    setNewSection((prev) =>
      String(prev.name || "").trim()
        ? prev
        : { ...prev, order: nextSectionOrder }
    );
  }, [composerMode, nextSectionOrder]);

  useEffect(() => {
    if (activeListMode !== "sections") return;
    if (!selectedSectionId || !categoriesInSection.length) {
      setSectionServiceCategoryId("");
      return;
    }
    const exists = categoriesInSection.some(
      (c) => c.id === sectionServiceCategoryId
    );
    if (!exists) setSectionServiceCategoryId(categoriesInSection[0].id);
  }, [
    activeListMode,
    selectedSectionId,
    categoriesInSection,
    sectionServiceCategoryId,
  ]);

  useEffect(() => {
    if (!variantsServicesCategoryId) return;
    const exists = categoriesInSection.some(
      (c) => c.id === variantsServicesCategoryId
    );
    if (!exists) setVariantsServicesCategoryId("");
  }, [categoriesInSection, variantsServicesCategoryId]);

  useEffect(() => {
    if (!openedServiceLiveInSection) {
      setOpenedServiceDraftInSection(null);
      setOpenedServiceModeInSection("view");
      return;
    }
    if (openedServiceModeInSection === "view") {
      setOpenedServiceDraftInSection({ ...openedServiceLiveInSection });
    }
  }, [openedServiceLiveInSection, openedServiceModeInSection]);

  useEffect(() => {
    if (activeListMode === "sections" && activeTab === "pricing") {
      setActiveTab("variants");
    }
  }, [activeListMode, activeTab]);

  const loadCatalog = async () => {
    setCatalogMsg("");
    try {
      setSecLoading(true);
      setCatLoading(true);
      setSrvLoading(true);
      setPkgLoading(true);

      const [secSnap, catSnap, srvSnap, pkgRows] = await Promise.all([
        getDocs(query(collection(db, ...SECTIONS), orderBy("order", "asc"))),
        getDocs(query(collection(db, ...CATEGORIES), orderBy("order", "asc"))),
        getDocs(query(collection(db, ...SERVICES), orderBy("name", "asc"))),
        PackageService.getAll(),
      ]);

      setSections(
        secSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .map((x: any) => ({
            id: x.id,
            name: String(x?.name || ""),
            active: x?.active !== false,
            order: clampInt(x?.order ?? 0, 0),
            createdAt: x?.createdAt,
            updatedAt: x?.updatedAt,
          }))
          .filter((x: SectionRow) => String(x.name || "").trim())
      );

      setCategories(
        catSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .map((x: any) => ({
            id: x.id,
            sectionId: String(x?.sectionId || ""),
            name: String(x?.name || ""),
            active: x?.active !== false,
            order: clampInt(x?.order ?? 0, 0),
            createdAt: x?.createdAt,
            updatedAt: x?.updatedAt,
          }))
          .filter((x: CategoryRow) => String(x.name || "").trim())
      );

      setServices(
        srvSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .map((x: any) => ({
            id: x.id,
            sectionId: String(x?.sectionId || ""),
            categoryId: String(x?.categoryId || ""),
            name: String(x?.name || ""),
            durationMin: clampInt(x?.durationMin ?? 60, 5),
            price: Number(x?.price || 0),
            seasonPrice:
              x?.seasonPrice === null || x?.seasonPrice === undefined
                ? null
                : Number(x.seasonPrice),
            active: x?.active !== false,
            createdAt: x?.createdAt,
            updatedAt: x?.updatedAt,
          }))
          .filter((x: ServiceRow) => String(x.name || "").trim())
      );

      setPackages(
        pkgRows
          .map((pkg) => ({
            id: String(pkg.id || "").trim(),
            name: String(pkg.name || ""),
            serviceIds: normalizePackageServiceIds([
              ...(Array.isArray(pkg.allowedServiceIds)
                ? pkg.allowedServiceIds
                : []),
              ...(Array.isArray(pkg.serviceIds) ? pkg.serviceIds : []),
            ]),
            sessionsCount: Math.max(1, Number(pkg.sessionsCount || 1)),
            price: Math.max(0, Number(pkg.price || 0)),
            active: pkg.active !== false,
            createdAt: pkg.createdAt,
            updatedAt: pkg.updatedAt,
          }))
          .filter((x: PackageRow) => String(x.name || "").trim())
      );
    } catch (e) {
      console.error("loadCatalog error:", e);
      showMsg("❌ تعذر تحميل الكتالوج", 3000);
    } finally {
      setSecLoading(false);
      setCatLoading(false);
      setSrvLoading(false);
      setPkgLoading(false);
    }
  };

  const createPackage = async () => {
    const name = String(packageName || "").trim();
    const serviceIds = normalizePackageServiceIds(packageServiceIds);
    const sessionsCount = Math.max(1, Number(packageSessionsCount || 0));
    const price = Math.max(0, Number(packagePrice || 0));

    if (!name) return showMsg("اسم الباقة مطلوب", 2200);
    if (!serviceIds.length) {
      return showMsg("اختاري خدمة واحدة على الأقل داخل الباقة", 2200);
    }
    if (sessionsCount <= 0) {
      return showMsg("عدد الجلسات يجب أن يكون أكبر من صفر", 2200);
    }

    setPackageSaving(true);
    try {
      const payload = {
        name,
        serviceIds,
        allowedServiceIds: serviceIds,
        sessionsCount,
        price,
        active: packageActive !== false,
      };

      const editingTargetId = String(editingPackageId || "").trim();
      if (editingTargetId) {
        await PackageService.update(editingTargetId, payload);
        showMsg("تم تحديث الباقة");
      } else {
        await PackageService.add(payload);
        showMsg("تم إنشاء الباقة");
      }

      await loadCatalog();
      resetPackageForm();
      return;
    } catch (error) {
      console.error("savePackage_failed", error);
      showMsg(
        editingPackageId ? "تعذر تحديث الباقة" : "تعذر إنشاء الباقة",
        2800
      );
      return;
    } finally {
      setPackageSaving(false);
    }

    {
    const name = String(packageName || "").trim();
    const serviceIds = packageServiceIds.filter(Boolean);
    const sessionsCount = Math.max(1, Number(packageSessionsCount || 0));
    const price = Math.max(0, Number(packagePrice || 0));

    if (!name) {
      alert("اكتب اسم الباقة");
      return;
    }

    if (!serviceIds.length) {
      alert("اختر خدمة واحدة على الأقل");
      return;
    }

    if (sessionsCount <= 0) {
      alert("عدد الجلسات لازم يكون أكبر من صفر");
      return;
    }

    setPackageSaving(true);
    try {
      await PackageService.add({
        name,
        serviceIds,
        sessionsCount,
        price,
        active: packageActive !== false,
      });

      setPackageName("");
      setPackageServiceIds([]);
      setPackageSessionsCount(10);
      setPackagePrice(0);
      setPackageActive(true);

      await loadCatalog();
    } catch (error) {
      console.error("createPackage_failed", error);
      alert("صار خطأ أثناء إنشاء الباقة");
    } finally {
      setPackageSaving(false);
    }
    }
  };

  const resetPackageForm = () => {
    resetPackageFormState({
      setPackageName,
      setPackageServiceIds,
      setPackageSessionsCount,
      setPackagePrice,
      setPackageActive,
      setEditingPackageId,
    });
  };

  const startPackageEdit = (pkg: PackageRow) => {
    setEditingPackageId(pkg.id);
    setPackageName(String(pkg.name || "").trim());
    setPackageServiceIds(normalizePackageServiceIds(pkg.serviceIds));
    setPackageSessionsCount(Math.max(1, Number(pkg.sessionsCount || 1)));
    setPackagePrice(Math.max(0, Number(pkg.price || 0)));
    setPackageActive(pkg.active !== false);
  };

  const savePackage = async () => {
    return createPackage();

    const name = String(packageName || "").trim();
    const serviceIds = normalizePackageServiceIds(packageServiceIds);
    const sessionsCount = Math.max(1, Number(packageSessionsCount || 0));
    const price = Math.max(0, Number(packagePrice || 0));

    if (!name) return showMsg("اسم الباقة مطلوب", 2200);
    if (!serviceIds.length) {
      return showMsg("اختاري خدمة واحدة على الأقل داخل الباقة", 2200);
    }
    if (sessionsCount <= 0) {
      return showMsg("عدد الجلسات يجب أن يكون أكبر من صفر", 2200);
    }

    setPackageSaving(true);
    try {
      const payload = {
        name,
        serviceIds,
        allowedServiceIds: serviceIds,
        sessionsCount,
        price,
        active: packageActive !== false,
      };

      const editingTargetId = String(editingPackageId || "").trim();
      if (editingTargetId) {
        await PackageService.update(editingTargetId, payload);
        showMsg("تم تحديث الباقة");
      } else {
        await PackageService.add(payload);
        showMsg("تم إنشاء الباقة");
      }

      await loadCatalog();
      resetPackageForm();
    } catch (error) {
      console.error("savePackage_failed", error);
      showMsg(
        editingPackageId ? "تعذر تحديث الباقة" : "تعذر إنشاء الباقة",
        2800
      );
    } finally {
      setPackageSaving(false);
    }
  };

  const togglePackageActive = async (pkg: PackageRow) => {
    if (!pkg.id) return;
    try {
      setPkgLoading(true);
      await PackageService.update(pkg.id, { active: !(pkg.active !== false) });
      showMsg(pkg.active !== false ? "تم تعطيل الباقة" : "تم تفعيل الباقة");
      await loadCatalog();
      if (editingPackageId === pkg.id) {
        setPackageActive(pkg.active === false);
      }
    } catch (error) {
      console.error("togglePackageActive_failed", error);
      showMsg("تعذر تحديث حالة الباقة", 2500);
    } finally {
      setPkgLoading(false);
    }
  };

  const deletePackage = async (pkg: PackageRow) => {
    const packageId = String(pkg.id || "").trim();
    if (!packageId) return;
    if (!window.confirm(`هل أنت متأكد من حذف الباقة "${pkg.name}"؟`)) return;

    try {
      setPkgLoading(true);
      await PackageService.remove(packageId);
      showMsg("تم حذف الباقة");
      await loadCatalog();
      if (editingPackageId === packageId) {
        resetPackageForm();
      }
    } catch (error) {
      console.error("deletePackage_failed", error);
      showMsg("تعذر حذف الباقة", 2500);
    } finally {
      setPkgLoading(false);
    }
  };

  const loadSeasonSettings = async () => {
    try {
      const settings = await AppSettingsService.fetchRemote();
      if (settings?.catalogSeasonPricing) {
        setSeasonPricingEnabled(!!settings.catalogSeasonPricing.enabled);
        setSeasonPricingFrom(String(settings.catalogSeasonPricing.from || ""));
        setSeasonPricingTo(String(settings.catalogSeasonPricing.to || ""));
      }
    } catch (e) {
      console.error("loadSeasonSettings error:", e);
    }
  };

  const saveSeasonPricing = async () => {
    const from = String(seasonPricingFrom || "").trim();
    const to = String(seasonPricingTo || "").trim();

    if (seasonPricingEnabled) {
      if (!from || !to) {
        return showMsg("❌ حددي تاريخ (من/إلى) لموسم الأسعار", 2200);
      }
      if (from > to) {
        return showMsg("❌ تاريخ (من) لازم يكون قبل أو يساوي (إلى)", 2200);
      }
    }

    try {
      setSeasonLoading(true);
      const latest = await AppSettingsService.fetchRemote().catch(
        () => ({} as any)
      );
      await AppSettingsService.saveRemote({
        ...(latest || {}),
        catalogSeasonPricing: {
          enabled: !!seasonPricingEnabled,
          from,
          to,
          startDate: from,
          endDate: to,
        },
      });
      showMsg("✅ تم حفظ موسم الأسعار", 1800);
    } catch (e) {
      console.error("saveSeasonPricing error:", e);
      showMsg("❌ تعذر حفظ موسم الأسعار", 2500);
    } finally {
      setSeasonLoading(false);
    }
  };

  const saveSectionRow = async (row: SectionRow) => {
    const name = String(row.name || "").trim();
    if (!name) return showMsg("❌ اسم القسم لا يمكن يكون فارغ", 2000);
    try {
      setSecLoading(true);
      await setDoc(
        doc(db, ...SECTIONS, row.id),
        {
          name,
          active: row.active !== false,
          order: Number(row.order || 0),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      showMsg("✅ تم حفظ القسم");
      return true;
    } catch (e) {
      console.error("saveSectionRow error:", e);
      showMsg("❌ تعذر حفظ القسم", 2500);
      return false;
    } finally {
      setSecLoading(false);
    }
  };

  const saveServiceRow = async (row: ServiceRow) => {
    const name = String(row.name || "").trim();
    if (!name) return showMsg("❌ اسم الخدمة لا يمكن يكون فارغ", 2000);
    const categoryId = String(row.categoryId || "").trim();
    if (!categoryId) {
      return showMsg("❌ الخدمة لازم تكون مرتبطة بتصنيف", 2000);
    }
    const cat = categories.find(
      (c) => String(c.id || "").trim() === categoryId
    );
    const sectionId = String(cat?.sectionId || "").trim();
    if (!sectionId) {
      return showMsg("❌ التصنيف المختار غير مربوط بقسم", 2000);
    }
    try {
      setSrvLoading(true);
      await setDoc(
        doc(db, ...SERVICES, row.id),
        {
          categoryId,
          sectionId,
          name,
          durationMin: Math.max(5, Number(row.durationMin || 0)),
          price: Math.max(0, Number(row.price || 0)),
          seasonPrice:
            row.seasonPrice === null ||
            row.seasonPrice === undefined ||
            String(row.seasonPrice) === ""
              ? null
              : Math.max(0, Number(row.seasonPrice)),
          active: row.active !== false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      showMsg("✅ تم حفظ الخدمة");
      return true;
    } catch (e) {
      console.error("saveServiceRow error:", e);
      showMsg("❌ تعذر حفظ الخدمة", 2500);
      return false;
    } finally {
      setSrvLoading(false);
    }
  };

  const createSection = async () => {
    const name = String(newSection.name || "").trim();
    if (!name) return showMsg("❌ اسم القسم مطلوب", 2000);
    const id = buildId(name);
    if (!id) return showMsg("❌ تعذر توليد ID للقسم", 2200);
    try {
      setSecLoading(true);
      const ref = doc(db, ...SECTIONS, id);
      if ((await getDoc(ref)).exists()) {
        return showMsg("❌ القسم موجود مسبقًا", 2500);
      }
      await setDoc(ref, {
        name,
        active: newSection.active !== false,
        order: Number(newSection.order || 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showMsg(`✅ تم إنشاء القسم (id: ${id})`);
      await loadCatalog();
      setActiveListMode("sections");
      setSelectedId(id);
      setComposerMode(null);
      setNewSection({ name: "", order: nextSectionOrder, active: true });
    } catch (e) {
      console.error("createSection error:", e);
      showMsg("❌ تعذر إنشاء القسم", 2500);
    } finally {
      setSecLoading(false);
    }
  };

  const deleteSection = async (id: string) => {
    const linkedServices = services.filter(
      (s) => String(s.sectionId || "").trim() === id
    ).length;
    if (linkedServices > 0) {
      return showMsg("❌ لا يمكن حذف القسم لأن عليه خدمات. انقليها أولًا.", 3200);
    }
    const linkedCats = categories.filter(
      (c) => String(c.sectionId || "").trim() === id
    ).length;
    if (linkedCats > 0) {
      return showMsg("❌ لا يمكن حذف القسم لأن عليه تصنيفات.", 3200);
    }
    if (!window.confirm("هل أنت متأكد من حذف هذا القسم؟")) return;
    try {
      setSecLoading(true);
      await deleteDoc(doc(db, ...SECTIONS, id));
      showMsg("✅ تم حذف القسم");
      await loadCatalog();
      setSelectedId(null);
    } catch (e) {
      console.error("deleteSection error:", e);
      showMsg("❌ تعذر حذف القسم", 2500);
    } finally {
      setSecLoading(false);
    }
  };

  const createCategory = async () => {
    const sid = String(selectedSectionId || "").trim();
    const name = String(newCategoryName || "").trim();
    if (!sid) return showMsg("❌ اختر قسمًا أولًا", 2200);
    if (!name) return showMsg("❌ اسم التصنيف مطلوب", 2200);
    const id = buildId(`${sid}_${name}`);
    try {
      setCatLoading(true);
      const rows = categories.filter(
        (c) => String(c.sectionId || "").trim() === sid
      );
      const nextOrder = rows.length
        ? Math.max(...rows.map((x) => Number(x.order || 0))) + 1
        : 1;
      await setDoc(doc(db, ...CATEGORIES, id), {
        sectionId: sid,
        name,
        active: true,
        order: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showMsg("✅ تم إضافة التصنيف");
      setNewCategoryName("");
      await loadCatalog();
      setNewService((prev) =>
        String(prev.sectionId || "").trim() === sid &&
        !String(prev.categoryId || "").trim()
          ? { ...prev, categoryId: id }
          : prev
      );
    } catch (e) {
      console.error("createCategory error:", e);
      showMsg("❌ تعذر إضافة التصنيف", 2500);
    } finally {
      setCatLoading(false);
    }
  };

  const saveCategory = async (row: CategoryRow) => {
    const name = String(row.name || "").trim();
    if (!name) return showMsg("❌ اسم التصنيف لا يمكن يكون فارغ", 2000);
    try {
      setCatLoading(true);
      await setDoc(
        doc(db, ...CATEGORIES, row.id),
        {
          name,
          active: row.active !== false,
          order: Number(row.order || 0),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      showMsg("✅ تم حفظ التصنيف");
    } catch (e) {
      console.error("saveCategory error:", e);
      showMsg("❌ تعذر حفظ التصنيف", 2500);
    } finally {
      setCatLoading(false);
    }
  };

  const deleteCategory = async (id: string) => {
    const linkedServices = services.filter(
      (s) => String(s.categoryId || "").trim() === id
    ).length;
    if (linkedServices > 0) {
      return showMsg("❌ لا يمكن حذف التصنيف لأن عليه خدمات.", 3000);
    }
    if (!window.confirm("هل أنت متأكد من حذف هذا التصنيف؟")) return;
    try {
      setCatLoading(true);
      await deleteDoc(doc(db, ...CATEGORIES, id));
      showMsg("✅ تم حذف التصنيف");
      await loadCatalog();
    } catch (e) {
      console.error("deleteCategory error:", e);
      showMsg("❌ تعذر حذف التصنيف", 2500);
    } finally {
      setCatLoading(false);
    }
  };

  const createService = async () => {
    const name = String(newService.name || "").trim();
    const categoryId = String(newService.categoryId || "").trim();
    if (!name) return showMsg("❌ اسم الخدمة مطلوب", 2000);
    if (!categoryId) return showMsg("❌ اختر تصنيفًا أولًا", 2200);
    const cat = categories.find(
      (c) => String(c.id || "").trim() === categoryId
    );
    const sectionId = String(cat?.sectionId || "").trim();
    if (!sectionId) return showMsg("❌ التصنيف المختار غير صالح", 2200);
    const id = buildId(`${categoryId}_${name}`);
    try {
      setSrvLoading(true);
      await setDoc(doc(db, ...SERVICES, id), {
        categoryId,
        sectionId,
        name,
        durationMin: Math.max(5, Number(newService.durationMin || 60)),
        price: Math.max(0, Number(newService.price || 0)),
        seasonPrice:
          newService.seasonPrice === null ||
          newService.seasonPrice === undefined ||
          String(newService.seasonPrice) === ""
            ? null
            : Math.max(0, Number(newService.seasonPrice)),
        active: newService.active !== false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showMsg(`✅ تم إضافة الخدمة (id: ${id})`);
      await loadCatalog();
      setActiveListMode("sections");
      setSelectedId(sectionId);
      setActiveTab("variants");
      setSectionServiceCategoryId(categoryId);
      setVariantsServicesCategoryId(categoryId);
      setOpenedServiceIdInSection(id);
      setOpenedServiceModeInSection("view");
      setComposerMode(null);
      setNewService({
        sectionId: "",
        categoryId: "",
        name: "",
        durationMin: 60,
        price: 0,
        seasonPrice: null,
        active: true,
      });
    } catch (e) {
      console.error("createService error:", e);
      showMsg("❌ تعذر إضافة الخدمة", 2500);
    } finally {
      setSrvLoading(false);
    }
  };

  const deleteService = async (
    id: string,
    options?: { clearSelection?: boolean }
  ) => {
    if (!window.confirm("هل أنت متأكد من حذف هذه الخدمة؟")) return false;
    try {
      setSrvLoading(true);
      await deleteDoc(doc(db, ...SERVICES, id));
      showMsg("✅ تم حذف الخدمة");
      await loadCatalog();
      if (options?.clearSelection ?? activeListMode === "services") {
        setSelectedId(null);
      }
      return true;
    } catch (e) {
      console.error("deleteService error:", e);
      showMsg("❌ تعذر حذف الخدمة", 2500);
      return false;
    } finally {
      setSrvLoading(false);
    }
  };

  const startServiceComposer = (
    sectionId?: string,
    preferredCategoryId?: string,
    spot: ServiceComposerSpot = "pricing"
  ) => {
    const sid = String(
      sectionId || selectedSectionId || sections[0]?.id || ""
    ).trim();
    if (!sid) return showMsg("❌ اختر قسمًا أولًا", 2200);

    const cats = categories
      .filter((c) => String(c.sectionId || "").trim() === sid)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));

    const desired = String(preferredCategoryId || "").trim();
    const resolvedCategoryId =
      desired && cats.some((c) => c.id === desired)
        ? desired
        : String(cats[0]?.id || "").trim();

    if (!resolvedCategoryId) {
      setActiveListMode("sections");
      setSelectedId(sid);
      setActiveTab("variants");
      return showMsg("❌ أضف تصنيفًا أولًا قبل إضافة خدمة", 2600);
    }

    setServiceComposerSpot(spot);
    setNewService({
      sectionId: sid,
      categoryId: resolvedCategoryId,
      name: "",
      durationMin: 60,
      price: 0,
      seasonPrice: null,
      active: true,
    });
    setComposerMode("service");
  };

  const openServiceInSection = (serviceId: string) => {
    setOpenedServiceIdInSection(serviceId);
    setOpenedServiceModeInSection("view");
    setServiceViewRenderKey((k) => k + 1);
    setTimeout(
      () =>
        openedServicePanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0
    );
  };

  const openVariantsServicesPanel = (categoryId: string) => {
    const cid = String(categoryId || "").trim();
    if (!cid) return;
    setActiveTab("variants");
    setVariantsServicesCategoryId(cid);
    setSectionServiceCategoryId(cid);
    setOpenedServiceIdInSection(null);
    setOpenedServiceModeInSection("view");
    setVariantsPanelRenderKey((k) => k + 1);
    setTimeout(
      () =>
        variantsServicesPanelRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      0
    );
  };

  const cancelOpenedServiceEdit = () => {
    setOpenedServiceDraftInSection(
      openedServiceLiveInSection ? { ...openedServiceLiveInSection } : null
    );
    setOpenedServiceModeInSection("view");
  };

  const saveOpenedServiceEdit = async () => {
    if (!openedServiceDraftInSection) return;
    const ok = await saveServiceRow(openedServiceDraftInSection);
    if (!ok) return;
    await loadCatalog();
    setOpenedServiceModeInSection("view");
  };

  const toggleOpenedServiceActive = async () => {
    if (!openedServiceLiveInSection) return;
    const ok = await saveServiceRow({
      ...openedServiceLiveInSection,
      active: !(openedServiceLiveInSection.active !== false),
    });
    if (!ok) return;
    await loadCatalog();
  };

  const deleteOpenedService = async () => {
    if (!openedServiceLiveInSection) return;
    const ok = await deleteService(openedServiceLiveInSection.id, {
      clearSelection: false,
    });
    if (!ok) return;
    setOpenedServiceIdInSection(null);
    setOpenedServiceDraftInSection(null);
    setOpenedServiceModeInSection("view");
  };

  const hasSelection =
    activeListMode === "sections"
      ? !!selectedSectionLive
      : !!selectedServiceLive;
  const detailName =
    activeListMode === "sections"
      ? String(selectedSectionLive?.name || "—")
      : String(selectedServiceLive?.name || "—");
  const detailActive =
    activeListMode === "sections"
      ? selectedSectionLive?.active !== false
      : selectedServiceLive?.active !== false;

  const openedServiceViewCard = openedServiceLiveInSection ? (
    <div
      key={`service-view-${openedServiceLiveInSection.id}-${serviceViewRenderKey}`}
      ref={openedServicePanelRef}
      className="scatalog-ref__service-view"
    >
      <div className="scatalog-ref__subhead">
        <div className="scatalog-ref__service-view-title">
          <b>عرض الخدمة</b>
          <span>{openedServiceLiveInSection.id}</span>
        </div>
        <div className="scatalog-ref__detail-actions">
          {openedServiceModeInSection === "edit" ? (
            <>
              <button
                className="exp-btn primary"
                type="button"
                onClick={() => void saveOpenedServiceEdit()}
              >
                حفظ
              </button>
              <button
                className="exp-btn ghost"
                type="button"
                onClick={cancelOpenedServiceEdit}
              >
                إلغاء
              </button>
            </>
          ) : (
            <>
              <button
                className="exp-btn ghost"
                type="button"
                onClick={() => setOpenedServiceModeInSection("edit")}
              >
                تعديل
              </button>
              <button
                className="exp-btn ghost"
                type="button"
                onClick={() => void toggleOpenedServiceActive()}
              >
                {openedServiceLiveInSection.active ? "تعطيل" : "تفعيل"}
              </button>
              <button
                className="exp-btn danger"
                type="button"
                onClick={() => void deleteOpenedService()}
              >
                حذف
              </button>
            </>
          )}
        </div>
      </div>

      <div className="scatalog-ref__grid-2">
        <div className="settings-field">
          <label>اسم الخدمة</label>
          <input
            className="settings-input"
            value={
              (openedServiceModeInSection === "edit"
                ? openedServiceDraftInSection?.name
                : openedServiceLiveInSection.name) || ""
            }
            disabled={openedServiceModeInSection !== "edit"}
            onChange={(e) =>
              setOpenedServiceDraftInSection((p) =>
                p ? { ...p, name: e.target.value } : p
              )
            }
          />
        </div>
        <div className="settings-field">
          <label>ID</label>
          <input
            className="settings-input"
            value={openedServiceLiveInSection.id}
            disabled
          />
        </div>
        <div className="settings-field">
          <label>التصنيف</label>
          <select
            className="settings-input"
            value={String(
              openedServiceModeInSection === "edit"
                ? openedServiceDraftInSection?.categoryId || ""
                : openedServiceLiveInSection.categoryId || ""
            )}
            disabled={openedServiceModeInSection !== "edit"}
            onChange={(e) => {
              const cid = String(e.target.value || "").trim();
              const cat = categoryById.get(cid);
              setOpenedServiceDraftInSection((p) =>
                p
                  ? {
                      ...p,
                      categoryId: cid,
                      sectionId: String(cat?.sectionId || p.sectionId || "").trim(),
                    }
                  : p
              );
            }}
          >
            {categoriesInSection.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="scatalog-ref__check">
          <input
            className="settings-check"
            type="checkbox"
            checked={
              openedServiceModeInSection === "edit"
                ? openedServiceDraftInSection?.active !== false
                : openedServiceLiveInSection.active !== false
            }
            disabled={openedServiceModeInSection !== "edit"}
            onChange={(e) =>
              setOpenedServiceDraftInSection((p) =>
                p ? { ...p, active: e.target.checked } : p
              )
            }
          />
          <span>نشطة</span>
        </label>
        <div className="settings-field">
          <label>السعر</label>
          <input
            className="settings-input"
            type="number"
            min={0}
            value={
              openedServiceModeInSection === "edit"
                ? openedServiceDraftInSection?.price ?? 0
                : openedServiceLiveInSection.price
            }
            disabled={openedServiceModeInSection !== "edit"}
            onChange={(e) =>
              setOpenedServiceDraftInSection((p) =>
                p
                  ? {
                      ...p,
                      price: parseNumberInput(e.target.value, p.price),
                    }
                  : p
              )
            }
          />
        </div>
        <div className="settings-field">
          <label>المدة (دقيقة)</label>
          <input
            className="settings-input"
            type="number"
            min={5}
            value={
              openedServiceModeInSection === "edit"
                ? openedServiceDraftInSection?.durationMin ?? 60
                : openedServiceLiveInSection.durationMin
            }
            disabled={openedServiceModeInSection !== "edit"}
            onChange={(e) =>
              setOpenedServiceDraftInSection((p) =>
                p
                  ? {
                      ...p,
                      durationMin: parseNumberInput(
                        e.target.value,
                        p.durationMin
                      ),
                    }
                  : p
              )
            }
          />
        </div>
        <div className="settings-field">
          <label>سعر الموسم</label>
          <input
            className="settings-input"
            type="number"
            min={0}
            value={
              (openedServiceModeInSection === "edit"
                ? openedServiceDraftInSection?.seasonPrice
                : openedServiceLiveInSection.seasonPrice) ?? ""
            }
            disabled={openedServiceModeInSection !== "edit"}
            onChange={(e) => {
              const raw = e.target.value;
              const val = raw === "" ? null : parseNumberInput(raw, 0);
              setOpenedServiceDraftInSection((p) =>
                p ? { ...p, seasonPrice: val } : p
              );
            }}
          />
        </div>
      </div>
    </div>
  ) : null;

  const renderServiceComposer = () => (
    <div className="scatalog-ref__composer scatalog-ref__composer--service-inline">
      <b>إضافة خدمة</b>

      <select
        className="settings-input"
        value={newService.sectionId}
        onChange={(e) => {
          const sid = String(e.target.value || "").trim();
          const cats = categories
            .filter((c) => String(c.sectionId || "").trim() === sid)
            .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
          setNewService((p) => ({
            ...p,
            sectionId: sid,
            categoryId: String(cats[0]?.id || ""),
          }));
        }}
      >
        <option value="">— اختر القسم —</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        className="settings-input"
        value={newService.categoryId}
        onChange={(e) =>
          setNewService((p) => ({ ...p, categoryId: e.target.value }))
        }
      >
        <option value="">— اختر التصنيف —</option>
        {composerCategories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <input
        className="settings-input"
        placeholder="اسم الخدمة"
        value={newService.name}
        onChange={(e) =>
          setNewService((p) => ({ ...p, name: e.target.value }))
        }
      />

      <div className="scatalog-ref__inline-2">
        <div className="settings-field">
          <label>الوقت (دقيقة)</label>
          <input
            className="settings-input"
            type="number"
            min={5}
            value={newService.durationMin}
            onChange={(e) =>
              setNewService((p) => ({
                ...p,
                durationMin: parseNumberInput(e.target.value, p.durationMin),
              }))
            }
          />
        </div>

        <div className="settings-field">
          <label>السعر</label>
          <input
            className="settings-input"
            type="number"
            min={0}
            value={newService.price}
            onChange={(e) =>
              setNewService((p) => ({
                ...p,
                price: parseNumberInput(e.target.value, p.price),
              }))
            }
          />
        </div>
      </div>

      {false ? (
        <div className="settings-note">
          تعديل الباقة الحالية: يتم الحفظ على السجل نفسه دون إنشاء باقة جديدة.
        </div>
      ) : null}

      <div className="settings-field">
        <label>سعر الموسم (اختياري)</label>
        <input
          className="settings-input"
          type="number"
          min={0}
          value={newService.seasonPrice ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            const val =
              raw === ""
                ? null
                : parseNumberInput(raw, Number(newService.seasonPrice ?? 0));
            setNewService((p) => ({ ...p, seasonPrice: val }));
          }}
        />
      </div>

      <div className="scatalog-ref__composer-actions">
        <button
          className="dash-btn"
          type="button"
          onClick={() => setComposerMode(null)}
        >
          إلغاء
        </button>
        <button
          className={`exp-btn primary ${
            !String(newService.sectionId || "").trim() ||
            !String(newService.categoryId || "").trim()
              ? "is-disabled"
              : ""
          }`}
          type="button"
          disabled={
            !String(newService.sectionId || "").trim() ||
            !String(newService.categoryId || "").trim()
          }
          onClick={() => void createService()}
        >
          إنشاء
        </button>
      </div>
    </div>
  );

  const renderPackageComposer = () => (
    <div className="scatalog-ref__composer scatalog-ref__composer--service-inline">
      <b>إضافة باقة جلسات</b>

      <div className="settings-field">
        <label>اسم الباقة</label>
        <input
          className="settings-input"
          placeholder="مثال: استشوار 10 جلسات"
          value={packageName}
          onChange={(e) => setPackageName(e.target.value)}
        />
      </div>

      <div className="settings-field">
        <label>اختر الخدمات</label>
        <div
          style={{
            maxHeight: 180,
            overflow: "auto",
            border: "1px solid #d6d6d6",
            borderRadius: 12,
            padding: 12,
            background: "#fff",
          }}
        >
          {services.length ? (
            services.map((s) => {
              const checked = selectedPackageServiceIds.includes(s.id);

              return (
                <label
                  key={s.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (checked) {
                        setPackageServiceIds((prev) =>
                          prev.filter((id) => id !== s.id)
                        );
                      } else {
                        setPackageServiceIds((prev) =>
                          normalizePackageServiceIds([...prev, s.id])
                        );
                      }
                    }}
                  />
                  <span>{s.name}</span>
                </label>
              );
            })
          ) : (
            <div className="settings-note">لا توجد خدمات متاحة حاليًا.</div>
          )}
        </div>
      </div>

      <div className="scatalog-ref__inline-2">
        <div className="settings-field">
          <label>عدد الجلسات</label>
          <input
            className="settings-input"
            type="number"
            min={1}
            value={packageSessionsCount}
            onChange={(e) =>
              setPackageSessionsCount(Number(e.target.value))
            }
          />
        </div>

        <div className="settings-field">
          <label>السعر</label>
          <input
            className="settings-input"
            type="number"
            min={0}
            value={packagePrice}
            onChange={(e) => setPackagePrice(Number(e.target.value))}
          />
        </div>
      </div>

      <label className="scatalog-ref__check">
        <input
          className="settings-check"
          type="checkbox"
          checked={packageActive}
          onChange={(e) => setPackageActive(e.target.checked)}
        />
        <span>الباقة مفعلة</span>
      </label>

      <div className="scatalog-ref__composer-actions">
        <button
          className="dash-btn"
          type="button"
          onClick={() => {
            resetPackageForm();
          }}
        >
          إلغاء
        </button>

        <button
          className={`exp-btn primary ${packageSaving ? "is-disabled" : ""}`}
          type="button"
          disabled={packageSaving}
          onClick={() => void savePackage()}
        >
          {packageSaving ? "جاري الحفظ..." : "حفظ الباقة"}
        </button>
      </div>

      <div className="scatalog-ref__list-title" style={{ marginTop: 16 }}>
        {`الباقات الحالية (${packages.length})`}
      </div>

      <div className="scatalog-ref__list">
        {packages.length ? (
          packages.map((pkg) => {
            const linkedNames = normalizePackageServiceIds(
              pkg.serviceIds
            ).map(
              (serviceId) =>
                String(serviceById.get(serviceId)?.name || "").trim() ||
                `خدمة غير موجودة (${serviceId})`
            );

            return (
              <div
                key={pkg.id}
                className="scatalog-ref__row"
                style={{
                  cursor: "default",
                  borderColor:
                    editingPackageId === pkg.id
                      ? "rgba(17,24,39,0.35)"
                      : undefined,
                  background:
                    editingPackageId === pkg.id ? "#f8fafc" : undefined,
                }}
              >
                <div>
                  <b>{pkg.name}</b>
                  <span>ID: {pkg.id}</span>
                  <span>الخدمات: {linkedNames.join("، ")}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span>{pkg.sessionsCount} جلسات</span>
                  <span>{money(pkg.price)} ر.س</span>
                  <span>{linkedNames.length} خدمة</span>
                  <span
                    className={`scatalog-ref__pill ${
                      pkg.active ? "on" : "off"
                    }`}
                  >
                    {pkg.active ? "نشط" : "معطل"}
                  </span>
                  <button
                    className="dash-btn"
                    type="button"
                    onClick={() => startPackageEdit(pkg)}
                  >
                    تعديل
                  </button>
                  <button
                    className="dash-btn"
                    type="button"
                    onClick={() => void togglePackageActive(pkg)}
                  >
                    {pkg.active ? "تعطيل" : "تفعيل"}
                  </button>
                  <button
                    className="dash-btn"
                    type="button"
                    onClick={() => void deletePackage(pkg)}
                  >
                    حذف
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="settings-note">لا توجد باقات حتى الآن.</div>
        )}
      </div>
    </div>
  );

  const startEdit = () => {
    if (!hasSelection) return;
    if (activeListMode === "sections" && selectedSectionLive) {
      setSectionDraft({ ...selectedSectionLive });
    }
    if (activeListMode === "services" && selectedServiceLive) {
      setServiceDraft({ ...selectedServiceLive });
    }
    setMode("edit");
  };

  const cancelEdit = () => {
    if (activeListMode === "sections") {
      setSectionDraft(selectedSectionLive ? { ...selectedSectionLive } : null);
    } else {
      setServiceDraft(selectedServiceLive ? { ...selectedServiceLive } : null);
    }
    setMode("view");
  };

  const saveEdit = async () => {
    if (mode !== "edit") return;
    if (activeListMode === "sections" && sectionDraft) {
      const ok = await saveSectionRow(sectionDraft);
      if (ok) {
        await loadCatalog();
        setMode("view");
      }
      return;
    }
    if (activeListMode === "services" && serviceDraft) {
      const ok = await saveServiceRow(serviceDraft);
      if (ok) {
        await loadCatalog();
        setMode("view");
      }
    }
  };

  const toggleSelectedActive = async () => {
    if (activeListMode === "sections" && selectedSectionLive) {
      const ok = await saveSectionRow({
        ...selectedSectionLive,
        active: !(selectedSectionLive.active !== false),
      });
      if (ok) await loadCatalog();
      return;
    }
    if (activeListMode === "services" && selectedServiceLive) {
      const ok = await saveServiceRow({
        ...selectedServiceLive,
        active: !(selectedServiceLive.active !== false),
      });
      if (ok) await loadCatalog();
    }
  };

  const deleteSelected = async () => {
    if (!selectedId) return;
    if (activeListMode === "sections") await deleteSection(selectedId);
    else await deleteService(selectedId, { clearSelection: true });
  };

  if (!hasAdminPower) {
    return (
      <div className="dashboard-section settings-page scatalog">
        <div className="settings-wrap">
          <h3>غير مصرح</h3>
          <p>هذه الصفحة مخصصة للإدارة (Owner/Admin).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-section settings-page scatalog" dir="rtl">
      <div className="settings-wrap">
        <div className="scatalog__header">
          <div>
            <h1 className="qs-black">إدارة الكتالوج</h1>
            <p className="settings-hint">
              Split Layout لإدارة الأقسام والخدمات داخل نفس اللوحة.
            </p>
          </div>
          <div className="scatalog__actions">
            <button
              className="dash-btn"
              type="button"
              onClick={() => navigate("/dashboard/settings/advanced")}
            >
              رجوع
            </button>
            <button
              type="button"
              className={`exp-btn ${
                secLoading || catLoading || srvLoading || pkgLoading || seasonLoading
                  ? "is-disabled"
                  : ""
              }`}
              disabled={
                secLoading || catLoading || srvLoading || pkgLoading || seasonLoading
              }
              onClick={() => void loadCatalog()}
            >
              تحديث
            </button>
          </div>
        </div>

        {catalogMsg && <div className="scatalog__msg">{catalogMsg}</div>}

        <div className="scatalog-ref__split">
          <aside className="scatalog-ref__left">
            <div className="scatalog-ref__filters">
              <input
                className="settings-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث في الأقسام..."
              />
              <select
                className="settings-input"
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as FilterStatus)
                }
              >
                <option value="all">كل الحالات</option>
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
              </select>
            </div>

            <div className="scatalog-ref__switch scatalog-ref__switch--single">
              <button
                type="button"
                className={`scatalog-ref__switch-btn ${
                  activeListMode === "sections" ? "active" : ""
                }`}
                onClick={() => setActiveListMode("sections")}
              >
                الأقسام
              </button>
            </div>

            <div className="scatalog-ref__left-actions">
              <button
                type="button"
                className="exp-btn"
                onClick={() => {
                  setNewSection({
                    name: "",
                    order: nextSectionOrder,
                    active: true,
                  });
                  setComposerMode("section");
                }}
              >
                + إضافة قسم
              </button>
            </div>

            {composerMode === "section" && (
              <div className="scatalog-ref__composer">
                <b>إضافة قسم</b>
                <input
                  className="settings-input"
                  placeholder="اسم القسم"
                  value={newSection.name}
                  onChange={(e) =>
                    setNewSection((p) => ({ ...p, name: e.target.value }))
                  }
                />
                <div className="scatalog-ref__inline-2">
                  <input
                    className="settings-input"
                    type="number"
                    value={newSection.order}
                    onChange={(e) =>
                      setNewSection((p) => ({
                        ...p,
                        order: Number(e.target.value || 0),
                      }))
                    }
                  />
                  <label className="scatalog-ref__check">
                    <input
                      className="settings-check"
                      type="checkbox"
                      checked={newSection.active}
                      onChange={(e) =>
                        setNewSection((p) => ({
                          ...p,
                          active: e.target.checked,
                        }))
                      }
                    />
                    <span>نشط</span>
                  </label>
                </div>
                <div className="scatalog-ref__composer-actions">
                  <button
                    className="dash-btn"
                    type="button"
                    onClick={() => setComposerMode(null)}
                  >
                    إلغاء
                  </button>
                  <button
                    className="exp-btn primary"
                    type="button"
                    onClick={() => void createSection()}
                  >
                    إنشاء
                  </button>
                </div>
              </div>
            )}

            <div className="scatalog-ref__list-title">{`الأقسام (${filteredSections.length})`}</div>
            <div className="scatalog-ref__list">
              {filteredSections.length ? (
                filteredSections.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`scatalog-ref__row ${
                      selectedId === s.id ? "is-selected" : ""
                    }`}
                    onClick={() => setSelectedId(s.id)}
                  >
                    <div>
                      <b>{s.name}</b>
                      <span>ID: {s.id}</span>
                    </div>
                    <div>
                      <span>
                        {categories.filter((c) => c.sectionId === s.id).length}{" "}
                        تصنيف
                      </span>
                      <span>
                        {services.filter((x) => x.sectionId === s.id).length} خدمة
                      </span>
                      <span
                        className={`scatalog-ref__pill ${
                          s.active ? "on" : "off"
                        }`}
                      >
                        {s.active ? "نشط" : "معطل"}
                      </span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="settings-note">لا توجد أقسام مطابقة.</div>
              )}
            </div>
          </aside>

          <section className="scatalog-ref__right">
            {!hasSelection ? (
              <div className="scatalog-ref__empty">
                <b>اختر قسم/خدمة لعرض التفاصيل</b>
                <p>اختيار عنصر من القائمة يفتح التفاصيل هنا مباشرة.</p>
              </div>
            ) : (
              <>
                <div className="scatalog-ref__detail-head">
                  <div>
                    <h2>{detailName}</h2>
                    <span
                      className={`scatalog-ref__pill ${
                        detailActive ? "on" : "off"
                      }`}
                    >
                      {detailActive ? "نشط" : "غير نشط"}
                    </span>
                  </div>
                  <div className="scatalog-ref__detail-actions">
                    {mode === "edit" ? (
                      <>
                        <button
                          className="exp-btn primary"
                          type="button"
                          onClick={() => void saveEdit()}
                        >
                          حفظ
                        </button>
                        <button
                          className="exp-btn ghost"
                          type="button"
                          onClick={cancelEdit}
                        >
                          إلغاء
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="exp-btn ghost"
                          type="button"
                          onClick={startEdit}
                        >
                          تعديل
                        </button>
                        <button
                          className="exp-btn ghost"
                          type="button"
                          onClick={() => void toggleSelectedActive()}
                        >
                          {detailActive ? "تعطيل" : "تفعيل"}
                        </button>
                        <button
                          className="exp-btn danger"
                          type="button"
                          onClick={() => void deleteSelected()}
                        >
                          حذف
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="scatalog-ref__tabs">
                  {(activeListMode === "sections"
                    ? [
                        ["variants", "التصنيفات"],
                        ["overview", "نظرة عامة"],
                        ["audit", "السجل"],
                      ]
                    : [
                        ["overview", "نظرة عامة"],
                        ["pricing", "السعر والمدة"],
                        ["variants", "Variants"],
                        ["audit", "السجل"],
                      ]
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`scatalog-ref__tab ${
                        activeTab === (k as DetailsTab) ? "active" : ""
                      }`}
                      onClick={() => setActiveTab(k as DetailsTab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="scatalog-ref__content">
                  {activeListMode === "sections" && selectedSectionLive && (
                    <>
                      {activeTab === "overview" && (
                        <div className="scatalog-ref__grid-2">
                          <div className="settings-field">
                            <label>اسم القسم</label>
                            <input
                              className="settings-input"
                              value={
                                (mode === "edit"
                                  ? sectionDraft?.name
                                  : selectedSectionLive.name) || ""
                              }
                              disabled={mode !== "edit"}
                              onChange={(e) =>
                                setSectionDraft((p) =>
                                  p ? { ...p, name: e.target.value } : p
                                )
                              }
                            />
                          </div>
                          <div className="settings-field">
                            <label>الترتيب</label>
                            <input
                              className="settings-input"
                              type="number"
                              value={
                                mode === "edit"
                                  ? sectionDraft?.order ?? 0
                                  : selectedSectionLive.order
                              }
                              disabled={mode !== "edit"}
                              onChange={(e) =>
                                setSectionDraft((p) =>
                                  p
                                    ? {
                                        ...p,
                                        order: Number(e.target.value || 0),
                                      }
                                    : p
                                )
                              }
                            />
                          </div>
                          <div className="settings-field">
                            <label>ID</label>
                            <input
                              className="settings-input"
                              value={selectedSectionLive.id}
                              disabled
                            />
                          </div>
                          <label className="scatalog-ref__check">
                            <input
                              className="settings-check"
                              type="checkbox"
                              checked={
                                mode === "edit"
                                  ? sectionDraft?.active !== false
                                  : selectedSectionLive.active !== false
                              }
                              disabled={mode !== "edit"}
                              onChange={(e) =>
                                setSectionDraft((p) =>
                                  p ? { ...p, active: e.target.checked } : p
                                )
                              }
                            />
                            <span>القسم نشط</span>
                          </label>
                        </div>
                      )}

                      {activeTab === "pricing" && (
                        <div className="scatalog-ref__stack">
                          <div className="scatalog-ref__subhead">
                            <b>الخدمات حسب التصنيف</b>
                            <button
                              className={`exp-btn primary ${
                                !sectionServiceCategoryId ? "is-disabled" : ""
                              }`}
                              type="button"
                              disabled={!sectionServiceCategoryId}
                              onClick={() =>
                                startServiceComposer(
                                  selectedSectionLive.id,
                                  sectionServiceCategoryId,
                                  "pricing"
                                )
                              }
                            >
                              + إضافة خدمة
                            </button>
                          </div>

                          {composerMode === "service" &&
                          serviceComposerSpot === "pricing"
                            ? renderServiceComposer()
                            : null}

                          {!categoriesInSection.length ? (
                            <div className="settings-note">
                              لا توجد تصنيفات في هذا القسم. أضف تصنيفًا أولًا.
                            </div>
                          ) : (
                            <>
                              <div className="settings-field">
                                <label>اختر تصنيف</label>
                                <select
                                  className="settings-input"
                                  value={sectionServiceCategoryId}
                                  onChange={(e) =>
                                    setSectionServiceCategoryId(
                                      String(e.target.value || "").trim()
                                    )
                                  }
                                >
                                  {categoriesInSection.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {servicesInSelectedCategory.length ? (
                                servicesInSelectedCategory.map((s) => (
                                  <div key={s.id} className="scatalog-ref__linked-row">
                                    <div>
                                      <b>{s.name}</b>
                                      <span>
                                        {selectedCategoryForServices?.name ||
                                          "بدون تصنيف"}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="scatalog-ref__meta-item">
                                        <strong>السعر:</strong> {money(s.price)} ر.س
                                      </span>
                                      {s.seasonPrice !== null &&
                                      s.seasonPrice !== undefined ? (
                                        <span className="scatalog-ref__meta-item is-season">
                                          <strong>سعر الموسم:</strong>{" "}
                                          {money(s.seasonPrice)} ر.س
                                        </span>
                                      ) : null}
                                      <span className="scatalog-ref__meta-item">
                                        <strong>الوقت:</strong> {s.durationMin} د
                                      </span>
                                      <button
                                        className="dash-btn"
                                        type="button"
                                        onClick={() => openServiceInSection(s.id)}
                                      >
                                        فتح الخدمة
                                      </button>
                                    </div>
                                  </div>
                                ))
                              ) : (
                                <div className="settings-note">
                                  لا توجد خدمات داخل التصنيف المحدد.
                                </div>
                              )}

                              {openedServiceViewCard}
                            </>
                          )}
                        </div>
                      )}

                      {activeTab === "variants" && (
                        <div className="scatalog-ref__stack">
                          <div className="scatalog-ref__subhead">
                            <b>التصنيفات</b>
                          </div>
                          <div className="scatalog-ref__inline-create">
                            <input
                              className="settings-input"
                              value={newCategoryName}
                              placeholder="اسم تصنيف جديد"
                              disabled={mode !== "edit"}
                              onChange={(e) => setNewCategoryName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && mode === "edit") {
                                  void createCategory();
                                }
                              }}
                            />
                            <button
                              className="exp-btn primary"
                              type="button"
                              disabled={mode !== "edit"}
                              onClick={() => void createCategory()}
                            >
                              إضافة
                            </button>
                          </div>

                          {categoriesInSection.length ? (
                            categoriesInSection.map((c) => (
                              <div
                                key={c.id}
                                className={`scatalog-ref__cat-row ${
                                  variantsServicesCategoryId === c.id
                                    ? "is-services-open"
                                    : ""
                                }`}
                              >
                                <input
                                  className="settings-input"
                                  value={c.name}
                                  disabled={mode !== "edit"}
                                  onChange={(e) =>
                                    setCategories((prev) =>
                                      prev.map((x) =>
                                        x.id === c.id
                                          ? { ...x, name: e.target.value }
                                          : x
                                      )
                                    )
                                  }
                                />
                                <input
                                  className="settings-input"
                                  type="number"
                                  value={c.order}
                                  disabled={mode !== "edit"}
                                  onChange={(e) =>
                                    setCategories((prev) =>
                                      prev.map((x) =>
                                        x.id === c.id
                                          ? {
                                              ...x,
                                              order: Number(e.target.value || 0),
                                            }
                                          : x
                                      )
                                    )
                                  }
                                />
                                <label className="scatalog-ref__check">
                                  <input
                                    className="settings-check"
                                    type="checkbox"
                                    checked={c.active !== false}
                                    disabled={mode !== "edit"}
                                    onChange={(e) =>
                                      setCategories((prev) =>
                                        prev.map((x) =>
                                          x.id === c.id
                                            ? { ...x, active: e.target.checked }
                                            : x
                                        )
                                      )
                                    }
                                  />
                                  <span>نشط</span>
                                </label>
                                <button
                                  className={`dash-btn ${
                                    variantsServicesCategoryId === c.id
                                      ? "scatalog-ref__btn-active"
                                      : ""
                                  }`}
                                  type="button"
                                  onClick={() => openVariantsServicesPanel(c.id)}
                                >
                                  {variantsServicesCategoryId === c.id
                                    ? "الخدمات المفتوحة"
                                    : "افتح الخدمات"}
                                </button>
                                <button
                                  className="exp-btn"
                                  type="button"
                                  disabled={mode !== "edit"}
                                  onClick={() => void saveCategory(c)}
                                >
                                  حفظ
                                </button>
                                <button
                                  className="exp-btn danger"
                                  type="button"
                                  disabled={mode !== "edit"}
                                  onClick={() => void deleteCategory(c.id)}
                                >
                                  حذف
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="settings-note">لا توجد تصنيفات.</div>
                          )}
                        </div>
                      )}

                      {activeTab === "audit" && (
                        <div className="scatalog-ref__audit">
                          <div>
                            <span>تاريخ الإنشاء</span>
                            <b>{fmtTs(selectedSectionLive.createdAt)}</b>
                          </div>
                          <div>
                            <span>آخر تحديث</span>
                            <b>{fmtTs(selectedSectionLive.updatedAt)}</b>
                          </div>
                          <div>
                            <span>Section ID</span>
                            <b dir="ltr">{selectedSectionLive.id}</b>
                          </div>
                          <div className="settings-note">
                            سجل التعديلات التفصيلي قريبًا.
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {activeListMode === "services" && selectedServiceLive && (
                    <>
                      {activeTab === "overview" && (
                        <div className="scatalog-ref__grid-2">
                          <div className="settings-field">
                            <label>اسم الخدمة</label>
                            <input
                              className="settings-input"
                              value={
                                (mode === "edit"
                                  ? serviceDraft?.name
                                  : selectedServiceLive.name) || ""
                              }
                              disabled={mode !== "edit"}
                              onChange={(e) =>
                                setServiceDraft((p) =>
                                  p ? { ...p, name: e.target.value } : p
                                )
                              }
                            />
                          </div>
                          <div className="settings-field">
                            <label>ID</label>
                            <input
                              className="settings-input"
                              value={selectedServiceLive.id}
                              disabled
                            />
                          </div>
                          <div className="settings-field">
                            <label>القسم</label>
                            <select
                              className="settings-input"
                              value={String(
                                mode === "edit"
                                  ? serviceDraft?.sectionId || ""
                                  : selectedServiceLive.sectionId || ""
                              )}
                              disabled={mode !== "edit"}
                              onChange={(e) => {
                                const sid = String(e.target.value || "").trim();
                                const cats = categories
                                  .filter(
                                    (c) =>
                                      String(c.sectionId || "").trim() === sid
                                  )
                                  .sort(
                                    (a, b) =>
                                      Number(a.order || 0) - Number(b.order || 0)
                                  );
                                setServiceDraft((p) =>
                                  p
                                    ? {
                                        ...p,
                                        sectionId: sid,
                                        categoryId: String(cats[0]?.id || ""),
                                      }
                                    : p
                                );
                              }}
                            >
                              {sections.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="settings-field">
                            <label>التصنيف</label>
                            <select
                              className="settings-input"
                              value={String(
                                mode === "edit"
                                  ? serviceDraft?.categoryId || ""
                                  : selectedServiceLive.categoryId || ""
                              )}
                              disabled={mode !== "edit"}
                              onChange={(e) => {
                                const cid = String(e.target.value || "").trim();
                                const cat = categoryById.get(cid);
                                setServiceDraft((p) =>
                                  p
                                    ? {
                                        ...p,
                                        categoryId: cid,
                                        sectionId: String(
                                          cat?.sectionId || p.sectionId || ""
                                        ).trim(),
                                      }
                                    : p
                                );
                              }}
                            >
                              {categories
                                .filter(
                                  (c) =>
                                    String(c.sectionId || "").trim() ===
                                    String(
                                      mode === "edit"
                                        ? serviceDraft?.sectionId ||
                                            selectedServiceLive.sectionId
                                        : selectedServiceLive.sectionId
                                    )
                                )
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <label className="scatalog-ref__check">
                            <input
                              className="settings-check"
                              type="checkbox"
                              checked={
                                mode === "edit"
                                  ? serviceDraft?.active !== false
                                  : selectedServiceLive.active !== false
                              }
                              disabled={mode !== "edit"}
                              onChange={(e) =>
                                setServiceDraft((p) =>
                                  p ? { ...p, active: e.target.checked } : p
                                )
                              }
                            />
                            <span>الخدمة نشطة</span>
                          </label>
                        </div>
                      )}

                      {activeTab === "pricing" && (
                        <div className="scatalog-ref__grid-2">
                          <div className="settings-field">
                            <label>السعر</label>
                            <input
                              className="settings-input"
                              type="number"
                              min={0}
                              value={
                                mode === "edit"
                                  ? serviceDraft?.price ?? 0
                                  : selectedServiceLive.price
                              }
                              disabled={mode !== "edit"}
                              onChange={(e) =>
                                setServiceDraft((p) =>
                                  p
                                    ? {
                                        ...p,
                                        price: parseNumberInput(
                                          e.target.value,
                                          p.price
                                        ),
                                      }
                                    : p
                                )
                              }
                            />
                          </div>
                          <div className="settings-field">
                            <label>المدة (دقيقة)</label>
                            <input
                              className="settings-input"
                              type="number"
                              min={5}
                              value={
                                mode === "edit"
                                  ? serviceDraft?.durationMin ?? 60
                                  : selectedServiceLive.durationMin
                              }
                              disabled={mode !== "edit"}
                              onChange={(e) =>
                                setServiceDraft((p) =>
                                  p
                                    ? {
                                        ...p,
                                        durationMin: parseNumberInput(
                                          e.target.value,
                                          p.durationMin
                                        ),
                                      }
                                    : p
                                )
                              }
                            />
                          </div>
                          <div className="settings-field">
                            <label>سعر الموسم</label>
                            <input
                              className="settings-input"
                              type="number"
                              min={0}
                              value={
                                (mode === "edit"
                                  ? serviceDraft?.seasonPrice
                                  : selectedServiceLive.seasonPrice) ?? ""
                              }
                              disabled={mode !== "edit"}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const val =
                                  raw === ""
                                    ? null
                                    : parseNumberInput(raw, 0);
                                setServiceDraft((p) =>
                                  p ? { ...p, seasonPrice: val } : p
                                );
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {activeTab === "variants" && (
                        <div className="settings-note">
                          Variants قريبًا في مرحلة لاحقة.
                        </div>
                      )}

                      {activeTab === "audit" && (
                        <div className="scatalog-ref__audit">
                          <div>
                            <span>تاريخ الإنشاء</span>
                            <b>{fmtTs(selectedServiceLive.createdAt)}</b>
                          </div>
                          <div>
                            <span>آخر تحديث</span>
                            <b>{fmtTs(selectedServiceLive.updatedAt)}</b>
                          </div>
                          <div>
                            <span>Service ID</span>
                            <b dir="ltr">{selectedServiceLive.id}</b>
                          </div>
                          <div>
                            <span>Category ID</span>
                            <b dir="ltr">
                              {selectedServiceLive.categoryId || "—"}
                            </b>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}

            {activeListMode === "sections" &&
              selectedSectionLive &&
              activeTab === "variants" &&
              !!variantsServicesCategoryId && (
                <section
                  key={`variants-services-${variantsServicesCategoryId}-${variantsPanelRenderKey}`}
                  ref={variantsServicesPanelRef}
                  className="scatalog-ref__right-extra"
                >
                  <div className="scatalog-ref__subhead">
                    <b>
                      الخدمات حسب التصنيف:{" "}
                      {selectedCategoryForVariantsServices?.name || "—"}
                    </b>
                    <button
                      className={`exp-btn primary ${
                        !variantsServicesCategoryId ? "is-disabled" : ""
                      }`}
                      type="button"
                      disabled={!variantsServicesCategoryId}
                      onClick={() =>
                        startServiceComposer(
                          selectedSectionLive.id,
                          variantsServicesCategoryId,
                          "variants"
                        )
                      }
                    >
                      + إضافة خدمة
                    </button>
                  </div>

                  {composerMode === "service" &&
                  serviceComposerSpot === "variants"
                    ? renderServiceComposer()
                    : null}

                  <div className="scatalog-ref__context-pill">
                    <span>التصنيف النشط</span>
                    <b>{selectedCategoryForVariantsServices?.name || "—"}</b>
                    <span>{servicesInVariantsCategory.length} خدمة</span>
                  </div>

                  {servicesInVariantsCategory.length ? (
                    servicesInVariantsCategory.map((s) => (
                      <div
                        key={s.id}
                        className={`scatalog-ref__linked-row ${
                          openedServiceIdInSection === s.id ? "is-opened" : ""
                        }`}
                      >
                        <div>
                          <b>{s.name}</b>
                          <span>
                            {selectedCategoryForVariantsServices?.name ||
                              "بدون تصنيف"}
                          </span>
                        </div>
                        <div>
                          <span className="scatalog-ref__meta-item">
                            <strong>السعر:</strong> {money(s.price)} ر.س
                          </span>
                          {s.seasonPrice !== null &&
                          s.seasonPrice !== undefined ? (
                            <span className="scatalog-ref__meta-item is-season">
                              <strong>سعر الموسم:</strong> {money(s.seasonPrice)}{" "}
                              ر.س
                            </span>
                          ) : null}
                          <span className="scatalog-ref__meta-item">
                            <strong>الوقت:</strong> {s.durationMin} د
                          </span>
                          <button
                            className={`dash-btn ${
                              openedServiceIdInSection === s.id
                                ? "scatalog-ref__btn-active"
                                : ""
                            }`}
                            type="button"
                            onClick={() => openServiceInSection(s.id)}
                          >
                            {openedServiceIdInSection === s.id
                              ? "الخدمة مفتوحة"
                              : "فتح الخدمة"}
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="settings-note">
                      لا توجد خدمات داخل التصنيف المحدد.
                    </div>
                  )}

                  {openedServiceViewCard}
                </section>
              )}
          </section>
        </div>

        {renderPackageComposer()}

        <div className="scatalog-ref__season">
          <div className="scatalog-ref__subhead">
            <b>موسم الأسعار</b>
            <button
              type="button"
              className={`exp-btn primary ${
                seasonLoading ? "is-disabled" : ""
              }`}
              disabled={seasonLoading}
              onClick={() => void saveSeasonPricing()}
            >
              حفظ الموسم
            </button>
          </div>
          <label className="scatalog-ref__check">
            <input
              className="settings-check"
              type="checkbox"
              checked={seasonPricingEnabled}
              onChange={() => setSeasonPricingEnabled((p) => !p)}
            />
            <span>تفعيل موسم الأسعار</span>
          </label>
          <div className="scatalog-ref__inline-2">
            <div className="settings-field">
              <label>من تاريخ</label>
              <input
                className="settings-input"
                type="date"
                value={seasonPricingFrom}
                disabled={!seasonPricingEnabled}
                onChange={(e) => setSeasonPricingFrom(e.target.value)}
              />
            </div>
            <div className="settings-field">
              <label>إلى تاريخ</label>
              <input
                className="settings-input"
                type="date"
                value={seasonPricingTo}
                disabled={!seasonPricingEnabled}
                onChange={(e) => setSeasonPricingTo(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
