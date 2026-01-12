// src/pages/DashboardStaff.tsx
import { useEffect, useMemo, useRef, useState } from "react";

import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../services/firebase";

// ✅ watchEmployeeBookings
import {
  watchAllBookings,
  watchEmployeeBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";

import "../styles/DashboardStaff.css";
import "../styles/DashboardModals.css";
import "../styles/DashboardBookings.css"; // نفس ستايل الجدول

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;
const STAFF_MESSAGES_COL = ["salons", SALON_ID, "staff_messages"] as const;

const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

function safeISODate(d: string | undefined | null) {
  if (!d) return "";
  return d.trim();
}

function stripArabicDiacritics(s: string) {
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "")
    .replace(/\u0640/g, "");
}

function normalizeArabicName(input: string) {
  const s = String(input || "").trim().toLowerCase();
  const noDia = stripArabicDiacritics(s);

  const unified = noDia
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return unified;
}

/**
 * ✅ Strict match (fallback) للموظفات (بدون تداخل)
 */
function strictStaffMatch(employeeNameFromBooking: string, myName: string) {
  const empRaw = String(employeeNameFromBooking || "").trim();
  const meRaw = String(myName || "").trim();

  if (!empRaw || !meRaw) return false;

  const emp = normalizeArabicName(empRaw);
  const me = normalizeArabicName(meRaw);

  return !!me && emp === me;
}

function normalizeRole(roleRaw: any): UiRole {
  const r = String(roleRaw || "").toLowerCase().trim();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  if (r === "reception") return "reception";
  if (r === "staff") return "staff";
  if (r === "client") return "client";
  return "guest";
}

