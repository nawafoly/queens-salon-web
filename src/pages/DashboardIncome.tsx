

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
import Modal from "../components/Modal";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";

import {
  listAllIncomeFS,
  removeIncomeFS,
  upsertIncomeFS,
} from "../services/firestoreIncome";
import { listAllBookings } from "../services/firestoreBookings";

import type { IncomeItem, PaymentMethod } from "../types/finance";

const ALL_BOOKINGS_KEY = "allBookings";

// ✅ LocalStorage Income (Migration)
const LEGACY_INCOME_KEY = "dashboard_income_v1";
const INCOME_MIGRATED_KEY = "income_migrated_to_firestore_v1";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

function mapFirestoreRole(raw: unknown): UiRole {
  const role = String(raw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "client") return "client";
  return "guest";
}

async function resolveRoleFromFirestore(uid: string): Promise<UiRole> {
  const id = String(uid || "").trim();
  if (!id) return "guest";

  const salonRef = doc(db, "salons", "main", "users", id);
  const salonSnap = await getDoc(salonRef);
  if (salonSnap.exists()) {
    return mapFirestoreRole((salonSnap.data() as any)?.role);
  }

  const rootRef = doc(db, "users", id);
  const rootSnap = await getDoc(rootRef);
  if (rootSnap.exists()) {
    return mapFirestoreRole((rootSnap.data() as any)?.role);
  }

  return "guest";
}

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

function sourceLabel(source: string) {
  const s = String(source || "").trim().toLowerCase();
  if (!s) return "-";
  if (s === "booking" || s === "حجز") return "حجز";
  if (s === "refund" || s === "استرجاع") return "استرجاع";
  return String(source || "").trim();
}

