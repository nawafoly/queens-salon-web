// ✅ src/pages/settings/SettingsAdvanced.tsx
import { useNavigate } from "react-router-dom";

type UiRole =
  | "owner"
  | "admin"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";
  

export default function SettingsAdvanced(props: {
  uiRole: UiRole;
  hasAdminPower: boolean;
  canManageUsers: boolean;
}) {
  const navigate = useNavigate();
  const { hasAdminPower, canManageUsers } = props;

  return (
    <div className="dashboard-section settings-page">
      <div className="settings-wrap">
        <div className="settings-header">
          <div>
            <h1>الإعدادات المتقدمة</h1>
            <p className="settings-hint">
              هنا نضيف إعدادات النظام بدون ما نخنق الملف الأساسي ✅
            </p>
          </div>

          <div className="settings-save">
            <button className="dash-btn" type="button" onClick={() => navigate("/dashboard/settings")}>
              رجوع للإعدادات
            </button>
          </div>
        </div>

        <div className="settings-card" style={{ marginTop: 0 }}>
          <h3 className="settings-title">اختَر صفحة</h3>

          <div style={{ display: "grid", gap: 10 }}>
            <button
              className={`exp-btn ${!hasAdminPower ? "is-disabled" : ""}`}
              disabled={!hasAdminPower}
              type="button"
              onClick={() => navigate("/dashboard/settings/advanced/bookings")}
            >
              إعدادات الحجوزات (الصيانة + إجازات الموظفات)
            </button>

            <button
              className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
              disabled={!hasAdminPower}
              type="button"
              onClick={() => navigate("/dashboard/settings/advanced/catalog")}
            >
              إدارة الأقسام والخدمات (Firestore Catalog)
            </button>

            <button
              className={`exp-btn primary ${!canManageUsers ? "is-disabled" : ""}`}
              disabled={!canManageUsers}
              type="button"
              onClick={() => navigate("/dashboard/settings/advanced/users")}
            >
              إدارة الحسابات (إنشاء/تعديل حسابات الموظفات)
            </button>
          </div>

          {!hasAdminPower && (
            <div className="settings-note" style={{ marginTop: 10 }}>
              * تحتاج صلاحية Owner/Admin لاستخدام الصفحات المتقدمة.
            </div>
          )}

          {hasAdminPower && !canManageUsers && (
            <div className="settings-note" style={{ marginTop: 10 }}>
              * لو أنت Admin: فعّل “السماح للـ Admin بإدارة حسابات المستخدمين” من تبويب صلاحيات النظام.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
