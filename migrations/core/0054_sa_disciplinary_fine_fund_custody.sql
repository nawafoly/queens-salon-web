-- Article 73 disciplinary-fine custody.
-- Payroll collection of a disciplinary fine must never become employer income.
-- Collected fines are held in a restricted employee-benefit fund and may only
-- be disbursed for worker benefit with labor-committee approval, or Ministry
-- approval when no labor committee exists.

CREATE TABLE employee_disciplinary_fine_fund_balances (
  salon_id TEXT PRIMARY KEY,
  balance_halalas INTEGER NOT NULL DEFAULT 0 CHECK(balance_halalas >= 0),
  last_entry_id TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE employee_disciplinary_fine_fund_ledger (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  entry_kind TEXT NOT NULL CHECK(entry_kind IN ('collection','disbursement')),
  amount_halalas INTEGER NOT NULL CHECK(amount_halalas > 0),
  balance_before_halalas INTEGER NOT NULL CHECK(balance_before_halalas >= 0),
  balance_after_halalas INTEGER NOT NULL CHECK(balance_after_halalas >= 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  disciplinary_case_id TEXT,
  payroll_obligation_id TEXT,
  payroll_installment_id TEXT,
  payroll_entry_id TEXT,
  benefit_purpose TEXT,
  beneficiary_description TEXT,
  approval_authority TEXT CHECK(
    approval_authority IS NULL OR
    approval_authority IN ('labor_committee','ministry')
  ),
  approval_reference TEXT,
  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  CHECK(
    entry_kind <> 'disbursement' OR (
      TRIM(COALESCE(benefit_purpose,'')) <> '' AND
      TRIM(COALESCE(beneficiary_description,'')) <> '' AND
      approval_authority IN ('labor_committee','ministry') AND
      TRIM(COALESCE(approval_reference,'')) <> ''
    )
  )
);

CREATE UNIQUE INDEX idx_disciplinary_fine_fund_source
  ON employee_disciplinary_fine_fund_ledger(
    salon_id, entry_kind, source_type, source_id
  );

CREATE INDEX idx_disciplinary_fine_fund_created
  ON employee_disciplinary_fine_fund_ledger(
    salon_id, created_at DESC, id DESC
  );

-- Existing paid/applied fine installments, if any, are backfilled before the
-- live trigger begins enforcing custody.
INSERT OR IGNORE INTO employee_disciplinary_fine_fund_balances (
  salon_id, balance_halalas, last_entry_id, version, updated_at
)
SELECT DISTINCT installment.salon_id, 0, NULL, 0, COALESCE(installment.applied_at, CURRENT_TIMESTAMP)
  FROM employee_payroll_obligation_installments installment
  JOIN employee_payroll_obligations obligation
    ON obligation.salon_id = installment.salon_id
   AND obligation.id = installment.obligation_id
 WHERE installment.status = 'applied'
   AND obligation.labor_deduction_class = 'disciplinary_fine'
   AND obligation.source_type = 'disciplinary_case';

INSERT OR IGNORE INTO employee_disciplinary_fine_fund_ledger (
  id, salon_id, entry_kind, amount_halalas,
  balance_before_halalas, balance_after_halalas,
  source_type, source_id, disciplinary_case_id,
  payroll_obligation_id, payroll_installment_id, payroll_entry_id,
  created_at
)
SELECT
  'disciplinary_fine_collection_' || installment.id,
  installment.salon_id,
  'collection',
  installment.amount_halalas,
  0,
  installment.amount_halalas,
  'payroll_installment',
  installment.id,
  obligation.source_ref,
  obligation.id,
  installment.id,
  installment.applied_payroll_entry_id,
  COALESCE(installment.applied_at, CURRENT_TIMESTAMP)
  FROM employee_payroll_obligation_installments installment
  JOIN employee_payroll_obligations obligation
    ON obligation.salon_id = installment.salon_id
   AND obligation.id = installment.obligation_id
 WHERE installment.status = 'applied'
   AND obligation.labor_deduction_class = 'disciplinary_fine'
   AND obligation.source_type = 'disciplinary_case';

UPDATE employee_disciplinary_fine_fund_balances
   SET balance_halalas = COALESCE((
         SELECT SUM(ledger.amount_halalas)
           FROM employee_disciplinary_fine_fund_ledger ledger
          WHERE ledger.salon_id = employee_disciplinary_fine_fund_balances.salon_id
            AND ledger.entry_kind = 'collection'
       ),0) - COALESCE((
         SELECT SUM(ledger.amount_halalas)
           FROM employee_disciplinary_fine_fund_ledger ledger
          WHERE ledger.salon_id = employee_disciplinary_fine_fund_balances.salon_id
            AND ledger.entry_kind = 'disbursement'
       ),0),
       version = version + 1,
       updated_at = CURRENT_TIMESTAMP;

CREATE TRIGGER trg_disciplinary_fine_collection_to_restricted_fund
AFTER UPDATE OF status, applied_payroll_entry_id, applied_at
ON employee_payroll_obligation_installments
WHEN
  NEW.status = 'applied' AND
  OLD.status <> 'applied' AND
  EXISTS (
    SELECT 1
      FROM employee_payroll_obligations obligation
     WHERE obligation.salon_id = NEW.salon_id
       AND obligation.id = NEW.obligation_id
       AND obligation.labor_deduction_class = 'disciplinary_fine'
       AND obligation.source_type = 'disciplinary_case'
  )
BEGIN
  INSERT OR IGNORE INTO employee_disciplinary_fine_fund_balances (
    salon_id, balance_halalas, last_entry_id, version, updated_at
  ) VALUES (NEW.salon_id, 0, NULL, 0, COALESCE(NEW.applied_at, CURRENT_TIMESTAMP));

  UPDATE employee_disciplinary_fine_fund_balances
     SET balance_halalas = balance_halalas + NEW.amount_halalas,
         last_entry_id = 'disciplinary_fine_collection_' || NEW.id,
         version = version + 1,
         updated_at = COALESCE(NEW.applied_at, CURRENT_TIMESTAMP)
   WHERE salon_id = NEW.salon_id
     AND NOT EXISTS (
       SELECT 1
         FROM employee_disciplinary_fine_fund_ledger existing
        WHERE existing.salon_id = NEW.salon_id
          AND existing.entry_kind = 'collection'
          AND existing.source_type = 'payroll_installment'
          AND existing.source_id = NEW.id
     );

  INSERT OR IGNORE INTO employee_disciplinary_fine_fund_ledger (
    id, salon_id, entry_kind, amount_halalas,
    balance_before_halalas, balance_after_halalas,
    source_type, source_id, disciplinary_case_id,
    payroll_obligation_id, payroll_installment_id, payroll_entry_id,
    created_at
  )
  SELECT
    'disciplinary_fine_collection_' || NEW.id,
    NEW.salon_id,
    'collection',
    NEW.amount_halalas,
    MAX(0, balance.balance_halalas - NEW.amount_halalas),
    balance.balance_halalas,
    'payroll_installment',
    NEW.id,
    obligation.source_ref,
    obligation.id,
    NEW.id,
    NEW.applied_payroll_entry_id,
    COALESCE(NEW.applied_at, CURRENT_TIMESTAMP)
    FROM employee_disciplinary_fine_fund_balances balance
    JOIN employee_payroll_obligations obligation
      ON obligation.salon_id = NEW.salon_id
     AND obligation.id = NEW.obligation_id
   WHERE balance.salon_id = NEW.salon_id;
END;
