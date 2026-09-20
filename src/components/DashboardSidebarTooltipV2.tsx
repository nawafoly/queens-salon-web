import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TooltipState = {
  label: string;
  left: number;
  top: number;
  side: "left" | "right";
};

type DashboardSidebarTooltipV2Props = {
  enabled: boolean;
  language?: "ar" | "en";
};

const TOOLTIP_SELECTOR = "[data-sidebar-tooltip]";
const TOOLTIP_GAP = 12;
const TOOLTIP_SAFE_WIDTH = 250;

export default function DashboardSidebarTooltipV2({
  enabled,
  language = "ar",
}: DashboardSidebarTooltipV2Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const showTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setTooltip(null);
      return undefined;
    }

    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

    const hideTooltip = () => {
      clearShowTimer();
      setTooltip(null);
    };

    const resolveTarget = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof Element)) return null;
      return eventTarget.closest<HTMLElement>(TOOLTIP_SELECTOR);
    };

    const scheduleTooltip = (target: HTMLElement) => {
      const label = target.dataset.sidebarTooltip?.trim();
      if (!label) return;

      clearShowTimer();
      showTimerRef.current = window.setTimeout(() => {
        const rect = target.getBoundingClientRect();
        const canPlaceLeft = rect.left >= TOOLTIP_SAFE_WIDTH + TOOLTIP_GAP;
        const side: TooltipState["side"] = canPlaceLeft ? "left" : "right";
        const left = side === "left" ? rect.left - TOOLTIP_GAP : rect.right + TOOLTIP_GAP;
        const top = Math.min(
          window.innerHeight - 24,
          Math.max(24, rect.top + rect.height / 2),
        );

        setTooltip({ label, left, top, side });
      }, 140);
    };

    const onPointerOver = (event: PointerEvent) => {
      const target = resolveTarget(event.target);
      if (!target) return;

      const related = resolveTarget(event.relatedTarget);
      if (related === target) return;

      scheduleTooltip(target);
    };

    const onPointerOut = (event: PointerEvent) => {
      const target = resolveTarget(event.target);
      if (!target) return;

      const related = resolveTarget(event.relatedTarget);
      if (related === target) return;

      hideTooltip();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = resolveTarget(event.target);
      if (target) scheduleTooltip(target);
    };

    const onFocusOut = (event: FocusEvent) => {
      const target = resolveTarget(event.target);
      if (!target) return;

      const related = resolveTarget(event.relatedTarget);
      if (related === target) return;

      hideTooltip();
    };

    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", hideTooltip);
    window.addEventListener("scroll", hideTooltip, true);

    return () => {
      clearShowTimer();
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", hideTooltip);
      window.removeEventListener("scroll", hideTooltip, true);
    };
  }, [enabled]);

  if (!enabled || !tooltip || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="dsv2-sidebar-tooltip"
      lang={language}
      dir={language === "en" ? "ltr" : "rtl"}
      data-side={tooltip.side}
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.label}
    </div>,
    document.body,
  );
}
