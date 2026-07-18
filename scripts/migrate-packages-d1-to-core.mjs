#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_SALON_ID = "main";
const PACKAGE_TABLES = [
  "clients",
  "client_identity_aliases",
  "package_catalog",
  "client_packages",
  "package_transactions",
];

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
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertSql(table, columns, rows, { conflict = "IGNORE", updateColumns = [] } = {}) {
  if (!rows.length) return [];
  return rows.map((row) => {
    const values = columns.map((column) => sqlValue(row[column])).join(", ");
    const target = columns.includes("id") ? "id" : "";
    const update = target && updateColumns.length
      ? ` ON CONFLICT(${target}) DO UPDATE SET ${updateColumns.map((column) => `${column}=excluded.${column}`).join(", ")}`
      : "";
    return `INSERT OR ${conflict} INTO ${table} (${columns.join(", ")}) VALUES (${values})${update};`;
  });
}

function uniqueMatch(index, key, label) {
  if (!key) return null;
  const ids = index.get(key) || [];
  if (ids.length > 1) {
    throw new Error(`Ambiguous ${label} match for ${key}: ${ids.join(", ")}`);
  }
  return ids[0] || null;
}

function addIndex(index, key, id) {
  if (!key || !id) return;
  const rows = index.get(key) || [];
  if (!rows.includes(id)) rows.push(id);
  index.set(key, rows);
}