export default function DashboardStaff() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [uiRole, setUiRole] = useState<UiRole>("guest");

  const [myUid, setMyUid] = useState<string>("");
  const [myName, setMyName] = useState<string>("");
  const [myEmail, setMyEmail] = useState<string>("");

  const [rows, setRows] = useState<BookingDocWithId[]>([]);
  const unsubRef = useRef<null | (() => void)>(null);

  // ====== messages
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState("");

  // ✅ modal
  const [openMsg, setOpenMsg] = useState(false);

  // ✅ Source of truth: Firestore user profile
  async function loadMyProfile(uid: string, emailFallback: string, nameFallback: string) {
    try {
      const userRef = doc(db, ...USERS_COLLECTION, uid);
      const snap = await getDoc(userRef);
      const data = snap.exists() ? (snap.data() as any) : {};

      const role = normalizeRole(data?.role);
      setUiRole(role);

      const dn = String(data?.displayName || nameFallback || "مستخدمة").trim();
      const em = String(data?.email || emailFallback || "").trim().toLowerCase();

      setMyName(dn);
      setMyEmail(em);

      return { role, dn, em };
    } catch (e) {
      console.error("loadMyProfile error:", e);

      const dn = String(nameFallback || "مستخدمة").trim();
      const em = String(emailFallback || "").trim().toLowerCase();

      setUiRole("guest");
      setMyName(dn);
      setMyEmail(em);

      return { role: "guest" as UiRole, dn, em };
    }
  }

  const isAllowed =
    uiRole === "staff" || uiRole === "owner" || uiRole === "admin" || uiRole === "reception";

  // ✅ subscribe bookings
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      // stop previous watcher
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }

      setRows([]);
      setLoadError("");
      setLoading(true);

      if (!u) {
        setUiRole("guest");
        setMyUid("");
        setMyName("");
        setMyEmail("");
        setLoading(false);
        setLoadError("⚠️ لازم تسجّلين دخول بحساب الموظفة.");
        return;
      }

      setMyUid(u.uid);

      // ✅ لازم نجيب الاسم/الرول من Firestore قبل اختيار الـ watcher
      const prof = await loadMyProfile(
        u.uid,
        String(u.email || ""),
        String(u.displayName || "")
      );

      // ✅ إذا مو مسموح: وقف هنا
      const allowedNow =
        prof.role === "staff" || prof.role === "owner" || prof.role === "admin" || prof.role === "reception";

      if (!allowedNow) {
        setRows([]);
        setLoading(false);
        setLoadError("هذه الصفحة مخصصة للموظفات/الإدارة فقط.");
        return;
      }

      // ✅ Staff: watchEmployeeBookings (بدون صلاحيات قراءة كل الحجوزات)
      if (prof.role === "staff") {
        unsubRef.current = watchEmployeeBookings(
          u.uid,
          prof.dn, // ✅ fallback name
          (data) => {
            setRows(Array.isArray(data) ? data : []);
            setLoading(false);
          },
          (err) => {
            console.error("watchEmployeeBookings error:", err);
            setLoading(false);
            setLoadError("⚠️ تعذر تحميل حجوزاتك (صلاحيات/Rules).");
          }
        );
      } else {
        // ✅ Admin/Owner/Reception: watchAllBookings (يحتاج صلاحيات أعلى)
        unsubRef.current = watchAllBookings(
          (data) => {
            setRows(Array.isArray(data) ? data : []);
            setLoading(false);
          },
          (err) => {
            console.error("watchAllBookings error:", err);
            setLoading(false);
            setLoadError("⚠️ تعذر تحميل الحجوزات (صلاحيات/Rules).");
          }
        );
      }
    });

    return () => {
      unsubAuth();
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, []);

  const myBookings = useMemo(() => {
    // ✅ مهم: لا ترجع "غير مصرح" بسبب uiRole قبل ما ينتهي التحميل
    if (loading) return [];

    if (!isAllowed) return [];

    const isStaffOnly = uiRole === "staff";

    return rows
      .filter((b) => {
        if (isStaffOnly) {
          const empUid = String((b as any)?.employeeUid ?? "").trim();  // ✅ NEW
          const empId = String((b as any)?.employeeId ?? "").trim();    // قديم/أحيانًا كان UID
          const empName = String((b as any)?.employeeName ?? "").trim();

          // ✅ الأفضل: employeeUid == uid
          if (empUid && myUid && empUid === myUid) return true;

          // ✅ دعم قديم لو employeeId كان أصلاً UID في بعض السجلات
          if (empId && myUid && empId === myUid) return true;

          // ✅ fallback: strict name match
          return strictStaffMatch(empName, myName);
        }

        return true;
      })
      .sort((a, b) => {
        const ad = safeISODate((a as any)?.date);
        const bd = safeISODate((b as any)?.date);
        if (ad !== bd) return ad.localeCompare(bd);

        const at = String((a as any)?.time || "");
        const bt = String((b as any)?.time || "");
        return at.localeCompare(bt);
      });
  }, [rows, myUid, myName, isAllowed, uiRole, loading]);

  const todayAlert = useMemo(() => {
    if (!myBookings.length) return "";

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const today = `${yyyy}-${mm}-${dd}`;

    const todays = myBookings.filter((b) => String((b as any)?.date || "") === today);
    if (!todays.length) return "";

    const next = todays[0];
    const time = String((next as any)?.time || "");
    const client = String((next as any)?.clientName || "");
    return `📌 عندك حجز اليوم الساعة ${time}${client ? ` — (${client})` : ""}`;
  }, [myBookings]);

  async function sendMessage() {
    const text = msg.trim();
    if (!text) return;
    if (!auth.currentUser?.uid) return;

    try {
      setSending(true);
      setSentMsg("");

      await addDoc(collection(db, ...STAFF_MESSAGES_COL), {
        staffUid: auth.currentUser.uid,
        staffName: myName || auth.currentUser.displayName || "موظفة",
        staffEmail: myEmail || auth.currentUser.email || "",
        message: text,
        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setMsg("");
      setSentMsg("✅ تم إرسال رسالتك للإدارة");

      setTimeout(() => {
        setSentMsg("");
        setOpenMsg(false);
      }, 1200);
    } catch (e) {
      console.error("sendMessage error:", e);
      setSentMsg("❌ تعذر الإرسال (Rules?)");
      setTimeout(() => setSentMsg(""), 3000);
    } finally {
      setSending(false);
    }
  }

  // ✅ بدل ما نعرض "غير مصرح" قبل ما يكتمل التحميل
  if (loading) {
    return (
      <div className="bookings-page staff-page">
        <div className="bookings-header staff-header">
          <div className="staff-header__title">
            <h1>لوحة الموظفة</h1>
            <p>جاري التحميل...</p>
          </div>
        </div>

        <div className="bookings-table-card">
          <div style={{ padding: 16, textAlign: "center" }}>جاري تحميل بياناتك...</div>
        </div>
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="dashboard-section">
        <h3>غير مصرح</h3>
        <p>{loadError || "هذه الصفحة مخصصة للموظفات فقط."}</p>
      </div>
    );
  }

  return (
    <div className="bookings-page staff-page">
      <div className="bookings-header staff-header">
        <div className="staff-header__title">
          <h1>لوحة الموظفة</h1>
          <p>حجوزاتي</p>
        </div>

        <div className="staff-header__actions">
          <button className="exp-btn primary" type="button" onClick={() => setOpenMsg(true)}>
            💬 التواصل مع الإدارة
          </button>
        </div>

        {todayAlert && (
          <div className="bookings-error" style={{ background: "#111", color: "#fff" }}>
            {todayAlert}
          </div>
        )}
        {loadError && <div className="bookings-error">{loadError}</div>}
      </div>

      <div className="bookings-table-card">
        <div className="bk-table-wrap">
          <div className="table-responsive">
            <table className="bookings-table">
              <thead>
                <tr>
                  <th>العميلة</th>
                  <th>الجوال</th>
                  <th>الخدمة</th>
                  <th>التاريخ</th>
                  <th>الوقت</th>
                  <th>الحالة</th>
                </tr>
              </thead>

              <tbody>
                {myBookings.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 16, textAlign: "center" }}>
                      لا توجد حجوزات لك حالياً
                    </td>
                  </tr>
                ) : (
                  myBookings.map((b) => (
                    <tr key={b.id}>
                      <td>{String((b as any)?.clientName || "—")}</td>
                      <td>{String((b as any)?.clientPhone || (b as any)?.phone || "—")}</td>
                      <td>{String((b as any)?.serviceName || "—")}</td>
                      <td>{String((b as any)?.date || "—")}</td>
                      <td>{String((b as any)?.time || "—")}</td>
                      <td>
                        <span className={`status-badge ${(b as any)?.status || "pending"}`}>
                          {statusLabel[((b as any)?.status || "pending") as BookingStatus] || (b as any)?.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Message Admin Modal */}
      {openMsg && (
        <div className="modal-overlay" onMouseDown={() => setOpenMsg(false)}>
          <div className="modal-box" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div className="modal-title-wrap">
                <div className="modal-icon">💬</div>
                <div style={{ minWidth: 0 }}>
                  <h3 className="modal-title">التواصل مع الإدارة</h3>
                  <p className="modal-text" style={{ marginTop: 4, opacity: 0.75 }}>
                    اكتب رسالتك وسيتم حفظها داخل Firestore
                  </p>
                </div>
              </div>

              <button className="modal-close" type="button" onClick={() => setOpenMsg(false)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              {sentMsg && (
                <div
                  className={`settings-alert ${sentMsg.startsWith("❌") ? "error" : "success"}`}
                  style={{ marginBottom: 10 }}
                >
                  {sentMsg}
                </div>
              )}

              <textarea
                className="form-control"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                placeholder="اكتبي رسالتك للإدارة هنا..."
                disabled={sending}
                style={{ minHeight: 140, resize: "vertical" }}
              />

              <div className="settings-footnote" style={{ marginTop: 10 }}>
                * يتم حفظ الرسالة داخل Firestore في <b>salons/main/staff_messages</b> لتظهر للإدارة لاحقاً.
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-cancel" type="button" onClick={() => setOpenMsg(false)} disabled={sending}>
                إغلاق
              </button>

              <button className="btn-confirm" type="button" onClick={sendMessage} disabled={sending || !msg.trim()}>
                {sending ? "جاري الإرسال..." : "إرسال"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
