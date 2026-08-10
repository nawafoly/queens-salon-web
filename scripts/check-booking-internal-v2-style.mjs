import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const canonicalPath = resolve(root, "src/styles/dashboard-v2/pages/booking-internal.css");
const controlsPath = resolve(root, "src/styles/dashboard-v2/pages/booking-internal-controls-refinement.css");
const entryPath = resolve(root, "src/styles/dashboard-v2/dashboard-v2.css");
const dashboardPath = resolve(root, "src/pages/Dashboard.tsx");
const bookingPath = resolve(root, "src/features/internal-booking-v2/BookingInternalV2.tsx");
const errors = [];

function checkCanonicalCss(path, label) {
  if (!existsSync(path)) {
    errors.push(`Missing ${label}.`);
    return;
  }
  const css = readFileSync(path, "utf8");
  if (/#[0-9a-f]{3,8}\b/i.test(css)) errors.push(`${label} contains a raw hex color.`);
  if (/!important\b/i.test(css)) errors.push(`${label} contains !important.`);
  if (!css.includes(".dashboard-v2.is-booking-internal-route")) {
    errors.push(`${label} is not isolated to the Dashboard V2 internal-booking route.`);
  }
  if (!css.includes("var(--dsv2-")) {
    errors.push(`${label} is not consuming Dashboard V2 tokens.`);
  }
}

checkCanonicalCss(canonicalPath, "booking-internal.css");
checkCanonicalCss(controlsPath, "booking-internal-controls-refinement.css");

const entry = readFileSync(entryPath, "utf8");
if (!entry.includes('@import "./pages/booking-internal.css";')) {
  errors.push("Dashboard V2 entry point does not import booking-internal.css.");
}
if (!entry.includes('@import "./pages/booking-internal-controls-refinement.css";')) {
  errors.push("Dashboard V2 entry point does not import booking-internal-controls-refinement.css.");
}

const dashboard = readFileSync(dashboardPath, "utf8");
if (!dashboard.includes("isBookingInternalPage")) {
  errors.push("Dashboard no longer identifies internal booking routes.");
}
if (!dashboard.includes("is-booking-internal-route")) {
  errors.push("Dashboard no longer exposes the internal-booking route scope class.");
}

const booking = readFileSync(bookingPath, "utf8");
if (!booking.includes("DashboardDatePickerV2")) {
  errors.push("BookingInternalV2.tsx is not using DashboardDatePickerV2.");
}
if (!booking.includes("DashboardSelectV2")) {
  errors.push("BookingInternalV2.tsx is not using DashboardSelectV2.");
}
if (/<select\b/i.test(booking)) {
  errors.push("BookingInternalV2.tsx still contains a native select control.");
}
if (/type\s*=\s*["']date["']/i.test(booking)) {
  errors.push("BookingInternalV2.tsx still contains a native date input.");
}
if (!booking.includes('className="bk2-date-picker-v2"')) {
  errors.push("BookingInternalV2.tsx is missing the isolated V2 date-picker class.");
}
if (!booking.includes('className="bk2-staff-select-v2"')) {
  errors.push("BookingInternalV2.tsx is missing the isolated V2 staff-select class.");
}

if (errors.length) {
  console.error("Internal booking Dashboard V2 style contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Internal booking Dashboard V2 style contract passed.");
