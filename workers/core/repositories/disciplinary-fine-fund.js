// CORE D1 ONLY — Article 73 restricted disciplinary-fine fund custody.

import {
  changes,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';

const APPROVAL_AUTHORITIES = new Set(['labor_committee', 'ministry']);

function positiveMoney(value) {
  const amount = Math.round(Number(value));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError(400, 'core_discipline:fine_fund_amount_invalid');
  }
  return amount;
}

function requiredText(value, code, max = 1500) {
  const text = cleanText(value);
  if (!text || text.length > max) throw new AppError(400, code);
  return text;
}

async function ensureBalance(db, salonId) {
  const now = nowIso();
  await dbRun(
    db,
    `INSERT OR IGNORE INTO employee_disciplinary_fine_fund_balances (
      salon_id, balance_halalas, last_entry_id, version, updated_at
    ) VALUES (?, 0, NULL, 0, ?)`,
    [salonId, now]
  );
  const row = await dbFirst(
    db,
    `SELECT * FROM employee_disciplinary_fine_fund_balances
      WHERE salon_id = ? LIMIT 1`,
    [salonId]
  );
  if (!row) throw new AppError(500, 'core_discipline:fine_fund_balance_missing');
  return row;
}

export async function getDisciplinaryFineFundBalance(db, salonId) {
  const row = await ensureBalance(db, salonId);
  return {
    salonId,
    balanceHalalas: Number(row.balance_halalas || 0),
    lastEntryId: cleanText(row.last_entry_id) || null,
    version: Number(row.version || 0),
    updatedAt: row.updated_at,
  };
}

export async function listDisciplinaryFineFundLedger(db, salonId, query = {}) {
  const entryKind = cleanText(query.entryKind || query.entry_kind).toLowerCase();
  const disciplinaryCaseId = cleanText(query.disciplinaryCaseId || query.disciplinary_case_id);
  const where = ['salon_id = ?'];
  const params = [salonId];

  if (entryKind) {
    where.push('entry_kind = ?');
    params.push(entryKind);
  }
  if (disciplinaryCaseId) {
    where.push('disciplinary_case_id = ?');
    params.push(disciplinaryCaseId);
  }

  return dbAll(
    db,
    `SELECT * FROM employee_disciplinary_fine_fund_ledger
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT 1000`,
    params
  );
}

export async function createDisciplinaryFineFundDisbursement(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const operationId = requiredId(
    data.operationId || data.operation_id,
    'operationId'
  );
  const amountHalalas = positiveMoney(data.amountHalalas ?? data.amount_halalas);
  const benefitPurpose = requiredText(
    data.benefitPurpose || data.benefit_purpose,
    'core_discipline:fine_fund_benefit_purpose_required'
  );
  const beneficiaryDescription = requiredText(
    data.beneficiaryDescription || data.beneficiary_description,
    'core_discipline:fine_fund_beneficiary_required'
  );
  const approvalAuthority = cleanText(
    data.approvalAuthority || data.approval_authority
  ).toLowerCase();
  if (!APPROVAL_AUTHORITIES.has(approvalAuthority)) {
    throw new AppError(400, 'core_discipline:fine_fund_approval_authority_invalid');
  }
  const approvalReference = requiredText(
    data.approvalReference || data.approval_reference,
    'core_discipline:fine_fund_approval_reference_required'
  );

  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_disciplinary_fine_fund_ledger
      WHERE salon_id = ? AND entry_kind = 'disbursement'
        AND source_type = 'benefit_disbursement' AND source_id = ? LIMIT 1`,
    [salonId, operationId]
  );
  if (existing) {
    const same =
      Number(existing.amount_halalas || 0) === amountHalalas &&
      cleanText(existing.benefit_purpose) === benefitPurpose &&
      cleanText(existing.beneficiary_description) === beneficiaryDescription &&
      cleanText(existing.approval_authority) === approvalAuthority &&
      cleanText(existing.approval_reference) === approvalReference;
    if (!same) throw new AppError(409, 'core_discipline:fine_fund_operation_conflict');
    return {
      entry: existing,
      state: await getDisciplinaryFineFundBalance(db, salonId),
      idempotent: true,
    };
  }

  const balance = await ensureBalance(db, salonId);
  const before = Number(balance.balance_halalas || 0);
  if (before < amountHalalas) {
    throw new AppError(409, 'core_discipline:fine_fund_insufficient_balance');
  }
  const after = before - amountHalalas;
  const entryId = generatedId('disciplinary_fine_disbursement');
  const now = nowIso();

  const results = await dbBatch(db, [
    {
      sql: `UPDATE employee_disciplinary_fine_fund_balances
               SET balance_halalas = ?, last_entry_id = ?,
                   version = version + 1, updated_at = ?
             WHERE salon_id = ? AND version = ? AND balance_halalas = ?`,
      params: [
        after,
        entryId,
        now,
        salonId,
        Number(balance.version || 0),
        before,
      ],
    },
    {
      sql: `INSERT INTO employee_disciplinary_fine_fund_ledger (
        id, salon_id, entry_kind, amount_halalas,
        balance_before_halalas, balance_after_halalas,
        source_type, source_id, benefit_purpose, beneficiary_description,
        approval_authority, approval_reference,
        created_by_uid, created_by_email, created_at
      )
      SELECT ?, ?, 'disbursement', ?, ?, ?, 'benefit_disbursement', ?, ?, ?, ?, ?, ?, ?, ?
        FROM employee_disciplinary_fine_fund_balances balance
       WHERE balance.salon_id = ? AND balance.last_entry_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM employee_disciplinary_fine_fund_ledger existing
            WHERE existing.salon_id = ? AND existing.entry_kind = 'disbursement'
              AND existing.source_type = 'benefit_disbursement' AND existing.source_id = ?
         )`,
      params: [
        entryId,
        salonId,
        amountHalalas,
        before,
        after,
        operationId,
        benefitPurpose,
        beneficiaryDescription,
        approvalAuthority,
        approvalReference,
        optionalText(actor.uid) || null,
        optionalText(actor.email) || null,
        now,
        salonId,
        entryId,
        salonId,
        operationId,
      ],
    },
  ]);

  if (changes(results?.[0]) !== 1 || changes(results?.[1]) !== 1) {
    const raced = await dbFirst(
      db,
      `SELECT * FROM employee_disciplinary_fine_fund_ledger
        WHERE salon_id = ? AND entry_kind = 'disbursement'
          AND source_type = 'benefit_disbursement' AND source_id = ? LIMIT 1`,
      [salonId, operationId]
    );
    if (raced) {
      return {
        entry: raced,
        state: await getDisciplinaryFineFundBalance(db, salonId),
        idempotent: true,
      };
    }
    throw new AppError(409, 'core_discipline:fine_fund_concurrency_conflict');
  }

  const entry = await dbFirst(
    db,
    `SELECT * FROM employee_disciplinary_fine_fund_ledger
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, entryId]
  );
  return {
    entry,
    state: await getDisciplinaryFineFundBalance(db, salonId),
    idempotent: false,
  };
}

export { APPROVAL_AUTHORITIES };
