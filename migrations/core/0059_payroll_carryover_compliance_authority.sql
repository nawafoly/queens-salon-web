-- Canonical payroll carryovers are post-approval financial corrections.
-- They are intentionally separate from manual deductions and payroll obligations.
-- Approval may consume them only when the JSON item is backed by the exact
-- Core D1 carryover row for this employee, target month, direction and amount.

DROP TRIGGER IF EXISTS trg_payroll_approval_manual_deduction_class_guard;

CREATE TRIGGER trg_payroll_approval_manual_deduction_class_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved' AND OLD.status <> 'approved' AND EXISTS (
  SELECT 1
    FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
   WHERE COALESCE(
           json_extract(item.value, '$.sourceType'),
           json_extract(item.value, '$.source_type'),
           ''
         ) NOT IN ('payroll_obligation', 'payroll_carryover')
     AND COALESCE(json_extract(item.value, '$.kind'), '') <> 'payroll_obligation'
     AND COALESCE(
           json_extract(item.value, '$.amountHalalas'),
           json_extract(item.value, '$.amount_halalas'),
           json_extract(item.value, '$.amount'),
           0
         ) > 0
     AND COALESCE(
           json_extract(item.value, '$.laborDeductionClass'),
           json_extract(item.value, '$.labor_deduction_class'),
           ''
         ) NOT IN (
           'employer_loan',
           'judicial_debt',
           'thrift_fund',
           'housing_or_benefit_installment',
           'disciplinary_fine',
           'damage_recovery',
           'other_with_written_consent'
         )
)
BEGIN
  SELECT RAISE(ABORT, 'payroll_deduction_legal_class_required');
END;

CREATE TRIGGER trg_payroll_approval_carryover_authority_guard
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status = 'approved'
 AND OLD.status <> 'approved'
 AND (
   -- The payroll JSON and the canonical Core D1 carryover set must have
   -- exactly the same cardinality. This catches omitted or duplicated items.
   (
     (
       SELECT COUNT(*)
         FROM json_each(COALESCE(NEW.deductions_json, '[]')) item
        WHERE COALESCE(
                json_extract(item.value, '$.sourceType'),
                json_extract(item.value, '$.source_type'),
                ''
              ) = 'payroll_carryover'
     )
     +
     (
       SELECT COUNT(*)
         FROM json_each(COALESCE(NEW.additions_json, '[]')) item
        WHERE COALESCE(
                json_extract(item.value, '$.sourceType'),
                json_extract(item.value, '$.source_type'),
                ''
              ) = 'payroll_carryover'
     )
   ) <> (
     SELECT COUNT(*)
       FROM payroll_carryover_adjustments carryover
      WHERE carryover.salon_id = NEW.salon_id
        AND carryover.employee_id = NEW.employee_id
        AND carryover.target_payroll_month = NEW.payroll_month
        AND (
          carryover.status = 'pending'
          OR (
            carryover.status = 'applied'
            AND carryover.target_payroll_entry_id = NEW.id
          )
        )
   )

   -- Every canonical row must also appear exactly once in the correct JSON
   -- collection with the exact source id, direction and amount.
   OR EXISTS (
     SELECT 1
       FROM payroll_carryover_adjustments carryover
      WHERE carryover.salon_id = NEW.salon_id
        AND carryover.employee_id = NEW.employee_id
        AND carryover.target_payroll_month = NEW.payroll_month
        AND (
          carryover.status = 'pending'
          OR (
            carryover.status = 'applied'
            AND carryover.target_payroll_entry_id = NEW.id
          )
        )
        AND (
          CASE carryover.direction
            WHEN 'deduction' THEN (
              SELECT COUNT(*)
                FROM json_each(
                  COALESCE(NEW.deductions_json, '[]')
                ) item
               WHERE COALESCE(
                       json_extract(item.value, '$.sourceType'),
                       json_extract(item.value, '$.source_type'),
                       ''
                     ) = 'payroll_carryover'
                 AND COALESCE(
                       json_extract(item.value, '$.sourceId'),
                       json_extract(item.value, '$.source_id'),
                       ''
                     ) = carryover.id
                 AND COALESCE(
                       json_extract(item.value, '$.amountHalalas'),
                       json_extract(item.value, '$.amount_halalas'),
                       json_extract(item.value, '$.amount'),
                       0
                     ) = carryover.amount_halalas
            )
            WHEN 'addition' THEN (
              SELECT COUNT(*)
                FROM json_each(
                  COALESCE(NEW.additions_json, '[]')
                ) item
               WHERE COALESCE(
                       json_extract(item.value, '$.sourceType'),
                       json_extract(item.value, '$.source_type'),
                       ''
                     ) = 'payroll_carryover'
                 AND COALESCE(
                       json_extract(item.value, '$.sourceId'),
                       json_extract(item.value, '$.source_id'),
                       ''
                     ) = carryover.id
                 AND COALESCE(
                       json_extract(item.value, '$.amountHalalas'),
                       json_extract(item.value, '$.amount_halalas'),
                       json_extract(item.value, '$.amount'),
                       0
                     ) = carryover.amount_halalas
            )
            ELSE 0
          END
        ) <> 1
   )
 )
BEGIN
  SELECT RAISE(
    ABORT,
    'payroll_carryover_authority_mismatch'
  );
END;
