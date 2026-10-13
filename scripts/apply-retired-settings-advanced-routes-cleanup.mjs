import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function write(rel, content) {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

const settingsRel = "src/pages/DashboardSettings.tsx";
const hygieneRel = "scripts/check-repo-hygiene.mjs";

const settingsSource = read(settingsRel);
const eol = settingsSource.includes("\r\n") ? "\r\n" : "\n";
const lines = settingsSource.split(/\r?\n/);
const retiredRoutePattern = /<Route path="advanced(?:\/(?:bookings|catalog|users|contact))?"/;
const retiredRouteLines = lines.filter((line) => retiredRoutePattern.test(line));

if (retiredRouteLines.length !== 5) {
  throw new Error(`Expected exactly 5 retired settings advanced routes, found ${retiredRouteLines.length}.`);
}

const cleanedSettings = lines.filter((line) => !retiredRoutePattern.test(line)).join(eol);
write(settingsRel, cleanedSettings);

let hygieneSource = read(hygieneRel);
if (hygieneSource.includes("retiredSettingsRoutes")) {
  throw new Error("Repository hygiene already contains retired settings route guards.");
}

const marker = "function assertReadOnlyWorkflow(filename, label, forbiddenScriptPattern = null) {";
if (!hygieneSource.includes(marker)) {
  throw new Error("Could not locate repository hygiene insertion marker.");
}

const hygieneEol = hygieneSource.includes("\r\n") ? "\r\n" : "\n";
const guardBlock = [
  "const retiredSettingsRoutes = [",
  '  "advanced",',
  '  "advanced/bookings",',
  '  "advanced/catalog",',
  '  "advanced/users",',
  '  "advanced/contact",',
  "];",
  'const dashboardSettingsPath = path.join(root, "src", "pages", "DashboardSettings.tsx");',
  "if (fs.existsSync(dashboardSettingsPath)) {",
  '  const dashboardSettings = fs.readFileSync(dashboardSettingsPath, "utf8");',
  "  for (const route of retiredSettingsRoutes) {",
  '    if (dashboardSettings.includes(`path="${route}"`)) {',
  '      failures.push(`retired settings compatibility route must not return: ${route}`);',
  "    }",
  "  }",
  "}",
  "",
].join(hygieneEol);

hygieneSource = hygieneSource.replace(marker, `${guardBlock}${marker}`);
write(hygieneRel, hygieneSource);

const selfPath = fileURLToPath(import.meta.url);
fs.unlinkSync(selfPath);

console.log("Removed 5 retired /dashboard/settings/advanced* compatibility routes and added a repository-hygiene regression guard.");