import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight, faTrash } from "@fortawesome/free-solid-svg-icons";
import EmployeeAvatar from "../../components/EmployeeAvatar";
import { getNameInitials, normalizeSpecialties } from "./shared";
import type { EmployeeEditorModalProps } from "./EmployeeEditorModal";

export default function EmployeeProfilePageLayout(props: EmployeeEditorModalProps) {
  if (!props.isOpen || !props.editId || !props.editingStaff) return null;
  const employeeName = String(props.editingStaff.name || props.name || "").trim();
  const serviceCount = normalizeSpecialties(props.editingStaff.specialties).length;
  const activeLabel = props.detailTabs?.find((tab) => tab.key === props.activeTab)?.label || "البيانات الأساسية";

  return (
    <div className="employee-profile-page" dir="rtl">
      <div className="employee-profile-breadcrumb">
        <button type="button" onClick={props.onClose}>الموظفات</button><span>/</span>
        <b>{employeeName}</b><span>/</span><strong>{activeLabel}</strong>
      </div>
      <header className="employee-profile-header">
        <div className="employee-profile-identity">
          <EmployeeAvatar className="employee-profile-avatar" src={props.editingStaff.avatarUrl} name={employeeName || getNameInitials(employeeName)} alt="" />
          <div><small>ملف الموظفة</small><h1>{employeeName}</h1><p>إدارة بيانات الموظفة وأقسام ملفها الوظيفي.</p>
            <div className="employee-profile-chips">
              {props.selectedEmployeeStatusLabel ? <span className={`staff-pill ${props.selectedEmployeeStatusClass}`}>{props.selectedEmployeeStatusLabel}</span> : null}
              <span>{serviceCount} خدمة</span>
            </div>
          </div>
        </div>
        <button className="employee-profile-back" type="button" onClick={props.onClose}><FontAwesomeIcon icon={faArrowRight} /> العودة إلى الموظفات</button>
      </header>
      <div className="employee-profile-workspace">
        <nav className="employee-profile-sidebar" aria-label="أقسام ملف الموظفة">
          {props.detailTabs?.map((tab) => (
            <button key={tab.key} type="button" className={props.activeTab === tab.key ? "is-active" : ""} onClick={() => props.onDetailTabChange?.(tab.key)}>
              {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : null}<span>{tab.label}</span>
            </button>
          ))}
        </nav>
        <main className="employee-profile-content">
          {props.children}
          <div className="employee-profile-actions">
            <div>{props.canManage && props.canDelete && props.onDelete ? <button className="is-danger" type="button" onClick={props.onDelete} disabled={props.busy}><FontAwesomeIcon icon={faTrash} /> أرشفة</button> : null}</div>
            <div><button type="button" onClick={props.onCancelEdit} disabled={props.busy}>إلغاء التعديلات</button>{props.canManage ? <button className="is-primary" type="button" onClick={props.onSave} disabled={props.busy}>{props.saving ? "جاري الحفظ..." : "حفظ التغييرات"}</button> : null}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
