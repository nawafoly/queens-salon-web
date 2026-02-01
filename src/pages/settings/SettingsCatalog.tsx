// ✅ src/pages/settings/SettingsCatalog.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  doc,
  getDoc,
  getDocs,
  collection,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../services/firebase";
import { AppSettingsService } from "../../services/AppSettingsService";

import "../../styles/DashboardModals.css";
import "../../styles/stylesSettings/DashboardSettings.css";
import "../../styles/stylesSettings/SettingsCatalog.css";

const SALON_ID = "main";

const SERVICE_SECTIONS_COLLECTION = ["salons", SALON_ID, "service_sections"] as const;
const SERVICE_CATEGORIES_COLLECTION = ["salons", SALON_ID, "service_categories"] as const;
const SERVICES_COLLECTION = ["salons", SALON_ID, "services"] as const;

/* =========================
   Helpers (IDs ثابتة)
========================= */
function buildId(raw: string) {
  const s = String(raw || "").trim().toLowerCase();

  // يدعم العربي + الأرقام + _ -
  const cleaned = s
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, ""); // ✅ Unicode letters/numbers

  return cleaned.replace(/^_+|_+$/g, "");
}

function sectionIdFromName(name: string) {
  const n = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[ـ]/g, "");

  const map: Record<string, string> = {
    "شعر": "hair-care",
    "العناية بالشعر": "hair-care",
    "قسم الشعر": "hair-care",
    "hair": "hair-care",
    "hair care": "hair-care",

    "بشرة": "skin-care",
    "العناية بالبشرة": "skin-care",
    "قسم البشرة": "skin-care",
    "skin": "skin-care",
    "skin care": "skin-care",

    "اظافر": "nail-care",
    "أظافر": "nail-care",
    "العناية بالأظافر": "nail-care",
    "نيلز": "nail-care",
    "nails": "nail-care",
    "nail care": "nail-care",

    "مكياج": "makeup",
    "ميك اب": "makeup",
    "makeup": "makeup",

    "مساج": "massage",
    "massage": "massage",

    "باقات": "special-packages",
    "باقة": "special-packages",
    "packages": "special-packages",
    "special packages": "special-packages",

    // ✅ أقسام جديدة
    "خدمات": "services",
    "الخدمات": "services",

    "خدمات منزلية": "home-services",
    "الخدمات المنزلية": "home-services",
    "home services": "home-services",

    "الصبغات والمعالجات": "hair-color-treatments",
    "صبغات ومعالجات": "hair-color-treatments",
    "قسم الصبغات والمعالجات": "hair-color-treatments",
    "hair color treatments": "hair-color-treatments",
  };

  return map[n] || buildId(name);
}

