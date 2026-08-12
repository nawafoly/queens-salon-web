import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const file = 'workers/frontend-core-migration.test.mjs';
const current = fs.readFileSync(file, 'utf8');
const sentinel = 'test("Phase 5 migration adds admin operations without forcing unique client phones"';

if (current.includes(sentinel)) {
  console.log('[frontend-test-repair] full migration test suite already present');
  process.exit(0);
}

const sourceRef = 'ba4638a8bbc13ff18164bf89491d504c2664a053';
const restored = execFileSync(
  'git',
  ['show', `${sourceRef}:${file}`],
  { encoding: 'utf8' }
);

if (!restored.includes(sentinel)) {
  throw new Error('[frontend-test-repair] recovery source is missing expected full-suite sentinel');
}
if (!restored.includes('booking pages route slot availability through the selected data source')) {
  throw new Error('[frontend-test-repair] recovery source does not contain the expected pre-cutover booking test');
}

fs.writeFileSync(file, restored, 'utf8');
console.log(`[frontend-test-repair] restored complete test suite from ${sourceRef}`);
