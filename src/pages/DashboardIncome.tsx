// ✅ src/pages/DashboardIncome.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faSearch,
  faFilter,
  faFileCsv,
  faTrash,
  faRotate,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/DashboardIncome.css";
import "../styles/DashboardModals.css";

// ✅ Firebase Auth
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";

// ✅ Firestore Income
import {
  listAllIncomeFS,
  removeIncomeFS,
  upsertIncomeFS,
} from "../services/firestoreIncome";

import type { IncomeItem, PaymentMethod } from "../types/finance";

const ALL_BOOKINGS_KEY = "allBookings";

// ✅ LocalStorage Income (Migration)
const LEGACY_INCOME_KEY = "dashboard_income_v1";
const INCOME_MIGRATED_KEY = "income_migrated_to_firestore_v1";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function methodLabel(m: PaymentMethod) {
  if (m === "cash") return "كاش";
  if (m === "card") return "شبكة";
  if (m === "transfer") return "تحويل";
  return "أخرى";
}

function toCsv(items: IncomeItem[]) {
  const header = ["date", "amount", "method", "source", "note"].join(",");
  const lines = items.map((x) =>
    [
      x.date,
      x.amount,
      methodLabel(x.method),
      (x.source || "").replaceAll(",", " "),
      (x.note || "").replaceAll(",", " "),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

// ✅ قراءة الحجوزات من التخزين
function loadBookings(): any[] {
  try {
    const raw = localStorage.getItem(ALL_BOOKINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ✅ نعتبر الإيراد "محقق" فقط لو confirmed أو completed
function isRevenueStatus(status: any) {
  const s = String(status || "").toLowerCase().trim();
  return s === "confirmed" || s === "completed";
}

// ✅ تطبيع طريقة الدفع
function normalizePaymentMethod(x: any): PaymentMethod {
  const s = String(x || "").toLowerCase().trim();
  if (s === "cash") return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online") return "card";
  if (s === "transfer") return "transfer";
  return "other";
}

// ✅ تحميل الإيرادات القديمة من LocalStorage (للترحيل)
function loadLegacyIncome(): IncomeItem[] {
  try {
    const raw = localStorage.getItem(LEGACY_INCOME_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((x: any) => {
        const amount = Number(x.amount ?? 0);
        const date = String(x.date || "").trim();
        if (!date || !amount || amount <= 0) return null;

        const item: IncomeItem = {
          id: String(x.id || uid()),
          date,
          amount,
          method: normalizePaymentMethod(x.method),
          source: String(x.source || "دخل"),
          note: x.note ? String(x.note) : undefined,
          bookingId: x.bookingId ? String(x.bookingId) : undefined,
          createdAt: Number(x.createdAt || Date.now()),
        };

        return item;
      })
      .filter(Boolean) as IncomeItem[];
  } catch {
    return [];
  }
}

function firebaseMsg(e: any) {
  const msg = String(e?.message || e || "");
  if (msg.includes("Missing or insufficient permissions")) {
    return "⚠️ لا توجد صلاحيات كافية. تأكد من Firestore Rules + role داخل users/{uid} + تسجيل الدخول.";
  }
  if (msg.includes("not-found")) {
    return "⚠️ المسار غير موجود. تأكد من اسم الـ collection ومسار السيرفس.";
  }
  if (msg.includes("requires an index")) {
    return "⚠️ الاستعلام يحتاج Index. لكن عندنا fallback، فإذا تكرر كثير غالبًا عندك استعلام ثاني مختلف في مكان آخر.";
  }
  return "تعذر تنفيذ العملية. راجع Console لمعرفة السبب.";
}

export default function DashboardIncome() {
  const [items, setItems] = useState<IncomeItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ Migration state
  const [hasLegacyIncome, setHasLegacyIncome] = useState(false);
  const [legacyCount, setLegacyCount] = useState(0);
  const [migrated, setMigrated] = useState(
    localStorage.getItem(INCOME_MIGRATED_KEY) === "1"
  );

  // ✅ Modals (Unified like Expenses)
  const [addOpen, setAddOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState<string>("");

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title?: string;
    message?: string;
    onConfirm?: () => void;
  }>({ open: false });

  // Form
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [source, setSource] = useState("حجز");
  const [note, setNote] = useState("");

  // Filters
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [methodFilter, setMethodFilter] = useState<PaymentMethod | "all">("all");

  /* =========================
     ✅ Custom Dropdowns: Payment Method
     - filter dropdown
     - add modal dropdown
  ========================= */
  const [methodFilterOpen, setMethodFilterOpen] = useState(false);
  const [methodAddOpen, setMethodAddOpen] = useState(false);

  const methodFilterWrapRef = useRef<HTMLDivElement | null>(null);
  const methodAddWrapRef = useRef<HTMLDivElement | null>(null);

  const paymentOptions = useMemo(
    () => [
      { value: "all" as const, label: "الكل" },
      { value: "cash" as const, label: "كاش" },
      { value: "card" as const, label: "شبكة" },
      { value: "transfer" as const, label: "تحويل" },
      { value: "other" as const, label: "أخرى" },
    ],
    []
  );

  const methodOnlyOptions = useMemo(
    () => paymentOptions.filter((x) => x.value !== "all") as Array<{
      value: PaymentMethod;
      label: string;
    }>,
    [paymentOptions]
  );

  const methodFilterLabel =
    paymentOptions.find((o) => o.value === methodFilter)?.label || "اختر";

  const methodAddLabel =
    methodOnlyOptions.find((o) => o.value === method)?.label || "اختر";

  // ✅ Close dropdowns on outside click / ESC
  useEffect(() => {
    const anyOpen = methodFilterOpen || methodAddOpen;
    if (!anyOpen) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;

      const inFilter = methodFilterWrapRef.current?.contains(t);
      const inAdd = methodAddWrapRef.current?.contains(t);

      if (inFilter || inAdd) return;

      setMethodFilterOpen(false);
      setMethodAddOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMethodFilterOpen(false);
        setMethodAddOpen(false);
      }
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [methodFilterOpen, methodAddOpen]);

  const resetFilters = () => {
    setFrom("");
    setTo("");
    setQ("");
    setMethodFilter("all");
    setMethodFilterOpen(false);
  };

  // ✅ تحميل Firestore
  const loadIncome = async () => {
    try {
      setLoading(true);
      const data = await listAllIncomeFS();
      setItems(data);
    } catch (e) {
      console.error("listAllIncomeFS error:", e);
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  // ✅ تحميل بعد ثبات تسجيل الدخول (مرة وحدة)
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        setLoading(true);

        const user = await new Promise<import("firebase/auth").User | null>(
          (resolve) => {
            const unsub = onAuthStateChanged(auth, (u) => {
              unsub();
              resolve(u);
            });
          }
        );

        if (!user) {
          if (mounted) {
            setItems([]);
            setLoading(false);
            setModalMsg("لا يوجد مستخدم مسجل دخول. سجّل دخول الإدارة ثم جرّب.");
          }
          return;
        }

        if (mounted) await loadIncome();

        // ✅ كشف بيانات Legacy مرة واحدة
        try {
          const legacy = loadLegacyIncome();
          const already = localStorage.getItem(INCOME_MIGRATED_KEY) === "1";
          if (mounted) {
            setLegacyCount(legacy.length);
            setHasLegacyIncome(legacy.length > 0);
            setMigrated(already);
          }
        } catch {
          // ignore
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ مزامنة من الحجوزات -> Firestore income (بدون تكرار)
  const syncFromBookings = async () => {
    try {
      const bookings = loadBookings().filter((b) => isRevenueStatus(b.status));

      const existingBookingIds = new Set(
        items.map((x) => x.bookingId).filter(Boolean) as string[]
      );

      const toAdd: IncomeItem[] = [];

      for (const b of bookings) {
        const bookingId = String(b.id || "");
        if (!bookingId) continue;
        if (existingBookingIds.has(bookingId)) continue;

        const amt = Number(b.total ?? 0);
        if (!amt || amt <= 0) continue;

        const serviceName = b.serviceName || b.service || "حجز";
        const clientName = b.clientName || b.name || b.customerName || "عميلة";

        toAdd.push({
          id: uid(),
          date: String(b.date || todayISO()),
          amount: amt,
          method: normalizePaymentMethod(b.paymentMethod),
          source: `حجز - ${serviceName}`,
          note: `حجز ${bookingId} | ${clientName}`,
          bookingId,
          createdAt: Date.now(),
        });
      }

      if (toAdd.length === 0) {
        setModalMsg("لا يوجد حجوزات جديدة للمزامنة ✅");
        return;
      }

      setLoading(true);
      await Promise.all(toAdd.map((x) => upsertIncomeFS(x)));

      await loadIncome();
      window.dispatchEvent(new Event("financeChanged"));

      setModalMsg(`تمت مزامنة ${toAdd.length} إيراد ✅`);
    } catch (e) {
      console.error("syncFromBookings error:", e);
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  // ✅ ترحيل الإيرادات من LocalStorage -> Firestore (مرة واحدة)
  const migrateLegacyIncomeOnce = async () => {
    try {
      const already = localStorage.getItem(INCOME_MIGRATED_KEY) === "1";
      if (already) {
        setModalMsg("تم الترحيل مسبقًا ✅");
        setMigrated(true);
        return;
      }

      const legacy = loadLegacyIncome();
      if (legacy.length === 0) {
        setModalMsg("لا توجد بيانات قديمة في LocalStorage ✅");
        setHasLegacyIncome(false);
        setLegacyCount(0);
        return;
      }

      setConfirmState({
        open: true,
        title: "ترحيل الإيرادات",
        message:
          `سيتم ترحيل ${legacy.length} سجل من LocalStorage إلى Firestore.\n` +
          `ملاحظة: العملية مرة واحدة ولن تتكرر.\n\nتأكيد؟`,
        onConfirm: async () => {
          try {
            setLoading(true);

            const existingIds = new Set(items.map((x) => x.id));
            const toUpsert = legacy.filter((x) => !existingIds.has(x.id));

            if (toUpsert.length === 0) {
              localStorage.setItem(INCOME_MIGRATED_KEY, "1");
              localStorage.removeItem(LEGACY_INCOME_KEY);

              setMigrated(true);
              setHasLegacyIncome(false);
              setLegacyCount(0);

              setModalMsg("كل السجلات موجودة بالفعل في Firestore ✅");
              return;
            }

            await Promise.all(toUpsert.map((x) => upsertIncomeFS(x)));

            localStorage.setItem(INCOME_MIGRATED_KEY, "1");
            localStorage.removeItem(LEGACY_INCOME_KEY);

            setMigrated(true);
            setHasLegacyIncome(false);
            setLegacyCount(0);

            await loadIncome();
            window.dispatchEvent(new Event("financeChanged"));

            setModalMsg(`تم ترحيل ${toUpsert.length} سجل إلى Firestore ✅`);
          } catch (e) {
            console.error("migrateLegacyIncomeOnce error:", e);
            setModalMsg(firebaseMsg(e));
          } finally {
            setLoading(false);
            setConfirmState({ open: false });
          }
        },
      });
    } catch (e) {
      console.error("migrateLegacyIncomeOnce error:", e);
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    return items
      .filter((x) => {
        if (from && x.date < from) return false;
        if (to && x.date > to) return false;
        if (methodFilter !== "all" && x.method !== methodFilter) return false;
        if (q.trim()) {
          const s = `${x.source} ${x.note || ""}`.toLowerCase();
          if (!s.includes(q.toLowerCase())) return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          (b.createdAt || 0) - (a.createdAt || 0)
      );
  }, [items, from, to, q, methodFilter]);

  const total = useMemo(
    () => filtered.reduce((sum, x) => sum + (Number(x.amount) || 0), 0),
    [filtered]
  );

  const totalsByMethod = useMemo(() => {
    const out: Record<string, number> = {
      cash: 0,
      card: 0,
      transfer: 0,
      other: 0,
    };
    for (const x of filtered)
      out[x.method] = (out[x.method] || 0) + (Number(x.amount) || 0);
    return out as Record<PaymentMethod, number>;
  }, [filtered]);

  const addIncome = async () => {
    const n = Number(amount);

    if (!date) return setModalMsg("اختر التاريخ");
    if (!Number.isFinite(n) || n <= 0) return setModalMsg("اكتب مبلغ صحيح");
    if (!source.trim()) return setModalMsg("اكتب مصدر الدخل");

    const newItem: IncomeItem = {
      id: uid(),
      date,
      amount: n,
      method,
      source: source.trim() || "دخل",
      note: note.trim() || undefined,
      createdAt: Date.now(),
    };

    try {
      setLoading(true);
      await upsertIncomeFS(newItem);
      await loadIncome();
      window.dispatchEvent(new Event("financeChanged"));

      setAmount("");
      setNote("");
      setSource("حجز");
      setMethod("cash");
      setAddOpen(false);
      setModalMsg("تمت إضافة الدخل ✅");
    } catch (e) {
      console.error("upsertIncomeFS error:", e);
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const askRemove = (id: string) => {
    setConfirmState({
      open: true,
      title: "تأكيد الحذف",
      message: "متأكد تبغى حذف الإيراد؟",
      onConfirm: async () => {
        try {
          setLoading(true);
          await removeIncomeFS(id);
          await loadIncome();
          window.dispatchEvent(new Event("financeChanged"));
          setModalMsg("تم حذف الإيراد ✅");
        } catch (e) {
          console.error("removeIncomeFS error:", e);
          setModalMsg(firebaseMsg(e));
        } finally {
          setLoading(false);
          setConfirmState({ open: false });
        }
      },
    });
  };

  const exportCsv = () => {
    if (!filtered.length) return setModalMsg("ما فيه بيانات للتصدير");
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `income_${todayISO()}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  return (
    <div className="dashboard-section income-page">
      {/* Header */}
      <div className="income-header">
        <div>
          <h2 style={{ margin: 0 }}>الإيرادات</h2>
          <p style={{ margin: "6px 0 0", color: "#777" }}>
            إضافة دخل + فلترة + <FontAwesomeIcon icon={faFileCsv} /> تصدير
          </p>
          {loading ? (
            <p style={{ margin: "8px 0 0", color: "#999" }}>جاري التحميل...</p>
          ) : null}
        </div>

        <div className="income-actions">
          {hasLegacyIncome && !migrated ? (
            <button
              className="dash-pill dash-pill-outline"
              type="button"
              onClick={migrateLegacyIncomeOnce}
              disabled={loading}
              title="ترحيل الإيرادات القديمة من LocalStorage إلى Firestore (مرة واحدة)"
            >
              <FontAwesomeIcon icon={faRotate} /> ترحيل من LocalStorage ({legacyCount})
            </button>
          ) : null}

          <button
            className="dash-pill dash-pill-outline"
            type="button"
            onClick={syncFromBookings}
            disabled={loading}
          >
            <FontAwesomeIcon icon={faRotate} /> مزامنة من الحجوزات
          </button>

          <button
            className="dash-pill dash-pill-outline"
            type="button"
            onClick={loadIncome}
            disabled={loading}
            title="تحديث من Firestore"
          >
            <FontAwesomeIcon icon={faRotate} /> إعادة تعبئة
          </button>

          <button
            className="dash-pill dash-pill-outline"
            type="button"
            onClick={exportCsv}
            disabled={loading || filtered.length === 0}
            title="تصدير CSV حسب الفلترة"
          >
            <FontAwesomeIcon icon={faFileCsv} /> تصدير CSV
          </button>

          <button
            className="dash-pill dash-pill-primary"
            type="button"
            onClick={() => {
              setAddOpen(true);
              setMethodAddOpen(false);
              setMethodFilterOpen(false);
            }}
          >
            <FontAwesomeIcon icon={faPlus} /> إضافة دخل
          </button>

          <div className="stat-card" style={{ minWidth: 220 }}>
            <div className="stat-info">
              <h3>{total.toLocaleString()}</h3>
              <p>الإجمالي (حسب الفلترة)</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div className="income-quick">
        <div className="stat-card">
          <div className="stat-info">
            <h3>{(totalsByMethod.cash || 0).toLocaleString()}</h3>
            <p>كاش</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <h3>{(totalsByMethod.card || 0).toLocaleString()}</h3>
            <p>شبكة</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <h3>{(totalsByMethod.transfer || 0).toLocaleString()}</h3>
            <p>تحويل</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-info">
            <h3>{(totalsByMethod.other || 0).toLocaleString()}</h3>
            <p>أخرى</p>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="dash-card" style={{ marginTop: 16, padding: 16 }}>
        <div className="income-filter-head">
          <h4 style={{ margin: 0 }}>
            <FontAwesomeIcon icon={faFilter} /> فلترة
          </h4>

          <button
            className="dash-pill dash-pill-outline dash-pill-sm"
            type="button"
            onClick={resetFilters}
            disabled={loading}
            title="تصفير الفلاتر"
          >
            <FontAwesomeIcon icon={faRotate} /> تصفير
          </button>
        </div>

        <div className="row" style={{ rowGap: 12, marginTop: 12 }}>
          <div className="col-md-3">
            <label>من</label>
            <input
              className="form-control"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div className="col-md-3">
            <label>إلى</label>
            <input
              className="form-control"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <div className="col-md-3">
            <label>طريقة الدفع</label>

            {/* ✅ Custom Dropdown (Filter) */}
            <div className="dash-dd-wrap" ref={methodFilterWrapRef}>
              <button
                type="button"
                className="dash-select"
                onClick={() => {
                  setMethodFilterOpen((s) => !s);
                  setMethodAddOpen(false);
                }}
                aria-expanded={methodFilterOpen}
              >
                {methodFilterLabel}
              </button>

              {methodFilterOpen && (
                <div className="dash-dd-menu" role="listbox">
                  {paymentOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`dash-dd-item ${methodFilter === opt.value ? "is-active" : ""
                        }`}
                      onClick={() => {
                        setMethodFilter(opt.value as any);
                        setMethodFilterOpen(false);
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="col-md-3">
            <label>بحث</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="form-control"
                placeholder="ابحث بالمصدر/الملاحظة..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button className="dash-pill dash-pill-outline dash-pill-sm" type="button" title="بحث">
                <FontAwesomeIcon icon={faSearch} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="dash-card" style={{ marginTop: 16, padding: 16 }}>
        <div className="income-table-head">
          <h3 style={{ margin: 0 }}>السجل</h3>
          <div style={{ color: "#777", fontSize: 13 }}>
            عدد السجلات: {filtered.length}
          </div>
        </div>

        <div className="income-table-wrap">
          <div className="table-responsive">
            <table className="table dashboard-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>طريقة الدفع</th>
                  <th>المصدر</th>
                  <th>ملاحظة</th>
                  <th>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: 16 }}>
                      لا توجد بيانات
                    </td>
                  </tr>
                ) : (
                  filtered.map((x) => (
                    <tr key={x.id}>
                      <td>{x.date}</td>
                      <td>{x.amount.toLocaleString()} ريال</td>
                      <td>{methodLabel(x.method)}</td>
                      <td>{x.source}</td>
                      <td>{x.note || "-"}</td>
                      <td>
                        <button
                          className="dash-pill dash-pill-danger dash-pill-sm"
                          onClick={() => askRemove(x.id)}
                          disabled={loading}
                          type="button"
                          title="حذف"
                        >
                          <FontAwesomeIcon icon={faTrash} /> حذف
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ✅ Add Income Modal */}
      {addOpen ? (
        <div className="modal-overlay" onClick={() => setAddOpen(false)}>
          <div className="modal-box is-info" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title-wrap">
                <div className="modal-icon">➕</div>
                <h3 className="modal-title">إضافة دخل</h3>
              </div>
              <button className="dash-pill dash-pill-sm " onClick={() => setAddOpen(false)} type="button">
                ✕ إغلاق
              </button>
            </div>

            <div className="modal-body">
              <div className="row" style={{ rowGap: 12 }}>
                <div className="col-md-6">
                  <label>التاريخ</label>
                  <input
                    className="form-control"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>

                <div className="col-md-6">
                  <label>المبلغ</label>
                  <input
                    className="form-control"
                    type="number"
                    placeholder="مثال: 150"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>

                <div className="col-md-6">
                  <label>طريقة الدفع</label>

                  {/* ✅ Custom Dropdown (Add Modal) */}
                  <div className="dash-dd-wrap" ref={methodAddWrapRef}>
                    <button
                      type="button"
                      className="dash-select"
                      onClick={() => {
                        setMethodAddOpen((s) => !s);
                        setMethodFilterOpen(false);
                      }}
                      aria-expanded={methodAddOpen}
                    >
                      {methodAddLabel}
                    </button>

                    {methodAddOpen && (
                      <div className="dash-dd-menu" role="listbox">
                        {methodOnlyOptions.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            className={`dash-dd-item ${method === opt.value ? "is-active" : ""}`}
                            onClick={() => {
                              setMethod(opt.value);
                              setMethodAddOpen(false);
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-md-6">
                  <label>المصدر</label>
                  <input
                    className="form-control"
                    placeholder="حجز / بيع منتج / خدمة"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </div>

                <div className="col-md-12">
                  <label>ملاحظة (اختياري)</label>
                  <input
                    className="form-control"
                    placeholder="أي ملاحظة..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="dash-pill dash-pill-primary" onClick={addIncome} disabled={loading}>
                حفظ
              </button>
              <button
                className="dash-pill dash-pill-outline"
                onClick={() => setAddOpen(false)}
                type="button"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ✅ Alert Modal */}
      {modalMsg ? (
        <div className="modal-overlay" onClick={() => setModalMsg("")}>
          <div className="modal-box is-info" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title-wrap">
                <div className="modal-icon">ℹ️</div>
                <h3 className="modal-title">تنبيه</h3>
              </div>
              <button className="modal-close" onClick={() => setModalMsg("")} type="button">
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-text">{modalMsg}</p>
            </div>

            <div className="modal-actions">
              <button className="dash-pill dash-pill-primary" onClick={() => setModalMsg("")} type="button">
                حسناً
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ✅ Confirm Modal */}
      {confirmState.open ? (
        <div className="modal-overlay" onClick={() => setConfirmState({ open: false })}>
          <div className="modal-box is-danger" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title-wrap">
                <div className="modal-icon">⚠️</div>
                <h3 className="modal-title">{confirmState.title || "تأكيد"}</h3>
              </div>
              <button
                className="modal-close"
                onClick={() => setConfirmState({ open: false })}
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-text" style={{ whiteSpace: "pre-line" }}>
                {confirmState.message || ""}
              </p>
            </div>

            <div className="modal-actions">
              <button
                className="dash-pill dash-pill-danger"
                onClick={async () => {
                  const fn = confirmState.onConfirm;
                  if (fn) await fn();
                  else setConfirmState({ open: false });
                }}
                type="button"
              >
                تأكيد
              </button>

              <button
                className="dash-pill dash-pill-danger"
                onClick={() => setConfirmState({ open: false })}
                type="button"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
