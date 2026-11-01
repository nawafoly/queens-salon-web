import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "./core/index.js";

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
});

test("Core OPTIONS responses allow only stable production and native origins", async () => {
  const cfg = JSON.parse(readFileSync("wrangler.core.jsonc", "utf8").replace(/^\uFEFF/, ""));
  for (const [origin, allowed] of [
    ["https://queens-salon-web.vercel.app", true],
    ["https://queens-salon-web-gnxk.vercel.app", true],
    ["capacitor://localhost", true],
    ["http://localhost", true],
    ["http://localhost:5173", false],
    ["http://127.0.0.1:5174", false],
    ["http://192.168.1.61:5173", false],
    ["https://untrusted.example", false],
  ]) {
    const response = await worker.fetch(
      new Request("https://core.example/api/core/services", {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
      }),
      { SALON_ID: "main", ALLOWED_ORIGINS: cfg.vars.ALLOWED_ORIGINS }
    );
    assert.equal(response.status, 204, origin);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), allowed ? origin : null, origin);
  }
});
