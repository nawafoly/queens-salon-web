// ✅ src/pages/DashboardSettings.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../services/firebase";
import { AppSettingsService } from "../services/AppSettingsService";
import type { AppSettings, SectionKey } from "../services/AppSettingsService";

import "../styles/DashboardModals.css";
import "../styles/stylesSettings/DashboardSettings.css";

// ✅ NEW pages
import SettingsAdvanced from "./settings/SettingsAdvanced";
import SettingsBookings from "./settings/SettingsBookings";
import SettingsCatalog from "./settings/SettingsCatalog";
import SettingsUsers from "./settings/SettingsUsers";


/* =========================
   Roles helpers
========================= */
type UiRole =
  | "owner"
  | "admin"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";

function mapFirestoreRoleToUi(roleRaw: string): UiRole {
  const role = String(roleRaw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "pending") return "pending";
  if (role === "client") return "client";
  return "guest";
}

/* =========================
   Collections
========================= */
const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;

const DashboardSettings: React.FC = () => {
  const navigate = useNavigate();

  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [authLoading, setAuthLoading] = useState(true);

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";
  const isReception = uiRole === "reception";
  const isStaff = uiRole === "staff";

  const hasAdminPower = isOwner || isAdmin;
  const canView = hasAdminPower || isReception || isStaff;

  const [tab, setTab] = useState<"salon" | "sections" | "policies">("salon");
  const [settings, setSettings] = useState<AppSettings>(() =>
    AppSettingsService.getCached()
  );
  const [savedMsg, setSavedMsg] = useState<string>("");

  const allowAdminManageUsers = Boolean(
    (settings as any)?.policies?.allowAdminManageUsers
  );

  const canManageUsers = useMemo(() => {
    return isOwner || (isAdmin && allowAdminManageUsers);
  }, [isOwner, isAdmin, allowAdminManageUsers]);

  /* =========================
     Auth & Role
     - فقط قراءة الدور من salons/main/users/{uid}
  ========================= */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);

      try {
        if (!user) {
          setUiRole("guest");
          return;
        }

        const userRef = doc(db, ...USERS_COLLECTION, user.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          setUiRole("guest");
          return;
        }

        const data = snap.data() as any;
        setUiRole(mapFirestoreRoleToUi(data?.role));
      } catch (e) {
        console.error("Settings role load error:", e);
        setUiRole("guest");
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // App settings subscribe
  useEffect(() => {
    AppSettingsService.fetchRemote()
      .then((remote) => setSettings(remote))
      .catch((e) => console.error("fetchRemote settings error:", e));

    const unsub = AppSettingsService.subscribe((remote) => {
      setSettings(remote);
    });

    return () => unsub();
  }, []);

  const hint = useMemo(() => {
    if (hasAdminPower) return "تقدر تعدّل وتحفظ مباشرة.";
    if (isReception) return "عرض فقط لموظفة الاستقبال (لا يمكن التعديل).";
    if (isStaff) return "عرض فقط للموظفة (لا يمكن التعديل).";
    return "غير مصرح.";
  }, [hasAdminPower, isReception, isStaff]);


  const handleSave = async () => {
    if (!hasAdminPower) return;

    try {
      await AppSettingsService.saveRemote(settings);

      window.dispatchEvent(new Event("settingsChanged")); // ✅ هنا

      setSavedMsg("✅ تم حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 2000);
    } catch (e) {
      console.error("save settings error:", e);
      setSavedMsg("❌ تعذر حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 2500);
    }
  };


  const toggleSection = (key: SectionKey) => {
    if (!hasAdminPower) return;
    setSettings((prev: any) => ({
      ...prev,
      sections: { ...prev.sections, [key]: !prev.sections?.[key] },
    }));
  };

  const togglePolicy = (key: string) => {
    if (!hasAdminPower) return;
    setSettings((prev: any) => ({
      ...prev,
      policies: { ...(prev.policies || {}), [key]: !prev.policies?.[key] },
    }));
  };

  /* =========================
     Guards (loading + permission)
  ========================= */
  if (authLoading) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <div className="settings-card">
            <h3 className="settings-title">جاري التحميل…</h3>
            <p style={{ margin: 0, opacity: 0.75 }}>لحظات…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <h3>غير مصرح</h3>
          <p>هذه الصفحة مخصصة للإدارة وموظفات الاستقبال/الموظفات فقط.</p>
        </div>
      </div>
    );
  }

  /* =========================
     Main settings UI (index route)
  ========================= */
  const MainSettings = () => (
    <div className="dashboard-section settings-page">
      <div className="settings-wrap">
        <div className="settings-header">
          <div>
            <h1>الإعدادات</h1>
            <p className="settings-hint">{hint}</p>
          </div>

          <div className="settings-save">
            {savedMsg && <span className="settings-saved">{savedMsg}</span>}

            <button
              className="exp-btn"
              onClick={() => navigate("advanced")}
              type="button"
              title="إعدادات متقدمة"
            >
              إعدادات متقدمة
            </button>

            <button
              className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
              onClick={handleSave}
              disabled={!hasAdminPower}
              type="button"
              title={!hasAdminPower ? "تحتاج صلاحية Owner/Admin" : "حفظ الإعدادات"}
            >
              حفظ
            </button>
          </div>
        </div>

        <div className="settings-tabs">
          <button
            className={`dash-btn ${tab === "salon" ? "primary" : ""}`}
            onClick={() => setTab("salon")}
            type="button"
          >
            بيانات الصالون
          </button>

          <button
            className={`dash-btn ${tab === "sections" ? "primary" : ""}`}
            onClick={() => setTab("sections")}
            type="button"
          >
            الأقسام
          </button>

          <button
            className={`dash-btn ${tab === "policies" ? "primary" : ""}`}
            onClick={() => setTab("policies")}
            type="button"
          >
            صلاحيات النظام
          </button>
        </div>

        {tab === "salon" && (
          <div className="settings-card">
            <h3 className="settings-title">بيانات الصالون</h3>

            <div className="settings-grid">
              <div className="settings-field">
                <label>اسم الصالون</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.salonName || ""}
                  onChange={(e) =>
                    hasAdminPower &&
                    setSettings({ ...(settings as any), salonName: e.target.value })
                  }
                  disabled={!hasAdminPower}
                />
              </div>

              <div className="settings-field">
                <label>الجوال</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.phone || ""}
                  onChange={(e) =>
                    hasAdminPower &&
                    setSettings({ ...(settings as any), phone: e.target.value })
                  }
                  disabled={!hasAdminPower}
                />
              </div>

              <div className="settings-field">
                <label>المدينة</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.city || ""}
                  onChange={(e) =>
                    hasAdminPower &&
                    setSettings({ ...(settings as any), city: e.target.value })
                  }
                  disabled={!hasAdminPower}
                />
              </div>
            </div>

            {!hasAdminPower && (
              <div className="settings-note">
                * للتعديل تحتاج صلاحية Owner/Admin.
              </div>
            )}
          </div>
        )}

        {tab === "sections" && (
          <div className="settings-card">
            <h3 className="settings-title">تفعيل/إخفاء الأقسام</h3>

            <div className="settings-list">
              {(
                [
                  ["overview", "نظرة عامة"],
                  ["bookings", "الحجوزات"],
                  ["clients", "العميلات"],
                  ["employees", "الموظفات"],
                  ["offers", "العروض والكوبونات"],
                  ["reports", "التقارير"],
                  ["income", "الإيرادات"],
                  ["expenses", "المصروفات"],
                ] as Array<[SectionKey, string]>
              ).map(([key, label]) => (
                <label key={key} className="settings-row">
                  <span>{label}</span>
                  <input
                    className="settings-check"
                    type="checkbox"
                    checked={!!(settings as any)?.sections?.[key]}
                    onChange={() => toggleSection(key)}
                    disabled={!hasAdminPower}
                  />
                </label>
              ))}
            </div>

            <div className="settings-footnote">
              * هذه مربوطة فعليًا بالـ Dashboard (الروابط + الراوتس).
              <br />
              * صفحة الإعدادات لا يمكن إخفاؤها (مقصودة).
            </div>
          </div>
        )}

        {tab === "policies" && (
          <div className="settings-card">
            <h3 className="settings-title">صلاحيات النظام</h3>

            <div className="settings-list">
              <label className="settings-row">
                <span>السماح للموظفات بتغيير حالة الحجز</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={!!(settings as any)?.policies?.allowStaffChangeStatus}
                  onChange={() => togglePolicy("allowStaffChangeStatus")}
                  disabled={!hasAdminPower}
                />
              </label>

              <label className="settings-row">
                <span>السماح للاستقبال بتغيير حالة الحجز</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={
                    !!(settings as any)?.policies?.allowReceptionChangeStatus
                  }
                  onChange={() => togglePolicy("allowReceptionChangeStatus")}
                  disabled={!hasAdminPower}
                />
              </label>

              <label className="settings-row">
                <span>السماح للموظفات بمشاهدة العميلات</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={!!(settings as any)?.policies?.allowStaffViewClients}
                  onChange={() => togglePolicy("allowStaffViewClients")}
                  disabled={!hasAdminPower}
                />
              </label>

              <label className="settings-row">
                <span>السماح للـ Admin بإدارة حسابات المستخدمين</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={
                    !!(settings as any)?.policies?.allowAdminManageUsers
                  }
                  onChange={() => togglePolicy("allowAdminManageUsers")}
                  disabled={!hasAdminPower}
                />
              </label>
            </div>

            <div className="settings-footnote">
              * هذا الخيار يتحكم إذا الـ Admin يقدر ينشئ/يدير حسابات من الإعدادات المتقدمة.
            </div>
          </div>
        )}
      </div>
    </div>
  );

  /* =========================
     Nested routes under /dashboard/settings/*
  ========================= */
  return (
    <Routes>
      <Route index element={<MainSettings />} />

      <Route
        path="advanced"
        element={
          <SettingsAdvanced
            uiRole={uiRole}
            hasAdminPower={hasAdminPower}
            canManageUsers={canManageUsers}
          />
        }
      />

      <Route path="advanced/bookings" element={<SettingsBookings />} />
      <Route path="advanced/catalog" element={<SettingsCatalog hasAdminPower={hasAdminPower} />} />
      <Route path="advanced/users" element={<SettingsUsers />} />

      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  );
};

export default DashboardSettings;
