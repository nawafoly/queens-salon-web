import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

type FloatingPlacement = "top" | "bottom";

type FloatingPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: FloatingPlacement;
};

type FloatingPositionOptions = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  preferredWidth?: number;
  estimatedHeight: number;
  minViewportMargin?: number;
  gap?: number;
};

const DEFAULT_POSITION: FloatingPosition = {
  left: 0,
  top: 0,
  width: 0,
  maxHeight: 0,
  placement: "bottom",
};

export default function useDashboardFloatingPositionV2({
  open,
  anchorRef,
  preferredWidth,
  estimatedHeight,
  minViewportMargin = 12,
  gap = 8,
}: FloatingPositionOptions) {
  const [position, setPosition] = useState<FloatingPosition>(DEFAULT_POSITION);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof window === "undefined") {
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(
      Math.max(preferredWidth ?? rect.width, rect.width),
      Math.max(0, viewportWidth - minViewportMargin * 2),
    );
    const spaceBelow = viewportHeight - rect.bottom - minViewportMargin;
    const spaceAbove = rect.top - minViewportMargin;
    const placement: FloatingPlacement =
      spaceBelow < Math.min(estimatedHeight, 240) && spaceAbove > spaceBelow ? "top" : "bottom";
    const availableHeight = placement === "bottom" ? spaceBelow - gap : spaceAbove - gap;
    const maxHeight = Math.max(160, Math.min(estimatedHeight, availableHeight));
    const desiredLeft = rect.right - width;
    const left = Math.min(
      Math.max(desiredLeft, minViewportMargin),
      Math.max(minViewportMargin, viewportWidth - width - minViewportMargin),
    );
    const top =
      placement === "bottom"
        ? Math.min(rect.bottom + gap, viewportHeight - minViewportMargin)
        : Math.max(minViewportMargin, rect.top - gap - maxHeight);

    setPosition({ left, top, width, maxHeight, placement });
  }, [anchorRef, estimatedHeight, gap, minViewportMargin, preferredWidth]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updatePosition();
    const handleViewportChange = () => updatePosition();

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePosition]);

  return { position, updatePosition };
}
