-- Saudi Labor Law Articles 92-94 payroll deduction compliance.
-- Absence/missing-time wage adjustments remain a separate earned-wage domain.
-- This migration protects the remaining wage from private/statutory deductions,
-- classifies obligation evidence, and fails payroll approval closed.

ALTER TABLE employee_recurring_deductions
  ADD COLUMN labor_deduction_class TEXT;
ALTER TABLE employee_recurring_deductions
  ADD COLUMN written_consent_reference TEXT;
ALTER TABLE employee_recurring_deductions
  ADD COLUMN court_order_reference TEXT;
ALTER TABLE employee_recurring_deductions
  ADD COLUMN judicial_monthly_cap_bps INTEGER;
ALTER TABLE employee_recurring_deductions
  ADD COLUMN evidence_reference TEXT;

ALTER TABLE employee_payroll_obligations
  ADD COLUMN labor_deduction_class TEXT;
ALTER TABLE employee_payroll_obligations
  ADD COLUMN written_consent_reference TEXT;
ALTER TABLE employee_payroll_obligations
  ADD COLUMN court_order_reference TEXT;
ALTER TABLE employee_payroll_obligations
  ADD COLUMN judicial_monthly_cap_bps INTEGER;
ALTER TABLE employee_payroll_obligations
  ADD COLUMN evidence_reference TEXT;

CREATE TABLE employee_payroll_deduction_overrides (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  max_total_deduction_bps INTEGER NOT NULL
    CHECK(max_total_deduction_bps > 5000 AND max_total_deduction_bps <= 10000),
  labor_court_reference TEXT NOT NULL CHECK(TRIM(labor_court_reference) <> ''),
  reason TEXT NOT NULL CHECK(TRIM(reason) <> ''),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled')),
  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  cancelled_by_uid TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  UNIQUE(salon_id, employee_id, payroll_month, status)
);

CREATE INDEX idx_payroll_deduction_override_employee_month
  ON employee_payroll_deduction_overrides(
    salon_id, employee_id, payroll_month, status
  );

-- Canonical attendance deferrals are wage adjustments, never disciplinary fines.
UPDATE employee_payroll_obligations
   SET labor_deduction_class = 'deferred_time_not_worked_adjustment',
       evidence_reference = COALESCE(evidence_reference, source_ref)
 WHERE source_type = 'attendance'
   AND obligation_kind = 'attendance_missing_hours';

-- Recurring obligations inherit legal classification/evidence from their durable
-- recurring source when materialized. No inference is made from free-text kind.
CREATE TRIGGER trg_recurring_obligation_copy_deduction_compliance
AFTER INSERT ON employee_payroll_obligations
WHEN NEW.recurring_deduction_id IS NOT NULL
BEGIN
  UPDATE employee_payroll_obligations
     SET labor_deduction_class = (
           SELECT labor_deduction_class
             FROM employee_recurring_deductions
            WHERE salon_id = NEW.salon_id
              AND id = NEW.recurring_deduction_id
         ),
         written_consent_reference = (
           SELECT written_consent_reference
             FROM employee_recurring_deductions
            WHERE salon_id = NEW.salon_id
              AND id = NEW.recurring_deduction_id
         ),
         court_order_reference = (
           SELECT court_order_reference
             FROM employee_recurring_deductions
            WHERE salon_id = NEW.salon_id
              AND id = NEW.recurring_deduction_id
         ),
         judicial_monthly_cap_bps = (
           SELECT judicial_monthly_cap_bps
             FROM employee_recurring_deductions
            WHERE salon_id = NEW.salon_id
              AND id = NEW.recurring_deduction_id
         ),
         evidence_reference = (
           SELECT evidence_reference
             FROM employee_recurring_deductions
            WHERE salon_id = NEW.salon_id
              AND id = NEW.recurring_deduction_id
         )
   WHERE salon_id = NEW.salon_id
     AND id = NEW.id;
END;

-- Every non-canonical deduction item must state a recognized legal class.
CREATE TRIGGER trg_payroll_approval_manual_deduction_class_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND EXISTS (
  SELECT 1
    FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
   WHERE COALESCE(json_extract(item.value, '$.sourceType'), json_extract(item.value, '$.source_type'), '') <> 'payroll_obligation'
     AND COALESCE(json_extract(item.value, '$.kind'), '') <> 'payroll_obligation'
     AND COALESCE(json_extract(item.value, '$.amountHalalas'), json_extract(item.value, '$.amount_halalas'), json_extract(item.value, '$.amount'), 0) > 0
     AND COALESCE(json_extract(item.value, '$.laborDeductionClass'), json_extract(item.value, '$.labor_deduction_class'), '') NOT IN (
       'employer_loan','judicial_debt','thrift_fund','housing_or_benefit_installment',
       'disciplinary_fine','damage_recovery','other_with_written_consent'
     )
)
BEGIN
  SELECT RAISE(ABORT, 'payroll_deduction_legal_class_required');
END;

