// src/pages/DashboardPending.tsx
import React, { useEffect, useState } from "react";
void React;

import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../services/firebase";

const SALON_ID = "main";
const USERS_COL = ["salons", SALON_ID, "users"] as const;

type AdminRole = "owner" | "admin" | "reception" | "staff" | "pending";

function normalizeAdminRole(raw: any): AdminRole {
  const r = String(raw || "").toLowerCase().trim();
  if (r === "owner") return "owner";
  if (r === "admin" || r === "administrator") return "admin";
  if (
    r === "reception" ||
    r === "receptionist" ||
    r === "frontdesk" ||
    r === "desk"
  )
    return "reception";
  if (r === "staff") return "staff";
  return "pending";
}

export default function DashboardPending() {
  const navigate = useNavigate();
  const [statusText, setStatusText] = useState<string>("بانتظار تفعيل الحساب من الإدارة...");

  useEffect(() => {
    let unsubUserDoc: null | (() => void) = null;
    let unsubAuth: null | (() => void) = null;

    const startWatch = (uid: string) => {
      if (!uid) return;

      const userRef = doc(db, ...USERS_COL, uid);

      unsubUserDoc = onSnapshot(
        userRef,
        (snap) => {
          if (!snap.exists()) {
            setStatusText("تم إنشاء الحساب وبانتظار إضافته/تفعيله من الإدارة...");
            return;
          }

          const data: any = snap.data();

          // ✅ نفس منطقك في Login:
          // active=false => pending
          const active = data?.active !== false;
          const role: AdminRole = active ? normalizeAdminRole(data?.role) : "pending";

          // ✅ إذا تفعل الحساب وصار role مو pending -> حدّث الجلسة ووجّه للداشبورد
          if (role !== "pending") {
            // تحديث localStorage role
            localStorage.setItem("userRole", role);

            // تحديث auth_user (لأن الداشبورد يعتمد عليه)
            try {
              const old = JSON.parse(localStorage.getItem("auth_user") || "{}");
              const displayName =
                String(data?.displayName || data?.name || old?.displayName || localStorage.getItem("userName") || "").trim();

              if (displayName) localStorage.setItem("userName", displayName);

              localStorage.setItem(
                "auth_user",
                JSON.stringify({
                  ...old,
                  uid,
                  role,
                  displayName: displayName || old?.displayName || "",
                  email: old?.email || data?.email || auth.currentUser?.email || "",
                })
              );
            } catch {
              // ignore
            }

            // ✅ علشان Login.tsx و أي listener يسمع
            window.dispatchEvent(new Event("authChanged"));

            // ✅ تحويل تلقائي
            navigate("/dashboard", { replace: true });
            return;
          }

          setStatusText("تم تسجيل دخولك، وحسابك ما زال بانتظار التفعيل من الإدارة.");
        },
        (err) => {
          console.error("Pending onSnapshot error:", err);
          setStatusText("تعذر التحقق من حالة التفعيل الآن. حاول تحديث الصفحة.");
        }
      );
    };

    // 1) جرّب uid من localStorage (أسرع)
    const uidLS = String(localStorage.getItem("userUid") || "").trim();
    if (uidLS) startWatch(uidLS);

    // 2) تابع auth عشان لو uid ما كان مخزن أو تغير
    unsubAuth = onAuthStateChanged(auth, (u) => {
      const uid = u?.uid || uidLS;
      if (uid) startWatch(uid);
    });

    return () => {
      try {
        if (unsubUserDoc) unsubUserDoc();
      } catch {}
      try {
        if (unsubAuth) unsubAuth();
      } catch {}
    };
  }, [navigate]);

  const styles = {
    page: {
      minHeight: "70vh",
      display: "grid",
      placeItems: "center",
      padding: 24,
    } as React.CSSProperties,

    card: {
      maxWidth: 520,
      width: "100%",
      padding: 22,
      borderRadius: 18,
      border: "1px solid rgba(13,13,13,.08)",
      background: "rgba(245,245,244,.92)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      boxShadow: "0 10px 30px rgba(0,0,0,.06)",
    } as React.CSSProperties,

    title: {
      margin: "0 0 8px 0",
      fontSize: 20,
      fontWeight: 900,
      color: "#0D0D0D",
    } as React.CSSProperties,

    text: {
      margin: 0,
      opacity: 0.85,
      lineHeight: 1.9,
      color: "#515659",
    } as React.CSSProperties,

    actions: {
      display: "flex",
      gap: 10,
      marginTop: 16,
      color: "#111",
      justifyContent: "flex-end",
    } as React.CSSProperties,

    btnPrimary: {
      padding: "10px 14px",
      borderRadius: 12,
      border: "none",
      background: "#0D0D0D",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 700,
    } as React.CSSProperties,

    btnSecondary: {
      padding: "10px 14px",
      borderRadius: 12,
      border: "1px solid rgba(13,13,13,.12)",
      background: "#fff",
      cursor: "pointer",
      fontWeight: 700,
    } as React.CSSProperties,
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.title}>حسابك بانتظار التفعيل</h2>

        <p style={styles.text}>{statusText}</p>

        <div style={styles.actions}>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={styles.btnSecondary}
          >
            تحديث الحالة
          </button>

          <button
            type="button"
            onClick={() => navigate("/")}
            style={styles.btnPrimary}
          >
            رجوع للموقع
          </button>
        </div>
      </div>
    </div>
  );
}
