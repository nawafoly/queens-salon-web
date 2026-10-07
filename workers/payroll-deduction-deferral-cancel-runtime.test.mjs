import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  cancelPayrollObligation,
} from './core/repositories/payroll-obligations.js';

function splitMigrationStatements(sql) {
  const statements = [];

  const pushPlainStatements = (chunk) => {
    for (
      const statement of chunk
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean)
    ) {
      statements.push(statement);
    }
  };

  const triggerPattern =
    /CREATE\s+TRIGGER\b[\s\S]*?^\s*END\s*;/gim;

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
  const script =
    'export default { fetch(){ return new Response("ok") } }';

  const mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'payroll-deferral-cancel-test',
          compatibilityDate: '2026-06-24',
          manifest: {
            mainModule: 'script-0.mjs',
            modulesRoot: process.cwd(),
            modules: {
              'script-0.mjs': {
                type: 'esm',
                contents: script,
              },
            },
          },
          env: {
            CORE_DB: {
              type: 'd1',
              id: 'payroll-deferral-cancel-test-db',
            },
          },
          exports: {},
        },
        dev: {
          rootPath: process.cwd(),
        },
      },
    ],
  });

  const db = await mf.getD1Database('CORE_DB');

  for (const name of [
    '0001_core_schema.sql',
    '0005_hr_settings_files.sql',
    '0016_payroll_snapshots.sql',
    '0030_employee_payroll_obligations.sql',
    '0093_payroll_partial_deduction_deferrals.sql',
  ]) {
    const sql = (
      await readFile(
        new URL(
          `../migrations/core/${name}`,
          import.meta.url
        ),
        'utf8'
      )
    )
      .replace(/\r/g, '')
      .split('\n')
      .filter(
        (line) => !line.trim().startsWith('--')
      )
      .join('\n');

    for (const statement of splitMigrationStatements(sql)) {
      await db.prepare(statement).run();
    }
  }

  return { mf, db };
}

const actor = {
  uid: 'uid-admin',
  email: 'admin@example.com',
};

async function seedGenericDeferral(
  db,
  suffix,
  amountHalalas = 15913
) {
  const obligationId =
    `payroll_obligation_deferral_${suffix}`;

  const installmentId =
    `payroll_obligation_installment_${suffix}`;

  const deferralId =
    `payroll_deduction_deferral_${suffix}`;

  const requestKey =
    `payroll-ui-${suffix}`;

  const now =
    '2026-10-07T20:00:00.000Z';

  await db
    .prepare(
      `INSERT INTO employee_payroll_obligations (
         id,
         salon_id,
         employee_id,
         recurring_deduction_id,
         obligation_kind,
         source_type,
         source_ref,
         original_payroll_month,
         original_amount_halalas,
         remaining_amount_halalas,
         status,
         reason,
         note,
         created_by_uid,
         created_by_email,
         created_at,
         updated_at
       )
       VALUES (
         ?, 'main', '1002', NULL,
         'payroll_deduction_deferral',
         'payroll_deduction_deferral',
         ?,
         '2026-09',
         ?,
         ?,
         'scheduled',
         'طلب من الإدارة',
         NULL,
         ?,
         ?,
         ?,
         ?
       )`
    )
    .bind(
      obligationId,
      `payroll_deduction_deferral:1002:${requestKey}`,
      amountHalalas,
      amountHalalas,
      actor.uid,
      actor.email,
      now,
      now
    )
    .run();

  await db
    .prepare(
      `INSERT INTO employee_payroll_obligation_installments (
         id,
         salon_id,
         obligation_id,
         sequence_no,
         target_payroll_month,
         amount_halalas,
         status,
         applied_payroll_entry_id,
         applied_at,
         deferred_from_installment_id,
         superseded_by_installment_id,
         decision_reason,
         note,
         created_by_uid,
         created_by_email,
         created_at,
         updated_at
       )
       VALUES (
         ?, 'main', ?, 1, '2026-10', ?,
         'scheduled',
         NULL, NULL, NULL, NULL,
         'طلب من الإدارة',
         NULL,
         ?, ?, ?, ?
       )`
    )
    .bind(
      installmentId,
      obligationId,
      amountHalalas,
      actor.uid,
      actor.email,
      now,
      now
    )
    .run();

  await db
    .prepare(
      `INSERT INTO payroll_deduction_deferrals (
         id,
         salon_id,
         employee_id,
         request_key,
         source_payroll_month,
         target_payroll_month,
         amount_halalas,
         status,
         reason,
         note,
         obligation_id,
         created_by_uid,
         created_by_email,
         created_at,
         updated_at
       )
       VALUES (
         ?, 'main', '1002', ?,
         '2026-09', '2026-10', ?,
         'active',
         'طلب من الإدارة',
         NULL,
         ?, ?, ?, ?, ?
       )`
    )
    .bind(
      deferralId,
      requestKey,
      amountHalalas,
      obligationId,
      actor.uid,
      actor.email,
      now,
      now
    )
    .run();

  return {
    obligationId,
    installmentId,
    deferralId,
  };
}