function toBookingRef(v?: string) {
  const raw = String(v || "").trim().toUpperCase();
  if (!raw) return "-";
  if (/^MK-\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `MK-${raw}`;
  return raw;
}

function toCsv(items: IncomeItem[]) {
  const header = ["date", "amount", "method", "source", "note", "id"].join(",");
  const lines = items.map((x) =>
    [
      x.date,
      x.amount,
      methodLabel(x.method),
      sourceLabel(x.source || "").replaceAll(",", " "),
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

function normalizeConfirmedPaymentMethod(raw: any): "cash" | "card" | "transfer" | null {
  const m = normalizePaymentMethod(raw);
  if (m === "cash" || m === "card" || m === "transfer") return m;
  return null;
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
  type BookingMeta = { bookingRef: string; clientName: string };

  const [items, setItems] = useState<IncomeItem[]>([]);
  const [bookingMetaById, setBookingMetaById] = useState<Record<string, BookingMeta>>({});
  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState("");

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [source, setSource] = useState("يدوي");
  const [note, setNote] = useState("");

  // Filters
  const [q, setQ] = useState("");
  const [fMethod, setFMethod] = useState<PaymentMethod | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const refresh = async () => {
    try {
      setLoading(true);
      const [incomeRows, bookingRows] = await Promise.all([listAllIncomeFS(), listAllBookings()]);
      const bookingMap = bookingRows.reduce(
        (acc, b: any) => {
          acc[String(b.id)] = {
            bookingRef: toBookingRef(String(b.publicId || "")),
            clientName: String(
              b.clientName || b.customerName || b.name || b.client?.name || b.customer?.name || ""
            ).trim(),
          };
          return acc;
        },
        {} as Record<string, BookingMeta>
      );
      setItems(incomeRows);
      setBookingMetaById(bookingMap);
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

        const role = await resolveRoleFromFirestore(user.uid);
        if (mounted) setUiRole(role);

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

        const [finalData, bookingRows] = await Promise.all([listAllIncomeFS(), listAllBookings()]);
        const bookingMap = bookingRows.reduce(
          (acc, b: any) => {
            acc[String(b.id)] = {
              bookingRef: toBookingRef(String(b.publicId || "")),
              clientName: String(
                b.clientName || b.customerName || b.name || b.client?.name || b.customer?.name || ""
              ).trim(),
            };
            return acc;
          },
          {} as Record<string, BookingMeta>
        );
        if (mounted) {
          setItems(finalData);
          setBookingMetaById(bookingMap);
        }
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
        const linkedBookingId =
          String(x.bookingId || "").trim() ||
          (sourceLabel(String(x.source || "")) === "حجز" ? String(x.id || "").trim() : "");
        const bm = bookingMetaById[linkedBookingId];
        const a =
          `${x.date} ${x.amount} ${sourceLabel(x.source || "")} ${x.note || ""} ${
            x.bookingId || ""
          } ${x.id} ${bm?.clientName || ""} ${bm?.bookingRef || ""}`.toLowerCase();
        return a.includes(qq);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [items, q, fMethod, from, to, bookingMetaById]);

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

  const totalRefund = useMemo(
    () =>
      Math.abs(
        filtered
          .filter((x) => Number(x.amount) < 0)
          .reduce((s, x) => s + (Number(x.amount) || 0), 0)
      ),
    [filtered]
  );

  const addIncome = async () => {
    const n = Number(amount);
    const reason = String(note || "").trim();
    const cleanedSource = String(source || "").trim() || "يدوي";
    if (!date || !n || n <= 0) return setModalMsg("بيانات غير صحيحة");
    if (!reason) return setModalMsg("سبب/مرجع الدخل اليدوي مطلوب");

    const item: IncomeItem = {
      id: uid(),
      date,
      amount: n,
      method,
      source: cleanedSource,
      note: reason,
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

  const canFixPaymentMethods = uiRole === "owner" || uiRole === "admin";

  const fixPaymentMethods = async () => {
    if (!canFixPaymentMethods) {
      setModalMsg("هذه العملية تتطلب صلاحية Owner/Admin.");
      return;
    }

    try {
      setLoading(true);

      const bookings = await listAllBookings();
      const targets = bookings.filter((b: any) => {
        const status = String(b?.status || "").toLowerCase().trim();
        if (!(status === "confirmed" || status === "completed")) return false;
        const method = normalizeConfirmedPaymentMethod((b as any)?.paymentMethod);
        return !method || method === "cash";
      });

      await Promise.all(
        targets.map(async (b: any) => {
          const id = String(b?.id || "").trim();
          if (!id) return;
          await setDoc(
            doc(db, "salons", "main", "bookings", id),
            {
              paymentMethod: "transfer",
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          await setDoc(
            doc(db, "salons", "main", "booking_tracks", id),
            {
              paymentMethod: "transfer",
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        })
      );

      await refresh();
      setModalMsg(`تم إصلاح ${targets.length} حجز: تم تعيين paymentMethod = transfer.`);
    } catch (e) {
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-section income-page">
      <div className="income-container">
        {/* Header */}
        <div className="income-header">
          <div className="income-title-block qs-black">
            <h2 className="income-title">الإيرادات</h2>
            <p className="income-subtitle">
              إدارة وتسجيل الإيرادات اليومية
            </p>
          </div>

          <div className="income-actions">
            {canFixPaymentMethods && (
              <button
                className="dash-pill dash-pill-outline"
                onClick={fixPaymentMethods}
                type="button"
                disabled={loading}
                title="إصلاح طرق الدفع"
              >
                إصلاح طرق الدفع
              </button>
            )}
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
          <div className="stat-card stat-card-total">
            <div className="stat-info">
              <h3>{total.toLocaleString()} ريال</h3>
              <p>الإجمالي (حسب الفلترة)</p>
            </div>
          </div>

          <div className="stat-card stat-card-cash">
            <div className="stat-info">
              <h3>{totalCash.toLocaleString()} ريال</h3>
              <p>كاش</p>
            </div>
          </div>

          <div className="stat-card stat-card-card">
            <div className="stat-info">
              <h3>{totalCard.toLocaleString()} ريال</h3>
              <p>شبكة</p>
            </div>
          </div>

          <div className="stat-card stat-card-transfer">
            <div className="stat-info">
              <h3>{totalTransfer.toLocaleString()} ريال</h3>
              <p>تحويل</p>
            </div>
          </div>

          <div className="stat-card stat-card-refund">
            <div className="stat-info">
              <h3>{totalRefund.toLocaleString()} ريال</h3>
              <p>إجمالي الاسترجاع</p>
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
            <div className="income-table-count">
              السجلات: {filtered.length.toLocaleString()}
            </div>
            {loading && (
              <div className="income-table-loading">...جاري التحميل</div>
            )}
          </div>

          <div className="table-responsive">
            <table className="dashboard-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ</th>
                  <th>الدفع</th>
                  <th>العميلة</th>
                  <th>رقم الحجز</th>
                  <th>المصدر</th>
                  <th>ملاحظة</th>
                  <th>حذف</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 18, opacity: 0.75 }}>
                      لا يوجد بيانات مطابقة للفترة الحالية.
                    </td>
                  </tr>
                ) : (
                  filtered.map((x) => {
                    const linkedBookingId =
                      String(x.bookingId || "").trim() ||
                      (sourceLabel(String(x.source || "")) === "حجز" ? String(x.id || "").trim() : "");
                    const bookingMeta = bookingMetaById[linkedBookingId];
                    return (
                      <tr key={x.id} className={"income-row income-row-" + x.method}>
                        <td className="income-date">{x.date}</td>
                        <td>
                          <span className="income-amount">
                            {(Number(x.amount) || 0).toLocaleString()} ريال
                          </span>
                        </td>
                        <td>
                          <span className={"income-method-badge " + x.method}>{methodLabel(x.method)}</span>
                        </td>
                        <td className="income-client-text">{bookingMeta?.clientName || "-"}</td>
                        <td className="income-booking-text">{bookingMeta?.bookingRef || "-"}</td>
                        <td className="income-source-text">{sourceLabel(x.source || "")}</td>
                        <td className="income-note-text">{x.note || "-"}</td>
                        <td>
                          <button
                            className="dash-icon-btn qs-black income-delete-btn"
                            type="button"
                            title="حذف"
                            onClick={() => removeIncome(String(x.id))}
                            disabled={loading}
                          >
                            <FontAwesomeIcon icon={faTrash} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="income-mobile-list">
            {filtered.length === 0 ? (
              <div className="income-mobile-empty">
                لا يوجد بيانات مطابقة للفترة الحالية.
              </div>
            ) : (
              filtered.map((x) => {
                const linkedBookingId =
                  String(x.bookingId || "").trim() ||
                  (sourceLabel(String(x.source || "")) === "حجز" ? String(x.id || "").trim() : "");
                const bookingMeta = bookingMetaById[linkedBookingId];
                return (
                  <article className="income-mobile-card" key={"mob_" + x.id}>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">التاريخ</span>
                      <span className="income-mobile-value income-mobile-value--date">{x.date}</span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">المبلغ</span>
                      <span className="income-mobile-value income-mobile-amount">
                        {(Number(x.amount) || 0).toLocaleString()} ريال
                      </span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">الدفع</span>
                      <span className="income-mobile-value"><span className={"income-method-badge " + x.method}>{methodLabel(x.method)}</span></span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">العميلة</span>
                      <span className="income-mobile-value">{bookingMeta?.clientName || "-"}</span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">رقم الحجز</span>
                      <span className="income-mobile-value">{bookingMeta?.bookingRef || "-"}</span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">المصدر</span>
                      <span className="income-mobile-value">{sourceLabel(x.source || "")}</span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">ملاحظة</span>
                      <span className="income-mobile-value">{x.note || "-"}</span>
                    </div>
                    <div className="income-mobile-actions">
                      <button
                        className="dash-pill dash-pill-outline income-mobile-delete"
                        type="button"
                        title="حذف"
                        onClick={() => removeIncome(String(x.id))}
                        disabled={loading}
                      >
                        <FontAwesomeIcon icon={faTrash} /> حذف
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* Errors */}
        {modalMsg && <p style={{ color: "red", marginTop: 12 }}>{modalMsg}</p>}
      </div>

      {/* ✅ Modal (Scoped to Income CSS) */}
      {addOpen && (
        <Modal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          ariaLabel="إضافة دخل"
          panelClassName="income-page-modal__card"
          size="sm"
        >
            <div className="income-page-modal__head">
              <div className="income-page-modal__title">إضافة دخل</div>
              <button
                className="income-modal-close-btn"
                onClick={() => setAddOpen(false)}
                type="button"
              >
                إغلاق
              </button>
            </div>

            <div className="income-page-modal__body">
              <div className="income-modal-grid">
                <label className="income-modal-field">
                  <span>التاريخ</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="income-modal-input"
                  />
                </label>

                <label className="income-modal-field">
                  <span>المبلغ (ر.س)</span>
                  <input
                    type="number"
                    placeholder="أدخلي المبلغ"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="income-modal-input"
                  />
                </label>

                <label className="income-modal-field">
                  <span>طريقة السداد</span>
                  <select
                    className="income-modal-input"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="cash">كاش</option>
                    <option value="card">شبكة</option>
                    <option value="transfer">تحويل</option>
                    <option value="other">أخرى</option>
                  </select>
                </label>

                <label className="income-modal-field">
                  <span>المصدر</span>
                  <input
                    type="text"
                    placeholder="مثال: بيع منتج / تعديل يدوي"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="income-modal-input"
                  />
                </label>

                <label className="income-modal-field">
                  <span>سبب/مرجع (إلزامي)</span>
                  <input
                    type="text"
                    placeholder="مثال: بيع منتج، عربون، تعديل يدوي"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="income-modal-input"
                  />
                </label>
              </div>

              <div className="income-modal-actions">
                <button
                  className="income-modal-btn income-modal-btn--primary"
                  onClick={addIncome}
                  type="button"
                  disabled={loading}
                >
                  حفظ
                </button>

                <button
                  className="income-modal-btn income-modal-btn--secondary"
                  onClick={() => setAddOpen(false)}
                  type="button"
                  disabled={loading}
                >
                  إلغاء
                </button>
              </div>
            </div>
        </Modal>
      )}
    </div>
  );
}

// 🔕 silence unused helpers
void loadBookings;
void isRevenueStatus;

