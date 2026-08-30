import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const wranglerCli = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const migrationsDir = resolve(root, "migrations/core");
const tempRoot = resolve(root, ".operational-integrity/p6-backup-restore");
const sourceRoot = resolve(tempRoot, "source");
const restoreRoot = resolve(tempRoot, "restore");
const backupPath = resolve(tempRoot, "core-data-backup.sql");
const sourceConfig = resolve(sourceRoot, "wrangler.jsonc");
const restoreConfig = resolve(restoreRoot, "wrangler.jsonc");

function fail(message) {
  throw new Error(message);
}

function runWrangler(cwd, args, capture = false) {
  const result = spawnSync(
    process.execPath,
    [wranglerCli, ...args],
    {
      cwd,
      env: {
        ...process.env,
        CI: "true",
        NO_D1_WARNING: "true",
      },
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
      shell: false,
    }
  );

  if (result.error) throw result.error;

  if (result.status !== 0) {
    throw new Error(
      [
        "Wrangler command failed:",
        `node ${wranglerCli} ${args.join(" ")}`,
        String(result.stdout || ""),
        String(result.stderr || ""),
      ].filter(Boolean).join("\n")
    );
  }

  return String(result.stdout || "");
}

function writeConfig(path) {
  writeFileSync(
    path,
    JSON.stringify(
      {
        name: "queens-salon-core-p6-restore-drill",
        compatibility_date: "2026-06-24",
        d1_databases: [
          {
            binding: "CORE_DB",
            database_name: "queens-salon-core",
            database_id: "d0565103-0b29-490d-8c10-c955e8d65c4a",
            migrations_dir: "migrations/core",
          },
        ],
        vars: {
          SALON_ID: "main",
        },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function collectSqliteFiles(directory) {
  if (!existsSync(directory)) return [];

  const files = [];
  const stack = [directory];

  while (stack.length) {
    const current = stack.pop();

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);

      if (entry.isDirectory()) {
        stack.push(path);
      } else if (
        entry.isFile() &&
        /\.sqlite$/i.test(entry.name)
      ) {
        files.push(path);
      }
    }
  }

  return files;
}

function openCoreSqlite(workspace, readOnly = true) {
  const candidates = collectSqliteFiles(workspace);

  if (!candidates.length) {
    fail(`No local D1 SQLite file found under ${workspace}`);
  }

  for (const path of candidates) {
    let db;

    try {
      db = new DatabaseSync(path, { readOnly });

      const migrationTable = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'"
        )
        .get();

      if (migrationTable) return db;

      db.close();
    } catch {
      try {
        db?.close();
      } catch {}
    }
  }

  fail(`Could not locate Core D1 SQLite database under ${workspace}`);
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function assertHealthy(db, label) {
  const integrityRows = db
    .prepare("PRAGMA integrity_check")
    .all();

  const integrity = integrityRows.flatMap((row) =>
    Object.values(row).map((value) =>
      String(value).toLowerCase()
    )
  );

  if (
    integrity.length !== 1 ||
    integrity[0] !== "ok"
  ) {
    fail(
      `${label}: integrity check failed: ${JSON.stringify(integrityRows)}`
    );
  }

  const fk = db
    .prepare("PRAGMA foreign_key_check")
    .all();

  if (fk.length) {
    fail(
      `${label}: foreign key violations = ${fk.length}`
    );
  }
}

function applicationTables(db) {
  return db
    .prepare(
      [
        "SELECT name FROM sqlite_master",
        "WHERE type='table'",
        "AND sql IS NOT NULL",
        "AND name NOT LIKE 'sqlite_%'",
        "AND name NOT LIKE '_cf_%'",
        "AND name <> 'd1_migrations'",
        "ORDER BY name",
      ].join(" ")
    )
    .all()
    .map((row) => String(row.name));
}

function rowCounts(db, tables) {
  const counts = {};

  for (const table of tables) {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM ${quoteIdent(table)}`
      )
      .get();

    counts[table] = Number(row?.count ?? 0);
  }

  return counts;
}

function triggerDefinitions(db) {
  return db
    .prepare(
      [
        "SELECT name, sql FROM sqlite_master",
        "WHERE type='trigger'",
        "AND sql IS NOT NULL",
        "ORDER BY name",
      ].join(" ")
    )
    .all()
    .map((row) => ({
      name: String(row.name),
      sql: String(row.sql),
    }));
}

function prepareRestoreDataTarget(db, tables) {
  const triggers = triggerDefinitions(db);

  db.exec("PRAGMA foreign_keys=OFF;");
  db.exec("BEGIN IMMEDIATE;");

  try {
    for (const trigger of triggers) {
      db.exec(
        `DROP TRIGGER IF EXISTS ${quoteIdent(trigger.name)};`
      );
    }

    for (const table of tables) {
      db.exec(
        `DELETE FROM ${quoteIdent(table)};`
      );
    }

    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {}

    throw error;
  }

  return triggers;
}

function restoreTriggers(db, triggers) {
  for (const trigger of triggers) {
    db.exec(trigger.sql);
  }

  db.exec("PRAGMA foreign_keys=ON;");
}

function cleanup() {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!existsSync(wranglerCli)) {
  fail(`Local Wrangler CLI is missing: ${wranglerCli}`);
}

if (!existsSync(migrationsDir)) {
  fail("migrations/core is missing");
}

cleanup();
mkdirSync(sourceRoot, { recursive: true });
mkdirSync(restoreRoot, { recursive: true });

cpSync(
  migrationsDir,
  resolve(sourceRoot, "migrations/core"),
  { recursive: true }
);

cpSync(
  migrationsDir,
  resolve(restoreRoot, "migrations/core"),
  { recursive: true }
);

writeConfig(sourceConfig);
writeConfig(restoreConfig);

try {
  // P6_BACKUP_RESTORE_DRILL_V2
  // Build a current-schema isolated source using the repository migrations.
  runWrangler(sourceRoot, [
    "d1",
    "migrations",
    "apply",
    "queens-salon-core",
    "--local",
    "--config",
    "wrangler.jsonc",
  ]);

  // Sentinel table is intentionally outside migrations so the drill proves
  // actual backed-up data survives the restore path.
  runWrangler(sourceRoot, [
    "d1",
    "execute",
    "queens-salon-core",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--command",
    [
      "CREATE TABLE IF NOT EXISTS __oi_backup_restore_probe",
      "(id TEXT PRIMARY KEY, value TEXT NOT NULL);",
      "INSERT INTO __oi_backup_restore_probe (id, value)",
      "VALUES ('p6', 'restore-me-exactly')",
      "ON CONFLICT(id) DO UPDATE SET value=excluded.value;",
    ].join(" "),
    "--yes",
  ]);

  let sourceTables = [];
  let sourceCounts = {};

  {
    const sourceDb = openCoreSqlite(sourceRoot, true);

    try {
      assertHealthy(sourceDb, "backup source");
      sourceTables = applicationTables(sourceDb);
      sourceCounts = rowCounts(sourceDb, sourceTables);
    } finally {
      sourceDb.close();
    }
  }

  if (!sourceTables.includes("__oi_backup_restore_probe")) {
    fail("Backup source sentinel table is missing");
  }

  // Cloudflare supports --no-schema and repeated --table. Keep schema authority
  // in migrations/core and export only application data. This avoids the known
  // D1 full-dump dependency-order problem during local imports.
  const exportArgs = [
    "d1",
    "export",
    "queens-salon-core",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--output",
    backupPath,
    "--skip-confirmation",
    "--no-schema",
  ];

  for (const table of sourceTables) {
    exportArgs.push("--table", table);
  }

  runWrangler(sourceRoot, exportArgs);

  if (!existsSync(backupPath)) {
    fail("D1 data export did not create a backup artifact");
  }

  const backupSize = statSync(backupPath).size;

  if (backupSize < 256) {
    fail(`Backup artifact is unexpectedly small: ${backupSize} bytes`);
  }

  const backupSql = readFileSync(backupPath, "utf8");

  if (
    !backupSql.includes("__oi_backup_restore_probe") ||
    !backupSql.includes("restore-me-exactly")
  ) {
    fail("Backup artifact does not contain the restore sentinel");
  }

  if (/INSERT\s+INTO\s+["']?d1_migrations["']?/i.test(backupSql)) {
    fail("Application data backup must not contain d1_migrations rows");
  }

  const sha256 = createHash("sha256")
    .update(backupSql)
    .digest("hex");

  // Reconstruct the restore target's schema from canonical migrations first.
  runWrangler(restoreRoot, [
    "d1",
    "migrations",
    "apply",
    "queens-salon-core",
    "--local",
    "--config",
    "wrangler.jsonc",
  ]);

  // Create only the drill sentinel table because it intentionally is not a
  // repository migration object.
  runWrangler(restoreRoot, [
    "d1",
    "execute",
    "queens-salon-core",
    "--local",
    "--config",
    "wrangler.jsonc",
    "--command",
    [
      "CREATE TABLE IF NOT EXISTS __oi_backup_restore_probe",
      "(id TEXT PRIMARY KEY, value TEXT NOT NULL);",
    ].join(" "),
    "--yes",
  ]);

  // P6_LOCAL_DATA_RESTORE_V1
  // Import the Cloudflare data-only export into the isolated local D1 SQLite
  // file directly. Full wrangler d1 execute --file schema+data currently
  // has a known dependency-order failure in local D1. Schema remains governed
  // by migrations; the backup artifact is the application data layer.
  {
    const restoredDb = openCoreSqlite(restoreRoot, false);
    let triggers = [];

    try {
      const restoredTablesBefore =
        applicationTables(restoredDb);

      if (
        JSON.stringify(restoredTablesBefore) !==
        JSON.stringify(sourceTables)
      ) {
        fail(
          [
            "Restore target schema does not match backup source before data load.",
            `source=${JSON.stringify(sourceTables)}`,
            `restore=${JSON.stringify(restoredTablesBefore)}`,
          ].join("\n")
        );
      }

      triggers = prepareRestoreDataTarget(
        restoredDb,
        sourceTables
      );

      restoredDb.exec(backupSql);

      restoreTriggers(restoredDb, triggers);
      assertHealthy(restoredDb, "restored database");

      const restoredTables = applicationTables(restoredDb);

      if (
        JSON.stringify(restoredTables) !==
        JSON.stringify(sourceTables)
      ) {
        fail(
          "Restored schema table set does not match backup source"
        );
      }

      const restoredCounts =
        rowCounts(restoredDb, restoredTables);

      if (
        JSON.stringify(restoredCounts) !==
        JSON.stringify(sourceCounts)
      ) {
        fail(
          [
            "Restored table row counts do not match backup source.",
            `source=${JSON.stringify(sourceCounts)}`,
            `restored=${JSON.stringify(restoredCounts)}`,
          ].join("\n")
        );
      }

      const probe = restoredDb
        .prepare(
          "SELECT value FROM __oi_backup_restore_probe WHERE id='p6'"
        )
        .get();

      if (
        String(probe?.value || "") !==
        "restore-me-exactly"
      ) {
        fail("Restored sentinel data does not match source data");
      }
    } finally {
      restoredDb.close();
    }
  }

  console.log(
    [
      "P6 backup/restore drill PASS",
      `backup_bytes=${backupSize}`,
      `backup_sha256=${sha256}`,
      `application_tables=${sourceTables.length}`,
      "schema_source=migrations/core",
      "backup_mode=data-only",
      "source_integrity=ok",
      "restore_integrity=ok",
      "restore_foreign_keys=ok",
      "restore_row_counts=exact",
      "restore_sentinel=exact",
    ].join(" | ")
  );
} finally {
  cleanup();
}
