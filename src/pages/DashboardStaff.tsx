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
  employeeId?: string;   // ✅ uid غالبًا
  employeeUid?: string;  // ✅ إذا موجود في بعض الحجوزات

  employeeKey?: string; // موجود بالكود عندك لكن Rules ما تعتمد عليه للقراءة

  date?: string;
  time?: string;

  status?: BookingStatus;

  createdAt?: Timestamp | any;
};

type BookingWithId = BookingDoc & { id: string };

const SALON_ID = "main";
type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

function normalizeArabic(s: any) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function allowStaffPortal(role: UiRole | "") {
  return role === "staff" || role === "owner" || role === "admin" || role === "reception";
}

export default function DashboardStaff() {
  const [myUid, setMyUid] = useState<string>("");
  const [myEmail, setMyEmail] = useState<string>("");
  const [myName, setMyName] = useState<string>("");

  const [myRole, setMyRole] = useState<UiRole | "">("");
  const [roleLoading, setRoleLoading] = useState(true);

  const [myBookingsRaw, setMyBookingsRaw] = useState<BookingWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState<string>("");

  // ✅ 1) Auth + role من Firestore (source of truth)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setErrMsg("");
      setMyBookingsRaw([]);
      setLoading(true);
      setRoleLoading(true);

      if (!u) {
        setMyUid("");
        setMyEmail("");
        setMyName("");
        setMyRole("");
        setLoading(false);
        setRoleLoading(false);
        setErrMsg("⚠️ لم يتم تسجيل الدخول. الرجاء تسجيل الدخول بحساب موظفة.");
        return;
      }

      setMyUid(u.uid);
      setMyEmail(u.email || "");
      setMyName(u.displayName || "");

      try {
        const userRef = doc(db, "salons", SALON_ID, "users", u.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          setMyRole("");
          setRoleLoading(false);
          setLoading(false);
          setErrMsg(
            "⚠️ لا يوجد ملف مستخدم لك داخل salons/main/users/{uid}. " +
            "لازم إنشاء حساب الموظفة داخل النظام."
          );
          return;
        }

        const data = snap.data() as any;
        const r = String(data?.role || "").toLowerCase().trim() as UiRole;

        setMyRole(r);
        setRoleLoading(false);

        if (!allowStaffPortal(r)) {
          setLoading(false);
          setErrMsg(`⛔ لا تملك صلاحية فتح بوابة الموظفة. role الحالي: ${r || "غير محدد"}`);
          return;
        }

        setLoading(true);
      } catch (e: any) {
        console.error("DashboardStaff role load error:", e);
        setMyRole("");
        setRoleLoading(false);
        setLoading(false);
        setErrMsg(
          "❌ خطأ أثناء تحميل صلاحيات الحساب (role).\n" + String(e?.message || e)
        );
      }
    });

    return () => unsub();
  }, []);

  // ✅ 2) Realtime: نقرأ حجوزات الموظفة فقط (حل التعليق مع Rules)
  useEffect(() => {
    if (!myUid) return;
    if (roleLoading) return;
    if (!allowStaffPortal(myRole)) return;

    setLoading(true);
    setErrMsg("");
    setMyBookingsRaw([]);

    const colRef = collection(db, "salons", SALON_ID, "bookings");

    // ✅ Query 1: employeeUid == myUid (لو موجود)
    const qByEmployeeUid = query(colRef, where("employeeUid", "==", myUid));

    // ✅ Query 2: employeeId == myUid (الأكثر شيوعًا عندك)
    const qByEmployeeId = query(colRef, where("employeeId", "==", myUid));

    let rowsUid: BookingWithId[] = [];
    let rowsId: BookingWithId[] = [];

    const mergeEmit = () => {
      const m = new Map<string, BookingWithId>();
      for (const x of rowsUid) m.set(x.id, x);
      for (const x of rowsId) m.set(x.id, x);

      const merged = Array.from(m.values());

      // ✅ ترتيب محلي (بدون orderBy لتجنب index)
      merged.sort((a, b) => {
        const ta = (a.createdAt?.toMillis?.() ?? 0) as number;
        const tb = (b.createdAt?.toMillis?.() ?? 0) as number;
        return tb - ta;
      });

      setMyBookingsRaw(merged);
      setLoading(false);
    };

    const onErr = (e: any) => {
      console.error("DashboardStaff snapshot error:", e);
      const msg = String(e?.message || e);

      setErrMsg(
        msg.includes("Missing or insufficient permissions")
          ? "⚠️ تعذر تحميل حجوزاتك بسبب الصلاحيات (Rules). " +
          "تحقق أن الحجز يحتوي employeeId أو employeeUid يساوي uid الموظفة."
          : "❌ خطأ أثناء تحميل الحجوزات:\n" + msg
      );

      setMyBookingsRaw([]);
      setLoading(false);
    };

    const unsub1 = onSnapshot(
      qByEmployeeUid,
      (snap) => {
        rowsUid = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as BookingDoc),
        }));
        mergeEmit();
      },
      onErr
    );

    const unsub2 = onSnapshot(
      qByEmployeeId,
      (snap) => {
        rowsId = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as BookingDoc),
        }));
        mergeEmit();
      },
      onErr
    );

    return () => {
      unsub1();
      unsub2();
    };
  }, [myUid, myRole, roleLoading]);

  // ✅ 3) فلترة إضافية (احتياط) — بنفس منطقك السابق
  const myBookings = useMemo(() => {
    if (!myUid) return [];

    const uid = myUid;

    const filtered = myBookingsRaw.filter((b) => {
      if (b.employeeUid && b.employeeUid === uid) return true;
      if (b.employeeId && b.employeeId === uid) return true;

      // fallback بالاسم (عرض فقط — لكن لن يحل Rules لو كانت الحجوزات بدون uid)
      const bName = normalizeArabic(b.employeeName);
      const myN = normalizeArabic(myName);
      if (myN && bName && bName === myN) return true;

      return false;
    });

    return filtered;
  }, [myBookingsRaw, myUid, myName]);

  return (
    <div className="dashstaff-page" style={{ padding: 16, direction: "rtl" }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontWeight: 900 }}>بوابة الموظفة</h2>
        <p style={{ margin: "6px 0 0", opacity: 0.75, fontWeight: 800 }}>
          {myEmail ? `تسجيل الدخول: ${myEmail}` : "جاري التحقق من الحساب..."}
          {myRole ? ` • role: ${myRole}` : ""}
        </p>
      </div>

      {(roleLoading || loading) && !errMsg && (
        <div style={{ padding: 14, border: "1px solid rgba(0,0,0,.08)", borderRadius: 12 }}>
          جاري تحميل حجوزاتك...
        </div>
      )}

      {!roleLoading && errMsg && (
        <div
          style={{
            padding: 14,
            border: "1px solid rgba(255,0,0,.25)",
            borderRadius: 12,
            background: "rgba(255,0,0,.04)",
            color: "#b00020",
            fontWeight: 800,
            whiteSpace: "pre-wrap",
          }}
        >
          {errMsg}
        </div>
      )}

      {!roleLoading && !loading && !errMsg && (
        <div
          style={{
            marginTop: 12,
            border: "1px solid rgba(0,0,0,.08)",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 12,
              background: "rgba(0,0,0,.03)",
              fontWeight: 900,
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <span>حجوزاتي</span>
            <span style={{ opacity: 0.75 }}>الإجمالي: {myBookings.length}</span>
          </div>

          {myBookings.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.75, fontWeight: 800 }}>
              لا توجد حجوزات مرتبطة بك الآن.
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                (إذا عندك حجوزات قديمة بدون employeeId/employeeUid، لازم “ترحيل مرة واحدة” لتعبئتها)
              </div>
            </div>
          ) : (
            <div style={{ padding: 12, display: "grid", gap: 10 }}>
              {myBookings.map((b) => (
                <div
                  key={b.id}
                  style={{
                    padding: 12,
                    border: "1px solid rgba(0,0,0,.08)",
                    borderRadius: 14,
                    background: "rgba(255,255,255,.96)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 900 }}>
                      {b.clientName || "—"}{" "}
                      <span style={{ opacity: 0.65, fontWeight: 800 }}>
                        {b.clientPhone ? `• ${b.clientPhone}` : ""}
                      </span>
                    </div>
                    <div style={{ fontWeight: 900, opacity: 0.8 }}>
                      {b.status || "pending"}
                    </div>
                  </div>

                  <div style={{ marginTop: 8, opacity: 0.85, fontWeight: 800 }}>
                    الخدمة: {b.serviceName || b.serviceId || "—"}
                  </div>

                  <div style={{ marginTop: 6, opacity: 0.85, fontWeight: 800 }}>
                    الموعد: {b.date || "—"} • {b.time || "—"}
                  </div>

                  <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6, fontWeight: 800 }}>
                    Booking ID: {b.id}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

