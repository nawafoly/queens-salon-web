-- STAGE 13 PRODUCTION SAFETY HOTFIX
-- Prevent a losing concurrent payroll-payment batch from decrementing an
-- obligation after its scheduled installment transition already lost.
--
-- Canonical payroll applies obligation installments first and updates the
-- obligation parent in the same D1 batch with one shared timestamp. A parent
-- decrement is therefore valid only when the same operation actually produced
-- enough newly-applied installment value for that obligation.

CREATE TRIGGER IF NOT EXISTS trg_payroll_obligation_settlement_requires_current_application
BEFORE UPDATE OF remaining_amount_halalas ON employee_payroll_obligations
WHEN NEW.remaining_amount_halalas < OLD.remaining_amount_halalas
 AND (
   COALESCE(NEW.updated_at, '') = COALESCE(OLD.updated_at, '')
   OR COALESCE(
     (
       SELECT SUM(i.amount_halalas)
         FROM employee_payroll_obligation_installments i
        WHERE i.salon_id = OLD.salon_id
          AND i.obligation_id = OLD.id
          AND i.status = 'applied'
          AND COALESCE(i.applied_at, '') = COALESCE(NEW.updated_at, '')
          AND COALESCE(i.updated_at, '') = COALESCE(NEW.updated_at, '')
     ),
     0
   ) < (OLD.remaining_amount_halalas - NEW.remaining_amount_halalas)
 )
BEGIN
  SELECT RAISE(IGNORE);
END;
