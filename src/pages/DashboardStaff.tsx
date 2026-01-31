// ✅ src/pages/DashboardStaff.tsx
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";

import { auth, db } from "../services/firebase";
import "../styles/DashboardStaff.css";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

type BookingDoc = {
  clientName?: string;
  clientPhone?: string;

  serviceName?: string;
  serviceId?: string;

  employeeName?: string;
  employeeId?: string;
  employeeUid?: string;
  employeeKey?: string;

  date?: string; // YYYY-MM-DD
  time?: string; // e.g. 05:30 PM أو 17:30

  status?: BookingStatus;

  // ✅ NEW: staff receipt acknowledgement (source of truth)
  staffAck?: boolean;
  staffAckAt?: any;
  staffAckByUid?: string;

  createdAt?: Timestamp | any;
};

type BookingWithId = BookingDoc & { id: string };

const SALON_ID = "main";

function normalizeArabic(s: any) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function safeMs(ts: any): number {
  try {
    if (!ts) return 0;
    if (typeof ts === "number") return ts;
    if (typeof ts?.toMillis === "function") return ts.toMillis();
    return 0;
  } catch {
    return 0;
  }
}

function parseTimeToMinutes(t?: string) {
  const s = String(t || "").trim();
  if (!s) return 99999;

  // 17:30
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const hh = Number(m24[1]);
    const mm = Number(m24[2]);
    return hh * 60 + mm;
  }

  // 05:30 PM
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let hh = Number(m12[1]);
    const mm = Number(m12[2]);
    const ap = String(m12[3]).toUpperCase();
    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;
    return hh * 60 + mm;
  }

  return 99999;
}

type DateQuick = "all" | "today" | "tomorrow" | "week";

function isInQuickRange(iso: string, mode: DateQuick) {
  if (!iso) return false;
  if (mode === "all") return true;

  const d = new Date();
  d.setHours(0, 0, 0, 0);

  const x = new Date(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  );
  x.setHours(0, 0, 0, 0);

  if (mode === "today") return x.getTime() === d.getTime();

  if (mode === "tomorrow") {
    const t = new Date(d);
    t.setDate(t.getDate() + 1);
    return x.getTime() === t.getTime();
  }

  // week: من اليوم إلى 7 أيام قدام
  if (mode === "week") {
    const end = new Date(d);
    end.setDate(end.getDate() + 7);
    return x >= d && x <= end;
  }

  return true;
}

/* =========================
   Log Helpers (Firestore)
========================= */
function bookingRef(id: string) {
  return doc(db, "salons", SALON_ID, "bookings", id);
}

function bookingEventsCol(bookingId: string) {
  return collection(db, "salons", SALON_ID, "booking_logs", bookingId, "events");
}

type BookingLogEvent = {
  type: "staff_acknowledged";
  bookingId: string;
  byUid: string;
  byEmail?: string;
  at: any;
  note?: string;
};

