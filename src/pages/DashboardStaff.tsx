import { DashboardSelectBridgeV2 } from "../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../services/firebase";
import { readStoredAuthSession } from "../services/localAuthSession";
import {
  CoreBookingService,
  type CoreStaffPortalBooking,
} from "../services/CoreBookingService";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
type DateQuick = "all" | "today" | "tomorrow" | "week";
type StatusQuick = "all" | BookingStatus;

type StaffBooking = {
  id: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  serviceId: string;
  employeeName: string;
  date: string;
  time: string;
  status: BookingStatus;
  staffAck: boolean;
  staffAckAt?: string | null;
  staffAckByUid?: string | null;
  createdAt?: string | null;
};

const REFRESH_DELAYS_MS = [15_000, 30_000, 60_000] as const;

function normalizeArabic(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function safeMs(value: unknown): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseTimeToMinutes(value?: string) {
  const text = String(value || "").trim();
  const m24 = text.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return Number(m24[1]) * 60 + Number(m24[2]);

  const m12 = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m12) return 99999;
  let hours = Number(m12[1]);
  const minutes = Number(m12[2]);
  const marker = String(m12[3]).toUpperCase();
  if (marker === "PM" && hours < 12) hours += 12;
  if (marker === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function formatTime12(time24?: string) {
  const match = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return String(time24 || "—");
  const hour24 = Number(match[1]);
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${match[2]} ${hour24 >= 12 ? "م" : "ص"}`;
}

function normalizeStatus(value?: string): BookingStatus {
  const status = String(value || "pending").trim().toLowerCase();
  if (status === "confirmed" || status === "completed" || status === "cancelled") return status;
  return "pending";
}

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isInQuickRange(iso: string, mode: DateQuick) {
  if (!iso) return false;
  if (mode === "all") return true;

  const start = new Date(`${todayIso()}T00:00:00`);
  const value = new Date(`${iso}T00:00:00`);
  if (!Number.isFinite(value.getTime())) return false;
  if (mode === "today") return value.getTime() === start.getTime();

  const tomorrow = new Date(start);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (mode === "tomorrow") return value.getTime() === tomorrow.getTime();

  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return value >= start && value <= end;
}

function staffBookingFromCore(row: CoreStaffPortalBooking): StaffBooking {
  const firstItem = row.items?.[0];
  return {
    id: row.id,
    clientName: String(row.clientName || ""),
    clientPhone: String(row.clientPhone || ""),
    serviceName: String(firstItem?.serviceNameSnapshot || ""),
    serviceId: String(firstItem?.serviceId || ""),
    employeeName: String(firstItem?.staffName || row.staffName || ""),
    date: String(firstItem?.bookingDate || row.bookingDate || ""),
    time: String(firstItem?.startTime || row.startTime || ""),
    status: normalizeStatus(row.status),
    staffAck: row.staffAck === true,
    staffAckAt: row.staffAckAt,
    staffAckByUid: row.staffAckByUid,
    createdAt: row.createdAt,
  };
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "بانتظار التأكيد",
  confirmed: "مؤكد",
  completed: "مكتمل",
  cancelled: "ملغي",
};

type DashboardStaffProps = {
  allowStatusChange?: boolean;
};

export default function DashboardStaff({ allowStatusChange = false }: DashboardStaffProps) {
  const [myUid, setMyUid] = useState(() => readStoredAuthSession()?.uid || "");
  const [myEmail, setMyEmail] = useState(() => readStoredAuthSession()?.email || "");
  const [rows, setRows] = useState<StaffBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");
  const [busyId, setBusyId] = useState("");
  const [tab, setTab] = useState<"new" | "seen" | "all">("new");
  const [q, setQ] = useState("");
  const [dateQuick, setDateQuick] = useState<DateQuick>("all");
  const [statusQuick, setStatusQuick] = useState<StatusQuick>("all");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const local = readStoredAuthSession();
      setMyUid(String(local?.uid || user?.uid || ""));
      setMyEmail(String(local?.email || user?.email || ""));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!myUid) {
      setRows([]);
      setLoading(false);
      setErrMsg("⚠️ سجّل دخول بحساب الموظفة لعرض حجوزاتك.");
      return;
    }

    let active = true;
    let inFlight = false;
    let timer: number | null = null;
    let unchangedStreak = 0;
    let lastSignature = "";

    const clearTimer = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const canRefresh = () =>
      active &&
      document.visibilityState === "visible" &&
      (typeof navigator === "undefined" || navigator.onLine !== false);

    const schedule = () => {
      clearTimer();
      if (!canRefresh()) return;
      const delay = REFRESH_DELAYS_MS[Math.min(unchangedStreak, REFRESH_DELAYS_MS.length - 1)];
      timer = window.setTimeout(() => {
        timer = null;
        void load();
      }, delay);
    };

    const load = async () => {
      if (!canRefresh() || inFlight) return;
      inFlight = true;
      try {
        const next = (await CoreBookingService.mine()).map(staffBookingFromCore);
        const signature = next
          .map((row) => `${row.id}:${row.status}:${row.staffAck}:${row.date}:${row.time}`)
          .join("|");
        unchangedStreak = signature && signature === lastSignature
          ? Math.min(unchangedStreak + 1, REFRESH_DELAYS_MS.length - 1)
          : 0;
        lastSignature = signature;
        if (!active) return;
        setRows(next.sort((a, b) => safeMs(b.createdAt) - safeMs(a.createdAt)));
        setErrMsg("");
      } catch (error) {
        if (!active) return;
        console.error("DashboardStaff Core load failed:", error);
        setErrMsg("❌ تعذر تحميل حجوزاتك من Core. حاول مرة أخرى.");
      } finally {
        inFlight = false;
        if (active) {
          setLoading(false);
          schedule();
        }
      }
    };

    const refreshWhenActive = () => {
      if (!canRefresh()) {
        clearTimer();
        return;
      }
      unchangedStreak = 0;
      clearTimer();
      void load();
    };

    setLoading(true);
    void load();
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    return () => {
      active = false;
      clearTimer();
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [myUid]);

  const baseFiltered = useMemo(() => {
    const search = normalizeArabic(q);
    return rows.filter((booking) => {
      if (!isInQuickRange(booking.date, dateQuick)) return false;
      if (statusQuick !== "all" && booking.status !== statusQuick) return false;
      if (!search) return true;
      return normalizeArabic(
        `${booking.clientName} ${booking.clientPhone} ${booking.serviceName} ${booking.employeeName} ${booking.date} ${booking.time} ${booking.id}`
      ).includes(search);
    });
  }, [rows, q, dateQuick, statusQuick]);

  const filtered = useMemo(() => {
    return baseFiltered
      .filter((booking) => {
        if (tab === "new") return !booking.staffAck;
        if (tab === "seen") return booking.staffAck;
        return true;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const timeDiff = parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time);
        return timeDiff || safeMs(b.createdAt) - safeMs(a.createdAt);
      });
  }, [baseFiltered, tab]);

  const grouped = useMemo(() => {
    const groups = new Map<string, StaffBooking[]>();
    for (const booking of filtered) {
      const date = booking.date || "بدون تاريخ";
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date)!.push(booking);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const statusCounts = useMemo(() => {
    const counts: Record<BookingStatus, number> = {
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const booking of baseFiltered) counts[booking.status] += 1;
    return counts;
  }, [baseFiltered]);

  const confirmReceipt = async (bookingId: string) => {
    if (!myUid || !bookingId) return;
    setBusyId(bookingId);
    setErrMsg("");
    try {
      const updated = staffBookingFromCore(await CoreBookingService.acknowledgeMine(bookingId));
      setRows((current) => current.map((row) => (row.id === bookingId ? updated : row)));
    } catch (error) {
      console.error("confirmReceipt Core error:", error);
      setErrMsg("❌ تعذر تأكيد استلام الحجز.");
    } finally {
      setBusyId("");
    }
  };

  const confirmAllVisible = async () => {
    if (!myUid) return;
    const targets = filtered.filter((booking) => !booking.staffAck).slice(0, 100);
    if (!targets.length) return;
    if (!confirm(`سيتم تأكيد استلام ${targets.length} حجز.\nمتابعة؟`)) return;

    setBusyId("__all__");
    setErrMsg("");
    try {
      const updatedById = new Map<string, StaffBooking>();
      for (let index = 0; index < targets.length; index += 5) {
        const chunk = targets.slice(index, index + 5);
        const updated = await Promise.all(
          chunk.map((booking) => CoreBookingService.acknowledgeMine(booking.id))
        );
        for (const booking of updated) {
          const mapped = staffBookingFromCore(booking);
          updatedById.set(mapped.id, mapped);
        }
      }
      setRows((current) => current.map((row) => updatedById.get(row.id) || row));
    } catch (error) {
      console.error("confirmAllVisible Core error:", error);
      setErrMsg("❌ تعذر تأكيد استلام جميع الحجوزات الظاهرة.");
    } finally {
      setBusyId("");
    }
  };

  const setBookingStatus = async (bookingId: string, status: BookingStatus) => {
    if (!myUid || !bookingId || !allowStatusChange || status === "pending") return;
    if (status === "cancelled" && !confirm("تأكيد إلغاء هذا الحجز؟")) return;

    setBusyId(bookingId);
    setErrMsg("");
    try {
      const updated = staffBookingFromCore(
        await CoreBookingService.updateMineStatus(bookingId, status)
      );
      setRows((current) => current.map((row) => (row.id === bookingId ? updated : row)));
    } catch (error) {
      console.error("setBookingStatus Core error:", error);
      setErrMsg("❌ تعذر تغيير حالة الحجز. راجع صلاحية الموظفة وسياسة تغيير الحالة.");
    } finally {
      setBusyId("");
    }
  };

  const countNew = baseFiltered.filter((booking) => !booking.staffAck).length;
  const countSeen = baseFiltered.filter((booking) => booking.staffAck).length;

  return (
    <div className="dashstaff-page" dir="rtl">
      <div className="dashstaff-header">
        <div>
          <h2 className="dashstaff-title">بوابة الموظفات</h2>
          <div className="dashstaff-sub">
            <span className="pill soft">
              {allowStatusChange ? "صلاحية تغيير الحالة: مفعلة" : "صلاحية تغيير الحالة: غير مفعلة"}
            </span>
            <span className="pill soft">
              {myEmail ? `تسجيل الدخول: ${myEmail}` : "بدون تسجيل دخول"}
            </span>
            <span className="pill soft">العرض: حجوزاتي فقط</span>
          </div>
        </div>
        <div className="dashstaff-count">النتائج: {filtered.length}</div>
      </div>

      {loading && !errMsg && <div className="dashstaff-box warn">جاري تحميل الحجوزات...</div>}
      {!!errMsg && <div className="dashstaff-box error">{errMsg}</div>}

      {!loading && (
        <>
          <div className="dashstaff-filters">
            <input
              className="dashstaff-input"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="بحث: اسم العميلة / رقم / خدمة / تاريخ..."
            />
            <DashboardSelectBridgeV2
              className="dashstaff-input"
              value={dateQuick}
              onChange={(event) => setDateQuick(event.target.value as DateQuick)}
            >
              <option value="week">هذا الأسبوع</option>
              <option value="today">اليوم</option>
              <option value="tomorrow">بكرا</option>
              <option value="all">كل التواريخ</option>
            </DashboardSelectBridgeV2>
            <DashboardSelectBridgeV2
              className="dashstaff-input"
              value={statusQuick}
              onChange={(event) => setStatusQuick(event.target.value as StatusQuick)}
            >
              <option value="all">كل الحالات</option>
              <option value="pending">بانتظار التأكيد</option>
              <option value="confirmed">مؤكد</option>
              <option value="completed">مكتمل</option>
              <option value="cancelled">ملغي</option>
            </DashboardSelectBridgeV2>
          </div>

          <div className="dashstaff-kpis">
            <span className="pill soft">بانتظار التأكيد: {statusCounts.pending}</span>
            <span className="pill soft">مؤكد: {statusCounts.confirmed}</span>
            <span className="pill soft">مكتمل: {statusCounts.completed}</span>
            <span className="pill soft">ملغي: {statusCounts.cancelled}</span>
          </div>

          <div className="dashstaff-actions">
            <button type="button" className={`btn-tab ${tab === "new" ? "is-active" : ""}`} onClick={() => setTab("new")}>
              جديد ({countNew})
            </button>
            <button type="button" className={`btn-tab ${tab === "seen" ? "is-active" : ""}`} onClick={() => setTab("seen")}>
              تم الاستلام ({countSeen})
            </button>
            <button type="button" className={`btn-tab ${tab === "all" ? "is-active" : ""}`} onClick={() => setTab("all")}>
              الكل ({baseFiltered.length})
            </button>
            <button
              type="button"
              className="btn-bulk"
              onClick={confirmAllVisible}
              disabled={!myUid || busyId === "__all__" || filtered.every((booking) => booking.staffAck)}
            >
              {busyId === "__all__" ? "..." : "تأكيد استلام الكل ✅"}
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="dashstaff-box empty">ما فيه حجوزات حسب الفلاتر الحالية.</div>
          ) : (
            <div className="dashstaff-list">
              {grouped.map(([day, bookings]) => (
                <div key={day} className="dashstaff-card">
                  <div className="dashstaff-row top">
                    <div className="dashstaff-service">{day}</div>
                    <div className="dashstaff-meta">{bookings.length} حجز</div>
                  </div>

                  {bookings.map((booking) => {
                    const statusLabel = STATUS_LABEL[booking.status];
                    const canConfirm = allowStatusChange && booking.status === "pending";
                    const canComplete = allowStatusChange && booking.status === "confirmed";
                    const canCancel = allowStatusChange && ["pending", "confirmed"].includes(booking.status);
                    return (
                      <div key={booking.id} className="dashstaff-card" style={{ marginTop: 10 }}>
                        <div className="dashstaff-row top">
                          <div className="dashstaff-service">
                            {booking.clientName || "—"}{" "}
                            <span className="dashstaff-meta">{booking.clientPhone ? `• ${booking.clientPhone}` : ""}</span>
                          </div>
                          <div className="dashstaff-badges">
                            <span className={`dashstaff-status ${booking.status}`}>{statusLabel}</span>
                            <span className={`pill ${booking.staffAck ? "soft" : "ack-new"}`}>
                              {booking.staffAck ? "تم الاستلام" : "جديد ولم يتم الاستلام"}
                            </span>
                          </div>
                        </div>

                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">الخدمة: <b>{booking.serviceName || booking.serviceId || "—"}</b></div>
                        </div>
                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">الموعد: <b>{booking.date || "—"}</b> • <b>{formatTime12(booking.time)}</b></div>
                        </div>
                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">
                            الحالة التشغيلية: <b>{statusLabel}</b>
                            {booking.staffAck && booking.staffAckByUid ? (
                              <span className="dashstaff-meta" style={{ marginInlineStart: 10 }}>
                                • تم بواسطة: <b>{booking.staffAckByUid.slice(0, 6)}</b>
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="dashstaff-actions">
                          {!booking.staffAck ? (
                            <button
                              type="button"
                              className="btn-receipt"
                              onClick={() => confirmReceipt(booking.id)}
                              disabled={!myUid || busyId === booking.id}
                            >
                              {busyId === booking.id ? "..." : "اضغطي هنا لتأكيد الاستلام ✅"}
                            </button>
                          ) : (
                            <span className="pill soft">✅ تم تأكيد الاستلام (مسجل)</span>
                          )}

                          {canConfirm && (
                            <button type="button" className="btn-confirm" onClick={() => setBookingStatus(booking.id, "confirmed")} disabled={busyId === booking.id}>
                              تأكيد الموعد
                            </button>
                          )}
                          {canComplete && (
                            <button type="button" className="btn-complete" onClick={() => setBookingStatus(booking.id, "completed")} disabled={busyId === booking.id}>
                              إنهاء الخدمة
                            </button>
                          )}
                          {canCancel && (
                            <button type="button" className="btn-cancel" onClick={() => setBookingStatus(booking.id, "cancelled")} disabled={busyId === booking.id}>
                              إلغاء الحجز
                            </button>
                          )}
                          <span className="pill soft">Booking ID: {booking.id}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
