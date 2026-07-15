#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const files = [
  'workers/core/repositories/hr-employees.js',
  'workers/core/repositories/attendance.js',
  'workers/core/repositories/leaves.js',
  'workers/core/repositories/absences.js',
  'workers/core/repositories/payroll.js',
  'src/services/CoreHrService.ts',
];
const forbidden = [/firebase\/firestore/i, /FirestoreRestClient/, /getFirestore\s*\(/, /collection\s*\(/, /runQuery/i, /batchGet/i];
const failures = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const pattern of forbidden) if (pattern.test(source)) failures.push(`${file}: forbidden ${pattern}`);
  if (!/D1 ONLY/i.test(source)) failures.push(`${file}: missing D1-only architecture comment`);
}
const index = readFileSync('workers/core/index.js', 'utf8');
for (const route of ['/api/core/hr/employees', '/api/core/hr/attendance', '/api/core/hr/leaves', '/api/core/hr/absences', '/api/core/hr/payroll-periods']) {
  if (!index.includes(route)) failures.push(`workers/core/index.js: missing ${route}`);
}
if (failures.length) {
  console.error('HR D1-only guard failed');
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log('HR D1-only guard passed.');
