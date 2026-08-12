import fs from 'node:fs';

const file = 'workers/hr-core-worker.test.mjs';
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const brittle = `    for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }`;
const safe = `    // Execute the migration as one SQLite script. Splitting on semicolons
    // corrupts CREATE TRIGGER ... BEGIN ...; END; bodies (for example
    // 0016_employee_permissions.sql) and produces D1 "incomplete input".
    await db.exec(sql);`;

if (text.includes(safe)) {
  console.log('[hr-test-migrations] already uses D1 exec');
  process.exit(0);
}

const count = text.split(brittle).length - 1;
if (count !== 1) {
  throw new Error(`[hr-test-migrations] expected one brittle migration loop, found ${count}`);
}

text = text.replace(brittle, safe);
if (text.includes("sql.split(';')")) {
  throw new Error('[hr-test-migrations] semicolon-splitting migration runner remains');
}

fs.writeFileSync(file, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('[hr-test-migrations] migrations now execute as full D1 scripts');
