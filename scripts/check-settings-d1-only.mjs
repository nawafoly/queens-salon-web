#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const failures = [];
const worker = readFileSync('workers/core/repositories/settings.js', 'utf8');
const client = readFileSync('src/services/CoreSettingsService.ts', 'utf8');
const legacy = readFileSync('src/services/AppSettingsService.ts', 'utf8');
for (const [file, source] of [['workers/core/repositories/settings.js', worker], ['src/services/CoreSettingsService.ts', client]]) {
  if (/firebase\/firestore|FirestoreRestClient|batchGet|runQuery/i.test(source)) failures.push(`${file}: operational Firestore dependency found`);
}
if (!legacy.includes('CoreSettingsService.get')) failures.push('AppSettingsService.ts: missing Core D1 settings read');
if (!legacy.includes('CoreSettingsService.save')) failures.push('AppSettingsService.ts: missing Core D1 settings write');
if (/firebase\/firestore|getDataSourceFlags|useSettingsD1|useCoreD1/.test(legacy)) failures.push('AppSettingsService.ts: runtime data-source flag or Firestore dependency found');
if (!legacy.includes('SETTINGS_D1_NOT_FOUND')) failures.push('AppSettingsService.ts: missing explicit no-fallback failure');
if (!readFileSync('workers/core/index.js', 'utf8').includes('/api/core/settings')) failures.push('workers/core/index.js: missing settings route');
if (failures.length) {
  console.error('Settings D1-only guard failed');
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log('Settings D1-only guard passed.');
