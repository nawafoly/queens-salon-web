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
import { settingsText, type DashboardLanguage } from "../../helpers/dashboardSettingsLanguage";

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
  language?: DashboardLanguage;
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

function formatTimestamp(value: any, language: DashboardLanguage = "ar") {
  const milliseconds = toMillisSafe(value);
  if (!milliseconds) return "—";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(milliseconds));
}

function money(value: number, language: DashboardLanguage = "ar") {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    maximumFractionDigits: 2,
  }).format(Math.max(0, Number(value || 0)));
}

function TabButton(props: {
  language?: DashboardLanguage;
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
        <strong>{settingsText(props.language ?? "ar", props.title)}</strong>
        {props.hint ? <small>{settingsText(props.language ?? "ar", props.hint)}</small> : null}
      </span>
    </button>
  );
}

function Field(props: {
  language?: DashboardLanguage;
  label: string;
  children: ReactNode;
  wide?: boolean;
  hint?: string;
}) {
  return (
    <div className={`dsv2-field ${props.wide ? "settings-catalog-v2-field--wide" : ""}`}>
      <span className="dsv2-field__label">{settingsText(props.language ?? "ar", props.label)}</span>
      {props.children}
      {props.hint ? <small className="settings-catalog-v2-field__hint">{settingsText(props.language ?? "ar", props.hint)}</small> : null}
    </div>
  );
}

function ToggleCard(props: {
  language?: DashboardLanguage;
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
        <strong>{settingsText(props.language ?? "ar", props.label)}</strong>
        <small>{settingsText(props.language ?? "ar", props.hint)}</small>
      </span>
      <span className="settings-catalog-v2-toggle__status">
        {settingsText(props.language ?? "ar", props.checked ? "مفعّل" : "متوقف")}
      </span>
    </button>
  );
}

