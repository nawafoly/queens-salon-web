import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import "../styles/EmployeeSelect.css";

export type EmployeeSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type EmployeeSelectProps = {
  id?: string;
  value: string;
  options: EmployeeSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
};

export default function EmployeeSelect({
  id,
  value,
  options,
  placeholder = "اختاري من القائمة",
  disabled = false,
  className = "",
  ariaLabel,
  onChange,
}: EmployeeSelectProps) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] =
    useState<CSSProperties>({});

  const selectedIndex = useMemo(
    () =>
      options.findIndex(
        (option) => option.value === value
      ),
    [options, value]
  );

  const selectedOption =
    selectedIndex >= 0
      ? options[selectedIndex]
      : null;

  function firstEnabledIndex() {
    return options.findIndex(
      (option) => !option.disabled
    );
  }

  function lastEnabledIndex() {
    for (
      let index = options.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (!options[index]?.disabled) {
        return index;
      }
    }

    return -1;
  }

  function moveActive(direction: 1 | -1) {
    if (!options.length) return;

    let nextIndex =
      activeIndex >= 0
        ? activeIndex
        : selectedIndex >= 0
          ? selectedIndex
          : direction === 1
            ? -1
            : options.length;

    for (
      let attempts = 0;
      attempts < options.length;
      attempts += 1
    ) {
      nextIndex =
        (nextIndex + direction + options.length) %
        options.length;

      if (!options[nextIndex]?.disabled) {
        setActiveIndex(nextIndex);
        return;
      }
    }
  }

  function updateMenuPosition() {
    const trigger = triggerRef.current;

    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 7;

    const availableBelow =
      viewportHeight - rect.bottom - gap;

    const availableAbove =
      rect.top - gap;

    const openAbove =
      availableBelow < 220 &&
      availableAbove > availableBelow;

    const maxHeight = Math.max(
      150,
      Math.min(
        330,
        (openAbove
          ? availableAbove
          : availableBelow) - 12
      )
    );

    const width = Math.max(
      220,
      Math.min(
        rect.width,
        viewportWidth - 16
      )
    );

    const left = Math.max(
      8,
      Math.min(
        rect.left,
        viewportWidth - width - 8
      )
    );

    setMenuStyle({
      width,
      left,
      top: openAbove
        ? undefined
        : rect.bottom + gap,
      bottom: openAbove
        ? viewportHeight - rect.top + gap
        : undefined,
      maxHeight,
    });
  }

  function openMenu() {
    if (disabled || !options.length) return;

    setOpen(true);

    setActiveIndex(
      selectedIndex >= 0
        ? selectedIndex
        : firstEnabledIndex()
    );
  }

  function closeMenu() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function selectOption(index: number) {
    const option = options[index];

    if (!option || option.disabled) return;

    onChange(option.value);
    closeMenu();

    requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }

  function handleTriggerKeyDown(
    event: KeyboardEvent<HTMLButtonElement>
  ) {
    if (disabled) return;

    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp"
    ) {
      event.preventDefault();

      if (!open) {
        openMenu();
        return;
      }

      moveActive(
        event.key === "ArrowDown" ? 1 : -1
      );

      return;
    }

    if (event.key === "Home") {
      event.preventDefault();

      if (!open) openMenu();

      setActiveIndex(firstEnabledIndex());
      return;
    }

    if (event.key === "End") {
      event.preventDefault();

      if (!open) openMenu();

      setActiveIndex(lastEnabledIndex());
      return;
    }

    if (
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();

      if (!open) {
        openMenu();
        return;
      }

      if (activeIndex >= 0) {
        selectOption(activeIndex);
      }

      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu();
    }
  }

  useLayoutEffect(() => {
    if (!open) return;

    updateMenuPosition();

    const handleViewportChange = () => {
      updateMenuPosition();
    };

    window.addEventListener(
      "resize",
      handleViewportChange
    );

    window.addEventListener(
      "scroll",
      handleViewportChange,
      true
    );

    return () => {
      window.removeEventListener(
        "resize",
        handleViewportChange
      );

      window.removeEventListener(
        "scroll",
        handleViewportChange,
        true
      );
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (
      event: PointerEvent
    ) => {
      const target = event.target as Node;

      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }

      closeMenu();
    };

    document.addEventListener(
      "pointerdown",
      handlePointerDown
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        handlePointerDown
      );
    };
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      closeMenu();
    }
  }, [disabled, open]);

  return (
    <div
      ref={rootRef}
      className={[
        "employee-select",
        open ? "is-open" : "",
        disabled ? "is-disabled" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="employee-select__trigger"
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span
          className={`employee-select__value ${
            selectedOption ? "" : "is-placeholder"
          }`}
        >
          {selectedOption?.label || placeholder}
        </span>

        <span
          className="employee-select__chevron"
          aria-hidden="true"
        >
          ‹
        </span>
      </button>

      {open &&
        typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              id={listboxId}
              role="listbox"
              aria-label={
                ariaLabel || placeholder
              }
              className="employee-select__menu"
              style={menuStyle}
            >
              {options.map((option, index) => {
                const selected =
                  option.value === value;

                const active =
                  index === activeIndex;

                return (
                  <button
                    id={`${listboxId}-option-${index}`}
                    key={`${option.value}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={option.disabled}
                    tabIndex={-1}
                    className={[
                      "employee-select__option",
                      selected
                        ? "is-selected"
                        : "",
                      active ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onPointerEnter={() =>
                      setActiveIndex(index)
                    }
                    onClick={() =>
                      selectOption(index)
                    }
                  >
                    <span>{option.label}</span>

                    {selected ? (
                      <span
                        className="employee-select__check"
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}