import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

type ModalSize = "sm" | "md" | "lg";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
  overlayClassName?: string;
  panelClassName?: string;
  size?: ModalSize;
  closeOnOverlayClick?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement>;
  inline?: boolean;
};

let openCount = 0;
let previousBodyOverflow = "";
let previousBodyPaddingRight = "";

function lockBodyScroll() {
  if (typeof document === "undefined") return;
  if (openCount === 1) {
    const body = document.body;
    previousBodyOverflow = body.style.overflow;
    previousBodyPaddingRight = body.style.paddingRight;

    const scrollBarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollBarWidth > 0) {
      body.style.paddingRight = `${scrollBarWidth}px`;
    }
    body.style.overflow = "hidden";
    body.classList.add("qs-modal-open");
  }
}

function unlockBodyScroll() {
  if (typeof document === "undefined") return;
  if (openCount === 0) {
    const body = document.body;
    body.style.overflow = previousBodyOverflow || "";
    body.style.paddingRight = previousBodyPaddingRight || "";
    body.classList.remove("qs-modal-open");
  }
}

function getFocusable(container: HTMLElement | null) {
  if (!container) return [];
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden")
  );
}

const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  children,
  ariaLabel = "dialog",
  overlayClassName,
  panelClassName,
  size = "md",
  closeOnOverlayClick = true,
  initialFocusRef,
  inline = false,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const sizeClass = useMemo(() => {
    if (size === "sm") return "qs-modal-panel--sm";
    if (size === "lg") return "qs-modal-panel--lg";
    return "";
  }, [size]);

  useEffect(() => {
    if (inline) return;
    if (!open) return;

    openCount += 1;
    lockBodyScroll();

    lastFocusedRef.current = document.activeElement as HTMLElement | null;

    const raf = requestAnimationFrame(() => {
      const target = initialFocusRef?.current;
      if (target) {
        target.focus();
        return;
      }

      const focusable = getFocusable(panelRef.current);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        panelRef.current?.focus();
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (e.key !== "Tab") return;

      const focusable = getFocusable(panelRef.current);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (active === first || !panelRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      openCount = Math.max(0, openCount - 1);
      unlockBodyScroll();
      lastFocusedRef.current?.focus();
    };
  }, [open, initialFocusRef, inline]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const overlayClasses = ["qs-modal-overlay", overlayClassName]
    .filter(Boolean)
    .join(" ");
  const panelClasses = ["qs-modal-panel", sizeClass, panelClassName]
    .filter(Boolean)
    .join(" ");

  const content = (
    <div
      ref={overlayRef}
      className={overlayClasses}
      onClick={(e) => {
        if (inline) return;
        if (!closeOnOverlayClick) return;
        if (e.target === overlayRef.current) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={panelClasses}
        role="dialog"
        aria-modal={inline ? undefined : true}
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );

  if (inline) return content;
  return createPortal(content, document.body);
};

export default Modal;
