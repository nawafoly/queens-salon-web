import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertStagingConfig } from '../scripts/staging-inventory-ops.mjs';

const file = resolve('wrangler.core.staging.jsonc');
const config = JSON.parse(readFileSync(file, 'utf8'));

test('staging targets only its own Worker, two D1 databases, R2 and tenant', () => {
  assert.equal(assertStagingConfig(config).salon, 'staging');
});

test('staging refuses production Core database ID or Worker name', () => {
  assert.throws(() => assertStagingConfig({ ...config, name: 'queens-salon-core-api' }), /STAGING_SAFETY/);
  const changed = structuredClone(config);
  changed.d1_databases[0].database_id = 'd0565103-0b29-490d-8c10-c955e8d65c4a';
  assert.throws(() => assertStagingConfig(changed), /STAGING_SAFETY/);
});

test('staging refuses production Firebase project or wildcard CORS', () => {
  assert.throws(() => assertStagingConfig({ ...config, vars: {
    ...config.vars, FIREBASE_PROJECT_ID: 'waves-hotel-dashboard',
  } }), /STAGING_SAFETY/);
  assert.throws(() => assertStagingConfig({ ...config, vars: {
    ...config.vars, ALLOWED_ORIGINS: '*',
  } }), /STAGING_SAFETY/);
});

test('staging refuses scheduled cron triggers', () => {
  assert.throws(() => assertStagingConfig({ ...config, triggers: { crons: ['* * * * *'] } }), /STAGING_SAFETY/);
});
