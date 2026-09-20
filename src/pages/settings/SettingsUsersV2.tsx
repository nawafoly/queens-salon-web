import { useNavigate } from "react-router-dom";
import SettingsUsers from "./SettingsUsers";
import { settingsText, type DashboardLanguage } from "../../helpers/dashboardSettingsLanguage";

type SettingsUsersV2Props = {
  initialRole?: string;
  authReady?: boolean;
  allowAdminManageUsers?: boolean;
  language?: DashboardLanguage;
};

export default function SettingsUsersV2(props: SettingsUsersV2Props) {
  const navigate = useNavigate();
  const language = props.language ?? "ar";
  const t = (text: string) => settingsText(language, text);

  return (
    <div className="settings-users-v2-route" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <style>{`
        .settings-users-v2-route > .dsv2-page > .dsv2-page-head {
          display: none;
        }
      `}</style>

      <section className="settings-users-v2-route__canonical-head">
        <div>
          <span className="dsv2-badge dsv2-badge--gold">{t("إدارة الوصول")}</span>
          <h1 className="dsv2-page-title">{t("الحسابات والصلاحيات")}</h1>
          <p className="dsv2-page-subtitle">
            {t("إنشاء الموظفات وحسابات الدخول أصبح من إدارة الموظفات. هذه الصفحة مخصصة لإدارة الحسابات الموجودة والأدوار والصلاحيات والحالة فقط.")}
          </p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary"
          onClick={() => navigate("/dashboard/employees")}
        >
          {t("إدارة الموظفات")}
        </button>
      </section>

      <SettingsUsers {...props} />
    </div>
  );
}
