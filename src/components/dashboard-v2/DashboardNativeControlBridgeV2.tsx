import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  type ChangeEvent,
  type ChangeEventHandler,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import DashboardDatePickerV2 from "./DashboardDatePickerV2";
import DashboardMonthPickerV2 from "./DashboardMonthPickerV2";
import DashboardSelectV2, {
  type DashboardSelectOptionV2,
} from "./DashboardSelectV2";
import DashboardTimePickerV2 from "./DashboardTimePickerV2";

function cleanLegacyInputClassName(className?: string) {
  return String(className || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) =>
        !["dsv2-input", "form-control", "form-select"].includes(token)
    )
    .join(" ");
}

function textFromNode(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (isValidElement(node)) return textFromNode((node.props as any).children);
  return "";
}

function collectOptions(
  children: ReactNode,
  inheritedDisabled = false
): DashboardSelectOptionV2[] {
  const options: DashboardSelectOptionV2[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;

    if (child.type === Fragment) {
      options.push(
        ...collectOptions((child.props as any).children, inheritedDisabled)
      );
      return;
    }

    if (child.type === "optgroup") {
      options.push(
        ...collectOptions(
          (child.props as any).children,
          inheritedDisabled || Boolean((child.props as any).disabled)
        )
      );
      return;
    }

    if (child.type === "option") {
      const props = child.props as any;
      const label = textFromNode(props.children);
      options.push({
        value: String(props.value ?? label),
        label,
        disabled: inheritedDisabled || Boolean(props.disabled),
      });
    }
  });

  return options;
}

function fakeSelectEvent(
  value: string,
  props: {
    id?: string;
    name?: string;
  }
) {
  const target = {
    value,
    id: props.id || "",
    name: props.name || "",
  } as HTMLSelectElement;

  return {
    target,
    currentTarget: target,
  } as ChangeEvent<HTMLSelectElement>;
}

function fakeInputEvent(
  value: string,
  type: "date" | "time" | "month",
  props: {
    id?: string;
    name?: string;
  }
) {
  const target = {
    value,
    type,
    id: props.id || "",
    name: props.name || "",
  } as HTMLInputElement;

  return {
    target,
    currentTarget: target,
  } as ChangeEvent<HTMLInputElement>;
}

export type DashboardSelectBridgeV2Props = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "defaultValue" | "onChange" | "multiple" | "size"
> & {
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: ChangeEventHandler<HTMLSelectElement>;
  children?: ReactNode;
};

export function DashboardSelectBridgeV2({
  id,
  name,
  value,
  defaultValue,
  disabled,
  required,
  className,
  children,
  onChange,
  ...rest
}: DashboardSelectBridgeV2Props) {
  const options = collectOptions(children);
  const resolvedValue = Array.isArray(value)
    ? String(value[0] ?? "")
    : value !== undefined
      ? String(value)
      : undefined;
  const resolvedDefault = Array.isArray(defaultValue)
    ? String(defaultValue[0] ?? "")
    : defaultValue !== undefined
      ? String(defaultValue)
      : undefined;

  return (
    <div
      className={[
        "dsv2-native-bridge-v2",
        cleanLegacyInputClassName(className),
      ]
        .filter(Boolean)
        .join(" ")}
      style={rest.style}
    >
      <DashboardSelectV2
        id={id}
        name={name}
        value={resolvedValue}
        defaultValue={resolvedDefault}
        disabled={disabled}
        required={required}
        options={options}
        onChange={(next) => onChange?.(fakeSelectEvent(next, { id, name }))}
      />
    </div>
  );
}

type DashboardInputBridgeBaseProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: ChangeEventHandler<HTMLInputElement>;
  clock?: "24h" | "12h";
};

function scalarInputValue(
  value: string | number | readonly string[] | undefined
) {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

export function DashboardDateInputV2({
  id,
  name,
  value,
  defaultValue,
  min,
  max,
  placeholder,
  disabled,
  required,
  className,
  onChange,
  ...rest
}: DashboardInputBridgeBaseProps) {
  return (
    <div
      className={[
        "dsv2-native-bridge-v2",
        cleanLegacyInputClassName(className),
      ]
        .filter(Boolean)
        .join(" ")}
      style={rest.style}
    >
      <DashboardDatePickerV2
        id={id}
        name={name}
        value={value !== undefined ? scalarInputValue(value) : undefined}
        defaultValue={scalarInputValue(defaultValue)}
        min={min !== undefined ? String(min) : undefined}
        max={max !== undefined ? String(max) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onChange={(next) =>
          onChange?.(fakeInputEvent(next, "date", { id, name }))
        }
      />
    </div>
  );
}

export const DashboardTimeInputV2 = forwardRef<HTMLInputElement, DashboardInputBridgeBaseProps>(function DashboardTimeInputV2({
  id,
  name,
  value,
  defaultValue,
  min,
  max,
  step,
  clock,
  placeholder,
  disabled,
  required,
  className,
  onChange,
  ...rest
}: DashboardInputBridgeBaseProps, ref) {
  return (
    <div
      className={[
        "dsv2-native-bridge-v2",
        cleanLegacyInputClassName(className),
      ]
        .filter(Boolean)
        .join(" ")}
      style={rest.style}
    >
      <DashboardTimePickerV2
        ref={ref}
        id={id}
        name={name}
        value={value !== undefined ? scalarInputValue(value) : undefined}
        defaultValue={scalarInputValue(defaultValue)}
        min={min !== undefined ? String(min) : undefined}
        max={max !== undefined ? String(max) : undefined}
        step={step}
        clock={clock}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onChange={(next) =>
          onChange?.(fakeInputEvent(next, "time", { id, name }))
        }
      />
    </div>
  );
});

export function DashboardMonthInputV2({
  id,
  name,
  value,
  defaultValue,
  min,
  max,
  placeholder,
  disabled,
  required,
  className,
  onChange,
  ...rest
}: DashboardInputBridgeBaseProps) {
  return (
    <div
      className={[
        "dsv2-native-bridge-v2",
        cleanLegacyInputClassName(className),
      ]
        .filter(Boolean)
        .join(" ")}
      style={rest.style}
    >
      <DashboardMonthPickerV2
        id={id}
        name={name}
        value={value !== undefined ? scalarInputValue(value) : undefined}
        defaultValue={scalarInputValue(defaultValue)}
        min={min !== undefined ? String(min) : undefined}
        max={max !== undefined ? String(max) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onChange={(next) =>
          onChange?.(fakeInputEvent(next, "month", { id, name }))
        }
      />
    </div>
  );
}
