import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const mode = String(process.argv[2] || "").trim().toLowerCase();

function fail(message) {
  console.error(`\n[work-sync] ERROR: ${message}\n`);
  process.exit(1);
}

function command(name) {
  if (name === "npm" && process.platform === "win32") return "npm.cmd";
  return name;
}

function run(name, args, options = {}) {
  console.log(`\n> ${name} ${args.join(" ")}`);
  const result = spawnSync(command(name), args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...options,
  });

  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(`${name} exited with code ${result.status}`);
  }
}

function capture(name, args) {
  const result = spawnSync(command(name), args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });

  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(
      String(result.stderr || result.stdout || `${name} failed`).trim()
    );
  }

  return String(result.stdout || "").trim();
}

function runNpm(args) {
  const npmCli = process.env.npm_execpath;

  if (npmCli) {
    run(process.execPath, [npmCli, ...args]);
    return;
  }

  run("npm", args, {
    shell: process.platform === "win32",
  });
}

function currentBranch() {
  return capture("git", ["branch", "--show-current"]);
}

function divergence(left = "HEAD", right = "origin/main") {
  const raw = capture("git", [
    "rev-list",
    "--left-right",
    "--count",
    `${left}...${right}`,
  ]);

  const [aheadRaw, behindRaw] = raw.split(/\s+/);
  return {
    ahead: Number(aheadRaw || 0),
    behind: Number(behindRaw || 0),
  };
}

function ensureGitRepository() {
  const inside = capture("git", ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") fail("Current directory is not a Git repository.");
}

function workingTreeStatus() {
  return capture("git", ["status", "--porcelain"]);
}

function packageLockHash() {
  const file = path.join(root, "package-lock.json");
  if (!fs.existsSync(file)) return "";
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function syncDependenciesIfNeeded() {
  const statePath = path.join(root, ".work-sync-state.json");
  const nodeModulesPath = path.join(root, "node_modules");
  const currentHash = packageLockHash();

  let previousHash = "";
  try {
    previousHash = JSON.parse(
      fs.readFileSync(statePath, "utf8")
    ).packageLockSha256 || "";
  } catch {}

  if (
    !fs.existsSync(nodeModulesPath) ||
    !currentHash ||
    currentHash !== previousHash
  ) {
    console.log("\n[work-sync] Dependencies need synchronization.");
    runNpm(["ci"]);

    fs.writeFileSync(
      statePath,
      JSON.stringify(
        {
          packageLockSha256: currentHash,
          syncedAt: new Date().toISOString(),
        },
        null,
        2
      ) + "\n",
      "utf8"
    );
  } else {
    console.log("\n[work-sync] Dependencies already synchronized.");
  }
}

function stagedFiles() {
  const output = capture("git", [
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
  ]);

  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function guardLocalOnlyFiles(files) {
  const forbiddenExact = new Set([
    "scripts/habat-native-login-test.json",
    "wrangler.core.dev.jsonc",
    "wrangler.partners.dev.jsonc",
    ".work-sync-state.json",
  ]);

  const bad = files.filter(
    (file) =>
      forbiddenExact.has(file.replaceAll("\\", "/")) ||
      file.startsWith(".wrangler/") ||
      file.startsWith(".vercel/")
  );

  if (bad.length) {
    fail(
      `Local-only files were staged:\n${bad
        .map((file) => `- ${file}`)
        .join("\n")}`
    );
  }
}

function guardSecrets(files) {
  const strongSecretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];

  const structuredSecretPattern =
    /["']?(?:password|passwd|secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["'][^"'\r\n]{8,}["']/i;

  const structuredExtensions = new Set([
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".toml",
    ".env",
    ".txt",
  ]);

  const failures = [];

  for (const relative of files) {
    if (relative === "package-lock.json") continue;

    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) continue;

    let content;
    try {
      content = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }

    if (strongSecretPatterns.some((pattern) => pattern.test(content))) {
      failures.push(`${relative}: token/private-key pattern`);
      continue;
    }

    const extension = path.extname(relative).toLowerCase();
    if (
      structuredExtensions.has(extension) &&
      structuredSecretPattern.test(content)
    ) {
      failures.push(`${relative}: credential-like value`);
    }
  }

  if (failures.length) {
    fail(
      `Possible secrets detected. Nothing was committed:\n${failures
        .map((item) => `- ${item}`)
        .join("\n")}`
    );
  }
}

function startSession() {
  ensureGitRepository();

  const dirty = workingTreeStatus();
  if (dirty) {
    fail(
      `Working tree is not clean. Finish or discard the current work first:\n${dirty}`
    );
  }

  run("git", ["fetch", "origin"]);

  if (currentBranch() !== "main") {
    run("git", ["switch", "main"]);
  }

  const state = divergence("main", "origin/main");

  if (state.ahead > 0) {
    fail(
      `Local main contains ${state.ahead} unpushed commit(s). Push them before starting on another machine.`
    );
  }

  run("git", ["pull", "--ff-only", "origin", "main"]);
  syncDependenciesIfNeeded();

  console.log("\n[work-sync] READY");
  console.log(`Branch: ${currentBranch()}`);
  console.log(`HEAD:   ${capture("git", ["log", "-1", "--oneline"])}`);
}

function finishSession() {
  ensureGitRepository();

  if (currentBranch() !== "main") {
    fail(
      `work:finish only publishes main. Current branch: ${currentBranch()}`
    );
  }

  run("git", ["fetch", "origin"]);

  const before = divergence("HEAD", "origin/main");

  if (before.behind > 0) {
    fail(
      `origin/main moved ahead by ${before.behind} commit(s) while you were working. Do not overwrite it. Synchronize first.`
    );
  }

  run("git", ["add", "-A"]);

  const files = stagedFiles();

  if (files.length) {
    guardLocalOnlyFiles(files);
    guardSecrets(files);

    run("git", ["diff", "--cached", "--check"]);

    runNpm(["run", "check:repo-hygiene"]);
    runNpm(["run", "build"]);

    const suppliedMessage = process.argv.slice(3).join(" ").trim();
    const fallbackMessage =
      `chore: sync work session ${new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", " ")}`;

    run("git", [
      "commit",
      "-m",
      suppliedMessage || fallbackMessage,
    ]);
  } else {
    console.log("\n[work-sync] No new file changes to commit.");
  }

  run("git", ["push", "origin", "main"]);

  console.log("\n[work-sync] PUBLISHED");
  console.log(`HEAD: ${capture("git", ["log", "-1", "--oneline"])}`);

  const remaining = workingTreeStatus();
  if (remaining) {
    console.log("\nRemaining local files/changes:");
    console.log(remaining);
  } else {
    console.log("Working tree: clean");
  }
}

if (mode === "start") {
  startSession();
} else if (mode === "finish") {
  finishSession();
} else {
  fail("Use: npm run work:start OR npm run work:finish -- \"commit message\"");
}
