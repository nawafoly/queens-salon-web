import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash } from "@fortawesome/free-solid-svg-icons";

import { getNameInitials } from "./shared";
import type { EmployeeSplitTab, StaffPublicUi } from "./shared";

type EmployeeDetailShellProps = {
  selectedEmployeeId: string | null;
  selectedEmployee: StaffPublicUi | null;
  selectedEmployeeStatusLabel: string;
  selectedEmployeeStatusClass: string;
  busy: boolean;
  activeTab: EmployeeSplitTab;
  tabs: Array<{ key: EmployeeSplitTab; label: string; hint: string }>;
  canManage: boolean;
  onSave: () => void;
  onDelete: () => void;
  onCancelEdit: () => void;
  onTabChange: (tab: EmployeeSplitTab) => void;
  children: React.ReactNode;
};

export default function EmployeeDetailShell({
  selectedEmployeeId,
  selectedEmployee,
  selectedEmployeeStatusLabel,
  selectedEmployeeStatusClass,
  busy,
  activeTab,
  tabs,
  canManage,
  onSave,
  onDelete,
  onCancelEdit,
  onTabChange,
  children,
}: EmployeeDetailShellProps) {
  const selectedEmployeeName = String(selectedEmployee?.name || "-").trim();
  const selectedEmployeeRole = String(
    (selectedEmployee as any)?.roleTitle ||
      (selectedEmployee as any)?.jobTitle ||
      (selectedEmployee as any)?.designation ||
      (selectedEmployee as any)?.role ||
      ""
  ).trim();
  const selectedEmployeeDepartment = String(
    (selectedEmployee as any)?.department ||
      (selectedEmployee as any)?.section ||
      (selectedEmployee as any)?.group ||
      ""
  ).trim();
  const selectedEmployeeInitials = getNameInitials(selectedEmployeeName);

  return (
    <div className="emp-split-col emp-split-col--details">
      {!selectedEmployeeId ? (
        <div className="dash-card emp-split-empty">
          <b>لا توجد موظفة محددة</b>
          <p>اختاري موظفة من القائمة لعرض التفاصيل وتحرير البيانات مباشرة.</p>
        </div>
      ) : (
        <div className="dash-card emp-split-head-card">
          <div className="emp-split-head">
            <div className="emp-split-head__identity">
              <div className="emp-split-avatar" aria-hidden="true">
                {selectedEmployeeInitials}
              </div>
              <div className="emp-split-head__copy">
                <span className="emp-split-kicker">ملف الموظفة</span>
                <b>{selectedEmployeeName}</b>
                <p>
                  {selectedEmployeeRole || "البيانات الأساسية والوظيفية"}
                  {selectedEmployeeDepartment ? ` · ${selectedEmployeeDepartment}` : ""}
                </p>
                <div className="emp-split-head__chips">
                  <span className={`staff-pill ${selectedEmployeeStatusClass}`}>{selectedEmployeeStatusLabel}</span>
                  {selectedEmployeeRole ? <span className="emp-meta-chip">{selectedEmployeeRole}</span> : null}
                  {selectedEmployeeDepartment ? (
                    <span className="emp-meta-chip">{selectedEmployeeDepartment}</span>
                  ) : null}
                  {canManage ? <span className="emp-meta-chip">تعديل مباشر</span> : <span className="emp-meta-chip">عرض فقط</span>}
                </div>
              </div>
            </div>

            <div className="emp-inline-actions">
              {canManage ? (
                <>
                  <button className="exp-btn primary sm" type="button" onClick={onSave} disabled={busy}>
                    حفظ التغييرات
                  </button>
                  <button className="exp-btn ghost sm" type="button" onClick={onCancelEdit} disabled={busy}>
                    إلغاء التعديلات
                  </button>
                  <button className="exp-btn ghost sm text-danger" type="button" onClick={onDelete} disabled={busy}>
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </>
              ) : (
                <span className="emp-meta-chip">الصفحة للعرض فقط</span>
              )}
            </div>
          </div>

          <div className="emp-split-body">
            <nav className="emp-split-nav" role="tablist" aria-label="أقسام الموظفة">
              {tabs.map((tab, index) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`emp-split-nav-item ${activeTab === tab.key ? "active" : ""}`}
                  onClick={() => onTabChange(tab.key)}
                  aria-current={activeTab === tab.key ? "page" : undefined}
                >
                  <span className="emp-split-nav-order">{String(index + 1).padStart(2, "0")}</span>
                  <span className="emp-split-nav-copy">
                    <strong>{tab.label}</strong>
                    <small>{tab.hint}</small>
                  </span>
                </button>
              ))}
            </nav>

            <div className="emp-split-content">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}
