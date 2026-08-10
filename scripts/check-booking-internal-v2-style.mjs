import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const canonicalPath = resolve(root, "src/styles/dashboard-v2/pages/booking-internal.css");
const entryPath = resolve(root, "src/styles/dashboard-v2/dashboard-v2.css");
const dashboardPath = resolve(root, "src/pages/Dashboard.tsx");
const errors = [];

if (!existsSync(canonicalPath)) {
  errors.push("Missing canonical internal booking stylesheet.");
} else {
  const css = readFileSync(canonicalPath, "utf8");
  if (/#[0-9a-f]{3,8}\b/i.test(css)) errors.push("booking-internal.css contains a raw hex color.");
  if (/!important\b/i.test(css)) errors.push("booking-internal.css contains !important.");
  if (!css.includes(".dashboard-v2.is-booking-internal-route")) {
    errors.push("booking-internal.css is not isolated to the Dashboard V2 internal-booking route.");
  }
  if (!css.includes("var(--dsv2-")) {
    errors.push("booking-internal.css is not consuming Dashboard V2 tokens.");
  }
}

const entry = readFileSync(entryPath, "utf8");
if (!entry.includes('@import "./pages/booking-internal.css";')) {
  errors.push("Dashboard V2 entry point does not import booking-internal.css.");
}

const dashboard = readFileSync(dashboardPath, "utf8");
if (!dashboard.includes("isBookingInternalPage")) {
  errors.push("Dashboard no longer identifies internal booking routes.");
}
if (!dashboard.includes("is-booking-internal-route")) {
  errors.push("Dashboard no longer exposes the internal-booking route scope class.");
}

if (errors.length) {
  console.error("Internal booking Dashboard V2 style contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Internal booking Dashboard V2 style contract passed.");
