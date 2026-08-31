import { useNavigate } from "react-router-dom";
import SettingsUsers from "./SettingsUsers";

type SettingsUsersV2Props = {
  initialRole?: string;
  authReady?: boolean;
  allowAdminManageUsers?: boolean;
};

export default function SettingsUsersV2(props: SettingsUsersV2Props) {
  const navigate = useNavigate();

  return (
    <div className="settings-users-v2-route">
      <section className="settings-users-v2-route__canonical-head">
        <div>
          <span className="dsv2-badge dsv2-badge--gold">إدارة الوصول</span>
          <h1 className="dsv2-page-title">الحسابات والصلاحيات</h1>
          <p className="dsv2-page-subtitle">
            إنشاء الموظفات وحسابات الدخول أصبح من إدارة الموظفات. هذه الصفحة مخصصة لإدارة الحسابات الموجودة والأدوار والصلاحيات والحالة فقط.
          </p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary"
          onClick={() => navigate("/dashboard/employees")}
        >
          إدارة الموظفات
        </button>
      </section>

      <SettingsUsers {...props} />
    </div>
  );
}
