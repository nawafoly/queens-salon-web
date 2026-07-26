

// ✅ src/pages/DashboardSettings.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import "../styles/DashboardEnterpriseWorkspaces.css";

import { AppSettingsService } from "../services/AppSettingsService";
import type { AppSettings, SectionKey } from "../services/AppSettingsService";
import { readStoredAuthSession } from "../services/localAuthSession";
import { normalizeAuthRole } from "../services/authAccess";
import PermissionRoute from "../components/PermissionRoute";
import { usePermissions } from "../security/PermissionContext";

import SettingsBookings from "./settings/SettingsBookings";
import SettingsCatalog from "./settings/SettingsCatalog";
import SettingsUsers from "./settings/SettingsUsers";
import SettingsContact from "./settings/SettingsContact";
import SettingsAttendance from "./settings/SettingsAttendance";
import {
  SettingsPageActions,
  SettingsPageHeader,
  SettingsSection,
  SettingsState,
  SettingsStats,
  SettingsTabs,
} from "./settings/SettingsFrame";


/* =========================
   Roles helpers
========================= */
type UiRole =
  | "owner"
  | "admin"
  | "hr"
  | "accountant"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";

function mapRoleToUi(roleRaw: unknown): UiRole {
  return normalizeAuthRole(roleRaw);
}

type DashboardSettingsProps = {
  initialRole?: UiRole | string;
  authReady?: boolean;
  settings?: any;
};

const SETTINGS_ROOT_PATH = "/dashboard/settings";

function normalizePathname(pathname: string) {
  const trimmed = String(pathname || "").trim().replace(/\/+$/, "");
  return trimmed || "/";
}

