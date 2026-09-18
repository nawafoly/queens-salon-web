import React, { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import {
  DashboardEmptyStateV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import PermissionRoute from "../components/PermissionRoute";
import { usePermissions } from "../security/PermissionContext";
import { normalizeAuthRole } from "../services/authAccess";
import { AppSettingsService } from "../services/AppSettingsService";
import type { AppSettings, SectionKey } from "../services/AppSettingsService";
import { readStoredAuthSession } from "../services/localAuthSession";
import "../styles/dashboard-v2/dashboard-v2.css";

import SettingsAttendance from "./settings/SettingsAttendance";
import SettingsBookings from "./settings/SettingsBookings";
import SettingsCatalogV2 from "./settings/SettingsCatalogV2";
import SettingsContact from "./settings/SettingsContact";
import SettingsUsersV2 from "./settings/SettingsUsersV2";

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

type BasicSettingsSection = "identity" | "sections" | "policies";

type DashboardSettingsProps = {
  initialRole?: UiRole | string;
  authReady?: boolean;
  settings?: any;
};

const SETTINGS_ROOT_PATH = "/dashboard/settings";

const BASIC_SECTION_ITEMS: Array<{
  id: BasicSettingsSection;
  index: string;
  title: string;
  description: string;
}> = [
  { id: "identity", index: "01", title: "هوية المنصة", description: "اسم الصالون والجوال والمدينة" },
  { id: "sections", index: "02", title: "ظهور الأقسام", description: "التحكم في أقسام لوحة التحكم" },
  { id: "policies", index: "03", title: "سياسات التشغيل", description: "صلاحيات وسلوك الأدوار داخل النظام" },
];

const SECTION_ITEMS: Array<[SectionKey, string, string]> = [
  ["overview", "نظرة عامة", "ملخص سريع للوحة الرئيسية"],
  ["bookings", "الحجوزات", "مواعيد العميلات وجدولة الزيارات"],
  ["clients", "العميلات", "ملفات العميلات وسجل التعامل"],
  ["employees", "الموظفات", "إدارة الفريق والملفات الوظيفية"],
  ["offers", "العروض والكوبونات", "العروض، الباقات، وأكواد الخصم"],
  ["reports", "التقارير", "تقارير الأداء والحركة"],
  ["income", "الإيرادات", "ملخص الدخل والمدفوعات"],
  ["expenses", "المصروفات", "سجل المصروفات التشغيلية"],
];

const POLICY_ITEMS: Array<[string, string, string]> = [
  ["allowStaffChangeStatus", "تغيير حالة الحجز للموظفات", "تمكين الموظفة من تحديث حالة الموعد المرتبط بها."],
  ["allowReceptionChangeStatus", "تغيير حالة الحجز للاستقبال", "تمكين الاستقبال من تحديث حالات الحجوزات اليومية."],
  ["allowStaffViewClients", "مشاهدة العميلات للموظفات", "السماح للموظفة باستعراض بيانات العميلات حسب الصلاحية."],
  ["allowAdminManageUsers", "إدارة الحسابات للـ Admin", "السماح للأدمن بإنشاء وتعديل الحسابات من صفحات الإدارة."],
];

function mapRoleToUi(roleRaw: unknown): UiRole {
  return normalizeAuthRole(roleRaw);
}

function SettingsRouteFallback() {
  return (
    <main className="dsv2-page settings-v2-page" dir="rtl">
      <section className="dsv2-card dsv2-card--padded settings-v2-state" aria-label="جاري تحميل الإعدادات">
        <DashboardSkeletonV2 width="32%" height={20} />
        <DashboardSkeletonV2 width="58%" height={14} />
        <DashboardSkeletonV2 width="100%" height={120} />
      </section>
    </main>
  );
}

const DashboardSettings: React.FC<DashboardSettingsProps> = ({
  initialRole,
  authReady,
  settings: settingsProp,
}) => {
  const [uiRole, setUiRole] = useState<UiRole>(
    mapRoleToUi(initialRole ?? readStoredAuthSession()?.role ?? "guest")
  );
  const { hasPermission, hasAnyPermission, role: permissionRole } = usePermissions();
  const [authLoading, setAuthLoading] = useState(() =>
    typeof authReady === "boolean" ? !authReady : false
  );
  const [settings, setSettings] = useState<AppSettings>(() =>
    settingsProp || AppSettingsService.getCached()
  );
  const [savedMsg, setSavedMsg] = useState("");
  const [activeBasicSection, setActiveBasicSection] = useState<BasicSettingsSection>("identity");

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

  const settingsNavItems = useMemo(
    () => [
      canManageGeneralSettings,
      hasPermission("settings.booking.manage"),
      hasPermission("catalog.manage"),
      hasPermission("admin_accounts.view") || hasPermission("admin_accounts.manage"),
      hasPermission("settings.content.manage"),
      hasPermission("attendance.settings.manage"),
    ],
    [canManageGeneralSettings, hasPermission]
  );

  const accessibleNavCount = settingsNavItems.filter(Boolean).length;
  const sectionsEnabledCount = Object.values((settings as any)?.sections || {}).filter(Boolean).length;
  const policiesEnabledCount = Object.values((settings as any)?.policies || {}).filter(Boolean).length;
  const sectionTotalCount = Object.keys((settings as any)?.sections || {}).length || 8;
  const policyTotalCount = Object.keys((settings as any)?.policies || {}).length || 4;

  const mainSettingsStats = useMemo(
    () => [
      { label: "الصفحات المباشرة", value: String(accessibleNavCount), hint: "روابط متاحة حسب صلاحيات الحساب", tone: "dsv2-metric-card--gold" },
      { label: "الأقسام المفعلة", value: `${sectionsEnabledCount}/${sectionTotalCount}`, hint: "من أقسام لوحة التحكم", tone: "dsv2-metric-card--success" },
      { label: "السياسات النشطة", value: `${policiesEnabledCount}/${policyTotalCount}`, hint: "سياسات تشغيل وصلاحيات", tone: "dsv2-metric-card--danger" },
      {
        label: "الحالة الحالية",
        value: canManageGeneralSettings ? "قابل للتعديل" : "عرض محدود",
        hint: canManageGeneralSettings ? "يمكن الحفظ مباشرة" : "حسب الصلاحيات الممنوحة",
        tone: "dsv2-metric-card--dark",
      },
    ],
    [accessibleNavCount, canManageGeneralSettings, policiesEnabledCount, policyTotalCount, sectionTotalCount, sectionsEnabledCount]
  );

  useEffect(() => {
    setUiRole(mapRoleToUi(initialRole ?? permissionRole ?? readStoredAuthSession()?.role ?? "guest"));
  }, [initialRole, permissionRole]);

  useEffect(() => {
    if (typeof authReady === "boolean") setAuthLoading(!authReady);
  }, [authReady]);

  useEffect(() => {
    if (settingsProp) setSettings(settingsProp);
  }, [settingsProp]);

  useEffect(() => {
    if (settingsProp) return;

    AppSettingsService.fetchRemote()
      .then((remote) => setSettings(remote))
      .catch((error) => console.error("fetchRemote settings error:", error));

    const unsubscribe = AppSettingsService.subscribe((remote) => setSettings(remote));
    return () => unsubscribe();
  }, [settingsProp]);

  const allowAdminManageUsers = Boolean((settings as any)?.policies?.allowAdminManageUsers);

  const handleSave = async () => {
    if (!canManageGeneralSettings) return;

    try {
      await AppSettingsService.saveRemote(settings);
      window.dispatchEvent(new Event("settingsChanged"));
      setSavedMsg("تم حفظ الإعدادات بنجاح");
      window.setTimeout(() => setSavedMsg(""), 2000);
    } catch (error) {
      console.error("save settings error:", error);
      setSavedMsg("تعذر حفظ الإعدادات");
      window.setTimeout(() => setSavedMsg(""), 2500);
    }
  };

  const toggleSection = (key: SectionKey) => {
    if (!canManageGeneralSettings) return;
    setSettings((previous: any) => ({
      ...previous,
      sections: { ...previous.sections, [key]: !previous.sections?.[key] },
    }));
  };

  const togglePolicy = (key: string) => {
    if (!canManageGeneralSettings) return;
    setSettings((previous: any) => ({
      ...previous,
      policies: { ...(previous.policies || {}), [key]: !previous.policies?.[key] },
    }));
  };

  if (authLoading) return <SettingsRouteFallback />;

  if (!canView) {
    return (
      <main className="dsv2-page settings-v2-page" dir="rtl">
        <DashboardEmptyStateV2
          tone="gold"
          title="غير مصرح"
          description="لا يملك هذا الحساب صلاحية لفتح إعدادات لوحة التحكم."
        />
      </main>
    );
  }

  const MainSettings = () => {
    const activeSectionMeta = BASIC_SECTION_ITEMS.find((item) => item.id === activeBasicSection);
    const saveFailed = savedMsg === "تعذر حفظ الإعدادات";

    return (
      <main className="dsv2-page settings-v2-page" dir="rtl">
        <section className="dsv2-card settings-v2-hero">
          <div className="settings-v2-hero__content">
            <span className="dsv2-badge dsv2-badge--gold">الإعدادات الأساسية</span>
            <h1 className="dsv2-page-title">إعدادات لوحة التحكم</h1>
            <p className="dsv2-page-subtitle">
              إدارة هوية الصالون، ظهور الأقسام، وسياسات التشغيل من مساحة واحدة واضحة.
            </p>
            <div className="settings-v2-hero__badges">
              <span className={`dsv2-badge ${canManageGeneralSettings ? "dsv2-badge--success" : ""}`}>
                {canManageGeneralSettings ? "قابل للتعديل" : "عرض محدود"}
              </span>
              <span className="dsv2-badge">{accessibleNavCount} أقسام متاحة</span>
            </div>
          </div>
        </section>

        <section className="settings-v2-metrics" aria-label="ملخص الإعدادات">
          {mainSettingsStats.map((item) => (
            <article key={item.label} className={`dsv2-metric-card ${item.tone}`}>
              <p className="dsv2-metric-card__label">{item.label}</p>
              <p className="dsv2-metric-card__value">{item.value}</p>
              <p className="dsv2-metric-card__meta">{item.hint}</p>
            </article>
          ))}
        </section>

        <section className="settings-v2-tabs" aria-label="أقسام الإعدادات الأساسية">
          {BASIC_SECTION_ITEMS.map((item) => {
            const active = item.id === activeBasicSection;
            const dynamicDescription =
              item.id === "sections"
                ? `${sectionsEnabledCount}/${sectionTotalCount} أقسام مفعلة`
                : item.id === "policies"
                  ? `${policiesEnabledCount}/${policyTotalCount} سياسات نشطة`
                  : item.description;

            return (
              <button
                key={item.id}
                type="button"
                className={`settings-v2-tab ${active ? "is-active" : ""}`}
                onClick={() => setActiveBasicSection(item.id)}
                aria-pressed={active}
              >
                <span className="settings-v2-tab__index">{item.index}</span>
                <span className="settings-v2-tab__copy">
                  <strong>{item.title}</strong>
                  <small>{dynamicDescription}</small>
                </span>
              </button>
            );
          })}
        </section>

        <section className="dsv2-card dsv2-card--padded settings-v2-panel">
          <header className="settings-v2-panel__head">
            <div className="settings-v2-panel__copy">
              <span className="settings-v2-panel__eyebrow">{activeSectionMeta?.index || "01"}</span>
              <h2>{activeSectionMeta?.title || "الإعدادات"}</h2>
              <p>
                {activeBasicSection === "identity"
                  ? "البيانات الأساسية التي تظهر في الشاشات العامة والإدارية."
                  : activeBasicSection === "sections"
                    ? "تحكم في الأقسام التي تظهر داخل لوحة التحكم والصفحات المرتبطة بها."
                    : "صلاحيات تشغيلية تتحكم بسلوك الأدوار داخل النظام."}
              </p>
            </div>
            <span className={`dsv2-badge ${canManageGeneralSettings ? "dsv2-badge--success" : ""}`}>
              {canManageGeneralSettings ? "جاهز للتعديل" : "عرض فقط"}
            </span>
          </header>

          <div className="settings-v2-panel__body">
            {activeBasicSection === "identity" ? (
              <div className="settings-v2-form">
                <label className="dsv2-field">
                  <span className="dsv2-field__label">اسم الصالون</span>
                  <input
                    className="dsv2-input"
                    value={(settings as any)?.salonName || ""}
                    onChange={(event) =>
                      canManageGeneralSettings && setSettings({ ...(settings as any), salonName: event.target.value })
                    }
                    disabled={!canManageGeneralSettings}
                    placeholder="مثال: MALIKAT"
                  />
                </label>

                <label className="dsv2-field">
                  <span className="dsv2-field__label">الجوال</span>
                  <input
                    className="dsv2-input"
                    value={(settings as any)?.phone || ""}
                    onChange={(event) =>
                      canManageGeneralSettings && setSettings({ ...(settings as any), phone: event.target.value })
                    }
                    disabled={!canManageGeneralSettings}
                    placeholder="05xxxxxxxx"
                    inputMode="tel"
                  />
                </label>

                <label className="dsv2-field">
                  <span className="dsv2-field__label">المدينة</span>
                  <input
                    className="dsv2-input"
                    value={(settings as any)?.city || ""}
                    onChange={(event) =>
                      canManageGeneralSettings && setSettings({ ...(settings as any), city: event.target.value })
                    }
                    disabled={!canManageGeneralSettings}
                    placeholder="المدينة المنورة"
                  />
                </label>
              </div>
            ) : null}

            {activeBasicSection === "sections" ? (
              <div className="settings-v2-toggle-grid">
                {SECTION_ITEMS.map(([key, label, description]) => {
                  const enabled = Boolean((settings as any)?.sections?.[key]);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`settings-v2-toggle ${enabled ? "is-on" : ""}`}
                      aria-pressed={enabled}
                      disabled={!canManageGeneralSettings}
                      onClick={() => toggleSection(key)}
                    >
                      <span className="settings-v2-toggle__mark" aria-hidden="true">{enabled ? "✓" : ""}</span>
                      <span className="settings-v2-toggle__copy"><strong>{label}</strong><small>{description}</small></span>
                      <span className="settings-v2-toggle__status">{enabled ? "ظاهر" : "مخفي"}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {activeBasicSection === "policies" ? (
              <div className="settings-v2-toggle-grid">
                {POLICY_ITEMS.map(([key, label, description]) => {
                  const enabled = Boolean((settings as any)?.policies?.[key]);
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`settings-v2-toggle ${enabled ? "is-on" : ""}`}
                      aria-pressed={enabled}
                      disabled={!canManageGeneralSettings}
                      onClick={() => togglePolicy(key)}
                    >
                      <span className="settings-v2-toggle__mark" aria-hidden="true">{enabled ? "✓" : ""}</span>
                      <span className="settings-v2-toggle__copy"><strong>{label}</strong><small>{description}</small></span>
                      <span className="settings-v2-toggle__status">{enabled ? "مفعلة" : "متوقفة"}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {!canManageGeneralSettings ? (
              <div className="settings-v2-note">
                تحتاج صلاحية <strong>settings.general.manage</strong> لتعديل هذه القيم.
              </div>
            ) : null}
          </div>
        </section>

        <section className="dsv2-card dsv2-card--padded settings-v2-savebar">
          <div className="settings-v2-savebar__copy">
            <strong>حفظ إعدادات المنصة</strong>
            <p>الحفظ يطبق على كل الشاشات التي تعتمد على AppSettings.</p>
            {savedMsg ? (
              <span
                className={`dsv2-badge ${saveFailed ? "" : "dsv2-badge--success"}`}
                role={saveFailed ? "alert" : "status"}
              >
                {savedMsg}
              </span>
            ) : null}
          </div>
          <button
            className="dsv2-btn dsv2-btn--primary"
            onClick={handleSave}
            disabled={!canManageGeneralSettings}
            type="button"
            title={!canManageGeneralSettings ? "تحتاج صلاحية settings.general.manage" : "حفظ الإعدادات"}
          >
            حفظ التغييرات
          </button>
        </section>
      </main>
    );
  };

  return (
    <div className="dashboard-section settings-page settings-v2-shell" dir="rtl">
      <main className="settings-v2-shell__main" dir="rtl">
        <section className="settings-v2-shell__content">
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
              element={
                <PermissionRoute permission="settings.booking.manage">
                  <SettingsBookings />
                </PermissionRoute>
              }
            />
            <Route
              path="catalog"
              element={
                <PermissionRoute permission="catalog.manage">
                  <SettingsCatalogV2 hasAdminPower={hasPermission("catalog.manage")} />
                </PermissionRoute>
              }
            />
            <Route
              path="users/*"
              element={
                <PermissionRoute anyOf={["admin_accounts.view", "admin_accounts.manage"]}>
                  <SettingsUsersV2
                    initialRole={uiRole}
                    authReady={!authLoading}
                    allowAdminManageUsers={allowAdminManageUsers}
                  />
                </PermissionRoute>
              }
            />
            <Route
              path="contact"
              element={
                <PermissionRoute permission="settings.content.manage">
                  <SettingsContact hasAdminPower={hasPermission("settings.content.manage")} />
                </PermissionRoute>
              }
            />
            <Route
              path="attendance"
              element={
                <PermissionRoute permission="attendance.settings.manage">
                  <SettingsAttendance hasAdminPower={hasPermission("attendance.settings.manage")} />
                </PermissionRoute>
              }
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
