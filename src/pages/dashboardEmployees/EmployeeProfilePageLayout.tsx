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
      className="employee-profile-page"
      dir="rtl"
      aria-label={`ملف الموظفة ${employeeName || "موظفة"}`}
    >
      <nav className="employee-profile-breadcrumb" aria-label="مسار التنقل">
        <button type="button" onClick={props.onClose}>
          الموظفات
        </button>
        <span aria-hidden="true">/</span>
        <b>{employeeName || "موظفة"}</b>
        <span aria-hidden="true">/</span>
        <strong>{activeLabel}</strong>
      </nav>

      <header className="employee-profile-header">
        <div className="employee-profile-identity">
          <EmployeeAvatar
            className="employee-profile-avatar"
            src={props.editingStaff.avatarUrl}
            name={employeeName || "موظفة"}
            alt={employeeName ? `صورة ${employeeName}` : "صورة الموظفة"}
            loading="eager"
          />

          <div className="employee-profile-identity-copy">
            <small>ملف الموظفة</small>
            <h1>{employeeName || "موظفة"}</h1>
            <p>إدارة بيانات الموظفة من صفحة مستقلة داخل لوحة التحكم.</p>

            <div className="employee-profile-chips" aria-label="ملخص الموظفة">
              {props.selectedEmployeeStatusLabel ? (
                <span className={`staff-pill ${props.selectedEmployeeStatusClass || ""}`}>
                  {props.selectedEmployeeStatusLabel}
                </span>
              ) : null}
              <span>{serviceCount > 0 ? `${serviceCount} خدمة` : "بدون خدمات"}</span>
            </div>
          </div>
        </div>

        <button className="employee-profile-back" type="button" onClick={props.onClose}>
          <FontAwesomeIcon icon={faArrowRight} />
          <span>العودة إلى الموظفات</span>
        </button>
      </header>

      <div className="employee-profile-workspace">
        <aside className="employee-profile-navigation" aria-label="أقسام ملف الموظفة">
          <div className="employee-profile-navigation-title">
            <span>أقسام الملف</span>
            <small>{activeLabel}</small>
          </div>

          <nav className="employee-profile-sidebar">
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
                  <span className="employee-profile-tab-icon" aria-hidden="true">
                    {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : null}
                  </span>
                  <span className="employee-profile-tab-copy">
                    <b>{tab.label}</b>
                    <small>{tab.hint}</small>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="employee-profile-content" aria-label={activeLabel}>
          <header className="employee-profile-section-heading">
            <div>
              <span>قسم الموظفة</span>
              <h2>{activeLabel}</h2>
            </div>
            <p>{activeHint}</p>
          </header>

          <div className="employee-profile-section-body">{props.children}</div>

          <footer className="employee-profile-actions">
            <div className="employee-profile-actions-danger">
              {props.canManage && props.canDelete && props.onDelete ? (
                <button
                  className="is-danger"
                  type="button"
                  onClick={props.onDelete}
                  disabled={props.busy}
                >
                  <FontAwesomeIcon icon={faTrash} />
                  <span>أرشفة الموظفة</span>
                </button>
              ) : null}
            </div>

            <div className="employee-profile-actions-main">
              <button type="button" onClick={props.onCancelEdit} disabled={props.busy}>
                إلغاء التعديلات
              </button>
              {props.canManage ? (
                <button
                  className="is-primary"
                  type="button"
                  onClick={props.onSave}
                  disabled={props.busy}
                >
                  {props.saving ? "جاري الحفظ..." : "حفظ التغييرات"}
                </button>
              ) : null}
            </div>
          </footer>
        </main>
      </div>
    </section>
  );
}
