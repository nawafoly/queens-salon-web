import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPen, faTrash } from "@fortawesome/free-solid-svg-icons";

import type { EmployeeSplitTab, StaffPublicUi } from "./shared";

type EmployeeDetailShellProps = {
  selectedEmployeeId: string | null;
  selectedEmployee: StaffPublicUi | null;
  selectedEmployeeStatusLabel: string;
  selectedEmployeeStatusClass: string;
  mode: "view" | "edit";
  busy: boolean;
  activeTab: EmployeeSplitTab;
  onSave: () => void;
  onStartEdit: () => void;
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
  mode,
  busy,
  activeTab,
  onSave,
  onStartEdit,
  onDelete,
  onCancelEdit,
  onTabChange,
  children,
}: EmployeeDetailShellProps) {
  return (
    <div className="emp-split-col emp-split-col--details">
      {!selectedEmployeeId ? (
        <div className="dash-card emp-split-empty">
          <b>لا توجد موظفة محددة</b>
          <p>اختاري موظفة من القائمة لعرض التفاصيل.</p>
        </div>
      ) : (
        <div className="dash-card emp-split-head-card">
          <div className="emp-split-head">
            <div>
              <b>{selectedEmployee?.name || "—"}</b>
              <div className="emp-inline-actions">
                <span className={`staff-pill ${selectedEmployeeStatusClass}`}>{selectedEmployeeStatusLabel}</span>
              </div>
            </div>
            <div className="emp-inline-actions">
              {mode === "edit" ? (
                <>
                  <button className="exp-btn primary sm" type="button" onClick={onSave} disabled={busy}>
                    حفظ
                  </button>
                  <button className="exp-btn ghost sm" type="button" onClick={onCancelEdit}>
                    إلغاء
                  </button>
                </>
              ) : (
                <>
                  <button className="exp-btn ghost sm" type="button" onClick={onStartEdit}>
                    <FontAwesomeIcon icon={faPen} /> تعديل
                  </button>
                  <button className="exp-btn ghost sm text-danger" type="button" onClick={onDelete}>
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="emp-split-tabs">
            <button
              type="button"
              className={`emp-split-tab ${activeTab === "basic" ? "active" : ""}`}
              onClick={() => onTabChange("basic")}
            >
              البيانات الأساسية
            </button>
            <button
              type="button"
              className={`emp-split-tab ${activeTab === "booking" ? "active" : ""}`}
              onClick={() => onTabChange("booking")}
            >
              الحجز والدوام
            </button>
            <button
              type="button"
              className={`emp-split-tab ${activeTab === "services" ? "active" : ""}`}
              onClick={() => onTabChange("services")}
            >
              الخدمات
            </button>
            <button
              type="button"
              className={`emp-split-tab ${activeTab === "profile" ? "active" : ""}`}
              onClick={() => onTabChange("profile")}
            >
              الملف
            </button>
            <button
              type="button"
              className={`emp-split-tab ${activeTab === "payroll" ? "active" : ""}`}
              onClick={() => onTabChange("payroll")}
            >
              الراتب والأوفر تايم
            </button>
            <button
              type="button"
              className={`emp-split-tab ${activeTab === "stats" ? "active" : ""}`}
              onClick={() => onTabChange("stats")}
            >
              الإحصائيات والإجازات
            </button>
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