-- Reserved classes can only be produced by their canonical domains.
CREATE TRIGGER trg_payroll_approval_reserved_manual_deduction_class_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND EXISTS (
  SELECT 1
    FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
   WHERE COALESCE(json_extract(item.value, '$.sourceType'), json_extract(item.value, '$.source_type'), '') <> 'payroll_obligation'
     AND COALESCE(json_extract(item.value, '$.kind'), '') <> 'payroll_obligation'
     AND COALESCE(json_extract(item.value, '$.laborDeductionClass'), json_extract(item.value, '$.labor_deduction_class'), '') IN (
       'social_insurance','deferred_time_not_worked_adjustment'
     )
)
BEGIN
  SELECT RAISE(ABORT, 'reserved_deduction_class_requires_canonical_source');
END;

CREATE TRIGGER trg_payroll_approval_written_consent_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND EXISTS (
  SELECT 1
    FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
   WHERE COALESCE(json_extract(item.value, '$.laborDeductionClass'), json_extract(item.value, '$.labor_deduction_class'), '') = 'other_with_written_consent'
     AND TRIM(COALESCE(json_extract(item.value, '$.writtenConsentReference'), json_extract(item.value, '$.written_consent_reference'), '')) = ''
)
BEGIN
  SELECT RAISE(ABORT, 'payroll_written_consent_reference_required');
END;

CREATE TRIGGER trg_payroll_approval_manual_evidence_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND EXISTS (
  SELECT 1
    FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
   WHERE COALESCE(json_extract(item.value, '$.sourceType'), json_extract(item.value, '$.source_type'), '') <> 'payroll_obligation'
     AND COALESCE(json_extract(item.value, '$.kind'), '') <> 'payroll_obligation'
     AND COALESCE(json_extract(item.value, '$.laborDeductionClass'), json_extract(item.value, '$.labor_deduction_class'), '') IN (
       'employer_loan','thrift_fund','housing_or_benefit_installment','disciplinary_fine','damage_recovery'
     )
     AND TRIM(COALESCE(
       json_extract(item.value, '$.evidenceReference'),
       json_extract(item.value, '$.evidence_reference'),
       json_extract(item.value, '$.sourceRef'),
       json_extract(item.value, '$.source_ref'),
       ''
     )) = ''
)
BEGIN
  SELECT RAISE(ABORT, 'payroll_deduction_evidence_reference_required');
END;

-- Canonical payroll obligations must themselves be legally classified.
CREATE TRIGGER trg_payroll_approval_obligation_class_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND EXISTS (
  SELECT 1
    FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
    LEFT JOIN employee_payroll_obligation_installments installment
      ON installment.salon_id = NEW.salon_id
     AND installment.id = COALESCE(
       json_extract(item.value, '$.installmentId'),
       json_extract(item.value, '$.installment_id'),
       json_extract(item.value, '$.sourceRef'),
       json_extract(item.value, '$.source_ref')
     )
    LEFT JOIN employee_payroll_obligations obligation
      ON obligation.salon_id = installment.salon_id
     AND obligation.id = installment.obligation_id
   WHERE (
       COALESCE(json_extract(item.value, '$.sourceType'), json_extract(item.value, '$.source_type'), '') = 'payroll_obligation'
       OR COALESCE(json_extract(item.value, '$.kind'), '') = 'payroll_obligation'
     )
     AND (
       obligation.id IS NULL OR
       COALESCE(obligation.labor_deduction_class, '') NOT IN (
         'employer_loan','judicial_debt','thrift_fund','housing_or_benefit_installment',
         'disciplinary_fine','damage_recovery','other_with_written_consent',
         'deferred_time_not_worked_adjustment'
       )
     )
)
BEGIN
  SELECT RAISE(ABORT, 'payroll_obligation_deduction_class_required');
END;

CREATE TRIGGER trg_payroll_approval_obligation_evidence_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND EXISTS (
  SELECT 1
    FROM employee_payroll_obligation_installments installment
    JOIN employee_payroll_obligations obligation
      ON obligation.salon_id = installment.salon_id
     AND obligation.id = installment.obligation_id
   WHERE installment.salon_id = NEW.salon_id
     AND obligation.employee_id = NEW.employee_id
     AND installment.target_payroll_month = NEW.payroll_month
     AND installment.status = 'scheduled'
     AND obligation.status IN ('open','scheduled','partially_settled')
     AND (
       (obligation.labor_deduction_class = 'other_with_written_consent' AND TRIM(COALESCE(obligation.written_consent_reference, '')) = '') OR
       (obligation.labor_deduction_class = 'judicial_debt' AND TRIM(COALESCE(obligation.court_order_reference, '')) = '') OR
       (obligation.labor_deduction_class IN ('employer_loan','thrift_fund','housing_or_benefit_installment','disciplinary_fine','damage_recovery') AND TRIM(COALESCE(obligation.evidence_reference, obligation.source_ref, '')) = '')
     )
)
BEGIN
  SELECT RAISE(ABORT, 'payroll_obligation_deduction_evidence_required');
END;

