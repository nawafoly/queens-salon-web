-- Stage 3C employee-request reference convergence.
-- Historical migrations remain immutable.

UPDATE permissions
   SET label = 'اعتماد السلفة',
       description = 'اعتماد قيمة السلفة وجدولة استقطاعها من مسير الراتب.',
       updated_at = '2026-08-22T00:00:00.000Z'
 WHERE permission_key = 'employee_requests.salary_advance.approve';

UPDATE employee_requests
   SET source_reference_type='employee_permission_request',
       source_reference_id=(SELECT pr.id FROM employee_permission_requests pr
          WHERE pr.salon_id=employee_requests.salon_id
            AND pr.employee_request_id=employee_requests.id LIMIT 1)
 WHERE request_type='permission'
   AND (COALESCE(TRIM(source_reference_type),'')='' OR COALESCE(TRIM(source_reference_id),'')='')
   AND EXISTS (SELECT 1 FROM employee_permission_requests pr
          WHERE pr.salon_id=employee_requests.salon_id
            AND pr.employee_request_id=employee_requests.id);

UPDATE employee_requests
   SET source_reference_type='employee_leave',
       source_reference_id=(SELECT el.id FROM employee_leaves el
          WHERE el.salon_id=employee_requests.salon_id
            AND el.request_id=employee_requests.id LIMIT 1)
 WHERE request_type='leave'
   AND (COALESCE(TRIM(source_reference_type),'')='' OR COALESCE(TRIM(source_reference_id),'')='')
   AND EXISTS (SELECT 1 FROM employee_leaves el
          WHERE el.salon_id=employee_requests.salon_id
            AND el.request_id=employee_requests.id);

UPDATE employee_requests
   SET source_reference_type='overtime',
       source_reference_id=(SELECT ot.id FROM employee_overtime_records ot
          WHERE ot.salon_id=employee_requests.salon_id
            AND ot.request_id=employee_requests.id LIMIT 1)
 WHERE request_type='overtime'
   AND (COALESCE(TRIM(source_reference_type),'')='' OR COALESCE(TRIM(source_reference_id),'')='')
   AND EXISTS (SELECT 1 FROM employee_overtime_records ot
          WHERE ot.salon_id=employee_requests.salon_id
            AND ot.request_id=employee_requests.id);

UPDATE employee_requests
   SET source_reference_type='salary_advance',
       source_reference_id=(SELECT sa.id FROM salary_advances sa
          WHERE sa.salon_id=employee_requests.salon_id
            AND sa.request_id=employee_requests.id LIMIT 1)
 WHERE request_type='salary_advance'
   AND (COALESCE(TRIM(source_reference_type),'')='' OR COALESCE(TRIM(source_reference_id),'')='')
   AND EXISTS (SELECT 1 FROM salary_advances sa
          WHERE sa.salon_id=employee_requests.salon_id
            AND sa.request_id=employee_requests.id);

UPDATE employee_requests
   SET source_reference_type='employee_financial_payment',
       source_reference_id=(SELECT fp.id FROM employee_financial_payments fp
          WHERE fp.salon_id=employee_requests.salon_id
            AND fp.request_id=employee_requests.id LIMIT 1)
 WHERE request_type='exceptional_financial_payment'
   AND (COALESCE(TRIM(source_reference_type),'')='' OR COALESCE(TRIM(source_reference_id),'')='')
   AND EXISTS (SELECT 1 FROM employee_financial_payments fp
          WHERE fp.salon_id=employee_requests.salon_id
            AND fp.request_id=employee_requests.id);

-- Only Core-local attendance rows can be proven inside this D1 migration.
UPDATE employee_requests
   SET source_reference_type='attendance_record',
       source_reference_id=(SELECT ar.id FROM attendance_records ar
          WHERE ar.salon_id=employee_requests.salon_id
            AND ar.idempotency_key='employee-request:' || employee_requests.id || ':attendance' LIMIT 1)
 WHERE request_type='attendance_correction'
   AND (COALESCE(TRIM(source_reference_type),'')='' OR COALESCE(TRIM(source_reference_id),'')='')
   AND EXISTS (SELECT 1 FROM attendance_records ar
          WHERE ar.salon_id=employee_requests.salon_id
            AND ar.idempotency_key='employee-request:' || employee_requests.id || ':attendance');

