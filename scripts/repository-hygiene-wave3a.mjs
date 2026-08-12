import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, content) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
};
const exists = (rel) => fs.existsSync(path.join(root, rel));

const retiredWorkflows = [
  ".github/workflows/admin-partial-leave-cutover.yml",
  ".github/workflows/apply-dashboard-v2-style-regression-fix.yml",
  ".github/workflows/finalize-booking-cutover.yml",
  ".github/workflows/partial-leave-attendance-ui.yml",
  ".github/workflows/customer-booking-promotion.yml",
];

const candidateMutationScripts = [
  "scripts/add-admin-partial-leave.mjs",
  "scripts/fix-admin-partial-leave-employeehub-normalization.mjs",
  "scripts/fix-core-partial-leave-persistence.mjs",
  "scripts/fix-admin-partial-leave-test-harness.mjs",
  "scripts/fix-admin-partial-leave-dashboard-assertion.mjs",
  "scripts/add-partial-leave-attendance-ui.mjs",
  "scripts/fix-dashboard-v2-style-regressions.mjs",
  "scripts/repair-frontend-core-migration-test.mjs",
  "scripts/finalize-booking-runtime-cutover.mjs",
  "scripts/fix-internal-v2-client-binding.mjs",
  "scripts/fix-frontend-cutover-test-contracts.mjs",
  "scripts/fix-frontend-permission-context-test.mjs",
  "scripts/fix-hr-test-migration-runner.mjs",
  "scripts/cutover-booking-internal-v2-core-hr.mjs",
  "scripts/cutover-booking-customer-core-hr-stage1.mjs",
  "scripts/cutover-booking-customer-core-hr-stage2.mjs",
].filter(exists);

for (const workflow of retiredWorkflows) {
  if (exists(workflow)) {
    fs.rmSync(path.join(root, workflow), { force: true });
    console.log(`removed retired mutation workflow: ${workflow}`);
  }
}

const bookingRuntimeWorkflow = ".github/workflows/booking-runtime-cutover.yml";
if (!exists(bookingRuntimeWorkflow)) throw new Error(`${bookingRuntimeWorkflow} missing`);
write(bookingRuntimeWorkflow, `name: Booking Runtime Core HR Guard\n\non:\n  push:\n    branches: [main]\n    paths:\n      - "src/pages/Booking.tsx"\n      - "src/pages/Checkout.tsx"\n      - "src/features/internal-booking-v2/**"\n      - "src/helpers/coreBookingAvailability.ts"\n      - "src/helpers/staffAvailability.ts"\n      - "src/helpers/timeSlots.ts"\n      - "src/helpers/bookingSharedConstants.ts"\n      - "src/services/bookingDataSource.ts"\n      - "src/services/bookingDataSourceCompat.ts"\n      - "src/services/bookingDataSources/**"\n      - "src/services/coreBookableStaffService.ts"\n      - "src/services/checkoutCoreBookingService.ts"\n      - "src/services/coreBookingMappers.ts"\n      - "src/services/firestoreBookings.ts"\n      - "src/types/coreApi.ts"\n      - "workers/core/**"\n      - "workers/core-worker.test.mjs"\n      - "workers/hr-core-worker.test.mjs"\n      - "workers/frontend-core-migration.test.mjs"\n      - "scripts/audit-legacy-booking-runtime.mjs"\n      - "scripts/check-no-legacy-booking-runtime.mjs"\n      - ".github/workflows/booking-runtime-cutover.yml"\n  workflow_dispatch:\n\npermissions:\n  contents: read\n\njobs:\n  verify-booking-core-hr:\n    runs-on: ubuntu-latest\n    timeout-minutes: 20\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v4\n        with:\n          fetch-depth: 2\n\n      - name: Setup Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: 22\n          cache: npm\n\n      - name: Install dependencies\n        run: npm ci\n\n      - name: Repository-wide legacy booking audit\n        run: node scripts/audit-legacy-booking-runtime.mjs --fail-on-high-risk\n\n      - name: No-legacy booking architecture guard\n        run: node scripts/check-no-legacy-booking-runtime.mjs\n\n      - name: Internal booking behavior contract\n        run: npm run check:booking-internal-contract\n\n      - name: Build\n        run: npm run build\n\n      - name: Core worker tests\n        run: npm run test:core:worker\n\n      - name: HR schedule and leave worker tests\n        run: npm run test:hr:worker\n\n      - name: Frontend Core migration tests\n        run: npm run test:frontend:core\n\n      - name: Diff whitespace check\n        run: git diff --check HEAD~1 HEAD\n`);
console.log("converted booking-runtime-cutover.yml to read-only permanent guard");

