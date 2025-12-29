// src/pages/DashboardOffers.tsx
import { useEffect, useMemo, useRef, useState } from "react";
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
} from "@fortawesome/free-solid-svg-icons";

import { pricingSections } from "./Pricing";

// ✅ CSS (قاعدة واحدة)
// - DashboardSkin.css يكون مستورد مرة واحدة فقط داخل Dashboard.tsx (الـ Layout)
// - هنا نستورد فقط: مودالات + ستايل الصفحة
import "../styles/DashboardModals.css";
import "../styles/DashboardOffers.css";

// ✅ Firestore
import {
  listOffers,
  upsertOffer,
  removeOffer,
} from "../services/firestoreOffers";
import type {
  Offer,
  DiscountType,
  OfferAppliesTo,
} from "../services/firestoreOffers";

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
};

const MAX_IMAGE_MB = 2;
const SALON_ID = "main";

function generateCode(prefix = "QS") {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const time = Date.now().toString().slice(-4);
  return `${prefix}-${rand}${time}`;
}

function makeOfferId() {
  const anyCrypto: any = globalThis.crypto as any;
  if (anyCrypto?.randomUUID) return `O-${anyCrypto.randomUUID()}`;
  return `O-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
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

const DashboardOffers: React.FC = () => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);

  const [query, setQuery] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [pickedImageName, setPickedImageName] = useState("");

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
  });

  /* =========================
     ✅ Custom Dropdown: Discount Type
  ========================= */
  const [discountOpen, setDiscountOpen] = useState(false);
  const discountWrapRef = useRef<HTMLDivElement | null>(null);

  const discountOptions = useMemo(
    () => [
      { value: "fixed" as DiscountType, label: "مبلغ ثابت" },
      { value: "percent" as DiscountType, label: "نسبة مئوية" },
    ],
    []
  );

  const discountLabel =
    discountOptions.find((o) => o.value === form.discountType)?.label || "اختر";

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

  // ✅ اقفل سكرول الصفحة لما المودال يفتح
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
    return;
  }, [open]);

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

  const refresh = async () => {
    try {
      const data = await listOffers(SALON_ID);
      setOffers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      console.error("❌ listOffers error:", e?.code, e?.message, e);
      alert("تعذر تحميل العروض من قاعدة البيانات.");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const filteredOffers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return offers;
    return offers.filter((o: any) => {
      const title = String(o.title || "").toLowerCase();
      const code = String(o.code || "").toLowerCase();
      return title.includes(q) || code.includes(q);
    });
  }, [offers, query]);

  const stats = useMemo(() => {
    const total = offers.length;
    const active = offers.filter((o: any) => Boolean(o.active)).length;
    const used = offers.filter(
      (o: any) => Number(o.usageCount || 0) > 0
    ).length;
    return { total, active, used };
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
      serviceIds: Array.isArray((o as any).serviceIds)
        ? (o as any).serviceIds
        : [],
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
    if (!form.title.trim()) return alert("اكتب عنوان العرض");
    if (!form.code.trim()) return alert("اكتب الكود أو اضغط توليد");
    if (Number(form.value) <= 0)
      return alert("قيمة الخصم لازم تكون أكبر من صفر");
    if (form.discountType === "percent" && Number(form.value) > 100)
      return alert("النسبة المئوية لا تتجاوز 100%");
    if (form.startDate && form.endDate && form.startDate > form.endDate)
      return alert("تاريخ البداية لازم يكون قبل النهاية");

    if (form.appliesTo === "services" && form.serviceIds.length === 0) {
      return alert("اختر خدمة واحدة على الأقل أو خلّه ينطبق على الجميع");
    }

    try {
      const id = (editing as any)?.id || makeOfferId();

      const payload: Offer = {
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
        serviceIds: form.appliesTo === "services" ? form.serviceIds : [],

        usageCount: Number((editing as any)?.usageCount || 0),
        createdAt: (editing as any)?.createdAt,
      };

      await upsertOffer(payload, SALON_ID);
      await refresh();
      close();
    } catch (e: any) {
      console.error("❌ upsertOffer error:", e?.code, e?.message, e);
      alert("تعذر حفظ العرض في قاعدة البيانات.");
    }
  };

  const toggleActive = async (o: Offer) => {
    try {
      const current = Boolean((o as any).active);
      await upsertOffer(
        { ...(o as any), id: (o as any).id, active: !current },
        SALON_ID
      );
      await refresh();
    } catch (e: any) {
      console.error("❌ toggleActive error:", e?.code, e?.message, e);
      alert("تعذر تحديث حالة العرض.");
    }
  };

  const remove = async (o: Offer) => {
    if (Number((o as any).usageCount || 0) > 0)
      return alert("لا يمكن حذف عرض مستخدم");
    if (!confirm("حذف العرض؟")) return;

    try {
      await removeOffer((o as any).id, SALON_ID);
      await refresh();
    } catch (e: any) {
      console.error("❌ removeOffer error:", e?.code, e?.message, e);
      alert("تعذر حذف العرض.");
    }
  };

  const onPickImage = async (file: File | null) => {
    if (!file) return;

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > MAX_IMAGE_MB) {
      alert(`حجم الصورة لازم يكون أقل من ${MAX_IMAGE_MB}MB`);
      return;
    }

    setPickedImageName(file.name);

    const b64 = await fileToBase64(file);
    setForm((p) => ({ ...p, imageUrl: b64 }));
  };

  const toggleServiceId = (id: string) => {
    setForm((p) => {
      const exists = p.serviceIds.includes(id);
      const next = exists
        ? p.serviceIds.filter((x) => x !== id)
        : [...p.serviceIds, id];
      return { ...p, serviceIds: next };
    });
  };

  return (
    <div className="dashboard-skin offers-page">
      {/* Header */}
      <div className="offers-header">
        <div>
          <h1>
            <FontAwesomeIcon icon={faTag} /> العروض والكوبونات
          </h1>
          <p className="offers-sub">
            إدارة العروض + صورة + نطاق (الكل/خدمات محددة)
          </p>
        </div>
      </div>

      {/* Search + Add */}
      <div className="offers-card">
        <div className="offers-card-title">
          <FontAwesomeIcon icon={faMagnifyingGlass} /> بحث (عنوان / كود)
        </div>

        <div className="offers-row">
          <div className="offers-search">
            <FontAwesomeIcon
              className="offers-search-ic"
              icon={faMagnifyingGlass}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث بالعنوان أو الكود..."
            />
          </div>

          <button
            className="dash-pill dash-pill-primary"
            type="button"
            onClick={openAdd}
          >
            <FontAwesomeIcon icon={faPlus} /> إضافة عرض
          </button>
        </div>

        <div className="offers-hint">اكتب عنوان العرض أو كود الخصم</div>
      </div>

      {/* Stats */}
      <div className="offers-stats">
        <div className="of-stat">
          <h3>{stats.total}</h3>
          <p>إجمالي العروض</p>
        </div>
        <div className="of-stat">
          <h3>{stats.active}</h3>
          <p>عروض نشطة</p>
        </div>
        <div className="of-stat">
          <h3>{stats.used}</h3>
          <p>عروض مستخدمة</p>
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
                  <td colSpan={9} style={{ textAlign: "center", padding: 16 }}>
                    لا توجد عروض مطابقة
                  </td>
                </tr>
              ) : (
                filteredOffers.map((o: any) => (
                  <tr key={o.id} style={{ verticalAlign: "middle" }}>
                    <td>
                      {o.imageUrl ? (
                        <img className="of-img" src={o.imageUrl} alt="offer" />
                      ) : (
                        <span style={{ opacity: 0.6 }}>—</span>
                      )}
                    </td>
                    <td>{o.title}</td>
                    <td>{o.code}</td>
                    <td>
                      {o.discountType === "percent"
                        ? `${o.value}%`
                        : `${o.value} ريال`}
                    </td>
                    <td>
                      {o.startDate || "—"} → {o.endDate || "—"}
                    </td>
                    <td>{o.active ? "نشط" : "موقوف"}</td>
                    <td>{o.usageCount || 0}</td>
                    <td>
                      {(o.appliesTo || "all") === "services"
                        ? "خدمات محددة"
                        : "الكل"}
                    </td>

                    <td>
                      <div className="of-actions">
                        <button
                          className="dash-pill dash-pill-outline dash-pill-sm"
                          type="button"
                          onClick={() => openEdit(o)}
                        >
                          <FontAwesomeIcon icon={faPen} /> تعديل
                        </button>

                        <button
                          className={`dash-pill ${
                            o.active ? "dash-pill-warning" : "dash-pill-success"
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
                          onClick={() => remove(o)}
                        >
                          <FontAwesomeIcon icon={faTrash} /> حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div
          className="dash-modal-overlay offers-modal-overlay"
          onClick={close}
        >
          <div
            className="dash-modal offers-modal offers-modal--fullscreen"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header (Fixed) */}
            <div className="of-modal-head">
              <div className="of-modal-title">
                <h3>{editing ? "تعديل عرض" : "إضافة عرض"}</h3>
                <span className="of-modal-sub">
                  املأ البيانات ثم اختر النطاق والصورة
                </span>
              </div>

              <button
                className="dash-pill dash-pill-outline dash-pill-sm"
                type="button"
                onClick={close}
              >
                <FontAwesomeIcon icon={faXmark} /> إغلاق
              </button>
            </div>

            {/* Body */}
            <div className="of-form">
              <div className="of-section">
                <div className="of-grid-2a">
                  <div>
                    <label>العنوان</label>
                    <input
                      value={form.title}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, title: e.target.value }))
                      }
                      placeholder="مثال: خصم نهاية الأسبوع"
                    />
                  </div>

                  <div className="of-field-inline">
                    <div style={{ flex: 1 }}>
                      <label>الكود</label>
                      <input
                        value={form.code}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, code: e.target.value }))
                        }
                        placeholder="QS-XXXX"
                      />
                    </div>

                    <button
                      className="dash-pill dash-pill-outline dash-pill-sm"
                      type="button"
                      onClick={() =>
                        setForm((p) => ({ ...p, code: generateCode() }))
                      }
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
                      <button
                        type="button"
                        className="dash-select"
                        onClick={() => setDiscountOpen((s) => !s)}
                        aria-expanded={discountOpen}
                      >
                        {discountLabel}
                      </button>

                      {discountOpen && (
                        <div className="dash-dd-menu" role="listbox">
                          {discountOptions.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              className={`dash-dd-item ${
                                form.discountType === opt.value
                                  ? "is-active"
                                  : ""
                              }`}
                              onClick={() => {
                                setForm((p) => ({
                                  ...p,
                                  discountType: opt.value,
                                }));
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
                      onChange={(e) =>
                        setForm((p) => ({
                          ...p,
                          value: Number(e.target.value),
                        }))
                      }
                      placeholder="مثال: 50"
                    />
                  </div>

                  <div className="of-switch">
                    <label className="of-checkline">
                      <input
                        type="checkbox"
                        checked={form.active}
                        onChange={(e) =>
                          setForm((p) => ({ ...p, active: e.target.checked }))
                        }
                      />
                      <span>العرض نشط</span>
                    </label>
                  </div>
                </div>

                <div className="of-grid-2">
                  <div>
                    <label>تاريخ البداية</label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, startDate: e.target.value }))
                      }
                    />
                  </div>

                  <div>
                    <label>تاريخ النهاية</label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, endDate: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>

              {/* نطاق العرض */}
              <div className="of-section of-scope">
                <div className="of-scope-top">
                  <div className="of-scope-title">نطاق العرض</div>
                  <div className="of-scope-hint">
                    اختر “خدمات محددة” إذا تبي العرض على خدمات بعينها.
                  </div>
                </div>

                <div className="of-scope-pills">
                  <label className="of-pill">
                    <input
                      type="radio"
                      name="offerScope"
                      checked={form.appliesTo === "all"}
                      onChange={() =>
                        setForm((p) => ({
                          ...p,
                          appliesTo: "all",
                          serviceIds: [],
                        }))
                      }
                    />
                    <span>ينطبق على جميع الخدمات</span>
                  </label>

                  <label className="of-pill">
                    <input
                      type="radio"
                      name="offerScope"
                      checked={form.appliesTo === "services"}
                      onChange={() =>
                        setForm((p) => ({ ...p, appliesTo: "services" }))
                      }
                    />
                    <span>ينطبق على خدمات محددة</span>
                  </label>
                </div>

                {form.appliesTo === "services" && (
                  <>
                    <div className="of-services-search">
                      <FontAwesomeIcon
                        className="of-services-ic"
                        icon={faMagnifyingGlass}
                      />
                      <input
                        value={serviceSearch}
                        onChange={(e) => setServiceSearch(e.target.value)}
                        placeholder="بحث داخل الخدمات..."
                      />
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
                              <td
                                colSpan={3}
                                style={{ textAlign: "center", padding: 14 }}
                              >
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
                                          checked={form.serviceIds.includes(
                                            s.id
                                          )}
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
                  </>
                )}
              </div>

              {/* صورة العرض */}
              <div className="of-section">
                <label className="of-label-inline">
                  <FontAwesomeIcon icon={faImage} /> صورة العرض{" "}
                  <span className="of-mute">(أقل من {MAX_IMAGE_MB}MB)</span>
                </label>

                <div className="of-file-row">
                  <label className="of-file-btn">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => onPickImage(e.target.files?.[0] || null)}
                    />
                    اختيار ملف
                  </label>

                  <div className="of-file-name">
                    {pickedImageName || "لم يتم اختيار أي ملف"}
                  </div>
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
              <button
                className="dash-pill dash-pill-primary"
                type="button"
                onClick={save}
              >
                حفظ
              </button>
              <button
                className="dash-pill dash-pill-outline"
                type="button"
                onClick={close}
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardOffers;
