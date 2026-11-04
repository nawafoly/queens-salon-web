#!/usr/bin/env node
// Isolated Cloudflare staging workflow. Never targets production resources.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configFile = resolve(root, 'wrangler.core.staging.jsonc');
const fixtureFile = resolve(root, 'scripts/fixtures/staging-inventory-demo.sql');

const expected = Object.freeze({
  worker: 'malikat-staging-core-api',
  coreName: 'malikat-staging-core',
  coreId: '3ffae051-12d6-4cce-a992-5e39245b80a3',
  attendanceName: 'malikat-staging-attendance',
  attendanceId: 'a4bf6f14-2fc9-4796-96c9-c16e48440a55',
  bucket: 'malikat-staging-files',
  salon: 'staging',
});

export function assertStagingConfig(config) {
  if (config.name !== expected.worker || config.vars?.SALON_ID !== expected.salon) {
    throw new Error('STAGING_SAFETY: Worker or tenant is not the isolated staging resource.');
  }
  if (config.triggers?.crons?.length) {
    throw new Error('STAGING_SAFETY: Automatic production-style cron jobs are forbidden.');
  }
  const bindings = config.d1_databases || [];
  const core = bindings.find((item) => item.binding === 'CORE_DB');
  const attendance = bindings.find((item) => item.binding === 'ATTENDANCE_DB');
  if (bindings.length !== 2 ||
      core?.database_name !== expected.coreName || core?.database_id !== expected.coreId ||
      attendance?.database_name !== expected.attendanceName || attendance?.database_id !== expected.attendanceId) {
    throw new Error('STAGING_SAFETY: D1 database bindings do not match approved staging IDs.');
  }
  const buckets = config.r2_buckets || [];
  if (buckets.length !== 1 || buckets[0].binding !== 'FILES_BUCKET' ||
      buckets[0].bucket_name !== expected.bucket) {
    throw new Error('STAGING_SAFETY: R2 binding is not the staging bucket.');
  }
  const origins = String(config.vars?.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
  if (!origins.length || origins.some((origin) => !/^https:\/\/[-\w]+\.vercel\.app$/.test(origin))) {
    throw new Error('STAGING_SAFETY: Only exact HTTPS Vercel preview origins are allowed.');
  }
  if (config.vars?.FIREBASE_PROJECT_ID === 'waves-hotel-dashboard') {
    throw new Error('STAGING_SAFETY: Production Firebase identity is forbidden.');
  }
  return expected;
}

function runWrangler(args) {
  const bin = resolve(root, 'node_modules/.bin/wrangler');
  const result = spawnSync(bin, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function main() {
  const config = JSON.parse(readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  assertStagingConfig(config);
  const fixture = readFileSync(fixtureFile, 'utf8');
  if (!fixture.includes('SYNTHETIC DATA ONLY') || !fixture.includes("'staging'")) {
    throw new Error('STAGING_SAFETY: Expected synthetic staging fixture is missing.');
  }
  const [action, confirmation, ...extras] = process.argv.slice(2);
  if (extras.length || !['check', 'migrate', 'seed', 'deploy'].includes(action)) {
    throw new Error('Usage: node scripts/staging-inventory-ops.mjs check|migrate|seed|deploy [--apply]');
  }
  if (action === 'check') {
    if (confirmation) throw new Error('The check action does not accept extra arguments.');
    console.log('STAGING_SAFETY_OK: isolated Worker, D1 databases, R2 bucket and exact CORS origins.');
    return;
  }
  if (confirmation !== '--apply') {
    throw new Error('STAGING_SAFETY: Remote operations require explicit --apply.');
  }

  if (action === 'migrate') {
    runWrangler(['d1', 'migrations', 'apply', expected.coreName, '--remote', '--config', configFile]);
  } else if (action === 'seed') {
    runWrangler(['d1', 'execute', expected.coreName, '--remote', '--config', configFile,
      '--file', fixtureFile, '--yes']);
  } else if (action === 'deploy') {
    runWrangler(['deploy', '--config', configFile]);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
