import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import { AppSettingsService } from "../../services/AppSettingsService";
import { CoreAdminCatalogService } from "../../services/CoreAdminCatalogService";
import { CoreCatalogService } from "../../services/CoreCatalogService";
import {
  PackageService,
  normalizePackageServiceIds,
} from "../../services/PackageService";
import "../../styles/dashboard-v2/dashboard-v2.css";

const DEFAULT_PACKAGE_SESSIONS = 1;

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
  description?: string;
  serviceIds: string[];
  sessionsCount: number;
  price: number;
  validityDays?: number;
  active: boolean;
  saleEnabled: boolean;
  imageUrl?: string;
  terms?: string;
  startsAt?: string;
  endsAt?: string;
  audienceScope: "all" | "specific" | string;
  targetClientIds: string[];
  sortOrder: number;
  createdAt?: any;
  updatedAt?: any;
};

type CatalogPanel = "items" | "packages" | "season";
type ListMode = "sections" | "services";
type DetailsMode = "view" | "edit";
type DetailsTab = "overview" | "pricing" | "variants" | "audit";
type FilterStatus = "all" | "active" | "inactive";
type PackagePickerView = "all" | "selected";
type ComposerMode = null | "section" | "service";

type SettingsCatalogV2Props = {
  hasAdminPower: boolean;
};

function buildId(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/^_+|_+$/g, "");
}

function clampInt(value: any, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseNumberInput(raw: string, fallback = 0) {
  if (raw === "") return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMillisSafe(value: any) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return Number(value.seconds) * 1000;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTimestamp(value: any) {
  const milliseconds = toMillisSafe(value);
  if (!milliseconds) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(milliseconds));
}

function money(value: number) {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", {
    maximumFractionDigits: 2,
  }).format(Math.max(0, Number(value || 0)));
}

function TabButton(props: {
  active: boolean;
  index?: string;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`settings-catalog-v2-tab ${props.active ? "is-active" : ""}`}
      aria-pressed={props.active}
      onClick={props.onClick}
    >
      {props.index ? <span className="settings-catalog-v2-tab__index">{props.index}</span> : null}
      <span className="settings-catalog-v2-tab__copy">
        <strong>{props.title}</strong>
        {props.hint ? <small>{props.hint}</small> : null}
      </span>
    </button>
  );
}

function Field(props: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  hint?: string;
}) {
  return (
    <div className={`dsv2-field ${props.wide ? "settings-catalog-v2-field--wide" : ""}`}>
      <span className="dsv2-field__label">{props.label}</span>
      {props.children}
      {props.hint ? <small className="settings-catalog-v2-field__hint">{props.hint}</small> : null}
    </div>
  );
}

function ToggleCard(props: {
  checked: boolean;
  label: string;
  hint: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`settings-catalog-v2-toggle ${props.checked ? "is-on" : ""}`}
      aria-pressed={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="settings-catalog-v2-toggle__mark" aria-hidden="true">
        {props.checked ? "✓" : ""}
      </span>
      <span className="settings-catalog-v2-toggle__copy">
        <strong>{props.label}</strong>
        <small>{props.hint}</small>
      </span>
      <span className="settings-catalog-v2-toggle__status">
        {props.checked ? "مفعّل" : "متوقف"}
      </span>
    </button>
  );
}

