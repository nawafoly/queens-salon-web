
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
  deleteDoc,
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
  seasonPrice?: number | null;
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

  useEffect(() => {
    loadCatalog();
    loadSeasonSettings();
  }, []);

  const loadSeasonSettings = async () => {
    try {
      const settings = await AppSettingsService.fetchRemote();
      if (settings?.catalogSeasonPricing) {
        setSeasonPricingEnabled(!!settings.catalogSeasonPricing.enabled);
        setSeasonPricingFrom(settings.catalogSeasonPricing.from || "");
        setSeasonPricingTo(settings.catalogSeasonPricing.to || "");
      }
    } catch (e) {
      console.error("Error loading season settings:", e);
    }
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
      const cid = String(s.categoryId || "").trim();
      if (!cid) continue;
      srvCount.set(cid, (srvCount.get(cid) || 0) + 1);
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

  const saveSectionRow = async (row: ServiceSectionRow) => {
    if (!hasAdminPower) return;
    const name = String(row.name || "").trim();
    if (!name) return showCatalogMsg("❌ اسم القسم لا يمكن يكون فارغ", 2000);

    try {
      setSecLoading(true);
      await setDoc(
        doc(db, ...SERVICE_SECTIONS_COLLECTION, row.id),
        {
          name,
          active: row.active !== false,
          order: Number(row.order || 0),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      showCatalogMsg("✅ تم حفظ القسم");
    } catch (e) {
      console.error("saveSectionRow error:", e);
      showCatalogMsg("❌ تعذر حفظ القسم", 2500);
    } finally {
      setSecLoading(false);
    }
  };

  const deleteSection = async (id: string) => {
    if (!hasAdminPower) return;
    if (!window.confirm("هل أنت متأكد من حذف هذا القسم؟ سيتم حذف القسم فقط ولن يتم حذف التصنيفات المرتبطة به تلقائياً.")) return;

    try {
      setSecLoading(true);
      await deleteDoc(doc(db, ...SERVICE_SECTIONS_COLLECTION, id));
      showCatalogMsg("✅ تم حذف القسم بنجاح");
      await loadCatalog();
    } catch (e) {
      console.error("deleteSection error:", e);
      showCatalogMsg("❌ تعذر حذف القسم", 2500);
    } finally {
      setSecLoading(false);
    }
  };

  const saveSectionFromModal = async () => {
    if (!hasAdminPower) return;

    const name = String(secForm.name || "").trim();
    if (!name) return showCatalogMsg("❌ اسم القسم لا يمكن يكون فارغ", 2000);

    const orderNum = Number.isFinite(Number(secForm.order)) ? Number(secForm.order) : 0;

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
            durationMin: clampInt(x?.durationMin ?? 60, 5),
            price: Number(x?.price || 0),
            seasonPrice: x?.seasonPrice === null || x?.seasonPrice === undefined ? null : Number(x.seasonPrice),
            active: x?.active !== false,
            updatedAt: x?.updatedAt,
            createdAt: x?.createdAt,
          };
        })
        .filter((s) => s.name.trim());

      setSectionsCatalog(secList);
      setCategoriesCatalog(catList);
      setServicesCatalog(srvList);

    } catch (e) {
      console.error("loadCatalog error:", e);
      showCatalogMsg("❌ تعذر تحميل الكتالوج", 3000);
    } finally {
      setSecLoading(false);
      setCatLoading(false);
      setSrvLoading(false);
    }
  };

  /* =========================
     Categories helpers/actions
  ========================= */
  const categoriesInSelectedSection = useMemo(() => {
    const sid = String(selectedSectionIdForCats || "").trim();
    if (!sid) return [];
    return categoriesCatalog.filter((c) => String(c.sectionId || "").trim() === sid);
  }, [categoriesCatalog, selectedSectionIdForCats]);

  const createCategoryUnderSection = async () => {
    if (!hasAdminPower) return;

    const sectionId = String(selectedSectionIdForCats || "").trim();
    const name = String(newCategoryName || "").trim();

    if (!sectionId) return showCatalogMsg("❌ اختر قسم أولاً قبل إضافة تصنيف", 2200);
    if (!name) return;

    const id = buildId(`${sectionId}_${name}`);

    try {
      setCatLoading(true);

      const nextOrder =
        categoriesCatalog.filter((c) => c.sectionId === sectionId).length > 0
          ? Math.max(...categoriesCatalog.filter((c) => c.sectionId === sectionId).map((c) => Number(c.order || 0))) + 1
          : 1;

      await setDoc(doc(db, ...SERVICE_CATEGORIES_COLLECTION, id), {
        sectionId,
        name,
        active: true,
        order: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewCategoryName("");
      showCatalogMsg(`✅ تم إضافة التصنيف (id: ${id})`);
      await loadCatalog();
      setSelectedCategoryIdForServices(id);
    } catch (e) {
      console.error("createCategoryUnderSection error:", e);
      showCatalogMsg("❌ تعذر إضافة التصنيف", 2500);
    } finally {
      setCatLoading(false);
    }
  };

  const saveCategoryRow = async (row: ServiceCategoryRow) => {
    if (!hasAdminPower) return;

    const name = String(row.name || "").trim();
    if (!name) return showCatalogMsg("❌ اسم التصنيف لا يمكن يكون فارغ", 2000);

    try {
      await setDoc(
        doc(db, ...SERVICE_CATEGORIES_COLLECTION, row.id),
        {
          name,
          active: row.active !== false,
          order: Number(row.order || 0),
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

  const deleteCategory = async (id: string) => {
    if (!hasAdminPower) return;
    if (!window.confirm("هل أنت متأكد من حذف هذا التصنيف؟")) return;

    try {
      setCatLoading(true);
      await deleteDoc(doc(db, ...SERVICE_CATEGORIES_COLLECTION, id));
      showCatalogMsg("✅ تم حذف التصنيف بنجاح");
      await loadCatalog();
    } catch (e) {
      console.error("deleteCategory error:", e);
      showCatalogMsg("❌ تعذر حذف التصنيف", 2500);
    } finally {
      setCatLoading(false);
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
      row.seasonPrice === null || row.seasonPrice === undefined || String(row.seasonPrice) === ""
        ? null
        : Math.max(0, Number(row.seasonPrice));

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

  const deleteService = async (id: string) => {
    if (!hasAdminPower) return;
    if (!window.confirm("هل أنت متأكد من حذف هذه الخدمة؟")) return;

    try {
      setSrvLoading(true);
      await deleteDoc(doc(db, ...SERVICES_COLLECTION, id));
      showCatalogMsg("✅ تم حذف الخدمة بنجاح");
      await loadCatalog();
    } catch (e) {
      console.error("deleteService error:", e);
      showCatalogMsg("❌ تعذر حذف الخدمة", 2500);
    } finally {
      setSrvLoading(false);
    }
  };

  // ✅ Auto-save service after user stops typing (debounce)
  const scheduleServiceAutosave = (nextRow: ServiceRow) => {
    if (!hasAdminPower) return;

    const id = String(nextRow.id || "").trim();
    if (!id) return;

    if (autosaveTimersRef.current[id]) {
      clearTimeout(autosaveTimersRef.current[id]);
    }

    setAutosaveMsg((p) => ({ ...p, [id]: "جارٍ الحفظ…" }));

    autosaveTimersRef.current[id] = setTimeout(async () => {
      try {
        await saveServiceRow(nextRow);
        setAutosaveMsg((p) => ({ ...p, [id]: "✅ تم الحفظ" }));

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
    }, 1000);
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

  const filteredSections = useMemo(() => {
    const q = String(secSearch || "").trim().toLowerCase();
    if (!q) return sectionsCatalog;

    return sectionsCatalog.filter((s) => {
      const id = String(s.id || "").toLowerCase();
      const name = String(s.name || "").toLowerCase();
      return id.includes(q) || name.includes(q);
    });
  }, [sectionsCatalog, secSearch]);

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
          startDate: from,
          endDate: to,
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

  return (
    <div className="dashboard-section settings-page scatalog" dir="rtl">
      <div className="settings-wrap">
        <div className="scatalog__header ">
          <div>
            <h1 className="qs-black ">إدارة الكتالوج</h1>
            <p className="settings-hint">تنظيم الخدمات: قسم ← تصنيف ← خدمة</p>
          </div>
          <div className="scatalog__actions">
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
          <div className="scatalog__msg">
            {catalogMsg}
          </div>
        )}

        {/* ✅ Season Pricing */}
        <div className="scatalog__card" style={{ marginTop: 10 }}>
          <h3 className="settings-title">وضع الموسم للأسعار</h3>

          <div className="settings-list">
            <label className="scatalog__check">
              <input
                className="settings-check"
                type="checkbox"
                checked={seasonPricingEnabled}
                disabled={!hasAdminPower}
                onChange={() => setSeasonPricingEnabled((p) => !p)}
              />
              <span>تفعيل موسم الأسعار</span>
            </label>
          </div>

          <div className="scatalog__row" style={{ marginTop: 15 }}>
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
            
            <button
              type="button"
              className={`exp-btn primary ${seasonLoading ? "is-disabled" : ""}`}
              disabled={!hasAdminPower || seasonLoading}
              onClick={saveSeasonPricing}
              style={{height: "fit-content"}}
            >
              حفظ الموسم
            </button>
          </div>
        </div>

        {/* 1) Sections */}
        <div className="scatalog__card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
            <h3 className="settings-title">١) الأقسام الرئيسية</h3>
            <button type="button" className="exp-btn primary" onClick={openAddSection}>
              + إضافة قسم جديد
            </button>
          </div>

          <div className="settings-field" style={{ marginBottom: 15 }}>
            <input
              className="settings-input"
              placeholder="بحث في الأقسام..."
              value={secSearch}
              onChange={(e) => setSecSearch(e.target.value)}
            />
          </div>

          <div className="scatalog__grid-header scatalog__grid--sections">
            <div>ID</div>
            <div>اسم القسم</div>
            <div>الترتيب</div>
            <div>مفعل؟</div>
            <div>حفظ</div>
            <div>حذف</div>
            <div>التصنيفات</div>
          </div>

          <div className="settings-list">
            {filteredSections.map((s) => (
              <React.Fragment key={s.id}>
                {/* Desktop View */}
                <div className={`scatalog__grid-row scatalog__grid--sections ${selectedSectionIdForCats === s.id ? "is-selected" : ""}`}>
                  <div style={{ fontSize: 10, opacity: 0.6 }}>{s.id}</div>
                  <input
                    className="settings-input"
                    value={s.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSectionsCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: v } : x)));
                    }}
                  />
                  <input
                    className="settings-input"
                    type="number"
                    value={s.order}
                    onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      setSectionsCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, order: v } : x)));
                    }}
                  />
                  <div style={{textAlign: "center"}}>
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={() => {
                        setSectionsCatalog((prev) =>
                          prev.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x))
                        );
                      }}
                    />
                  </div>
                  <button type="button" className="exp-btn primary" onClick={() => saveSectionRow(s)}>حفظ</button>
                  <button type="button" className="exp-btn danger" onClick={() => deleteSection(s.id)}>حذف</button>
                  <button type="button" className="exp-btn" onClick={() => setSelectedSectionIdForCats(s.id)}>
                    فتح ({countsBySection.catCount.get(s.id) || 0})
                  </button>
                </div>

                {/* Mobile View */}
                <div className="scatalog__mobile-card">
                  <div className="scatalog__mobile-card-header">
                    <div className="scatalog__mobile-card-title">{s.name}</div>
                    <div className="scatalog__mobile-card-id">{s.id}</div>
                  </div>
                  <div className="scatalog__mobile-grid">
                    <div className="scatalog__mobile-field">
                      <label className="scatalog__mobile-label">الاسم</label>
                      <input
                        className="settings-input"
                        value={s.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSectionsCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: v } : x)));
                        }}
                      />
                    </div>
                    <div className="scatalog__mobile-field">
                      <label className="scatalog__mobile-label">الترتيب</label>
                      <input
                        className="settings-input"
                        type="number"
                        value={s.order}
                        onChange={(e) => {
                          const v = Number(e.target.value || 0);
                          setSectionsCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, order: v } : x)));
                        }}
                      />
                    </div>
                    <label className="scatalog__check">
                      <input
                        type="checkbox"
                        checked={s.active}
                        onChange={() => {
                          setSectionsCatalog((prev) =>
                            prev.map((x) => (x.id === s.id ? { ...x, active: !x.active } : x))
                          );
                        }}
                      />
                      <span>مفعل</span>
                    </label>
                  </div>
                  <div className="scatalog__mobile-actions">
                    <button type="button" className="exp-btn primary" onClick={() => saveSectionRow(s)}>حفظ</button>
                    <button type="button" className="exp-btn" onClick={() => setSelectedSectionIdForCats(s.id)}>فتح</button>
                    <button type="button" className="exp-btn danger" onClick={() => deleteSection(s.id)}>حذف</button>
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Section Modal */}
        {secModalOpen && (
          <div className="dashboard-modal-overlay" onClick={closeSecModal}>
            <div className="dashboard-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
              <h3>{secMode === "add" ? "إضافة قسم جديد" : "تعديل القسم"}</h3>
              <div className="settings-grid" style={{ marginTop: 15 }}>
                <div className="settings-field">
                  <label>اسم القسم</label>
                  <input
                    className="settings-input"
                    value={secForm.name}
                    onChange={(e) => setSecForm({ ...secForm, name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div className="settings-field">
                  <label>الترتيب</label>
                  <input
                    className="settings-input"
                    type="number"
                    value={secForm.order}
                    onChange={(e) => setSecForm({ ...secForm, order: Number(e.target.value || 0) })}
                  />
                </div>
              </div>
              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button className="dash-btn" onClick={closeSecModal}>إلغاء</button>
                <button className="exp-btn primary" onClick={saveSectionFromModal}>
                  {secMode === "add" ? "إنشاء" : "حفظ"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 2) Categories */}
        <div className="scatalog__card">
          <h3 className="settings-title">٢) التصنيفات (تحت القسم المختار)</h3>

          <div className="scatalog__row" style={{ margin: "15px 0" }}>
            <div className="settings-field">
              <label>اختر القسم</label>
              <select
                className="settings-input"
                value={selectedSectionIdForCats}
                onChange={(e) => setSelectedSectionIdForCats(e.target.value)}
              >
                <option value="">— اختر القسم —</option>
                {sectionsCatalog.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label>إضافة تصنيف جديد</label>
              <div style={{display: "flex", gap: 8}}>
                <input
                  className="settings-input"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="مثال: قص / استشوار"
                  onKeyDown={(e) => e.key === "Enter" && createCategoryUnderSection()}
                />
                <button type="button" className="exp-btn primary" onClick={createCategoryUnderSection}>إنشاء</button>
              </div>
            </div>
          </div>

          <div className="scatalog__grid-header scatalog__grid--cats">
            <div>ID</div>
            <div>اسم التصنيف</div>
            <div>الترتيب</div>
            <div>مفعل؟</div>
            <div>حفظ</div>
            <div>حذف</div>
            <div>الخدمات</div>
          </div>

          <div className="settings-list">
            {categoriesInSelectedSection.map((c) => (
              <React.Fragment key={c.id}>
                {/* Desktop */}
                <div className={`scatalog__grid-row scatalog__grid--cats ${selectedCategoryIdForServices === c.id ? "is-selected" : ""}`}>
                  <div style={{ fontSize: 10, opacity: 0.6 }}>{c.id}</div>
                  <input
                    className="settings-input"
                    value={c.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCategoriesCatalog((prev) => prev.map((x) => (x.id === c.id ? { ...x, name: v } : x)));
                    }}
                  />
                  <input
                    className="settings-input"
                    type="number"
                    value={c.order}
                    onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      setCategoriesCatalog((prev) => prev.map((x) => (x.id === c.id ? { ...x, order: v } : x)));
                    }}
                  />
                  <div style={{textAlign: "center"}}>
                    <input
                      type="checkbox"
                      checked={c.active}
                      onChange={() => {
                        setCategoriesCatalog((prev) =>
                          prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x))
                        );
                      }}
                    />
                  </div>
                  <button type="button" className="exp-btn primary" onClick={() => saveCategoryRow(c)}>حفظ</button>
                  <button type="button" className="exp-btn danger" onClick={() => deleteCategory(c.id)}>حذف</button>
                  <button type="button" className="exp-btn" onClick={() => setSelectedCategoryIdForServices(c.id)}>
                    فتح ({countsBySection.srvCount.get(c.id) || 0})
                  </button>
                </div>

                {/* Mobile */}
                <div className="scatalog__mobile-card">
                  <div className="scatalog__mobile-card-header">
                    <div className="scatalog__mobile-card-title">{c.name}</div>
                    <div className="scatalog__mobile-card-id">{c.id}</div>
                  </div>
                  <div className="scatalog__mobile-grid">
                    <div className="scatalog__mobile-field">
                      <label className="scatalog__mobile-label">الاسم</label>
                      <input
                        className="settings-input"
                        value={c.name}
                        onChange={(e) => {
                          const v = e.target.value;
                          setCategoriesCatalog((prev) => prev.map((x) => (x.id === c.id ? { ...x, name: v } : x)));
                        }}
                      />
                    </div>
                    <div className="scatalog__mobile-field">
                      <label className="scatalog__mobile-label">الترتيب</label>
                      <input
                        className="settings-input"
                        type="number"
                        value={c.order}
                        onChange={(e) => {
                          const v = Number(e.target.value || 0);
                          setCategoriesCatalog((prev) => prev.map((x) => (x.id === c.id ? { ...x, order: v } : x)));
                        }}
                      />
                    </div>
                  </div>
                  <div className="scatalog__mobile-actions">
                    <button type="button" className="exp-btn primary" onClick={() => saveCategoryRow(c)}>حفظ</button>
                    <button type="button" className="exp-btn" onClick={() => setSelectedCategoryIdForServices(c.id)}>فتح</button>
                    <button type="button" className="exp-btn danger" onClick={() => deleteCategory(c.id)}>حذف</button>
                  </div>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 3) Services */}
        <div className="scatalog__card">
          <h3 className="settings-title">٣) الخدمات (تحت التصنيف المختار)</h3>

          <div className="scatalog__row" style={{ margin: "15px 0" }}>
            <div className="settings-field">
              <label>اختر التصنيف</label>
              <select
                className="settings-input"
                value={selectedCategoryIdForServices}
                onChange={(e) => setSelectedCategoryIdForServices(e.target.value)}
              >
                <option value="">— اختر التصنيف —</option>
                {categoriesInSelectedSection.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="settings-field">
              <label>إضافة خدمة جديدة</label>
              <div style={{display: "flex", gap: 8}}>
                <input
                  className="settings-input"
                  value={newServiceName}
                  onChange={(e) => setNewServiceName(e.target.value)}
                  placeholder="مثال: قص شعر قصير"
                  onKeyDown={(e) => e.key === "Enter" && createServiceUnderCategory()}
                />
                <button type="button" className="exp-btn primary" onClick={createServiceUnderCategory}>إضافة</button>
              </div>
            </div>
          </div>

          <div className="scatalog__grid-header scatalog__grid--services">
            <div>ID</div>
            <div>اسم الخدمة</div>
            <div>المدة (د)</div>
            <div>السعر</div>
            <div>الموسم</div>
            <div>مفعل</div>
            <div>حفظ</div>
            <div>حذف</div>
          </div>

          <div className="settings-list">
            {servicesInSelectedCategory.map((s) => (
              <React.Fragment key={s.id}>
                {/* Desktop */}
                <div className="scatalog__grid-row scatalog__grid--services">
                  <div className="scatalog__cell-id">{s.id}</div>
                  <input
                    className="settings-input"
                    value={s.name}
                    onChange={(e) => {
                      const next = { ...s, name: e.target.value };
                      setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                      scheduleServiceAutosave(next);
                    }}
                  />
                  <input
                    className="settings-input"
                    type="number"
                    value={s.durationMin}
                    onChange={(e) => {
                      const next = { ...s, durationMin: Number(e.target.value || 0) };
                      setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                      scheduleServiceAutosave(next);
                    }}
                  />
                  <input
                    className="settings-input"
                    type="number"
                    value={s.price}
                    onChange={(e) => {
                      const next = { ...s, price: Number(e.target.value || 0) };
                      setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                      scheduleServiceAutosave(next);
                    }}
                  />
                  <input
                    className="settings-input"
                    type="number"
                    value={s.seasonPrice === null ? "" : s.seasonPrice}
                    placeholder="-"
                    onChange={(e) => {
                      const val = e.target.value === "" ? null : Number(e.target.value);
                      const next = { ...s, seasonPrice: val };
                      setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                      scheduleServiceAutosave(next);
                    }}
                  />
                  <div style={{textAlign: "center"}}>
                    <input
                      type="checkbox"
                      checked={s.active}
                      onChange={() => {
                        const next = { ...s, active: !s.active };
                        setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                        scheduleServiceAutosave(next);
                      }}
                    />
                  </div>
                  <button type="button" className="exp-btn primary" onClick={() => saveServiceRow(s)}>حفظ</button>
                  <button type="button" className="exp-btn danger" onClick={() => deleteService(s.id)}>حذف</button>
                  {autosaveMsg[s.id] && (
                    <div className="scatalog__autosave-msg" style={{gridColumn: "1 / -1"}}>{autosaveMsg[s.id]}</div>
                  )}
                </div>

                {/* Mobile */}
                <div className="scatalog__mobile-card">
                  <div className="scatalog__mobile-card-header">
                    <div className="scatalog__mobile-card-title">{s.name}</div>
                    <div className="scatalog__mobile-card-id">{s.id}</div>
                  </div>
                  <div className="scatalog__mobile-grid">
                    <div className="scatalog__mobile-field">
                      <label className="scatalog__mobile-label">الاسم</label>
                      <input
                        className="settings-input"
                        value={s.name}
                        onChange={(e) => {
                          const next = { ...s, name: e.target.value };
                          setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                          scheduleServiceAutosave(next);
                        }}
                      />
                    </div>
                    <div className="scatalog__mobile-field">
                      <label className="scatalog__mobile-label">السعر</label>
                      <input
                        className="settings-input"
                        type="number"
                        value={s.price}
                        onChange={(e) => {
                          const next = { ...s, price: Number(e.target.value || 0) };
                          setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                          scheduleServiceAutosave(next);
                        }}
                      />
                    </div>
                    <div className="scatalog__mobile-field">
                      <label className="scatalog__mobile-label">المدة (د)</label>
                      <input
                        className="settings-input"
                        type="number"
                        value={s.durationMin}
                        onChange={(e) => {
                          const next = { ...s, durationMin: Number(e.target.value || 0) };
                          setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                          scheduleServiceAutosave(next);
                        }}
                      />
                    </div>
                    <div className="scatalog__mobile-field">
                      <label className="scatalog__mobile-label">سعر الموسم</label>
                      <input
                        className="settings-input"
                        type="number"
                        value={s.seasonPrice === null ? "" : s.seasonPrice}
                        placeholder="-"
                        onChange={(e) => {
                          const val = e.target.value === "" ? null : Number(e.target.value);
                          const next = { ...s, seasonPrice: val };
                          setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? next : x)));
                          scheduleServiceAutosave(next);
                        }}
                      />
                    </div>
                  </div>
                  <div className="scatalog__mobile-actions">
                    <button type="button" className="exp-btn primary" onClick={() => saveServiceRow(s)}>حفظ</button>
                    <button type="button" className="exp-btn danger" onClick={() => deleteService(s.id)}>حذف</button>
                  </div>
                  {autosaveMsg[s.id] && <div className="scatalog__autosave-msg">{autosaveMsg[s.id]}</div>}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
