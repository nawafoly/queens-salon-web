

// ✅ src/pages/DashboardSettings.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

import { auth, db } from "../services/firebase";
import { AppSettingsService } from "../services/AppSettingsService";
import type { AppSettings, SectionKey } from "../services/AppSettingsService";
import { readStoredAuthSession } from "../services/localAuthSession";

import "../styles/DashboardModals.css";
import "../styles/stylesSettings/DashboardSettings.css";

import SettingsBookings from "./settings/SettingsBookings";
import SettingsCatalog from "./settings/SettingsCatalog";
import SettingsUsers from "./settings/SettingsUsers";
import SettingsContact from "./settings/SettingsContact";
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
  const navigate = useNavigate();
  const location = useLocation();

  const [uiRole, setUiRole] = useState<UiRole>(mapFirestoreRoleToUi(initialRole ?? "guest"));
  const [authLoading, setAuthLoading] = useState(() =>
    typeof authReady === "boolean" ? !authReady : true
  );

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";
  const isReception = uiRole === "reception";
  const isStaff = uiRole === "staff";

  const hasAdminPower = isOwner || isAdmin;
  const canView = hasAdminPower || isReception || isStaff;

  const [settings, setSettings] = useState<AppSettings>(() =>
    settingsProp || AppSettingsService.getCached()
  );
  const [savedMsg, setSavedMsg] = useState<string>("");
  const [activeBasicSection, setActiveBasicSection] = useState<"identity" | "sections" | "policies">("identity");

  const currentPath = normalizePathname(location.pathname);
  const currentRootPath = normalizePathname(SETTINGS_ROOT_PATH);

  const settingsNavItems = useMemo(
    () => [
      {
        key: "home",
        label: "الإعدادات الأساسية",
        hint: "هوية الصالون والإعدادات العامة",
        to: currentRootPath,
        badge: "01",
        visible: true,
        activePaths: [currentRootPath],
      },
      {
        key: "bookings",
        label: "إعدادات الحجوزات",
        hint: "الدوام والاستثناءات",
        to: `${currentRootPath}/bookings`,
        badge: "02",
        visible: hasAdminPower,
        activePaths: [`${currentRootPath}/bookings`],
      },
      {
        key: "catalog",
        label: "إدارة الكتالوج",
        hint: "الأقسام والخدمات",
        to: `${currentRootPath}/catalog`,
        badge: "03",
        visible: hasAdminPower,
        activePaths: [`${currentRootPath}/catalog`],
      },
      {
        key: "users",
        label: "إدارة الحسابات",
        hint: "إنشاء وتعديل حسابات الموظفات",
        to: `${currentRootPath}/users`,
        badge: "04",
        visible: isOwner || (isAdmin && Boolean((settings as any)?.policies?.allowAdminManageUsers)),
        activePaths: [`${currentRootPath}/users`],
      },
      {
        key: "contact",
        label: "محتوى الموقع",
        hint: "العنوان وبيانات التواصل",
        to: `${currentRootPath}/contact`,
        badge: "05",
        visible: hasAdminPower,
        activePaths: [`${currentRootPath}/contact`],
      },
    ],
    [currentRootPath, hasAdminPower, isAdmin, isOwner, settings]
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
        value: hasAdminPower ? "قابل للتعديل" : "عرض فقط",
        hint: hasAdminPower ? "صلاحية إدارية" : "صلاحية محدودة",
      },
    ],
    [
      accessibleNavCount,
      hasAdminPower,
      policiesEnabledCount,
      policyTotalCount,
      sectionTotalCount,
      sectionsEnabledCount,
    ]
  );

  const isSettingsNavActive = (item: { key: string; to: string; activePaths?: string[] }) => {
    const targets = [item.to, ...(item.activePaths || [])];
    return targets.some((target) => {
      const normalizedTarget = normalizePathname(target);
      if (item.key === "home") {
        return currentPath === normalizedTarget;
      }
      return currentPath === normalizedTarget || currentPath.startsWith(`${normalizedTarget}/`);
    });
  };

  useEffect(() => {
    if (typeof initialRole !== "undefined") {
      setUiRole(mapFirestoreRoleToUi(initialRole));
    }
  }, [initialRole]);

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

  const canManageUsers = useMemo(() => {
    return isOwner || (isAdmin && allowAdminManageUsers);
  }, [isOwner, isAdmin, allowAdminManageUsers]);

  /* =========================
     Auth & Role
     - فقط قراءة الدور من salons/main/users/{uid}
  ========================= */
  useEffect(() => {
    if (typeof initialRole !== "undefined" && typeof authReady === "boolean") {
      return;
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);

      try {
        const localSession = readStoredAuthSession();

        if (!user) {
          if (localSession?.role) {
            setUiRole(localSession.role as UiRole);
          } else {
            setUiRole("guest");
          }
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
  }, [initialRole, authReady]);

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
          <SettingsState title="جاري التحميل…" hint="لحظات…" loading />
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="dashboard-section settings-page">
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
    <div className="dashboard-section settings-page">
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
                {hasAdminPower ? "صلاحية كاملة" : "عرض فقط"}
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
              <span className={`settings-shell__pill ${hasAdminPower ? "settings-shell__pill--success" : "settings-shell__pill--outline"}`}>
                {hasAdminPower ? "قابل للتعديل" : "عرض فقط"}
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
                    hasAdminPower &&
                    setSettings({ ...(settings as any), salonName: e.target.value })
                  }
                  disabled={!hasAdminPower}
                  placeholder="مثال: Queens Salon"
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
                  placeholder="05xxxxxxxx"
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
                  placeholder="المدينة المنورة"
                />
              </div>
            </div>

            {!hasAdminPower ? (
              <div className="settings-note">* للتعديل تحتاج صلاحية Owner/Admin.</div>
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
                    disabled={!hasAdminPower}
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
                    disabled={!hasAdminPower}
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
              className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
              onClick={handleSave}
              disabled={!hasAdminPower}
              type="button"
              title={!hasAdminPower ? "تحتاج صلاحية Owner/Admin" : "حفظ الإعدادات"}
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
    <div className="dashboard-section settings-page settings-shell" dir="ltr">
      <div className="settings-shell__layout">
        <aside className="settings-shell__sidebar" dir="rtl">
          <div className="settings-shell__brand">
            <div>
              <span className="settings-shell__eyebrow">لوحة التحكم</span>
              <strong>الإعدادات</strong>
              <small>إدارة الصالون والصفحات المتقدمة من مكان واحد</small>
            </div>
            <button
              type="button"
              className="settings-shell__brand-btn"
              onClick={() => navigate("/dashboard")}
              title="العودة للوحة التحكم"
            >
              ↩
            </button>
          </div>

          <div className="settings-shell__nav">
            {settingsNavItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`settings-shell__nav-item ${isSettingsNavActive(item) ? "is-active" : ""} ${
                  item.visible ? "" : "is-disabled"
                }`}
                onClick={() => item.visible && navigate(item.to)}
                disabled={!item.visible}
                title={item.visible ? item.hint : "هذه الصفحة غير متاحة لهذا الدور"}
              >
                <span className="settings-shell__nav-badge">{item.badge}</span>
                <span className="settings-shell__nav-copy">
                  <strong>{item.label}</strong>
                  <small>{item.visible ? item.hint : "محجوبة حسب الدور"}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="settings-shell__panel">
            <span className="settings-shell__panel-label">الوصول</span>
            <strong>{accessibleNavCount} روابط مباشرة</strong>
            <small>{hasAdminPower ? "المسارات الإدارية مفتوحة" : "عرض محدود بحسب الصلاحيات"}</small>
          </div>
        </aside>

        <main className="settings-shell__main" dir="rtl">
          <section className="settings-shell__content">
            <Routes>
              <Route index element={<MainSettings />} />

              <Route path="bookings" element={<SettingsBookings />} />
              <Route path="catalog" element={<SettingsCatalog hasAdminPower={hasAdminPower} />} />
              <Route
                path="users"
                element={
                  <SettingsUsers
                    initialRole={uiRole}
                    authReady={!authLoading}
                    allowAdminManageUsers={allowAdminManageUsers}
                  />
                }
              />
              <Route path="contact" element={<SettingsContact hasAdminPower={hasAdminPower} />} />

              <Route path="advanced" element={<Navigate to={SETTINGS_ROOT_PATH} replace />} />
              <Route
                path="advanced/bookings"
                element={<Navigate to={`${SETTINGS_ROOT_PATH}/bookings`} replace />}
              />
              <Route
                path="advanced/catalog"
                element={<Navigate to={`${SETTINGS_ROOT_PATH}/catalog`} replace />}
              />
              <Route
                path="advanced/users"
                element={<Navigate to={`${SETTINGS_ROOT_PATH}/users`} replace />}
              />
              <Route
                path="advanced/contact"
                element={<Navigate to={`${SETTINGS_ROOT_PATH}/contact`} replace />}
              />
              <Route path="*" element={<Navigate to="." replace />} />
            </Routes>
          </section>
        </main>
      </div>
    </div>
  );
};

export default DashboardSettings;

