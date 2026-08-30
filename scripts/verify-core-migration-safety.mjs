import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const migrationsDir = resolve(root, "migrations/core");
const tempRoot = resolve(root, ".operational-integrity/p5-migrations");
const freshPersist = resolve(tempRoot, "fresh-state");
const upgradePersist = resolve(tempRoot, "upgrade-state");
const preMigrationsDir = resolve(tempRoot, "pre-migrations");
const preConfig = resolve(root, ".wrangler.p5.pre.generated.jsonc");
const fullConfig = resolve(root, ".wrangler.p5.full.generated.jsonc");
const wranglerCli = resolve(root, "node_modules/wrangler/bin/wrangler.js");

if (!existsSync(wranglerCli)) {
  fail(`Local Wrangler CLI is missing: ${wranglerCli}`);
}

function fail(message) {
  throw new Error(message);
}

function runWrangler(args, options = {}) {
  // P5_WINDOWS_SPAWN_SAFETY_V1
  // Spawn Wrangler through the current Node runtime directly. This avoids
  // Node 24 / Windows spawnSync EINVAL failures when launching command shims.
  const result = spawnSync(
    process.execPath,
    [wranglerCli, ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        CI: "true",
        NO_D1_WARNING: "true",
      },
      encoding: "utf8",
      stdio: options.capture ? "pipe" : "inherit",
      shell: false,
    }
  );

  if (result.error) throw result.error;

  if (result.status !== 0) {
    const stdout = String(result.stdout || "");
    const stderr = String(result.stderr || "");
    throw new Error(
      [
        "Wrangler command failed:",
        `node ${wranglerCli} ${args.join(" ")}`,
        stdout,
        stderr,
      ].filter(Boolean).join("\n")
    );
  }

  return String(result.stdout || "");
}

function jsonRows(output) {
  const text = String(output || "").trim();
  if (!text) return [];

  const parsed = JSON.parse(text);
  const rows = [];

  function visit(value) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value.results)) {
      for (const row of value.results) {
        if (row && typeof row === "object") rows.push(row);
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") visit(child);
    }
  }

  visit(parsed);
  return rows;
}

function executeJson(config, persistTo, command) {
  return jsonRows(
    runWrangler(
      [
        "d1",
        "execute",
        "queens-salon-core",
        "--local",
        "--config",
        config,
        "--persist-to",
        persistTo,
        "--command",
        command,
        "--json",
      ],
      { capture: true }
    )
  );
}

function scalar(rows, key) {
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  fail(`Expected scalar key "${key}" was not returned`);
}

function migrationFiles() {
  if (!existsSync(migrationsDir)) fail("migrations/core is missing");

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  if (files.length < 2) {
    fail("Migration safety requires at least two Core migrations");
  }

  let previous = 0;

  for (const file of files) {
    const match = /^(\d{4})_[A-Za-z0-9_-]+\.sql$/.exec(file);
    if (!match) fail(`Invalid Core migration filename: ${file}`);

    const number = Number(match[1]);
    if (number < previous) {
      fail(`Core migration number moves backwards at ${file}`);
    }

    const sql = readFileSync(resolve(migrationsDir, file), "utf8").trim();
    if (!sql) fail(`Empty Core migration: ${file}`);

    previous = number;
  }

  return files;
}

