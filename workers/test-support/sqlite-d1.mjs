import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export function sqliteD1(database = new DatabaseSync(':memory:')) {
  const prepare = (sql, params = []) => ({
    bind: (...bindings) => prepare(sql, bindings),
    async first() { const row = database.prepare(sql).get(...params); return row ? {...row} : null; },
    async all() { return {results: database.prepare(sql).all(...params).map(row => ({...row}))}; },
    async run() { return {meta:{changes:Number(database.prepare(sql).run(...params).changes)}}; },
    __run() {
      if (/^\s*(SELECT|WITH)\b/i.test(sql)) return {results:database.prepare(sql).all(...params).map(row=>({...row}))};
      return {meta:{changes:Number(database.prepare(sql).run(...params).changes)}};
    },
  });
  return {
    database, prepare,
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(statement.__run());
        database.exec('COMMIT');
        return results;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
  };
}

export function migratedD1(relativeDirectory) {
  const db = sqliteD1();
  db.database.exec('PRAGMA foreign_keys=ON');
  const directory = new URL(relativeDirectory, import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    try { db.database.exec(readFileSync(new URL(name,directory),'utf8')); }
    catch (error) { throw new Error(`Migration ${name}: ${error.message}`,{cause:error}); }
  }
  return db;
}
