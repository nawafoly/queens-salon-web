import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/apply-dashboard-action-feedback-system.mjs";
let source = readFileSync(path, "utf8");
source = source
  .replaceAll("${pick(language,", "\\${pick(language,")
  .replaceAll("${language ===", "\\${language ===");
writeFileSync(path, source, "utf8");
console.log("Escaped target-template expressions in dashboard feedback codemod.");
