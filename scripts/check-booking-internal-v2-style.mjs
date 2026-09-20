import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const canonicalPath = resolve(root, "src/styles/dashboard-v2/pages/booking-internal.css");
const controlsPath = resolve(root, "src/styles/dashboard-v2/pages/booking-internal-controls-refinement.css");
const sessionsPath = resolve(root, "src/styles/dashboard-v2/pages/booking-internal-sessions-refinement.css");
const mobilePath = resolve(root, "src/styles/dashboard-v2/pages/booking-internal-mobile.css");
const entryPath = resolve(root, "src/styles/dashboard-v2/dashboard-v2.css");
const dashboardPath = resolve(root, "src/pages/Dashboard.tsx");
const bookingPath = resolve(root, "src/features/internal-booking-v2/BookingInternalV2.tsx");
const packageSessionsPath = resolve(root, "src/features/internal-booking-v2/PackageSessionsManager.tsx");
const legacyFeatureStylePath = resolve(root, "src/features/internal-booking-v2/booking-internal-v2.css");
const errors = [];

function checkCanonicalCss(path, label) {
  if (!existsSync(path)) {
    errors.push(`Missing ${label}.`);
    return;
  }
  const css = readFileSync(path, "utf8");
  if (/#[0-9a-f]{3,8}\b/i.test(css)) errors.push(`${label} contains a raw hex color.`);
  if (/!important\b/i.test(css)) errors.push(`${label} contains !important.`);
  if (!css.includes(".dashboard-v2")) {
    errors.push(`${label} is not scoped under Dashboard V2.`);
  }
  if (!css.includes("var(--dsv2-")) {
    errors.push(`${label} is not consuming Dashboard V2 tokens.`);
  }
}

checkCanonicalCss(canonicalPath, "booking-internal.css");
checkCanonicalCss(controlsPath, "booking-internal-controls-refinement.css");
checkCanonicalCss(sessionsPath, "booking-internal-sessions-refinement.css");
checkCanonicalCss(mobilePath, "booking-internal-mobile.css");

const canonicalCss = readFileSync(canonicalPath, "utf8");
const legacyFeatureCss = readFileSync(legacyFeatureStylePath, "utf8");
if (/\.bk2-summary-card\s*\{[^}]*order\s*:\s*-1\b/s.test(canonicalCss)) {
  errors.push("booking-internal.css must not render the summary before the active workflow on tablet/mobile.");
}
if (/\.bk2-summary-card\s*\{[^}]*order\s*:\s*-1\b/s.test(legacyFeatureCss)) {
  errors.push("booking-internal-v2.css must not render the summary before the active workflow on tablet/mobile.");
}
if (!/@media \(max-width: 900px\)[\s\S]*?\.bk2-summary-card[^}]*order\s*:\s*1\b/.test(canonicalCss)) {
  errors.push("booking-internal.css must place the mobile summary after the active workflow.");
}

const entry = readFileSync(entryPath, "utf8");
if (!entry.includes('@import "./pages/booking-internal.css";')) {
  errors.push("Dashboard V2 entry point does not import booking-internal.css.");
}
if (!entry.includes('@import "./pages/booking-internal-controls-refinement.css";')) {
  errors.push("Dashboard V2 entry point does not import booking-internal-controls-refinement.css.");
}
if (!entry.includes('@import "./pages/booking-internal-sessions-refinement.css";')) {
  errors.push("Dashboard V2 entry point does not import booking-internal-sessions-refinement.css.");
}
if (!entry.includes('@import "./pages/booking-internal-mobile.css";')) {
  errors.push("Dashboard V2 entry point does not import booking-internal-mobile.css.");
}
const mobileCss = readFileSync(mobilePath, "utf8");
if (!mobileCss.includes("MOBILE_CASHIER_WORKSPACE_V1")) {
  errors.push("booking-internal-mobile.css is missing the mobile cashier workspace marker.");
}
if (!/@media \(max-width: 743px\)/.test(mobileCss)) {
  errors.push("booking-internal-mobile.css must own the phone breakpoint through 743px.");
}
if (!/\.bk2-stepper\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/.test(mobileCss)) {
  errors.push("Mobile booking stepper must fit all four steps without horizontal scrolling.");
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
if (booking.includes("discountOpen") || booking.includes("setDiscountOpen")) {
  errors.push("BookingInternalV2.tsx must keep discount options visible without disclosure state.");
}
if (booking.includes("bk2-discount-toggle")) {
  errors.push("BookingInternalV2.tsx must not render the removed discount toggle button.");
}
if (!booking.includes('className="bk2-choice-grid five"')) {
  errors.push("BookingInternalV2.tsx must render the discount choices directly in the payment step.");
}
if (!booking.includes('t("إضافة خصم أو كوبون")')) {
  errors.push("BookingInternalV2.tsx is missing the discount section heading.");
}

const sessions = readFileSync(packageSessionsPath, "utf8");
for (const primitive of ["DashboardDrawerV2", "DashboardModalV2", "DashboardSelectV2", "DashboardDatePickerV2"]) {
  if (!sessions.includes(primitive)) {
    errors.push(`PackageSessionsManager.tsx is missing ${primitive}.`);
  }
}
if (/<select\b/i.test(sessions)) {
  errors.push("PackageSessionsManager.tsx still contains a native select control.");
}
if (/type\s*=\s*["']date["']/i.test(sessions)) {
  errors.push("PackageSessionsManager.tsx still contains a native date input.");
}
if (sessions.includes("bk2-session-dialog-backdrop")) {
  errors.push("PackageSessionsManager.tsx still renders its legacy in-page dialog backdrop.");
}
if (sessions.includes('<aside className="bk2-session-wallet"')) {
  errors.push("PackageSessionsManager.tsx still renders the wallet inside the page instead of the V2 drawer portal.");
}

if (errors.length) {
  console.error("Internal booking Dashboard V2 style contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Internal booking Dashboard V2 style contract passed.");
