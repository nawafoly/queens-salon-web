import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function write(rel, value) {
  fs.writeFileSync(path.join(root, rel), value, "utf8");
}

function replaceRequired(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Missing expected patch anchor: ${label}`);
  }
  return source.replace(search, replacement);
}

function removeMarkedBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) return source;
  const endStart = source.indexOf(endMarker, start);
  if (endStart < 0) throw new Error(`Missing end marker for ${startMarker}`);
  const end = endStart + endMarker.length;
  return `${source.slice(0, start)}${source.slice(end)}`;
}

function hexToFunctionalCss(source) {
  return source.replace(/#([0-9a-fA-F]{3,8})\b/g, (_match, raw) => {
    let hex = raw;
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map((char) => char + char).join("");
    }
    if (hex.length !== 6 && hex.length !== 8) return _match;
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (hex.length === 6) return `rgb(${r}, ${g}, ${b})`;
    const alpha = Number.parseInt(hex.slice(6, 8), 16) / 255;
    const compactAlpha = Number(alpha.toFixed(3));
    return `rgba(${r}, ${g}, ${b}, ${compactAlpha})`;
  });
}

// 1) Employees: remove three historical sidebar-scrollbar override blocks.
{
  const rel = "src/styles/dashboard-v2/pages/employees.css";
  let source = read(rel);
  source = removeMarkedBlock(source, "/* EMPLOYEES_HIDE_SIDEBAR_SCROLLBAR_V3 */", "/* END_EMPLOYEES_HIDE_SIDEBAR_SCROLLBAR_V3 */");
  source = removeMarkedBlock(source, "/* EMPLOYEES_SIDEBAR_SCROLLBAR_FINAL */", "/* END_EMPLOYEES_SIDEBAR_SCROLLBAR_FINAL */");
  source = removeMarkedBlock(source, "/* EMPLOYEES_SIDEBAR_SCROLLBAR_FINAL_V2 */", "/* END_EMPLOYEES_SIDEBAR_SCROLLBAR_FINAL_V2 */");
  source = source.replace(/\s*!important\b/g, "");
  write(rel, source);
}

// 2) Expenses: the shell-wide DashboardScrollContract owns vertical scrolling.
{
  const rel = "src/styles/dashboard-v2/pages/expenses.css";
  let source = read(rel);
  const marker = "/* EXPENSES PAGE SCROLL FIX */";
  const index = source.indexOf(marker);
  if (index >= 0) source = source.slice(0, index).trimEnd() + "\n";
  source = source.replace(/\s*!important\b/g, "");
  write(rel, source);
}

// 3) Bookings: preserve exact colors as rgb/rgba and remove specificity escapes.
{
  const rel = "src/styles/dashboard-v2/pages/bookings.css";
  let source = read(rel);
  source = source.replace(/\s*!important\b/g, "");
  source = hexToFunctionalCss(source);
  write(rel, source);
}

// 4) Component CSS must be loaded by the single Dashboard V2 entry point.
{
  const rel = "src/components/EmployeeNotificationBellMenu.tsx";
  let source = read(rel);
  source = source.replace('import "../styles/dashboard-v2/pages/employee-notification-menu.css";\n', "");
  write(rel, source);
}

{
  const rel = "src/components/dashboard-v2/employee-workspace/live/EmployeeAttendanceCalendarAlignedLiveV2.tsx";
  let source = read(rel);
  source = source.replace('import "../../../../styles/dashboard-v2/pages/employee-attendance-calendar-alignment.css";\n', "");
  write(rel, source);
}

{
  const rel = "src/styles/dashboard-v2/dashboard-v2.css";
  let source = read(rel);
  if (!source.includes('@import "./pages/employee-attendance-calendar-alignment.css";')) {
    source = replaceRequired(
      source,
      '@import "./pages/employee-workspace.css";\n',
      '@import "./pages/employee-workspace.css";\n@import "./pages/employee-attendance-calendar-alignment.css";\n',
      "dashboard entry employee workspace import",
    );
  }
  if (!source.includes('@import "./pages/employee-notification-menu.css";')) {
    source = replaceRequired(
      source,
      '@import "./pages/employee-portal-overview-micro-fixes.css";\n',
      '@import "./pages/employee-portal-overview-micro-fixes.css";\n@import "./pages/employee-notification-menu.css";\n',
      "dashboard entry employee portal import",
    );
  }
  write(rel, source);
}

// 5) DashboardBookings: keep floating UI dynamic without JSX inline style objects.
{
  const rel = "src/pages/DashboardBookings.tsx";
  let source = read(rel);

  const selectAnchor = `  const panelRef = useRef<HTMLDivElement>(null);\n\n  const listboxIdRef = useRef(`;
  const selectReplacement = `  const panelRef = useRef<HTMLDivElement>(null);\n\n  useEffect(() => {\n    if (!open) return;\n    const panel = panelRef.current;\n    if (!panel) return;\n    panel.style.top = \`${'${panelStyle.top}'}px\`;\n    panel.style.left = \`${'${panelStyle.left}'}px\`;\n    panel.style.width = \`${'${panelStyle.width}'}px\`;\n    panel.style.maxHeight = \`${'${panelStyle.maxHeight}'}px\`;\n  }, [open, panelStyle.left, panelStyle.maxHeight, panelStyle.top, panelStyle.width]);\n\n  const listboxIdRef = useRef(`;
  if (!source.includes("panel.style.maxHeight")) {
    source = replaceRequired(source, selectAnchor, selectReplacement, "booking custom select floating style effect");
  }

  source = source.replace(
`            style={{\n              top: panelStyle.top,\n              left: panelStyle.left,\n              width: panelStyle.width,\n              maxHeight: panelStyle.maxHeight,\n            }}\n`,
"",
  );

  const calendarAnchor = `  const [calendarPosition, setCalendarPosition] = useState({\n    top: 0,\n    left: 0,\n    width: 330,\n  });\n`;
  const calendarReplacement = `${calendarAnchor}\n  useEffect(() => {\n    if (!calendarOpen) return;\n    const panel = datePanelRef.current;\n    if (!panel) return;\n    panel.style.top = \`${'${calendarPosition.top}'}px\`;\n    panel.style.left = \`${'${calendarPosition.left}'}px\`;\n    panel.style.width = \`${'${calendarPosition.width}'}px\`;\n  }, [calendarOpen, calendarPosition.left, calendarPosition.top, calendarPosition.width]);\n`;
  if (!source.includes("panel.style.width = `${calendarPosition.width}px`")) {
    source = replaceRequired(source, calendarAnchor, calendarReplacement, "booking calendar floating style effect");
  }

  source = source.replace(
`            style={{\n              top: calendarPosition.top,\n              left: calendarPosition.left,\n              width: calendarPosition.width,\n            }}\n`,
"",
  );

  write(rel, source);
}

console.log("Dashboard V2 style regressions patched.");
