// src/components/ConfirmModal.tsx
import React, { useEffect } from "react";
import Modal from "./Modal";

type Variant = "info" | "danger" | "success";

type Props = {
  open: boolean;
  title: string;
  message?: string;
  variant?: Variant;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;

  onConfirm: () => void;
  onCancel: () => void;
};

const ConfirmModal: React.FC<Props> = ({
  open,
  title,
  message,
  variant = "info",
  confirmText = "OK",
  cancelText = "Cancel",
  showCancel = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") onConfirm();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm]);

  const boxClass =
    variant === "danger"
      ? "qm-modal-box is-danger"
      : variant === "success"
      ? "qm-modal-box is-success"
      : "qm-modal-box is-info";

  const icon = variant === "danger" ? "!" : variant === "success" ? "v" : "i";

  return (
    <Modal
      open={open}
      onClose={onCancel}
      ariaLabel={title || "Confirm"}
      panelClassName={boxClass}
      size="sm"
    >
      <div className="qm-modal-head">
        <div className="qm-modal-title-wrap">
          <div className="qm-modal-icon">{icon}</div>
          <h3 className="qm-modal-title">{title}</h3>
        </div>

        <button
          className="qm-modal-close"
          type="button"
          onClick={onCancel}
          aria-label="close"
          title="Close"
        >
          X
        </button>
      </div>

      <div className="qm-modal-body">
        <p className="qm-modal-text">{message || ""}</p>
      </div>

      <div className="qm-modal-actions">
        <button className="qm-btn-confirm" type="button" onClick={onConfirm}>
          {confirmText}
        </button>

        {showCancel && (
          <button className="qm-btn-cancel" type="button" onClick={onCancel}>
            {cancelText}
          </button>
        )}
      </div>
    </Modal>
  );
};

export default ConfirmModal;