export default function DashboardStaff() {
  const [myUid, setMyUid] = useState<string>("");
  const [myEmail, setMyEmail] = useState<string>("");

  const [allBookingsRaw, setAllBookingsRaw] = useState<BookingWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string>("");

  const [tab, setTab] = useState<"new" | "seen" | "all">("new");
  const [q, setQ] = useState("");
  const [dateQuick, setDateQuick] = useState<DateQuick>("week");

  const [busyId, setBusyId] = useState<string>(""); // ✅ disable button while writing

  // ✅ 1) Auth: uid + email
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const uid = String(u?.uid || "");
      const email = String(u?.email || "");
      setMyUid(uid);
      setMyEmail(email);
    });
    return () => unsub();
  }, []);

  // ✅ 2) Realtime: حجوزات الموظفة فقط (employeeUid == myUid)
  useEffect(() => {
    if (!myUid) {
      setAllBookingsRaw([]);
      setLoading(false);
      setErrMsg("⚠️ سجّل دخول بحساب الموظفة لعرض حجوزاتك.");
      return;
    }

    setLoading(true);
    setErrMsg("");
    setAllBookingsRaw([]);

    const colRef = collection(db, "salons", SALON_ID, "bookings");
    const qMine = query(colRef, where("employeeKey", "==", myUid));

    const onErr = (e: any) => {
      console.error("DashboardStaff snapshot error:", e);
      const msg = String(e?.message || e);

      setErrMsg(
        msg.includes("Missing or insufficient permissions")
          ? "⚠️ الصلاحيات (Rules) تمنع قراءة الحجوزات. تأكد أن booking فيه employeeUid = uid حقك، وأن Rules تسمح للموظفة بقراءة حجوزاتها."
          : msg.includes("index")
            ? "⚠️ يحتاج Index في Firestore للاستعلام. انسخ رسالة الخطأ كاملة من Console عشان نطلع رابط إنشاء الـ Index."
            : "❌ خطأ أثناء تحميل الحجوزات:\n" + msg
      );

      setAllBookingsRaw([]);
      setLoading(false);
    };

    const unsub = onSnapshot(
      qMine,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as BookingDoc),
        }));

        rows.sort((a, b) => safeMs(b.createdAt) - safeMs(a.createdAt));

        setAllBookingsRaw(rows);
        setLoading(false);
      },
      onErr
    );

    return () => unsub();
  }, [myUid]);

  const filtered = useMemo(() => {
    const text = normalizeArabic(q);

    const list = allBookingsRaw.filter((b) => {
      const st = String(b.status || "pending").toLowerCase();
      if (!["confirmed", "pending", "completed", "cancelled"].includes(st)) return false;

      const iso = String(b.date || "").trim();
      if (!isInQuickRange(iso, dateQuick)) return false;

      if (text) {
        const hay = normalizeArabic(
          `${b.clientName || ""} ${b.clientPhone || ""} ${b.serviceName || ""} ${b.employeeName || ""} ${b.date || ""} ${b.time || ""} ${b.id || ""}`
        );
        if (!hay.includes(text)) return false;
      }

      const isAck = !!b.staffAck;
      if (tab === "new" && isAck) return false;
      if (tab === "seen" && !isAck) return false;

      return true;
    });

    list.sort((a, b) => {
      const da = String(a.date || "");
      const dbb = String(b.date || "");
      if (da !== dbb) return da.localeCompare(dbb);

      const ta = parseTimeToMinutes(a.time);
      const tb = parseTimeToMinutes(b.time);
      if (ta !== tb) return ta - tb;

      return safeMs(b.createdAt) - safeMs(a.createdAt);
    });

    return list;
  }, [allBookingsRaw, q, dateQuick, tab]);

  const grouped = useMemo(() => {
    const map = new Map<string, BookingWithId[]>();
    for (const b of filtered) {
      const k = String(b.date || "بدون تاريخ");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const countNew = useMemo(() => {
    return allBookingsRaw.filter((b) => !b.staffAck).length;
  }, [allBookingsRaw]);

  // ✅ Confirm Receipt: update booking + write log event (atomic batch)
  const confirmReceipt = async (bookingId: string) => {
    if (!myUid) return;
    if (!bookingId) return;

    setBusyId(bookingId);
    setErrMsg("");

    try {
      const bRef = bookingRef(bookingId);

      // new event doc ref inside subcollection
      const evCol = bookingEventsCol(bookingId);
      const evRef = doc(evCol);

      const ev: BookingLogEvent = {
        type: "staff_acknowledged",
        bookingId,
        byUid: myUid,
        byEmail: myEmail || "",
        at: serverTimestamp(),
        note: "تم تأكيد استلام الحجز من الموظفة",
      };

      const batch = writeBatch(db);

      // 1) stamp booking
      batch.update(bRef, {
        staffAck: true,
        staffAckAt: serverTimestamp(),
        staffAckByUid: myUid,
        updatedAt: serverTimestamp(),
      });

      // 2) add event
      batch.set(evRef, ev);

      await batch.commit();
    } catch (e: any) {
      console.error("confirmReceipt error:", e);
      const msg = String(e?.message || e);
      setErrMsg(
        msg.includes("Missing or insufficient permissions")
          ? "⚠️ الصلاحيات تمنع تأكيد الاستلام. لازم Rules تسمح للموظفة بتحديث staffAck وكتابة log."
          : "❌ تعذر تأكيد الاستلام:\n" + msg
      );
    } finally {
      setBusyId("");
    }
  };

  // ✅ Confirm all visible (with safe batching)
  const confirmAllVisible = async () => {
    if (!myUid) return;

    const targets = filtered.filter((b) => !b.staffAck).slice(0, 450);
    if (targets.length === 0) return;

    const ok = confirm(`سيتم تأكيد استلام ${targets.length} حجز وعمل Log لكل واحد.\nمتابعة؟`);
    if (!ok) return;

    setBusyId("__all__");
    setErrMsg("");

    try {
      // batch limit 500: we do 2 writes per booking (update + event set)
      // safe chunk size: 200 bookings => 400 writes
      const CHUNK = 200;

      for (let i = 0; i < targets.length; i += CHUNK) {
        const chunk = targets.slice(i, i + CHUNK);
        const batch = writeBatch(db);

        for (const b of chunk) {
          const bRef = bookingRef(b.id);

          const evCol = bookingEventsCol(b.id);
          const evRef = doc(evCol);

          const ev: BookingLogEvent = {
            type: "staff_acknowledged",
            bookingId: b.id,
            byUid: myUid,
            byEmail: myEmail || "",
            at: serverTimestamp(),
            note: "تم تأكيد استلام الحجز من الموظفة",
          };

          batch.update(bRef, {
            staffAck: true,
            staffAckAt: serverTimestamp(),
            staffAckByUid: myUid,
            updatedAt: serverTimestamp(),
          });

          batch.set(evRef, ev);
        }

        await batch.commit();
      }
    } catch (e: any) {
      console.error("confirmAllVisible error:", e);
      const msg = String(e?.message || e);
      setErrMsg(
        msg.includes("Missing or insufficient permissions")
          ? "⚠️ الصلاحيات تمنع تأكيد الاستلام. لازم Rules تسمح للموظفة بتحديث staffAck وكتابة log."
          : "❌ تعذر تأكيد الاستلام للجميع:\n" + msg
      );
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="dashstaff-page" dir="rtl">
      <div className="dashstaff-header">
        <div>
          <h2 className="dashstaff-title">بوابة الموظفات</h2>
          <div className="dashstaff-sub">
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

      {!loading && !errMsg && (
        <>
          <div className="dashstaff-filters">
            <input
              className="dashstaff-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث: اسم العميلة / رقم / خدمة / تاريخ..."
            />

            <select
              className="dashstaff-input"
              value={dateQuick}
              onChange={(e) => setDateQuick(e.target.value as DateQuick)}
            >
              <option value="week">هذا الأسبوع</option>
              <option value="today">اليوم</option>
              <option value="tomorrow">بكرا</option>
              <option value="all">كل التواريخ</option>
            </select>
          </div>

          <div className="dashstaff-actions">
            <button type="button" onClick={() => setTab("new")}>
              جديد ({countNew})
            </button>
            <button type="button" onClick={() => setTab("seen")}>
              تم الاستلام
            </button>
            <button type="button" onClick={() => setTab("all")}>
              الكل ({allBookingsRaw.length})
            </button>

            <button
              type="button"
              onClick={confirmAllVisible}
              disabled={!myUid || busyId === "__all__" || filtered.every((b) => b.staffAck)}
              title="يؤكد استلام كل الحجوزات الظاهرة (ويكتب Log لكل واحد)"
            >
              {busyId === "__all__" ? "..." : "تأكيد استلام الكل ✅"}
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="dashstaff-box empty">ما فيه حجوزات حسب الفلاتر الحالية.</div>
          ) : (
            <div className="dashstaff-list">
              {grouped.map(([day, rows]) => (
                <div key={day} className="dashstaff-card">
                  <div className="dashstaff-row top">
                    <div className="dashstaff-service">{day}</div>
                    <div className="dashstaff-meta">{rows.length} حجز</div>
                  </div>

                  {rows.map((b) => {
                    const st = String(b.status || "pending").toLowerCase();
                    const isAck = !!b.staffAck;
                    const badgeText = isAck ? "تم الاستلام" : "حجز جديد";

                    return (
                      <div key={b.id} className="dashstaff-card" style={{ marginTop: 10 }}>
                        <div className="dashstaff-row top">
                          <div className="dashstaff-service">
                            {b.clientName || "—"}{" "}
                            <span className="dashstaff-meta">
                              {b.clientPhone ? `• ${b.clientPhone}` : ""}
                            </span>
                          </div>

                          <span
                            className={`dashstaff-status ${isAck ? "completed" : "confirmed"}`}
                            title={
                              isAck
                                ? "تم تأكيد استلام الحجز (مسجل في Firestore)"
                                : "حجز جديد بانتظار تأكيد الاستلام"
                            }
                          >
                            {badgeText}
                          </span>
                        </div>

                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">
                            الخدمة: <b>{b.serviceName || b.serviceId || "—"}</b>
                          </div>
                        </div>

                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">
                            الموعد: <b>{b.date || "—"}</b> • <b>{b.time || "—"}</b>
                          </div>
                        </div>

                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">
                            الحالة: <b>{st || "—"}</b>
                            {isAck && b.staffAckByUid ? (
                              <span className="dashstaff-meta" style={{ marginInlineStart: 10 }}>
                                • تم بواسطة: <b>{String(b.staffAckByUid).slice(0, 6)}</b>
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="dashstaff-actions">
                          {!isAck ? (
                            <button
                              type="button"
                              onClick={() => confirmReceipt(b.id)}
                              disabled={!myUid || busyId === b.id}
                              title="يسجل حدث استلام داخل booking_logs"
                            >
                              {busyId === b.id ? "..." : "اضغطي هنا لتأكيد الاستلام ✅"}
                            </button>
                          ) : (
                            <span className="pill soft">✅ تم تأكيد الاستلام (مسجل)</span>
                          )}

                          <span className="pill soft">Booking ID: {b.id}</span>
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
