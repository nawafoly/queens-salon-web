import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/apply-dashboard-action-feedback-system.mjs";
let source = readFileSync(path, "utf8");
const startMarker = "// 5) Employee portal: partial success must still explain the attachment failure in-app.";
const endMarker = "// 6) Employee workspace: blocked booking visibility explains itself next to the control.";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start >= 0 && end > start) {
  source = source.slice(0, start) + source.slice(end);
}
writeFileSync(path, source, "utf8");
console.log("Removed EmployeeRequests transformation from the shared codemod; it runs in its own guarded script.");
