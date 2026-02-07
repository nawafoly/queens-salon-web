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

// ✅ Firestore
import { listOffers, upsertOffer, removeOffer } from "../services/firestoreOffers";
import type { Offer, DiscountType, OfferAppliesTo } from "../services/firestoreOffers";

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

type OfferFilterMode = "active_now" | "scheduled" | "expired" | "deleted";

const MAX_IMAGE_MB = 2;
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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);

  const [queryText, setQueryText] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [pickedImageName, setPickedImageName] = useState("");
  const [filterMode, setFilterMode] = useState<OfferFilterMode>("active_now");

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
    if (Number(form.value) <= 0) return alert("قيمة الخصم لازم تكون أكبر من صفر");
    if (form.discountType === "percent" && Number(form.value) > 100) return alert("النسبة المئوية لا تتجاوز 100%");
    if (form.startDate && form.endDate && form.startDate > form.endDate) return alert("تاريخ البداية لازم يكون قبل النهاية");

    if (form.appliesTo === "services" && form.serviceIds.length === 0) {
      return alert("اختر خدمة واحدة على الأقل أو خلّه ينطبق على الجميع");
    }

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
        serviceIds: form.appliesTo === "services" ? form.serviceIds : [],

        usageCount: Number((editing as any)?.usageCount || 0),
        createdAt: (editing as any)?.createdAt,

        ...(deletedAt === null ? { deletedAt: null } : {}),
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
      await upsertOffer({ ...(o as any), id: (o as any).id, active: !current }, SALON_ID);
      await refresh();
    } catch (e: any) {
      console.error("❌ toggleActive error:", e?.code, e?.message, e);
      alert("تعذر تحديث حالة العرض.");
    }
  };

  // ✅ حذف ناعم (Soft Delete) بدل حذف نهائي
  const softDelete = async (o: Offer) => {
    if (Number((o as any).usageCount || 0) > 0) return alert("لا يمكن حذف عرض مستخدم");
    if (!confirm("حذف العرض (نقل للمحذوفات)؟")) return;

    try {
      await upsertOffer(
        { ...(o as any), id: (o as any).id, active: false, deletedAt: Date.now() } as any,
        SALON_ID
      );
      await refresh();
    } catch (e: any) {
      console.error("❌ softDelete error:", e?.code, e?.message, e);
      alert("تعذر حذف العرض.");
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
      alert("تعذر استرجاع العرض.");
    }
  };

  // ✅ حذف نهائي (اختياري فقط من تبويب المحذوفات)
  const hardDelete = async (o: Offer) => {
    if (Number((o as any).usageCount || 0) > 0) return alert("لا يمكن حذف عرض مستخدم");
    if (!confirm("⚠️ حذف نهائي؟ لا يمكن التراجع")) return;

    try {
      await removeOffer((o as any).id, SALON_ID);
      await refresh();
    } catch (e: any) {
      console.error("❌ removeOffer error:", e?.code, e?.message, e);
      alert("تعذر حذف العرض نهائيًا.");
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
      const next = exists ? p.serviceIds.filter((x) => x !== id) : [...p.serviceIds, id];
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
          <p className="offers-sub">فلترة: سارية / مجدولة / منتهية / محذوفة + نطاق (الكل/خدمات)</p>
        </div>
      </div>

      {/* Filters + Add */}
      <div className="offers-card">
        <div className="offers-card-title">
          <FontAwesomeIcon icon={faFilter} /> فلترة + بحث
        </div>

        <div className="offers-row" style={{ flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

          <div className="offers-search" style={{ minWidth: 260, flex: 1 }}>
            <FontAwesomeIcon className="offers-search-ic" icon={faMagnifyingGlass} />
            <input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder="بحث بالعنوان أو الكود..." />
          </div>

          <button className="dash-pill dash-pill-primary" type="button" onClick={openAdd}>
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
                      onChange={() => setForm((p) => ({ ...p, appliesTo: "all", serviceIds: [] }))}
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
