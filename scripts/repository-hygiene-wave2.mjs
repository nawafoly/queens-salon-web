import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tempScript = "scripts/repository-hygiene-wave2.mjs";
const tempWorkflow = ".github/workflows/repository-hygiene-wave2.yml";
const archiveRoot = "docs/archive/repository-history";
const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function write(rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

const rootFiles = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name);

const deleteNames = new Set([
  "README.txt",
  "README-APPLY.txt",
  "README-AR.txt",
  "todo.md",
  "DEPLOY_TRIGGER.txt",
  "DEPLOY-TRIGGER.md",
  "TODO-CORE-TODAY.md",
].filter((name) => rootFiles.includes(name)));

const keepRootReadmes = new Set(["README.md", "README-HR-APP.md"]);
const archiveNames = new Set();
for (const name of rootFiles) {
  if (/^PHASE.*\.(?:md|txt)$/i.test(name)) archiveNames.add(name);
  if (/^VERIFICATION.*\.(?:md|txt)$/i.test(name)) archiveNames.add(name);
  if (/^(?:AIDA|ATTENDANCE).*README.*\.(?:md|txt)$/i.test(name)) archiveNames.add(name);
  if (/^README[-_].*\.(?:md|txt)$/i.test(name) && !keepRootReadmes.has(name) && !deleteNames.has(name)) archiveNames.add(name);
}

const candidates = new Set([...deleteNames, ...archiveNames]);
const scanRoots = [
  "src", "scripts", "workers", "functions", "server", "api", ".github",
  "android", "android-hr", "migrations", "public", "docs",
];
const rootScanFiles = [
  "README.md", "README-HR-APP.md", "AGENTS.md", "PROJECT_RULES.md",
  "package.json", "vite.config.ts", "capacitor.config.ts", "firebase.json",
  "vercel.json", "wrangler.core.jsonc", "wrangler.packages.jsonc", "wrangler.partners.jsonc",
].filter(exists);

const ignoredDirs = new Set([".git", "node_modules", "dist", "dist-staff", "build", ".wrangler", "archive"]);
function walk(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const child = path.posix.join(rel.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}

const textFiles = [...scanRoots.flatMap(walk), ...rootScanFiles]
  .filter((rel) => rel !== tempScript && rel !== tempWorkflow)
  .filter((rel) => /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md|txt|css|scss|html|ps1|sh|sql|xml|gradle|properties)$/i.test(rel) || rel === "package.json");

const failures = [];
for (const candidate of candidates) {
  for (const rel of textFiles) {
    let text = "";
    try { text = read(rel); } catch { continue; }
    if (text.includes(candidate)) {
      failures.push(`${candidate} is referenced by non-archived file ${rel}`);
    }
  }
}
if (failures.length) {
  console.error("Repository hygiene wave 2 refused to move/delete referenced root documents:\n");
  [...new Set(failures)].forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

fs.mkdirSync(path.join(root, archiveRoot), { recursive: true });
const archiveIndexRows = [];
for (const name of [...archiveNames].sort()) {
  const source = path.join(root, name);
  if (!fs.existsSync(source)) continue;
  const raw = fs.readFileSync(source, "utf8").replace(/^\uFEFF/, "");
  const markdown = /\.md$/i.test(name);
  const banner = markdown
    ? "> **ARCHIVED — Historical repository note. This is not an operational instruction or current source of truth.**\n\n"
    : "ARCHIVED — Historical repository note. This is not an operational instruction or current source of truth.\n\n";
  const targetRel = path.posix.join(archiveRoot, name);
  write(targetRel, banner + raw);
  fs.rmSync(source, { force: true });
  archiveIndexRows.push(`- \`${name}\``);
  console.log(`archived root document: ${name}`);
}

for (const name of [...deleteNames].sort()) {
  const source = path.join(root, name);
  if (!fs.existsSync(source)) continue;
  fs.rmSync(source, { force: true });
  console.log(`deleted obsolete root instruction/trigger: ${name}`);
}

const archiveReadme = `# Repository History Archive\n\nThis directory contains historical migration, repair, patch, and verification notes moved out of the repository root.\n\n**These files are not operational instructions and are not sources of runtime truth.** Current authority is the source code, permanent checks/tests, GitHub Actions acceptance gates, and the current architecture documents in \`docs/\`.\n\n## Archived in Wave 2\n${archiveIndexRows.length ? archiveIndexRows.join("\n") : "- No files were moved in this run."}\n`;
write(path.posix.join(archiveRoot, "README.md"), archiveReadme);

const guardPath = "scripts/check-repo-hygiene.mjs";
let guard = read(guardPath);
const marker = 'console.log("Repository hygiene guard passed. No root patch/apply/hotfix artifacts or backup junk found.");';
if (!guard.includes("root historical phase/verification document is forbidden")) {
  const insertion = `\nfor (const entry of rootEntries) {\n  if (!entry.isFile()) continue;\n  const name = entry.name;\n  if (/^(?:PHASE|VERIFICATION).*\\.(?:md|txt)$/i.test(name)) {\n    failures.push(\`root historical phase/verification document is forbidden: \${name}; move history to docs/archive/repository-history/\`);\n  }\n  if (/^README[-_].*\\.(?:md|txt)$/i.test(name) && !["README-HR-APP.md"].includes(name)) {\n    failures.push(\`specialized root README is forbidden: \${name}; use docs/ or docs/archive/\`);\n  }\n  if (/^(?:AIDA|ATTENDANCE).*README.*\\.(?:md|txt)$/i.test(name)) {\n    failures.push(\`historical root fix README is forbidden: \${name}\`);\n  }\n  if (["README.txt", "README-APPLY.txt", "README-AR.txt", "todo.md", "DEPLOY_TRIGGER.txt", "DEPLOY-TRIGGER.md", "TODO-CORE-TODAY.md"].includes(name)) {\n    failures.push(\`obsolete root instruction/trigger is forbidden: \${name}\`);\n  }\n}\n\n`;
  guard = guard.replace(marker, insertion + marker);
  write(guardPath, guard);
}

console.log(`Wave 2 archived ${archiveNames.size} historical root documents and deleted ${deleteNames.size} obsolete trigger/instruction files.`);
