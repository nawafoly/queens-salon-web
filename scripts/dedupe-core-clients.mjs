#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveSpawnInvocation } from "./migrate-packages-d1-to-core.mjs";

const DEFAULT_SALON_ID = "main";

function text(value) {
  return String(value ?? "").trim();
}

function normalizePhone(value) {
  const raw = text(value);
  if (!raw || /[A-Za-z]/.test(raw)) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return digits;
}

function safeJsonArray(value) {
  if (Array.isArray(value)) return [...new Set(value.map(text).filter(Boolean))];
  try {
    const parsed = JSON.parse(text(value) || "[]");
    return Array.isArray(parsed) ? [...new Set(parsed.map(text).filter(Boolean))] : [];
  } catch {
    return [];
  }
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function isPhoneLegacyId(id, phone) {
  const raw = text(id);
  if (!raw || !/^\d+$/.test(raw)) return false;
  return normalizePhone(raw) === normalizePhone(phone);
}

function activityFor(activity, id) {
  return Object.fromEntries(Object.entries(activity).map(([key, rows]) => [
    key,
    Number(rows?.[id] || 0),
  ]));
}

function replaceTargetArraySql(table, sourceId, targetId, salonId) {
  return `UPDATE ${table}\nSET target_client_ids_json = COALESCE((\n  SELECT json_group_array(value)\n  FROM (\n    SELECT DISTINCT CASE WHEN value = ${sqlValue(sourceId)} THEN ${sqlValue(targetId)} ELSE value END AS value\n    FROM json_each(CASE WHEN json_valid(${table}.target_client_ids_json) THEN ${table}.target_client_ids_json ELSE '[]' END)\n    WHERE value IS NOT NULL AND TRIM(value) <> ''\n    ORDER BY value\n  )\n), '[]')\nWHERE salon_id = ${sqlValue(salonId)}\n  AND target_client_ids_json LIKE ${sqlValue(`%\"${sourceId}\"%`)};`;
}

function buildMergeSql({ salonId, canonical, sources, aliases, generatedAt }) {
  const legacyIds = new Set(safeJsonArray(canonical.legacy_ids_json));
  const notes = new Set([text(canonical.notes)].filter(Boolean));
  let email = text(canonical.email);
  let phone = normalizePhone(canonical.phone_normalized);
  let vip = Number(canonical.vip || 0) ? 1 : 0;
  let legacyDoc = text(canonical.legacy_client_doc_id);

  for (const source of sources) {
    legacyIds.add(text(source.id));
    safeJsonArray(source.legacy_ids_json).forEach((id) => legacyIds.add(id));
    if (!email) email = text(source.email);
    if (!phone) phone = normalizePhone(source.phone_normalized);
    if (!legacyDoc) legacyDoc = text(source.legacy_client_doc_id) || text(source.id);
    if (Number(source.vip || 0)) vip = 1;
    if (text(source.notes)) notes.add(text(source.notes));
  }
  legacyIds.delete(text(canonical.id));

  const lines = [
    `-- Merge ${sources.map((row) => row.id).join(", ")} into ${canonical.id}`,
    `UPDATE clients SET`,
    `  phone_normalized = ${sqlValue(phone || null)},`,
    `  email = ${sqlValue(email || null)},`,
    `  vip = ${vip},`,
    `  notes = ${sqlValue([...notes].join("\n") || null)},`,
    `  legacy_client_doc_id = ${sqlValue(legacyDoc || sources[0]?.id || null)},`,
    `  canonical_client_id = ${sqlValue(canonical.id)},`,
    `  legacy_ids_json = ${sqlValue(JSON.stringify([...legacyIds].sort()))},`,
    `  updated_at = ${sqlValue(generatedAt)}`,
    `WHERE salon_id = ${sqlValue(salonId)} AND id = ${sqlValue(canonical.id)};`,
  ];

  for (const source of sources) {
    const sourceId = text(source.id);
    const targetId = text(canonical.id);
    for (const [table, column] of [
      ["bookings", "client_id"],
      ["invoices", "client_id"],
      ["payments", "client_id"],
      ["refunds", "client_id"],
      ["loyalty_point_transactions", "client_id"],
      ["client_packages", "canonical_client_id"],
      ["package_transactions", "canonical_client_id"],
    ]) {
      lines.push(`UPDATE ${table} SET ${column} = ${sqlValue(targetId)} WHERE salon_id = ${sqlValue(salonId)} AND ${column} = ${sqlValue(sourceId)};`);
    }
    lines.push(replaceTargetArraySql("discounts", sourceId, targetId, salonId));
    lines.push(replaceTargetArraySql("package_catalog", sourceId, targetId, salonId));
    lines.push(`UPDATE client_aliases SET canonical_client_id = ${sqlValue(targetId)}, alias_type = CASE WHEN alias_type = 'migration' THEN 'merged_duplicate' ELSE alias_type END WHERE salon_id = ${sqlValue(salonId)} AND canonical_client_id = ${sqlValue(sourceId)};`);
    lines.push(`INSERT INTO client_aliases (salon_id, alias_id, canonical_client_id, alias_type, created_at) VALUES (${sqlValue(salonId)}, ${sqlValue(sourceId)}, ${sqlValue(targetId)}, 'merged_duplicate', ${sqlValue(generatedAt)}) ON CONFLICT(salon_id, alias_id) DO UPDATE SET canonical_client_id = excluded.canonical_client_id, alias_type = excluded.alias_type;`);
    lines.push(`DELETE FROM clients WHERE salon_id = ${sqlValue(salonId)} AND id = ${sqlValue(sourceId)};`);
  }

  const phoneAlias = normalizePhone(phone);
  if (phoneAlias) {
    lines.push(`INSERT INTO client_aliases (salon_id, alias_id, canonical_client_id, alias_type, created_at) VALUES (${sqlValue(salonId)}, ${sqlValue(phoneAlias)}, ${sqlValue(canonical.id)}, 'phone', ${sqlValue(generatedAt)}) ON CONFLICT(salon_id, alias_id) DO UPDATE SET canonical_client_id = excluded.canonical_client_id, alias_type = excluded.alias_type;`);
  }

  const auditId = `dedupe_${canonical.id}_${generatedAt.replace(/\D/g, "").slice(0, 14)}`;
  lines.push(`INSERT OR IGNORE INTO audit_logs (id, salon_id, action, entity_type, entity_id, description, source, actor_name, before_json, after_json, meta_json, created_at) VALUES (${sqlValue(auditId)}, ${sqlValue(salonId)}, 'clients.merge', 'client', ${sqlValue(canonical.id)}, ${sqlValue(`Merged duplicate legacy client records: ${sources.map((row) => row.id).join(", ")}`)}, 'migration', 'system', ${sqlValue(JSON.stringify({ sourceClientIds: sources.map((row) => row.id) }))}, ${sqlValue(JSON.stringify({ canonicalClientId: canonical.id }))}, ${sqlValue(JSON.stringify({ reason: "phone-shaped legacy IDs with one Firebase-linked canonical client" }))}, ${sqlValue(generatedAt)});`);

  return lines.join("\n");
}

export function buildCoreClientDedupArtifact({
  salonId = DEFAULT_SALON_ID,
  clients = [],
  aliases = [],
  activity = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const groups = new Map();
  for (const row of clients.filter((item) => text(item.salon_id) === salonId)) {
    const phone = normalizePhone(row.phone_normalized);
    if (!phone) continue;
    const list = groups.get(phone) || [];
    list.push(row);
    groups.set(phone, list);
  }

  const safeMerges = [];
  const blockingGroups = [];
  const sharedPhoneGroups = [];
  const sql = [`-- Generated Core client deduplication at ${generatedAt}`, `-- Salon: ${salonId}`];

  for (const [phone, rows] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (rows.length < 2) continue;
    const legacyRows = rows.filter((row) => isPhoneLegacyId(row.id, phone));
    if (!legacyRows.length) {
      sharedPhoneGroups.push({ phone, clientIds: rows.map((row) => row.id), reason: "No phone-shaped legacy client ID; treated as possibly shared family phone." });
      continue;
    }

    const uidRows = rows.filter((row) => text(row.firebase_uid));
    if (uidRows.length !== 1) {
      blockingGroups.push({
        phone,
        clientIds: rows.map((row) => row.id),
        firebaseLinkedClientIds: uidRows.map((row) => row.id),
        reason: uidRows.length === 0 ? "No unique Firebase-linked canonical client." : "More than one Firebase-linked client shares this phone.",
      });
      continue;
    }

    const canonical = uidRows[0];
    const sources = rows.filter((row) => row.id !== canonical.id);
    const unsafeSources = sources.filter((row) => text(row.firebase_uid) || !isPhoneLegacyId(row.id, phone));
    if (unsafeSources.length) {
      blockingGroups.push({
        phone,
        clientIds: rows.map((row) => row.id),
        firebaseLinkedClientIds: uidRows.map((row) => row.id),
        unsafeSourceIds: unsafeSources.map((row) => row.id),
        reason: "At least one duplicate is not a phone-shaped legacy record.",
      });
      continue;
    }

    const aliasRows = aliases.filter((row) => row.salon_id === salonId && sources.some((source) => row.canonical_client_id === source.id));
    sql.push(buildMergeSql({ salonId, canonical, sources, aliases: aliasRows, generatedAt }));
    safeMerges.push({
      phone,
      canonicalClientId: canonical.id,
      firebaseUid: canonical.firebase_uid,
      sourceClientIds: sources.map((row) => row.id),
      canonicalActivity: activityFor(activity, canonical.id),
      sourceActivity: Object.fromEntries(sources.map((row) => [row.id, activityFor(activity, row.id)])),
    });
  }

  return {
    sql: `${sql.join("\n\n")}\n`,
    report: {
      salonId,
      generatedAt,
      safeMergeCount: safeMerges.length,
      blockingGroupCount: blockingGroups.length,
      sharedPhoneGroupCount: sharedPhoneGroups.length,
      safeMerges,
      blockingGroups,
      sharedPhoneGroups,
    },
  };
}

function parseJsonOutput(stdout, label) {
  const raw = text(stdout);
  const firstBracket = raw.indexOf("[");
  const firstBrace = raw.indexOf("{");
  const start = [firstBracket, firstBrace].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (start === undefined) throw new Error(`${label}: Wrangler returned no JSON`);
  const parsed = JSON.parse(raw.slice(start));
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  for (const block of blocks) {
    if (Array.isArray(block?.results)) rows.push(...block.results);
    else if (Array.isArray(block?.result?.results)) rows.push(...block.result.results);
  }
  return rows;
}

function run(command, args, { capture = false } = {}) {
  const invocation = resolveSpawnInvocation(command, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: invocation.shell,
  });
  if (result.error || result.status !== 0) {
    const diagnostics = [result.error?.message, text(result.stderr), text(result.stdout)].filter(Boolean).join(" | ");
    throw new Error(`${command} ${args.join(" ")} failed${diagnostics ? `: ${diagnostics}` : ""}`);
  }
  return result.stdout || "";
}

function wranglerJson(sql) {
  return parseJsonOutput(run("npx", ["wrangler", "d1", "execute", "queens-salon-core", "--remote", "--config", "wrangler.core.jsonc", "--command", sql, "--json"], { capture: true }), sql);
}

function rowsToCountMap(rows) {
  return Object.fromEntries(rows.map((row) => [text(row.id), Number(row.count || 0)]));
}

function parseArgs(argv) {
  const args = { apply: false, salonId: DEFAULT_SALON_ID, out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") args.apply = true;
    else if (value === "--salon-id") args.salonId = text(argv[++index]) || DEFAULT_SALON_ID;
    else if (value === "--out") args.out = text(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const salon = sqlValue(args.salonId);
  const clients = wranglerJson(`SELECT * FROM clients WHERE salon_id = ${salon}`);
  const aliases = wranglerJson(`SELECT * FROM client_aliases WHERE salon_id = ${salon}`);
  const activity = {
    bookings: rowsToCountMap(wranglerJson(`SELECT client_id AS id, COUNT(*) AS count FROM bookings WHERE salon_id = ${salon} GROUP BY client_id`)),
    invoices: rowsToCountMap(wranglerJson(`SELECT client_id AS id, COUNT(*) AS count FROM invoices WHERE salon_id = ${salon} GROUP BY client_id`)),
    payments: rowsToCountMap(wranglerJson(`SELECT client_id AS id, COUNT(*) AS count FROM payments WHERE salon_id = ${salon} GROUP BY client_id`)),
    refunds: rowsToCountMap(wranglerJson(`SELECT client_id AS id, COUNT(*) AS count FROM refunds WHERE salon_id = ${salon} GROUP BY client_id`)),
    loyalty: rowsToCountMap(wranglerJson(`SELECT client_id AS id, COUNT(*) AS count FROM loyalty_point_transactions WHERE salon_id = ${salon} GROUP BY client_id`)),
    packages: rowsToCountMap(wranglerJson(`SELECT canonical_client_id AS id, COUNT(*) AS count FROM client_packages WHERE salon_id = ${salon} GROUP BY canonical_client_id`)),
  };

  const artifact = buildCoreClientDedupArtifact({ salonId: args.salonId, clients, aliases, activity });
  const out = resolve(args.out || `core-client-dedup-${args.salonId}.sql`);
  writeFileSync(out, artifact.sql, "utf8");
  writeFileSync(`${out}.report.json`, `${JSON.stringify(artifact.report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ sqlFile: out, reportFile: `${out}.report.json`, ...artifact.report }, null, 2));

  if (!args.apply) {
    console.log("Dry run only. Review the complete report; all safe duplicates are listed together.");
    return;
  }
  if (artifact.report.blockingGroupCount > 0) {
    throw new Error(`Refusing apply: ${artifact.report.blockingGroupCount} blocking duplicate group(s). Review ${out}.report.json`);
  }
  if (artifact.report.safeMergeCount === 0) {
    console.log("No safe legacy duplicate clients require merging.");
    return;
  }

  const backupDir = resolve(`core-client-dedup-backup-${Date.now()}`);
  mkdirSync(backupDir, { recursive: true });
  run("npx", ["wrangler", "d1", "export", "queens-salon-core", "--remote", "--config", "wrangler.core.jsonc", "--output", join(backupDir, "core-before.sql")]);
  run("npx", ["wrangler", "d1", "execute", "queens-salon-core", "--remote", "--config", "wrangler.core.jsonc", "--file", out]);

  const remaining = wranglerJson(`SELECT phone_normalized, COUNT(*) AS count FROM clients WHERE salon_id = ${salon} AND phone_normalized IS NOT NULL AND TRIM(phone_normalized) <> '' GROUP BY phone_normalized HAVING COUNT(*) > 1 ORDER BY phone_normalized`);
  console.log(JSON.stringify({ applied: true, backupDir, mergedGroups: artifact.report.safeMergeCount, remainingSharedOrBlockingPhones: remaining }, null, 2));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
