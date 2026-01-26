

// ✅ src/pages/DashboardIncome.tsx
import { useEffect, useMemo, useState } from "react";
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

import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";

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
  const header = ["date", "amount", "method", "source", "note", "id"].join(",");
  const lines = items.map((x) =>
    [
      x.date,
      x.amount,
      methodLabel(x.method),
      (x.source || "").replaceAll(",", " "),
      (x.note || "").replaceAll(",", " "),
      String(x.id || ""),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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

function isRevenueStatus(status: any) {
  const s = String(status || "").toLowerCase().trim();
  return s === "confirmed" || s === "completed";
}

/**
 * ✅ PATCH: تطبيع طريقة الدفع (يدعم العربي + القديم)
 * ✅ هذا مهم للـ Migration من LocalStorage حتى ما تتحول "كاش/شبكة" إلى other
 */
function normalizePaymentMethod(x: any): PaymentMethod {
  const s = String(x ?? "").toLowerCase().trim();

  // already normalized
  if (s === "cash") return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online") return "card";
  if (s === "transfer") return "transfer";
  if (s === "other") return "other";

  // arabic / legacy
  if (s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("بطاق"))
    return "card";
  if (s.includes("تحويل")) return "transfer";

  return "other";
}

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

        return {
          id: String(x.id || uid()),
          date,
          amount,
          method: normalizePaymentMethod(x.method),
          source: String(x.source || "دخل"),
          note: x.note ? String(x.note) : undefined,
          bookingId: x.bookingId ? String(x.bookingId) : undefined,
          createdAt: Number(x.createdAt || Date.now()),
        } as IncomeItem;
      })
      .filter(Boolean) as IncomeItem[];
  } catch {
    return [];
  }
}

function firebaseMsg(e: any) {
  const msg = String(e?.message || e || "");
  if (msg.includes("Missing or insufficient permissions"))
    return "⚠️ لا توجد صلاحيات كافية.";
  if (msg.includes("not-found")) return "⚠️ المسار غير موجود.";
  if (msg.includes("requires an index")) return "⚠️ الاستعلام يحتاج Index.";
  return "تعذر تنفيذ العملية.";
}

