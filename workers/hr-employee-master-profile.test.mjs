import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import { getHrEmployee, upsertHrEmployee } from './core/repositories/hr-employees.js';

function splitMigrationStatements(sql) {
  const statements = [];
  const pushPlainStatements = (chunk) => {
    for (const statement of chunk.split(';').map((value) => value.trim()).filter(Boolean)) {
      statements.push(statement);
    }
  };

  const triggerPattern = /CREATE\s+TRIGGER\b[\s\S]*?^\s*END\s*;/gim;
  let cursor = 0;
  for (const match of sql.matchAll(triggerPattern)) {
    pushPlainStatements(sql.slice(cursor, match.index));
    statements.push(match[0].trim());
    cursor = match.index + match[0].length;
  }
  pushPlainStatements(sql.slice(cursor));
  return statements;
}

async function setup() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [
      {
        config: {
          type: 'worker',
          name: 'hr-employee-master-profile-test-worker',
          compatibilityDate: '2026-06-24',
          manifest: {
            mainModule: 'script-0.mjs',
            modulesRoot: process.cwd(),
            modules: {
              'script-0.mjs': { type: 'esm', contents: script },
            },
          },
          env: {
            CORE_DB: { type: 'd1', id: 'hr-employee-master-profile-test' },
          },
          exports: {},
        },
        dev: { rootPath: process.cwd() },
      },
    ],
  });
  const db = await mf.getD1Database('CORE_DB');
  for (const name of [
    '0001_core_schema.sql',
    '0005_hr_settings_files.sql',
    '0017_shift_control.sql',
    '0018_employee_payroll_settings.sql',
    '0022_shift_attendance_policy.sql',
    '0026_employee_master_profile_fields.sql',
  ]) {
    const sql = (await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'))
      .replace(/\r/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const statement of splitMigrationStatements(sql)) {
      await db.prepare(statement).run();
    }
  }
  return { mf, db };
}

function assertProfileFields(row, expected) {
  assert.equal(row.avatar_url, expected.avatar_url);
  assert.equal(row.bio, expected.bio);
  assert.equal(row.cv_url, expected.cv_url);
  assert.equal(Number(row.show_on_about), expected.show_on_about);
  assert.equal(Number(row.include_in_employee_management), expected.include_in_employee_management);
  assert.equal(Number(row.rating), expected.rating);
  assert.equal(Number(row.reviews_count), expected.reviews_count);
}

function assertEmployeeFields(employee, expected) {
  assertProfileFields(employee, expected);
  assert.equal(employee.employment.end_date, expected.end_date);
}

const actor = { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' };

test('Stage 4A.1 employee master fields from migration 0026 persist in real D1', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const expected = {
    avatar_url: 'https://cdn.example.com/employees/master-avatar.jpg',
    bio: 'Senior colorist and bridal styling lead.',
    cv_url: 'https://cdn.example.com/employees/master-cv.pdf',
    show_on_about: 1,
    include_in_employee_management: 1,
    rating: 4.75,
    reviews_count: 18,
    end_date: '2027-06-30',
  };

  const created = await upsertHrEmployee(db, 'main', {
    id: 'emp-master-fields',
    firebaseUid: 'uid-master-fields',
    name: 'Master Fields Employee',
    email: 'master-fields@example.com',
    phone: '0500000011',
    avatarUrl: expected.avatar_url,
    bio: expected.bio,
    cvUrl: expected.cv_url,
    showOnAbout: expected.show_on_about,
    includeInEmployeeManagement: expected.include_in_employee_management,
    rating: expected.rating,
    reviewsCount: expected.reviews_count,
    employment: {
      title: 'Senior Stylist',
      department: 'Salon Floor',
      startDate: '2026-01-01',
      endDate: expected.end_date,
      baseSalaryHalalas: 750000,
      leaveBalance: 21,
    },
  }, actor);

  assertEmployeeFields(created, expected);

  const rawProfile = await db.prepare(
    `SELECT avatar_url, bio, cv_url, show_on_about, include_in_employee_management, rating, reviews_count
     FROM employee_profiles
     WHERE salon_id = ? AND id = ?`
  ).bind('main', 'emp-master-fields').first();
  assertProfileFields(rawProfile, expected);

  const rawEmployment = await db.prepare(
    `SELECT end_date
     FROM employee_employment
     WHERE salon_id = ? AND employee_id = ?`
  ).bind('main', 'emp-master-fields').first();
  assert.equal(rawEmployment.end_date, expected.end_date);

  const read = await getHrEmployee(db, 'main', 'emp-master-fields');
  assertEmployeeFields(read, expected);

  const partialUpdate = await upsertHrEmployee(db, 'main', {
    id: 'emp-master-fields',
    name: 'Master Fields Employee Updated',
    employment: {
      title: 'Creative Lead',
    },
  }, actor);
  assert.equal(partialUpdate.name, 'Master Fields Employee Updated');
  assert.equal(partialUpdate.employment.title, 'Creative Lead');
  assertEmployeeFields(partialUpdate, expected);

  const cleared = await upsertHrEmployee(db, 'main', {
    id: 'emp-master-fields',
    avatarUrl: null,
    bio: null,
    cvUrl: null,
  }, actor);
  assert.equal(cleared.avatar_url, null);
  assert.equal(cleared.bio, null);
  assert.equal(cleared.cv_url, null);
  assert.equal(cleared.employment.end_date, expected.end_date);

  const clearedRead = await getHrEmployee(db, 'main', 'emp-master-fields');
  assert.equal(clearedRead.avatar_url, null);
  assert.equal(clearedRead.bio, null);
  assert.equal(clearedRead.cv_url, null);
  assert.equal(clearedRead.employment.end_date, expected.end_date);
});

test('Stage 4A.1 employee master fields preserve explicit zero values in real D1', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());

  const expected = {
    avatar_url: 'https://cdn.example.com/employees/zero-avatar.jpg',
    bio: 'Employee hidden from public listing for now.',
    cv_url: 'https://cdn.example.com/employees/zero-cv.pdf',
    show_on_about: 0,
    include_in_employee_management: 0,
    rating: 0,
    reviews_count: 0,
    end_date: '2026-12-31',
  };

  const created = await upsertHrEmployee(db, 'main', {
    id: 'emp-master-zeroes',
    firebaseUid: 'uid-master-zeroes',
    name: 'Master Zero Employee',
    email: 'master-zeroes@example.com',
    showOnAbout: 0,
    includeInEmployeeManagement: 0,
    rating: 0,
    reviewsCount: 0,
    avatarUrl: expected.avatar_url,
    bio: expected.bio,
    cvUrl: expected.cv_url,
    employment: {
      title: 'Stylist',
      endDate: expected.end_date,
    },
  }, actor);
  assertEmployeeFields(created, expected);

  const partialUpdate = await upsertHrEmployee(db, 'main', {
    id: 'emp-master-zeroes',
    email: 'master-zeroes-updated@example.com',
    employment: {
      department: 'Operations',
    },
  }, actor);

  assert.equal(partialUpdate.email, 'master-zeroes-updated@example.com');
  assert.equal(partialUpdate.employment.department, 'Operations');
  assertEmployeeFields(partialUpdate, expected);

  const read = await getHrEmployee(db, 'main', 'emp-master-zeroes');
  assertEmployeeFields(read, expected);
});
