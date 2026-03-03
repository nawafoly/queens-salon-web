import { useEffect, useMemo, useRef, useState } from "react";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

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

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (ev: MouseEvent) => {
      const node = rootRef.current;
      if (!node) return;
      const target = ev.target as Node | null;
      if (target && node.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

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
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
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
          onClick={() => {
            onChange(opt.value);
            setOpen(false);
          }}
        >
          {opt.label}
        </button>
      );
    });
  };

  return (
    <div ref={rootRef} className={`bk-unified-dropdown ${open ? "is-open" : ""} ${className}`.trim()}>
      <button
        type="button"
        className="bk-unified-dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
        disabled={safeDisabled}
      >
        <span className={`bk-unified-dropdown-value ${selectedLabel ? "" : "is-placeholder"}`}>
          {selectedLabel || placeholder}
        </span>
        <span className="bk-unified-dropdown-caret" aria-hidden="true" />
      </button>

      {open ? (
        <div className="bk-unified-dropdown-menu" role="listbox" aria-label={ariaLabel}>
          {renderOptions()}
        </div>
      ) : null}
    </div>
  );
};

export default BookingDropdown;
