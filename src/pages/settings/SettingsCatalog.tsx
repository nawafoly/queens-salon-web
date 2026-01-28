// ✅ src/pages/settings/SettingsCatalog.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  doc,
  getDoc, // ✅ add
  getDocs,
  collection,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../services/firebase";

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

  return cleaned.replace(/^_+|_+$/g, ""); // يشيل _ من البداية/النهاية
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

  // ✅ لو مو معروف، نرجع slug عادي (لكن الصورة في Services بتكون افتراضية)
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
  sectionId: string; // ✅ محفوظ تلقائيًا (من التصنيف)
  name: string;
  durationMin: number;
  price: number;
  active: boolean;
  updatedAt?: any;
  createdAt?: any;
};

export default function SettingsCatalog(props: { hasAdminPower: boolean }) {
  const navigate = useNavigate();
  const { hasAdminPower } = props;

  const [catalogMsg, setCatalogMsg] = useState("");

  const [secLoading, setSecLoading] = useState(false);
  const [catLoading, setCatLoading] = useState(false);
  const [srvLoading, setSrvLoading] = useState(false);

  const [sectionsCatalog, setSectionsCatalog] = useState<ServiceSectionRow[]>([]);
  const [categoriesCatalog, setCategoriesCatalog] = useState<ServiceCategoryRow[]>([]);
  const [servicesCatalog, setServicesCatalog] = useState<ServiceRow[]>([]);

  const [newSectionName, setNewSectionName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newServiceName, setNewServiceName] = useState("");

  const [selectedSectionIdForCats, setSelectedSectionIdForCats] = useState<string>("");
  const [selectedCategoryIdForServices, setSelectedCategoryIdForServices] = useState<string>("");

  const showCatalogMsg = (msg: string, ms = 1800) => {
    setCatalogMsg(msg);
    if (ms > 0) setTimeout(() => setCatalogMsg(""), ms);
  };

  const loadCatalog = async () => {
    setCatalogMsg("");
    try {
      setSecLoading(true);
      setCatLoading(true);
      setSrvLoading(true);

      // ✅ Sections
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

      setSectionsCatalog(secList);

      // ✅ Categories
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

      setCategoriesCatalog(catList);

      // ✅ Services
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
            active: x?.active !== false,
            updatedAt: x?.updatedAt,
            createdAt: x?.createdAt,
          };
        })
        .filter((s) => s.name.trim());

      setServicesCatalog(srvList);

      // ✅ fix selected section
      setSelectedSectionIdForCats((prev) => {
        const still = secList.some((s) => s.id === prev);
        if (still && prev) return prev;
        return secList[0]?.id || "";
      });

      // ✅ fix selected category: أول تصنيف داخل القسم المختار
      const sectionId = selectedSectionIdForCats || secList[0]?.id || "";
      const firstCat = catList.find((c) => String(c.sectionId || "").trim() === String(sectionId || "").trim());

      setSelectedCategoryIdForServices((prev) => {
        if (prev && catList.some((c) => c.id === prev)) return prev;
        return firstCat?.id || "";
      });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAdminPower]);

  /* =========================
     Sections actions
  ========================= */
  const createSection = async () => {
    if (!hasAdminPower) return;
    const name = String(newSectionName || "").trim();
    if (!name) return;

    const id = sectionIdFromName(name); // ✅ ID ذكي عشان الصور

    const ref = doc(db, ...SERVICE_SECTIONS_COLLECTION, id);
    const exists = await getDoc(ref);
    if (exists.exists()) {
      return showCatalogMsg("❌ هذا القسم موجود مسبقًا (بنفس الـ ID)", 2500);
    }

    try {
      setSecLoading(true);

      const nextOrder =
        sectionsCatalog.length > 0
          ? Math.max(...sectionsCatalog.map((s) => Number(s.order || 0))) + 1
          : 1;

      await setDoc(ref, {
        name,
        active: true,
        order: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });


      setNewSectionName("");
      showCatalogMsg(`✅ تم إنشاء القسم (id: ${id})`);
      await loadCatalog();
      setSelectedSectionIdForCats(id);
    } catch (e) {
      console.error("createSection error:", e);
      showCatalogMsg("❌ تعذر إنشاء القسم", 2500);
    } finally {
      setSecLoading(false);
    }
  };

  const saveSectionRow = async (row: ServiceSectionRow) => {
    if (!hasAdminPower) return;

    const name = String(row.name || "").trim();
    if (!name) return showCatalogMsg("❌ اسم القسم لا يمكن يكون فارغ", 2000);

    const orderNum = Number.isFinite(Number(row.order)) ? Number(row.order) : 0;

    try {
      await setDoc(
        doc(db, ...SERVICE_SECTIONS_COLLECTION, row.id),
        { name, active: row.active !== false, order: orderNum, updatedAt: serverTimestamp() },
        { merge: true }
      );
      showCatalogMsg("✅ تم حفظ القسم");
    } catch (e) {
      console.error("saveSectionRow error:", e);
      showCatalogMsg("❌ تعذر حفظ القسم", 2500);
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

  useEffect(() => {
    // لما يتغير القسم المختار: خلي أول تصنيف لهذا القسم مختار
    const sid = String(selectedSectionIdForCats || "").trim();
    if (!sid) {
      setSelectedCategoryIdForServices("");
      return;
    }
    const firstCat = categoriesCatalog.find((c) => String(c.sectionId || "").trim() === sid);
    setSelectedCategoryIdForServices(firstCat?.id || "");
  }, [selectedSectionIdForCats, categoriesCatalog]);

  const createCategoryUnderSection = async () => {
    if (!hasAdminPower) return;

    const sectionId = String(selectedSectionIdForCats || "").trim();
    const name = String(newCategoryName || "").trim();

    if (!sectionId) return showCatalogMsg("❌ اختر قسم أولاً قبل إضافة تصنيف", 2200);
    if (!name) return;

    // ✅ ID ثابت: sectionId + name
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

    // ✅ derive sectionId from category
    const cat = categoriesCatalog.find((c) => String(c.id) === categoryId);
    const sectionId = String(cat?.sectionId || "").trim();
    if (!sectionId) return showCatalogMsg("❌ التصنيف المختار غير مربوط بقسم", 2200);

    // ✅ ID ثابت: categoryId + name
    const id = buildId(`${categoryId}_${name}`);

    try {
      setSrvLoading(true);

      await setDoc(doc(db, ...SERVICES_COLLECTION, id), {
        categoryId,
        sectionId,
        name,
        durationMin: 60,
        price: 0,
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
    const categoryId = String(row.categoryId || "").trim();

    if (!categoryId) return showCatalogMsg("❌ الخدمة لازم تكون مرتبطة بتصنيف", 2000);

    // ✅ derive sectionId from chosen category (always)
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

        {/* 1) Sections */}
        <div className="settings-card scatalog__card" style={{ marginTop: 0 }}>
          <h3 className="settings-title">١) الأقسام</h3>

          <div className="settings-grid">
            <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
              <label>إضافة قسم جديد (ID ثابت)</label>
              <div className="scatalog__row">
                <input
                  className="settings-input"
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  placeholder="مثال: شعر"
                  disabled={secLoading}
                  onKeyDown={(e) => e.key === "Enter" && createSection()}
                />
                <button
                  type="button"
                  className={`exp-btn primary ${secLoading ? "is-disabled" : ""}`}
                  disabled={secLoading}
                  onClick={createSection}
                >
                  إنشاء القسم
                </button>
              </div>
              <div className="settings-footnote">
                * الأقسام: <b>salons/main/service_sections</b>
                <br />
                * ID = slug من الاسم (ثابت)
              </div>
            </div>
          </div>

          <div className="settings-list" style={{ marginTop: 10 }}>
            {secLoading ? (
              <div className="settings-note">تحميل الأقسام…</div>
            ) : sectionsCatalog.length === 0 ? (
              <div className="settings-note">لا توجد أقسام بعد.</div>
            ) : (
              sectionsCatalog.map((s) => (
                <div key={s.id} className="settings-row scatalog__listRow">
                  <input className="settings-input" value={s.id} readOnly title="ID ثابت" />

                  <input
                    className="settings-input"
                    value={s.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSectionsCatalog((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, name: v } : x))
                      );
                    }}
                    title="اسم القسم"
                  />

                  <input
                    className="settings-input scatalog__num"
                    type="number"
                    min={0}
                    step={1}
                    value={Number(s.order || 0)}
                    onChange={(e) => {
                      const v = Number(e.target.value || 0);
                      setSectionsCatalog((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, order: v } : x))
                      );
                    }}
                    title="ترتيب القسم"
                  />

                  <label className="scatalog__check">
                    <input
                      className="settings-check"
                      type="checkbox"
                      checked={s.active !== false}
                      onChange={() => {
                        setSectionsCatalog((prev) =>
                          prev.map((x) =>
                            x.id === s.id ? { ...x, active: !(x.active !== false) } : x
                          )
                        );
                      }}
                    />
                    مفعل
                  </label>

                  <button type="button" className="exp-btn primary" onClick={() => saveSectionRow(s)}>
                    حفظ
                  </button>

                  <button type="button" className="exp-btn" onClick={() => setSelectedSectionIdForCats(s.id)}>
                    إدارة التصنيفات
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 2) Categories */}
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

          <div className="settings-list" style={{ marginTop: 10 }}>
            {catLoading ? (
              <div className="settings-note">تحميل التصنيفات…</div>
            ) : !selectedSectionIdForCats ? (
              <div className="settings-note">اختر قسم أولاً.</div>
            ) : categoriesInSelectedSection.length === 0 ? (
              <div className="settings-note">لا توجد تصنيفات تحت هذا القسم.</div>
            ) : (
              categoriesInSelectedSection.map((c) => (
                <div key={c.id} className="settings-row scatalog__listRow">
                  <input className="settings-input" value={c.id} readOnly title="ID ثابت" />

                  <input
                    className="settings-input"
                    value={c.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCategoriesCatalog((prev) =>
                        prev.map((x) => (x.id === c.id ? { ...x, name: v } : x))
                      );
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
                      setCategoriesCatalog((prev) =>
                        prev.map((x) => (x.id === c.id ? { ...x, order: v } : x))
                      );
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
                          prev.map((x) =>
                            x.id === c.id ? { ...x, active: !(x.active !== false) } : x
                          )
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

        {/* 3) Services */}
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
                <div key={s.id} className="settings-row scatalog__listRow">
                  <input className="settings-input" value={s.id} readOnly title="ID ثابت" />

                  <input
                    className="settings-input"
                    value={s.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setServicesCatalog((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, name: v } : x))
                      );
                    }}
                    title="اسم الخدمة"
                  />

                  <input
                    className="settings-input scatalog__numWide"
                    type="number"
                    min={5}
                    step={5}
                    value={Number(s.durationMin || 0)}
                    onChange={(e) => {
                      const v = Math.max(5, Number(e.target.value || 0));
                      setServicesCatalog((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, durationMin: v } : x))
                      );
                    }}
                    title="المدة (دقيقة)"
                  />

                  <input
                    className="settings-input scatalog__numWide"
                    type="number"
                    min={0}
                    step={5}
                    value={Number(s.price || 0)}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value || 0));
                      setServicesCatalog((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, price: v } : x))
                      );
                    }}
                    title="السعر"
                  />

                  {/* ✅ مهم: التصنيفات اللي تظهر هنا = تصنيفات القسم المختار */}
                  <select
                    className="settings-input scatalog__select"
                    value={s.categoryId}
                    onChange={(e) => {
                      const v = e.target.value;
                      setServicesCatalog((prev) =>
                        prev.map((x) => (x.id === s.id ? { ...x, categoryId: v } : x))
                      );
                    }}
                    title="التصنيف"
                  >
                    <option value="">— اختر التصنيف —</option>
                    {categoriesInSelectedSection.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <label className="scatalog__check">
                    <input
                      className="settings-check"
                      type="checkbox"
                      checked={s.active !== false}
                      onChange={() => {
                        setServicesCatalog((prev) =>
                          prev.map((x) =>
                            x.id === s.id ? { ...x, active: !(x.active !== false) } : x
                          )
                        );
                      }}
                    />
                    مفعل
                  </label>

                  <button type="button" className="exp-btn primary" onClick={() => saveServiceRow(s)}>
                    حفظ
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="settings-footnote">
            * الآن صار عندنا 3 مراحل: <b>قسم → تصنيف → خدمة</b>.
            <br />
            * الخدمات تُحفظ بـ <b>categoryId</b> و <b>sectionId</b> تلقائيًا (من التصنيف) ✅
            <br />
            * ID ثابت لكل شيء (ما عاد فيه addDoc) ✅
          </div>
        </div>
      </div>
    </div>
  );
}
