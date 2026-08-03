import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import useDashboardFloatingPositionV2 from "./useDashboardFloatingPositionV2";

export type DashboardSelectOptionV2 = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type DashboardSelectV2Props = {
  id?: string;
  name?: string;
  options: readonly DashboardSelectOptionV2[];
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-describedby"?: string;
  onChange?: (value: string, option: DashboardSelectOptionV2) => void;
};

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="dsv2-select-v2__chevron"
      viewBox="0 0 20 20"
      fill="none"
    >
      <path
        d="m6.25 8.25 3.75 3.5 3.75-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DashboardSelectV2({
  id,
  name,
  options,
  value,
  defaultValue = "",
  placeholder = "اختر",
  disabled = false,
  required = false,
  className = "",
  "aria-describedby": ariaDescribedBy,
  onChange,
}: DashboardSelectV2Props) {
  const generatedId = useId();
  const triggerId = id ?? `dsv2-select-${generatedId}`;
  const listboxId = `${triggerId}-listbox`;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<number | null>(null);
  const selectedValue = controlled ? value : internalValue;
  const selectedOption = useMemo(
    () => options.find((option) => option.value === selectedValue),
    [options, selectedValue],
  );
  const { position, updatePosition } = useDashboardFloatingPositionV2({
    open,
    anchorRef: triggerRef,
    estimatedHeight: Math.min(320, Math.max(96, options.length * 44 + 16)),
  });

  const enabledIndexes = useMemo(
    () => options.flatMap((option, index) => (option.disabled ? [] : [index])),
    [options],
  );

  const getInitialIndex = () => {
    const selectedIndex = options.findIndex(
      (option) => option.value === selectedValue && !option.disabled,
    );
    return selectedIndex >= 0 ? selectedIndex : (enabledIndexes[0] ?? -1);
  };

  const openMenu = () => {
    if (disabled || enabledIndexes.length === 0) {
      return;
    }
    setActiveIndex(getInitialIndex());
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const commitOption = (option: DashboardSelectOptionV2) => {
    if (option.disabled) {
      return;
    }
    if (!controlled) {
      setInternalValue(option.value);
    }
    onChange?.(option.value, option);
    closeMenu(true);
  };

  const moveActive = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) {
      return;
    }
    const currentEnabledPosition = enabledIndexes.indexOf(activeIndex);
    const fallbackPosition = direction === 1 ? -1 : 0;
    const nextPosition =
      (currentEnabledPosition === -1 ? fallbackPosition : currentEnabledPosition) + direction;
    const wrappedPosition = (nextPosition + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[wrappedPosition] ?? -1);
  };

  const handleTypeahead = (key: string) => {
    if (key.length !== 1 || key.trim() === "") {
      return;
    }
    if (typeaheadTimerRef.current !== null) {
      window.clearTimeout(typeaheadTimerRef.current);
    }
    typeaheadRef.current += key.toLocaleLowerCase("ar");
    const matchIndex = options.findIndex(
      (option) =>
        !option.disabled &&
        option.label.toLocaleLowerCase("ar").startsWith(typeaheadRef.current),
    );
    if (matchIndex >= 0) {
      setActiveIndex(matchIndex);
    }
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = "";
      typeaheadTimerRef.current = null;
    }, 650);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) {
      return;
    }

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(enabledIndexes[0] ?? -1);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(enabledIndexes.at(-1) ?? -1);
        break;
      case "Enter":
      case " ": {
        event.preventDefault();
        const option = options[activeIndex];
        if (option) {
          commitOption(option);
        }
        break;
      }
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        closeMenu(false);
        break;
      default:
        handleTypeahead(event.key);
    }
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(
    () => () => {
      if (typeaheadTimerRef.current !== null) {
        window.clearTimeout(typeaheadTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }
    menuRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const classes = ["dsv2-select-v2", className].filter(Boolean).join(" ");
  const menu = open && typeof document !== "undefined" ? (
    <div className="dashboard-v2 dsv2-page dsv2-floating-root" aria-hidden="false">
      <div
        ref={menuRef}
        id={listboxId}
        className="dsv2-select-v2__menu"
        role="listbox"
        aria-labelledby={triggerId}
        data-placement={position.placement}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
        }}
      >
        {options.map((option, index) => {
          const selected = option.value === selectedValue;
          const active = index === activeIndex;
          return (
            <button
              key={option.value}
              id={`${listboxId}-option-${index}`}
              type="button"
              className="dsv2-select-v2__option"
              role="option"
              aria-selected={selected}
              disabled={option.disabled}
              data-active={active ? "true" : "false"}
              data-option-index={index}
              onMouseEnter={() => {
                if (!option.disabled) {
                  setActiveIndex(index);
                }
              }}
              onClick={() => commitOption(option)}
            >
              <span>{option.label}</span>
              {selected ? <span className="dsv2-select-v2__check">✓</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={classes}>
      {name ? <input type="hidden" name={name} value={selectedValue ?? ""} /> : null}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="dsv2-select-v2__trigger"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-describedby={ariaDescribedBy}
        aria-required={required}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        disabled={disabled}
        data-open={open ? "true" : "false"}
        onClick={() => {
          if (open) {
            closeMenu(false);
          } else {
            openMenu();
            requestAnimationFrame(updatePosition);
          }
        }}
        onKeyDown={handleKeyDown}
      >
        <span
          className="dsv2-select-v2__value"
          data-placeholder={selectedOption ? "false" : "true"}
        >
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronIcon open={open} />
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
