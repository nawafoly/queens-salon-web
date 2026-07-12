import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import EmployeeAvatar from "../../components/EmployeeAvatar";

import {
  getNameInitials,
  normalizeSpecialties,
  type EmployeeModalTab,
  type EmployeeSplitTab,
  type StaffPublicUi,
} from "./shared";

type EmployeeEditorModalProps = {
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
  canDelete?: boolean;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onCancelEdit?: () => void;
  onModalTabChange: (tab: EmployeeModalTab) => void;
  onDetailTabChange?: (tab: EmployeeSplitTab) => void;
  children: ReactNode;
};

let employeeModalOpenCount = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";

function lockBodyScroll() {
  if (typeof document === "undefined") return;
  employeeModalOpenCount += 1;
  if (employeeModalOpenCount !== 1) return;

  const body = document.body;
  previousBodyOverflow = body.style.overflow;
  previousBodyPaddingRight = body.style.paddingRight;

  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }
  body.style.overflow = "hidden";
  body.classList.add("emp-editor-open");
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  employeeModalOpenCount = Math.max(0, employeeModalOpenCount - 1);
  if (employeeModalOpenCount !== 0) return;

  const body = document.body;
  body.style.overflow = previousBodyOverflow;
  body.style.paddingRight = previousBodyPaddingRight;
  body.classList.remove("emp-editor-open");
}

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
  selectedEmployeeStatusClass = "",
  canDelete = false,
  onClose,
  onSave,
  onDelete,
  onCancelEdit,
  onModalTabChange,
  onDetailTabChange,
  children,
}: EmployeeEditorModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const isCreateMode = !editId;
  const employeeName = String(editingStaff?.name || name || "").trim();
  const specialtiesCount = normalizeSpecialties(editingStaff?.specialties).length;
  const employeeInitials = getNameInitials(employeeName || "موظفة");
  const isHrRoute =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/admin/");

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || !isCreateMode) return;

    lockBodyScroll();
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const raf = window.requestAnimationFrame(() => {
      panelRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (!busy) onCloseRef.current();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
      previouslyFocused?.focus?.();
    };
  }, [busy, isCreateMode, isOpen]);

  const title = isCreateMode ? "إضافة موظفة" : employeeName || "ملف الموظفة";
  const subtitle = isCreateMode
    ? "أكملي البيانات الأساسية والدوام والخدمات والملف قبل إنشاء الموظفة."
    : "تعديل بيانات الموظفة من نافذة مستقلة بدون التأثير على تمرير الصفحة.";

  const tabs = useMemo(
    () =>
      isCreateMode
        ? modalTabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            active: modalTab === tab.key,
            onClick: () => onModalTabChange(tab.key),
            hint: "",
            icon: undefined as IconDefinition | undefined,
          }))
        : detailTabs.map((tab) => ({
            key: tab.key,
            label: tab.label,
            active: activeTab === tab.key,
            onClick: () => onDetailTabChange?.(tab.key),
            hint: tab.hint,
            icon: tab.icon,
          })),
    [
      activeTab,
      detailTabs,
      isCreateMode,
      modalTab,
      modalTabs,
      onDetailTabChange,
      onModalTabChange,
    ]
  );
  const activeSectionLabel = tabs.find((tab) => tab.active)?.label || "البيانات الأساسية";

  if (!isOpen || typeof document === "undefined") return null;

  const panel = (
    <div
        ref={panelRef}
        className={`emp-editor-panel ${isCreateMode ? "emp-editor-panel--create" : "emp-editor-panel--edit"}`}
        role={isCreateMode ? "dialog" : undefined}
        aria-modal={isCreateMode ? "true" : undefined}
        aria-label={isCreateMode ? "إضافة موظفة" : `تحرير ملف ${employeeName || "الموظفة"}`}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {!isCreateMode ? (
          <div className="employee-profile-breadcrumb" aria-label="مسار التنقل">
            <button type="button" onClick={onClose}>الموظفات</button>
            <span>/</span>
            <b>{employeeName || "ملف الموظفة"}</b>
            <span>/</span>
            <strong>{activeSectionLabel}</strong>
          </div>
        ) : null}
        <header className="emp-editor-header">
          <div className="emp-editor-identity">
            {!isCreateMode ? (
              <EmployeeAvatar
                className="emp-editor-avatar"
                src={editingStaff?.avatarUrl}
                name={employeeName || employeeInitials}
                alt=""
                loading="eager"
              />
            ) : null}
            <div className="emp-editor-title">
              <span>{isCreateMode ? "إدارة الموظفات" : "الملف الحالي"}</span>
              <h3>{title}</h3>
              <p>{subtitle}</p>
              {!isCreateMode ? (
                <div className="emp-editor-chips">
                  {selectedEmployeeStatusLabel ? (
                    <span className={`staff-pill ${selectedEmployeeStatusClass}`}>
                      {selectedEmployeeStatusLabel}
                    </span>
                  ) : null}
                  <span className="emp-meta-chip">
                    {specialtiesCount > 0 ? `${specialtiesCount} خدمة` : "بدون خدمات"}
                  </span>
                  {editingStaff?.showOnBooking === false || specialtiesCount === 0 ? (
                    <span className="emp-meta-chip emp-meta-chip--warning">مخفية من الحجز</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {isCreateMode ? (
            <button className="exp-btn ghost sm" type="button" onClick={onClose} disabled={busy} aria-label="إغلاق">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          ) : (
            <button className="exp-btn ghost employee-profile-back" type="button" onClick={onClose} disabled={busy}>
              العودة إلى الموظفات
            </button>
          )}
        </header>

        <nav className="emp-editor-tabs" role="tablist" aria-label={isCreateMode ? "أقسام إنشاء الموظفة" : "أقسام ملف الموظفة"}>
          {tabs.map((tab) => (
            <button
              key={String(tab.key)}
              type="button"
              role="tab"
              className={`emp-editor-tab ${tab.active ? "active" : ""}`}
              onClick={tab.onClick}
              aria-selected={tab.active}
            >
              {tab.icon ? <FontAwesomeIcon icon={tab.icon} /> : null}
              <span>{tab.label}</span>
              {tab.hint ? <small>{tab.hint}</small> : null}
            </button>
          ))}
        </nav>

        <fieldset
  className={`emp-editor-fieldset ${!canManage ? "is-readonly" : ""}`}
>
  <main className="emp-editor-content">{children}</main>
</fieldset>

        <footer className="emp-editor-footer">
          <span>
            {isCreateMode
              ? "يمكن حفظ الموظفة بدون خدمات، وستكون مخفية من الحجز حتى يتم إسناد خدمات لها."
              : "راجعي التغييرات ثم احفظيها من هنا دون أن يغطي الشريط محتوى الخدمات."}
          </span>
          <div className="emp-editor-footer-actions">
            {!isCreateMode && canManage && canDelete && onDelete ? (
              <button className="exp-btn ghost sm text-danger" type="button" onClick={onDelete} disabled={busy}>
                <FontAwesomeIcon icon={faTrash} />
              </button>
            ) : null}
            {!isCreateMode && canManage && onCancelEdit ? (
              <button className="exp-btn ghost" type="button" onClick={onCancelEdit} disabled={busy}>
                إلغاء التعديلات
              </button>
            ) : (
              <button className="exp-btn ghost" type="button" onClick={onClose} disabled={saving}>
                إلغاء
              </button>
            )}
            {canManage ? (
              <button className="exp-btn primary" type="button" onClick={onSave} disabled={busy}>
                {saving ? "جاري الحفظ..." : isCreateMode ? "إنشاء الموظفة" : "حفظ التغييرات"}
              </button>
            ) : (
              <span className="emp-meta-chip">عرض فقط</span>
            )}
          </div>
        </footer>
    </div>
  );

  if (!isCreateMode) {
    return <div className="employee-profile-page">{panel}</div>;
  }

  return createPortal(
    <div
      className={`emp-editor-overlay ${isHrRoute ? "emp-editor-overlay--hr" : ""} is-create`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      {panel}
    </div>,
    document.body
  );
}
