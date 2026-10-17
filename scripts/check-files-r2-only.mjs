#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const failures = [];
const worker = readFileSync('workers/core/repositories/files.js', 'utf8');
const client = readFileSync('src/services/CoreFilesService.ts', 'utf8');
const firebaseBootstrap = readFileSync('src/services/firebase.ts', 'utf8');
const wrangler = readFileSync('wrangler.core.jsonc', 'utf8');
const architecture = readFileSync('docs/files-r2-architecture.md', 'utf8');
const migration = readFileSync('migrations/core/0005_hr_settings_files.sql', 'utf8');

function stripJsoncComments(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        output += char;
      } else {
        output += ' ';
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        output += '  ';
        index += 1;
      } else {
        output += char === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      output += '  ';
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      output += '  ';
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

for (const [file, source] of [['workers/core/repositories/files.js', worker], ['src/services/CoreFilesService.ts', client]]) {
  if (/firebase\/storage|firebase\/firestore|getStorage\s*\(|uploadBytes\s*\(/i.test(source)) failures.push(`${file}: legacy Firebase binary storage dependency found`);
}

if (/firebase\/storage|getStorage\s*\(|\bstorageBucket\s*:|VITE_FIREBASE_STORAGE_BUCKET|\bexport\s+const\s+storage\b/i.test(firebaseBootstrap)) {
  failures.push('src/services/firebase.ts: retired Firebase Storage bootstrap dependency found');
}
if (!worker.includes('FILES_BUCKET')) failures.push('files repository: missing FILES_BUCKET binding');

let wranglerConfig = null;
try {
  wranglerConfig = JSON.parse(stripJsoncComments(wrangler).replace(/^\uFEFF/, ''));
} catch (error) {
  failures.push(`wrangler.core.jsonc: unable to parse active JSONC config (${error instanceof Error ? error.message : String(error)})`);
}
if (wranglerConfig) {
  const r2Buckets = Array.isArray(wranglerConfig.r2_buckets) ? wranglerConfig.r2_buckets : [];
  const hasActiveFilesBucket = r2Buckets.some(
    (entry) => entry && typeof entry === 'object' && entry.binding === 'FILES_BUCKET',
  );
  if (!hasActiveFilesBucket) failures.push('wrangler.core.jsonc: missing active FILES_BUCKET R2 binding');
}

if (!worker.includes('R2 ONLY')) failures.push('files repository: missing R2-only comment');
if (/intentionally commented|VITE_USE_R2_FILES=false|Creation commands for later/i.test(architecture)) {
  failures.push('files R2 architecture doc: retired pre-cutover state found');
}
if (!migration.includes('file_metadata')) failures.push('0005 migration: missing file_metadata table');
if (/\bblob\b|binary_data|file_content/i.test(migration)) failures.push('0005 migration: binary content must not be stored in D1');
if (failures.length) {
  console.error('Files R2-only guard failed');
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log('Files R2-only guard passed.');
