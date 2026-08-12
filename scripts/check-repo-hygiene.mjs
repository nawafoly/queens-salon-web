import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

const rootEntries = fs.readdirSync(root, { withFileTypes: true });
for (const entry of rootEntries) {
  if (!entry.isFile()) continue;
  const name = entry.name;
  if (/-PATCH-FILES\.txt$/i.test(name)) failures.push(`root patch manifest is forbidden: ${name}`);
  if (/^apply-.*\.ps1$/i.test(name)) failures.push(`root one-time apply script is forbidden: ${name}`);
  if (/\.patch$/i.test(name)) failures.push(`root patch bundle is forbidden: ${name}`);
  if (/\.css$/i.test(name) && /(hotfix|redesign)/i.test(name)) failures.push(`root hotfix/redesign CSS is forbidden: ${name}`);
}

if (fs.existsSync(path.join(root, "patch-files"))) {
  failures.push("patch-files/ is forbidden; runtime source belongs in src/ and history belongs in docs/archive/");
}

const ignoredDirs = new Set([".git", "node_modules", "dist", "dist-staff", "build", ".wrangler"]);
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(abs); continue; }
    const rel = path.relative(root, abs).replaceAll("\\", "/");
    if (/\.(?:bak|old|orig|rej|tmp)$/i.test(entry.name) || entry.name.endsWith("~")) {
      failures.push(`backup/junk file is forbidden: ${rel}`);
    }
  }
}
walk(root);

if (failures.length) {
  console.error(`Repository hygiene guard FAILED (${failures.length}):\n`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}


for (const entry of rootEntries) {
  if (!entry.isFile()) continue;
  const name = entry.name;
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

console.log("Repository hygiene guard passed. No root patch/apply/hotfix artifacts or backup junk found.");
