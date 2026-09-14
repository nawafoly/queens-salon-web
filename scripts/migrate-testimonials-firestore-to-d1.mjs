#!/usr/bin/env node
/**
 * Idempotent testimonials cutover helper.
 *
 * Default: dry-run (prints planned upserts, writes nothing).
 * Apply:   node scripts/migrate-testimonials-firestore-to-d1.mjs --apply --input ./path/to/export.json
 *
 * Input JSON shape (array):
 * [
 *   {
 *     "id": "optional-legacy-id",
 *     "uid": "...",
 *     "name": "...",
 *     "role": "عميلة",
 *     "image": "",
 *     "content": "...",
 *     "rating": 5,
 *     "vip": false,
 *     "approved": true,
 *     "hidden": false,
 *     "adminReply": "",
 *     "createdAt": "2026-01-01T00:00:00.000Z",
 *     "updatedAt": "2026-01-01T00:00:00.000Z"
 *   }
 * ]
 *
 * Does NOT call Firestore. Export testimonials from Firestore separately, then
 * feed the JSON here. Safe to re-run: upserts by (salon_id, id).
 *
 * Apply uses Cloudflare Bindings / wrangler D1 execute against queens-salon-core.
 * Prefer reviewing the dry-run SQL before --apply.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SALON_ID = "main";
const DATABASE = "queens-salon-core";
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const inputIdx = process.argv.indexOf("--input");
const inputPath = inputIdx >= 0 ? process.argv[inputIdx + 1] : "";

function clean(value) {
  return String(value ?? "").trim();
}

function boolInt(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}

function isoFromFirestoreish(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "object") {
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

function stableId(row) {
  const explicit = clean(row.id);
  if (explicit) return explicit.slice(0, 120);
  const basis = [
    clean(row.uid),
    clean(row.content),
    isoFromFirestoreish(row.createdAt),
  ].join("|");
  return `fs_${createHash("sha1").update(basis).digest("hex").slice(0, 24)}`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function buildUpsert(row) {
  const id = stableId(row);
  const createdAt = isoFromFirestoreish(row.createdAt);
  const updatedAt = isoFromFirestoreish(row.updatedAt || row.createdAt);
  return {
    id,
    sql: `INSERT INTO testimonials
      (salon_id, id, uid, name, role_label, image_url, content, rating, vip,
       approved, hidden, admin_reply, created_at, updated_at)
     VALUES (
       ${sqlLiteral(SALON_ID)},
       ${sqlLiteral(id)},
       ${sqlLiteral(clean(row.uid) || null)},
       ${sqlLiteral(clean(row.name) || "عميلة")},
       ${sqlLiteral(clean(row.role || row.role_label) || "عميلة")},
       ${sqlLiteral(clean(row.image || row.image_url))},
       ${sqlLiteral(clean(row.content))},
       ${Number(row.rating || 5)},
       ${boolInt(row.vip, 0)},
       ${boolInt(row.approved, 1)},
       ${boolInt(row.hidden, 0)},
       ${sqlLiteral(clean(row.adminReply || row.admin_reply))},
       ${sqlLiteral(createdAt)},
       ${sqlLiteral(updatedAt)}
     )
     ON CONFLICT(salon_id, id) DO UPDATE SET
       uid = excluded.uid,
       name = excluded.name,
       role_label = excluded.role_label,
       image_url = excluded.image_url,
       content = excluded.content,
       rating = excluded.rating,
       vip = excluded.vip,
       approved = excluded.approved,
       hidden = excluded.hidden,
       admin_reply = excluded.admin_reply,
       updated_at = excluded.updated_at;`,
  };
}

function main() {
  if (!inputPath) {
    console.log(`Usage:
  node scripts/migrate-testimonials-firestore-to-d1.mjs --input ./export.json
  node scripts/migrate-testimonials-firestore-to-d1.mjs --input ./export.json --apply

Dry-run is the default. --apply executes SQL via: npx wrangler d1 execute ${DATABASE} --remote --file ...
`);
    process.exit(inputPath ? 0 : 1);
  }

  const raw = JSON.parse(readFileSync(inputPath, "utf8"));
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw.testimonials) ? raw.testimonials : [];
  if (!rows.length) {
    console.error("No testimonials found in input JSON.");
    process.exit(1);
  }

  const upserts = rows
    .filter((row) => clean(row.content))
    .map(buildUpsert);

  const outDir = join(".migration-work", "testimonials");
  mkdirSync(outDir, { recursive: true });
  const sqlPath = join(outDir, `testimonials-upsert-${Date.now()}.sql`);
  writeFileSync(sqlPath, upserts.map((row) => row.sql).join("\n\n") + "\n", "utf8");

  console.log(`Prepared ${upserts.length} upsert(s).`);
  console.log(`SQL artifact: ${sqlPath}`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);

  if (!apply) {
    console.log("Dry-run complete. Re-run with --apply after review.");
    return;
  }

  const result = spawnSync(
    "npx",
    ["wrangler", "d1", "execute", DATABASE, "--remote", "--file", sqlPath, "--config", "wrangler.core.jsonc"],
    { stdio: "inherit", encoding: "utf8" }
  );
  if (result.status !== 0) {
    console.error("wrangler d1 execute failed. If API error 7403, apply the same SQL via Cloudflare Bindings MCP d1_database_query in batches.");
    process.exit(result.status || 1);
  }
  console.log("Testimonials upsert apply finished.");
}

main();
