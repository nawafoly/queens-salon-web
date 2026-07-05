// src/pages/DashboardPending.tsx
import React, { useEffect, useState } from "react";
void React;

import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { resolveDashboardLandingPath } from "../helpers/routePaths";

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
  if (r === "staff" || r === "employee") return "staff";
  return "pending";
}

export default function DashboardPending() {
  const navigate = useNavigate();
  const [statusText, setStatusText] = useState<string>(
    "بانتظار تفعيل الحساب من الإدارة...",
  );

  useEffect(() => {
    let unsubUserDoc: null | (() => void) = null;
    let unsubAuth: null | (() => void) = null;

    const startWatch = (uid: string) => {
      if (!uid) return;

      if (unsubUserDoc) {
        try {
          unsubUserDoc();
        } catch {
          // ignore duplicate unsubscribe
        }
      }

      const userRef = doc(db, ...USERS_COL, uid);

      unsubUserDoc = onSnapshot(
        userRef,
        (snap) => {
          if (!snap.exists()) {
            setStatusText("تم إنشاء الحساب وبانتظار إضافته أو تفعيله من الإدارة...");
            return;
          }

          const data: any = snap.data();
          const active = data?.active !== false;
          const role: AdminRole = active
            ? normalizeAdminRole(data?.role)
            : "pending";

          if (role !== "pending") {
            localStorage.setItem("userRole", role);

            try {
              const old = JSON.parse(
                localStorage.getItem("auth_user") || "{}",
              );
              const displayName = String(
                data?.displayName ||
                  data?.name ||
                  old?.displayName ||
                  localStorage.getItem("userName") ||
                  "",
              ).trim();

              if (displayName) localStorage.setItem("userName", displayName);

              localStorage.setItem(
                "auth_user",
                JSON.stringify({
                  ...old,
                  uid,
                  role,
                  displayName: displayName || old?.displayName || "",
                  email:
                    old?.email || data?.email || auth.currentUser?.email || "",
                }),
              );
            } catch {
              // ignore malformed cache
            }

            window.dispatchEvent(new Event("authChanged"));
            navigate(resolveDashboardLandingPath(role), { replace: true });
            return;
          }

          setStatusText(
            "تم تسجيل دخولك، وحسابك ما زال بانتظار التفعيل من الإدارة.",
          );
        },
        (err) => {
          console.error("Pending onSnapshot error:", err);
          setStatusText("تعذر التحقق من حالة التفعيل الآن. حاول تحديث الصفحة.");
        },
      );
    };

    const uidLS = String(localStorage.getItem("userUid") || "").trim();
    if (uidLS) startWatch(uidLS);

    unsubAuth = onAuthStateChanged(auth, (u) => {
      const uid = u?.uid || uidLS;
      if (uid) startWatch(uid);
    });

    return () => {
      try {
        if (unsubUserDoc) unsubUserDoc();
      } catch {
        // ignore
      }
      try {
        if (unsubAuth) unsubAuth();
      } catch {
        // ignore
      }
    };
  }, [navigate]);

  return (
    <main className="madan-pending-page" dir="rtl">
      <section className="madan-pending-card" aria-live="polite">
        <div className="madan-pending-brand" aria-hidden="true">
          <span className="madan-pending-brand__mark">Q</span>
          <span className="madan-pending-brand__pulse" />
        </div>

        <div className="madan-pending-kicker">Queens Salon · إدارة الحسابات</div>
        <h1 className="madan-pending-title">حسابك بانتظار التفعيل</h1>
        <p className="madan-pending-text">{statusText}</p>

        <div className="madan-pending-progress" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="madan-pending-note">
          سيتم تحويلك تلقائيًا إلى لوحة التحكم فور اعتماد الحساب.
        </div>

        <div className="madan-pending-actions">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="madan-pending-button"
          >
            الرجوع إلى الموقع
          </button>
        </div>
      </section>
    </main>
  );
}