const ignoredDirs = new Set([".git", "node_modules", "dist", "dist-staff", "build", ".wrangler", "archive"]);
function walk(rel = "") {
  const abs = path.join(root, rel);
  const rows = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const child = path.posix.join(rel.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) rows.push(...walk(child));
    else rows.push(child);
  }
  return rows;
}

const thisScript = "scripts/repository-hygiene-wave3a.mjs";
const thisWorkflow = ".github/workflows/repository-hygiene-wave3a.yml";
const textFiles = walk()
  .filter((rel) => rel !== thisScript && rel !== thisWorkflow)
  .filter((rel) => !rel.startsWith("docs/archive/"))
  .filter((rel) => /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md|txt|css|scss|html|ps1|sh|sql|xml|gradle|properties)$/i.test(rel) || rel === "package.json");

const removedScripts = [];
const keptScripts = [];
for (const script of candidateMutationScripts) {
  const basename = path.posix.basename(script);
  const references = [];
  for (const rel of textFiles) {
    if (rel === script) continue;
    let text = "";
    try { text = read(rel); } catch { continue; }
    if (text.includes(script) || text.includes(basename)) references.push(rel);
  }
  if (references.length) {
    keptScripts.push({ script, references: [...new Set(references)] });
    console.log(`kept referenced mutation-looking script: ${script} <- ${[...new Set(references)].join(", ")}`);
    continue;
  }
  fs.rmSync(path.join(root, script), { force: true });
  removedScripts.push(script);
  console.log(`removed unreferenced one-time mutation script: ${script}`);
}

const guardPath = "scripts/check-repo-hygiene.mjs";
let guard = read(guardPath);
const guardMarker = 'console.log("Repository hygiene guard passed. No root patch/apply/hotfix artifacts or backup junk found.");';
if (!guard.includes("retiredMutationWorkflows")) {
  const workflowBaseNames = retiredWorkflows.map((item) => path.posix.basename(item));
  const retiredScriptBaseNames = removedScripts.map((item) => path.posix.basename(item));
  const insertion = `\nconst retiredMutationWorkflows = ${JSON.stringify(workflowBaseNames, null, 2)};\nfor (const name of retiredMutationWorkflows) {\n  if (fs.existsSync(path.join(root, ".github", "workflows", name))) failures.push(\`retired mutation workflow must not return: \${name}\`);\n}\nconst retiredOneTimeScripts = ${JSON.stringify(retiredScriptBaseNames, null, 2)};\nfor (const name of retiredOneTimeScripts) {\n  if (fs.existsSync(path.join(root, "scripts", name))) failures.push(\`retired one-time mutation script must not return: \${name}\`);\n}\nconst bookingGuardWorkflowPath = path.join(root, ".github", "workflows", "booking-runtime-cutover.yml");\nif (fs.existsSync(bookingGuardWorkflowPath)) {\n  const bookingGuardWorkflow = fs.readFileSync(bookingGuardWorkflowPath, "utf8");\n  if (/contents:\\s*write/.test(bookingGuardWorkflow)) failures.push("booking runtime guard must remain read-only");\n  if (/git\\s+push/.test(bookingGuardWorkflow)) failures.push("booking runtime guard must never push code");\n  if (/scripts\\/cutover-booking-/.test(bookingGuardWorkflow)) failures.push("booking runtime guard must not apply historical cutover scripts");\n}\n\n`;
  guard = guard.replace(guardMarker, insertion + guardMarker);
  write(guardPath, guard);
}

console.log(`Wave 3A removed ${retiredWorkflows.filter((item) => !exists(item)).length} retired workflows and ${removedScripts.length} unreferenced mutation scripts.`);
if (keptScripts.length) {
  console.log("Referenced candidates intentionally kept:");
  for (const row of keptScripts) console.log(`- ${row.script}: ${row.references.join(", ")}`);
}
