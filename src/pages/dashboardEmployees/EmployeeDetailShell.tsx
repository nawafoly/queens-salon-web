import { useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";

import { getNameInitials } from "./shared";
import type { EmployeeSplitTab, StaffPublicUi } from "./shared";

type EmployeeDetailShellProps = {
  selectedEmployeeId: string | null;
  selectedEmployee: StaffPublicUi | null;
  selectedEmployeeStatusLabel: string;
  selectedEmployeeStatusClass: string;
  busy: boolean;
  activeTab: EmployeeSplitTab;
  tabs: Array<{ key: EmployeeSplitTab; label: string; hint: string; icon?: IconDefinition }>;
  canManage: boolean;
  canDelete: boolean;
  onSave: () => void;
  onDelete: () => void;
  onCancelEdit: () => void;
  onTabChange: (tab: EmployeeSplitTab) => void;
  onClose: () => void;
  showEditor?: boolean;
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
  canDelete,
  onSave,
  onDelete,
  onCancelEdit,
  onTabChange,
  onClose,
  showEditor = false,
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
  const selectedEmployeeServicesCount = Array.isArray(selectedEmployee?.specialties)
    ? selectedEmployee.specialties.length
    : 0;
  const selectedEmployeeBookingLabel = selectedEmployee?.showOnBooking === false ? "مخفي من الحجز" : "ظاهر بالحجز";
  const selectedEmployeeScheduleLabel = selectedEmployee?.useCustomWorkingHours ? "دوام خاص" : "دوام عام";
  const selectedEmployeeAccessLabel = canManage ? "وضع تعديل" : "عرض فقط";

  useEffect(() => {
    if (!selectedEmployeeId || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("emp-detail-open");

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove("emp-detail-open");
    };
  }, [busy, onClose, selectedEmployeeId]);

  return (
    <div
      className={`emp-split-col emp-split-col--details ${
        selectedEmployeeId ? "is-modal" : "is-empty"
      }`}
    >
      {!selectedEmployeeId ? (
        showEditor ? (
          <div className="emp-create-inline">{children}</div>
        ) : (
        <div className="dash-card emp-split-empty">
          <b>لا توجد موظفة محددة</b>
          <p>اختاري موظفة من القائمة لعرض التفاصيل وتحرير البيانات مباشرة.</p>
        </div>
        )
      ) : (
        <>
        <button
          type="button"
          className="emp-detail-backdrop"
          aria-label="إغلاق تفاصيل الموظفة"
          onClick={onClose}
        />
        <div className="dash-card emp-split-head-card emp-detail-modal emp-detail-cockpit" role="dialog" aria-modal="true" aria-label={`ملف الموظفة ${selectedEmployeeName}`}>
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
                  <span className="emp-meta-chip">{selectedEmployeeAccessLabel}</span>
                </div>
              </div>
            </div>

            <div className="emp-detail-snapshot" aria-label="ملخص سريع للموظفة">
              <span>
                <b>{selectedEmployeeServicesCount}</b>
                <small>خدمة</small>
              </span>
              <span>
                <b>{selectedEmployeeBookingLabel}</b>
                <small>الحجز</small>
              </span>
              <span>
                <b>{selectedEmployeeScheduleLabel}</b>
                <small>الدوام</small>
              </span>
            </div>

            <div className="emp-inline-actions emp-detail-header-actions">
              {canManage ? (
                <>
                  <button className="exp-btn primary sm" type="button" onClick={onSave} disabled={busy}>
                    حفظ التغييرات
                  </button>
                  <button className="exp-btn ghost sm" type="button" onClick={onCancelEdit} disabled={busy}>
                    إلغاء التعديلات
                  </button>
                  {canDelete ? (
                    <button className="exp-btn ghost sm text-danger" type="button" onClick={onDelete} disabled={busy}>
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  ) : (
                    <span className="emp-meta-chip">الحذف محجوز للإدارة</span>
                  )}
                </>
              ) : (
                <span className="emp-meta-chip">الصفحة للعرض فقط</span>
              )}
              <button className="exp-btn ghost sm" type="button" onClick={onClose} disabled={busy}>
                <FontAwesomeIcon icon={faXmark} />
                إغلاق
              </button>
            </div>
          </div>

          <div className="emp-split-body">
            <nav className="emp-split-nav" role="tablist" aria-label="أقسام الموظفة">
              <span className="emp-split-nav-title">أقسام الملف</span>
              {tabs.map((tab, index) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  className={`emp-split-nav-item ${activeTab === tab.key ? "active" : ""}`}
                  onClick={() => onTabChange(tab.key)}
                  aria-selected={activeTab === tab.key}
                  aria-current={activeTab === tab.key ? "page" : undefined}
                >
                  <span className="emp-split-nav-order">
                    {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="emp-split-nav-copy">
                    <strong>{tab.label}</strong>
                    <small>{tab.hint}</small>
                  </span>
                </button>
              ))}
            </nav>

            <main className="emp-split-content">
              <div className="emp-split-content-inner">{children}</div>
              {canManage ? (
                <div className="emp-detail-save-dock" aria-label="إجراءات حفظ ملف الموظفة">
                  <span>راجعي التغييرات ثم احفظيها من هنا في أي وقت.</span>
                  <div>
                    <button className="exp-btn ghost sm" type="button" onClick={onCancelEdit} disabled={busy}>
                      إلغاء
                    </button>
                    <button className="exp-btn primary sm" type="button" onClick={onSave} disabled={busy}>
                      حفظ التغييرات
                    </button>
                  </div>
                </div>
              ) : null}
            </main>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