function writeConfig(path, migrationDirectory) {
  writeFileSync(
    path,
    JSON.stringify(
      {
        name: "queens-salon-core-p5-verifier",
        main: "workers/core/worker.js",
        compatibility_date: "2026-06-24",
        d1_databases: [
          {
            binding: "CORE_DB",
            database_name: "queens-salon-core",
            database_id: "d0565103-0b29-490d-8c10-c955e8d65c4a",
            migrations_dir: migrationDirectory,
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

function applyMigrations(config, persistTo) {
  runWrangler([
    "d1",
    "migrations",
    "apply",
    "queens-salon-core",
    "--local",
    "--config",
    config,
    "--persist-to",
    persistTo,
  ]);
}

// P5_LOCAL_SQLITE_INTEGRITY_V1
// Wrangler/D1 intentionally blocks some PRAGMA statements through d1 execute.
// After each local migration command has exited, inspect the isolated SQLite
// file directly with Node's built-in SQLite driver.
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

function openCoreSqlite(persistTo, readOnly = true) {
  const candidates = collectSqliteFiles(persistTo);

  if (!candidates.length) {
    fail(`No local D1 SQLite file found under ${persistTo}`);
  }

  for (const path of candidates) {
    let db;

    try {
      db = new DatabaseSync(path, { readOnly });
      db.prepare(
        "SELECT COUNT(*) AS count FROM d1_migrations"
      ).get();

      return db;
    } catch {
      try {
        db?.close();
      } catch {}
    }
  }

  fail(
    `Could not locate the Core D1 SQLite database under ${persistTo}`
  );
}

function assertDatabaseHealthy(config, persistTo, expectedMigrationCount, label) {
  void config;

  const db = openCoreSqlite(persistTo, true);

  try {
    const integrityRows =
      db.prepare("PRAGMA integrity_check").all();

    const integrityValues =
      integrityRows.flatMap((row) =>
        Object.values(row).map((value) =>
          String(value).toLowerCase()
        )
      );

    if (
      integrityValues.length !== 1 ||
      integrityValues[0] !== "ok"
    ) {
      fail(
        `${label}: PRAGMA integrity_check failed: ${JSON.stringify(integrityRows)}`
      );
    }

    const foreignKeyViolations =
      db.prepare("PRAGMA foreign_key_check").all();

    if (foreignKeyViolations.length !== 0) {
      fail(
        `${label}: foreign key violations = ${foreignKeyViolations.length}`
      );
    }

    const migrationRow =
      db.prepare(
        "SELECT COUNT(*) AS count FROM d1_migrations"
      ).get();

    const applied = Number(migrationRow?.count ?? 0);

    if (applied !== expectedMigrationCount) {
      fail(
        `${label}: expected ${expectedMigrationCount} applied migrations, found ${applied}`
      );
    }
  } finally {
    db.close();
  }
}

function cleanup() {
  rmSync(tempRoot, { recursive: true, force: true });
  rmSync(preConfig, { force: true });
  rmSync(fullConfig, { force: true });
}

const files = migrationFiles();

cleanup();
mkdirSync(preMigrationsDir, { recursive: true });

try {
  // -----------------------------------------------------------------------
  // Fresh database path: every migration must apply from zero.
  // -----------------------------------------------------------------------
  writeConfig(fullConfig, "migrations/core");

  applyMigrations(fullConfig, freshPersist);
  assertDatabaseHealthy(
    fullConfig,
    freshPersist,
    files.length,
    "fresh database"
  );

  // -----------------------------------------------------------------------
  // Existing database path: simulate a deployed database one migration
  // behind, preserve pre-existing data, then apply the current migration.
  // -----------------------------------------------------------------------
  for (const file of files.slice(0, -1)) {
    cpSync(
      resolve(migrationsDir, file),
      resolve(preMigrationsDir, file)
    );
  }

  writeConfig(
    preConfig,
    ".operational-integrity/p5-migrations/pre-migrations"
  );

  applyMigrations(preConfig, upgradePersist);
  assertDatabaseHealthy(
    preConfig,
    upgradePersist,
    files.length - 1,
    "pre-upgrade database"
  );

  {
    const db = openCoreSqlite(upgradePersist, false);

    try {
      db.exec(
        [
          "CREATE TABLE IF NOT EXISTS __oi_upgrade_sentinel",
          "(id TEXT PRIMARY KEY, value TEXT NOT NULL);",
          "INSERT INTO __oi_upgrade_sentinel (id, value)",
          "VALUES ('p5', 'preserve-me')",
          "ON CONFLICT(id) DO UPDATE SET value=excluded.value;",
        ].join(" ")
      );
    } finally {
      db.close();
    }
  }

  applyMigrations(fullConfig, upgradePersist);
  assertDatabaseHealthy(
    fullConfig,
    upgradePersist,
    files.length,
    "upgraded database"
  );

  let sentinel = "";

  {
    const db = openCoreSqlite(upgradePersist, true);

    try {
      sentinel = String(
        db.prepare(
          "SELECT value FROM __oi_upgrade_sentinel WHERE id='p5'"
        ).get()?.value ?? ""
      );
    } finally {
      db.close();
    }
  }

  if (sentinel !== "preserve-me") {
    fail("Upgrade path did not preserve pre-existing database data");
  }

  console.log(
    `P5 migration safety PASS: ${files.length} migrations, fresh + upgrade + integrity + FK checks`
  );
} finally {
  cleanup();
}
