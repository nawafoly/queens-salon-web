import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const wranglerCli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const recoveryRoot = resolve(root, '.migration-work', `local-recovery-v2-${timestamp}`);

const targets = {
  core: {
    label: 'Core',
    cwd: root,
    config: resolve(root, 'wrangler.core.jsonc'),
    database: 'queens-salon-core',
    stateRoot: resolve(root, '.wrangler/state'),
    requiredTables: ['clients', 'bookings', 'staff', 'app_users'],
    reportTables: [
      'clients',
      'bookings',
      'staff',
      'app_users',
      'cashback_wallet_transactions',
      'client_connect_conversations',
    ],
  },
  attendance: {
    label: 'Attendance',
    cwd: resolve(root, 'workers'),
    config: resolve(root, 'workers/wrangler.toml'),
    database: 'malikat-attendance',
    stateRoot: resolve(root, 'workers/.wrangler/state'),
    requiredTables: ['attendance_records', 'work_zones'],
    reportTables: ['attendance_records', 'work_zones'],
  },
};

function fail(message) {
  throw new Error(message);
}

function runWrangler(cwd, args, capture = false) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd,
    env: {
      ...process.env,
      CI: 'true',
      NO_D1_WARNING: 'true',
    },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    shell: false,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [
        'Wrangler command failed:',
        `node ${wranglerCli} ${args.join(' ')}`,
        String(result.stdout || ''),
        String(result.stderr || ''),
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  return String(result.stdout || '');
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
      } else if (entry.isFile() && /\.sqlite$/i.test(entry.name)) {
        files.push(path);
      }
    }
  }

  return files;
}

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function applicationTables(db) {
  return db
    .prepare(
      [
        'SELECT name FROM sqlite_master',
        "WHERE type='table'",
        'AND sql IS NOT NULL',
        "AND name NOT LIKE 'sqlite_%'",
        "AND name NOT LIKE '_cf_%'",
        "AND name <> 'd1_migrations'",
        'ORDER BY name',
      ].join(' ')
    )
    .all()
    .map((row) => String(row.name));
}

function findLocalDatabase(stateRoot, requiredTables) {
  const candidates = collectSqliteFiles(stateRoot);
  if (!candidates.length) {
    fail(`No local D1 SQLite files found under ${stateRoot}`);
  }

  for (const path of candidates) {
    let db;
    try {
      db = new DatabaseSync(path, { readOnly: true });
      const tables = new Set(applicationTables(db));
      const migrationTable = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='d1_migrations'"
        )
        .get();

      if (migrationTable && requiredTables.every((table) => tables.has(table))) {
        return { path, tables: [...tables] };
      }
    } catch {
      // Try the next SQLite file. Wrangler can keep multiple local D1 files.
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  fail(
    `Could not locate the expected local D1 database under ${stateRoot}; required tables: ${requiredTables.join(', ')}`
  );
}

function triggerDefinitions(db) {
  return db
    .prepare(
      [
        'SELECT name, sql FROM sqlite_master',
        "WHERE type='trigger'",
        'AND sql IS NOT NULL',
        'ORDER BY name',
      ].join(' ')
    )
    .all()
    .map((row) => ({ name: String(row.name), sql: String(row.sql) }));
}

function assertHealthy(db, label) {
  const integrityRows = db.prepare('PRAGMA integrity_check').all();
  const integrity = integrityRows.flatMap((row) =>
    Object.values(row).map((value) => String(value).toLowerCase())
  );

  if (integrity.length !== 1 || integrity[0] !== 'ok') {
    fail(`${label}: integrity_check failed: ${JSON.stringify(integrityRows)}`);
  }

  const fkRows = db.prepare('PRAGMA foreign_key_check').all();
  if (fkRows.length) {
    fail(`${label}: foreign_key_check violations=${fkRows.length}`);
  }
}

function clearLocalApplicationData(db, tables) {
  const triggers = triggerDefinitions(db);

  db.exec('PRAGMA foreign_keys=OFF;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    for (const trigger of triggers) {
      db.exec(`DROP TRIGGER IF EXISTS ${quoteIdent(trigger.name)};`);
    }
    for (const table of tables) {
      db.exec(`DELETE FROM ${quoteIdent(table)};`);
    }
    db.exec('COMMIT;');
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {}
    throw error;
  }

  return triggers;
}

function restoreTriggers(db, triggers) {
  for (const trigger of triggers) db.exec(trigger.sql);
  db.exec('PRAGMA foreign_keys=ON;');
}

