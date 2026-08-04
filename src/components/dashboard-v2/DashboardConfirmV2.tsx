import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import DashboardModalV2 from "./DashboardModalV2";
import type { DashboardDialogToneV2 } from "./DashboardModalV2";

export type DashboardConfirmV2Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  tone?: DashboardDialogToneV2;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingLabel?: string;
  closeOnBackdrop?: boolean;
};

function ConfirmIcon({ tone }: { tone: DashboardDialogToneV2 }) {
  if (tone === "success") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="m6.5 12.5 3.4 3.4 7.8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (tone === "danger") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M12 7.5v5.25m0 3.75h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M12 17h.01M9.8 9.1a2.35 2.35 0 1 1 3.15 2.22c-.66.27-.95.68-.95 1.43" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function getConfirmButtonClass(tone: DashboardDialogToneV2) {
  if (tone === "danger") {
    return "dsv2-btn dsv2-btn--danger";
  }
  if (tone === "success") {
    return "dsv2-btn dsv2-btn--success";
  }
  if (tone === "gold") {
    return "dsv2-btn dsv2-btn--accent";
  }
  return "dsv2-btn dsv2-btn--primary";
}

export default function DashboardConfirmV2({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  tone = "danger",
  confirmLabel = "تأكيد",
  cancelLabel = "تراجع",
  pendingLabel = "جارٍ التنفيذ...",
  closeOnBackdrop = true,
}: DashboardConfirmV2Props) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      setPending(false);
    }
  }, [open]);

  const handleClose = () => {
    if (!pending) {
      onClose();
    }
  };

  const handleConfirm = async () => {
    if (pending) {
      return;
    }

    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
    }
  };

  return (
    <DashboardModalV2
      open={open}
      onClose={handleClose}
      title={title}
      description={description}
      size="sm"
      tone={tone}
      role="alertdialog"
      closeOnBackdrop={closeOnBackdrop && !pending}
      closeOnEscape={!pending}
      showCloseButton={!pending}
      className="dsv2-confirm"
      footer={
        <>
          <button
            type="button"
            className={getConfirmButtonClass(tone)}
            disabled={pending}
            data-dsv2-autofocus="true"
            onClick={() => void handleConfirm()}
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary"
            disabled={pending}
            onClick={handleClose}
          >
            {cancelLabel}
          </button>
        </>
      }
    >
      <div className="dsv2-confirm__content">
        <span className="dsv2-confirm__icon" aria-hidden="true" data-tone={tone}>
          <ConfirmIcon tone={tone} />
        </span>
        {children ? <div className="dsv2-confirm__details">{children}</div> : null}
      </div>
    </DashboardModalV2>
  );
}