export default function SettingsCatalogV2({ hasAdminPower }: SettingsCatalogV2Props) {
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

  const [activeCatalogPanel, setActiveCatalogPanel] = useState<CatalogPanel>("items");
  const [activeListMode, setActiveListMode] = useState<ListMode>("sections");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<DetailsMode>("view");
  const [activeTab, setActiveTab] = useState<DetailsTab>("variants");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [serviceSectionFilter, setServiceSectionFilter] = useState("all");
  const [composerMode, setComposerMode] = useState<ComposerMode>(null);

  const [newSection, setNewSection] = useState({ name: "", order: 1, active: true });
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newService, setNewService] = useState({
    sectionId: "",
    categoryId: "",
    name: "",
    durationMin: 60,
    price: 0,
    seasonPrice: null as number | null,
    active: true,
  });

  const [sectionDraft, setSectionDraft] = useState<SectionRow | null>(null);
  const [serviceDraft, setServiceDraft] = useState<ServiceRow | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState("");
  const [openedServiceId, setOpenedServiceId] = useState<string | null>(null);
  const [openedServiceMode, setOpenedServiceMode] = useState<DetailsMode>("view");
  const [openedServiceDraft, setOpenedServiceDraft] = useState<ServiceRow | null>(null);

  const [packageName, setPackageName] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageServiceIds, setPackageServiceIds] = useState<string[]>([]);
  const [packageSessionsCount, setPackageSessionsCount] = useState(DEFAULT_PACKAGE_SESSIONS);
  const [packagePrice, setPackagePrice] = useState(0);
  const [packageValidityDays, setPackageValidityDays] = useState("");
  const [packageActive, setPackageActive] = useState(true);
  const [packageSaleEnabled, setPackageSaleEnabled] = useState(true);
  const [packageImageUrl, setPackageImageUrl] = useState("");
  const [packageTerms, setPackageTerms] = useState("");
  const [packageStartsAt, setPackageStartsAt] = useState("");
  const [packageEndsAt, setPackageEndsAt] = useState("");
  const [packageAudienceScope, setPackageAudienceScope] = useState<"all" | "specific">("all");
  const [packageTargetClientIdsText, setPackageTargetClientIdsText] = useState("");
  const [packageSortOrder, setPackageSortOrder] = useState(0);
  const [packageSaving, setPackageSaving] = useState(false);
  const [packageServiceSearch, setPackageServiceSearch] = useState("");
  const [packageServiceSectionFilter, setPackageServiceSectionFilter] = useState("all");
  const [packageServiceView, setPackageServiceView] = useState<PackagePickerView>("all");
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);

  const [seasonPricingEnabled, setSeasonPricingEnabled] = useState(false);
  const [seasonPricingFrom, setSeasonPricingFrom] = useState("");
  const [seasonPricingTo, setSeasonPricingTo] = useState("");

  const busy = secLoading || catLoading || srvLoading || pkgLoading || seasonLoading;

  const showMsg = (message: string, milliseconds = 1800) => {
    setCatalogMsg(message);
    if (milliseconds > 0) window.setTimeout(() => setCatalogMsg(""), milliseconds);
  };

  const sectionById = useMemo(
    () => new Map(sections.map((row) => [row.id, row] as const)),
    [sections],
  );
  const categoryById = useMemo(
    () => new Map(categories.map((row) => [row.id, row] as const)),
    [categories],
  );
  const serviceById = useMemo(
    () => new Map(services.map((row) => [row.id, row] as const)),
    [services],
  );

  const catalogStats = useMemo(
    () => [
      { label: "الأقسام", value: String(sections.length), hint: "الوحدات الرئيسية", tone: "dsv2-metric-card--gold" },
      { label: "التصنيفات", value: String(categories.length), hint: "تصنيفات الخدمات", tone: "dsv2-metric-card--success" },
      { label: "الخدمات", value: String(services.length), hint: "الخدمات التشغيلية", tone: "dsv2-metric-card--dark" },
      { label: "الباقات", value: String(packages.length), hint: "باقات الجلسات", tone: "dsv2-metric-card--danger" },
    ],
    [categories.length, packages.length, sections.length, services.length],
  );

  const nextSectionOrder = useMemo(
    () => sections.length ? Math.max(...sections.map((section) => Number(section.order || 0))) + 1 : 1,
    [sections],
  );

  const selectedSectionLive = useMemo(() => {
    if (!selectedId) return null;
    if (activeListMode === "sections") return sections.find((row) => row.id === selectedId) || null;
    const service = services.find((row) => row.id === selectedId) || null;
    return service ? sectionById.get(String(service.sectionId || "").trim()) || null : null;
  }, [activeListMode, selectedId, sections, services, sectionById]);

  const selectedServiceLive = useMemo(
    () => activeListMode === "services" && selectedId
      ? services.find((row) => row.id === selectedId) || null
      : null,
    [activeListMode, selectedId, services],
  );

  const selectedSectionId = String(selectedSectionLive?.id || "").trim();
  const categoriesInSection = useMemo(
    () => categories
      .filter((row) => String(row.sectionId || "").trim() === selectedSectionId)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [categories, selectedSectionId],
  );

  const servicesInActiveCategory = useMemo(() => {
    if (!activeCategoryId) return [];
    return services
      .filter((row) =>
        String(row.sectionId || "").trim() === selectedSectionId &&
        String(row.categoryId || "").trim() === activeCategoryId,
      )
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  }, [activeCategoryId, selectedSectionId, services]);

  const composerCategories = useMemo(
    () => categories
      .filter((row) => String(row.sectionId || "").trim() === String(newService.sectionId || "").trim())
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
    [categories, newService.sectionId],
  );

  const filteredSections = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sections
      .filter((row) => statusFilter === "all" ? true : statusFilter === "active" ? row.active : !row.active)
      .filter((row) => !needle || row.id.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }, [search, sections, statusFilter]);

  const filteredServices = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return services
      .filter((row) => statusFilter === "all" ? true : statusFilter === "active" ? row.active : !row.active)
      .filter((row) => serviceSectionFilter === "all" || String(row.sectionId || "").trim() === serviceSectionFilter)
      .filter((row) => {
        if (!needle) return true;
        const sectionName = String(sectionById.get(String(row.sectionId || "").trim())?.name || "").toLowerCase();
        const categoryName = String(categoryById.get(String(row.categoryId || "").trim())?.name || "").toLowerCase();
        return row.id.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || sectionName.includes(needle) || categoryName.includes(needle);
      })
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  }, [categoryById, search, sectionById, serviceSectionFilter, services, statusFilter]);

  const selectedPackageServiceIds = useMemo(
    () => normalizePackageServiceIds(packageServiceIds),
    [packageServiceIds],
  );

  const selectedPackageServices = useMemo(
    () => selectedPackageServiceIds
      .map((id) => serviceById.get(id))
      .filter((row): row is ServiceRow => Boolean(row)),
    [selectedPackageServiceIds, serviceById],
  );

  const filteredPackageServices = useMemo(() => {
    const needle = packageServiceSearch.trim().toLowerCase();
    return services
      .filter((row) => packageServiceSectionFilter === "all" || String(row.sectionId || "").trim() === packageServiceSectionFilter)
      .filter((row) => packageServiceView === "all" || selectedPackageServiceIds.includes(row.id))
      .filter((row) => {
        if (!needle) return true;
        const sectionName = String(sectionById.get(String(row.sectionId || "").trim())?.name || "").toLowerCase();
        const categoryName = String(categoryById.get(String(row.categoryId || "").trim())?.name || "").toLowerCase();
        return row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle) || sectionName.includes(needle) || categoryName.includes(needle);
      })
      .sort((a, b) => {
        const selectedDelta = Number(selectedPackageServiceIds.includes(b.id)) - Number(selectedPackageServiceIds.includes(a.id));
        if (selectedDelta) return selectedDelta;
        return String(a.name || "").localeCompare(String(b.name || ""), "ar");
      });
  }, [categoryById, packageServiceSearch, packageServiceSectionFilter, packageServiceView, sectionById, selectedPackageServiceIds, services]);

  const packageSelectionTotal = useMemo(
    () => selectedPackageServices.reduce((sum, service) => sum + Math.max(0, Number(service.price || 0)), 0),
    [selectedPackageServices],
  );

  const loadSeasonSettings = async () => {
    try {
      const settings = await AppSettingsService.fetchRemote();
      if (settings?.catalogSeasonPricing) {
        setSeasonPricingEnabled(Boolean(settings.catalogSeasonPricing.enabled));
        setSeasonPricingFrom(String(settings.catalogSeasonPricing.from || ""));
        setSeasonPricingTo(String(settings.catalogSeasonPricing.to || ""));
      }
    } catch (error) {
      console.error("loadSeasonSettings error:", error);
    }
  };

  const loadCatalog = async () => {
    setCatalogMsg("");
    try {
      setSecLoading(true);
      setCatLoading(true);
      setSrvLoading(true);
      setPkgLoading(true);

      const [sectionRows, categoryRows, serviceRows, packageRows] = await Promise.all([
        CoreAdminCatalogService.listSections(false),
        CoreAdminCatalogService.listCategories(false),
        CoreCatalogService.listServices({ activeOnly: false }),
        PackageService.getAll(),
      ]);

      setSections(sectionRows
        .map((row: any) => ({
          id: String(row.id || ""),
          name: String(row.name || ""),
          active: row.active !== false,
          order: clampInt(row.sortOrder ?? 0, 0),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }))
        .filter((row: SectionRow) => row.name.trim()));

      setCategories(categoryRows
        .map((row: any) => ({
          id: String(row.id || ""),
          sectionId: String(row.sectionId || ""),
          name: String(row.name || ""),
          active: row.active !== false,
          order: clampInt(row.sortOrder ?? 0, 0),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }))
        .filter((row: CategoryRow) => row.name.trim()));

      setServices(serviceRows
        .map((row: any) => ({
          id: String(row.id || ""),
          sectionId: String(row.sectionId || ""),
          categoryId: String(row.categoryId || ""),
          name: String(row.name || ""),
          durationMin: clampInt(row.durationMinutes ?? 60, 5),
          price: Math.max(0, Number(row.priceHalalas || 0) / 100),
          seasonPrice: row.seasonPriceHalalas === null || row.seasonPriceHalalas === undefined
            ? null
            : Math.max(0, Number(row.seasonPriceHalalas || 0) / 100),
          active: row.active !== false,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }))
        .filter((row: ServiceRow) => row.name.trim()));

      setPackages(packageRows
        .map((pkg) => ({
          id: String(pkg.id || "").trim(),
          name: String(pkg.name || ""),
          description: String(pkg.description || "").trim() || undefined,
          serviceIds: normalizePackageServiceIds([
            ...(Array.isArray(pkg.allowedServiceIds) ? pkg.allowedServiceIds : []),
            ...(Array.isArray(pkg.serviceIds) ? pkg.serviceIds : []),
          ]),
          sessionsCount: Math.max(1, Number(pkg.sessionsCount || 1)),
          price: Math.max(0, Number(pkg.price || 0)),
          validityDays: pkg.validityDays === undefined || pkg.validityDays === null
            ? undefined
            : Math.max(1, Math.floor(Number(pkg.validityDays || 1))),
          active: pkg.active !== false,
          saleEnabled: pkg.saleEnabled !== false,
          imageUrl: String(pkg.imageUrl || "").trim() || undefined,
          terms: String(pkg.terms || "").trim() || undefined,
          startsAt: String(pkg.startsAt || "").slice(0, 10) || undefined,
          endsAt: String(pkg.endsAt || "").slice(0, 10) || undefined,
          audienceScope: String(pkg.audienceScope || "all"),
          targetClientIds: normalizePackageServiceIds(pkg.targetClientIds || []),
          sortOrder: Math.max(0, Number(pkg.sortOrder || 0)),
          createdAt: pkg.createdAt,
          updatedAt: pkg.updatedAt,
        }))
        .filter((row: PackageRow) => row.name.trim()));
    } catch (error) {
      console.error("loadCatalog error:", error);
      showMsg("❌ تعذر تحميل الكتالوج", 3000);
    } finally {
      setSecLoading(false);
      setCatLoading(false);
      setSrvLoading(false);
      setPkgLoading(false);
    }
  };

  useEffect(() => {
    void loadCatalog();
    void loadSeasonSettings();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const exists = activeListMode === "sections"
      ? sections.some((row) => row.id === selectedId)
      : services.some((row) => row.id === selectedId);
    if (!exists) setSelectedId(null);
  }, [activeListMode, selectedId, sections, services]);

  useEffect(() => {
    setMode("view");
    setActiveTab(activeListMode === "sections" ? "variants" : "overview");
    if (activeListMode === "sections") {
      const row = selectedId ? sections.find((item) => item.id === selectedId) || null : null;
      setSectionDraft(row ? { ...row } : null);
      setServiceDraft(null);
    } else {
      const row = selectedId ? services.find((item) => item.id === selectedId) || null : null;
      setServiceDraft(row ? { ...row } : null);
      setSectionDraft(null);
    }
    setOpenedServiceId(null);
    setOpenedServiceDraft(null);
    setOpenedServiceMode("view");
  }, [activeListMode, selectedId]);

  useEffect(() => {
    if (!selectedSectionId || !categoriesInSection.length) {
      setActiveCategoryId("");
      return;
    }
    if (!categoriesInSection.some((row) => row.id === activeCategoryId)) {
      setActiveCategoryId(categoriesInSection[0].id);
    }
  }, [activeCategoryId, categoriesInSection, selectedSectionId]);

  useEffect(() => {
    if (!openedServiceId) {
      setOpenedServiceDraft(null);
      return;
    }
    const row = services.find((service) => service.id === openedServiceId) || null;
    if (openedServiceMode === "view") setOpenedServiceDraft(row ? { ...row } : null);
  }, [openedServiceId, openedServiceMode, services]);

  const saveSectionRow = async (row: SectionRow) => {
    const name = String(row.name || "").trim();
    if (!name) { showMsg("❌ اسم القسم لا يمكن يكون فارغ", 2000); return false; }
    try {
      setSecLoading(true);
      await CoreAdminCatalogService.patchSection(row.id, { name, active: row.active !== false, sortOrder: Number(row.order || 0) });
      showMsg("✅ تم حفظ القسم");
      return true;
    } catch (error) {
      console.error("saveSectionRow error:", error); showMsg("❌ تعذر حفظ القسم", 2500); return false;
    } finally { setSecLoading(false); }
  };

  const saveServiceRow = async (row: ServiceRow) => {
    const name = String(row.name || "").trim();
    if (!name) { showMsg("❌ اسم الخدمة لا يمكن يكون فارغ", 2000); return false; }
    const categoryId = String(row.categoryId || "").trim();
    const category = categories.find((item) => item.id === categoryId);
    const sectionId = String(category?.sectionId || "").trim();
    if (!categoryId || !sectionId) { showMsg("❌ الخدمة لازم تكون مرتبطة بتصنيف وقسم", 2000); return false; }
    try {
      setSrvLoading(true);
      await CoreCatalogService.patchService(row.id, {
        categoryId, sectionId, name, durationMinutes: Math.max(5, Number(row.durationMin || 0)),
        priceHalalas: Math.round(Math.max(0, Number(row.price || 0)) * 100),
        seasonPriceHalalas: row.seasonPrice == null || String(row.seasonPrice) === "" ? null : Math.round(Math.max(0, Number(row.seasonPrice)) * 100),
        active: row.active !== false,
      });
      showMsg("✅ تم حفظ الخدمة");
      return true;
    } catch (error) { console.error("saveServiceRow error:", error); showMsg("❌ تعذر حفظ الخدمة", 2500); return false; }
    finally { setSrvLoading(false); }
  };

  const createSection = async () => {
    const name = newSection.name.trim();
    if (!name) return showMsg("❌ اسم القسم مطلوب", 2000);
    const id = buildId(name);
    if (!id) return showMsg("❌ تعذر توليد ID للقسم", 2200);
    try {
      setSecLoading(true);
      await CoreAdminCatalogService.createSection({ id, name, active: newSection.active !== false, sortOrder: Number(newSection.order || 0) });
      showMsg(`✅ تم إنشاء القسم (id: ${id})`); await loadCatalog(); setActiveListMode("sections"); setSelectedId(id); setComposerMode(null); setNewSection({ name: "", order: nextSectionOrder, active: true });
    } catch (error) { console.error("createSection error:", error); showMsg("❌ تعذر إنشاء القسم", 2500); }
    finally { setSecLoading(false); }
  };

  const deleteSection = async (id: string) => {
    if (services.some((service) => String(service.sectionId || "").trim() === id)) return showMsg("❌ لا يمكن حذف القسم لأن عليه خدمات. انقليها أولًا.", 3200);
    if (categories.some((category) => String(category.sectionId || "").trim() === id)) return showMsg("❌ لا يمكن حذف القسم لأن عليه تصنيفات.", 3200);
    if (!window.confirm("هل أنت متأكد من حذف هذا القسم؟")) return;
    try { setSecLoading(true); await CoreAdminCatalogService.removeSection(id); showMsg("✅ تم حذف القسم"); await loadCatalog(); setSelectedId(null); }
    catch (error) { console.error("deleteSection error:", error); showMsg("❌ تعذر حذف القسم", 2500); }
    finally { setSecLoading(false); }
  };

  const createCategory = async () => {
    const sectionId = selectedSectionId; const name = newCategoryName.trim();
    if (!sectionId) return showMsg("❌ اختر قسمًا أولًا", 2200);
    if (!name) return showMsg("❌ اسم التصنيف مطلوب", 2200);
    const id = buildId(`${sectionId}_${name}`);
    try {
      setCatLoading(true);
      const rows = categories.filter((row) => String(row.sectionId || "").trim() === sectionId);
      const nextOrder = rows.length ? Math.max(...rows.map((row) => Number(row.order || 0))) + 1 : 1;
      await CoreAdminCatalogService.createCategory({ id, sectionId, name, active: true, sortOrder: nextOrder });
      showMsg("✅ تم إضافة التصنيف"); setNewCategoryName(""); await loadCatalog(); setActiveCategoryId(id);
    } catch (error) { console.error("createCategory error:", error); showMsg("❌ تعذر إضافة التصنيف", 2500); }
    finally { setCatLoading(false); }
  };

  const saveCategory = async (row: CategoryRow) => {
    const name = row.name.trim(); if (!name) return showMsg("❌ اسم التصنيف لا يمكن يكون فارغ", 2000);
    try { setCatLoading(true); await CoreAdminCatalogService.patchCategory(row.id, { name, active: row.active !== false, sortOrder: Number(row.order || 0) }); showMsg("✅ تم حفظ التصنيف"); await loadCatalog(); }
    catch (error) { console.error("saveCategory error:", error); showMsg("❌ تعذر حفظ التصنيف", 2500); }
    finally { setCatLoading(false); }
  };

  const deleteCategory = async (id: string) => {
    if (services.some((service) => String(service.categoryId || "").trim() === id)) return showMsg("❌ لا يمكن حذف التصنيف لأن عليه خدمات.", 3000);
    if (!window.confirm("هل أنت متأكد من حذف هذا التصنيف؟")) return;
    try { setCatLoading(true); await CoreAdminCatalogService.removeCategory(id); showMsg("✅ تم حذف التصنيف"); await loadCatalog(); }
    catch (error) { console.error("deleteCategory error:", error); showMsg("❌ تعذر حذف التصنيف", 2500); }
    finally { setCatLoading(false); }
  };

  const startServiceComposer = (sectionId?: string, categoryId?: string) => {
    const resolvedSectionId = String(sectionId || selectedSectionId || sections[0]?.id || "").trim();
    if (!resolvedSectionId) return showMsg("❌ اختر قسمًا أولًا", 2200);
    const sectionCategories = categories
      .filter((row) => String(row.sectionId || "").trim() === resolvedSectionId)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const preferredCategoryId = String(categoryId || "").trim();
    const resolvedCategoryId = preferredCategoryId && sectionCategories.some((row) => row.id === preferredCategoryId)
      ? preferredCategoryId
      : String(sectionCategories[0]?.id || "").trim();
    if (!resolvedCategoryId) return showMsg("❌ أضف تصنيفًا أولًا قبل إضافة خدمة", 2600);
    setNewService({
      sectionId: resolvedSectionId,
      categoryId: resolvedCategoryId,
      name: "",
      durationMin: 60,
      price: 0,
      seasonPrice: null,
      active: true,
    });
    setComposerMode("service");
  };

  const createService = async () => {
    const name = newService.name.trim(); const categoryId = String(newService.categoryId || "").trim();
    if (!name) return showMsg("❌ اسم الخدمة مطلوب", 2000); if (!categoryId) return showMsg("❌ اختر تصنيفًا أولًا", 2200);
    const category = categories.find((row) => row.id === categoryId); const sectionId = String(category?.sectionId || "").trim();
    if (!sectionId) return showMsg("❌ التصنيف المختار غير صالح", 2200); const id = buildId(`${categoryId}_${name}`);
    try {
      setSrvLoading(true);
      await CoreCatalogService.createService({ id, categoryId, sectionId, name, durationMinutes: Math.max(5, Number(newService.durationMin || 60)), priceHalalas: Math.round(Math.max(0, Number(newService.price || 0)) * 100), seasonPriceHalalas: newService.seasonPrice == null || String(newService.seasonPrice) === "" ? null : Math.round(Math.max(0, Number(newService.seasonPrice)) * 100), active: newService.active !== false });
      showMsg(`✅ تم إضافة الخدمة (id: ${id})`); await loadCatalog(); setComposerMode(null); setActiveCategoryId(categoryId); setOpenedServiceId(id); setNewService({ sectionId: "", categoryId: "", name: "", durationMin: 60, price: 0, seasonPrice: null, active: true });
    } catch (error) { console.error("createService error:", error); showMsg("❌ تعذر إضافة الخدمة", 2500); }
    finally { setSrvLoading(false); }
  };

  const deleteService = async (id: string, clearSelection = false) => {
    if (!window.confirm("هل أنت متأكد من أرشفة هذه الخدمة؟")) return false;
    try { setSrvLoading(true); await CoreCatalogService.archiveService(id); showMsg("✅ تم أرشفة الخدمة"); await loadCatalog(); if (clearSelection) setSelectedId(null); if (openedServiceId === id) setOpenedServiceId(null); return true; }
    catch (error) { console.error("deleteService error:", error); showMsg("❌ تعذر أرشفة الخدمة", 2500); return false; }
    finally { setSrvLoading(false); }
  };

  const saveSelected = async () => {
    if (mode !== "edit") return;
    if (activeListMode === "sections" && sectionDraft) {
      if (await saveSectionRow(sectionDraft)) {
        await loadCatalog();
        setMode("view");
      }
      return;
    }
    if (activeListMode === "services" && serviceDraft && await saveServiceRow(serviceDraft)) {
      await loadCatalog();
      setMode("view");
    }
  };

  const toggleSelectedActive = async () => {
    if (activeListMode === "sections" && selectedSectionLive) {
      if (await saveSectionRow({ ...selectedSectionLive, active: !selectedSectionLive.active })) await loadCatalog();
      return;
    }
    if (activeListMode === "services" && selectedServiceLive) {
      if (await saveServiceRow({ ...selectedServiceLive, active: !selectedServiceLive.active })) await loadCatalog();
    }
  };

  const deleteSelected = async () => {
    if (!selectedId) return;
    if (activeListMode === "sections") await deleteSection(selectedId);
    else await deleteService(selectedId, true);
  };

  const cancelEdit = () => {
    if (activeListMode === "sections") setSectionDraft(selectedSectionLive ? { ...selectedSectionLive } : null);
    else setServiceDraft(selectedServiceLive ? { ...selectedServiceLive } : null);
    setMode("view");
  };

  const toggleOpenedServiceActive = async () => {
    const live = services.find((service) => service.id === openedServiceId);
    if (!live) return;
    if (await saveServiceRow({ ...live, active: !live.active })) {
      await loadCatalog();
      setOpenedServiceMode("view");
    }
  };

  const resetPackageForm = () => {
    setPackageName("");
    setPackageDescription("");
    setPackageServiceIds([]);
    setPackageSessionsCount(DEFAULT_PACKAGE_SESSIONS);
    setPackagePrice(0);
    setPackageValidityDays("");
    setPackageActive(true);
    setPackageSaleEnabled(true);
    setPackageImageUrl("");
    setPackageTerms("");
    setPackageStartsAt("");
    setPackageEndsAt("");
    setPackageAudienceScope("all");
    setPackageTargetClientIdsText("");
    setPackageSortOrder(0);
    setEditingPackageId(null);
    setPackageServiceSearch("");
    setPackageServiceSectionFilter("all");
    setPackageServiceView("all");
  };

  const savePackage = async () => {
    const name = packageName.trim();
    const serviceIds = normalizePackageServiceIds(packageServiceIds);
    const sessionsCount = Math.max(1, Number(packageSessionsCount || 0));
    const price = Math.max(0, Number(packagePrice || 0));
    const validityDays = packageValidityDays.trim() ? Math.max(1, Math.floor(Number(packageValidityDays))) : undefined;
    const targetClientIds = packageTargetClientIdsText.split(/[،,\n]/).map((value) => value.trim()).filter(Boolean);

    if (!name) return showMsg("اسم الباقة مطلوب", 2200);
    if (!serviceIds.length) return showMsg("اختاري خدمة واحدة على الأقل داخل الباقة", 2200);
    if (sessionsCount <= 0) return showMsg("عدد الجلسات يجب أن يكون أكبر من صفر", 2200);
    if (packageStartsAt && packageEndsAt && packageStartsAt > packageEndsAt) return showMsg("تاريخ بداية الباقة يجب أن يسبق تاريخ النهاية", 2400);
    if (packageAudienceScope === "specific" && !targetClientIds.length) return showMsg("أدخلي معرف عميلة واحدة على الأقل للاستهداف المحدد", 2600);

    setPackageSaving(true);
    try {
      const payload = {
        name,
        description: packageDescription.trim(),
        serviceIds,
        allowedServiceIds: serviceIds,
        sessionsCount,
        price,
        validityDays,
        active: packageActive !== false,
        saleEnabled: packageSaleEnabled !== false,
        imageUrl: packageImageUrl.trim(),
        terms: packageTerms.trim(),
        startsAt: packageStartsAt || undefined,
        endsAt: packageEndsAt || undefined,
        audienceScope: packageAudienceScope,
        targetClientIds,
        sortOrder: Math.max(0, Math.floor(Number(packageSortOrder || 0))),
      };
      if (editingPackageId) {
        await PackageService.update(editingPackageId, payload);
        showMsg("تم تحديث الباقة");
      } else {
        await PackageService.add(payload);
        showMsg("تم إنشاء الباقة");
      }
      await loadCatalog();
      resetPackageForm();
    } catch (error) {
      console.error("savePackage_failed", error);
      showMsg(editingPackageId ? "تعذر تحديث الباقة" : "تعذر إنشاء الباقة", 2800);
    } finally {
      setPackageSaving(false);
    }
  };

  const startPackageEdit = (pkg: PackageRow) => {
    setEditingPackageId(pkg.id);
    setPackageName(pkg.name.trim());
    setPackageDescription(String(pkg.description || "").trim());
    setPackageServiceIds(normalizePackageServiceIds(pkg.serviceIds));
    setPackageSessionsCount(Math.max(1, Number(pkg.sessionsCount || 1)));
    setPackagePrice(Math.max(0, Number(pkg.price || 0)));
    setPackageValidityDays(pkg.validityDays ? String(pkg.validityDays) : "");
    setPackageActive(pkg.active !== false);
    setPackageSaleEnabled(pkg.saleEnabled !== false);
    setPackageImageUrl(String(pkg.imageUrl || ""));
    setPackageTerms(String(pkg.terms || ""));
    setPackageStartsAt(String(pkg.startsAt || "").slice(0, 10));
    setPackageEndsAt(String(pkg.endsAt || "").slice(0, 10));
    setPackageAudienceScope(pkg.audienceScope === "specific" ? "specific" : "all");
    setPackageTargetClientIdsText((pkg.targetClientIds || []).join(", "));
    setPackageSortOrder(Math.max(0, Number(pkg.sortOrder || 0)));
    setPackageServiceSearch("");
    setPackageServiceSectionFilter("all");
    setPackageServiceView("selected");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const togglePackageService = (serviceId: string) => {
    setPackageServiceIds((previous) => {
      const current = normalizePackageServiceIds(previous);
      return current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : normalizePackageServiceIds([...current, serviceId]);
    });
  };

  const togglePackageActive = async (pkg: PackageRow) => {
    try {
      setPkgLoading(true);
      await PackageService.update(pkg.id, { active: !pkg.active });
      showMsg(pkg.active ? "تم تعطيل الباقة" : "تم تفعيل الباقة");
      await loadCatalog();
      if (editingPackageId === pkg.id) setPackageActive(!pkg.active);
    } catch (error) {
      console.error("togglePackageActive_failed", error);
      showMsg("تعذر تحديث حالة الباقة", 2500);
    } finally {
      setPkgLoading(false);
    }
  };

  const deletePackage = async (pkg: PackageRow) => {
    if (!window.confirm("حذف الباقة؟ إذا كانت مباعة سابقًا فسيتم أرشفتها وإيقاف بيعها مع حفظ سجلات العميلات.")) return;
    try {
      setPkgLoading(true);
      const result = await PackageService.remove(pkg.id);
      showMsg(result?.archived ? "تمت أرشفة الباقة لأنها مرتبطة بمبيعات" : "تم حذف الباقة");
      if (editingPackageId === pkg.id) resetPackageForm();
      await loadCatalog();
    } catch (error) {
      console.error("deletePackageCatalog_failed", error);
      showMsg("تعذر حذف الباقة", 2600);
    } finally {
      setPkgLoading(false);
    }
  };

  const saveSeasonPricing = async () => {
    const from = seasonPricingFrom.trim();
    const to = seasonPricingTo.trim();
    if (seasonPricingEnabled && (!from || !to)) return showMsg("❌ حددي تاريخ (من/إلى) لموسم الأسعار", 2200);
    if (seasonPricingEnabled && from > to) return showMsg("❌ تاريخ (من) لازم يكون قبل أو يساوي (إلى)", 2200);
    try {
      setSeasonLoading(true);
      const latest = await AppSettingsService.fetchRemote().catch(() => ({} as any));
      await AppSettingsService.saveRemote({
        ...(latest || {}),
        catalogSeasonPricing: {
          enabled: Boolean(seasonPricingEnabled),
          from,
          to,
          startDate: from,
          endDate: to,
        },
      });
      showMsg("✅ تم حفظ موسم الأسعار");
    } catch (error) {
      console.error("saveSeasonPricing error:", error);
      showMsg("❌ تعذر حفظ موسم الأسعار", 2500);
    } finally {
      setSeasonLoading(false);
    }
  };

  const openListMode = (nextMode: ListMode) => {
    setActiveListMode(nextMode);
    setSelectedId(null);
    setMode("view");
    setComposerMode(null);
    setSearch("");
    setStatusFilter("all");
    if (nextMode === "sections") setServiceSectionFilter("all");
  };

  const openServiceFromPackage = (serviceId: string) => {
    const service = services.find((row) => row.id === serviceId);
    if (!service) return showMsg("تعذر فتح الخدمة للتعديل", 2200);
    setActiveCatalogPanel("items");
    setActiveListMode("services");
    setServiceSectionFilter(String(service.sectionId || "all") || "all");
    setSearch("");
    setStatusFilter("all");
    setSelectedId(service.id);
    window.setTimeout(() => {
      setActiveTab("pricing");
      setServiceDraft({ ...service });
      setMode("edit");
    }, 0);
  };

  if (!hasAdminPower) {
    return (
      <main className="dsv2-page settings-catalog-v2-page" dir="rtl">
        <DashboardEmptyStateV2
          tone="gold"
          title="غير مصرح"
          description="هذه الصفحة مخصصة للإدارة (Owner/Admin)."
        />
      </main>
    );
  }

  const sectionOptions = sections.map((section) => ({ value: section.id, label: section.name }));
  const statusOptions = [
    { value: "all", label: "كل الحالات" },
    { value: "active", label: "نشط" },
    { value: "inactive", label: "غير نشط" },
  ];

  const selectedLive = activeListMode === "sections" ? selectedSectionLive : selectedServiceLive;
  const selectedActive = selectedLive?.active !== false;
  const openedServiceLive = services.find((service) => service.id === openedServiceId) || null;

  return (
    <main className="dsv2-page settings-catalog-v2-page" dir="rtl">
      <section className="dsv2-card settings-catalog-v2-hero">
        <div className="settings-catalog-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">إعدادات الكتالوج</span>
          <h1 className="dsv2-page-title">إدارة الكتالوج</h1>
          <p className="dsv2-page-subtitle">
            إدارة الأقسام والتصنيفات والخدمات وباقات الجلسات وموسم الأسعار من مساحة واحدة.
          </p>
          <div className="settings-catalog-v2-hero__badges">
            <span className="dsv2-badge dsv2-badge--success">تحكم إداري</span>
            <span className="dsv2-badge">{services.length} خدمة</span>
          </div>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--secondary"
          disabled={busy}
          onClick={() => void Promise.all([loadCatalog(), loadSeasonSettings()])}
        >
          {busy ? "جاري التحديث…" : "تحديث البيانات"}
        </button>
      </section>

      <section className="settings-catalog-v2-metrics" aria-label="ملخص الكتالوج">
        {catalogStats.map((item) => (
          <article key={item.label} className={`dsv2-metric-card ${item.tone}`}>
            <p className="dsv2-metric-card__label">{item.label}</p>
            <p className="dsv2-metric-card__value">{item.value}</p>
            <p className="dsv2-metric-card__meta">{item.hint}</p>
          </article>
        ))}
      </section>

      <section className="settings-catalog-v2-tabs" aria-label="مساحات عمل الكتالوج">
        <TabButton active={activeCatalogPanel === "items"} index="01" title="الأقسام والخدمات" hint={`${sections.length} قسم / ${services.length} خدمة`} onClick={() => { setActiveCatalogPanel("items"); setComposerMode(null); }} />
        <TabButton active={activeCatalogPanel === "packages"} index="02" title="باقات الجلسات" hint={`${packages.length} باقة`} onClick={() => { setActiveCatalogPanel("packages"); setComposerMode(null); }} />
        <TabButton active={activeCatalogPanel === "season"} index="03" title="موسم الأسعار" hint={seasonPricingEnabled ? "مفعّل حاليًا" : "غير مفعّل"} onClick={() => { setActiveCatalogPanel("season"); setComposerMode(null); }} />
      </section>

      {catalogMsg ? (
        <div className={`settings-catalog-v2-notice ${catalogMsg.includes("❌") || catalogMsg.includes("تعذر") ? "is-error" : "is-success"}`} role="status">
          {catalogMsg}
        </div>
      ) : null}

      {activeCatalogPanel === "items" ? (
        <section className="settings-catalog-v2-workspace">
          <aside className="dsv2-card dsv2-card--padded settings-catalog-v2-list-panel">
            <div className="settings-catalog-v2-mode-tabs">
              <button type="button" className={`settings-catalog-v2-mode ${activeListMode === "sections" ? "is-active" : ""}`} onClick={() => openListMode("sections")}>الأقسام <span>{filteredSections.length}</span></button>
              <button type="button" className={`settings-catalog-v2-mode ${activeListMode === "services" ? "is-active" : ""}`} onClick={() => openListMode("services")}>الخدمات <span>{filteredServices.length}</span></button>
            </div>

            <div className="settings-catalog-v2-filters">
              <input
                className="dsv2-input settings-catalog-v2-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeListMode === "sections" ? "بحث في الأقسام…" : "بحث في الخدمات أو التصنيف…"}
              />
              <DashboardSelectV2
                value={statusFilter}
                options={statusOptions}
                onChange={(value) => setStatusFilter(value as FilterStatus)}
              />
              {activeListMode === "services" ? (
                <DashboardSelectV2
                  value={serviceSectionFilter}
                  options={[{ value: "all", label: "كل الأقسام" }, ...sectionOptions]}
                  onChange={setServiceSectionFilter}
                />
              ) : null}
            </div>

            <div className="settings-catalog-v2-list-actions">
              <button
                type="button"
                className="dsv2-btn dsv2-btn--accent"
                onClick={() => {
                  if (activeListMode === "sections") {
                    setNewSection({ name: "", order: nextSectionOrder, active: true });
                    setComposerMode("section");
                  } else {
                    startServiceComposer();
                  }
                }}
              >
                {activeListMode === "sections" ? "+ إضافة قسم" : "+ إضافة خدمة"}
              </button>
            </div>

            {composerMode === "section" ? (
              <div className="settings-catalog-v2-composer">
                <div className="settings-catalog-v2-composer__head">
                  <strong>إضافة قسم جديد</strong>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setComposerMode(null)}>إلغاء</button>
                </div>
                <div className="settings-catalog-v2-form-grid">
                  <Field label="اسم القسم" wide>
                    <input className="dsv2-input" value={newSection.name} onChange={(event) => setNewSection((previous) => ({ ...previous, name: event.target.value }))} />
                  </Field>
                  <Field label="الترتيب">
                    <DashboardNumberInputV2 className="dsv2-input" value={newSection.order} onChange={(event) => setNewSection((previous) => ({ ...previous, order: Number(event.target.value || 0) }))} />
                  </Field>
                </div>
                <ToggleCard checked={newSection.active} label="القسم نشط" hint="يظهر ضمن الكتالوج عند التفعيل." onChange={(active) => setNewSection((previous) => ({ ...previous, active }))} />
                <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={secLoading} onClick={() => void createSection()}>إنشاء القسم</button>
              </div>
            ) : null}

            {composerMode === "service" && activeListMode === "services" ? (
              <div className="settings-catalog-v2-composer">
                <div className="settings-catalog-v2-composer__head">
                  <strong>إضافة خدمة جديدة</strong>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setComposerMode(null)}>إلغاء</button>
                </div>
                <div className="settings-catalog-v2-form-grid">
                  <Field label="القسم">
                    <DashboardSelectV2
                      value={newService.sectionId}
                      placeholder="اختر القسم"
                      options={sectionOptions}
                      onChange={(sectionId) => {
                        const availableCategories = categories.filter((category) => category.sectionId === sectionId).sort((a, b) => a.order - b.order);
                        setNewService((previous) => ({ ...previous, sectionId, categoryId: availableCategories[0]?.id || "" }));
                      }}
                    />
                  </Field>
                  <Field label="التصنيف">
                    <DashboardSelectV2
                      value={newService.categoryId}
                      placeholder="اختر التصنيف"
                      options={composerCategories.map((category) => ({ value: category.id, label: category.name }))}
                      onChange={(categoryId) => setNewService((previous) => ({ ...previous, categoryId }))}
                    />
                  </Field>
                  <Field label="اسم الخدمة" wide>
                    <input className="dsv2-input" value={newService.name} onChange={(event) => setNewService((previous) => ({ ...previous, name: event.target.value }))} />
                  </Field>
                  <Field label="المدة (دقيقة)">
                    <DashboardNumberInputV2 className="dsv2-input" min={5} value={newService.durationMin} onChange={(event) => setNewService((previous) => ({ ...previous, durationMin: parseNumberInput(event.target.value, previous.durationMin) }))} />
                  </Field>
                  <Field label="السعر">
                    <DashboardNumberInputV2 className="dsv2-input" min={0} value={newService.price} onChange={(event) => setNewService((previous) => ({ ...previous, price: parseNumberInput(event.target.value, previous.price) }))} />
                  </Field>
                  <Field label="سعر الموسم">
                    <DashboardNumberInputV2 className="dsv2-input" min={0} value={newService.seasonPrice ?? ""} onChange={(event) => setNewService((previous) => ({ ...previous, seasonPrice: event.target.value === "" ? null : parseNumberInput(event.target.value, Number(previous.seasonPrice || 0)) }))} />
                  </Field>
                </div>
                <ToggleCard checked={newService.active} label="الخدمة نشطة" hint="تكون متاحة للعرض والحجز." onChange={(active) => setNewService((previous) => ({ ...previous, active }))} />
                <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={srvLoading || !newService.categoryId} onClick={() => void createService()}>إنشاء الخدمة</button>
              </div>
            ) : null}

            <div className="settings-catalog-v2-list-title">
              <strong>{activeListMode === "sections" ? "الأقسام" : "الخدمات"}</strong>
              <span>{activeListMode === "sections" ? filteredSections.length : filteredServices.length} نتيجة</span>
            </div>

            <div className="settings-catalog-v2-list">
              {activeListMode === "sections" ? (
                filteredSections.length ? filteredSections.map((section) => (
                  <button key={section.id} type="button" className={`settings-catalog-v2-row ${selectedId === section.id ? "is-selected" : ""}`} onClick={() => setSelectedId(section.id)}>
                    <span className="settings-catalog-v2-row__copy">
                      <strong>{section.name}</strong>
                      <small>ID: {section.id}</small>
                    </span>
                    <span className="settings-catalog-v2-row__meta">
                      <span>{categories.filter((category) => category.sectionId === section.id).length} تصنيف</span>
                      <span>{services.filter((service) => service.sectionId === section.id).length} خدمة</span>
                      <span className={`dsv2-badge ${section.active ? "dsv2-badge--success" : ""}`}>{section.active ? "نشط" : "معطل"}</span>
                    </span>
                  </button>
                )) : <DashboardEmptyStateV2 title="لا توجد أقسام مطابقة" description="غيّر البحث أو الفلاتر الحالية." />
              ) : (
                filteredServices.length ? filteredServices.map((service) => (
                  <button key={service.id} type="button" className={`settings-catalog-v2-row ${selectedId === service.id ? "is-selected" : ""}`} onClick={() => setSelectedId(service.id)}>
                    <span className="settings-catalog-v2-row__copy">
                      <strong>{service.name}</strong>
                      <small>{sectionById.get(service.sectionId)?.name || "قسم غير محدد"} · {categoryById.get(service.categoryId)?.name || "بدون تصنيف"}</small>
                    </span>
                    <span className="settings-catalog-v2-row__meta">
                      <span>{service.durationMin} دقيقة</span>
                      <span>{money(service.price)} ر.س</span>
                      <span className={`dsv2-badge ${service.active ? "dsv2-badge--success" : ""}`}>{service.active ? "نشط" : "معطل"}</span>
                    </span>
                  </button>
                )) : <DashboardEmptyStateV2 title="لا توجد خدمات مطابقة" description="غيّر البحث أو الفلاتر الحالية." />
              )}
            </div>
          </aside>

          <section className="dsv2-card dsv2-card--padded settings-catalog-v2-summary-panel">
            <span className="dsv2-badge dsv2-badge--gold">المعاينة</span>
            <h2>{activeListMode === "sections" ? "إدارة الأقسام والتصنيفات" : "إدارة الخدمات"}</h2>
            <p>اختر عنصرًا من القائمة لفتح نافذة التفاصيل الكاملة، التعديل، التعطيل أو الحذف.</p>
            <div className="settings-catalog-v2-summary-grid">
              <div><span>المعروض</span><strong>{activeListMode === "sections" ? filteredSections.length : filteredServices.length}</strong></div>
              <div><span>النشط</span><strong>{activeListMode === "sections" ? filteredSections.filter((row) => row.active).length : filteredServices.filter((row) => row.active).length}</strong></div>
            </div>
          </section>
        </section>
      ) : null}

      {activeCatalogPanel === "packages" ? (
        <section className="dsv2-card dsv2-card--padded settings-catalog-v2-panel">
          <header className="settings-catalog-v2-panel__head">
            <div>
              <span className="settings-catalog-v2-panel__eyebrow">02</span>
              <h2>{editingPackageId ? "تعديل باقة جلسات" : "إنشاء باقة جلسات"}</h2>
              <p>حدد محتوى الباقة، الخدمات المسموحة، فترة الإتاحة وحالة البيع.</p>
            </div>
            {editingPackageId ? <span className="dsv2-badge dsv2-badge--gold">تعديل: {editingPackageId}</span> : null}
          </header>

          <div className="settings-catalog-v2-form-grid settings-catalog-v2-form-grid--packages">
            <Field label="اسم الباقة" wide><input className="dsv2-input" value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="مثال: استشوار 10 جلسات" /></Field>
            <Field label="الوصف" wide><textarea className="dsv2-input settings-catalog-v2-textarea" rows={3} value={packageDescription} onChange={(event) => setPackageDescription(event.target.value)} /></Field>
            <Field label="عدد الجلسات"><DashboardNumberInputV2 className="dsv2-input" min={1} value={packageSessionsCount} onChange={(event) => setPackageSessionsCount(Number(event.target.value))} /></Field>
            <Field label="السعر"><DashboardNumberInputV2 className="dsv2-input" min={0} value={packagePrice} onChange={(event) => setPackagePrice(Number(event.target.value))} /></Field>
            <Field label="مدة الصلاحية بالأيام"><DashboardNumberInputV2 className="dsv2-input" min={1} value={packageValidityDays} onChange={(event) => setPackageValidityDays(event.target.value)} placeholder="بدون انتهاء" /></Field>
            <Field label="ترتيب العرض"><DashboardNumberInputV2 className="dsv2-input" min={0} value={packageSortOrder} onChange={(event) => setPackageSortOrder(Number(event.target.value))} /></Field>
            <Field label="رابط صورة الباقة" wide><input className="dsv2-input" value={packageImageUrl} onChange={(event) => setPackageImageUrl(event.target.value)} placeholder="https://..." /></Field>
            <Field label="بداية الإتاحة"><DashboardDatePickerV2 value={packageStartsAt} onChange={setPackageStartsAt} /></Field>
            <Field label="نهاية الإتاحة"><DashboardDatePickerV2 value={packageEndsAt} onChange={setPackageEndsAt} /></Field>
            <Field label="إتاحة الباقة"><DashboardSelectV2 value={packageAudienceScope} options={[{ value: "all", label: "جميع العميلات" }, { value: "specific", label: "عميلات محددات" }]} onChange={(value) => setPackageAudienceScope(value === "specific" ? "specific" : "all")} /></Field>
            <Field label="شروط الاستخدام" wide><textarea className="dsv2-input settings-catalog-v2-textarea" rows={3} value={packageTerms} onChange={(event) => setPackageTerms(event.target.value)} /></Field>
            {packageAudienceScope === "specific" ? <Field label="معرفات العميلات المستهدفات" wide><textarea className="dsv2-input settings-catalog-v2-textarea" rows={3} value={packageTargetClientIdsText} onChange={(event) => setPackageTargetClientIdsText(event.target.value)} placeholder="clientId أو Firebase UID مفصولة بفواصل" /></Field> : null}
          </div>

          <div className="settings-catalog-v2-toggle-grid">
            <ToggleCard checked={packageSaleEnabled} label="متاحة للبيع" hint="يمكن إيقاف البيع مع إبقاء الباقة في السجلات." onChange={setPackageSaleEnabled} />
            <ToggleCard checked={packageActive} label="الباقة مفعلة" hint="تظهر في الحجز عند التفعيل." onChange={setPackageActive} />
          </div>

          <div className="settings-catalog-v2-picker">
            <header className="settings-catalog-v2-picker__head">
              <div><strong>الخدمات داخل الباقة</strong><span>{selectedPackageServiceIds.length} خدمة مختارة · {money(packageSelectionTotal)} ر.س مجموع الأسعار</span></div>
              <div className="settings-catalog-v2-picker__head-actions">
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!filteredPackageServices.length} onClick={() => setPackageServiceIds((previous) => normalizePackageServiceIds([...previous, ...filteredPackageServices.map((service) => service.id)]))}>تحديد الظاهر</button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!selectedPackageServiceIds.length} onClick={() => { setPackageServiceIds([]); setPackageServiceView("all"); }}>مسح الاختيار</button>
              </div>
            </header>

            <div className="settings-catalog-v2-picker__filters">
              <input className="dsv2-input" value={packageServiceSearch} onChange={(event) => setPackageServiceSearch(event.target.value)} placeholder="ابحث باسم الخدمة أو القسم أو التصنيف…" />
              <DashboardSelectV2 value={packageServiceSectionFilter} options={[{ value: "all", label: "كل الأقسام" }, ...sectionOptions]} onChange={setPackageServiceSectionFilter} />
              <div className="settings-catalog-v2-segmented">
                <button type="button" className={packageServiceView === "all" ? "is-active" : ""} onClick={() => setPackageServiceView("all")}>كل الخدمات</button>
                <button type="button" className={packageServiceView === "selected" ? "is-active" : ""} onClick={() => setPackageServiceView("selected")}>المختارة ({selectedPackageServiceIds.length})</button>
              </div>
            </div>

            <div className="settings-catalog-v2-picker__body">
              <div className="settings-catalog-v2-service-options">
                {filteredPackageServices.length ? filteredPackageServices.map((service) => {
                  const checked = selectedPackageServiceIds.includes(service.id);
                  return (
                    <button type="button" key={service.id} className={`settings-catalog-v2-service-option ${checked ? "is-selected" : ""}`} onClick={() => togglePackageService(service.id)}>
                      <span className="settings-catalog-v2-service-option__check">{checked ? "✓" : ""}</span>
                      <span className="settings-catalog-v2-service-option__copy">
                        <strong>{service.name}</strong>
                        <small>{sectionById.get(service.sectionId)?.name || "قسم غير محدد"} · {categoryById.get(service.categoryId)?.name || "بدون تصنيف"}</small>
                      </span>
                      <span className="settings-catalog-v2-service-option__meta">{service.durationMin} د · {money(service.price)} ر.س</span>
                    </button>
                  );
                }) : <DashboardEmptyStateV2 title="لا توجد خدمات مطابقة" description="عدّل البحث أو الفلاتر." />}
              </div>

              <aside className="settings-catalog-v2-selected-services">
                <header><strong>الخدمات المختارة</strong><span>{selectedPackageServices.length}</span></header>
                {selectedPackageServices.length ? selectedPackageServices.map((service) => (
                  <div key={service.id} className="settings-catalog-v2-selected-service">
                    <div><strong>{service.name}</strong><small>{money(service.price)} ر.س · {service.durationMin} د</small></div>
                    <div>
                      <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => openServiceFromPackage(service.id)}>تعديل الخدمة</button>
                      <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => togglePackageService(service.id)}>إزالة</button>
                    </div>
                  </div>
                )) : <p className="settings-catalog-v2-muted">اختر خدمة من القائمة وستظهر هنا.</p>}
              </aside>
            </div>
          </div>

          <div className="settings-catalog-v2-panel-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={resetPackageForm}>{editingPackageId ? "إلغاء التعديل" : "تنظيف"}</button>
            <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={packageSaving} onClick={() => void savePackage()}>{packageSaving ? "جاري الحفظ…" : editingPackageId ? "حفظ تعديل الباقة" : "إنشاء الباقة"}</button>
          </div>

          <div className="settings-catalog-v2-package-list">
            <div className="settings-catalog-v2-list-title"><strong>الباقات الحالية</strong><span>{packages.length} باقة</span></div>
            {packages.length ? packages.map((pkg) => {
              const linkedNames = normalizePackageServiceIds(pkg.serviceIds).map((serviceId) => serviceById.get(serviceId)?.name || `خدمة غير موجودة (${serviceId})`);
              return (
                <article key={pkg.id} className={`settings-catalog-v2-package-card ${editingPackageId === pkg.id ? "is-editing" : ""}`}>
                  <div className="settings-catalog-v2-package-card__copy">
                    <div className="settings-catalog-v2-package-card__title"><strong>{pkg.name}</strong><span className={`dsv2-badge ${pkg.active ? "dsv2-badge--success" : ""}`}>{pkg.active ? "نشط" : "معطل"}</span></div>
                    <small>ID: {pkg.id}</small>
                    {pkg.description ? <p>{pkg.description}</p> : null}
                    <p>الخدمات: {linkedNames.join("، ")}</p>
                  </div>
                  <div className="settings-catalog-v2-package-card__meta">
                    <span>{pkg.sessionsCount} جلسات</span><span>{money(pkg.price)} ر.س</span><span>{pkg.validityDays ? `${pkg.validityDays} يوم` : "بدون انتهاء"}</span><span>{pkg.saleEnabled ? "متاحة للبيع" : "البيع موقوف"}</span>
                  </div>
                  <div className="settings-catalog-v2-package-card__actions">
                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => startPackageEdit(pkg)}>تعديل الباقة</button>
                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void togglePackageActive(pkg)}>{pkg.active ? "تعطيل" : "تفعيل"}</button>
                    <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void deletePackage(pkg)}>حذف/أرشفة</button>
                  </div>
                </article>
              );
            }) : <DashboardEmptyStateV2 title="لا توجد باقات حتى الآن" description="أنشئ أول باقة من النموذج أعلاه." />}
          </div>
        </section>
      ) : null}

      {activeCatalogPanel === "season" ? (
        <section className="dsv2-card dsv2-card--padded settings-catalog-v2-panel settings-catalog-v2-season">
          <header className="settings-catalog-v2-panel__head">
            <div><span className="settings-catalog-v2-panel__eyebrow">03</span><h2>موسم الأسعار</h2><p>حدد فترة الموسم لتفعيل الأسعار الموسمية للخدمات.</p></div>
            <span className={`dsv2-badge ${seasonPricingEnabled ? "dsv2-badge--success" : ""}`}>{seasonPricingEnabled ? "مفعّل" : "متوقف"}</span>
          </header>
          <ToggleCard checked={seasonPricingEnabled} label="تفعيل موسم الأسعار" hint="عند التفعيل تستخدم الخدمات سعر الموسم داخل الفترة المحددة." onChange={setSeasonPricingEnabled} />
          <div className="settings-catalog-v2-form-grid settings-catalog-v2-season__dates">
            <Field label="من تاريخ"><DashboardDatePickerV2 value={seasonPricingFrom} disabled={!seasonPricingEnabled} onChange={setSeasonPricingFrom} /></Field>
            <Field label="إلى تاريخ"><DashboardDatePickerV2 value={seasonPricingTo} disabled={!seasonPricingEnabled} onChange={setSeasonPricingTo} /></Field>
          </div>
          <div className="settings-catalog-v2-panel-actions">
            <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={seasonLoading} onClick={() => void saveSeasonPricing()}>{seasonLoading ? "جاري الحفظ…" : "حفظ موسم الأسعار"}</button>
          </div>
        </section>
      ) : null}

      <DashboardModalV2
        open={Boolean(selectedLive)}
        onClose={() => { setSelectedId(null); setMode("view"); setOpenedServiceId(null); setComposerMode(null); }}
        title={selectedLive?.name || "تفاصيل الكتالوج"}
        description={activeListMode === "sections" ? "إدارة بيانات القسم والتصنيفات والخدمات المرتبطة." : "إدارة بيانات الخدمة والسعر والمدة."}
        eyebrow={activeListMode === "sections" ? "تفاصيل القسم" : "تفاصيل الخدمة"}
        size="xl"
        tone="gold"
        className="settings-catalog-v2-detail-modal"
        footer={
          <div className="settings-catalog-v2-modal-footer">
            {mode === "edit" ? (
              <>
                <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={cancelEdit}>إلغاء</button>
                <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={busy} onClick={() => void saveSelected()}>حفظ التغييرات</button>
              </>
            ) : (
              <>
                <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setMode("edit")}>تعديل</button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={busy} onClick={() => void toggleSelectedActive()}>{selectedActive ? "تعطيل" : "تفعيل"}</button>
                <button type="button" className="dsv2-btn dsv2-btn--danger" disabled={busy} onClick={() => void deleteSelected()}>حذف</button>
              </>
            )}
          </div>
        }
      >
        {selectedLive ? (
          <div className="settings-catalog-v2-detail">
            <div className="settings-catalog-v2-detail-tabs">
              {activeListMode === "sections" ? (
                <>
                  <button type="button" className={activeTab === "variants" ? "is-active" : ""} onClick={() => setActiveTab("variants")}>التصنيفات</button>
                  <button type="button" className={activeTab === "overview" ? "is-active" : ""} onClick={() => setActiveTab("overview")}>نظرة عامة</button>
                  <button type="button" className={activeTab === "audit" ? "is-active" : ""} onClick={() => setActiveTab("audit")}>السجل</button>
                </>
              ) : (
                <>
                  <button type="button" className={activeTab === "overview" ? "is-active" : ""} onClick={() => setActiveTab("overview")}>نظرة عامة</button>
                  <button type="button" className={activeTab === "pricing" ? "is-active" : ""} onClick={() => setActiveTab("pricing")}>السعر والمدة</button>
                  <button type="button" className={activeTab === "variants" ? "is-active" : ""} onClick={() => setActiveTab("variants")}>Variants</button>
                  <button type="button" className={activeTab === "audit" ? "is-active" : ""} onClick={() => setActiveTab("audit")}>السجل</button>
                </>
              )}
            </div>

            {activeListMode === "sections" && selectedSectionLive ? (
              <>
                {activeTab === "overview" ? (
                  <div className="settings-catalog-v2-form-grid">
                    <Field label="اسم القسم"><input className="dsv2-input" value={(mode === "edit" ? sectionDraft?.name : selectedSectionLive.name) || ""} disabled={mode !== "edit"} onChange={(event) => setSectionDraft((previous) => previous ? { ...previous, name: event.target.value } : previous)} /></Field>
                    <Field label="الترتيب"><DashboardNumberInputV2 className="dsv2-input" value={mode === "edit" ? sectionDraft?.order ?? 0 : selectedSectionLive.order} disabled={mode !== "edit"} onChange={(event) => setSectionDraft((previous) => previous ? { ...previous, order: Number(event.target.value || 0) } : previous)} /></Field>
                    <Field label="ID"><input className="dsv2-input" value={selectedSectionLive.id} disabled /></Field>
                    <ToggleCard checked={mode === "edit" ? sectionDraft?.active !== false : selectedSectionLive.active !== false} label="القسم نشط" hint="حالة ظهور القسم داخل الكتالوج." disabled={mode !== "edit"} onChange={(active) => setSectionDraft((previous) => previous ? { ...previous, active } : previous)} />
                  </div>
                ) : null}

                {activeTab === "variants" ? (
                  <div className="settings-catalog-v2-categories">
                    <div className="settings-catalog-v2-inline-create">
                      <input className="dsv2-input" value={newCategoryName} disabled={mode !== "edit"} onChange={(event) => setNewCategoryName(event.target.value)} placeholder="اسم تصنيف جديد" onKeyDown={(event) => { if (event.key === "Enter" && mode === "edit") void createCategory(); }} />
                      <button type="button" className="dsv2-btn dsv2-btn--accent" disabled={mode !== "edit" || catLoading} onClick={() => void createCategory()}>إضافة تصنيف</button>
                    </div>

                    {categoriesInSection.length ? categoriesInSection.map((category) => (
                      <article key={category.id} className={`settings-catalog-v2-category-card ${activeCategoryId === category.id ? "is-active" : ""}`}>
                        <div className="settings-catalog-v2-category-card__fields">
                          <input className="dsv2-input" value={category.name} disabled={mode !== "edit"} onChange={(event) => setCategories((previous) => previous.map((row) => row.id === category.id ? { ...row, name: event.target.value } : row))} />
                          <DashboardNumberInputV2 className="dsv2-input settings-catalog-v2-category-order" value={category.order} disabled={mode !== "edit"} onChange={(event) => setCategories((previous) => previous.map((row) => row.id === category.id ? { ...row, order: Number(event.target.value || 0) } : row))} />
                          <button type="button" className={`dsv2-btn dsv2-btn--sm ${category.active ? "dsv2-btn--success" : "dsv2-btn--secondary"}`} disabled={mode !== "edit"} aria-pressed={category.active} onClick={() => setCategories((previous) => previous.map((row) => row.id === category.id ? { ...row, active: !row.active } : row))}>{category.active ? "نشط" : "معطل"}</button>
                          <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => { setActiveCategoryId(category.id); setOpenedServiceId(null); }}>الخدمات ({services.filter((service) => service.categoryId === category.id).length})</button>
                          <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={mode !== "edit"} onClick={() => void saveCategory(category)}>حفظ</button>
                          <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={mode !== "edit"} onClick={() => void deleteCategory(category.id)}>حذف</button>
                        </div>
                      </article>
                    )) : <DashboardEmptyStateV2 title="لا توجد تصنيفات" description="حوّل القسم إلى وضع التعديل ثم أضف أول تصنيف." />}

                    {activeCategoryId ? (
                      <section className="settings-catalog-v2-category-services">
                        <header>
                          <div><strong>خدمات التصنيف: {categoryById.get(activeCategoryId)?.name || "—"}</strong><span>{servicesInActiveCategory.length} خدمة</span></div>
                          <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={mode !== "edit"} onClick={() => startServiceComposer(selectedSectionLive.id, activeCategoryId)}>+ إضافة خدمة</button>
                        </header>

                        {composerMode === "service" ? (
                          <div className="settings-catalog-v2-composer">
                            <div className="settings-catalog-v2-form-grid">
                              <Field label="اسم الخدمة" wide><input className="dsv2-input" value={newService.name} onChange={(event) => setNewService((previous) => ({ ...previous, name: event.target.value }))} /></Field>
                              <Field label="المدة (دقيقة)"><DashboardNumberInputV2 className="dsv2-input" min={5} value={newService.durationMin} onChange={(event) => setNewService((previous) => ({ ...previous, durationMin: parseNumberInput(event.target.value, previous.durationMin) }))} /></Field>
                              <Field label="السعر"><DashboardNumberInputV2 className="dsv2-input" min={0} value={newService.price} onChange={(event) => setNewService((previous) => ({ ...previous, price: parseNumberInput(event.target.value, previous.price) }))} /></Field>
                              <Field label="سعر الموسم"><DashboardNumberInputV2 className="dsv2-input" min={0} value={newService.seasonPrice ?? ""} onChange={(event) => setNewService((previous) => ({ ...previous, seasonPrice: event.target.value === "" ? null : parseNumberInput(event.target.value, Number(previous.seasonPrice || 0)) }))} /></Field>
                            </div>
                            <ToggleCard checked={newService.active} label="الخدمة نشطة" hint="تكون متاحة للعرض والحجز بعد الإنشاء." onChange={(active) => setNewService((previous) => ({ ...previous, active }))} />
                            <div className="settings-catalog-v2-panel-actions">
                              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setComposerMode(null)}>إلغاء</button>
                              <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" disabled={srvLoading} onClick={() => void createService()}>إنشاء</button>
                            </div>
                          </div>
                        ) : null}

                        <div className="settings-catalog-v2-category-services__list">
                          {servicesInActiveCategory.length ? servicesInActiveCategory.map((service) => (
                            <button type="button" key={service.id} className={`settings-catalog-v2-linked-service ${openedServiceId === service.id ? "is-open" : ""}`} onClick={() => { setOpenedServiceId(service.id); setOpenedServiceMode("view"); }}>
                              <span><strong>{service.name}</strong><small>{service.durationMin} د · {money(service.price)} ر.س</small></span>
                              <span className={`dsv2-badge ${service.active ? "dsv2-badge--success" : ""}`}>{service.active ? "نشط" : "معطل"}</span>
                            </button>
                          )) : <p className="settings-catalog-v2-muted">لا توجد خدمات داخل هذا التصنيف.</p>}
                        </div>

                        {openedServiceId && openedServiceDraft && openedServiceLive ? (
                          <div className="settings-catalog-v2-opened-service">
                            <header>
                              <div><strong>عرض الخدمة</strong><span>{openedServiceId}</span></div>
                              <div>
                                {openedServiceMode === "edit" ? (
                                  <>
                                    <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={async () => { if (await saveServiceRow(openedServiceDraft)) { await loadCatalog(); setOpenedServiceMode("view"); } }}>حفظ</button>
                                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => { setOpenedServiceDraft({ ...openedServiceLive }); setOpenedServiceMode("view"); }}>إلغاء</button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setOpenedServiceMode("edit")}>تعديل</button>
                                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={srvLoading} onClick={() => void toggleOpenedServiceActive()}>{openedServiceLive.active ? "تعطيل" : "تفعيل"}</button>
                                    <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={srvLoading} onClick={() => void deleteService(openedServiceId, false)}>حذف</button>
                                  </>
                                )}
                              </div>
                            </header>
                            <div className="settings-catalog-v2-form-grid">
                              <Field label="اسم الخدمة"><input className="dsv2-input" value={openedServiceDraft.name} disabled={openedServiceMode !== "edit"} onChange={(event) => setOpenedServiceDraft((previous) => previous ? { ...previous, name: event.target.value } : previous)} /></Field>
                              <Field label="التصنيف">
                                <DashboardSelectV2
                                  value={openedServiceDraft.categoryId}
                                  disabled={openedServiceMode !== "edit"}
                                  options={categoriesInSection.map((category) => ({ value: category.id, label: category.name }))}
                                  onChange={(categoryId) => setOpenedServiceDraft((previous) => previous ? { ...previous, categoryId, sectionId: String(categoryById.get(categoryId)?.sectionId || previous.sectionId) } : previous)}
                                />
                              </Field>
                              <Field label="السعر"><DashboardNumberInputV2 className="dsv2-input" min={0} value={openedServiceDraft.price} disabled={openedServiceMode !== "edit"} onChange={(event) => setOpenedServiceDraft((previous) => previous ? { ...previous, price: parseNumberInput(event.target.value, previous.price) } : previous)} /></Field>
                              <Field label="المدة"><DashboardNumberInputV2 className="dsv2-input" min={5} value={openedServiceDraft.durationMin} disabled={openedServiceMode !== "edit"} onChange={(event) => setOpenedServiceDraft((previous) => previous ? { ...previous, durationMin: parseNumberInput(event.target.value, previous.durationMin) } : previous)} /></Field>
                              <Field label="سعر الموسم"><DashboardNumberInputV2 className="dsv2-input" min={0} value={openedServiceDraft.seasonPrice ?? ""} disabled={openedServiceMode !== "edit"} onChange={(event) => setOpenedServiceDraft((previous) => previous ? { ...previous, seasonPrice: event.target.value === "" ? null : parseNumberInput(event.target.value, 0) } : previous)} /></Field>
                              <ToggleCard checked={openedServiceDraft.active !== false} label="الخدمة نشطة" hint="يمكن تغيير حالة الخدمة مع بقية بياناتها." disabled={openedServiceMode !== "edit"} onChange={(active) => setOpenedServiceDraft((previous) => previous ? { ...previous, active } : previous)} />
                            </div>
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </div>
                ) : null}

                {activeTab === "audit" ? (
                  <div className="settings-catalog-v2-audit">
                    <div><span>تاريخ الإنشاء</span><strong>{formatTimestamp(selectedSectionLive.createdAt)}</strong></div>
                    <div><span>آخر تحديث</span><strong>{formatTimestamp(selectedSectionLive.updatedAt)}</strong></div>
                    <div><span>Section ID</span><strong dir="ltr">{selectedSectionLive.id}</strong></div>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeListMode === "services" && selectedServiceLive ? (
              <>
                {activeTab === "overview" ? (
                  <div className="settings-catalog-v2-form-grid">
                    <Field label="اسم الخدمة"><input className="dsv2-input" value={(mode === "edit" ? serviceDraft?.name : selectedServiceLive.name) || ""} disabled={mode !== "edit"} onChange={(event) => setServiceDraft((previous) => previous ? { ...previous, name: event.target.value } : previous)} /></Field>
                    <Field label="ID"><input className="dsv2-input" value={selectedServiceLive.id} disabled /></Field>
                    <Field label="القسم">
                      <DashboardSelectV2
                        value={String(mode === "edit" ? serviceDraft?.sectionId || "" : selectedServiceLive.sectionId || "")}
                        disabled={mode !== "edit"}
                        options={sectionOptions}
                        onChange={(sectionId) => {
                          const availableCategories = categories.filter((category) => category.sectionId === sectionId).sort((a, b) => a.order - b.order);
                          setServiceDraft((previous) => previous ? { ...previous, sectionId, categoryId: availableCategories[0]?.id || "" } : previous);
                        }}
                      />
                    </Field>
                    <Field label="التصنيف">
                      <DashboardSelectV2
                        value={String(mode === "edit" ? serviceDraft?.categoryId || "" : selectedServiceLive.categoryId || "")}
                        disabled={mode !== "edit"}
                        options={categories.filter((category) => category.sectionId === String(mode === "edit" ? serviceDraft?.sectionId || selectedServiceLive.sectionId : selectedServiceLive.sectionId)).map((category) => ({ value: category.id, label: category.name }))}
                        onChange={(categoryId) => { const category = categoryById.get(categoryId); setServiceDraft((previous) => previous ? { ...previous, categoryId, sectionId: String(category?.sectionId || previous.sectionId || "").trim() } : previous); }}
                      />
                    </Field>
                    <ToggleCard checked={mode === "edit" ? serviceDraft?.active !== false : selectedServiceLive.active !== false} label="الخدمة نشطة" hint="حالة إتاحة الخدمة داخل الكتالوج." disabled={mode !== "edit"} onChange={(active) => setServiceDraft((previous) => previous ? { ...previous, active } : previous)} />
                  </div>
                ) : null}

                {activeTab === "pricing" ? (
                  <div className="settings-catalog-v2-form-grid">
                    <Field label="السعر"><DashboardNumberInputV2 className="dsv2-input" min={0} value={mode === "edit" ? serviceDraft?.price ?? 0 : selectedServiceLive.price} disabled={mode !== "edit"} onChange={(event) => setServiceDraft((previous) => previous ? { ...previous, price: parseNumberInput(event.target.value, previous.price) } : previous)} /></Field>
                    <Field label="المدة (دقيقة)"><DashboardNumberInputV2 className="dsv2-input" min={5} value={mode === "edit" ? serviceDraft?.durationMin ?? 60 : selectedServiceLive.durationMin} disabled={mode !== "edit"} onChange={(event) => setServiceDraft((previous) => previous ? { ...previous, durationMin: parseNumberInput(event.target.value, previous.durationMin) } : previous)} /></Field>
                    <Field label="سعر الموسم"><DashboardNumberInputV2 className="dsv2-input" min={0} value={(mode === "edit" ? serviceDraft?.seasonPrice : selectedServiceLive.seasonPrice) ?? ""} disabled={mode !== "edit"} onChange={(event) => setServiceDraft((previous) => previous ? { ...previous, seasonPrice: event.target.value === "" ? null : parseNumberInput(event.target.value, 0) } : previous)} /></Field>
                  </div>
                ) : null}

                {activeTab === "variants" ? (
                  <DashboardEmptyStateV2 title="Variants" description="هذه المساحة محفوظة لتوسعة أنواع الخدمة لاحقًا." />
                ) : null}

                {activeTab === "audit" ? (
                  <div className="settings-catalog-v2-audit">
                    <div><span>تاريخ الإنشاء</span><strong>{formatTimestamp(selectedServiceLive.createdAt)}</strong></div>
                    <div><span>آخر تحديث</span><strong>{formatTimestamp(selectedServiceLive.updatedAt)}</strong></div>
                    <div><span>Service ID</span><strong dir="ltr">{selectedServiceLive.id}</strong></div>
                    <div><span>Category ID</span><strong dir="ltr">{selectedServiceLive.categoryId || "—"}</strong></div>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        ) : (
          <div className="settings-catalog-v2-detail-loading"><DashboardSkeletonV2 width="100%" height={180} /></div>
        )}
      </DashboardModalV2>
    </main>
  );
}
