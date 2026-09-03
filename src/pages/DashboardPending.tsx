// src/pages/DashboardPending.tsx
import React, { useEffect, useState } from "react";
void React;

import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";
import { CoreAccountService } from "../services/CoreAccountService";
import { resolveDashboardLandingPath } from "../helpers/routePaths";

type AdminRole = "owner" | "admin" | "hr" | "reception" | "staff" | "pending";
type PendingPageMode = "pending" | "disabled";

const STATUS_REFRESH_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 60_000] as const;

function normalizeAdminRole(raw: any): AdminRole {
  const r = String(raw || "").toLowerCase().trim();
  if (r === "owner") return "owner";
  if (r === "admin" || r === "administrator") return "admin";
  if (
    r === "hr" ||
    r === "human resources" ||
    r === "humanresources" ||
    r === "human_resources" ||
    r === "human-resources"
  )
    return "hr";
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

type DashboardPendingProps = {
  mode?: PendingPageMode;
};

export default function DashboardPending({ mode = "pending" }: DashboardPendingProps) {
  const navigate = useNavigate();
  const isDisabledMode = mode === "disabled";
  const [statusText, setStatusText] = useState<string>(
    isDisabledMode
      ? "حساب الدخول غير مفعل حاليًا. راجع إدارة الحسابات لإعادة تفعيله."
      : "بانتظار تفعيل الحساب من الإدارة...",
  );

  useEffect(() => {
    let active = true;
    let timer: number | null = null;
    let refreshAttempt = 0;
    let requestInFlight = false;
    let unsubscribeAuth: (() => void) | null = null;

    const clearScheduledRefresh = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
    };

    const canRefreshNow = () =>
      active &&
      document.visibilityState === "visible" &&
      (typeof navigator === "undefined" || navigator.onLine !== false);

    const scheduleNextRefresh = () => {
      clearScheduledRefresh();
      if (!canRefreshNow()) return;

      const baseDelay = STATUS_REFRESH_DELAYS_MS[
        Math.min(refreshAttempt, STATUS_REFRESH_DELAYS_MS.length - 1)
      ];
      const jitteredDelay = Math.round(baseDelay * (0.85 + Math.random() * 0.3));

      timer = window.setTimeout(() => {
        timer = null;
        refreshAttempt += 1;
        void refresh();
      }, jitteredDelay);
    };

    const refresh = async () => {
      if (!auth.currentUser || !canRefreshNow() || requestInFlight) return;
      requestInFlight = true;
      let keepWatching = true;

      try {
        const result = await CoreAccountService.me();
        if (!active) return;
        const account = result.user;
        const role = normalizeAdminRole(account.role || account.primaryRole);
        const status = String(account.status || "pending").toLowerCase();

        if (status === "disabled" || status === "deleted") {
          if (!isDisabledMode) {
            keepWatching = false;
            navigate("/account-disabled", { replace: true });
            return;
          }
          setStatusText(
            status === "deleted"
              ? "تم حذف حساب الدخول منطقيًا من إدارة الحسابات."
              : "حساب الدخول معطل حاليًا من إدارة الحسابات."
          );
          return;
        }

        if (status === "pending" || role === "pending") {
          if (isDisabledMode) {
            keepWatching = false;
            navigate("/dashboard-pending", { replace: true });
            return;
          }
          setStatusText("تم تسجيل دخولك، وحسابك ما زال بانتظار التفعيل من الإدارة.");
          return;
        }

        keepWatching = false;
        localStorage.setItem("userRole", role);
        localStorage.setItem("userUid", account.firebaseUid || auth.currentUser.uid);
        if (account.displayName) localStorage.setItem("userName", account.displayName);
        try {
          const previous = JSON.parse(localStorage.getItem("auth_user") || "{}");
          localStorage.setItem("auth_user", JSON.stringify({
            ...previous,
            uid: account.firebaseUid || auth.currentUser.uid,
            role,
            displayName: account.displayName || previous.displayName || "",
            email: account.email || auth.currentUser.email || previous.email || "",
          }));
        } catch {}
        window.dispatchEvent(new Event("authChanged"));
        navigate(resolveDashboardLandingPath(role), { replace: true });
      } catch (error) {
        if (!active) return;
        console.error("Core account status check failed:", error);
        setStatusText("تعذر التحقق من حالة الحساب من Core الآن. حاول تحديث الصفحة.");
      } finally {
        requestInFlight = false;
        if (active && keepWatching) scheduleNextRefresh();
      }
    };

    const refreshWhenActive = () => {
      if (!canRefreshNow()) {
        clearScheduledRefresh();
        return;
      }
      refreshAttempt = 0;
      clearScheduledRefresh();
      void refresh();
    };

    unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user || !active) return;
      refreshAttempt = 0;
      void refresh();
    });

    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);

    return () => {
      active = false;
      clearScheduledRefresh();
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
      unsubscribeAuth?.();
    };
  }, [isDisabledMode, navigate]);

  return (
    <main className="madan-pending-page" dir="rtl">
      <section className="madan-pending-card" aria-live="polite">
        <div className="madan-pending-brand" aria-hidden="true">
          <span className="madan-pending-brand__mark">Q</span>
          <span className="madan-pending-brand__pulse" />
        </div>

        <div className="madan-pending-kicker">Queens Salon · إدارة الحسابات</div>
        <h1 className="madan-pending-title">
          {isDisabledMode ? "حساب الدخول غير مفعل" : "حسابك بانتظار التفعيل"}
        </h1>
        <p className="madan-pending-text">{statusText}</p>

        <div className="madan-pending-progress" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="madan-pending-note">
          {isDisabledMode
            ? "هذه الحالة تُدار من صفحة إدارة الحسابات، وليست طلب تفعيل جديد."
            : "سيتم تحويلك تلقائيًا إلى لوحة التحكم فور اعتماد الحساب."}
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
