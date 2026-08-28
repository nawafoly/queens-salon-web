-- Saudi statutory special-leave validation evidence.
-- Approval is fail-closed: special statutory leave cannot become approved unless
-- a canonical validator persisted its legal basis, evidence and pay treatment.

ALTER TABLE employee_leaves
  ADD COLUMN statutory_event_date TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN statutory_evidence_reference TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN statutory_evidence_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE employee_leaves
  ADD COLUMN statutory_validation_code TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN statutory_validated_at TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN statutory_validated_by_uid TEXT;

CREATE INDEX idx_employee_special_leave_usage
  ON employee_leaves(
    salon_id,
    employee_id,
    leave_type,
    status,
    start_date
  );

CREATE TRIGGER trg_special_leave_approval_requires_validation_insert
BEFORE INSERT ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type IN (
    'marriage',
    'bereavement_spouse_ascendant_descendant',
    'bereavement_sibling',
    'newborn',
    'hajj',
    'exam',
    'maternity',
    'child_medical_care',
    'widow_muslim',
    'widow_non_muslim'
  ) AND
  (
    NEW.statutory_validation_code IS NULL OR
    TRIM(NEW.statutory_validation_code) = '' OR
    NEW.statutory_validated_at IS NULL OR
    NEW.documentation_status <> 'verified' OR
    NEW.statutory_review_required <> 0 OR
    NEW.pay_rate_bps IS NULL
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'special_statutory_leave_requires_canonical_validation'
  );
END;

CREATE TRIGGER trg_special_leave_approval_requires_validation_update
BEFORE UPDATE OF status, leave_type, statutory_validation_code,
                 statutory_validated_at, documentation_status,
                 statutory_review_required, pay_rate_bps
ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type IN (
    'marriage',
    'bereavement_spouse_ascendant_descendant',
    'bereavement_sibling',
    'newborn',
    'hajj',
    'exam',
    'maternity',
    'child_medical_care',
    'widow_muslim',
    'widow_non_muslim'
  ) AND
  (
    NEW.statutory_validation_code IS NULL OR
    TRIM(NEW.statutory_validation_code) = '' OR
    NEW.statutory_validated_at IS NULL OR
    NEW.documentation_status <> 'verified' OR
    NEW.statutory_review_required <> 0 OR
    NEW.pay_rate_bps IS NULL
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'special_statutory_leave_requires_canonical_validation'
  );
END;