UPDATE employee_requests
   SET source_reference_type='exit_return', source_reference_id=id
 WHERE request_type='exit_return'
   AND status IN ('executing','completed')
   AND (COALESCE(TRIM(source_reference_type),'')='' OR COALESCE(TRIM(source_reference_id),'')='');

UPDATE employee_requests
   SET source_reference_type='resignation', source_reference_id=id
 WHERE request_type='resignation'
   AND status='completed'
   AND (COALESCE(TRIM(source_reference_type),'')='' OR COALESCE(TRIM(source_reference_id),'')='');

-- Read-only reconciliation surface for legacy completed requests whose canonical
-- operational reference is missing or inconsistent. The view never fabricates effects.
CREATE VIEW IF NOT EXISTS employee_request_reference_gaps AS
SELECT
  er.id,
  er.salon_id,
  er.request_number,
  er.employee_id,
  er.request_type,
  er.status,
  er.execution_status,
  er.source_reference_type,
  er.source_reference_id,
  er.updated_at,
  CASE
    WHEN COALESCE(TRIM(er.source_reference_type), '') = ''
      OR COALESCE(TRIM(er.source_reference_id), '') = ''
      THEN 'missing_reference'
    ELSE 'broken_reference'
  END AS gap_reason
FROM employee_requests er
WHERE er.status = 'completed'
  AND (
    COALESCE(TRIM(er.source_reference_type), '') = ''
    OR COALESCE(TRIM(er.source_reference_id), '') = ''
    OR (
      er.request_type = 'permission'
      AND (
        er.source_reference_type <> 'employee_permission_request'
        OR NOT EXISTS (
          SELECT 1 FROM employee_permission_requests pr
           WHERE pr.salon_id = er.salon_id
             AND pr.employee_request_id = er.id
             AND pr.id = er.source_reference_id
        )
      )
    )
    OR (
      er.request_type = 'leave'
      AND (
        er.source_reference_type <> 'employee_leave'
        OR NOT EXISTS (
          SELECT 1 FROM employee_leaves el
           WHERE el.salon_id = er.salon_id
             AND el.request_id = er.id
             AND el.id = er.source_reference_id
        )
      )
    )
    OR (
      er.request_type = 'overtime'
      AND (
        er.source_reference_type <> 'overtime'
        OR NOT EXISTS (
          SELECT 1 FROM employee_overtime_records ot
           WHERE ot.salon_id = er.salon_id
             AND ot.request_id = er.id
             AND ot.id = er.source_reference_id
        )
      )
    )
    OR (
      er.request_type = 'salary_advance'
      AND (
        er.source_reference_type <> 'salary_advance'
        OR NOT EXISTS (
          SELECT 1 FROM salary_advances sa
           WHERE sa.salon_id = er.salon_id
             AND sa.request_id = er.id
             AND sa.id = er.source_reference_id
        )
      )
    )
    OR (
      er.request_type = 'exceptional_financial_payment'
      AND (
        er.source_reference_type <> 'employee_financial_payment'
        OR NOT EXISTS (
          SELECT 1 FROM employee_financial_payments fp
           WHERE fp.salon_id = er.salon_id
             AND fp.request_id = er.id
             AND fp.id = er.source_reference_id
        )
      )
    )
    OR (
      er.request_type = 'attendance_correction'
      AND er.source_reference_type NOT IN ('attendance_record', 'malikat_attendance_record')
    )
    OR (
      er.request_type = 'exit_return'
      AND (
        er.source_reference_type <> 'exit_return'
        OR er.source_reference_id <> er.id
      )
    )
    OR (
      er.request_type = 'resignation'
      AND (
        er.source_reference_type <> 'resignation'
        OR er.source_reference_id <> er.id
      )
    )
  );
