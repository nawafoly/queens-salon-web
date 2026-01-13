// src/pages/DashboardStaff.tsx
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";

import { auth, db } from "../services/firebase";
import "../styles/DashboardStaff.css";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";
type BookingStatus = "pending" | "confirmed" | "cancelled";

type BookingDoc = {
  createdAt?: Timestamp;
  createdBy?: string;
  channel?: string;

  clientName?: string;
  clientPhone?: string;

  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm
  serviceName?: string;

  // ✅ legacy/old
  employeeId?: string | null; // قديمًا: كان UID، الآن في Booking صار staff_public id
  employeeName?: string; // fallback

  // ✅ NEW: UID الحقيقي للموظفة (الربط الصحيح للموظفات)
  employeeUid?: string | null;

  status?: BookingStatus;
  total?: number;
  finalPrice?: number;
  note?: string;

  slotId?: string;
  userId?: string;
};

type BookingRow = BookingDoc & { id: string };

const SALON_ID = "main";

function normalizeArabicName(input: string) {
  return (input || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[ـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ة]/g, "ه")
    .replace(/[ى]/g, "ي");
}

function canViewAll(role: UiRole) {
  return role === "owner" || role === "admin" || role === "reception";
}

function canEditStatus(role: UiRole) {
  return role === "owner" || role === "admin" || role === "reception";
}

