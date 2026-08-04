import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export type UseDashboardOverlayV2Options = {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
  closeOnEscape?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let bodyLockDepth = 0;
let previousBodyOverflow = "";
let previousBodyPaddingInlineEnd = "";
let overlaySequence = 0;
const overlayStack: number[] = [];

function lockDocumentScroll() {
  if (bodyLockDepth === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousBodyPaddingInlineEnd = document.body.style.paddingInlineEnd;

    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingInlineEnd = `${scrollbarWidth}px`;
    }
  }

  bodyLockDepth += 1;

  return () => {
    bodyLockDepth = Math.max(0, bodyLockDepth - 1);
    if (bodyLockDepth === 0) {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingInlineEnd = previousBodyPaddingInlineEnd;
    }
  };
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

export default function useDashboardOverlayV2({
  open,
  onClose,
  containerRef,
  closeOnEscape = true,
  initialFocusRef,
}: UseDashboardOverlayV2Options) {
  const overlayIdRef = useRef(0);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return undefined;
    }

    if (overlayIdRef.current === 0) {
      overlaySequence += 1;
      overlayIdRef.current = overlaySequence;
    }

    const overlayId = overlayIdRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const unlockScroll = lockDocumentScroll();
    overlayStack.push(overlayId);

    const focusFrame = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const preferredTarget =
        initialFocusRef?.current ??
        container.querySelector<HTMLElement>("[data-dsv2-autofocus='true']") ??
        getFocusableElements(container)[0] ??
        container;

      preferredTarget.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (overlayStack.at(-1) !== overlayId) {
        return;
      }

      if (event.key === "Escape" && closeOnEscape) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const container = containerRef.current;
      if (!container) {
        return;
      }

      const focusable = getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (activeElement === first || !container.contains(activeElement)) {
          event.preventDefault();
          last?.focus({ preventScroll: true });
        }
      } else if (activeElement === last || !container.contains(activeElement)) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      const stackIndex = overlayStack.lastIndexOf(overlayId);
      if (stackIndex >= 0) {
        overlayStack.splice(stackIndex, 1);
      }
      unlockScroll();

      window.requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) {
          previouslyFocused.focus({ preventScroll: true });
        }
      });
    };
  }, [closeOnEscape, containerRef, initialFocusRef, open]);
}
