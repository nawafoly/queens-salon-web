import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";
const projectRoot = process.cwd();

const LOCAL_CORE_URL = "http://127.0.0.1:8807";
const LOCAL_PARTNERS_URL = "http://127.0.0.1:8787";

const generatedConfigs = [
  {
    source: "wrangler.core.dev.jsonc",
    generated: ".wrangler.core.local.generated.jsonc",
  },
  {
    source: "wrangler.partners.dev.jsonc",
    generated: ".wrangler.partners.local.generated.jsonc",
  },
];

function cleanupGeneratedConfigs() {
  for (const item of generatedConfigs) {
    rmSync(resolve(projectRoot, item.generated), { force: true });
  }
}

function createLocalOnlyConfig(item) {
  const sourcePath = resolve(projectRoot, item.source);
  const generatedPath = resolve(projectRoot, item.generated);
  const source = readFileSync(sourcePath, "utf8");

  // Developer configs may intentionally opt into remote bindings for explicit
  // inspection workflows. `npm run dev` must never inherit those production-
  // connected bindings, so create an ignored local-only copy instead of
  // modifying the protected developer config.
  const localOnly = source.replace(
    /^\s*"remote"\s*:\s*true\s*,?\s*(?:\r?\n|$)/gm,
    ""
  );

  writeFileSync(generatedPath, localOnly, "utf8");
  return item.generated;
}

cleanupGeneratedConfigs();
const [coreConfig, partnersConfig] = generatedConfigs.map(createLocalOnlyConfig);
process.on("exit", cleanupGeneratedConfigs);

const processes = [
  {
    name: "core-api",
    command: npx,
    args: [
      "wrangler",
      "dev",
      "--local",
      "--config",
      coreConfig,
      "--port",
      "8807",
      "--show-interactive-dev-session=false",
    ],
  },
  {
    name: "partners-api",
    command: npx,
    args: [
      "wrangler",
      "dev",
      "--local",
      "--config",
      partnersConfig,
      "--port",
      "8787",
      "--show-interactive-dev-session=false",
    ],
  },
  {
    name: "vite",
    command: npx,
    args: ["vite", "--mode", "web"],
    env: {
      VITE_CORE_WORKER_URL: LOCAL_CORE_URL,
      VITE_PACKAGES_WORKER_URL: LOCAL_CORE_URL,
      VITE_PARTNERS_WORKER_URL: LOCAL_PARTNERS_URL,
    },
  },
];

const children = [];
let shuttingDown = false;

function buildSpawnArgs(item) {
  if (!isWindows) return { command: item.command, args: item.args };
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", [item.command, ...item.args].join(" ")],
  };
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function shouldHideLine(name, line) {
  const cleanLine = stripAnsi(line).trim();
  if (!cleanLine) return true;
  if (name !== "partners-api" && name !== "core-api") return false;

  return [
    /wrangler\s+\d/i,
    /^[─━═-]{5,}$/,
    /update available/i,
    /Using secrets defined/i,
    /Your Worker has access/i,
    /^Binding\b/i,
    /^Resource\b/i,
    /^Mode\b/i,
    /^env\./i,
    /Starting local server/i,
  ].some((pattern) => pattern.test(cleanLine));
}

function attachOutput(stream, name, target) {
  if (!stream) return;
  stream.setEncoding("utf8");
  let buffer = "";

  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (shouldHideLine(name, line)) continue;
      target.write(`[${name}] ${line}\n`);
    }
  });

  stream.on("end", () => {
    if (!buffer || shouldHideLine(name, buffer)) return;
    target.write(`[${name}] ${buffer}\n`);
  });
}

function stopAll(signal = "SIGTERM") {
  shuttingDown = true;
  for (const child of children) {
    if (child.killed) continue;
    if (isWindows && child.pid) {
      spawn("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      child.kill(signal);
    }
  }
}

for (const item of processes) {
  const spawnArgs = buildSpawnArgs(item);
  const child = spawn(spawnArgs.command, spawnArgs.args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(item.env || {}) },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.push(child);
  attachOutput(child.stdout, item.name, process.stdout);
  attachOutput(child.stderr, item.name, process.stderr);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopAll();
    const exitCode = typeof code === "number" ? code : signal ? 1 : 0;
    process.exit(exitCode);
  });
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
  setTimeout(() => process.exit(130), 250);
});

process.on("SIGTERM", () => {
  stopAll("SIGTERM");
  setTimeout(() => process.exit(143), 250);
});