function restoreLocalFile(backupPath, livePath) {
  rmSync(`${livePath}-wal`, { force: true });
  rmSync(`${livePath}-shm`, { force: true });
  copyFileSync(backupPath, livePath);
}

function reportCounts(db, names) {
  const existing = new Set(applicationTables(db));
  const counts = {};
  for (const name of names) {
    if (!existing.has(name)) continue;
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdent(name)}`).get();
    counts[name] = Number(row?.count || 0);
  }
  return counts;
}

function applyLocalMigrations(target) {
  console.log(`\n[${target.label}] applying canonical local migrations`);
  runWrangler(target.cwd, [
    'd1',
    'migrations',
    'apply',
    target.database,
    '--local',
    '--config',
    target.config,
    '--persist-to',
    target.stateRoot,
  ]);
}

function restoreTarget(name) {
  const target = targets[name];
  if (!target) fail(`Unknown target: ${name}`);
  if (!existsSync(target.config)) fail(`${target.label} config missing: ${target.config}`);

  applyLocalMigrations(target);

  const located = findLocalDatabase(target.stateRoot, target.requiredTables);
  const localDbPath = located.path;
  const localTables = located.tables.sort();

  const exportPath = resolve(recoveryRoot, `${name}-production-data-only.sql`);
  const localBackupPath = resolve(recoveryRoot, `${name}-local-before.sqlite`);

  console.log(`\n[${target.label}] local D1: ${localDbPath}`);
  console.log(`[${target.label}] canonical application tables: ${localTables.length}`);
  console.log(`[${target.label}] exporting Production data only for canonical tables`);

  const exportArgs = [
    'd1',
    'export',
    target.database,
    '--remote',
    '--config',
    target.config,
    '--output',
    exportPath,
    '--skip-confirmation',
    '--no-schema',
  ];
  for (const table of localTables) exportArgs.push('--table', table);

  // Important: export completes before local data is touched. If Production is
  // missing a canonical local table, Wrangler fails here and the local DB stays intact.
  runWrangler(target.cwd, exportArgs);

  if (!existsSync(exportPath) || statSync(exportPath).size < 1) {
    fail(`${target.label}: Production data-only export was not created`);
  }

  const exportSql = readFileSync(exportPath, 'utf8');
  if (/CREATE\s+TABLE/i.test(exportSql)) {
    fail(`${target.label}: expected data-only export, but schema SQL was detected`);
  }
  if (/legacy_paid_reconcile_backup_20260807/i.test(exportSql)) {
    fail(`${target.label}: historical legacy backup table leaked into canonical export`);
  }
  if (/INSERT\s+INTO\s+["']?d1_migrations["']?/i.test(exportSql)) {
    fail(`${target.label}: d1_migrations must never be restored from Production data`);
  }

  {
    const db = new DatabaseSync(localDbPath);
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      assertHealthy(db, `${target.label} before restore`);
    } finally {
      db.close();
    }
  }

  copyFileSync(localDbPath, localBackupPath);

  let db;
  try {
    db = new DatabaseSync(localDbPath);
    const tablesBefore = applicationTables(db);
    if (JSON.stringify(tablesBefore) !== JSON.stringify(localTables)) {
      fail(`${target.label}: local schema changed between export and restore`);
    }

    const triggers = clearLocalApplicationData(db, localTables);
    db.exec(exportSql);
    restoreTriggers(db, triggers);
    assertHealthy(db, `${target.label} after restore`);

    const counts = reportCounts(db, target.reportTables);
    console.log(`[${target.label}] restore PASS`);
    console.log(`[${target.label}] counts=${JSON.stringify(counts)}`);
    console.log(`[${target.label}] export=${exportPath}`);
    console.log(`[${target.label}] local_backup=${localBackupPath}`);
  } catch (error) {
    try {
      db?.close();
    } catch {}
    restoreLocalFile(localBackupPath, localDbPath);
    throw error;
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

if (!existsSync(wranglerCli)) {
  fail(`Local Wrangler CLI missing: ${wranglerCli}`);
}

mkdirSync(recoveryRoot, { recursive: true });

const requested = process.argv.slice(2);
const selected = requested.length ? requested : ['core', 'attendance'];
for (const name of selected) restoreTarget(name);

console.log(`\nLOCAL D1 RECOVERY PASS | recovery=${recoveryRoot}`);
