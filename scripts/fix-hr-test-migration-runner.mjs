import fs from 'node:fs';

const file = 'workers/hr-core-worker.test.mjs';
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const helper = `function splitMigrationStatements(sql) {
  const statements = [];
  const pushPlainStatements = (chunk) => {
    for (const statement of chunk.split(';').map((value) => value.trim()).filter(Boolean)) {
      statements.push(statement);
    }
  };

  // Keep CREATE TRIGGER ... BEGIN ... END; intact. A plain semicolon split
  // corrupts trigger bodies, while D1 exec treats multiline CREATE TABLE
  // scripts as separate lines in Miniflare. This splitter preserves both.
  const triggerPattern = /CREATE\\s+TRIGGER\\b[\\s\\S]*?^\\s*END\\s*;/gim;
  let cursor = 0;
  for (const match of sql.matchAll(triggerPattern)) {
    pushPlainStatements(sql.slice(cursor, match.index));
    statements.push(match[0].trim());
    cursor = match.index + match[0].length;
  }
  pushPlainStatements(sql.slice(cursor));
  return statements;
}
`;

if (!text.includes('function splitMigrationStatements(sql)')) {
  const marker = "import { createBooking, rescheduleBooking } from './core/repositories/bookings.js';\n";
  if (!text.includes(marker)) {
    throw new Error('[hr-test-migrations] import insertion marker not found');
  }
  text = text.replace(marker, `${marker}\n${helper}`);
}

const brittle = `    for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }`;
const execRunner = `    // Execute the migration as one SQLite script. Splitting on semicolons
    // corrupts CREATE TRIGGER ... BEGIN ...; END; bodies (for example
    // 0016_employee_permissions.sql) and produces D1 "incomplete input".
    await db.exec(sql);`;
const triggerAware = `    for (const statement of splitMigrationStatements(sql)) {
      await db.prepare(statement).run();
    }`;

if (!text.includes(triggerAware)) {
  if (text.includes(execRunner)) {
    text = text.replace(execRunner, triggerAware);
  } else if (text.includes(brittle)) {
    text = text.replace(brittle, triggerAware);
  } else {
    throw new Error('[hr-test-migrations] migration execution block not found');
  }
}

if (!text.includes('function splitMigrationStatements(sql)') || !text.includes(triggerAware)) {
  throw new Error('[hr-test-migrations] trigger-aware migration runner was not installed');
}
if (text.includes('await db.exec(sql);')) {
  throw new Error('[hr-test-migrations] multiline D1 exec runner remains');
}

fs.writeFileSync(file, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('[hr-test-migrations] trigger-aware migration runner installed');