export default function DashboardStaff() {
  const [fbUser, setFbUser] = useState<User | null>(null);

  const [role, setRole] = useState<UiRole>("guest");
  const [displayName, setDisplayName] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [error, setError] = useState<string>("");

  // Filters
  const [qText, setQText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | BookingStatus>("");
  const [dateFilter, setDateFilter] = useState<string>("");

  // 1) Auth + Profile role
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setFbUser(u || null);
      setError("");

      if (!u) {
        setRole("guest");
        setDisplayName("");
        setLoading(false);
        setBookings([]);
        return;
      }

      setLoading(true);
      try {
        const userRef = doc(db, "salons", SALON_ID, "users", u.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          setRole("guest");
          setDisplayName(u.displayName || u.email || "موظفة");
        } else {
          const data: any = snap.data();
          setRole((data?.role || "guest") as UiRole);
          setDisplayName(
            (data?.displayName ||
              data?.name ||
              u.displayName ||
              u.email ||
              "موظفة") as string
          );
        }
      } catch (e: any) {
        setError(e?.message || "فشل تحميل بيانات المستخدم");
        setRole("guest");
        setDisplayName(u.displayName || u.email || "موظفة");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // 2) Bookings realtime
  useEffect(() => {
    if (!fbUser) return;

    setError("");

    const col = collection(db, "salons", SALON_ID, "bookings");

    // ✅ للـ staff: نقرأ حسب employeeUid (الربط الصحيح)
    // ✅ للإدارة: نقرأ الكل
    const qy = canViewAll(role)
      ? query(col, orderBy("createdAt", "desc"))
      : query(
          col,
          where("employeeUid", "==", fbUser.uid),
          orderBy("createdAt", "desc")
        );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as BookingDoc),
        }));
        setBookings(rows);
      },
      (err) => setError(err?.message || "فشل تحميل الحجوزات")
    );

    return () => unsub();
  }, [fbUser?.uid, role]);

  const filtered = useMemo(() => {
    let list = [...bookings];

    // ✅ fallback مؤقت للحجوزات القديمة:
    // - لو الاستعلام جاب حجوزات (employeeUid)
    // - نضيف فلترة محلية بالاسم لو فيه حجوزات قديمة ما معها employeeUid لكن فيها employeeName مطابق
    //
    // ملاحظة: الفلترة هنا لا “تضيف” حجوزات غير موجودة في الاستعلام.
    // لذلك لو عندك حجوزات قديمة بلا employeeUid، لازم يتم ترحيلها/تحديثها أو توفر Query ثاني.
    //
    // لكن هذا fallback مفيد إذا كنت تعرض "الكل" (للإدارة) أو لو لاحقًا عدلت لإحضار الكل ثم فلترة محلية.
    if (fbUser && !canViewAll(role)) {
      const myName = normalizeArabicName(displayName);

      // ✅ إذا فيه عناصر employeeUid مش موجودة (حالات قديمة) ننقيها لو تطابق الاسم
      list = list.filter((b) => {
        // الربط الصحيح
        const eu = String(b.employeeUid || "").trim();
        if (eu && eu === fbUser.uid) return true;

        // توافق قديم: بعض البيانات ممكن كانت employeeId = uid
        const eid = String(b.employeeId || "").trim();
        if (eid && eid === fbUser.uid) return true;

        // fallback بالاسم
        const empName = normalizeArabicName(b.employeeName || "");
        return !!empName && !!myName && empName === myName;
      });
    }

    const t = qText.trim().toLowerCase();
    if (t) {
      list = list.filter((b) => {
        const hay = [
          b.clientName,
          b.clientPhone,
          b.employeeName,
          b.serviceName,
          b.date,
          b.time,
          b.status,
          b.note,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(t);
      });
    }

    if (statusFilter)
      list = list.filter((b) => (b.status || "pending") === statusFilter);
    if (dateFilter) list = list.filter((b) => (b.date || "") === dateFilter);

    return list;
  }, [bookings, fbUser, role, displayName, qText, statusFilter, dateFilter]);

  async function setBookingStatus(id: string, next: BookingStatus) {
    if (!canEditStatus(role)) return;
    try {
      const ref = doc(db, "salons", SALON_ID, "bookings", id);
      await updateDoc(ref, { status: next });
    } catch (e: any) {
      setError(e?.message || "فشل تحديث حالة الحجز");
    }
  }

  return (
    <div className="dashstaff-page">
      <div className="dashstaff-header">
        <div>
          <h2 className="dashstaff-title">
            {canViewAll(role)
              ? "بوابة الموظفات — كل الحجوزات"
              : "بوابة الموظفة — حجوزاتي"}
          </h2>
          <div className="dashstaff-sub">
            {fbUser ? (
              <>
                <span className="pill">{displayName || "—"}</span>
                <span className="pill soft">{role}</span>
              </>
            ) : (
              <span className="pill soft">غير مسجل</span>
            )}
          </div>
        </div>

        <div className="dashstaff-count">
          <span>العدد</span>
          <strong>{filtered.length}</strong>
        </div>
      </div>

      {!fbUser && (
        <div className="dashstaff-box warn">
          لازم تسجّل دخول كموظفة عشان تشوف حجوزاتك.
        </div>
      )}

      {loading && fbUser && <div className="dashstaff-muted">جاري التحميل…</div>}

      {error && <div className="dashstaff-box error">{error}</div>}

      {fbUser && !loading && (
        <>
          <div className="dashstaff-filters">
            <input
              className="dashstaff-input"
              value={qText}
              onChange={(e) => setQText(e.target.value)}
              placeholder="بحث (اسم العميل/الجوال/الخدمة/ملاحظة...)"
            />

            <select
              className="dashstaff-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
            >
              <option value="">كل الحالات</option>
              <option value="pending">انتظار</option>
              <option value="confirmed">مؤكد</option>
              <option value="cancelled">ملغي</option>
            </select>

            <input
              className="dashstaff-input"
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>

          <div className="dashstaff-list">
            {filtered.map((b) => {
              const st = (b.status || "pending") as BookingStatus;
              const price = b.total ?? b.finalPrice ?? 0;

              return (
                <div key={b.id} className="dashstaff-card">
                  <div className="dashstaff-row top">
                    <strong className="dashstaff-service">
                      {b.serviceName || "خدمة"}
                    </strong>
                    <span className="dashstaff-meta">
                      {b.date || "—"} • {b.time || "—"}
                    </span>
                    <span className={`dashstaff-status ${st}`}>{st}</span>
                  </div>

                  <div className="dashstaff-row">
                    <div>
                      العميلة: <strong>{b.clientName || "—"}</strong>
                    </div>
                    <div>
                      الجوال: <strong>{b.clientPhone || "—"}</strong>
                    </div>
                    <div>
                      العاملة: <strong>{b.employeeName || "—"}</strong>
                    </div>
                    <div>
                      الإجمالي: <strong>{price}</strong>
                    </div>
                  </div>

                  {b.note ? (
                    <div className="dashstaff-note">ملاحظة: {b.note}</div>
                  ) : null}

                  {canEditStatus(role) && (
                    <div className="dashstaff-actions">
                      <button onClick={() => setBookingStatus(b.id, "confirmed")}>
                        تأكيد
                      </button>
                      <button onClick={() => setBookingStatus(b.id, "cancelled")}>
                        إلغاء
                      </button>
                      <button onClick={() => setBookingStatus(b.id, "pending")}>
                        انتظار
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="dashstaff-box empty">
                ما فيه حجوزات مطابقة للفلاتر الحالية.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
