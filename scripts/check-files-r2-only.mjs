#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const failures = [];
const worker = readFileSync('workers/core/repositories/files.js', 'utf8');
const client = readFileSync('src/services/CoreFilesService.ts', 'utf8');
const migration = readFileSync('migrations/core/0005_hr_settings_files.sql', 'utf8');
for (const [file, source] of [['workers/core/repositories/files.js', worker], ['src/services/CoreFilesService.ts', client]]) {
  if (/firebase\/storage|firebase\/firestore|getStorage\s*\(|uploadBytes\s*\(/i.test(source)) failures.push(`${file}: legacy Firebase binary storage dependency found`);
}
if (!worker.includes('FILES_BUCKET')) failures.push('files repository: missing FILES_BUCKET binding');
if (!worker.includes('R2 ONLY')) failures.push('files repository: missing R2-only comment');
if (!migration.includes('file_metadata')) failures.push('0005 migration: missing file_metadata table');
if (/\bblob\b|binary_data|file_content/i.test(migration)) failures.push('0005 migration: binary content must not be stored in D1');
if (failures.length) {
  console.error('Files R2-only guard failed');
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log('Files R2-only guard passed.');
