import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";

const processes = [
  {
    name: "partners-api",
    command: npx,
    args: [
      "wrangler",
      "dev",
      "--config",
      "wrangler.partners.jsonc",
      "--local",
      "--port",
      "8787",
      "--show-interactive-dev-session=false",
    ],
  },
  {
    name: "vite",
    command: npx,
    args: ["vite"],
  },
];

const children = [];
let shuttingDown = false;

function buildSpawnArgs(item) {
  if (!isWindows) {
    return { command: item.command, args: item.args };
  }

  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", [item.command, ...item.args].join(" ")],
  };
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
    env: process.env,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.push(child);

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(`[${item.name}] ${chunk}`);
  });

  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${item.name}] ${chunk}`);
  });

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