export function buildUnifiedPackagesSql({
  salonId = DEFAULT_SALON_ID,
  coreClients = [],
  coreAliases = [],
  packageClients = [],
  packageAliases = [],
  packageCatalog = [],
  clientPackages = [],
  packageTransactions = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const coreById = new Map();
  const coreByUid = new Map();
  const coreByPhone = new Map();
  const coreAliasMap = new Map();

  for (const row of coreClients.filter((item) => text(item.salon_id) === salonId)) {
    const id = text(row.id);
    if (!id) continue;
    coreById.set(id, row);
    addIndex(coreByUid, text(row.firebase_uid), id);
    addIndex(coreByPhone, normalizePhone(row.phone_normalized), id);
  }
  for (const row of coreAliases.filter((item) => text(item.salon_id) === salonId)) {
    const aliasId = text(row.alias_id);
    const canonicalId = text(row.canonical_client_id);
    if (aliasId && canonicalId) coreAliasMap.set(aliasId, canonicalId);
  }

  const packageClientMap = new Map();
  const clientsToInsert = [];
  const aliasesToInsert = [];
  const packageClientById = new Map(
    packageClients
      .filter((item) => text(item.salon_id) === salonId)
      .map((item) => [text(item.canonical_client_id), item])
  );

  const allPackageClientIds = new Set([
    ...packageClientById.keys(),
    ...clientPackages.filter((row) => text(row.salon_id) === salonId).map((row) => text(row.canonical_client_id)),
    ...packageTransactions.filter((row) => text(row.salon_id) === salonId).map((row) => text(row.canonical_client_id)),
  ].filter(Boolean));

  for (const packageClientId of allPackageClientIds) {
    const row = packageClientById.get(packageClientId) || {};
    const firebaseUid = text(row.firebase_uid);
    const phone = normalizePhone(row.phone_normalized);
    const aliasTarget = coreAliasMap.get(packageClientId) || null;
    const direct = coreById.has(packageClientId) ? packageClientId : null;
    const uidMatches = firebaseUid ? (coreByUid.get(firebaseUid) || []) : [];
    if (uidMatches.length > 1) {
      throw new Error(`Ambiguous firebase_uid match for ${firebaseUid}: ${uidMatches.join(", ")}`);
    }
    const uidMatch = uidMatches[0] || null;
    const strongCandidates = [...new Set([aliasTarget, direct, uidMatch].filter(Boolean))];
    if (strongCandidates.length > 1) {
      throw new Error(`Client identity conflict for ${packageClientId}: ${strongCandidates.join(", ")}`);
    }

    const phoneMatches = phone ? (coreByPhone.get(phone) || []) : [];
    const strongTarget = strongCandidates[0] || null;
    let phoneMatch = null;
    if (strongTarget) {
      if (phoneMatches.length && !phoneMatches.includes(strongTarget)) {
        throw new Error(`Client identity conflict for ${packageClientId}: authoritative ${strongTarget}, phone ${phoneMatches.join(", ")}`);
      }
      phoneMatch = strongTarget;
    } else if (phoneMatches.length > 1) {
      throw new Error(`Ambiguous phone match for ${phone}: ${phoneMatches.join(", ")}`);
    } else {
      phoneMatch = phoneMatches[0] || null;
    }

    const canonicalId = strongTarget || phoneMatch || packageClientId;
    packageClientMap.set(packageClientId, canonicalId);

    if (!coreById.has(canonicalId)) {
      const legacyIds = safeJsonArray(row.legacy_ids_json).filter((id) => id !== canonicalId);
      clientsToInsert.push({
        id: canonicalId,
        salon_id: salonId,
        name: text(row.name) || "عميلة",
        phone_normalized: phone || null,
        email: null,
        firebase_uid: firebaseUid || null,
        status: "active",
        notes: null,
        vip: 0,
        legacy_client_doc_id: legacyIds[0] || null,
        canonical_client_id: canonicalId,
        legacy_ids_json: JSON.stringify(legacyIds),
        created_at: text(row.created_at) || generatedAt,
        updated_at: text(row.updated_at) || generatedAt,
      });
      coreById.set(canonicalId, clientsToInsert.at(-1));
      addIndex(coreByUid, firebaseUid, canonicalId);
      addIndex(coreByPhone, phone, canonicalId);
    }

    const aliases = new Set([
      packageClientId,
      ...safeJsonArray(row.legacy_ids_json),
      ...packageAliases
        .filter((alias) => text(alias.salon_id) === salonId && text(alias.canonical_client_id) === packageClientId)
        .map((alias) => text(alias.alias_id)),
    ]);
    aliases.delete(canonicalId);
    for (const aliasId of aliases) {
      if (!aliasId) continue;
      const existingTarget = coreAliasMap.get(aliasId);
      if (existingTarget && existingTarget !== canonicalId) {
        throw new Error(`Alias conflict for ${aliasId}: ${existingTarget} != ${canonicalId}`);
      }
      coreAliasMap.set(aliasId, canonicalId);
      aliasesToInsert.push({
        salon_id: salonId,
        alias_id: aliasId,
        canonical_client_id: canonicalId,
        alias_type: "packages_d1_migration",
        created_at: generatedAt,
      });
    }
  }

  const catalogRows = packageCatalog
    .filter((row) => text(row.salon_id) === salonId)
    .map((row) => ({ ...row, salon_id: salonId }));
  const clientPackageRows = clientPackages
    .filter((row) => text(row.salon_id) === salonId)
    .map((row) => ({
      ...row,
      salon_id: salonId,
      canonical_client_id: packageClientMap.get(text(row.canonical_client_id)) || text(row.canonical_client_id),
    }));
  const transactionRows = packageTransactions
    .filter((row) => text(row.salon_id) === salonId)
    .map((row) => ({
      ...row,
      salon_id: salonId,
      canonical_client_id: packageClientMap.get(text(row.canonical_client_id)) || text(row.canonical_client_id),
    }));

  const clientColumns = [
    "id", "salon_id", "name", "phone_normalized", "email", "firebase_uid", "status", "notes", "vip",
    "legacy_client_doc_id", "canonical_client_id", "legacy_ids_json", "created_at", "updated_at",
  ];
  const catalogColumns = [
    "id", "salon_id", "name", "total_sessions", "price", "allowed_service_ids_json", "active", "description",
    "validity_days", "image_url", "terms", "starts_at", "ends_at", "sale_enabled", "audience_scope",
    "target_client_ids_json", "sort_order", "created_at", "updated_at",
  ];
  const clientPackageColumns = [
    "id", "salon_id", "canonical_client_id", "package_catalog_id", "package_name_snapshot",
    "allowed_service_ids_json", "total_sessions", "remaining_sessions", "reserved_sessions", "used_sessions",
    "status", "purchased_at", "expires_at", "invoice_id", "created_at", "updated_at",
  ];
  const transactionColumns = [
    "id", "salon_id", "client_package_id", "canonical_client_id", "type", "sessions_delta", "remaining_before",
    "remaining_after", "reserved_before", "reserved_after", "used_before", "used_after", "service_id", "booking_id",
    "cart_item_id", "invoice_id", "reason", "created_by_uid", "created_at",
  ];

  const sql = [
    `-- Generated package D1 -> Core D1 import at ${generatedAt}`,
    `-- Salon: ${salonId}`,
    ...insertSql("clients", clientColumns, clientsToInsert),
    ...aliasesToInsert.map((row) =>
      `INSERT OR IGNORE INTO client_aliases (salon_id, alias_id, canonical_client_id, alias_type, created_at) VALUES (${[
        row.salon_id, row.alias_id, row.canonical_client_id, row.alias_type, row.created_at,
      ].map(sqlValue).join(", ")});`
    ),
    ...insertSql("package_catalog", catalogColumns, catalogRows, {
      conflict: "ABORT",
      updateColumns: catalogColumns.filter((column) => !["id", "created_at"].includes(column)),
    }),
    ...insertSql("client_packages", clientPackageColumns, clientPackageRows, {
      conflict: "ABORT",
      updateColumns: clientPackageColumns.filter((column) => !["id", "created_at"].includes(column)),
    }),
    ...insertSql("package_transactions", transactionColumns, transactionRows),
  ];

  return {
    sql: `${sql.join("\n")}\n`,
    report: {
      salonId,
      coreClientsMatched: allPackageClientIds.size - clientsToInsert.length,
      coreClientsCreated: clientsToInsert.length,
      aliasesCreated: aliasesToInsert.length,
      catalogRows: catalogRows.length,
      clientPackageRows: clientPackageRows.length,
      transactionRows: transactionRows.length,
      clientMap: Object.fromEntries(packageClientMap),
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

export function resolveSpawnInvocation(command, args, {
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath,
  cwd = process.cwd(),
} = {}) {
  if (command === "npx" && args[0] === "wrangler") {
    const localWrangler = resolve(cwd, "node_modules", "wrangler", "bin", "wrangler.js");
    if (existsSync(localWrangler)) {
      return {
        executable: execPath,
        args: [localWrangler, ...args.slice(1)],
        shell: false,
      };
    }

    if (text(npmExecPath)) {
      return {
        executable: execPath,
        args: [npmExecPath, "exec", "--", ...args],
        shell: false,
      };
    }
  }

  if (platform === "win32" && command === "npx") {
    return { executable: command, args, shell: true };
  }

  return { executable: command, args, shell: false };
}

function run(command, args, { capture = false } = {}) {
  const invocation = resolveSpawnInvocation(command, args);
  const result = spawnSync(invocation.executable, invocation.args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: invocation.shell,
  });
  if (result.error || result.status !== 0) {
    const diagnostics = [
      result.error?.message,
      text(result.stderr),
      text(result.stdout),
      result.signal ? `signal=${result.signal}` : "",
      result.status === null ? "exitStatus=null" : `exitStatus=${result.status}`,
    ].filter(Boolean).join(" | ");
    throw new Error(`${command} ${args.join(" ")} failed${diagnostics ? `: ${diagnostics}` : ""}`);
  }
  return result.stdout || "";
}

function wranglerJson(database, config, sql) {
  return parseJsonOutput(
    run("npx", ["wrangler", "d1", "execute", database, "--remote", "--config", config, "--command", sql, "--json"], { capture: true }),
    `${database}: ${sql}`
  );
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
  const salonLiteral = sqlValue(args.salonId);
  const coreClients = wranglerJson("queens-salon-core", "wrangler.core.jsonc", `SELECT * FROM clients WHERE salon_id = ${salonLiteral}`);
  const coreAliases = wranglerJson("queens-salon-core", "wrangler.core.jsonc", `SELECT * FROM client_aliases WHERE salon_id = ${salonLiteral}`);
  const source = Object.fromEntries(PACKAGE_TABLES.map((table) => [
    table,
    wranglerJson("queens-salon-packages", "wrangler.packages.jsonc", `SELECT * FROM ${table} WHERE salon_id = ${salonLiteral}`),
  ]));

  const artifact = buildUnifiedPackagesSql({
    salonId: args.salonId,
    coreClients,
    coreAliases,
    packageClients: source.clients,
    packageAliases: source.client_identity_aliases,
    packageCatalog: source.package_catalog,
    clientPackages: source.client_packages,
    packageTransactions: source.package_transactions,
  });

  const out = resolve(args.out || `packages-to-core-${args.salonId}.sql`);
  writeFileSync(out, artifact.sql, "utf8");
  writeFileSync(`${out}.report.json`, `${JSON.stringify(artifact.report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ sqlFile: out, reportFile: `${out}.report.json`, ...artifact.report }, null, 2));

  if (!args.apply) {
    console.log("Dry run only. Review the SQL/report, then rerun with --apply.");
    return;
  }

  const backupDir = resolve(`packages-core-backup-${Date.now()}`);
  mkdirSync(backupDir, { recursive: true });
  run("npx", ["wrangler", "d1", "export", "queens-salon-core", "--remote", "--config", "wrangler.core.jsonc", "--output", join(backupDir, "core-before.sql")]);
  run("npx", ["wrangler", "d1", "export", "queens-salon-packages", "--remote", "--config", "wrangler.packages.jsonc", "--output", join(backupDir, "packages-source.sql")]);
  run("npx", ["wrangler", "d1", "execute", "queens-salon-core", "--remote", "--config", "wrangler.core.jsonc", "--file", out]);

  const counts = Object.fromEntries([
    "package_catalog",
    "client_packages",
    "package_transactions",
  ].map((table) => [table, wranglerJson(
    "queens-salon-core",
    "wrangler.core.jsonc",
    `SELECT COUNT(*) AS count FROM ${table} WHERE salon_id = ${salonLiteral}`
  )[0]?.count ?? 0]));
  console.log(JSON.stringify({ applied: true, backupDir, counts }, null, 2));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
