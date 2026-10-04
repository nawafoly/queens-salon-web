import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing ARIA codemod anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`ARIA codemod anchor is not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function patch(path, edits) {
  let source = readFileSync(path, "utf8");
  for (const [before, after, label] of edits) {
    source = replaceOnce(source, before, after, label);
  }
  writeFileSync(path, source, "utf8");
}

patch("src/components/dashboard-v2/DashboardDatePickerV2.tsx", [
  [
    `import type { KeyboardEvent as ReactKeyboardEvent } from "react";`,
    `import type { AriaAttributes, KeyboardEvent as ReactKeyboardEvent } from "react";`,
    "date type import",
  ],
  [
    `  "aria-describedby"?: string;\n  onChange?: (value: string) => void;`,
    `  "aria-describedby"?: string;\n  "aria-invalid"?: AriaAttributes["aria-invalid"];\n  onChange?: (value: string) => void;`,
    "date props",
  ],
  [
    `  "aria-describedby": ariaDescribedBy,\n  onChange,`,
    `  "aria-describedby": ariaDescribedBy,\n  "aria-invalid": ariaInvalid,\n  onChange,`,
    "date destructure",
  ],
  [
    `        aria-describedby={ariaDescribedBy}\n        aria-required={required}`,
    `        aria-describedby={ariaDescribedBy}\n        aria-invalid={ariaInvalid}\n        aria-required={required}`,
    "date trigger",
  ],
]);

patch("src/components/dashboard-v2/DashboardSelectV2.tsx", [
  [
    `import type { KeyboardEvent as ReactKeyboardEvent } from "react";`,
    `import type { AriaAttributes, KeyboardEvent as ReactKeyboardEvent } from "react";`,
    "select type import",
  ],
  [
    `  "aria-describedby"?: string;\n  onChange?: (value: string, option: DashboardSelectOptionV2) => void;`,
    `  "aria-describedby"?: string;\n  "aria-invalid"?: AriaAttributes["aria-invalid"];\n  onChange?: (value: string, option: DashboardSelectOptionV2) => void;`,
    "select props",
  ],
  [
    `  "aria-describedby": ariaDescribedBy,\n  onChange,`,
    `  "aria-describedby": ariaDescribedBy,\n  "aria-invalid": ariaInvalid,\n  onChange,`,
    "select destructure",
  ],
  [
    `        aria-describedby={ariaDescribedBy}\n        aria-required={required}`,
    `        aria-describedby={ariaDescribedBy}\n        aria-invalid={ariaInvalid}\n        aria-required={required}`,
    "select trigger",
  ],
]);

patch("src/components/dashboard-v2/DashboardMonthPickerV2.tsx", [
  [
    `import { useEffect, useId, useMemo, useRef, useState } from "react";`,
    `import { useEffect, useId, useMemo, useRef, useState } from "react";\nimport type { AriaAttributes } from "react";`,
    "month type import",
  ],
  [
    `  className?: string;\n  onChange?: (value: string) => void;`,
    `  className?: string;\n  "aria-describedby"?: string;\n  "aria-invalid"?: AriaAttributes["aria-invalid"];\n  onChange?: (value: string) => void;`,
    "month props",
  ],
  [
    `  clearable = true,\n  className = "",\n  onChange,`,
    `  clearable = true,\n  className = "",\n  "aria-describedby": ariaDescribedBy,\n  "aria-invalid": ariaInvalid,\n  onChange,`,
    "month destructure",
  ],
  [
    `        aria-expanded={open}\n        aria-haspopup="dialog"\n        aria-required={required}`,
    `        aria-expanded={open}\n        aria-haspopup="dialog"\n        aria-describedby={ariaDescribedBy}\n        aria-invalid={ariaInvalid}\n        aria-required={required}`,
    "month trigger",
  ],
]);

patch("src/components/dashboard-v2/DashboardTimePickerV2.tsx", [
  [
    `import { forwardRef, useEffect, useRef, useState } from "react";`,
    `import { forwardRef, useEffect, useRef, useState } from "react";\nimport type { AriaAttributes } from "react";`,
    "time type import",
  ],
  [
    `  clock?: "24h" | "12h";\n  onChange?: (value: string) => void;`,
    `  clock?: "24h" | "12h";\n  "aria-describedby"?: string;\n  "aria-invalid"?: AriaAttributes["aria-invalid"];\n  onChange?: (value: string) => void;`,
    "time props",
  ],
  [
    `  step,\n  clock = "24h",\n  onChange,`,
    `  step,\n  clock = "24h",\n  "aria-describedby": ariaDescribedBy,\n  "aria-invalid": ariaInvalid,\n  onChange,`,
    "time destructure",
  ],
  [
    `            aria-label={resolvedPlaceholder}\n            data-min={min}`,
    `            aria-label={resolvedPlaceholder}\n            aria-describedby={ariaDescribedBy}\n            aria-invalid={ariaInvalid}\n            data-min={min}`,
    "time 12h input",
  ],
  [
    `          aria-label={resolvedPlaceholder}\n          onChange={(event) => commit(normalizeCommittedTime(event.target.value))}`,
    `          aria-label={resolvedPlaceholder}\n          aria-describedby={ariaDescribedBy}\n          aria-invalid={ariaInvalid}\n          onChange={(event) => commit(normalizeCommittedTime(event.target.value))}`,
    "time native input",
  ],
]);

console.log("Applied contextual feedback ARIA propagation.");
