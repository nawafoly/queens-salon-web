// src/pages/DashboardStaff.tsx
import { useEffect, useMemo, useRef, useState } from "react";

import { onAuthStateChanged } from "firebase/auth";
import { addDoc, collection, doc, getDoc, serverTimestamp } from "firebase/firestore";

import { auth, db } from "../services/firebase";

import { watchAllBookings, type BookingDocWithId, type BookingStatus } from "../services/firestoreBookings";

import "../styles/DashboardModals.css";
import "../styles/DashboardBookings.css"; // نستخدم نفس ستايل الجدول

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
 * ✅ NEW: Strict match للموظفات (عشان ما يصير تداخل بين الموظفات)
 * - للـ staff: تطابق الاسم "بالضبط" بعد التطبيع فقط
 * - يلغى contains/تشابه كلمات/إيميل… لأنها تسبب false positives
 */
function strictStaffMatch(employeeNameFromBooking: string, myName: string) {
    const empRaw = String(employeeNameFromBooking || "").trim();
    const meRaw = String(myName || "").trim();

    if (!empRaw || !meRaw) return false;

    const emp = normalizeArabicName(empRaw);
    const me = normalizeArabicName(meRaw);

    // ✅ فقط تطابق كامل (exact)
    return !!me && emp === me;
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

    // ✅ load my profile from Firestore (source of truth)
    async function loadMyProfile(uid: string, emailFallback: string, nameFallback: string) {
        try {
            const userRef = doc(db, ...USERS_COLLECTION, uid);
            const snap = await getDoc(userRef);
            const data = snap.exists() ? (snap.data() as any) : {};

            const roleRaw = String(data?.role || "").toLowerCase().trim();
            const role: UiRole =
                roleRaw === "owner"
                    ? "owner"
                    : roleRaw === "admin"
                        ? "admin"
                        : roleRaw === "reception"
                            ? "reception"
                            : roleRaw === "staff"
                                ? "staff"
                                : roleRaw === "client"
                                    ? "client"
                                    : "guest";

            setUiRole(role);

            const dn = String(data?.displayName || nameFallback || "مستخدمة").trim();
            const em = String(data?.email || emailFallback || "").trim().toLowerCase();

            setMyName(dn);
            setMyEmail(em);
        } catch (e) {
            console.error("loadMyProfile error:", e);
            setUiRole("guest");
            setMyName(nameFallback || "مستخدمة");
            setMyEmail((emailFallback || "").toLowerCase());
        }
    }

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
                setLoading(false);
                setLoadError("⚠️ لازم تسجّلين دخول بحساب الموظفة.");
                setUiRole("guest");
                return;
            }

            setMyUid(u.uid);
            await loadMyProfile(u.uid, String(u.email || ""), String(u.displayName || ""));

            // ✅ watch all bookings and filter locally
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
        });

        return () => {
            unsubAuth();
            if (unsubRef.current) {
                unsubRef.current();
                unsubRef.current = null;
            }
        };
    }, []);

    const isAllowed = uiRole === "staff" || uiRole === "owner" || uiRole === "admin" || uiRole === "reception";

    const myBookings = useMemo(() => {
        if (!isAllowed) return [];

        const isStaffOnly = uiRole === "staff";

        return rows
            .filter((b) => {
                const empId = String((b as any)?.employeeId ?? "").trim();
                const empName = String((b as any)?.employeeName ?? "").trim();

                // ✅ أفضل شيء: employeeId يطابق uid
                if (empId && myUid && empId === myUid) return true;

                // ✅ للـ staff: مطابقة صارمة بالاسم فقط (بدون ذكاء زائد)
                if (isStaffOnly) {
                    return strictStaffMatch(empName, myName);
                }

                // ✅ للأدوار الأخرى (admin/reception/owner): ما يحتاجون فلترة أصلاً،
                // لكن بما إنك تبيهم يدخلون الصفحة "كعرض عام" نخليها ترجع الكل لهم.
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
    }, [rows, myUid, myName, isAllowed, uiRole]);

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
            setTimeout(() => setSentMsg(""), 2500);
        } catch (e) {
            console.error("sendMessage error:", e);
            setSentMsg("❌ تعذر الإرسال (Rules?)");
            setTimeout(() => setSentMsg(""), 3000);
        } finally {
            setSending(false);
        }
    }

    if (!isAllowed) {
        return (
            <div className="dashboard-section">
                <h3>غير مصرح</h3>
                <p>هذه الصفحة مخصصة للموظفات فقط.</p>
            </div>
        );
    }

    return (
        <div className="bookings-page">
            <div className="bookings-header">
                <h1>لوحة الموظفة</h1>
                <p>حجوزاتي + التواصل مع الإدارة</p>

                {todayAlert && (
                    <div className="bookings-error" style={{ background: "#111", color: "#fff" }}>
                        {todayAlert}
                    </div>
                )}
                {loadError && <div className="bookings-error">{loadError}</div>}
            </div>

            {/* My bookings */}
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
                                {loading ? (
                                    <tr>
                                        <td colSpan={6} style={{ padding: 16, textAlign: "center" }}>
                                            جاري التحميل...
                                        </td>
                                    </tr>
                                ) : myBookings.length === 0 ? (
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

            {/* Contact admin */}
            <div className="settings-card" style={{ marginTop: 16 }}>
                <h3 className="settings-title">التواصل مع الإدارة</h3>

                <div style={{ display: "grid", gap: 10 }}>
                    <textarea
                        className="form-control"
                        style={{ minHeight: 110, resize: "vertical" }}
                        value={msg}
                        onChange={(e) => setMsg(e.target.value)}
                        placeholder="اكتبي رسالتك للإدارة هنا..."
                        disabled={sending}
                    />

                    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
                        {sentMsg && <span className="settings-alert success">{sentMsg}</span>}
                        <button className="reports-btn" type="button" onClick={sendMessage} disabled={sending || !msg.trim()}>
                            {sending ? "جاري الإرسال..." : "إرسال"}
                        </button>
                    </div>

                    <div className="settings-footnote">
                        * يتم حفظ الرسالة داخل Firestore في <b>salons/main/staff_messages</b> لتظهر للإدارة لاحقاً.
                    </div>
                </div>
            </div>
        </div>
    );
}
