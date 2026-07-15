#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const CORE_DIR = join(ROOT, "workers", "core");
const FORBIDDEN = [
  /\bFirestoreRestClient\b/,
  /\bbatchGet\b/,
  /\brunQuery\b/,
  /\bfirebase-admin\b/,
  /\bgetFirestore\b/,
  /\bfirestore\b/i,
];

function walk(dir) {
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(path));
    else if (/\.(js|mjs|ts)$/.test(item.name)) out.push(path);
  }
  return out;
}

function stripCommentsAndStrings(source) {
  let out = "";
  let mode = "code";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "line") {
      if (char === "\n") {
        mode = "code";
        out += "\n";
      } else out += " ";
      continue;
    }
    if (mode === "block") {
      if (char === "*" && next === "/") {
        out += "  ";
        index += 1;
        mode = "code";
      } else out += char === "\n" ? "\n" : " ";
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
      mode = "line";
      continue;
    }
    if (char === "/" && next === "*") {
      out += "  ";
      index += 1;
      mode = "block";
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
for (const file of walk(CORE_DIR)) {
  const path = relative(ROOT, file).replace(/\\/g, "/");
  const lines = stripCommentsAndStrings(readFileSync(file, "utf8")).split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of FORBIDDEN) {
      if (pattern.test(line)) failures.push(`${path}:${index + 1}: forbidden Core D1 dependency matched ${pattern}`);
    }
  });
}

if (failures.length) {
  console.error("Core D1-only guard failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Core D1-only guard passed.");