const DashboardSettings: React.FC<DashboardSettingsProps> = ({
  initialRole,
  authReady,
  settings: settingsProp,
}) => {
  const [uiRole, setUiRole] = useState<UiRole>(mapRoleToUi(initialRole ?? readStoredAuthSession()?.role ?? "guest"));
  const { hasPermission, hasAnyPermission, role: permissionRole } = usePermissions();
  const [authLoading, setAuthLoading] = useState(() =>
    typeof authReady === "boolean" ? !authReady : false
  );

  const canManageGeneralSettings = hasPermission("settings.general.manage");
  const canView = hasAnyPermission([
    "settings.general.manage",
    "settings.booking.manage",
    "catalog.manage",
    "admin_accounts.view",
    "admin_accounts.manage",
    "settings.content.manage",
    "attendance.settings.manage",
  ]);

  const [settings, setSettings] = useState<AppSettings>(() =>
    settingsProp || AppSettingsService.getCached()
  );
  const [savedMsg, setSavedMsg] = useState<string>("");
  const [activeBasicSection, setActiveBasicSection] = useState<"identity" | "sections" | "policies">("identity");

  const currentRootPath = normalizePathname(SETTINGS_ROOT_PATH);

  const settingsNavItems = useMemo(
    () => [
      {
        key: "home",
        label: "الإعدادات الأساسية",
        hint: "هوية الصالون والإعدادات العامة",
        to: currentRootPath,
        badge: "01",
        visible: canManageGeneralSettings,
        activePaths: [currentRootPath],
      },
      {
        key: "bookings",
        label: "إعدادات الحجوزات",
        hint: "الدوام والاستثناءات",
        to: `${currentRootPath}/bookings`,
        badge: "02",
        visible: hasPermission("settings.booking.manage"),
        activePaths: [`${currentRootPath}/bookings`],
      },
      {
        key: "catalog",
        label: "إدارة الكتالوج",
        hint: "الأقسام والخدمات",
        to: `${currentRootPath}/catalog`,
        badge: "03",
        visible: hasPermission("catalog.manage"),
        activePaths: [`${currentRootPath}/catalog`],
      },
      {
        key: "users",
        label: "إدارة الحسابات",
        hint: "إنشاء وتعديل حسابات الموظفات",
        to: `${currentRootPath}/users`,
        badge: "04",
        visible: hasPermission("admin_accounts.view") || hasPermission("admin_accounts.manage"),
        activePaths: [`${currentRootPath}/users`],
      },
      {
        key: "contact",
        label: "محتوى الموقع",
        hint: "العنوان وبيانات التواصل",
        to: `${currentRootPath}/contact`,
        badge: "05",
        visible: hasPermission("settings.content.manage"),
        activePaths: [`${currentRootPath}/contact`],
      },
      {
        key: "attendance",
        label: "الحضور والبصمة",
        hint: "النطاقات وسياسات تسجيل الحضور",
        to: `${currentRootPath}/attendance`,
        badge: "06",
        visible: hasPermission("attendance.settings.manage"),
        activePaths: [`${currentRootPath}/attendance`],
      },
    ],
    [
      canManageGeneralSettings,
      currentRootPath,
      hasPermission,
    ]
  );

  const accessibleNavCount = settingsNavItems.filter((item) => item.visible).length;
  const sectionsEnabledCount = Object.values((settings as any)?.sections || {}).filter(Boolean).length;
  const policiesEnabledCount = Object.values((settings as any)?.policies || {}).filter(Boolean).length;
  const sectionTotalCount = Object.keys((settings as any)?.sections || {}).length || 8;
  const policyTotalCount = Object.keys((settings as any)?.policies || {}).length || 4;

  const mainSettingsStats = useMemo(
    () => [
      {
        label: "الصفحات المباشرة",
        value: String(accessibleNavCount),
        hint: "روابط ظاهرة من اللوحة الحالية",
      },
      {
        label: "الأقسام المفعلة",
        value: `${sectionsEnabledCount}/${sectionTotalCount}`,
        hint: "من إعدادات الواجهة الأساسية",
      },
      {
        label: "السياسات النشطة",
        value: `${policiesEnabledCount}/${policyTotalCount}`,
        hint: "إعدادات التشغيل والصلاحيات",
      },
      {
        label: "الحالة الحالية",
        value: canManageGeneralSettings ? "قابل للتعديل" : "محدود",
        hint: canManageGeneralSettings ? "صلاحية إعدادات عامة" : "حسب الصلاحيات الممنوحة",
      },
    ],
    [
      accessibleNavCount,
      canManageGeneralSettings,
      policiesEnabledCount,
      policyTotalCount,
      sectionTotalCount,
      sectionsEnabledCount,
    ]
  );

  useEffect(() => {
    setUiRole(mapRoleToUi(initialRole ?? permissionRole ?? readStoredAuthSession()?.role ?? "guest"));
  }, [initialRole, permissionRole]);

  useEffect(() => {
    if (typeof authReady === "boolean") {
      setAuthLoading(!authReady);
    }
  }, [authReady]);

  useEffect(() => {
    if (settingsProp) {
      setSettings(settingsProp);
    }
  }, [settingsProp]);

  const allowAdminManageUsers = Boolean(
    (settings as any)?.policies?.allowAdminManageUsers
  );

  // App settings subscribe
  useEffect(() => {
    if (settingsProp) return;

    AppSettingsService.fetchRemote()
      .then((remote) => setSettings(remote))
      .catch((e) => console.error("fetchRemote settings error:", e));

    const unsub = AppSettingsService.subscribe((remote) => {
      setSettings(remote);
    });

    return () => unsub();
  }, [settingsProp]);

  const hint = useMemo(() => {
    if (canManageGeneralSettings) return "تقدر تعدّل وتحفظ مباشرة.";
    if (canView) return "يمكنك فتح الأقسام التي تسمح بها صلاحيات حسابك.";
    return "غير مصرح.";
  }, [canManageGeneralSettings, canView]);


  const handleSave = async () => {
    if (!canManageGeneralSettings) return;

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
    if (!canManageGeneralSettings) return;
    setSettings((prev: any) => ({
      ...prev,
      sections: { ...prev.sections, [key]: !prev.sections?.[key] },
    }));
  };

  const togglePolicy = (key: string) => {
    if (!canManageGeneralSettings) return;
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
      <div className="dashboard-section settings-page enterprise-workspace-page enterprise-workspace-v2 enterprise-settings-v2">
        <div className="settings-wrap">
          <SettingsState title="جاري التحميل…" hint="لحظات…" loading />
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="dashboard-section settings-page enterprise-workspace-page enterprise-workspace-v2 enterprise-settings-v2">
        <div className="settings-wrap">
          <SettingsState
            title="غير مصرح"
            hint="هذه الصفحة مخصصة للإدارة وموظفات الاستقبال/الموظفات فقط."
          />
        </div>
      </div>
    );
  }

  /* =========================
     Main settings UI (index route)
  ========================= */
  const MainSettings = () => (
    <div className="dashboard-section settings-page enterprise-workspace-page enterprise-workspace-v2 enterprise-settings-v2">
      <div className="settings-wrap">
        <SettingsPageHeader
          eyebrow="الوحدة 03"
          title="الإعدادات الأساسية"
          hint={hint}
          badges={
            <>
              <span className="settings-shell__pill settings-shell__pill--success">جاهز للحفظ</span>
              <span className="settings-shell__pill settings-shell__pill--outline">{accessibleNavCount} روابط مباشرة</span>
              <span className="settings-shell__pill settings-shell__pill--outline">
                {canManageGeneralSettings ? "صلاحية إعدادات عامة" : "عرض محدود"}
              </span>
            </>
          }
        />

        <SettingsStats items={mainSettingsStats} />

        <SettingsTabs
          variant="cards"
          className="settings-basic-tabs"
          activeId={activeBasicSection}
          onChange={(id) => setActiveBasicSection(id as "identity" | "sections" | "policies")}
          items={[
            {
              id: "identity",
              index: "01",
              title: "هوية المنصة",
              hint: "اسم الصالون والجوال والمدينة",
            },
            {
              id: "sections",
              index: "02",
              title: "ظهور الأقسام",
              hint: `${sectionsEnabledCount}/${sectionTotalCount} أقسام مفعلة`,
            },
            {
              id: "policies",
              index: "03",
              title: "سياسات التشغيل",
              hint: `${policiesEnabledCount}/${policyTotalCount} سياسات نشطة`,
            },
          ]}
        />

        {activeBasicSection === "identity" ? (
          <SettingsSection
            eyebrow="01"
            title="هوية المنصة"
            hint="البيانات الأساسية التي تظهر في الشاشات العامة والإدارية."
            actions={
              <span className={`settings-shell__pill ${canManageGeneralSettings ? "settings-shell__pill--success" : "settings-shell__pill--outline"}`}>
                {canManageGeneralSettings ? "قابل للتعديل" : "عرض فقط"}
              </span>
            }
            className="settings-basic-panel"
          >
            <div className="settings-basic-form">
              <div className="settings-field">
                <label>اسم الصالون</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.salonName || ""}
                  onChange={(e) =>
                    canManageGeneralSettings &&
                    setSettings({ ...(settings as any), salonName: e.target.value })
                  }
                  disabled={!canManageGeneralSettings}
                  placeholder="مثال: Queens Salon"
                />
              </div>

              <div className="settings-field">
                <label>الجوال</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.phone || ""}
                  onChange={(e) =>
                    canManageGeneralSettings &&
                    setSettings({ ...(settings as any), phone: e.target.value })
                  }
                  disabled={!canManageGeneralSettings}
                  placeholder="05xxxxxxxx"
                />
              </div>

              <div className="settings-field">
                <label>المدينة</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.city || ""}
                  onChange={(e) =>
                    canManageGeneralSettings &&
                    setSettings({ ...(settings as any), city: e.target.value })
                  }
                  disabled={!canManageGeneralSettings}
                  placeholder="المدينة المنورة"
                />
              </div>
            </div>

            {!canManageGeneralSettings ? (
              <div className="settings-note">* للتعديل تحتاج صلاحية settings.general.manage.</div>
            ) : null}
          </SettingsSection>
        ) : null}

        {activeBasicSection === "sections" ? (
          <SettingsSection
            eyebrow="02"
            title="ظهور الأقسام"
            hint="تحكم في الأقسام التي تظهر داخل لوحة التحكم والصفحات المرتبطة بها."
            actions={
              <span className="settings-shell__pill settings-shell__pill--outline">
                {sectionsEnabledCount}/{sectionTotalCount}
              </span>
            }
            className="settings-basic-panel"
          >
            <div className="settings-toggle-grid">
              {(
                [
                  ["overview", "نظرة عامة", "ملخص سريع للوحة الرئيسية"],
                  ["bookings", "الحجوزات", "مواعيد العميلات وجدولة الزيارات"],
                  ["clients", "العميلات", "ملفات العميلات وسجل التعامل"],
                  ["employees", "الموظفات", "إدارة الفريق والملفات الوظيفية"],
                  ["offers", "العروض والكوبونات", "العروض، الباقات، وأكواد الخصم"],
                  ["reports", "التقارير", "تقارير الأداء والحركة"],
                  ["income", "الإيرادات", "ملخص الدخل والمدفوعات"],
                  ["expenses", "المصروفات", "سجل المصروفات التشغيلية"],
                ] as Array<[SectionKey, string, string]>
              ).map(([key, label, description]) => {
                const enabled = !!(settings as any)?.sections?.[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className={`settings-toggle-card ${enabled ? "is-on" : ""}`}
                    aria-pressed={enabled}
                    disabled={!canManageGeneralSettings}
                    onClick={() => toggleSection(key)}
                  >
                    <span className="settings-toggle-card__mark" aria-hidden="true">
                      {enabled ? "✓" : ""}
                    </span>
                    <span className="settings-toggle-card__copy">
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <span className="settings-toggle-card__status">
                      {enabled ? "ظاهر" : "مخفي"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="settings-footnote">
              * صفحة الإعدادات الأساسية ثابتة، وبقية الأقسام تتحكم في ظهور الروابط داخل لوحة التحكم.
            </div>
          </SettingsSection>
        ) : null}

        {activeBasicSection === "policies" ? (
          <SettingsSection
            eyebrow="03"
            title="سياسات التشغيل"
            hint="صلاحيات تشغيلية تتحكم بسلوك الأدوار داخل النظام."
            actions={
              <span className="settings-shell__pill settings-shell__pill--outline">
                {policiesEnabledCount}/{policyTotalCount}
              </span>
            }
            className="settings-basic-panel"
          >
            <div className="settings-toggle-grid settings-toggle-grid--policies">
              {[
                [
                  "allowStaffChangeStatus",
                  "تغيير حالة الحجز للموظفات",
                  "تمكين الموظفة من تحديث حالة الموعد المرتبط بها.",
                ],
                [
                  "allowReceptionChangeStatus",
                  "تغيير حالة الحجز للاستقبال",
                  "تمكين الاستقبال من تحديث حالات الحجوزات اليومية.",
                ],
                [
                  "allowStaffViewClients",
                  "مشاهدة العميلات للموظفات",
                  "السماح للموظفة باستعراض بيانات العميلات حسب الصلاحية.",
                ],
                [
                  "allowAdminManageUsers",
                  "إدارة الحسابات للـ Admin",
                  "السماح للأدمن بإنشاء وتعديل الحسابات من صفحات الإدارة.",
                ],
              ].map(([key, label, description]) => {
                const enabled = !!(settings as any)?.policies?.[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className={`settings-toggle-card ${enabled ? "is-on" : ""}`}
                    aria-pressed={enabled}
                    disabled={!canManageGeneralSettings}
                    onClick={() => togglePolicy(key)}
                  >
                    <span className="settings-toggle-card__mark" aria-hidden="true">
                      {enabled ? "✓" : ""}
                    </span>
                    <span className="settings-toggle-card__copy">
                      <strong>{label}</strong>
                      <small>{description}</small>
                    </span>
                    <span className="settings-toggle-card__status">
                      {enabled ? "مفعلة" : "متوقفة"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="settings-footnote">
              * هذه السياسات تؤثر مباشرة على الأدوار والصلاحيات داخل لوحة التحكم.
            </div>
          </SettingsSection>
        ) : null}

        <SettingsPageActions
          note={
            <>
              {savedMsg ? <span className="settings-saved">{savedMsg}</span> : null}
              <div className="settings-footnote" style={{ marginTop: savedMsg ? 8 : 0 }}>
                * الحفظ يطبق على كل الشاشات التي تعتمد على AppSettings.
              </div>
            </>
          }
          actions={
            <button
              className={`exp-btn primary ${!canManageGeneralSettings ? "is-disabled" : ""}`}
              onClick={handleSave}
              disabled={!canManageGeneralSettings}
              type="button"
              title={!canManageGeneralSettings ? "تحتاج صلاحية settings.general.manage" : "حفظ الإعدادات"}
            >
              حفظ التغييرات
            </button>
          }
        />
      </div>
    </div>
  );

  /* =========================
     Nested routes under /dashboard/settings/*
  ========================= */
  return (
    <div className="dashboard-section settings-page enterprise-workspace-page enterprise-workspace-v2 enterprise-settings-v2 settings-shell settings-shell--embedded" dir="rtl">
      <main className="settings-shell__main" dir="rtl">
        <section className="settings-shell__content">
            <Routes>
              <Route
                index
                element={
                  <PermissionRoute permission="settings.general.manage">
                    <MainSettings />
                  </PermissionRoute>
                }
              />

              <Route
                path="bookings"
                element={<PermissionRoute permission="settings.booking.manage"><SettingsBookings /></PermissionRoute>}
              />
              <Route
                path="catalog"
                element={<PermissionRoute permission="catalog.manage"><SettingsCatalog hasAdminPower={hasPermission("catalog.manage")} /></PermissionRoute>}
              />
              <Route
                path="users/*"
                element={
                  <PermissionRoute anyOf={["admin_accounts.view", "admin_accounts.manage"]}>
                    <SettingsUsers
                      initialRole={uiRole}
                      authReady={!authLoading}
                      allowAdminManageUsers={allowAdminManageUsers}
                    />
                  </PermissionRoute>
                }
              />
              <Route
                path="contact"
                element={<PermissionRoute permission="settings.content.manage"><SettingsContact hasAdminPower={hasPermission("settings.content.manage")} /></PermissionRoute>}
              />
              <Route
                path="attendance"
                element={<PermissionRoute permission="attendance.settings.manage"><SettingsAttendance hasAdminPower={hasPermission("attendance.settings.manage")} /></PermissionRoute>}
              />

              <Route path="advanced" element={<Navigate to={SETTINGS_ROOT_PATH} replace />} />
              <Route path="advanced/bookings" element={<Navigate to={`${SETTINGS_ROOT_PATH}/bookings`} replace />} />
              <Route path="advanced/catalog" element={<Navigate to={`${SETTINGS_ROOT_PATH}/catalog`} replace />} />
              <Route path="advanced/users" element={<Navigate to={`${SETTINGS_ROOT_PATH}/users`} replace />} />
              <Route path="advanced/contact" element={<Navigate to={`${SETTINGS_ROOT_PATH}/contact`} replace />} />
              <Route path="*" element={<Navigate to="." replace />} />
            </Routes>
        </section>
      </main>
    </div>
  );
};

export default DashboardSettings;

