import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faTrash } from "@fortawesome/free-solid-svg-icons";
import EmployeeAvatar from "../../components/EmployeeAvatar";
import { normalizeSpecialties } from "./shared";
import type { EmployeeEditorModalProps } from "./EmployeeEditorModal";

export default function EmployeeProfilePageLayout(props: EmployeeEditorModalProps) {
  if (!props.isOpen || !props.editId || !props.editingStaff) return null;

  const employeeName = String(props.editingStaff.name || props.name || "").trim();
  const serviceCount = normalizeSpecialties(props.editingStaff.specialties).length;
  const activeTab = props.detailTabs?.find((tab) => tab.key === props.activeTab);
  const activeLabel = activeTab?.label || "البيانات الأساسية";
  const activeHint = activeTab?.hint || "إدارة بيانات الموظفة";

  return (
    <section
      className="employees-v2-profile"
      dir="rtl"
      aria-label={`ملف الموظفة ${employeeName || "موظفة"}`}
    >
      <nav className="employees-v2-breadcrumb" aria-label="مسار التنقل">
        <button type="button" onClick={props.onClose}>الموظفات</button>
        <span>/</span>
        <b>{employeeName || "موظفة"}</b>
        <span>/</span>
        <strong>{activeLabel}</strong>
      </nav>

      <header className="dsv2-page-head employees-v2-profile__head">
        <div className="employees-v2-profile__identity">
          <EmployeeAvatar
            className="employees-v2-profile__avatar"
            src={props.editingStaff.avatarUrl}
            name={employeeName || "موظفة"}
            alt={employeeName ? `صورة ${employeeName}` : "صورة الموظفة"}
            loading="eager"
          />
          <div>
            <span className="dsv2-badge dsv2-badge--gold">ملف الموظفة</span>
            <h1 className="dsv2-page-title">{employeeName || "موظفة"}</h1>
            <p className="dsv2-page-subtitle">إدارة الملف الوظيفي والحضور والراتب والخدمات من مساحة موحدة.</p>
            <div className="employees-v2-profile__chips">
              {props.selectedEmployeeStatusLabel ? (
                <span className="dsv2-badge dsv2-badge--success">{props.selectedEmployeeStatusLabel}</span>
              ) : null}
              <span className="dsv2-badge">{serviceCount > 0 ? `${serviceCount} خدمة` : "بدون خدمات"}</span>
            </div>
          </div>
        </div>

        <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={props.onClose}>
          <FontAwesomeIcon icon={faArrowRight} />
          العودة إلى الموظفات
        </button>
      </header>

      <nav className="dsv2-card employees-v2-profile__tabs" aria-label="أقسام ملف الموظفة">
        {props.detailTabs?.map((tab) => {
          const isActive = props.activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              className={isActive ? "is-active" : ""}
              aria-current={isActive ? "page" : undefined}
              onClick={() => props.onDetailTabChange?.(tab.key)}
            >
              {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : null}
              <span>{tab.label}</span>
              <small>{tab.hint}</small>
            </button>
          );
        })}
      </nav>

      <main className="dsv2-card employees-v2-profile__content" aria-label={activeLabel}>
        <div className="employees-v2-profile__body" data-section-label={activeLabel} data-section-hint={activeHint}>
          {props.children}
        </div>

        <footer className="employees-v2-profile__footer">
          <div>
            {props.canManage && props.canDelete && props.onDelete ? (
              <button
                className="dsv2-btn dsv2-btn--danger"
                type="button"
                onClick={props.onDelete}
                disabled={props.busy}
              >
                <FontAwesomeIcon icon={faTrash} />
                أرشفة الموظفة
              </button>
            ) : null}
          </div>
          <div className="employees-v2-profile__footer-actions">
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={props.onCancelEdit} disabled={props.busy}>
              إلغاء التعديلات
            </button>
            {props.canManage ? (
              <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={props.onSave} disabled={props.busy}>
                {props.saving ? "جاري الحفظ..." : "حفظ التغييرات"}
              </button>
            ) : null}
          </div>
        </footer>
      </main>
    </section>
  );
}
