#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FORBIDDEN = [
  /\bFirestoreRestClient\b/,
  /\bbatchGet\b/,
  /\brunQuery\b/,
  /\bVITE_PARTNERS_WORKER_URL\b/,
  /\bfirestore\b/i,
];

const OPERATIONAL_PATHS = [
  "workers/packages/index.js",
  "workers/packages/routes.js",
  "workers/packages/d1.js",
  "src/services/PackageOperationsService.ts",
];

function walk(dir) {
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function maybeAddD1Directory(paths) {
  const dir = join(ROOT, "workers", "packages", "d1");
  try {
    if (!statSync(dir).isDirectory()) return paths;
    return [
      ...paths,
      ...walk(dir)
        .filter((path) => /\.(mjs|js|ts)$/.test(path))
        .map((path) => relative(ROOT, path).replace(/\\/g, "/")),
    ];
  } catch {
    return paths;
  }
}

function stripCommentsAndStrings(source) {
  let out = "";
  let mode = "code";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (mode === "lineComment") {
      if (char === "\n") {
        mode = "code";
        out += "\n";
      } else {
        out += " ";
      }
      continue;
    }

    if (mode === "blockComment") {
      if (char === "*" && next === "/") {
        out += "  ";
        index += 1;
        mode = "code";
      } else {
        out += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (mode === "string") {
      if (char === "\\") {
        out += " ";
        if (next) {
          out += next === "\n" ? "\n" : " ";
          index += 1;
        }
        continue;
      }
      if (char === quote) mode = "code";
      out += char === "\n" ? "\n" : " ";
      continue;
    }

    if (char === "/" && next === "/") {
      out += "  ";
      index += 1;
      mode = "lineComment";
      continue;
    }
    if (char === "/" && next === "*") {
      out += "  ";
      index += 1;
      mode = "blockComment";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      mode = "string";
      out += " ";
      continue;
    }
    out += char;
  }
  return out;
}

const failures = [];
const paths = [...new Set(maybeAddD1Directory(OPERATIONAL_PATHS))];

for (const path of paths) {
  const fullPath = join(ROOT, path);
  const source = readFileSync(fullPath, "utf8");
  const stripped = stripCommentsAndStrings(source);
  const lines = stripped.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(line)) {
        failures.push(`${path}:${index + 1}: forbidden package D1 dependency matched ${pattern}`);
      }
    }
  });
}

if (failures.length) {
  console.error("Package D1-only guard failed. Firestore must remain isolated in one-time migration scripts.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Package D1-only guard passed.");
