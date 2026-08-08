import { useMemo, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { DashboardModalV2 } from "../../components/dashboard-v2";
import {
  normalizeSpecialties,
  type EmployeeModalTab,
  type EmployeeSplitTab,
  type StaffPublicUi,
} from "./shared";

export type EmployeeEditorModalProps = {
  isOpen: boolean;
  canManage: boolean;
  busy: boolean;
  saving: boolean;
  editId: string | null;
  editingStaff: StaffPublicUi | null;
  name: string;
  modalTab: EmployeeModalTab;
  modalTabs: Array<{ key: EmployeeModalTab; label: string }>;
  activeTab?: EmployeeSplitTab;
  detailTabs?: Array<{ key: EmployeeSplitTab; label: string; hint: string; icon?: IconDefinition }>;
  selectedEmployeeStatusLabel?: string;
  selectedEmployeeStatusClass?: string;
  hasUnsavedChanges?: boolean;
  canDelete?: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancelEdit?: () => void;
  onModalTabChange: (tab: EmployeeModalTab) => void;
  onDetailTabChange?: (tab: EmployeeSplitTab) => void;
  children: ReactNode;
};

export default function EmployeeEditorModal({
  isOpen,
  canManage,
  busy,
  saving,
  editId,
  editingStaff,
  name,
  modalTab,
  modalTabs,
  activeTab = "basic",
  detailTabs = [],
  selectedEmployeeStatusLabel = "",
  canDelete = false,
  onClose,
  onSave,
  onDelete,
  onCancelEdit,
  onModalTabChange,
  onDetailTabChange,
  children,
}: EmployeeEditorModalProps) {
  const isCreateMode = !editId;
  const employeeName = String(editingStaff?.name || name || "").trim();
  const specialtiesCount = normalizeSpecialties(editingStaff?.specialties).length;

  const tabs = useMemo(
    () =>
      isCreateMode
        ? modalTabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            active: modalTab === tab.key,
            onClick: () => onModalTabChange(tab.key),
            icon: undefined as IconDefinition | undefined,
          }))
        : detailTabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            active: activeTab === tab.key,
            onClick: () => onDetailTabChange?.(tab.key),
            icon: tab.icon,
          })),
    [activeTab, detailTabs, isCreateMode, modalTab, modalTabs, onDetailTabChange, onModalTabChange]
  );

  const footer = (
    <div className="employees-v2-editor__footer">
      <div>
        {!isCreateMode && canManage && canDelete && onDelete ? (
          <button className="dsv2-btn dsv2-btn--danger" type="button" onClick={onDelete} disabled={busy}>
            <FontAwesomeIcon icon={faTrash} />
            أرشفة
          </button>
        ) : null}
      </div>
      <div className="employees-v2-editor__footer-actions">
        {!isCreateMode && canManage && onCancelEdit ? (
          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={onCancelEdit} disabled={busy}>
            إلغاء التعديلات
          </button>
        ) : (
          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={onClose} disabled={saving}>
            إلغاء
          </button>
        )}
        {canManage ? (
          <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={onSave} disabled={busy}>
            {saving ? "جاري الحفظ..." : isCreateMode ? "إنشاء الموظفة" : "حفظ التغييرات"}
          </button>
        ) : (
          <span className="dsv2-badge">عرض فقط</span>
        )}
      </div>
    </div>
  );

  return (
    <DashboardModalV2
      open={isOpen}
      onClose={onClose}
      title={isCreateMode ? "إضافة موظفة" : employeeName || "ملف الموظفة"}
      eyebrow={isCreateMode ? "إدارة الموظفات" : "الملف الحالي"}
      description={
        isCreateMode
          ? "أكملي البيانات الأساسية والدوام والخدمات قبل إنشاء الملف."
          : "تعديل بيانات الموظفة من نافذة موحدة."
      }
      size="xl"
      tone="gold"
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      footer={footer}
      className="employees-v2-editor"
    >
      {!isCreateMode ? (
        <div className="employees-v2-editor__meta">
          {selectedEmployeeStatusLabel ? <span className="dsv2-badge dsv2-badge--success">{selectedEmployeeStatusLabel}</span> : null}
          <span className="dsv2-badge">{specialtiesCount > 0 ? `${specialtiesCount} خدمة` : "بدون خدمات"}</span>
        </div>
      ) : null}

      <nav className="employees-v2-editor__tabs" role="tablist" aria-label="أقسام ملف الموظفة">
        {tabs.map((tab) => (
          <button
            key={String(tab.key)}
            type="button"
            role="tab"
            className={tab.active ? "is-active" : ""}
            onClick={tab.onClick}
            aria-selected={tab.active}
          >
            {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : null}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <fieldset className={`employees-v2-editor__fieldset ${!canManage ? "is-readonly" : ""}`} disabled={!canManage}>
        <div className="employees-v2-editor__content">{children}</div>
      </fieldset>
    </DashboardModalV2>
  );
}