export default function SettingsCatalogV2({ hasAdminPower, language = "ar" }: SettingsCatalogV2Props) {
  const t = (text: string) => settingsText(language, text);
  const [catalogMsg, setCatalogMsg] = useState("");
  const [pendingSectionDeleteId, setPendingSectionDeleteId] = useState<string | null>(null);
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
      { label: t("الأقسام"), value: String(sections.length), hint: t("الوحدات الرئيسية"), tone: "dsv2-metric-card--gold" },
      { label: t("التصنيفات"), value: String(categories.length), hint: t("تصنيفات الخدمات"), tone: "dsv2-metric-card--success" },
      { label: t("الخدمات"), value: String(services.length), hint: t("الخدمات التشغيلية"), tone: "dsv2-metric-card--dark" },
      { label: t("الباقات"), value: String(packages.length), hint: t("باقات الجلسات"), tone: "dsv2-metric-card--danger" },
    ],
    [categories.length, language, packages.length, sections.length, services.length],
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
        CoreAdminCatalogService.listSections(),
        CoreAdminCatalogService.listCategories(),
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
      showMsg(t("❌ تعذر تحميل الكتالوج"), 3000);
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
    if (!name) { showMsg(t("❌ اسم القسم لا يمكن يكون فارغ"), 2000); return false; }
    try {
      setSecLoading(true);
      await CoreAdminCatalogService.patchSection(row.id, { name, active: row.active !== false, sortOrder: Number(row.order || 0) });
      showMsg(t("✅ تم حفظ القسم"));
      return true;
    } catch (error) {
      console.error("saveSectionRow error:", error); showMsg(t("❌ تعذر حفظ القسم"), 2500); return false;
    } finally { setSecLoading(false); }
  };

  const saveServiceRow = async (row: ServiceRow) => {
    const name = String(row.name || "").trim();
    if (!name) { showMsg(t("❌ اسم الخدمة لا يمكن يكون فارغ"), 2000); return false; }
    const categoryId = String(row.categoryId || "").trim();
    const category = categories.find((item) => item.id === categoryId);
    const sectionId = String(category?.sectionId || "").trim();
    if (!categoryId || !sectionId) { showMsg(t("❌ الخدمة لازم تكون مرتبطة بتصنيف وقسم"), 2000); return false; }
    try {
      setSrvLoading(true);
      await CoreCatalogService.patchService(row.id, {
        categoryId, sectionId, name, durationMinutes: Math.max(5, Number(row.durationMin || 0)),
        priceHalalas: Math.round(Math.max(0, Number(row.price || 0)) * 100),
        seasonPriceHalalas: row.seasonPrice == null || String(row.seasonPrice) === "" ? null : Math.round(Math.max(0, Number(row.seasonPrice)) * 100),
        active: row.active !== false,
      });
      showMsg(t("✅ تم حفظ الخدمة"));
      return true;
    } catch (error) { console.error("saveServiceRow error:", error); showMsg(t("❌ تعذر حفظ الخدمة"), 2500); return false; }
    finally { setSrvLoading(false); }
  };

  const createSection = async () => {
    const name = newSection.name.trim();
    if (!name) return showMsg(t("❌ اسم القسم مطلوب"), 2000);
    const id = buildId(name);
    if (!id) return showMsg(t("❌ تعذر توليد ID للقسم"), 2200);
    try {
      setSecLoading(true);
      await CoreAdminCatalogService.createSection({ name, active: newSection.active !== false, sortOrder: Number(newSection.order || 0) });
      showMsg(t("✅ تم إنشاء القسم")); await loadCatalog(); setActiveListMode("sections"); setComposerMode(null); setNewSection({ name: "", order: nextSectionOrder, active: true });
    } catch (error) { console.error("createSection error:", error); showMsg(t("❌ تعذر إنشاء القسم"), 2500); }
    finally { setSecLoading(false); }
  };

  const deleteSection = async (id: string) => {
    if (services.some((service) => String(service.sectionId || "").trim() === id)) return showMsg(t("❌ لا يمكن حذف القسم لأن عليه خدمات. انقليها أولًا."), 3200);
    if (categories.some((category) => String(category.sectionId || "").trim() === id)) return showMsg(t("❌ لا يمكن حذف القسم لأن عليه تصنيفات."), 3200);
    setPendingSectionDeleteId(id);
    return;
  };

  const confirmDeleteSection = async () => {
    const id = pendingSectionDeleteId;
    if (!id) return;
    try { setSecLoading(true); await CoreAdminCatalogService.removeSection(id); showMsg(t("✅ تم حذف القسم")); await loadCatalog(); setSelectedId(null); }
    catch (error) { console.error("deleteSection error:", error); showMsg(t("❌ تعذر حذف القسم"), 2500); }
    finally { setSecLoading(false); }
  };

  const createCategory = async () => {
    const sectionId = selectedSectionId; const name = newCategoryName.trim();
    if (!sectionId) return showMsg(t("❌ اختر قسمًا أولًا"), 2200);
    if (!name) return showMsg(t("❌ اسم التصنيف مطلوب"), 2200);
    const id = buildId(`${sectionId}_${name}`);
    try {
      setCatLoading(true);
      const rows = categories.filter((row) => String(row.sectionId || "").trim() === sectionId);
      const nextOrder = rows.length ? Math.max(...rows.map((row) => Number(row.order || 0))) + 1 : 1;
      await CoreAdminCatalogService.createCategory({ id, sectionId, name, active: true, sortOrder: nextOrder });
      showMsg(t("✅ تم إضافة التصنيف")); setNewCategoryName(""); await loadCatalog(); setActiveCategoryId(id);
    } catch (error) { console.error("createCategory error:", error); showMsg(t("❌ تعذر إضافة التصنيف"), 2500); }
    finally { setCatLoading(false); }
  };

  const saveCategory = async (row: CategoryRow) => {
    const name = row.name.trim(); if (!name) return showMsg(t("❌ اسم التصنيف لا يمكن يكون فارغ"), 2000);
    try { setCatLoading(true); await CoreAdminCatalogService.patchCategory(row.id, { name, active: row.active !== false, sortOrder: Number(row.order || 0) }); showMsg(t("✅ تم حفظ التصنيف")); await loadCatalog(); }
    catch (error) { console.error("saveCategory error:", error); showMsg(t("❌ تعذر حفظ التصنيف"), 2500); }
    finally { setCatLoading(false); }
  };

  const deleteCategory = async (id: string) => {
    if (services.some((service) => String(service.categoryId || "").trim() === id)) return showMsg(t("❌ لا يمكن حذف التصنيف لأن عليه خدمات."), 3000);
    if (!window.confirm(t("هل أنت متأكد من حذف هذا التصنيف؟"))) return;
    try { setCatLoading(true); await CoreAdminCatalogService.removeCategory(id); showMsg(t("✅ تم حذف التصنيف")); await loadCatalog(); }
    catch (error) { console.error("deleteCategory error:", error); showMsg(t("❌ تعذر حذف التصنيف"), 2500); }
    finally { setCatLoading(false); }
  };

  const startServiceComposer = (sectionId?: string, categoryId?: string) => {
    const resolvedSectionId = String(sectionId || selectedSectionId || sections[0]?.id || "").trim();
    if (!resolvedSectionId) return showMsg(t("❌ اختر قسمًا أولًا"), 2200);
    const sectionCategories = categories
      .filter((row) => String(row.sectionId || "").trim() === resolvedSectionId)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
    const preferredCategoryId = String(categoryId || "").trim();
    const resolvedCategoryId = preferredCategoryId && sectionCategories.some((row) => row.id === preferredCategoryId)
      ? preferredCategoryId
      : String(sectionCategories[0]?.id || "").trim();
    if (!resolvedCategoryId) return showMsg(t("❌ أضف تصنيفًا أولًا قبل إضافة خدمة"), 2600);
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
    if (!name) return showMsg(t("❌ اسم الخدمة مطلوب"), 2000); if (!categoryId) return showMsg(t("❌ اختر تصنيفًا أولًا"), 2200);
    const category = categories.find((row) => row.id === categoryId); const sectionId = String(category?.sectionId || "").trim();
    if (!sectionId) return showMsg(t("❌ التصنيف المختار غير صالح"), 2200); const id = buildId(`${categoryId}_${name}`);
    try {
      setSrvLoading(true);
      await CoreCatalogService.createService({ id, categoryId, sectionId, name, durationMinutes: Math.max(5, Number(newService.durationMin || 60)), priceHalalas: Math.round(Math.max(0, Number(newService.price || 0)) * 100), seasonPriceHalalas: newService.seasonPrice == null || String(newService.seasonPrice) === "" ? null : Math.round(Math.max(0, Number(newService.seasonPrice)) * 100), active: newService.active !== false });
      showMsg(language === "en" ? `✅ Service added (id: ${id})` : `✅ تم إضافة الخدمة (id: ${id})`); await loadCatalog(); setComposerMode(null); setActiveCategoryId(categoryId); setOpenedServiceId(id); setNewService({ sectionId: "", categoryId: "", name: "", durationMin: 60, price: 0, seasonPrice: null, active: true });
    } catch (error) { console.error("createService error:", error); showMsg(t("❌ تعذر إضافة الخدمة"), 2500); }
    finally { setSrvLoading(false); }
  };

  const deleteService = async (id: string, clearSelection = false) => {
    if (!window.confirm(t("هل أنت متأكد من أرشفة هذه الخدمة؟"))) return false;
    try { setSrvLoading(true); await CoreCatalogService.archiveService(id); showMsg(t("✅ تم أرشفة الخدمة")); await loadCatalog(); if (clearSelection) setSelectedId(null); if (openedServiceId === id) setOpenedServiceId(null); return true; }
    catch (error) { console.error("deleteService error:", error); showMsg(t("❌ تعذر أرشفة الخدمة"), 2500); return false; }
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

    if (!name) return showMsg(t("اسم الباقة مطلوب"), 2200);
    if (!serviceIds.length) return showMsg(t("اختاري خدمة واحدة على الأقل داخل الباقة"), 2200);
    if (sessionsCount <= 0) return showMsg(t("عدد الجلسات يجب أن يكون أكبر من صفر"), 2200);
    if (packageStartsAt && packageEndsAt && packageStartsAt > packageEndsAt) return showMsg(t("تاريخ بداية الباقة يجب أن يسبق تاريخ النهاية"), 2400);
    if (packageAudienceScope === "specific" && !targetClientIds.length) return showMsg(t("أدخلي معرف عميلة واحدة على الأقل للاستهداف المحدد"), 2600);

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
        showMsg(t("تم تحديث الباقة"));
      } else {
        await PackageService.add(payload);
        showMsg(t("تم إنشاء الباقة"));
      }
      await loadCatalog();
      resetPackageForm();
    } catch (error) {
      console.error("savePackage_failed", error);
      showMsg(editingPackageId ? t("تعذر تحديث الباقة") : t("تعذر إنشاء الباقة"), 2800);
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
      showMsg(pkg.active ? t("تم تعطيل الباقة") : t("تم تفعيل الباقة"));
      await loadCatalog();
      if (editingPackageId === pkg.id) setPackageActive(!pkg.active);
    } catch (error) {
      console.error("togglePackageActive_failed", error);
      showMsg(t("تعذر تحديث حالة الباقة"), 2500);
    } finally {
      setPkgLoading(false);
    }
  };

  const deletePackage = async (pkg: PackageRow) => {
    if (!window.confirm(t("حذف الباقة؟ إذا كانت مباعة سابقًا فسيتم أرشفتها وإيقاف بيعها مع حفظ سجلات العميلات."))) return;
    try {
      setPkgLoading(true);
      const result = await PackageService.remove(pkg.id);
      showMsg(result?.archived ? t("تمت أرشفة الباقة لأنها مرتبطة بمبيعات") : t("تم حذف الباقة"));
      if (editingPackageId === pkg.id) resetPackageForm();
      await loadCatalog();
    } catch (error) {
      console.error("deletePackageCatalog_failed", error);
      showMsg(t("تعذر حذف الباقة"), 2600);
    } finally {
      setPkgLoading(false);
    }
  };

  const saveSeasonPricing = async () => {
    const from = seasonPricingFrom.trim();
    const to = seasonPricingTo.trim();
    if (seasonPricingEnabled && (!from || !to)) return showMsg(t("❌ حددي تاريخ (من/إلى) لموسم الأسعار"), 2200);
    if (seasonPricingEnabled && from > to) return showMsg(t("❌ تاريخ (من) لازم يكون قبل أو يساوي (إلى)"), 2200);
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
      showMsg(t("✅ تم حفظ موسم الأسعار"));
    } catch (error) {
      console.error("saveSeasonPricing error:", error);
      showMsg(t("❌ تعذر حفظ موسم الأسعار"), 2500);
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
    if (!service) return showMsg(t("تعذر فتح الخدمة للتعديل"), 2200);
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
      <main className="dsv2-page settings-catalog-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <DashboardEmptyStateV2
          tone="gold"
          title={t("غير مصرح")}
          description={t("هذه الصفحة مخصصة للإدارة (Owner/Admin).")}
        />
    </main>
    );
  }

  const sectionOptions = sections.map((section) => ({ value: section.id, label: section.name }));
  const statusOptions = [
    { value: "all", label: t("كل الحالات") },
    { value: "active", label: t("نشط") },
    { value: "inactive", label: t("غير نشط") },
  ];

  const selectedLive = activeListMode === "sections" ? selectedSectionLive : selectedServiceLive;
  const selectedActive = selectedLive?.active !== false;
  const openedServiceLive = services.find((service) => service.id === openedServiceId) || null;

  return (
    <main className="dsv2-page settings-catalog-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <section className="dsv2-card settings-catalog-v2-hero">
        <div className="settings-catalog-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">{t("إعدادات الكتالوج")}</span>
          <h1 className="dsv2-page-title">{t("إدارة الكتالوج")}</h1>
          <p className="dsv2-page-subtitle">
            {t("إدارة الأقسام والتصنيفات والخدمات وباقات الجلسات وموسم الأسعار من مساحة واحدة.")}
          </p>
          <div className="settings-catalog-v2-hero__badges">
            <span className="dsv2-badge dsv2-badge--success">{t("تحكم إداري")}</span>
            <span className="dsv2-badge">{services.length} خدمة</span>
          </div>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--secondary"
          disabled={busy}
          onClick={() => void Promise.all([loadCatalog(), loadSeasonSettings()])}
        >
          {busy ? t("جاري التحديث…") : t("تحديث البيانات")}
        </button>
      </section>

      <section className="settings-catalog-v2-metrics" aria-label={t("ملخص الكتالوج")}>
        {catalogStats.map((item) => (
          <article key={item.label} className={`dsv2-metric-card ${item.tone}`}>
            <p className="dsv2-metric-card__label">{item.label}</p>
            <p className="dsv2-metric-card__value">{item.value}</p>
            <p className="dsv2-metric-card__meta">{item.hint}</p>
          </article>
        ))}
      </section>

      <section className="settings-catalog-v2-tabs" aria-label={t("مساحات عمل الكتالوج")}>
        <TabButton language={language} active={activeCatalogPanel === "items"} index="01" title={t("الأقسام والخدمات")} hint={`${sections.length} ${t("قسم")} / ${services.length} ${t("خدمة")}`} onClick={() => { setActiveCatalogPanel("items"); setComposerMode(null); }} />
        <TabButton language={language} active={activeCatalogPanel === "packages"} index="02" title={t("باقات الجلسات")} hint={`${packages.length} ${t("باقة")}`} onClick={() => { setActiveCatalogPanel("packages"); setComposerMode(null); }} />
        <TabButton language={language} active={activeCatalogPanel === "season"} index="03" title={t("موسم الأسعار")} hint={seasonPricingEnabled ? t("مفعّل حاليًا") : t("غير مفعّل")} onClick={() => { setActiveCatalogPanel("season"); setComposerMode(null); }} />
      </section>

      {catalogMsg ? (
        <div className={`settings-catalog-v2-notice ${catalogMsg.includes("❌") || catalogMsg.includes("تعذر") || catalogMsg.includes("Could not") ? "is-error" : "is-success"}`} role="status">
          {catalogMsg}
        </div>
      ) : null}

      {activeCatalogPanel === "items" ? (
        <section className="settings-catalog-v2-workspace">
          <aside className="dsv2-card dsv2-card--padded settings-catalog-v2-list-panel">
            <div className="settings-catalog-v2-mode-tabs">
              <button type="button" className={`settings-catalog-v2-mode ${activeListMode === "sections" ? "is-active" : ""}`} onClick={() => openListMode("sections")}>{t("الأقسام")} <span>{filteredSections.length}</span></button>
              <button type="button" className={`settings-catalog-v2-mode ${activeListMode === "services" ? "is-active" : ""}`} onClick={() => openListMode("services")}>{t("الخدمات")} <span>{filteredServices.length}</span></button>
            </div>

            <div className="settings-catalog-v2-filters">
              <input
                className="dsv2-input settings-catalog-v2-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeListMode === "sections" ? t("بحث في الأقسام…") : t("بحث في الخدمات أو التصنيف…")}
              />
              <DashboardSelectV2
                value={statusFilter}
                options={statusOptions}
                onChange={(value) => setStatusFilter(value as FilterStatus)}
              />
              {activeListMode === "services" ? (
                <DashboardSelectV2
                  value={serviceSectionFilter}
                  options={[{ value: "all", label: t("كل الأقسام") }, ...sectionOptions]}
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
                {activeListMode === "sections" ? t("+ إضافة قسم") : t("+ إضافة خدمة")}
              </button>
            </div>

            {composerMode === "section" ? (
              <div className="settings-catalog-v2-composer">
                <div className="settings-catalog-v2-composer__head">
                  <strong>{t("إضافة قسم جديد")}</strong>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setComposerMode(null)}>{t("إلغاء")}</button>
                </div>
                <div className="settings-catalog-v2-form-grid">
                  <Field language={language} label={t("اسم القسم")} wide>
                    <input className="dsv2-input" value={newSection.name} onChange={(event) => setNewSection((previous) => ({ ...previous, name: event.target.value }))} />
                  </Field>
                  <Field language={language} label={t("الترتيب")}>
                    <DashboardNumberInputV2 className="dsv2-input" value={newSection.order} onChange={(event) => setNewSection((previous) => ({ ...previous, order: Number(event.target.value || 0) }))} />
                  </Field>
                </div>
                <ToggleCard language={language} checked={newSection.active} label={t("القسم نشط")} hint={t("يظهر ضمن الكتالوج عند التفعيل.")} onChange={(active) => setNewSection((previous) => ({ ...previous, active }))} />
                <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={secLoading} onClick={() => void createSection()}>{t("إنشاء القسم")}</button>
              </div>
            ) : null}

            {composerMode === "service" && activeListMode === "services" ? (
              <div className="settings-catalog-v2-composer">
                <div className="settings-catalog-v2-composer__head">
                  <strong>{t("إضافة خدمة جديدة")}</strong>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setComposerMode(null)}>{t("إلغاء")}</button>
                </div>
                <div className="settings-catalog-v2-form-grid">
                  <Field language={language} label={t("القسم")}>
                    <DashboardSelectV2
                      value={newService.sectionId}
                      placeholder={t("اختر القسم")}
                      options={sectionOptions}
                      onChange={(sectionId) => {
                        const availableCategories = categories.filter((category) => category.sectionId === sectionId).sort((a, b) => a.order - b.order);
                        setNewService((previous) => ({ ...previous, sectionId, categoryId: availableCategories[0]?.id || "" }));
                      }}
                    />
                  </Field>
                  <Field language={language} label={t("التصنيف")}>
                    <DashboardSelectV2
                      value={newService.categoryId}
                      placeholder={t("اختر التصنيف")}
                      options={composerCategories.map((category) => ({ value: category.id, label: category.name }))}
                      onChange={(categoryId) => setNewService((previous) => ({ ...previous, categoryId }))}
                    />
                  </Field>
                  <Field language={language} label={t("اسم الخدمة")} wide>
                    <input className="dsv2-input" value={newService.name} onChange={(event) => setNewService((previous) => ({ ...previous, name: event.target.value }))} />
                  </Field>
                  <Field language={language} label={t("المدة (دقيقة)")}>
                    <DashboardNumberInputV2 className="dsv2-input" min={5} value={newService.durationMin} onChange={(event) => setNewService((previous) => ({ ...previous, durationMin: parseNumberInput(event.target.value, previous.durationMin) }))} />
                  </Field>
                  <Field language={language} label={t("السعر")}>
                    <DashboardNumberInputV2 className="dsv2-input" min={0} value={newService.price} onChange={(event) => setNewService((previous) => ({ ...previous, price: parseNumberInput(event.target.value, previous.price) }))} />
                  </Field>
                  <Field language={language} label={t("سعر الموسم")}>
                    <DashboardNumberInputV2 className="dsv2-input" min={0} value={newService.seasonPrice ?? ""} onChange={(event) => setNewService((previous) => ({ ...previous, seasonPrice: event.target.value === "" ? null : parseNumberInput(event.target.value, Number(previous.seasonPrice || 0)) }))} />
                  </Field>
                </div>
                <ToggleCard language={language} checked={newService.active} label={t("الخدمة نشطة")} hint={t("تكون متاحة للعرض والحجز.")} onChange={(active) => setNewService((previous) => ({ ...previous, active }))} />
                <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={srvLoading || !newService.categoryId} onClick={() => void createService()}>{t("إنشاء الخدمة")}</button>
              </div>
            ) : null}

            <div className="settings-catalog-v2-list-title">
              <strong>{activeListMode === "sections" ? t("الأقسام") : t("الخدمات")}</strong>
              <span>{activeListMode === "sections" ? filteredSections.length : filteredServices.length} {t("نتيجة")}</span>
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
                      <span className={`dsv2-badge ${section.active ? "dsv2-badge--success" : ""}`}>{section.active ? t("نشط") : t("معطل")}</span>
                    </span>
                  </button>
                )) : <DashboardEmptyStateV2 title={t("لا توجد أقسام مطابقة")} description={t("غيّر البحث أو الفلاتر الحالية.")} />
              ) : (
                filteredServices.length ? filteredServices.map((service) => (
                  <button key={service.id} type="button" className={`settings-catalog-v2-row ${selectedId === service.id ? "is-selected" : ""}`} onClick={() => setSelectedId(service.id)}>
                    <span className="settings-catalog-v2-row__copy">
                      <strong>{service.name}</strong>
                      <small>{sectionById.get(service.sectionId)?.name || "قسم غير محدد"} · {categoryById.get(service.categoryId)?.name || "بدون تصنيف"}</small>
                    </span>
                    <span className="settings-catalog-v2-row__meta">
                      <span>{service.durationMin} {t("دقيقة")}</span>
                      <span>{money(service.price, language)} {language === "en" ? "SAR" : "ر.س"}</span>
                      <span className={`dsv2-badge ${service.active ? "dsv2-badge--success" : ""}`}>{service.active ? t("نشط") : t("معطل")}</span>
                    </span>
                  </button>
                )) : <DashboardEmptyStateV2 title={t("لا توجد خدمات مطابقة")} description={t("غيّر البحث أو الفلاتر الحالية.")} />
              )}
            </div>
          </aside>

          <section className="dsv2-card dsv2-card--padded settings-catalog-v2-summary-panel">
            <span className="dsv2-badge dsv2-badge--gold">{t("المعاينة")}</span>
            <h2>{activeListMode === "sections" ? "إدارة الأقسام والتصنيفات" : "إدارة الخدمات"}</h2>
            <p>{t("اختر عنصرًا من القائمة لفتح نافذة التفاصيل الكاملة، التعديل، التعطيل أو الحذف.")}</p>
            <div className="settings-catalog-v2-summary-grid">
              <div><span>{t("المعروض")}</span><strong>{activeListMode === "sections" ? filteredSections.length : filteredServices.length}</strong></div>
              <div><span>{t("النشط")}</span><strong>{activeListMode === "sections" ? filteredSections.filter((row) => row.active).length : filteredServices.filter((row) => row.active).length}</strong></div>
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
              <p>{t("حدد محتوى الباقة، الخدمات المسموحة، فترة الإتاحة وحالة البيع.")}</p>
            </div>
            {editingPackageId ? <span className="dsv2-badge dsv2-badge--gold">تعديل: {editingPackageId}</span> : null}
          </header>

          <div className="settings-catalog-v2-form-grid settings-catalog-v2-form-grid--packages">
            <Field language={language} label={t("اسم الباقة")} wide><input className="dsv2-input" value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder={t("مثال: استشوار 10 جلسات")} /></Field>
            <Field language={language} label={t("الوصف")} wide><textarea className="dsv2-input settings-catalog-v2-textarea" rows={3} value={packageDescription} onChange={(event) => setPackageDescription(event.target.value)} /></Field>
            <Field language={language} label={t("عدد الجلسات")}><DashboardNumberInputV2 className="dsv2-input" min={1} value={packageSessionsCount} onChange={(event) => setPackageSessionsCount(Number(event.target.value))} /></Field>
            <Field language={language} label={t("السعر")}><DashboardNumberInputV2 className="dsv2-input" min={0} value={packagePrice} onChange={(event) => setPackagePrice(Number(event.target.value))} /></Field>
            <Field language={language} label={t("مدة الصلاحية بالأيام")}><DashboardNumberInputV2 className="dsv2-input" min={1} value={packageValidityDays} onChange={(event) => setPackageValidityDays(event.target.value)} placeholder={t("بدون انتهاء")} /></Field>
            <Field language={language} label={t("ترتيب العرض")}><DashboardNumberInputV2 className="dsv2-input" min={0} value={packageSortOrder} onChange={(event) => setPackageSortOrder(Number(event.target.value))} /></Field>
            <Field language={language} label={t("رابط صورة الباقة")} wide><input className="dsv2-input" value={packageImageUrl} onChange={(event) => setPackageImageUrl(event.target.value)} placeholder="https://..." /></Field>
            <Field language={language} label={t("بداية الإتاحة")}><DashboardDatePickerV2 value={packageStartsAt} onChange={setPackageStartsAt} /></Field>
            <Field language={language} label={t("نهاية الإتاحة")}><DashboardDatePickerV2 value={packageEndsAt} onChange={setPackageEndsAt} /></Field>
            <Field language={language} label={t("إتاحة الباقة")}><DashboardSelectV2 value={packageAudienceScope} options={[{ value: "all", label: t("جميع العميلات") }, { value: "specific", label: t("عميلات محددات") }]} onChange={(value) => setPackageAudienceScope(value === "specific" ? "specific" : "all")} /></Field>
            <Field language={language} label={t("شروط الاستخدام")} wide><textarea className="dsv2-input settings-catalog-v2-textarea" rows={3} value={packageTerms} onChange={(event) => setPackageTerms(event.target.value)} /></Field>
            {packageAudienceScope === "specific" ? <Field language={language} label={t("معرفات العميلات المستهدفات")} wide><textarea className="dsv2-input settings-catalog-v2-textarea" rows={3} value={packageTargetClientIdsText} onChange={(event) => setPackageTargetClientIdsText(event.target.value)} placeholder={t("clientId أو Firebase UID مفصولة بفواصل")} /></Field> : null}
          </div>

          <div className="settings-catalog-v2-toggle-grid">
            <ToggleCard language={language} checked={packageSaleEnabled} label={t("متاحة للبيع")} hint={t("يمكن إيقاف البيع مع إبقاء الباقة في السجلات.")} onChange={setPackageSaleEnabled} />
            <ToggleCard language={language} checked={packageActive} label={t("الباقة مفعلة")} hint={t("تظهر في الحجز عند التفعيل.")} onChange={setPackageActive} />
          </div>

          <div className="settings-catalog-v2-picker">
            <header className="settings-catalog-v2-picker__head">
              <div><strong>{t("الخدمات داخل الباقة")}</strong><span>{selectedPackageServiceIds.length} {t("خدمة مختارة")} · {money(packageSelectionTotal, language)} {language === "en" ? "SAR" : "ر.س"} {t("مجموع الأسعار")}</span></div>
              <div className="settings-catalog-v2-picker__head-actions">
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!filteredPackageServices.length} onClick={() => setPackageServiceIds((previous) => normalizePackageServiceIds([...previous, ...filteredPackageServices.map((service) => service.id)]))}>{t("تحديد الظاهر")}</button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!selectedPackageServiceIds.length} onClick={() => { setPackageServiceIds([]); setPackageServiceView("all"); }}>{t("مسح الاختيار")}</button>
              </div>
            </header>

            <div className="settings-catalog-v2-picker__filters">
              <input className="dsv2-input" value={packageServiceSearch} onChange={(event) => setPackageServiceSearch(event.target.value)} placeholder={t("ابحث باسم الخدمة أو القسم أو التصنيف…")} />
              <DashboardSelectV2 value={packageServiceSectionFilter} options={[{ value: "all", label: t("كل الأقسام") }, ...sectionOptions]} onChange={setPackageServiceSectionFilter} />
              <div className="settings-catalog-v2-segmented">
                <button type="button" className={packageServiceView === "all" ? "is-active" : ""} onClick={() => setPackageServiceView("all")}>{t("كل الخدمات")}</button>
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
                      <span className="settings-catalog-v2-service-option__meta">{service.durationMin} {language === "en" ? "min" : "د"} · {money(service.price, language)} {language === "en" ? "SAR" : "ر.س"}</span>
                    </button>
                  );
                }) : <DashboardEmptyStateV2 title={t("لا توجد خدمات مطابقة")} description={t("عدّل البحث أو الفلاتر.")} />}
              </div>

              <aside className="settings-catalog-v2-selected-services">
                <header><strong>{t("الخدمات المختارة")}</strong><span>{selectedPackageServices.length}</span></header>
                {selectedPackageServices.length ? selectedPackageServices.map((service) => (
                  <div key={service.id} className="settings-catalog-v2-selected-service">
                    <div><strong>{service.name}</strong><small>{money(service.price, language)} {language === "en" ? "SAR" : "ر.س"} · {service.durationMin} {language === "en" ? "min" : "د"}</small></div>
                    <div>
                      <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => openServiceFromPackage(service.id)}>{t("تعديل الخدمة")}</button>
                      <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => togglePackageService(service.id)}>{t("إزالة")}</button>
                    </div>
                  </div>
                )) : <p className="settings-catalog-v2-muted">{t("اختر خدمة من القائمة وستظهر هنا.")}</p>}
              </aside>
            </div>
          </div>

          <div className="settings-catalog-v2-panel-actions">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={resetPackageForm}>{editingPackageId ? t("إلغاء التعديل") : t("تنظيف")}</button>
            <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={packageSaving} onClick={() => void savePackage()}>{packageSaving ? t("جاري الحفظ…") : editingPackageId ? t("حفظ تعديل الباقة") : t("إنشاء الباقة")}</button>
          </div>

          <div className="settings-catalog-v2-package-list">
            <div className="settings-catalog-v2-list-title"><strong>{t("الباقات الحالية")}</strong><span>{packages.length} باقة</span></div>
            {packages.length ? packages.map((pkg) => {
              const linkedNames = normalizePackageServiceIds(pkg.serviceIds).map((serviceId) => serviceById.get(serviceId)?.name || `${t("خدمة غير موجودة")} (${serviceId})`);
              return (
                <article key={pkg.id} className={`settings-catalog-v2-package-card ${editingPackageId === pkg.id ? "is-editing" : ""}`}>
                  <div className="settings-catalog-v2-package-card__copy">
                    <div className="settings-catalog-v2-package-card__title"><strong>{pkg.name}</strong><span className={`dsv2-badge ${pkg.active ? "dsv2-badge--success" : ""}`}>{pkg.active ? t("نشط") : t("معطل")}</span></div>
                    <small>ID: {pkg.id}</small>
                    {pkg.description ? <p>{pkg.description}</p> : null}
                    <p>الخدمات: {linkedNames.join(language === "en" ? ", " : "، ")}</p>
                  </div>
                  <div className="settings-catalog-v2-package-card__meta">
                    <span>{pkg.sessionsCount} {t("جلسات")}</span><span>{money(pkg.price, language)} {language === "en" ? "SAR" : "ر.س"}</span><span>{pkg.validityDays ? `${pkg.validityDays} ${t("يوم")}` : t("بدون انتهاء")}</span><span>{pkg.saleEnabled ? t("متاحة للبيع") : t("البيع موقوف")}</span>
                  </div>
                  <div className="settings-catalog-v2-package-card__actions">
                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => startPackageEdit(pkg)}>{t("تعديل الباقة")}</button>
                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void togglePackageActive(pkg)}>{pkg.active ? t("تعطيل") : t("تفعيل")}</button>
                    <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void deletePackage(pkg)}>{t("حذف/أرشفة")}</button>
                  </div>
                </article>
              );
            }) : <DashboardEmptyStateV2 title={t("لا توجد باقات حتى الآن")} description={t("أنشئ أول باقة من النموذج أعلاه.")} />}
          </div>
        </section>
      ) : null}

      {activeCatalogPanel === "season" ? (
        <section className="dsv2-card dsv2-card--padded settings-catalog-v2-panel settings-catalog-v2-season">
          <header className="settings-catalog-v2-panel__head">
            <div><span className="settings-catalog-v2-panel__eyebrow">03</span><h2>{t("موسم الأسعار")}</h2><p>{t("حدد فترة الموسم لتفعيل الأسعار الموسمية للخدمات.")}</p></div>
            <span className={`dsv2-badge ${seasonPricingEnabled ? "dsv2-badge--success" : ""}`}>{seasonPricingEnabled ? t("مفعّل") : t("متوقف")}</span>
          </header>
          <ToggleCard language={language} checked={seasonPricingEnabled} label={t("تفعيل موسم الأسعار")} hint={t("عند التفعيل تستخدم الخدمات سعر الموسم داخل الفترة المحددة.")} onChange={setSeasonPricingEnabled} />
          <div className="settings-catalog-v2-form-grid settings-catalog-v2-season__dates">
            <Field language={language} label={t("من تاريخ")}><DashboardDatePickerV2 value={seasonPricingFrom} disabled={!seasonPricingEnabled} onChange={setSeasonPricingFrom} /></Field>
            <Field language={language} label={t("إلى تاريخ")}><DashboardDatePickerV2 value={seasonPricingTo} disabled={!seasonPricingEnabled} onChange={setSeasonPricingTo} /></Field>
          </div>
          <div className="settings-catalog-v2-panel-actions">
            <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={seasonLoading} onClick={() => void saveSeasonPricing()}>{seasonLoading ? "جاري الحفظ…" : "حفظ موسم الأسعار"}</button>
          </div>
        </section>
      ) : null}

      <DashboardModalV2
        open={Boolean(selectedLive)}
        onClose={() => { setSelectedId(null); setMode("view"); setOpenedServiceId(null); setComposerMode(null); }}
        title={selectedLive?.name || t("تفاصيل الكتالوج")}
        description={activeListMode === "sections" ? t("إدارة بيانات القسم والتصنيفات والخدمات المرتبطة.") : t("إدارة بيانات الخدمة والسعر والمدة.")}
        eyebrow={activeListMode === "sections" ? t("تفاصيل القسم") : t("تفاصيل الخدمة")}
        size="xl"
        tone="gold"
        className="settings-catalog-v2-detail-modal"
        footer={
          <div className="settings-catalog-v2-modal-footer">
            {mode === "edit" ? (
              <>
                <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={cancelEdit}>{t("إلغاء")}</button>
                <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={busy} onClick={() => void saveSelected()}>{t("حفظ التغييرات")}</button>
              </>
            ) : (
              <>
                <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setMode("edit")}>{t("تعديل")}</button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={busy} onClick={() => void toggleSelectedActive()}>{selectedActive ? t("تعطيل") : t("تفعيل")}</button>
                <button type="button" className="dsv2-btn dsv2-btn--danger" disabled={busy} onClick={() => void deleteSelected()}>{t("حذف")}</button>
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
                  <button type="button" className={activeTab === "variants" ? "is-active" : ""} onClick={() => setActiveTab("variants")}>{t("التصنيفات")}</button>
                  <button type="button" className={activeTab === "overview" ? "is-active" : ""} onClick={() => setActiveTab("overview")}>{t("نظرة عامة")}</button>
                  <button type="button" className={activeTab === "audit" ? "is-active" : ""} onClick={() => setActiveTab("audit")}>{t("السجل")}</button>
                </>
              ) : (
                <>
                  <button type="button" className={activeTab === "overview" ? "is-active" : ""} onClick={() => setActiveTab("overview")}>{t("نظرة عامة")}</button>
                  <button type="button" className={activeTab === "pricing" ? "is-active" : ""} onClick={() => setActiveTab("pricing")}>{t("السعر والمدة")}</button>
                  <button type="button" className={activeTab === "variants" ? "is-active" : ""} onClick={() => setActiveTab("variants")}>Variants</button>
                  <button type="button" className={activeTab === "audit" ? "is-active" : ""} onClick={() => setActiveTab("audit")}>{t("السجل")}</button>
                </>
              )}
            </div>

            {activeListMode === "sections" && selectedSectionLive ? (
              <>
                {activeTab === "overview" ? (
                  <div className="settings-catalog-v2-form-grid">
                    <Field language={language} label={t("اسم القسم")}><input className="dsv2-input" value={(mode === "edit" ? sectionDraft?.name : selectedSectionLive.name) || ""} disabled={mode !== "edit"} onChange={(event) => setSectionDraft((previous) => previous ? { ...previous, name: event.target.value } : previous)} /></Field>
                    <Field language={language} label={t("الترتيب")}><DashboardNumberInputV2 className="dsv2-input" value={mode === "edit" ? sectionDraft?.order ?? 0 : selectedSectionLive.order} disabled={mode !== "edit"} onChange={(event) => setSectionDraft((previous) => previous ? { ...previous, order: Number(event.target.value || 0) } : previous)} /></Field>
                    <Field language={language} label="ID"><input className="dsv2-input" value={selectedSectionLive.id} disabled /></Field>
                    <ToggleCard language={language} checked={mode === "edit" ? sectionDraft?.active !== false : selectedSectionLive.active !== false} label={t("القسم نشط")} hint={t("حالة ظهور القسم داخل الكتالوج.")} disabled={mode !== "edit"} onChange={(active) => setSectionDraft((previous) => previous ? { ...previous, active } : previous)} />
                  </div>
                ) : null}

                {activeTab === "variants" ? (
                  <div className="settings-catalog-v2-categories">
                    <div className="settings-catalog-v2-inline-create">
                      <input className="dsv2-input" value={newCategoryName} disabled={mode !== "edit"} onChange={(event) => setNewCategoryName(event.target.value)} placeholder={t("اسم تصنيف جديد")} onKeyDown={(event) => { if (event.key === "Enter" && mode === "edit") void createCategory(); }} />
                      <button type="button" className="dsv2-btn dsv2-btn--accent" disabled={mode !== "edit" || catLoading} onClick={() => void createCategory()}>{t("إضافة تصنيف")}</button>
                    </div>

                    {categoriesInSection.length ? categoriesInSection.map((category) => (
                      <article key={category.id} className={`settings-catalog-v2-category-card ${activeCategoryId === category.id ? "is-active" : ""}`}>
                        <div className="settings-catalog-v2-category-card__fields">
                          <input className="dsv2-input" value={category.name} disabled={mode !== "edit"} onChange={(event) => setCategories((previous) => previous.map((row) => row.id === category.id ? { ...row, name: event.target.value } : row))} />
                          <DashboardNumberInputV2 className="dsv2-input settings-catalog-v2-category-order" value={category.order} disabled={mode !== "edit"} onChange={(event) => setCategories((previous) => previous.map((row) => row.id === category.id ? { ...row, order: Number(event.target.value || 0) } : row))} />
                          <button type="button" className={`dsv2-btn dsv2-btn--sm ${category.active ? "dsv2-btn--success" : "dsv2-btn--secondary"}`} disabled={mode !== "edit"} aria-pressed={category.active} onClick={() => setCategories((previous) => previous.map((row) => row.id === category.id ? { ...row, active: !row.active } : row))}>{category.active ? t("نشط") : t("معطل")}</button>
                          <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => { setActiveCategoryId(category.id); setOpenedServiceId(null); }}>الخدمات ({services.filter((service) => service.categoryId === category.id).length})</button>
                          <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={mode !== "edit"} onClick={() => void saveCategory(category)}>{t("حفظ")}</button>
                          <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={mode !== "edit"} onClick={() => void deleteCategory(category.id)}>{t("حذف")}</button>
                        </div>
                      </article>
                    )) : <DashboardEmptyStateV2 title={t("لا توجد تصنيفات")} description={t("حوّل القسم إلى وضع التعديل ثم أضف أول تصنيف.")} />}

                    {activeCategoryId ? (
                      <section className="settings-catalog-v2-category-services">
                        <header>
                          <div><strong>{t("خدمات التصنيف")}: {categoryById.get(activeCategoryId)?.name || "—"}</strong><span>{servicesInActiveCategory.length} {t("خدمة")}</span></div>
                          <button type="button" className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" disabled={mode !== "edit"} onClick={() => startServiceComposer(selectedSectionLive.id, activeCategoryId)}>{t("+ إضافة خدمة")}</button>
                        </header>

                        {composerMode === "service" ? (
                          <div className="settings-catalog-v2-composer">
                            <div className="settings-catalog-v2-form-grid">
                              <Field language={language} label={t("اسم الخدمة")} wide><input className="dsv2-input" value={newService.name} onChange={(event) => setNewService((previous) => ({ ...previous, name: event.target.value }))} /></Field>
                              <Field language={language} label={t("المدة (دقيقة)")}><DashboardNumberInputV2 className="dsv2-input" min={5} value={newService.durationMin} onChange={(event) => setNewService((previous) => ({ ...previous, durationMin: parseNumberInput(event.target.value, previous.durationMin) }))} /></Field>
                              <Field language={language} label={t("السعر")}><DashboardNumberInputV2 className="dsv2-input" min={0} value={newService.price} onChange={(event) => setNewService((previous) => ({ ...previous, price: parseNumberInput(event.target.value, previous.price) }))} /></Field>
                              <Field language={language} label={t("سعر الموسم")}><DashboardNumberInputV2 className="dsv2-input" min={0} value={newService.seasonPrice ?? ""} onChange={(event) => setNewService((previous) => ({ ...previous, seasonPrice: event.target.value === "" ? null : parseNumberInput(event.target.value, Number(previous.seasonPrice || 0)) }))} /></Field>
                            </div>
                            <ToggleCard language={language} checked={newService.active} label={t("الخدمة نشطة")} hint={t("تكون متاحة للعرض والحجز بعد الإنشاء.")} onChange={(active) => setNewService((previous) => ({ ...previous, active }))} />
                            <div className="settings-catalog-v2-panel-actions">
                              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setComposerMode(null)}>{t("إلغاء")}</button>
                              <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" disabled={srvLoading} onClick={() => void createService()}>{t("إنشاء")}</button>
                            </div>
                          </div>
                        ) : null}

                        <div className="settings-catalog-v2-category-services__list">
                          {servicesInActiveCategory.length ? servicesInActiveCategory.map((service) => (
                            <button type="button" key={service.id} className={`settings-catalog-v2-linked-service ${openedServiceId === service.id ? "is-open" : ""}`} onClick={() => { setOpenedServiceId(service.id); setOpenedServiceMode("view"); }}>
                              <span><strong>{service.name}</strong><small>{service.durationMin} {language === "en" ? "min" : "د"} · {money(service.price, language)} {language === "en" ? "SAR" : "ر.س"}</small></span>
                              <span className={`dsv2-badge ${service.active ? "dsv2-badge--success" : ""}`}>{service.active ? t("نشط") : t("معطل")}</span>
                            </button>
                          )) : <p className="settings-catalog-v2-muted">{t("لا توجد خدمات داخل هذا التصنيف.")}</p>}
                        </div>

                        {openedServiceId && openedServiceDraft && openedServiceLive ? (
                          <div className="settings-catalog-v2-opened-service">
                            <header>
                              <div><strong>{t("عرض الخدمة")}</strong><span>{openedServiceId}</span></div>
                              <div>
                                {openedServiceMode === "edit" ? (
                                  <>
                                    <button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={async () => { if (await saveServiceRow(openedServiceDraft)) { await loadCatalog(); setOpenedServiceMode("view"); } }}>{t("حفظ")}</button>
                                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => { setOpenedServiceDraft({ ...openedServiceLive }); setOpenedServiceMode("view"); }}>{t("إلغاء")}</button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => setOpenedServiceMode("edit")}>{t("تعديل")}</button>
                                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={srvLoading} onClick={() => void toggleOpenedServiceActive()}>{openedServiceLive.active ? t("تعطيل") : t("تفعيل")}</button>
                                    <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={srvLoading} onClick={() => void deleteService(openedServiceId, false)}>{t("حذف")}</button>
                                  </>
                                )}
                              </div>
                            </header>
                            <div className="settings-catalog-v2-form-grid">
                              <Field language={language} label={t("اسم الخدمة")}><input className="dsv2-input" value={openedServiceDraft.name} disabled={openedServiceMode !== "edit"} onChange={(event) => setOpenedServiceDraft((previous) => previous ? { ...previous, name: event.target.value } : previous)} /></Field>
                              <Field language={language} label={t("التصنيف")}>
                                <DashboardSelectV2
                                  value={openedServiceDraft.categoryId}
                                  disabled={openedServiceMode !== "edit"}
                                  options={categoriesInSection.map((category) => ({ value: category.id, label: category.name }))}
                                  onChange={(categoryId) => setOpenedServiceDraft((previous) => previous ? { ...previous, categoryId, sectionId: String(categoryById.get(categoryId)?.sectionId || previous.sectionId) } : previous)}
                                />
                              </Field>
                              <Field language={language} label={t("السعر")}><DashboardNumberInputV2 className="dsv2-input" min={0} value={openedServiceDraft.price} disabled={openedServiceMode !== "edit"} onChange={(event) => setOpenedServiceDraft((previous) => previous ? { ...previous, price: parseNumberInput(event.target.value, previous.price) } : previous)} /></Field>
                              <Field language={language} label={t("المدة")}><DashboardNumberInputV2 className="dsv2-input" min={5} value={openedServiceDraft.durationMin} disabled={openedServiceMode !== "edit"} onChange={(event) => setOpenedServiceDraft((previous) => previous ? { ...previous, durationMin: parseNumberInput(event.target.value, previous.durationMin) } : previous)} /></Field>
                              <Field language={language} label={t("سعر الموسم")}><DashboardNumberInputV2 className="dsv2-input" min={0} value={openedServiceDraft.seasonPrice ?? ""} disabled={openedServiceMode !== "edit"} onChange={(event) => setOpenedServiceDraft((previous) => previous ? { ...previous, seasonPrice: event.target.value === "" ? null : parseNumberInput(event.target.value, 0) } : previous)} /></Field>
                              <ToggleCard language={language} checked={openedServiceDraft.active !== false} label={t("الخدمة نشطة")} hint={t("يمكن تغيير حالة الخدمة مع بقية بياناتها.")} disabled={openedServiceMode !== "edit"} onChange={(active) => setOpenedServiceDraft((previous) => previous ? { ...previous, active } : previous)} />
                            </div>
                          </div>
                        ) : null}
                      </section>
                    ) : null}
                  </div>
                ) : null}

                {activeTab === "audit" ? (
                  <div className="settings-catalog-v2-audit">
                    <div><span>{t("تاريخ الإنشاء")}</span><strong>{formatTimestamp(selectedSectionLive.createdAt, language)}</strong></div>
                    <div><span>{t("آخر تحديث")}</span><strong>{formatTimestamp(selectedSectionLive.updatedAt, language)}</strong></div>
                    <div><span>Section ID</span><strong dir="ltr">{selectedSectionLive.id}</strong></div>
                  </div>
                ) : null}
              </>
            ) : null}

            {activeListMode === "services" && selectedServiceLive ? (
              <>
                {activeTab === "overview" ? (
                  <div className="settings-catalog-v2-form-grid">
                    <Field language={language} label={t("اسم الخدمة")}><input className="dsv2-input" value={(mode === "edit" ? serviceDraft?.name : selectedServiceLive.name) || ""} disabled={mode !== "edit"} onChange={(event) => setServiceDraft((previous) => previous ? { ...previous, name: event.target.value } : previous)} /></Field>
                    <Field language={language} label="ID"><input className="dsv2-input" value={selectedServiceLive.id} disabled /></Field>
                    <Field language={language} label={t("القسم")}>
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
                    <Field language={language} label={t("التصنيف")}>
                      <DashboardSelectV2
                        value={String(mode === "edit" ? serviceDraft?.categoryId || "" : selectedServiceLive.categoryId || "")}
                        disabled={mode !== "edit"}
                        options={categories.filter((category) => category.sectionId === String(mode === "edit" ? serviceDraft?.sectionId || selectedServiceLive.sectionId : selectedServiceLive.sectionId)).map((category) => ({ value: category.id, label: category.name }))}
                        onChange={(categoryId) => { const category = categoryById.get(categoryId); setServiceDraft((previous) => previous ? { ...previous, categoryId, sectionId: String(category?.sectionId || previous.sectionId || "").trim() } : previous); }}
                      />
                    </Field>
                    <ToggleCard language={language} checked={mode === "edit" ? serviceDraft?.active !== false : selectedServiceLive.active !== false} label={t("الخدمة نشطة")} hint={t("حالة إتاحة الخدمة داخل الكتالوج.")} disabled={mode !== "edit"} onChange={(active) => setServiceDraft((previous) => previous ? { ...previous, active } : previous)} />
                  </div>
                ) : null}

                {activeTab === "pricing" ? (
                  <div className="settings-catalog-v2-form-grid">
                    <Field language={language} label={t("السعر")}><DashboardNumberInputV2 className="dsv2-input" min={0} value={mode === "edit" ? serviceDraft?.price ?? 0 : selectedServiceLive.price} disabled={mode !== "edit"} onChange={(event) => setServiceDraft((previous) => previous ? { ...previous, price: parseNumberInput(event.target.value, previous.price) } : previous)} /></Field>
                    <Field language={language} label={t("المدة (دقيقة)")}><DashboardNumberInputV2 className="dsv2-input" min={5} value={mode === "edit" ? serviceDraft?.durationMin ?? 60 : selectedServiceLive.durationMin} disabled={mode !== "edit"} onChange={(event) => setServiceDraft((previous) => previous ? { ...previous, durationMin: parseNumberInput(event.target.value, previous.durationMin) } : previous)} /></Field>
                    <Field language={language} label={t("سعر الموسم")}><DashboardNumberInputV2 className="dsv2-input" min={0} value={(mode === "edit" ? serviceDraft?.seasonPrice : selectedServiceLive.seasonPrice) ?? ""} disabled={mode !== "edit"} onChange={(event) => setServiceDraft((previous) => previous ? { ...previous, seasonPrice: event.target.value === "" ? null : parseNumberInput(event.target.value, 0) } : previous)} /></Field>
                  </div>
                ) : null}

                {activeTab === "variants" ? (
                  <DashboardEmptyStateV2 title="Variants" description={t("هذه المساحة محفوظة لتوسعة أنواع الخدمة لاحقًا.")} />
                ) : null}

                {activeTab === "audit" ? (
                  <div className="settings-catalog-v2-audit">
                    <div><span>{t("تاريخ الإنشاء")}</span><strong>{formatTimestamp(selectedServiceLive.createdAt, language)}</strong></div>
                    <div><span>{t("آخر تحديث")}</span><strong>{formatTimestamp(selectedServiceLive.updatedAt, language)}</strong></div>
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
      <DashboardModalV2
        open={Boolean(pendingSectionDeleteId)}
        onClose={() => setPendingSectionDeleteId(null)}
        title={t("حذف القسم")}
        description={t("سيتم حذف القسم من الكتالوج.")}
        footer={(
          <div className="d-flex gap-2 justify-content-end">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={() => setPendingSectionDeleteId(null)}>{t("إلغاء")}</button>
            <button type="button" className="dsv2-btn dsv2-btn--danger" disabled={secLoading} onClick={() => void confirmDeleteSection()}>{t("حذف القسم")}</button>
          </div>
        )}
      >
        <p>{t("تأكد أن القسم فارغ من الخدمات والتصنيفات.")}</p>
      </DashboardModalV2>
    </main>
  );
}
