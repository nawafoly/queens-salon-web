import { DashboardSelectBridgeV2 } from "../components/dashboard-v2/DashboardNativeControlBridgeV2";
// ✅ src/pages/DashboardStaff.tsx
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import {
  collection,
  getDocs,
  onSnapshot,
  query,
  where,
  doc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";

import { auth, db } from "../services/firebase";
import { readStoredAuthSession } from "../services/localAuthSession";
import { updateBookingStatus as updateBookingStatusFS } from "../services/firestoreBookings";
import { FirestoreReadStats } from "../services/firestoreReadStats";

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

function safeStaffKey(s: any) {
  return String(s || "")
    .trim()
    .replaceAll("/", "-")
    .replace(/\s+/g, "_");
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

function formatTime12(time24?: string) {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || "—");
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? "م" : "ص"}`;
}

type DateQuick = "all" | "today" | "tomorrow" | "week";
type StatusQuick = "all" | BookingStatus;

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

function normalizeStatus(status?: string): BookingStatus {
  const st = String(status || "pending").toLowerCase();
  if (st === "confirmed" || st === "completed" || st === "cancelled") return st;
  return "pending";
}

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "بانتظار التأكيد",
  confirmed: "مؤكد",
  completed: "مكتمل",
  cancelled: "ملغي",
};

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
  byName?: string;
  at: any;
  note?: string;
};

function readCachedStaffDisplayName() {
  try {
    const raw = localStorage.getItem("auth_user");
    if (raw) {
      const parsed = JSON.parse(raw) as any;
      const displayName = String(parsed?.displayName || parsed?.name || "").trim();
      if (displayName) return displayName;
    }
  } catch {
    // ignore
  }

  try {
    return String(localStorage.getItem("userName") || "").trim();
  } catch {
    return "";
  }
}

type DashboardStaffProps = {
  allowStatusChange?: boolean;
};

export default function DashboardStaff({ allowStatusChange = false }: DashboardStaffProps) {
  const [myUid, setMyUid] = useState<string>(() => readStoredAuthSession()?.uid || "");
  const [myEmail, setMyEmail] = useState<string>(() => readStoredAuthSession()?.email || "");
  const [myName, setMyName] = useState<string>(() => {
    return readStoredAuthSession()?.displayName || readCachedStaffDisplayName();
  });
  const [myStaffDocId, setMyStaffDocId] = useState<string>("");
  const [myStaffName, setMyStaffName] = useState<string>("");

  const [allBookingsRaw, setAllBookingsRaw] = useState<BookingWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string>("");

  const [tab, setTab] = useState<"new" | "seen" | "all">("new");
  const [q, setQ] = useState("");
  const [dateQuick, setDateQuick] = useState<DateQuick>("all");
  const [statusQuick, setStatusQuick] = useState<StatusQuick>("all");

  const [busyId, setBusyId] = useState<string>(""); // ✅ disable button while writing

  // ✅ 1) Auth: uid + email
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      const localSession = readStoredAuthSession();
      const uid = String(localSession?.uid || u?.uid || "");
      const email = String(localSession?.email || u?.email || "");
      const displayName = String(
        localSession?.displayName ||
          u?.displayName ||
          readCachedStaffDisplayName() ||
          ""
      ).trim();
      setMyUid(uid);
      setMyEmail(email);
      setMyName(displayName);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!myUid) {
      setMyStaffDocId("");
      setMyStaffName("");
      return;
    }

    let cancelled = false;

    const loadStaffIdentity = async () => {
      try {
        const spCol = collection(db, "salons", SALON_ID, "staff_public");
        const byUid = query(spCol, where("linkedUid", "==", myUid));
        const snap = await getDocs(byUid);

        if (cancelled) return;

        if (!snap.empty) {
          const hit = snap.docs[0];
          const data = hit.data() as any;
          setMyStaffDocId(hit.id);
          setMyStaffName(String(data?.name || "").trim());
        } else {
          setMyStaffDocId("");
          setMyStaffName("");
        }
      } catch (e) {
        console.warn("DashboardStaff staff identity lookup failed:", e);
        if (cancelled) return;
        setMyStaffDocId("");
        setMyStaffName("");
      }
    };

    loadStaffIdentity();

    return () => {
      cancelled = true;
    };
  }, [myUid]);

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
    const rowsByKeyUid: { value: BookingWithId[] } = { value: [] };
    const rowsByUid: { value: BookingWithId[] } = { value: [] };
    const rowsByStaffId: { value: BookingWithId[] } = { value: [] };
    const rowsByName: { value: BookingWithId[] } = { value: [] };
    const rowsByKeyName: { value: BookingWithId[] } = { value: [] };

    const makeSnapLogger = (label: string) => {
      let first = true;
      const src = `DashboardStaff.${String(label || "").trim() || "unknown"}.onSnapshot`;
      return (snap: any) => {
        const docs = first ? snap.docs : snap.docChanges().map((c: any) => c.doc);
        docs.forEach((d: any) => {
          if (d?.ref?.path) FirestoreReadStats.bump(d.ref.path, src, "onSnapshot");
        });
        first = false;
      };
    };
    const logKeyUid = makeSnapLogger("employeeKey_uid");
    const logUid = makeSnapLogger("employeeUid_uid");
    const logStaffId = makeSnapLogger("employeeId_staffDocId");
    const logName = makeSnapLogger("employeeName");
    const logKeyName = makeSnapLogger("employeeKey_safeName");

    const mapDocs = (snap: any): BookingWithId[] =>
      snap.docs.map((d: any) => ({
        id: d.id,
        ...(d.data() as BookingDoc),
      }));

    const emitMerged = () => {
      const merged = new Map<string, BookingWithId>();
      [
        rowsByKeyUid.value,
        rowsByUid.value,
        rowsByStaffId.value,
        rowsByName.value,
        rowsByKeyName.value,
      ].forEach((rows) => {
        rows.forEach((r) => merged.set(r.id, r));
      });

      const finalRows = Array.from(merged.values()).sort(
        (a, b) => safeMs(b.createdAt) - safeMs(a.createdAt)
      );

      setAllBookingsRaw(finalRows);
      setLoading(false);
    };

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

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        query(colRef, where("employeeKey", "==", myUid)),
        (snap) => {
          logKeyUid(snap);
          rowsByKeyUid.value = mapDocs(snap);
          emitMerged();
        },
        onErr
      )
    );

    unsubs.push(
      onSnapshot(
        query(colRef, where("employeeUid", "==", myUid)),
        (snap) => {
          logUid(snap);
          rowsByUid.value = mapDocs(snap);
          emitMerged();
        },
        onErr
      )
    );

    if (myStaffDocId) {
      unsubs.push(
        onSnapshot(
          query(colRef, where("employeeId", "==", myStaffDocId)),
          (snap) => {
            logStaffId(snap);
            rowsByStaffId.value = mapDocs(snap);
            emitMerged();
          },
          onErr
        )
      );
    }

    if (myStaffName) {
      const keyName = safeStaffKey(myStaffName);

      unsubs.push(
        onSnapshot(
          query(colRef, where("employeeName", "==", myStaffName)),
          (snap) => {
            logName(snap);
            rowsByName.value = mapDocs(snap);
            emitMerged();
          },
          onErr
        )
      );

      unsubs.push(
        onSnapshot(
          query(colRef, where("employeeKey", "==", keyName)),
          (snap) => {
            logKeyName(snap);
            rowsByKeyName.value = mapDocs(snap);
            emitMerged();
          },
          onErr
        )
      );
    }

    return () => {
      unsubs.forEach((u) => {
        try {
          u();
        } catch {}
      });
    };
  }, [myUid, myStaffDocId, myStaffName]);

  const baseFiltered = useMemo(() => {
    const text = normalizeArabic(q);

    return allBookingsRaw.filter((b) => {
      const st = normalizeStatus(b.status);

      const iso = String(b.date || "").trim();
      if (!isInQuickRange(iso, dateQuick)) return false;

      if (statusQuick !== "all" && st !== statusQuick) return false;

      if (text) {
        const hay = normalizeArabic(
          `${b.clientName || ""} ${b.clientPhone || ""} ${b.serviceName || ""} ${b.employeeName || ""} ${b.date || ""} ${b.time || ""} ${b.id || ""}`
        );
        if (!hay.includes(text)) return false;
      }

      return true;
    });
  }, [allBookingsRaw, q, dateQuick, statusQuick]);

  const filtered = useMemo(() => {
    const list = baseFiltered.filter((b) => {
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
  }, [baseFiltered, tab]);

  const grouped = useMemo(() => {
    const map = new Map<string, BookingWithId[]>();
    for (const b of filtered) {
      const k = String(b.date || "بدون تاريخ");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(b);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const countNew = useMemo(() => baseFiltered.filter((b) => !b.staffAck).length, [baseFiltered]);
  const countSeen = useMemo(() => baseFiltered.filter((b) => b.staffAck).length, [baseFiltered]);
  const countAll = useMemo(() => baseFiltered.length, [baseFiltered]);

  const statusCounts = useMemo(() => {
    const out: Record<BookingStatus, number> = {
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
    };
    baseFiltered.forEach((b) => {
      out[normalizeStatus(b.status)] += 1;
    });
    return out;
  }, [baseFiltered]);

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
        byName: myName || myEmail || myUid,
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
            byName: myName || myEmail || myUid,
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

  const setBookingStatus = async (bookingId: string, status: BookingStatus) => {
    if (!myUid || !bookingId) return;
    if (!allowStatusChange) return;

    if (status === "cancelled") {
      const ok = confirm("تأكيد إلغاء هذا الحجز؟");
      if (!ok) return;
    }

    setBusyId(bookingId);
    setErrMsg("");

    try {
      await updateBookingStatusFS(bookingId, status);
    } catch (e: any) {
      console.error("setBookingStatus error:", e);
      const msg = String(e?.message || e);
      setErrMsg(
        msg.includes("Missing or insufficient permissions")
          ? "⚠️ الصلاحيات تمنع تغيير حالة الحجز. تأكد من تفعيل صلاحية الموظفة من الإعدادات."
          : "❌ تعذر تغيير حالة الحجز:\n" + msg
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

      {!loading && !errMsg && (
        <>
          <div className="dashstaff-filters">
            <input
              className="dashstaff-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="بحث: اسم العميلة / رقم / خدمة / تاريخ..."
            />

            <DashboardSelectBridgeV2
              className="dashstaff-input"
              value={dateQuick}
              onChange={(e) => setDateQuick(e.target.value as DateQuick)}
            >
              <option value="week">هذا الأسبوع</option>
              <option value="today">اليوم</option>
              <option value="tomorrow">بكرا</option>
              <option value="all">كل التواريخ</option>
            </DashboardSelectBridgeV2>

            <DashboardSelectBridgeV2
              className="dashstaff-input"
              value={statusQuick}
              onChange={(e) => setStatusQuick(e.target.value as StatusQuick)}
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
            <button
              type="button"
              className={`btn-tab ${tab === "new" ? "is-active" : ""}`}
              onClick={() => setTab("new")}
            >
              جديد ({countNew})
            </button>
            <button
              type="button"
              className={`btn-tab ${tab === "seen" ? "is-active" : ""}`}
              onClick={() => setTab("seen")}
            >
              تم الاستلام ({countSeen})
            </button>
            <button
              type="button"
              className={`btn-tab ${tab === "all" ? "is-active" : ""}`}
              onClick={() => setTab("all")}
            >
              الكل ({countAll})
            </button>

            <button
              type="button"
              className="btn-bulk"
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
                    const st = normalizeStatus(b.status);
                    const statusLabel = STATUS_LABEL[st];
                    const isAck = !!b.staffAck;
                    const canConfirm = allowStatusChange && st === "pending";
                    const canComplete = allowStatusChange && st === "confirmed";
                    const canCancel = allowStatusChange && (st === "pending" || st === "confirmed");

                    return (
                      <div key={b.id} className="dashstaff-card" style={{ marginTop: 10 }}>
                        <div className="dashstaff-row top">
                          <div className="dashstaff-service">
                            {b.clientName || "—"}{" "}
                            <span className="dashstaff-meta">
                              {b.clientPhone ? `• ${b.clientPhone}` : ""}
                            </span>
                          </div>

                          <div className="dashstaff-badges">
                            <span className={`dashstaff-status ${st}`}>{statusLabel}</span>
                            <span className={`pill ${isAck ? "soft" : "ack-new"}`}>
                              {isAck ? "تم الاستلام" : "جديد ولم يتم الاستلام"}
                            </span>
                          </div>
                        </div>

                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">
                            الخدمة: <b>{b.serviceName || b.serviceId || "—"}</b>
                          </div>
                        </div>

                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">
                            الموعد: <b>{b.date || "—"}</b> • <b>{formatTime12(b.time)}</b>
                          </div>
                        </div>

                        <div className="dashstaff-row">
                          <div className="dashstaff-meta">
                            الحالة التشغيلية: <b>{statusLabel}</b>
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
                              className="btn-receipt"
                              onClick={() => confirmReceipt(b.id)}
                              disabled={!myUid || busyId === b.id}
                              title="يسجل حدث استلام داخل booking_logs"
                            >
                              {busyId === b.id ? "..." : "اضغطي هنا لتأكيد الاستلام ✅"}
                            </button>
                          ) : (
                            <span className="pill soft">✅ تم تأكيد الاستلام (مسجل)</span>
                          )}

                          {canConfirm && (
                            <button
                              type="button"
                              className="btn-confirm"
                              onClick={() => setBookingStatus(b.id, "confirmed")}
                              disabled={!myUid || busyId === b.id}
                              title="تأكيد الحجز"
                            >
                              تأكيد الموعد
                            </button>
                          )}

                          {canComplete && (
                            <button
                              type="button"
                              className="btn-complete"
                              onClick={() => setBookingStatus(b.id, "completed")}
                              disabled={!myUid || busyId === b.id}
                              title="إنهاء الخدمة"
                            >
                              إنهاء الخدمة
                            </button>
                          )}

                          {canCancel && (
                            <button
                              type="button"
                              className="btn-cancel"
                              onClick={() => setBookingStatus(b.id, "cancelled")}
                              disabled={!myUid || busyId === b.id}
                              title="إلغاء الحجز"
                            >
                              إلغاء الحجز
                            </button>
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