function clampInt(v: any, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

/* =========================
   Types
========================= */
type ServiceSectionRow = {
  id: string;
  name: string;
  active: boolean;
  order: number;
  updatedAt?: any;
  createdAt?: any;
};

type ServiceCategoryRow = {
  id: string;
  sectionId: string;
  name: string;
  active: boolean;
  order: number;
  updatedAt?: any;
  createdAt?: any;
};

type ServiceRow = {
  id: string;
  categoryId: string;
  sectionId: string;
  name: string;
  durationMin: number;
  price: number;
  seasonPrice?: number;
  active: boolean;
  updatedAt?: any;
  createdAt?: any;
};

export default function SettingsCatalog(props: { hasAdminPower: boolean }) {
  const navigate = useNavigate();
  const { hasAdminPower } = props;

  const [catalogMsg, setCatalogMsg] = useState("");

  // ✅ Autosave timers per service (debounce)
  const autosaveTimersRef = React.useRef<Record<string, any>>({});
  const [autosaveMsg, setAutosaveMsg] = useState<Record<string, string>>({});


  // ✅ Season Pricing (global)
  const [seasonPricingEnabled, setSeasonPricingEnabled] = useState(false);
  const [seasonPricingFrom, setSeasonPricingFrom] = useState("");
  const [seasonPricingTo, setSeasonPricingTo] = useState("");
  const [seasonLoading, setSeasonLoading] = useState(false);

  const [secLoading, setSecLoading] = useState(false);
  const [catLoading, setCatLoading] = useState(false);
  const [srvLoading, setSrvLoading] = useState(false);

  const [sectionsCatalog, setSectionsCatalog] = useState<ServiceSectionRow[]>([]);
  const [categoriesCatalog, setCategoriesCatalog] = useState<ServiceCategoryRow[]>([]);
  const [servicesCatalog, setServicesCatalog] = useState<ServiceRow[]>([]);

  const [newCategoryName, setNewCategoryName] = useState("");
  const [newServiceName, setNewServiceName] = useState("");

  const [selectedSectionIdForCats, setSelectedSectionIdForCats] = useState<string>("");
  const [selectedCategoryIdForServices, setSelectedCategoryIdForServices] = useState<string>("");

  const showCatalogMsg = (msg: string, ms = 1800) => {
    setCatalogMsg(msg);
    if (ms > 0) setTimeout(() => setCatalogMsg(""), ms);
  };

  /* =========================
     ✅ Counts (UI improvements)
  ========================= */
  const countsBySection = useMemo(() => {
    const catCount = new Map<string, number>();
    const srvCount = new Map<string, number>();

    for (const c of categoriesCatalog) {
      const sid = String(c.sectionId || "").trim();
      if (!sid) continue;
      catCount.set(sid, (catCount.get(sid) || 0) + 1);
    }

    for (const s of servicesCatalog) {
      const sid = String(s.sectionId || "").trim();
      if (!sid) continue;
      srvCount.set(sid, (srvCount.get(sid) || 0) + 1);
    }

    return { catCount, srvCount };
  }, [categoriesCatalog, servicesCatalog]);

  /* =========================
     ✅ Section modal
  ========================= */
  const [secSearch, setSecSearch] = useState("");
  const [secModalOpen, setSecModalOpen] = useState(false);
  const [secMode, setSecMode] = useState<"add" | "edit">("add");

  const [secForm, setSecForm] = useState<{
    id: string;
    name: string;
    active: boolean;
    order: number;
  }>({
    id: "",
    name: "",
    active: true,
    order: 1,
  });

  const closeSecModal = () => setSecModalOpen(false);

  const openAddSection = () => {
    const nextOrder =
      sectionsCatalog.length > 0
        ? Math.max(...sectionsCatalog.map((s) => Number(s.order || 0))) + 1
        : 1;

    setSecMode("add");
    setSecForm({
      id: "",
      name: "",
      active: true,
      order: nextOrder,
    });
    setSecModalOpen(true);
  };

  const openEditSection = (row: ServiceSectionRow) => {
    setSecMode("edit");
    setSecForm({
      id: row.id,
      name: row.name,
      active: row.active !== false,
      order: Number.isFinite(Number(row.order)) ? Number(row.order) : 0,
    });
    setSecModalOpen(true);
  };

  const saveSectionFromModal = async () => {
    if (!hasAdminPower) return;

    const name = String(secForm.name || "").trim();
    if (!name) return showCatalogMsg("❌ اسم القسم لا يمكن يكون فارغ", 2000);

    const orderNum = Number.isFinite(Number(secForm.order)) ? Number(secForm.order) : 0;

    // add -> id from name | edit -> keep
    const id = secMode === "add" ? sectionIdFromName(name) : String(secForm.id || "").trim();
    if (!id) return showCatalogMsg("❌ تعذر توليد ID للقسم", 2200);

    const ref = doc(db, ...SERVICE_SECTIONS_COLLECTION, id);

    try {
      setSecLoading(true);

      if (secMode === "add") {
        const exists = await getDoc(ref);
        if (exists.exists()) {
          return showCatalogMsg("❌ هذا القسم موجود مسبقًا (بنفس الـ ID)", 2500);
        }
      }

      await setDoc(
        ref,
        {
          name,
          active: secForm.active !== false,
          order: orderNum,
          ...(secMode === "add" ? { createdAt: serverTimestamp() } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showCatalogMsg(secMode === "add" ? `✅ تم إنشاء القسم (id: ${id})` : "✅ تم حفظ القسم");
      closeSecModal();

      await loadCatalog();
      setSelectedSectionIdForCats(id);
    } catch (e) {
      console.error("saveSectionFromModal error:", e);
      showCatalogMsg("❌ تعذر حفظ القسم", 2500);
    } finally {
      setSecLoading(false);
    }
  };

  /* =========================
     Load all catalog
  ========================= */
  const loadCatalog = async () => {
    setCatalogMsg("");
    try {
      setSecLoading(true);
      setCatLoading(true);
      setSrvLoading(true);

      const qSec = query(collection(db, ...SERVICE_SECTIONS_COLLECTION), orderBy("order", "asc"));
      const secSnap = await getDocs(qSec);

      const secList: ServiceSectionRow[] = secSnap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            name: String(x?.name || ""),
            active: x?.active !== false,
            order: clampInt(x?.order ?? 0, 0),
            updatedAt: x?.updatedAt,
            createdAt: x?.createdAt,
          };
        })
        .filter((s) => s.name.trim());

      const qCat = query(collection(db, ...SERVICE_CATEGORIES_COLLECTION), orderBy("order", "asc"));
      const catSnap = await getDocs(qCat);

      const catList: ServiceCategoryRow[] = catSnap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            sectionId: String(x?.sectionId || ""),
            name: String(x?.name || ""),
            active: x?.active !== false,
            order: clampInt(x?.order ?? 0, 0),
            updatedAt: x?.updatedAt,
            createdAt: x?.createdAt,
          };
        })
        .filter((c) => c.name.trim());

      const qSrv = query(collection(db, ...SERVICES_COLLECTION), orderBy("name", "asc"));
      const srvSnap = await getDocs(qSrv);

      const srvList: ServiceRow[] = srvSnap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            categoryId: String(x?.categoryId || ""),
            sectionId: String(x?.sectionId || ""),
            name: String(x?.name || ""),
            durationMin: clampInt(x?.durationMin ?? 60, 60),
            price: Math.max(0, Number(x?.price ?? 0) || 0),
            seasonPrice:
              x?.seasonPrice == null ? undefined : Math.max(0, Number(x?.seasonPrice ?? 0) || 0),
            active: x?.active !== false,
            updatedAt: x?.updatedAt,
            createdAt: x?.createdAt,
          };
        })
        .filter((s) => s.name.trim());

      setSectionsCatalog(secList);
      setCategoriesCatalog(catList);
      setServicesCatalog(srvList);

      const nextSelectedSection = (() => {
        const prev = String(selectedSectionIdForCats || "").trim();
        if (prev && secList.some((s) => s.id === prev)) return prev;
        return secList[0]?.id || "";
      })();

      const nextSelectedCategory = (() => {
        const prev = String(selectedCategoryIdForServices || "").trim();
        if (prev && catList.some((c) => c.id === prev)) return prev;

        const firstCat = catList.find(
          (c) => String(c.sectionId || "").trim() === String(nextSelectedSection || "").trim()
        );
        return firstCat?.id || "";
      })();

      setSelectedSectionIdForCats(nextSelectedSection);
      setSelectedCategoryIdForServices(nextSelectedCategory);
    } catch (e) {
      console.error("loadCatalog error:", e);
      setSectionsCatalog([]);
      setCategoriesCatalog([]);
      setServicesCatalog([]);
      showCatalogMsg("❌ تعذر تحميل الكتالوج (تحقق من Rules أو المسار)", 3000);
    } finally {
      setSecLoading(false);
      setCatLoading(false);
      setSrvLoading(false);
    }
  };

  useEffect(() => {
    if (!hasAdminPower) return;

    loadCatalog();

    // ✅ load season pricing settings
    AppSettingsService.fetchRemote()
      .then((remote: any) => {
        const sp = (remote as any)?.catalogSeasonPricing || {};
        setSeasonPricingEnabled(!!sp.enabled);
        setSeasonPricingFrom(String(sp.from || ""));
        setSeasonPricingTo(String(sp.to || ""));
      })
      .catch(() => {
        // ignore
      });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAdminPower]);

  /* =========================
     Categories helpers/actions
  ========================= */
  const categoriesInSelectedSection = useMemo(() => {
    const sid = String(selectedSectionIdForCats || "").trim();
    if (!sid) return [];
    return categoriesCatalog.filter((c) => String(c.sectionId || "").trim() === sid);
  }, [categoriesCatalog, selectedSectionIdForCats]);

  useEffect(() => {
    const sid = String(selectedSectionIdForCats || "").trim();
    if (!sid) {
      setSelectedCategoryIdForServices("");
      return;
    }
    const firstCat = categoriesCatalog.find((c) => String(c.sectionId || "").trim() === sid);
    setSelectedCategoryIdForServices((prev) => {
      if (prev && categoriesCatalog.some((c) => c.id === prev)) {
        const prevCat = categoriesCatalog.find((c) => c.id === prev);
        if (String(prevCat?.sectionId || "").trim() === sid) return prev;
      }
      return firstCat?.id || "";
    });
  }, [selectedSectionIdForCats, categoriesCatalog]);

  const createCategoryUnderSection = async () => {
    if (!hasAdminPower) return;

    const sectionId = String(selectedSectionIdForCats || "").trim();
    const name = String(newCategoryName || "").trim();

    if (!sectionId) return showCatalogMsg("❌ اختر قسم أولاً قبل إضافة تصنيف", 2200);
    if (!name) return;

    const id = buildId(`${sectionId}_${name}`);

    try {
      setCatLoading(true);

      const list = categoriesCatalog.filter((c) => String(c.sectionId || "").trim() === sectionId);
      const nextOrder = list.length > 0 ? Math.max(...list.map((c) => Number(c.order || 0))) + 1 : 1;

      await setDoc(doc(db, ...SERVICE_CATEGORIES_COLLECTION, id), {
        sectionId,
        name,
        active: true,
        order: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewCategoryName("");
      showCatalogMsg(`✅ تم إنشاء التصنيف (id: ${id})`);
      await loadCatalog();

      setSelectedCategoryIdForServices(id);
    } catch (e) {
      console.error("createCategoryUnderSection error:", e);
      showCatalogMsg("❌ تعذر إنشاء التصنيف", 2500);
    } finally {
      setCatLoading(false);
    }
  };

  const saveCategoryRow = async (row: ServiceCategoryRow) => {
    if (!hasAdminPower) return;

    const name = String(row.name || "").trim();
    const sectionId = String(row.sectionId || "").trim();
    if (!sectionId) return showCatalogMsg("❌ التصنيف لازم يكون تابع لقسم", 2000);
    if (!name) return showCatalogMsg("❌ اسم التصنيف لا يمكن يكون فارغ", 2000);

    const orderNum = Number.isFinite(Number(row.order)) ? Number(row.order) : 0;

    try {
      await setDoc(
        doc(db, ...SERVICE_CATEGORIES_COLLECTION, row.id),
        {
          sectionId,
          name,
          active: row.active !== false,
          order: orderNum,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      showCatalogMsg("✅ تم حفظ التصنيف");
    } catch (e) {
      console.error("saveCategoryRow error:", e);
      showCatalogMsg("❌ تعذر حفظ التصنيف", 2500);
    }
  };

  /* =========================
     Services helpers/actions
  ========================= */
  const servicesInSelectedCategory = useMemo(() => {
    const cid = String(selectedCategoryIdForServices || "").trim();
    if (!cid) return [];
    return servicesCatalog.filter((s) => String(s.categoryId || "").trim() === cid);
  }, [servicesCatalog, selectedCategoryIdForServices]);

  const createServiceUnderCategory = async () => {
    if (!hasAdminPower) return;

    const categoryId = String(selectedCategoryIdForServices || "").trim();
    const name = String(newServiceName || "").trim();

    if (!categoryId) return showCatalogMsg("❌ اختر تصنيف أولاً قبل إضافة خدمة", 2200);
    if (!name) return;

    const cat = categoriesCatalog.find((c) => String(c.id) === categoryId);
    const sectionId = String(cat?.sectionId || "").trim();
    if (!sectionId) return showCatalogMsg("❌ التصنيف المختار غير مربوط بقسم", 2200);

    const id = buildId(`${categoryId}_${name}`);

    try {
      setSrvLoading(true);

      await setDoc(doc(db, ...SERVICES_COLLECTION, id), {
        categoryId,
        sectionId,
        name,
        durationMin: 60,
        price: 0,
        seasonPrice: null,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewServiceName("");
      showCatalogMsg(`✅ تم إضافة الخدمة (id: ${id})`);
      await loadCatalog();
    } catch (e) {
      console.error("createServiceUnderCategory error:", e);
      showCatalogMsg("❌ تعذر إضافة الخدمة", 2500);
    } finally {
      setSrvLoading(false);
    }
  };

  const saveServiceRow = async (row: ServiceRow) => {
    if (!hasAdminPower) return;

    const name = String(row.name || "").trim();
    if (!name) return showCatalogMsg("❌ اسم الخدمة لا يمكن يكون فارغ", 2000);

    const durationMin = Math.max(5, Number(row.durationMin || 0));
    const price = Math.max(0, Number(row.price || 0));
    const seasonPrice =
      row.seasonPrice == null || (row.seasonPrice as any) === ""
        ? null
        : Math.max(0, Number(row.seasonPrice || 0));
    const categoryId = String(row.categoryId || "").trim();

    if (!categoryId) return showCatalogMsg("❌ الخدمة لازم تكون مرتبطة بتصنيف", 2000);

    const cat = categoriesCatalog.find((c) => String(c.id) === categoryId);
    const sectionId = String(cat?.sectionId || "").trim();
    if (!sectionId) return showCatalogMsg("❌ التصنيف المختار غير مربوط بقسم", 2000);

    try {
      await setDoc(
        doc(db, ...SERVICES_COLLECTION, row.id),
        {
          categoryId,
          sectionId,
          name,
          durationMin,
          price,
          seasonPrice,
          active: row.active !== false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      showCatalogMsg("✅ تم حفظ الخدمة");

      
    } catch (e) {
      console.error("saveServiceRow error:", e);
      showCatalogMsg("❌ تعذر حفظ الخدمة", 2500);
    }
    
  };


  // ✅ Auto-save service after user stops typing (debounce)
  const scheduleServiceAutosave = (nextRow: ServiceRow) => {
    if (!hasAdminPower) return;

    const id = String(nextRow.id || "").trim();
    if (!id) return;

    // امسح مؤقت سابق لنفس الخدمة
    if (autosaveTimersRef.current[id]) {
      clearTimeout(autosaveTimersRef.current[id]);
    }

    // رسالة صغيرة جنب الخدمة
    setAutosaveMsg((p) => ({ ...p, [id]: "جارٍ الحفظ…" }));

    autosaveTimersRef.current[id] = setTimeout(async () => {
      try {
        await saveServiceRow(nextRow);
        setAutosaveMsg((p) => ({ ...p, [id]: "✅ تم الحفظ" }));

        // نخفي الرسالة بعد شوي
        setTimeout(() => {
          setAutosaveMsg((p) => {
            const copy = { ...p };
            delete copy[id];
            return copy;
          });
        }, 1200);
      } catch (e) {
        console.error("autosave error:", e);
        setAutosaveMsg((p) => ({ ...p, [id]: "❌ تعذر الحفظ" }));
      }
    }, 700);
  };


  

  if (!hasAdminPower) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <h3>غير مصرح</h3>
          <p>هذه الصفحة مخصصة للإدارة (Owner/Admin).</p>
        </div>
      </div>
    );
  }

  const filteredSections = useMemo(() => {
    const q = String(secSearch || "").trim().toLowerCase();
    if (!q) return sectionsCatalog;

    return sectionsCatalog.filter((s) => {
      const id = String(s.id || "").toLowerCase();
      const name = String(s.name || "").toLowerCase();
      return id.includes(q) || name.includes(q);
    });
  }, [sectionsCatalog, secSearch]);

  const secIdPreview = useMemo(() => {
    const name = String(secForm.name || "").trim();
    if (!name) return "";
    return sectionIdFromName(name);
  }, [secForm.name]);

  // ✅ Save Season Pricing in AppSettings
  const saveSeasonPricing = async () => {
    if (!hasAdminPower) return;

    const from = String(seasonPricingFrom || "").trim();
    const to = String(seasonPricingTo || "").trim();

    if (seasonPricingEnabled) {
      if (!from || !to) return showCatalogMsg("❌ حدد تاريخ (من/إلى) لموسم الأسعار", 2200);
      if (from > to) return showCatalogMsg("❌ تاريخ (من) لازم يكون قبل أو يساوي (إلى)", 2200);
    }

    try {
      setSeasonLoading(true);
      const latest = await AppSettingsService.fetchRemote().catch(() => ({} as any));

      const next = {
        ...(latest || {}),
        catalogSeasonPricing: {
          enabled: !!seasonPricingEnabled,
          from,
          to,
        },
      };

      await AppSettingsService.saveRemote(next);
      showCatalogMsg("✅ تم حفظ موسم الأسعار", 1800);
    } catch (e) {
      console.error(e);
      showCatalogMsg("❌ تعذر حفظ موسم الأسعار", 2500);
    } finally {
      setSeasonLoading(false);
    }
  };

  // ✅ header style
  const headerRowStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 16,
    border: "1px dashed rgba(0,0,0,0.10)",
    background: "rgba(0,0,0,0.02)",
    fontSize: 12,
    fontWeight: 900,
    opacity: 0.85,
  };

  const headerCellStyle: React.CSSProperties = {
    paddingInline: 6,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  // ✅ grid templates
  const gridSections = "1.1fr 1.6fr 0.6fr 0.8fr 0.7fr 0.9fr";
  const gridCats = "1.2fr 1.4fr 0.6fr 0.7fr 0.8fr 0.9fr";
  const gridServices = "1.1fr 1.3fr 0.7fr 0.7fr 0.7fr 1.0fr 0.7fr 0.7fr";

  return (
    <div className="dashboard-section settings-page scatalog">
      <div className="settings-wrap">
        <div className="settings-header scatalog__header">
          <div>
            <h1>إدارة الكتالوج</h1>
            <p className="settings-hint">المنطق: قسم → تصنيف → خدمة ✅ (IDs ثابتة)</p>
          </div>

          <div className="settings-save scatalog__actions">
            <button className="dash-btn" type="button" onClick={() => navigate("/dashboard/settings/advanced")}>
              رجوع
            </button>

            <button
              type="button"
              className={`exp-btn ${secLoading || catLoading || srvLoading ? "is-disabled" : ""}`}
              disabled={secLoading || catLoading || srvLoading}
              onClick={loadCatalog}
            >
              تحديث
            </button>
          </div>
        </div>

        {catalogMsg && (
          <div className="settings-note scatalog__msg" style={{ marginTop: 10 }}>
            {catalogMsg}
          </div>
        )}

        {/* ✅ Season Pricing (ONE card only) */}
        <div className="settings-card scatalog__card" style={{ marginTop: 10 }}>
          <h3 className="settings-title">وضع الموسم للأسعار</h3>

          <div className="settings-list">
            <label className="settings-row">
              <span>تفعيل موسم الأسعار</span>
              <input
                className="settings-check"
                type="checkbox"
                checked={seasonPricingEnabled}
                disabled={!hasAdminPower}
                onChange={() => setSeasonPricingEnabled((p) => !p)}
              />
            </label>
          </div>

          <div className="settings-grid" style={{ marginTop: 10 }}>
            <div className="settings-field">
              <label>من تاريخ</label>
              <input
                className="settings-input"
                type="date"
                value={seasonPricingFrom}
                disabled={!hasAdminPower || !seasonPricingEnabled}
                onChange={(e) => setSeasonPricingFrom(e.target.value)}
              />
            </div>

            <div className="settings-field">
              <label>إلى تاريخ</label>
              <input
                className="settings-input"
                type="date"
                value={seasonPricingTo}
                disabled={!hasAdminPower || !seasonPricingEnabled}
                onChange={(e) => setSeasonPricingTo(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              type="button"
              className={`exp-btn primary ${seasonLoading ? "is-disabled" : ""}`}
              disabled={!hasAdminPower || seasonLoading}
              onClick={saveSeasonPricing}
            >
              حفظ موسم الأسعار
            </button>
          </div>

          <div className="settings-footnote">
            * يتم الحفظ في AppSettings داخل: <b>catalogSeasonPricing</b>
          </div>
        </div>

        {/* =========================
            1) Sections
        ========================= */}
        <div className="settings-card scatalog__card" style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
            <div>
              <h3 className="settings-title" style={{ marginBottom: 6 }}>
                ١) الأقسام
              </h3>
              <div className="settings-footnote" style={{ marginTop: 0 }}>
                * الأقسام: <b>salons/main/service_sections</b> (ID ثابت)
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <input
                className="settings-input"
                style={{ minWidth: 240 }}
                value={secSearch}
                onChange={(e) => setSecSearch(e.target.value)}
                placeholder="بحث في الأقسام (بالاسم أو ID)…"
                disabled={secLoading}
              />

              <button
                type="button"
                className={`exp-btn primary ${secLoading ? "is-disabled" : ""}`}
                disabled={secLoading}
                onClick={openAddSection}
              >
                + إضافة قسم
              </button>
            </div>
          </div>

          {/* ✅ Columns header */}
          <div
            style={{
              ...headerRowStyle,
              marginTop: 12,
              display: "grid",
              gap: 10,
              alignItems: "center",
              gridTemplateColumns: gridSections,
            }}
          >
            <div style={headerCellStyle}>ID (ثابت)</div>
            <div style={headerCellStyle}>اسم القسم + العدّادات</div>
            <div style={headerCellStyle}>الترتيب</div>
            <div style={headerCellStyle}>الحالة</div>
            <div style={headerCellStyle}>تعديل</div>
            <div style={headerCellStyle}>إدارة</div>
          </div>

          <div className="settings-list" style={{ marginTop: 10 }}>
            {secLoading ? (
              <div className="settings-note">تحميل الأقسام…</div>
            ) : filteredSections.length === 0 ? (
              <div className="settings-note">لا توجد أقسام (أو لا يوجد نتائج).</div>
            ) : (
              filteredSections.map((s) => {
                const cats = countsBySection.catCount.get(s.id) || 0;
                const srvs = countsBySection.srvCount.get(s.id) || 0;

                return (
                  <div
                    key={s.id}
                    className="settings-row scatalog__listRow"
                    style={{ display: "grid", gap: 10, alignItems: "center", gridTemplateColumns: gridSections }}
                  >
                    <input className="settings-input" value={s.id} readOnly title="ID ثابت" />

                    <div className="settings-input" style={{ opacity: 0.95 }}>
                      {s.name}
                      <span style={{ opacity: 0.7, marginRight: 8 }}>(تصنيفات: {cats} | خدمات: {srvs})</span>
                    </div>

                    <div className="settings-input scatalog__num" style={{ textAlign: "center" }} title="ترتيب القسم">
                      {Number(s.order || 0)}
                    </div>

                    <div className="settings-input" style={{ textAlign: "center", opacity: s.active ? 1 : 0.7 }}>
                      {s.active ? "✅ مفعل" : "⛔ مخفي"}
                    </div>

                    <button type="button" className="exp-btn" onClick={() => openEditSection(s)}>
                      تعديل
                    </button>

                    <button type="button" className="exp-btn primary" onClick={() => setSelectedSectionIdForCats(s.id)}>
                      إدارة التصنيفات
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ✅ Section Modal */}
        {secModalOpen && (
          <div className="dash-modal-overlay" role="dialog" aria-modal="true" onClick={closeSecModal}>
            <div className="dash-modal" onClick={(e) => e.stopPropagation()}>
              <div className="dash-modal-head">
                <div>
                  <h3 className="dash-modal-title qs-black" style={{ margin: 0 }}>
                    {secMode === "add" ? "إضافة قسم جديد" : "تعديل القسم"}
                  </h3>
                  <p className="qs-black" style={{ margin: "6px 0 0", opacity: 0.75, fontSize: 13 }}>
                    {secMode === "add"
                      ? "اكتب اسم القسم وراح نسوي له ID ثابت تلقائيًا."
                      : "ID ثابت وما يتغير، عدل الاسم والترتيب والتفعيل."}
                  </p>
                </div>

                <button className="dash-modal-close" onClick={closeSecModal} aria-label="إغلاق">
                  ✕
                </button>
              </div>

              <div className="dash-modal-body">
                <div className="settings-grid">
                  <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                    <label>اسم القسم</label>
                    <input
                      className="settings-input"
                      value={secForm.name}
                      onChange={(e) => setSecForm((p) => ({ ...p, name: e.target.value }))}
                      placeholder="مثال: شعر"
                      disabled={secLoading}
                    />
                  </div>

                  <div className="settings-field">
                    <label>ID (ثابت)</label>
                    <input
                      className="settings-input"
                      value={secMode === "add" ? secIdPreview : secForm.id}
                      readOnly
                      title="ID ثابت"
                    />
                  </div>

                  <div className="settings-field">
                    <label>الترتيب</label>
                    <input
                      className="settings-input"
                      type="number"
                      min={0}
                      step={1}
                      value={Number(secForm.order || 0)}
                      onChange={(e) => setSecForm((p) => ({ ...p, order: Number(e.target.value || 0) }))}
                      disabled={secLoading}
                    />
                  </div>

                  <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <input
                        className="settings-check"
                        type="checkbox"
                        checked={secForm.active !== false}
                        onChange={() => setSecForm((p) => ({ ...p, active: !(p.active !== false) }))}
                        disabled={secLoading}
                      />
                      مفعل (يظهر في الموقع)
                    </label>
                  </div>
                </div>
              </div>

              <div className="dash-modal-actions">
                <button className="exp-btn" type="button" onClick={closeSecModal} disabled={secLoading}>
                  إلغاء
                </button>

                <button
                  className={`exp-btn primary ${secLoading ? "is-disabled" : ""}`}
                  type="button"
                  onClick={saveSectionFromModal}
                  disabled={secLoading}
                >
                  {secMode === "add" ? "إنشاء" : "حفظ"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================
            2) Categories
        ========================= */}
        <div className="settings-card scatalog__card">
          <h3 className="settings-title">٢) التصنيفات (تحت القسم المختار)</h3>

          <div className="settings-grid">
            <div className="settings-field">
              <label>اختر القسم</label>
              <select
                className="settings-input"
                value={selectedSectionIdForCats}
                disabled={secLoading || sectionsCatalog.length === 0}
                onChange={(e) => setSelectedSectionIdForCats(e.target.value)}
              >
                <option value="">— اختر القسم —</option>
                {sectionsCatalog.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label>إضافة تصنيف جديد تحت هذا القسم (ID ثابت)</label>
              <div className="scatalog__row">
                <input
                  className="settings-input"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="مثال: قص / استشوار"
                  disabled={catLoading}
                  onKeyDown={(e) => e.key === "Enter" && createCategoryUnderSection()}
                />
                <button
                  type="button"
                  className={`exp-btn primary ${catLoading ? "is-disabled" : ""}`}
                  disabled={catLoading}
                  onClick={createCategoryUnderSection}
                >
                  إنشاء التصنيف
                </button>
              </div>
              <div className="settings-footnote">
                * التصنيفات: <b>salons/main/service_categories</b> وفيها <b>sectionId</b>
                <br />
                * ID = sectionId + slug(name)
              </div>
            </div>
          </div>

          <div
            style={{
              ...headerRowStyle,
              marginTop: 10,
              display: "grid",
              gap: 10,
              alignItems: "center",
              gridTemplateColumns: gridCats,
            }}
          >
            <div style={headerCellStyle}>ID (ثابت)</div>
            <div style={headerCellStyle}>اسم التصنيف</div>
            <div style={headerCellStyle}>الترتيب</div>
            <div style={headerCellStyle}>مفعل؟</div>
            <div style={headerCellStyle}>حفظ</div>
            <div style={headerCellStyle}>إدارة الخدمات</div>
          </div>

          <div className="settings-list" style={{ marginTop: 10 }}>
            {catLoading ? (
              <div className="settings-note">تحميل التصنيفات…</div>
            ) : !selectedSectionIdForCats ? (
              <div className="settings-note">اختر قسم أولاً.</div>
            ) : categoriesInSelectedSection.length === 0 ? (
              <div className="settings-note">لا توجد تصنيفات تحت هذا القسم.</div>
            ) : (
              categoriesInSelectedSection.map((c) => (
                <div
                  key={c.id}
                  className="settings-row scatalog__listRow"
                  style={{ display: "grid", gap: 10, alignItems: "center", gridTemplateColumns: gridCats }}
                >
                  <input className="settings-input" value={c.id} readOnly title="ID ثابت" />

                  <input
                    className="settings-input"
                    value={c.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCategoriesCatalog((prev) => prev.map((x) => (x.id === c.id ? { ...x, name: v } : x)));
                    }}
                    title="اسم التصنيف"
                  />

                  <input
                    className="settings-input scatalog__num"
                    type="number"
                    min={0}
                    step={1}
                    value={Number(c.order || 0)}
                    onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      setCategoriesCatalog((prev) => prev.map((x) => (x.id === c.id ? { ...x, order: v } : x)));
                    }}
                    title="ترتيب التصنيف"
                  />

                  <label className="scatalog__check">
                    <input
                      className="settings-check"
                      type="checkbox"
                      checked={c.active !== false}
                      onChange={() => {
                        setCategoriesCatalog((prev) =>
                          prev.map((x) => (x.id === c.id ? { ...x, active: !(x.active !== false) } : x))
                        );
                      }}
                    />
                    مفعل
                  </label>

                  <button type="button" className="exp-btn primary" onClick={() => saveCategoryRow(c)}>
                    حفظ
                  </button>

                  <button type="button" className="exp-btn" onClick={() => setSelectedCategoryIdForServices(c.id)}>
                    إدارة الخدمات
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* =========================
            3) Services
        ========================= */}
        <div className="settings-card scatalog__card">
          <h3 className="settings-title">٣) الخدمات (تحت التصنيف المختار)</h3>

          <div className="settings-grid">
            <div className="settings-field">
              <label>اختر التصنيف</label>
              <select
                className="settings-input"
                value={selectedCategoryIdForServices}
                disabled={catLoading || categoriesInSelectedSection.length === 0}
                onChange={(e) => setSelectedCategoryIdForServices(e.target.value)}
              >
                <option value="">— اختر التصنيف —</option>
                {categoriesInSelectedSection.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label>إضافة خدمة جديدة تحت هذا التصنيف (ID ثابت)</label>
              <div className="scatalog__row">
                <input
                  className="settings-input"
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                  placeholder="مثال: قص شعر قصير"
                  disabled={srvLoading}
                  onKeyDown={(e) => e.key === "Enter" && createServiceUnderCategory()}
                />
                <button
                  type="button"
                  className={`exp-btn primary ${srvLoading ? "is-disabled" : ""}`}
                  disabled={srvLoading}
                  onClick={createServiceUnderCategory}
                >
                  إضافة الخدمة
                </button>
              </div>
              <div className="settings-footnote">
                * الخدمات: <b>salons/main/services</b> وفيها <b>categoryId</b> و <b>sectionId</b> ✅
                <br />
                * ID = categoryId + slug(name)
              </div>
            </div>
          </div>


          <div className="settings-list" style={{ marginTop: 10 }}>
            {srvLoading ? (
              <div className="settings-note">تحميل الخدمات…</div>
            ) : !selectedCategoryIdForServices ? (
              <div className="settings-note">اختر تصنيف أولاً لعرض خدماته.</div>
            ) : servicesInSelectedCategory.length === 0 ? (
              <div className="settings-note">لا توجد خدمات تحت هذا التصنيف.</div>
            ) : (
              servicesInSelectedCategory.map((s) => (
                <div key={s.id} className="scatalog__srvCard">
                  {/* رأس الكرت */}
                  <div className="scatalog__srvHead">
                    <div className="scatalog__srvHeadLeft">
                      <div className="scatalog__srvName">{s.name}</div>
                      <div className="scatalog__srvId">{s.id}</div>
                    </div>

                    <div className="scatalog__srvHeadRight">
                      <label className="scatalog__check">
                        <input
                          className="settings-check"
                          type="checkbox"
                          checked={s.active !== false}
                          onChange={() => {
                            setServicesCatalog((prev) =>
                              prev.map((x) => (x.id === s.id ? { ...x, active: !(x.active !== false) } : x))
                            );
                          }}
                        />
                        مفعل
                      </label>

                      <button type="button" className="exp-btn primary" onClick={() => saveServiceRow(s)}>
                        حفظ
                      </button>
                    </div>
                  </div>

                  {/* جسم الكرت */}
                  <div className="scatalog__srvBody">
                    <div className="scatalog__srvField">
                      <div className="scatalog__lbl">اسم الخدمة</div>
                      <input
                        className="settings-input"
                        value={s.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: v } : x)));
                        }}
                      />
                    </div>

                    <div className="scatalog__srvField">
                      <div className="scatalog__lbl">المدة (دقيقة)</div>
                      <input
                        className="settings-input scatalog__numWide"
                        type="number"
                        inputMode="numeric"
                        min={5}
                        step={5}
                        value={Number(s.durationMin || 0) === 0 ? "" : String(s.durationMin)}
                        onChange={(e) => {
                          const raw = e.target.value; // ممكن يكون "" أثناء المسح
                          const n = raw === "" ? 0 : Number(raw);
                        
                          const nextRow = { ...s, durationMin: Number.isFinite(n) ? n : 0 };
                        
                          setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? nextRow : x)));
                        
                          // ✅ حفظ تلقائي بعد 700ms
                          scheduleServiceAutosave(nextRow);
                        }}
                        
                        onBlur={() => {
                          // نثبت قيمة منطقية بعد ما يطلع من الحقل
                          const fixed = Math.max(5, Number(s.durationMin || 0));
                          const snapped = Math.round(fixed / 5) * 5;
                        
                          const nextRow = { ...s, durationMin: snapped };
                        
                          setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? nextRow : x)));
                        
                          // ✅ حفظ تلقائي (خصوصًا لو عدلناها بالتقريب)
                          scheduleServiceAutosave(nextRow);
                        }}
                        
                        
                      />
                    </div>


                    <div className="scatalog__srvField">
                      <div className="scatalog__lbl">السعر</div>
                      <input
                        className="settings-input scatalog__numWide"
                        type="number"
                        min={0}
                        step={5}
                        value={Number(s.price || 0)}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value || 0));
                          setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, price: v } : x)));
                        }}
                      />
                    </div>

                    <div className="scatalog__srvField">
                      <div className="scatalog__lbl">سعر الموسم</div>
                      <input
                        className="settings-input scatalog__numWide"
                        type="number"
                        min={0}
                        step={5}
                        value={s.seasonPrice == null ? "" : Number(s.seasonPrice || 0)}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const v = raw === "" ? undefined : Math.max(0, Number(raw || 0));
                          setServicesCatalog((prev) =>
                            prev.map((x) => (x.id === s.id ? { ...x, seasonPrice: v } : x))
                          );
                        }}
                      />
                    </div>

                    <div className="scatalog__srvField scatalog__srvFieldWide">
                      <div className="scatalog__lbl">التصنيف</div>
                      <select
                        className="settings-input scatalog__select"
                        value={s.categoryId}
                        onChange={(e) => {
                          const v = e.target.value;
                          setServicesCatalog((prev) =>
                            prev.map((x) => (x.id === s.id ? { ...x, categoryId: v } : x))
                          );
                        }}
                      >
                        <option value="">— اختر التصنيف —</option>
                        {categoriesInSelectedSection.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="settings-footnote">
            * الآن صار عندنا 3 مراحل: <b>قسم → تصنيف → خدمة</b>.
            <br />
            * الخدمات تُحفظ بـ <b>categoryId</b> و <b>sectionId</b> تلقائيًا ✅
            <br />
            * ID ثابت لكل شيء ✅
          </div>
        </div>
      </div>
    </div>
  );
}