-- Judicial debt defaults to one quarter of wage unless the judgment explicitly
-- carries another cap. Each judgment remains individually evidenced.
CREATE TRIGGER trg_payroll_approval_judicial_deduction_cap_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND (
  EXISTS (
    SELECT 1
      FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
     WHERE COALESCE(json_extract(item.value, '$.sourceType'), json_extract(item.value, '$.source_type'), '') <> 'payroll_obligation'
       AND COALESCE(json_extract(item.value, '$.kind'), '') <> 'payroll_obligation'
       AND COALESCE(json_extract(item.value, '$.laborDeductionClass'), json_extract(item.value, '$.labor_deduction_class'), '') = 'judicial_debt'
       AND TRIM(COALESCE(json_extract(item.value, '$.courtOrderReference'), json_extract(item.value, '$.court_order_reference'), '')) <> ''
       AND COALESCE(json_extract(item.value, '$.amountHalalas'), json_extract(item.value, '$.amount_halalas'), json_extract(item.value, '$.amount'), 0) >
         MAX(0, NEW.gross_salary_halalas - NEW.absence_deduction_halalas - NEW.missing_hours_deduction_halalas) *
         MIN(10000, MAX(1, COALESCE(json_extract(item.value, '$.judicialMonthlyCapBps'), json_extract(item.value, '$.judicial_monthly_cap_bps'), 2500))) / 10000.0
  ) OR EXISTS (
    SELECT 1
      FROM employee_payroll_obligation_installments installment
      JOIN employee_payroll_obligations obligation
        ON obligation.salon_id = installment.salon_id
       AND obligation.id = installment.obligation_id
     WHERE installment.salon_id = NEW.salon_id
       AND obligation.employee_id = NEW.employee_id
       AND installment.target_payroll_month = NEW.payroll_month
       AND installment.status = 'scheduled'
       AND obligation.status IN ('open','scheduled','partially_settled')
       AND obligation.labor_deduction_class = 'judicial_debt'
       AND installment.amount_halalas >
         MAX(0, NEW.gross_salary_halalas - NEW.absence_deduction_halalas - NEW.missing_hours_deduction_halalas) *
         MIN(10000, MAX(1, COALESCE(obligation.judicial_monthly_cap_bps, 2500))) / 10000.0
  )
)
BEGIN
  SELECT RAISE(ABORT, 'payroll_judicial_deduction_cap_exceeded');
END;

-- Employer-loan recovery, including canonical salary advances, is capped at 10%.
CREATE TRIGGER trg_payroll_approval_employer_loan_cap_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND (
  COALESCE(NEW.advances_halalas, 0) +
  COALESCE((
    SELECT SUM(COALESCE(json_extract(item.value, '$.amountHalalas'), json_extract(item.value, '$.amount_halalas'), json_extract(item.value, '$.amount'), 0))
      FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
     WHERE COALESCE(json_extract(item.value, '$.sourceType'), json_extract(item.value, '$.source_type'), '') <> 'payroll_obligation'
       AND COALESCE(json_extract(item.value, '$.kind'), '') <> 'payroll_obligation'
       AND COALESCE(json_extract(item.value, '$.laborDeductionClass'), json_extract(item.value, '$.labor_deduction_class'), '') = 'employer_loan'
  ), 0) +
  COALESCE((
    SELECT SUM(installment.amount_halalas)
      FROM employee_payroll_obligation_installments installment
      JOIN employee_payroll_obligations obligation
        ON obligation.salon_id = installment.salon_id
       AND obligation.id = installment.obligation_id
     WHERE installment.salon_id = NEW.salon_id
       AND obligation.employee_id = NEW.employee_id
       AND installment.target_payroll_month = NEW.payroll_month
       AND installment.status = 'scheduled'
       AND obligation.status IN ('open','scheduled','partially_settled')
       AND obligation.labor_deduction_class = 'employer_loan'
  ), 0)
) > MAX(0, NEW.gross_salary_halalas - NEW.absence_deduction_halalas - NEW.missing_hours_deduction_halalas) * 0.10
BEGIN
  SELECT RAISE(ABORT, 'payroll_employer_loan_deduction_cap_exceeded');
END;

-- Article 93 aggregate protection. GOSI + private/statutory deductions are
-- included. Time-not-worked adjustments reduce the wage due before this cap.
CREATE TRIGGER trg_payroll_approval_aggregate_deduction_cap_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND
  (
    COALESCE(NEW.insurance_deduction_halalas, 0) +
    COALESCE(NEW.manual_deductions_halalas, 0) +
    COALESCE(NEW.advances_halalas, 0)
  ) >
  MAX(0, NEW.gross_salary_halalas - NEW.absence_deduction_halalas - NEW.missing_hours_deduction_halalas) *
  COALESCE((
    SELECT MAX(max_total_deduction_bps) / 10000.0
      FROM employee_payroll_deduction_overrides override
     WHERE override.salon_id = NEW.salon_id
       AND override.employee_id = NEW.employee_id
       AND override.payroll_month = NEW.payroll_month
       AND override.status = 'active'
       AND TRIM(override.labor_court_reference) <> ''
  ), 0.50)
BEGIN
  SELECT RAISE(ABORT, 'payroll_aggregate_deduction_cap_exceeded');
END;
