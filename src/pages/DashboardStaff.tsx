// ✅ src/pages/DashboardStaff.tsx
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  Timestamp,
} from "firebase/firestore";

import { auth, db } from "../services/firebase";
import "../styles/DashboardStaff.css";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "new";

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

  createdAt?: Timestamp | any;
};

type BookingWithId = BookingDoc & { id: string };

const SALON_ID = "main";

function normalizeArabic(s: any) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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

/**
 * ✅ Seen Store (per uid)
 * - LocalStorage فقط (مؤقت وسريع)
 */
function seenKey(uid: string) {
  return `qs_staff_seen_bookings_v1_${uid}`;
}

function loadSeenMap(uid: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(seenKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSeenMap(uid: string, map: Record<string, number>) {
  try {
    localStorage.setItem(seenKey(uid), JSON.stringify(map));
  } catch {
    // ignore
  }
}

export default function DashboardStaff() {
  const [myUid, setMyUid] = useState<string>("");
  const [myEmail, setMyEmail] = useState<string>("");

  const [allBookingsRaw, setAllBookingsRaw] = useState<BookingWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string>("");

  const [seen, setSeen] = useState<Record<string, number>>({});

  const [tab, setTab] = useState<"new" | "seen" | "all">("new");
  const [q, setQ] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [dateQuick, setDateQuick] = useState<DateQuick>("week");

// ✅ 2) Realtime: حجوزاتي أنا كموظفة (بالـ employeeUid)
useEffect(() => {
  // لازم تسجيل دخول
  if (!myUid) {
    setAllBookingsRaw([]);
    setLoading(false);
    return;
  }

  setLoading(true);
  setErrMsg("");
  setAllBookingsRaw([]);

  const colRef = collection(db, "salons", SALON_ID, "bookings");

  // ✅ نجيب حجوزات الموظفة الحالية فقط
  // ملاحظة: لو عندك اندكس ناقص وطلع خطأ، بنسويه بعدين
  const qMine = query(
    colRef,
    where("employeeUid", "==", myUid)
  );

  const onErr = (e: any) => {
    console.error("DashboardStaff snapshot error:", e);
    const msg = String(e?.message || e);

    setErrMsg(
      msg.includes("Missing or insufficient permissions")
        ? "⚠️ الصلاحيات (Rules) تمنع قراءة الحجوزات. تأكد أن booking فيه employeeUid = uid حقك."
        : msg.includes("index")
          ? "⚠️ يحتاج Index في Firestore للاستعلام. أرسل لي نص الخطأ بالكامل عشان أعطيك رابط إنشاء الـ Index."
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

      // ✅ (اختياري) فلترة حالات هنا بدل الاستعلام
      // تبغى تشوف كل الحالات؟ اتركها.
      // تبغى confirmed فقط؟ خل الفلترة في useMemo عندك مثل ما هي.
      rows.sort((a, b) => safeMs(b.createdAt) - safeMs(a.createdAt));

      setAllBookingsRaw(rows);
      setLoading(false);
    },
    onErr
  );

  return () => unsub();
}, [myUid]);

  // ✅ 2) Realtime: confirmed فقط (بدون شروط رول)
  useEffect(() => {
    setLoading(true);
    setErrMsg("");
    setAllBookingsRaw([]);

    const colRef = collection(db, "salons", SALON_ID, "bookings");
    const qConfirmed = query(colRef, where("status", "==", "confirmed"));

    const onErr = (e: any) => {
      console.error("DashboardStaff snapshot error:", e);
      const msg = String(e?.message || e);

      setErrMsg(
        msg.includes("Missing or insufficient permissions")
          ? "⚠️ الصلاحيات (Rules) تمنع قراءة الحجوزات. إذا تبغى الكل يقرأ لازم Rules تسمح بالقراءة."
          : "❌ خطأ أثناء تحميل الحجوزات:\n" + msg
      );

      setAllBookingsRaw([]);
      setLoading(false);
    };

    const unsub = onSnapshot(
      qConfirmed,
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
  }, []);

  const employeeOptions = useMemo(() => {
    const map = new Map<string, string>();

    allBookingsRaw.forEach((b) => {
      const key =
        b.employeeUid ||
        b.employeeId ||
        (normalizeArabic(b.employeeName) ? `name:${normalizeArabic(b.employeeName)}` : "");

      if (!key) return;

      const label =
        b.employeeName ||
        (b.employeeUid ? `موظفة (${b.employeeUid.slice(0, 6)})` : "") ||
        (b.employeeId ? `موظفة (${b.employeeId.slice(0, 6)})` : key);

      if (!map.has(key)) map.set(key, label);
    });

    return Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "ar"));
  }, [allBookingsRaw]);

  const filtered = useMemo(() => {
    const text = normalizeArabic(q);

    const list = allBookingsRaw.filter((b) => {
      const st = String(b.status || "");
      if (!["confirmed", "pending", "new"].includes(st)) return false;
      
      if (employeeFilter !== "all") {
        const key =
          b.employeeUid ||
          b.employeeId ||
          (normalizeArabic(b.employeeName) ? `name:${normalizeArabic(b.employeeName)}` : "");

        if (key !== employeeFilter) return false;
      }

      const iso = String(b.date || "").trim();
      if (!isInQuickRange(iso, dateQuick)) return false;

      if (text) {
        const hay = normalizeArabic(
          `${b.clientName || ""} ${b.clientPhone || ""} ${b.serviceName || ""} ${b.employeeName || ""} ${b.date || ""} ${b.time || ""} ${b.id || ""}`
        );
        if (!hay.includes(text)) return false;
      }

      const isSeen = !!seen[b.id];
      if (tab === "new" && isSeen) return false;
      if (tab === "seen" && !isSeen) return false;

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
  }, [allBookingsRaw, q, employeeFilter, dateQuick, tab, seen]);

  const grouped = useMemo(() => {
    const map = new Map<string, BookingWithId[]>();
    for (const b of filtered) {
      const k = String(b.date || "بدون تاريخ");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const markSeen = (id: string) => {
    if (!myUid) return;
    setSeen((prev) => {
      const next = { ...prev, [id]: Date.now() };
      saveSeenMap(myUid, next);
      return next;
    });
  };

  const markAllSeen = () => {
    if (!myUid) return;
    setSeen((prev) => {
      const next = { ...prev };
      filtered.forEach((b) => {
        if (!next[b.id]) next[b.id] = Date.now();
      });
      saveSeenMap(myUid, next);
      return next;
    });
  };

  return (
    <div className="dashstaff-page" dir="rtl">
      {/* Header */}
      <div className="dashstaff-header">
        <div>
          <h2 className="dashstaff-title">بوابة الموظفات (بدون شروط عرض داخل الصفحة)</h2>
          <div className="dashstaff-sub">
            <span className="pill soft">
              {myEmail ? `تسجيل الدخول: ${myEmail}` : "بدون تسجيل دخول"}
            </span>
            <span className="pill soft">عرض: confirmed فقط</span>
          </div>
        </div>

        <div className="dashstaff-count">النتائج: {filtered.length}</div>
      </div>

      {loading && !errMsg && <div className="dashstaff-box warn">جاري تحميل الحجوزات...</div>}

      {!!errMsg && <div className="dashstaff-box error">{errMsg}</div>}

      {!loading && !errMsg && (
        <>
          {/* Filters */}
          <div className="dashstaff-filters">
            <input
              className="dashstaff-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث: اسم العميلة / رقم / خدمة / موظفة / تاريخ..."
            />

            <select
              className="dashstaff-input"
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
            >
              <option value="all">كل الموظفات</option>
              {employeeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

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

          {/* Tabs */}
          <div className="dashstaff-actions">
            <button type="button" onClick={() => setTab("new")}>
              جديد ({allBookingsRaw.filter((b) => String(b.status) === "confirmed" && !seen[b.id]).length})
            </button>
            <button type="button" onClick={() => setTab("seen")}>
              تمت مراجعته
            </button>
            <button type="button" onClick={() => setTab("all")}>
              الكل ({allBookingsRaw.length})
            </button>
            <button type="button" onClick={markAllSeen} disabled={!myUid}>
              تعليم الكل كمُراجع ✅
            </button>
          </div>

          {/* List */}
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
                    const isSeen = !!seen[b.id];
                    return (
                      <div key={b.id} className="dashstaff-card" style={{ marginTop: 10 }}>
                        <div className="dashstaff-row top">
                          <div className="dashstaff-service">
                            {b.clientName || "—"}{" "}
                            <span className="dashstaff-meta">
                              {b.clientPhone ? `• ${b.clientPhone}` : ""}
                            </span>
                          </div>

                          <span className={`dashstaff-status ${isSeen ? "cancelled" : "confirmed"}`}>
                            {isSeen ? "تمت المراجعة" : "جديد"}
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
                            الموظفة: <b>{b.employeeName || "—"}</b>
                          </div>
                        </div>

                        <div className="dashstaff-actions">
                          <button type="button" onClick={() => markSeen(b.id)} disabled={!myUid}>
                            تعليم كمُراجع ✅
                          </button>

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
