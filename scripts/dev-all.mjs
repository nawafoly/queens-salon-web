import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";
const processes = [
  {
    name: "partners",
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
    name: "packages",
    args: [
      "wrangler",
      "dev",
      "--config",
      "wrangler.packages.jsonc",
      "--local",
      "--port",
      "8797",
      "--show-interactive-dev-session=false",
    ],
  },
  {
    name: "core",
    args: [
      "wrangler",
      "dev",
      "--config",
      "wrangler.core.jsonc",
      "--local",
      "--port",
      "8807",
      "--show-interactive-dev-session=false",
    ],
  },
  { name: "vite", args: ["vite"] },
];

const children = processes.map((item) => {
  const command = isWindows
    ? process.env.ComSpec || "cmd.exe"
    : npx;
  const args = isWindows
    ? ["/d", "/s", "/c", [npx, ...item.args].join(" ")]
    : item.args;

  const child = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`${item.name} exited with ${code}`);
    }
  });
  return child;
});

let stopping = false;
function stopAll(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => {
    try {
      child.kill(signal);
    } catch {
      // Process already stopped.
    }
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
