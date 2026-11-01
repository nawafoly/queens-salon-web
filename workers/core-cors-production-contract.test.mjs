import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Core production CORS excludes temporary development ports and LAN IPs", () => {
  const raw = readFileSync("wrangler.core.jsonc", "utf8").replace(/^\uFEFF/, "");
  const cfg = JSON.parse(raw);
  const origins = cfg.vars.ALLOWED_ORIGINS.split(",").map((item) => item.trim());
  const expected = [
    "http://localhost",
    "https://localhost",
    "capacitor://localhost",
    "https://queens-salon-web.vercel.app",
    "https://queens-salon-web-gnxk.vercel.app",
  ];
  assert.deepEqual(origins, expected);
  assert.equal(new Set(origins).size, origins.length);
  assert.ok(origins.every((origin) => !origin.includes("192.168.") && !origin.includes(":5173") && !origin.includes(":5174")));
});

test("Core fallback allowlist matches stable web/native origins without development ports", () => {
  const core = readFileSync("workers/core/index.js", "utf8");
  const defaultOrigins = core.match(/const DEFAULT_ALLOWED_ORIGINS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(defaultOrigins);
  const literals = [...defaultOrigins[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(literals, [
    "http://localhost",
    "https://localhost",
    "capacitor://localhost",
    "https://queens-salon-web.vercel.app",
    "https://queens-salon-web-gnxk.vercel.app",
  ]);
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(packageJson.scripts["dev:core"], /--local/);
  assert.match(packageJson.scripts["dev:core"], /--var ALLOWED_ORIGINS:http:\/\/localhost:5173/);
});
