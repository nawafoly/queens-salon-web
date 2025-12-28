// src/components/ConfirmModal.tsx
import React, { useEffect } from "react";
import { createPortal } from "react-dom";

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
  confirmText = "حسنًا",
  cancelText = "إلغاء",
  showCancel = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const boxClass =
    variant === "danger"
      ? "modal-box is-danger"
      : variant === "success"
      ? "modal-box is-success"
      : "modal-box is-info";

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className={boxClass} onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="modal-head">
          <div className="modal-title-wrap">
            <div className="modal-icon">{variant === "danger" ? "!" : "i"}</div>
            <h3 className="modal-title">{title}</h3>
          </div>

          <button className="modal-close" type="button" onClick={onCancel} aria-label="close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-text">{message || ""}</p>
        </div>

        <div className="modal-actions">
          <button className="btn-confirm" type="button" onClick={onConfirm}>
            {confirmText}
          </button>

          {showCancel && (
            <button className="btn-cancel" type="button" onClick={onCancel}>
              {cancelText}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmModal;
