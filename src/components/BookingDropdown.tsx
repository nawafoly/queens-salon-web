import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type BookingDropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type BookingDropdownGroup = {
  label: string;
  options: BookingDropdownOption[];
};

type BookingDropdownProps = {
  value: string;
  onChange: (value: string) => void;
  options?: BookingDropdownOption[];
  groups?: BookingDropdownGroup[];
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  emptyText?: string;
  className?: string;
};

type DropdownPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
};

function normalizeOptions(options: BookingDropdownOption[] = []) {
  return options.map((opt) => ({
    value: String(opt.value || "").trim(),
    label: String(opt.label || "").trim(),
    disabled: !!opt.disabled,
  }));
}

function normalizeGroups(groups: BookingDropdownGroup[] = []) {
  return groups.map((group) => ({
    label: String(group.label || "").trim(),
    options: normalizeOptions(group.options || []),
  }));
}

const VIEWPORT_GAP = 10;
const MENU_OFFSET = 7;
const MIN_MENU_HEIGHT = 120;
const DEFAULT_MAX_HEIGHT = 280;
const DROPDOWN_OPEN_EVENT = "booking-dropdown-open";

function isScrollableElement(node: HTMLElement) {
  const style = window.getComputedStyle(node);
  return /(auto|scroll|overlay)/.test(`${style.overflow}${style.overflowX}${style.overflowY}`);
}

function getScrollParents(node: HTMLElement | null) {
  const parents: Array<HTMLElement | Window> = [window];
  let current = node?.parentElement || null;

  while (current && current !== document.body && current !== document.documentElement) {
    if (isScrollableElement(current)) parents.push(current);
    current = current.parentElement;
  }

  return parents;
}

function samePosition(a: DropdownPosition | null, b: DropdownPosition) {
  if (!a) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.maxHeight - b.maxHeight) < 0.5 &&
    a.placement === b.placement
  );
}

const BookingDropdown = ({
  value,
  onChange,
  options = [],
  groups = [],
  placeholder,
  ariaLabel,
  disabled = false,
  emptyText = "لا توجد خيارات",
  className = "",
}: BookingDropdownProps) => {
  const dropdownId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const normalizedGroups = useMemo(() => normalizeGroups(groups), [groups]);
  const hasGroups = normalizedGroups.length > 0;
  const hasOptions = hasGroups
    ? normalizedGroups.some((group) => group.options.length > 0)
    : normalizedOptions.length > 0;
  const safeDisabled = disabled || !hasOptions;

  const selectedLabel = useMemo(() => {
    const selectedValue = String(value || "").trim();
    if (!selectedValue) return "";

    if (hasGroups) {
      for (const group of normalizedGroups) {
        const found = group.options.find((opt) => opt.value === selectedValue);
        if (found) return found.label;
      }
      return "";
    }

    return normalizedOptions.find((opt) => opt.value === selectedValue)?.label || "";
  }, [value, hasGroups, normalizedGroups, normalizedOptions]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const menuWidth = Math.min(Math.max(rect.width, 0), Math.max(0, viewportWidth - VIEWPORT_GAP * 2));
    const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_GAP;
    const spaceAbove = rect.top - VIEWPORT_GAP;
    const openAbove = spaceBelow < MIN_MENU_HEIGHT && spaceAbove > spaceBelow;
    const availableHeight = Math.max(MIN_MENU_HEIGHT, openAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(DEFAULT_MAX_HEIGHT, availableHeight);
    const top = openAbove
      ? Math.max(VIEWPORT_GAP, rect.top - maxHeight - MENU_OFFSET)
      : Math.min(viewportHeight - VIEWPORT_GAP, rect.bottom + MENU_OFFSET);
    const left = Math.max(
      VIEWPORT_GAP,
      Math.min(rect.left, viewportWidth - menuWidth - VIEWPORT_GAP),
    );
    const nextPosition: DropdownPosition = {
      top,
      left,
      width: menuWidth,
      maxHeight,
      placement: openAbove ? "top" : "bottom",
    };

    setPosition((prev) => (samePosition(prev, nextPosition) ? prev : nextPosition));
  }, []);

  const schedulePositionUpdate = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      updatePosition();
    });
  }, [updatePosition]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (safeDisabled && open) setOpen(false);
  }, [open, safeDisabled]);

  useEffect(() => {
    const handlePeerOpen = (ev: Event) => {
      const nextOpenId = (ev as CustomEvent<string>).detail;
      if (nextOpenId !== dropdownId) setOpen(false);
    };

    window.addEventListener(DROPDOWN_OPEN_EVENT, handlePeerOpen);
    return () => window.removeEventListener(DROPDOWN_OPEN_EVENT, handlePeerOpen);
  }, [dropdownId]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (ev: PointerEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const handleScrollOrResize = (ev: Event) => {
      const target = ev.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      schedulePositionUpdate();
    };
    const scrollParents = getScrollParents(triggerRef.current);

    window.addEventListener("resize", handleScrollOrResize, { passive: true });
    scrollParents.forEach((target) => target.addEventListener("scroll", handleScrollOrResize, { passive: true }));

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleScrollOrResize);
      scrollParents.forEach((target) => target.removeEventListener("scroll", handleScrollOrResize));
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [open, schedulePositionUpdate]);

  const chooseOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next) window.dispatchEvent(new CustomEvent(DROPDOWN_OPEN_EVENT, { detail: dropdownId }));
      return next;
    });
  };

  const renderOptions = () => {
    if (!hasOptions) {
      return <div className="bk-unified-dropdown-empty">{emptyText}</div>;
    }

    if (hasGroups) {
      return normalizedGroups.map((group, groupIdx) => (
        <div key={`group-${groupIdx}-${group.label}`} className="bk-unified-dropdown-group">
          {group.label ? <div className="bk-unified-dropdown-group-label">{group.label}</div> : null}
          {group.options.map((opt, optIdx) => {
            const selected = String(value || "").trim() === opt.value;
            return (
              <button
                key={`${groupIdx}-${optIdx}-${opt.value}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={`bk-unified-dropdown-option ${selected ? "is-selected" : ""}`}
                disabled={opt.disabled}
                onClick={() => chooseOption(opt.value)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ));
    }

    return normalizedOptions.map((opt, idx) => {
      const selected = String(value || "").trim() === opt.value;
      return (
        <button
          key={`${idx}-${opt.value}`}
          type="button"
          role="option"
          aria-selected={selected}
          className={`bk-unified-dropdown-option ${selected ? "is-selected" : ""}`}
          disabled={opt.disabled}
          onClick={() => chooseOption(opt.value)}
        >
          {opt.label}
        </button>
      );
    });
  };

  const menu = open && position && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          className="bk-unified-dropdown-menu bk-unified-dropdown-menu--portal"
          role="listbox"
          aria-label={ariaLabel}
          data-placement={position.placement}
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
        >
          {renderOptions()}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <div ref={rootRef} className={`bk-unified-dropdown ${open ? "is-open" : ""} ${className}`.trim()}>
        <button
          ref={triggerRef}
          type="button"
          className="bk-unified-dropdown-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={ariaLabel}
          onClick={toggleOpen}
          disabled={safeDisabled}
        >
          <span className={`bk-unified-dropdown-value ${selectedLabel ? "" : "is-placeholder"}`}>
            {selectedLabel || placeholder}
          </span>
          <span className="bk-unified-dropdown-caret" aria-hidden="true" />
        </button>
      </div>
      {menu}
    </>
  );
};

export default BookingDropdown;
