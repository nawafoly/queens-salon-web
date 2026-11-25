import { readdir, readFile } from 'node:fs/promises';

const migrationDirectory =
  new URL('../../migrations/core/', import.meta.url);

export async function listCoreTestMigrations() {
  return (await readdir(migrationDirectory))
    .filter(name => name.endsWith('.sql'))
    .sort();
}

export async function applyCoreTestMigrations(db) {
  const names = await listCoreTestMigrations();

  for (const name of names) {
    try {
      const sql = await readFile(
        new URL(name, migrationDirectory),
        'utf8'
      );

      await db.prepare(sql).run();

    } catch (error) {
      throw new Error(
        `Core test migration ${name}: ${error.message}`,
        { cause: error }
      );
    }
  }

  const columns = await db.prepare(
    "PRAGMA table_info('employee_employment')"
  ).all();

  for (const name of [
    'attendance_policy_authority',
    'attendance_policy_revision'
  ]) {
    if (!columns.results.some(column => column.name === name)) {
      throw new Error(`Missing employment column: ${name}`);
    }
  }

  const tables = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  ).all();

  for (const name of [
    'employee_offboarding_fences',
    'employee_attendance_policy_periods',
    'payroll_approval_snapshots',
    'payroll_approval_transaction_guards'
  ]) {
    if (!tables.results.some(table => table.name === name)) {
      throw new Error(`Missing Core test table: ${name}`);
    }
  }

  return names;
}