test(
  'cancelling a generic payroll deduction deferral cancels canonical ledger and obligation together',
  async (t) => {
    const { mf, db } = await setup();

    t.after(() => mf.dispose());

    const ids =
      await seedGenericDeferral(
        db,
        'canonical-cancel'
      );

    const result =
      await cancelPayrollObligation(
        db,
        'main',
        ids.obligationId,
        {
          reason:
            'إعادة توزيع الخصومات على المسارات الصحيحة',
        },
        actor
      );

    assert.equal(result.status, 'cancelled');

    const deferral = await db
      .prepare(
        `SELECT *
           FROM payroll_deduction_deferrals
          WHERE id = ?`
      )
      .bind(ids.deferralId)
      .first();

    assert.equal(deferral.status, 'cancelled');
    assert.equal(
      deferral.cancellation_reason,
      'إعادة توزيع الخصومات على المسارات الصحيحة'
    );
    assert.equal(
      deferral.cancelled_by_uid,
      actor.uid
    );

    const obligation = await db
      .prepare(
        `SELECT *
           FROM employee_payroll_obligations
          WHERE id = ?`
      )
      .bind(ids.obligationId)
      .first();

    assert.equal(
      obligation.status,
      'cancelled'
    );

    const installment = await db
      .prepare(
        `SELECT *
           FROM employee_payroll_obligation_installments
          WHERE id = ?`
      )
      .bind(ids.installmentId)
      .first();

    assert.equal(
      installment.status,
      'cancelled'
    );

    const retry =
      await cancelPayrollObligation(
        db,
        'main',
        ids.obligationId,
        {
          reason:
            'إعادة توزيع الخصومات على المسارات الصحيحة',
        },
        actor
      );

    assert.equal(retry.status, 'cancelled');
  }
);

test(
  'generic deferral cancellation is atomic when obligation cancellation fails',
  async (t) => {
    const { mf, db } = await setup();

    t.after(() => mf.dispose());

    const ids =
      await seedGenericDeferral(
        db,
        'rollback'
      );

    await db
      .prepare(
        `CREATE TRIGGER force_deferral_cancel_failure
         BEFORE UPDATE OF status
         ON employee_payroll_obligations
         WHEN NEW.id = '${ids.obligationId}'
          AND NEW.status = 'cancelled'
         BEGIN
           SELECT RAISE(
             ABORT,
             'forced_deferral_cancel_failure'
           );
         END;`
      )
      .run();

    await assert.rejects(
      () =>
        cancelPayrollObligation(
          db,
          'main',
          ids.obligationId,
          {
            reason: 'forced rollback test',
          },
          actor
        ),
      /forced_deferral_cancel_failure/
    );

    const deferral = await db
      .prepare(
        `SELECT status
           FROM payroll_deduction_deferrals
          WHERE id = ?`
      )
      .bind(ids.deferralId)
      .first();

    const obligation = await db
      .prepare(
        `SELECT status
           FROM employee_payroll_obligations
          WHERE id = ?`
      )
      .bind(ids.obligationId)
      .first();

    const installment = await db
      .prepare(
        `SELECT status
           FROM employee_payroll_obligation_installments
          WHERE id = ?`
      )
      .bind(ids.installmentId)
      .first();

    assert.equal(deferral.status, 'active');
    assert.equal(obligation.status, 'scheduled');
    assert.equal(installment.status, 'scheduled');
  }
);

test(
  'generic deferral obligation fails closed when canonical ledger row is missing',
  async (t) => {
    const { mf, db } = await setup();

    t.after(() => mf.dispose());

    const ids =
      await seedGenericDeferral(
        db,
        'missing-ledger'
      );

    await db
      .prepare(
        `DELETE FROM payroll_deduction_deferrals
          WHERE id = ?`
      )
      .bind(ids.deferralId)
      .run();

    await assert.rejects(
      () =>
        cancelPayrollObligation(
          db,
          'main',
          ids.obligationId,
          {
            reason: 'must fail closed',
          },
          actor
        ),
      {
        code:
          'core_payroll:deduction_deferral_canonical_record_missing',
      }
    );

    const obligation = await db
      .prepare(
        `SELECT status
           FROM employee_payroll_obligations
          WHERE id = ?`
      )
      .bind(ids.obligationId)
      .first();

    const installment = await db
      .prepare(
        `SELECT status
           FROM employee_payroll_obligation_installments
          WHERE id = ?`
      )
      .bind(ids.installmentId)
      .first();

    assert.equal(obligation.status, 'scheduled');
    assert.equal(installment.status, 'scheduled');
  }
);
