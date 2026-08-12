import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const exists = (...parts) => fs.existsSync(path.join(root, ...parts));

const rootEntries = fs.readdirSync(root, { withFileTypes: true });
for (const entry of rootEntries) {
  if (!entry.isFile()) continue;
  const name = entry.name;

  if (/-PATCH-FILES\.txt$/i.test(name)) failures.push(`root patch manifest is forbidden: ${name}`);
  if (/^apply-.*\.ps1$/i.test(name)) failures.push(`root one-time apply script is forbidden: ${name}`);
  if (/\.patch$/i.test(name)) failures.push(`root patch bundle is forbidden: ${name}`);
  if (/\.css$/i.test(name) && /(hotfix|redesign)/i.test(name)) failures.push(`root hotfix/redesign CSS is forbidden: ${name}`);

  if (/^(?:PHASE|VERIFICATION).*\.(?:md|txt)$/i.test(name)) {
    failures.push(`root historical phase/verification document is forbidden: ${name}; move history to docs/archive/repository-history/`);
  }
  if (/^README[-_].*\.(?:md|txt)$/i.test(name) && !["README-HR-APP.md"].includes(name)) {
    failures.push(`specialized root README is forbidden: ${name}; use docs/ or docs/archive/`);
  }
  if (/^(?:AIDA|ATTENDANCE).*README.*\.(?:md|txt)$/i.test(name)) {
    failures.push(`historical root fix README is forbidden: ${name}`);
  }
  if (["README.txt", "README-APPLY.txt", "README-AR.txt", "todo.md", "DEPLOY_TRIGGER.txt", "DEPLOY-TRIGGER.md", "TODO-CORE-TODAY.md"].includes(name)) {
    failures.push(`obsolete root instruction/trigger is forbidden: ${name}`);
  }
}

if (exists("patch-files")) {
  failures.push("patch-files/ is forbidden; runtime source belongs in src/ and history belongs in docs/archive/");
}

const ignoredDirs = new Set([".git", "node_modules", "dist", "dist-staff", "build", ".wrangler"]);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs);
      continue;
    }
    const rel = path.relative(root, abs).replaceAll("\\", "/");
    if (/\.(?:bak|old|orig|rej|tmp)$/i.test(entry.name) || entry.name.endsWith("~")) {
      failures.push(`backup/junk file is forbidden: ${rel}`);
    }
  }
}
walk(root);

const retiredMutationWorkflows = [
  "admin-partial-leave-cutover.yml",
  "apply-dashboard-v2-style-regression-fix.yml",
  "finalize-booking-cutover.yml",
  "partial-leave-attendance-ui.yml",
  "customer-booking-promotion.yml",
  "refine-leave-permission-ui.yml",
];
for (const name of retiredMutationWorkflows) {
  if (exists(".github", "workflows", name)) failures.push(`retired mutation workflow must not return: ${name}`);
}

const retiredOneTimeScripts = [
  "add-admin-partial-leave.mjs",
  "fix-admin-partial-leave-employeehub-normalization.mjs",
  "fix-core-partial-leave-persistence.mjs",
  "fix-admin-partial-leave-test-harness.mjs",
  "fix-admin-partial-leave-dashboard-assertion.mjs",
  "add-partial-leave-attendance-ui.mjs",
  "repair-frontend-core-migration-test.mjs",
  "finalize-booking-runtime-cutover.mjs",
  "fix-internal-v2-client-binding.mjs",
  "fix-frontend-cutover-test-contracts.mjs",
  "fix-frontend-permission-context-test.mjs",
  "fix-hr-test-migration-runner.mjs",
  "cutover-booking-internal-v2-core-hr.mjs",
  "cutover-booking-customer-core-hr-stage1.mjs",
  "refine-leave-permission-ui.mjs",
  "unify-permission-booking.mjs",
  "unify-permission-booking-v2.mjs",
];
for (const name of retiredOneTimeScripts) {
  if (exists("scripts", name)) failures.push(`retired one-time mutation script must not return: ${name}`);
}

const bookingGuardWorkflowPath = path.join(root, ".github", "workflows", "booking-runtime-cutover.yml");
if (fs.existsSync(bookingGuardWorkflowPath)) {
  const workflow = fs.readFileSync(bookingGuardWorkflowPath, "utf8");
  if (/contents:\s*write/.test(workflow)) failures.push("booking runtime guard must remain read-only");
  if (/git\s+push/.test(workflow)) failures.push("booking runtime guard must never push code");
  if (/scripts\/cutover-booking-/.test(workflow)) failures.push("booking runtime guard must not apply historical cutover scripts");
}

const permissionGuardWorkflowPath = path.join(root, ".github", "workflows", "unify-permission-booking.yml");
if (fs.existsSync(permissionGuardWorkflowPath)) {
  const workflow = fs.readFileSync(permissionGuardWorkflowPath, "utf8");
  if (/contents:\s*write/.test(workflow)) failures.push("permission booking contract must remain read-only");
  if (/git\s+push/.test(workflow)) failures.push("permission booking contract must never push code");
  if (/scripts\/(?:refine-leave-permission-ui|unify-permission-booking(?:-v2)?)\.mjs/.test(workflow)) {
    failures.push("permission booking contract must not apply retired mutation scripts");
  }
} else {
  failures.push("permanent permission booking contract workflow is missing");
}

if (failures.length) {
  console.error(`Repository hygiene guard FAILED (${failures.length}):\n`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Repository hygiene guard passed. Root artifacts, retired mutation tooling, and permanent read-only workflow contracts are clean.");