export default function DashboardIncome() {
  const [items, setItems] = useState<IncomeItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState("");

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [source, setSource] = useState("حجز");
  const [note, setNote] = useState("");

  // Filters
  const [q, setQ] = useState("");
  const [fMethod, setFMethod] = useState<PaymentMethod | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await listAllIncomeFS();
      setItems(data);
    } catch (e) {
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

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
          if (mounted) setModalMsg("سجّل دخول الإدارة أولاً");
          return;
        }

        const data = await listAllIncomeFS();

        // ✅ Migration (once)
        const migrated = localStorage.getItem(INCOME_MIGRATED_KEY) === "1";
        if (!migrated && data.length === 0) {
          const legacy = loadLegacyIncome();
          if (legacy.length) {
            for (const it of legacy) {
              await upsertIncomeFS(it);
            }
          }
          localStorage.setItem(INCOME_MIGRATED_KEY, "1");
        } else if (!migrated) {
          localStorage.setItem(INCOME_MIGRATED_KEY, "1");
        }

        const finalData = await listAllIncomeFS();
        if (mounted) setItems(finalData);
      } catch (e) {
        if (mounted) setModalMsg(firebaseMsg(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items
      .filter((x) => {
        if (fMethod !== "all" && x.method !== fMethod) return false;
        if (from && x.date < from) return false;
        if (to && x.date > to) return false;

        if (!qq) return true;
        const a =
          `${x.date} ${x.amount} ${x.source || ""} ${x.note || ""} ${
            x.bookingId || ""
          } ${x.id}`.toLowerCase();
        return a.includes(qq);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [items, q, fMethod, from, to]);

  const total = useMemo(
    () => filtered.reduce((s, x) => s + (Number(x.amount) || 0), 0),
    [filtered]
  );

  const totalCash = useMemo(
    () =>
      filtered
        .filter((x) => x.method === "cash")
        .reduce((s, x) => s + (Number(x.amount) || 0), 0),
    [filtered]
  );

  const totalCard = useMemo(
    () =>
      filtered
        .filter((x) => x.method === "card")
        .reduce((s, x) => s + (Number(x.amount) || 0), 0),
    [filtered]
  );

  const totalTransfer = useMemo(
    () =>
      filtered
        .filter((x) => x.method === "transfer")
        .reduce((s, x) => s + (Number(x.amount) || 0), 0),
    [filtered]
  );

  const addIncome = async () => {
    const n = Number(amount);
    if (!date || !n || n <= 0) return setModalMsg("بيانات غير صحيحة");

    const item: IncomeItem = {
      id: uid(),
      date,
      amount: n,
      method,
      source,
      note: note || undefined,
      createdAt: Date.now(),
    };

    try {
      setLoading(true);
      await upsertIncomeFS(item);
      const next = await listAllIncomeFS();
      setItems(next);
      setAddOpen(false);
      setAmount("");
      setNote("");
      setModalMsg("");
    } catch (e) {
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const removeIncome = async (id: string) => {
    try {
      setLoading(true);
      await removeIncomeFS(id);
      const next = await listAllIncomeFS();
      setItems(next);
    } catch (e) {
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const csv = toCsv(filtered);
    downloadTextFile(`income_${todayISO()}.csv`, csv);
  };

  return (
    <div className="dashboard-section income-page">
      <div className="income-container">
        {/* Header */}
        <div className="income-header">
          <div>
            <h2 style={{ margin: 0 }}>الإيرادات</h2>
            <p style={{ margin: "6px 0 0", opacity: 0.75, fontSize: 13 }}>
              إدارة وتسجيل الإيرادات اليومية
            </p>
          </div>

          <div className="income-actions">
            <button
              className="dash-pill dash-pill-outline"
              onClick={refresh}
              type="button"
              disabled={loading}
              title="تحديث"
            >
              <FontAwesomeIcon icon={faRotate} /> تحديث
            </button>

            <button
              className="dash-pill dash-pill-outline"
              onClick={exportCsv}
              type="button"
              disabled={!filtered.length}
              title="تصدير CSV"
            >
              <FontAwesomeIcon icon={faFileCsv} /> تصدير CSV
            </button>

            <button
              className="dash-pill dash-pill-primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              <FontAwesomeIcon icon={faPlus} /> إضافة دخل
            </button>
          </div>
        </div>

        {/* Quick Stat */}
        <div className="income-quick">
          <div className="stat-card">
            <div className="stat-info">
              <h3>{total.toLocaleString()} ريال</h3>
              <p>الإجمالي (حسب الفلترة)</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-info">
              <h3>{totalCash.toLocaleString()} ريال</h3>
              <p>كاش</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-info">
              <h3>{totalCard.toLocaleString()} ريال</h3>
              <p>شبكة</p>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-info">
              <h3>{totalTransfer.toLocaleString()} ريال</h3>
              <p>تحويل</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="income-filters">
          <div className="income-filter-head">
            <div className="income-filter-title">
              <FontAwesomeIcon icon={faFilter} /> فلترة وبحث
            </div>
          </div>

          <div className="income-filter-grid">
            <div className="income-input">
              <div className="income-input__icon">
                <FontAwesomeIcon icon={faSearch} />
              </div>
              <input
                className="form-control"
                placeholder="بحث (المصدر / الملاحظة / المبلغ / المعرف...)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <select
              className="form-control"
              value={fMethod}
              onChange={(e) => setFMethod(e.target.value as any)}
            >
              <option value="all">كل طرق الدفع</option>
              <option value="cash">كاش</option>
              <option value="card">شبكة</option>
              <option value="transfer">تحويل</option>
              <option value="other">أخرى</option>
            </select>

            <input
              type="date"
              className="form-control"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="من"
            />

            <input
              type="date"
              className="form-control"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="إلى"
            />
          </div>
        </div>

        {/* Table */}
        <div className="income-table-wrap" style={{ marginTop: 12 }}>
          <div className="income-table-head">
            <div style={{ fontWeight: 900 }}>
              السجلات: {filtered.length.toLocaleString()}
            </div>
            {loading && (
              <div style={{ opacity: 0.7, fontSize: 13 }}>...جاري التحميل</div>
            )}
          </div>

          <div className="table-responsive">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>الدفع</th>
                  <th>المصدر</th>
                  <th>ملاحظة</th>
                  <th>حذف</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 18, opacity: 0.75 }}>
                      لا يوجد بيانات مطابقة للفلترة الحالية.
                    </td>
                  </tr>
                ) : (
                  filtered.map((x) => (
                    <tr key={x.id}>
                      <td>{x.date}</td>
                      <td style={{ fontWeight: 900 }}>
                        {(Number(x.amount) || 0).toLocaleString()} ريال
                      </td>
                      <td>{methodLabel(x.method)}</td>
                      <td>{x.source || "-"}</td>
                      <td>{x.note || "-"}</td>
                      <td>
                        <button
                          className="dash-icon-btn"
                          type="button"
                          title="حذف"
                          onClick={() => removeIncome(String(x.id))}
                          disabled={loading}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Errors */}
        {modalMsg && <p style={{ color: "red", marginTop: 12 }}>{modalMsg}</p>}
      </div>

      {/* ✅ Modal (Scoped to Income CSS) */}
      {addOpen && (
        <div className="income-page-modal">
          <div
            className="income-page-modal__overlay"
            onClick={() => setAddOpen(false)}
          />
          <div className="income-page-modal__card">
            <div className="income-page-modal__head">
              <div className="income-page-modal__title">إضافة دخل</div>
              <button
                className="dash-pill dash-pill-sm dash-pill-outline"
                onClick={() => setAddOpen(false)}
                type="button"
              >
                إغلاق
              </button>
            </div>

            <div className="income-page-modal__body">
              <div style={{ display: "grid", gap: 10 }}>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="form-control"
                />

                <input
                  type="number"
                  placeholder="المبلغ"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="form-control"
                />

                <select
                  className="form-control"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                >
                  <option value="cash">كاش</option>
                  <option value="card">شبكة</option>
                  <option value="transfer">تحويل</option>
                  <option value="other">أخرى</option>
                </select>

                <input
                  type="text"
                  placeholder="المصدر (مثلاً: حجز)"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="form-control"
                />

                <input
                  type="text"
                  placeholder="ملاحظة (اختياري)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="form-control"
                />

                <button
                  className="dash-pill dash-pill-primary"
                  onClick={addIncome}
                  type="button"
                  disabled={loading}
                >
                  حفظ
                </button>

                <button
                  className="dash-pill dash-pill-outline"
                  onClick={() => setAddOpen(false)}
                  type="button"
                  disabled={loading}
                >
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 🔕 silence unused helpers
void loadBookings;
void isRevenueStatus;

// 🔕 silence unused helpers
void loadBookings;
void isRevenueStatus;

