import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import Modal from "../../components/Modal";
import type { EmployeeModalTab, EmployeeMode, StaffPublicUi } from "./shared";

type EmployeeEditorModalProps = {
  isOpen: boolean;
  selectedEmployeeId: string | null;
  mode: EmployeeMode;
  busy: boolean;
  saving: boolean;
  editId: string | null;
  editingStaff: StaffPublicUi | null;
  name: string;
  modalTab: EmployeeModalTab;
  modalTabs: Array<{ key: EmployeeModalTab; label: string }>;
  onClose: () => void;
  onSave: () => void;
  onModalTabChange: (tab: EmployeeModalTab) => void;
  children: React.ReactNode;
};

export default function EmployeeEditorModal({
  isOpen,
  selectedEmployeeId,
  mode,
  busy,
  saving,
  editId,
  editingStaff,
  name,
  modalTab,
  modalTabs,
  onClose,
  onSave,
  onModalTabChange,
  children,
}: EmployeeEditorModalProps) {
  if (!isOpen) return null;

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      ariaLabel="محرر الموظفة"
      size="lg"
      panelClassName="emp-modal"
      inline
      closeOnOverlayClick={false}
    >
      {!selectedEmployeeId ? (
        <div className="modal-head">
          <h3>{editId ? `تعديل موظفة - ${editingStaff?.name || name || "-"}` : "إضافة موظفة"}</h3>
          <button className="exp-btn ghost sm" type="button" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
      ) : null}

      {!selectedEmployeeId ? (
        <div className="emp-modal-tabs">
          {modalTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`emp-modal-tab ${modalTab === tab.key ? "active" : ""}`}
              onClick={() => onModalTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      ) : null}

      <fieldset className="emp-inline-fieldset" disabled={!!selectedEmployeeId && mode !== "edit"}>
        <div className="modal-body emp-modal-grid">{children}</div>

        {mode === "edit" || !selectedEmployeeId ? (
          <div className="modal-foot">
            <button className="exp-btn" onClick={onClose} type="button">
              إلغاء
            </button>
            <button className="exp-btn primary" onClick={onSave} disabled={busy} type="button">
              {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
            </button>
          </div>
        ) : null}
      </fieldset>
    </Modal>
  );
}
