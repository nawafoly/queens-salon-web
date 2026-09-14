#!/usr/bin/env node
/**
 * Idempotent client profile field backfill into Core D1 `clients`.
 *
 * Default dry-run. Does NOT read Firestore itself — pass an export JSON:
 * [
 *   {
 *     "firebaseUid": "...",
 *     "email": "...",
 *     "name": "...",
 *     "phone": "05...",
 *     "city": "...",
 *     "birthdate": "YYYY-MM-DD",
 *     "avatarUrl": "...",
 *     "membershipId": "...",
 *     "membershipPercent": 0
 *   }
 * ]
 *
 * Matching order: firebase_uid → email → phone_normalized.
 * Only fills empty Core fields (never overwrites non-empty D1 values).
 *
 * Usage:
 *   node scripts/migrate-client-profile-fields-to-d1.mjs --input ./users-export.json
 *   node scripts/migrate-client-profile-fields-to-d1.mjs --input ./users-export.json --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DATABASE = "queens-salon-core";
const SALON_ID = "main";
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const inputIdx = process.argv.indexOf("--input");
const inputPath = inputIdx >= 0 ? process.argv[inputIdx + 1] : "";

function clean(value) {
  return String(value ?? "").trim();
}

function sqlLiteral(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizePhone(value) {
  const raw = clean(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return "";
}

function buildUpdate(row) {
  const uid = clean(row.firebaseUid || row.firebase_uid || row.uid);
  const email = clean(row.email).toLowerCase();
  const phone = normalizePhone(row.phone || row.phoneNormalized || row.phone_normalized);
  const city = clean(row.city);
  const birthdate = clean(row.birthdate);
  const avatarUrl = clean(row.avatarUrl || row.avatar_url);
  const membershipId = clean(row.membershipId || row.membership_id);
  const membershipPercent = Number(row.membershipPercent ?? row.membership_percent ?? 0) || 0;

  const where = uid
    ? `firebase_uid = ${sqlLiteral(uid)}`
    : email
      ? `LOWER(TRIM(COALESCE(email, ''))) = ${sqlLiteral(email)}`
      : phone
        ? `phone_normalized = ${sqlLiteral(phone)}`
        : "";
  if (!where) return null;

  return `UPDATE clients
     SET city = COALESCE(NULLIF(city, ''), ${sqlLiteral(city)}),
         birthdate = COALESCE(NULLIF(birthdate, ''), ${sqlLiteral(birthdate)}),
         avatar_url = COALESCE(NULLIF(avatar_url, ''), ${sqlLiteral(avatarUrl)}),
         membership_id = COALESCE(NULLIF(membership_id, ''), ${sqlLiteral(membershipId)}),
         membership_percent = CASE
           WHEN COALESCE(membership_percent, 0) = 0 THEN ${membershipPercent}
           ELSE membership_percent
         END,
         updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
   WHERE salon_id = ${sqlLiteral(SALON_ID)}
     AND ${where};`;
}

function main() {
  if (!inputPath) {
    console.log(`Usage:
  node scripts/migrate-client-profile-fields-to-d1.mjs --input ./users-export.json
  node scripts/migrate-client-profile-fields-to-d1.mjs --input ./users-export.json --apply
`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(inputPath, "utf8"));
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw.users) ? raw.users : [];
  const statements = rows.map(buildUpdate).filter(Boolean);
  const outDir = join(".migration-work", "client-profiles");
  mkdirSync(outDir, { recursive: true });
  const sqlPath = join(outDir, `client-profile-backfill-${Date.now()}.sql`);
  writeFileSync(sqlPath, statements.join("\n\n") + "\n", "utf8");
  console.log(`Prepared ${statements.length} update(s). SQL: ${sqlPath}`);
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
    console.error("wrangler failed (e.g. 7403). Apply SQL via Cloudflare Bindings MCP d1_database_query instead.");
    process.exit(result.status || 1);
  }
  console.log("Client profile field backfill finished.");
}

main();
