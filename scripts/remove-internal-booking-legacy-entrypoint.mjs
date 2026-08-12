import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, content) => fs.writeFileSync(path.join(root, file), content, "utf8");

function replaceRequired(source, before, after, label) {
  if (!source.includes(before)) {
    throw new Error(`Missing expected block: ${label}`);
  }
  return source.replace(before, after);
}

const dashboardPath = "src/pages/Dashboard.tsx";
let dashboard = read(dashboardPath);
dashboard = replaceRequired(
  dashboard,
  'import BookingInternal from "../pages/BookingInternal";\n',
  "",
  "Dashboard legacy BookingInternal import",
);

dashboard = replaceRequired(
  dashboard,
  `                <Route\n                  path="booking-internal-legacy"\n                  element={\n                    <PermissionRoute permission="bookings.create">\n                      <BookingInternal internalMode />\n                    </PermissionRoute>\n                  }\n                />\n\n`,
  "",
  "Dashboard booking-internal-legacy route",
);
write(dashboardPath, dashboard);

const contractPath = "scripts/check-booking-internal-contract.mjs";
let contract = read(contractPath);
contract = replaceRequired(
  contract,
  `// Route safety: the production administrative booking route stays on V2 while\n// the legacy implementation remains available as an explicit fallback/reference.\n`,
  `// Route safety: administrative booking has exactly one runtime entrypoint: V2.\n// Legacy compatibility routes/wrappers are forbidden so a second implementation\n// cannot silently return later.\n`,
  "internal booking contract route comment",
);
contract = replaceRequired(
  contract,
  `requireMatch(\n  dashboard,\n  /path=["']booking-internal-legacy["'][\\s\\S]{0,500}<BookingInternal\\s+internalMode\\s*\\/>/,\n  "Legacy internal-booking reference route is missing."\n);\n`,
  `if (dashboard.includes("booking-internal-legacy")) {\n  errors.push("Legacy /dashboard/booking-internal-legacy route must not exist.");\n}\nif (dashboard.includes("../pages/BookingInternal")) {\n  errors.push("Dashboard must not import the historical BookingInternal compatibility wrapper.");\n}\n`,
  "legacy route requirement in internal booking contract",
);
write(contractPath, contract);

const guardPath = "scripts/check-no-legacy-booking-runtime.mjs";
let guard = read(guardPath);
guard = replaceRequired(
  guard,
  `// Customer and V2 own actual scheduling decisions. The historical internal\n// route is intentionally a thin compatibility delegate to V2 so it cannot\n// maintain a second booking policy engine.\nconst decisionUiFiles = [\n  'src/pages/Booking.tsx',\n  'src/features/internal-booking-v2/BookingInternalV2.tsx',\n];\nconst bookingUiFiles = [\n  ...decisionUiFiles,\n  'src/pages/BookingInternal.tsx',\n];\n`,
  `// Customer booking and internal V2 are the only booking-decision UIs.\n// Historical internal-booking wrappers/routes are forbidden entirely.\nconst decisionUiFiles = [\n  'src/pages/Booking.tsx',\n  'src/features/internal-booking-v2/BookingInternalV2.tsx',\n];\nconst bookingUiFiles = [...decisionUiFiles];\n`,
  "no-legacy booking UI file list",
);
guard = replaceRequired(
  guard,
  `requireText(\n  'src/pages/BookingInternal.tsx',\n  'BookingInternalV2',\n  'legacy internal route must delegate to the Core-HR-authoritative V2 runtime'\n);\nforbid(\n  'src/pages/BookingInternal.tsx',\n  'firestoreAvailabilityBackfill',\n  'legacy internal compatibility route must not run Firestore availability backfill'\n);\nforbid(\n  'src/pages/BookingInternal.tsx',\n  'getDataSourceFlags().useCoreD1',\n  'legacy internal compatibility route must not keep a Core-vs-Firestore booking branch'\n);\n`,
  `forbid(\n  'src/pages/Dashboard.tsx',\n  'booking-internal-legacy',\n  'Dashboard must not expose a legacy internal-booking route'\n);\nforbid(\n  'src/pages/Dashboard.tsx',\n  '../pages/BookingInternal',\n  'Dashboard must not import the historical BookingInternal wrapper'\n);\nif (fs.existsSync(path.join(root, 'src/pages/BookingInternal.tsx'))) {\n  failures.push('src/pages/BookingInternal.tsx: historical internal-booking wrapper must be deleted');\n}\nif (fs.existsSync(path.join(root, 'src/styles/BookingInternalLegacy.css'))) {\n  failures.push('src/styles/BookingInternalLegacy.css: dead legacy stylesheet must be deleted');\n}\n`,
  "legacy compatibility delegate checks",
);
write(guardPath, guard);

for (const file of [
  "src/pages/BookingInternal.tsx",
  "src/styles/BookingInternalLegacy.css",
]) {
  const absolute = path.join(root, file);
  if (fs.existsSync(absolute)) fs.rmSync(absolute);
}

console.log("Removed internal booking legacy compatibility entrypoint and hardened guards.");
