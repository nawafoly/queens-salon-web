import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tempScript = "scripts/repository-hygiene-wave1.mjs";
const tempWorkflow = ".github/workflows/repository-hygiene-wave1.yml";

const exists = (rel) => fs.existsSync(path.join(root, rel));
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const write = (rel, content) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
};

function walk(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  const rows = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "dist-staff", "build", ".wrangler"].includes(entry.name)) continue;
    const child = path.posix.join(rel.replaceAll("\\", "/"), entry.name);
    if (entry.isDirectory()) rows.push(...walk(child));
    else rows.push(child);
  }
  return rows;
}

function looksText(rel) {
  return /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md|txt|css|scss|html|ps1|sh|sql|xml|gradle|properties)$/i.test(rel) ||
    ["package.json", "vercel.json", "firebase.json", "vite.config.ts", "capacitor.config.ts"].includes(rel);
}

const rootEntries = fs.readdirSync(root, { withFileTypes: true });
const rootFiles = rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);

const candidates = new Set(
  rootFiles.filter((name) =>
    /-PATCH-FILES\.txt$/i.test(name) ||
    /^apply-.*\.ps1$/i.test(name) ||
    /\.patch$/i.test(name) ||
    (/\.css$/i.test(name) && /(hotfix|redesign)/i.test(name))
  )
);

const candidateDirs = ["patch-files"].filter(exists);

const operationalRoots = [
  "src",
  "scripts",
  "workers",
  "functions",
  "server",
  "api",
  ".github",
  "android",
  "android-hr",
  "migrations",
  "public",
];
const operationalRootFiles = [
  "package.json",
  "vite.config.ts",
  "capacitor.config.ts",
  "firebase.json",
  "vercel.json",
  "wrangler.core.jsonc",
  "wrangler.packages.jsonc",
  "wrangler.partners.jsonc",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
].filter(exists);

const operationalFiles = [
  ...operationalRoots.flatMap(walk),
  ...operationalRootFiles,
]
  .filter(looksText)
  .filter((rel) => rel !== tempScript && rel !== tempWorkflow);

const failures = [];
for (const candidate of candidates) {
  const needles = [candidate, `./${candidate}`, `../${candidate}`];
  for (const rel of operationalFiles) {
    let text = "";
    try { text = read(rel); } catch { continue; }
    if (needles.some((needle) => text.includes(needle))) {
      failures.push(`${candidate} is still referenced by operational file ${rel}`);
    }
  }
}

for (const dir of candidateDirs) {
  for (const rel of operationalFiles) {
    let text = "";
    try { text = read(rel); } catch { continue; }
    if (text.includes(`${dir}/`) || text.includes(`${dir}\\`)) {
      failures.push(`${dir}/ is still referenced by operational file ${rel}`);
    }
  }
}

if (failures.length) {
  console.error("Repository hygiene wave 1 refused to delete referenced artifacts:\n");
  for (const failure of [...new Set(failures)]) console.error(`- ${failure}`);
  process.exit(1);
}

for (const candidate of [...candidates].sort()) {
  fs.rmSync(path.join(root, candidate), { force: true });
  console.log(`removed root artifact: ${candidate}`);
}
for (const dir of candidateDirs) {
  fs.rmSync(path.join(root, dir), { recursive: true, force: true });
  console.log(`removed artifact directory: ${dir}/`);
}

const guard = `import fs from "node:fs";\nimport path from "node:path";\n\nconst root = process.cwd();\nconst failures = [];\n\nconst rootEntries = fs.readdirSync(root, { withFileTypes: true });\nfor (const entry of rootEntries) {\n  if (!entry.isFile()) continue;\n  const name = entry.name;\n  if (/-PATCH-FILES\\.txt$/i.test(name)) failures.push(\`root patch manifest is forbidden: \${name}\`);\n  if (/^apply-.*\\.ps1$/i.test(name)) failures.push(\`root one-time apply script is forbidden: \${name}\`);\n  if (/\\.patch$/i.test(name)) failures.push(\`root patch bundle is forbidden: \${name}\`);\n  if (/\\.css$/i.test(name) && /(hotfix|redesign)/i.test(name)) failures.push(\`root hotfix/redesign CSS is forbidden: \${name}\`);\n}\n\nif (fs.existsSync(path.join(root, "patch-files"))) {\n  failures.push("patch-files/ is forbidden; runtime source belongs in src/ and history belongs in docs/archive/");\n}\n\nconst ignoredDirs = new Set([".git", "node_modules", "dist", "dist-staff", "build", ".wrangler"]);\nfunction walk(dir) {\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;\n    const abs = path.join(dir, entry.name);\n    if (entry.isDirectory()) { walk(abs); continue; }\n    const rel = path.relative(root, abs).replaceAll("\\\\", "/");\n    if (/\\.(?:bak|old|orig|rej|tmp)$/i.test(entry.name) || entry.name.endsWith("~")) {\n      failures.push(\`backup/junk file is forbidden: \${rel}\`);\n    }\n  }\n}\nwalk(root);\n\nif (failures.length) {\n  console.error(\`Repository hygiene guard FAILED (\${failures.length}):\\n\`);\n  failures.forEach((failure) => console.error(\`- \${failure}\`));\n  process.exit(1);\n}\n\nconsole.log("Repository hygiene guard passed. No root patch/apply/hotfix artifacts or backup junk found.");\n`;
write("scripts/check-repo-hygiene.mjs", guard);

const packagePath = "package.json";
const pkg = JSON.parse(read(packagePath));
pkg.scripts ||= {};
pkg.scripts["check:repo-hygiene"] = "node scripts/check-repo-hygiene.mjs";
write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Wave 1 removed ${candidates.size} root artifacts and ${candidateDirs.length} artifact director${candidateDirs.length === 1 ? "y" : "ies"}.`);
console.log("Installed permanent scripts/check-repo-hygiene.mjs guard and npm check:repo-hygiene command.");
