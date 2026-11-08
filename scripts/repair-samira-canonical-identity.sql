-- SAMIRA_STRICT_PREFLIGHT_V1
-- Reject changed canonical contacts, staff UID or historical schedules.

SELECT CASE WHEN
    EXISTS (
        SELECT 1 FROM employee_profiles
        WHERE salon_id = 'main'
          AND id = 'سميرة_دينار'
          AND email IS NULL
          AND phone_normalized IS NULL
          AND firebase_uid IS NOT NULL
          AND TRIM(firebase_uid) <> ''
    )
    AND EXISTS (
        SELECT 1 FROM staff
        WHERE salon_id = 'main'
          AND id = 'سميرة_دينار'
          AND phone_normalized IS NULL
          AND firebase_uid = (
              SELECT firebase_uid
              FROM employee_profiles
              WHERE salon_id = 'main'
                AND id = 'سميرة_دينار'
          )
    )
    AND EXISTS (
        SELECT 1 FROM staff
        WHERE salon_id = 'main'
          AND id = '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
          AND phone_normalized IS NOT NULL
          AND TRIM(phone_normalized) <> ''
          AND firebase_uid = (
              SELECT firebase_uid
              FROM employee_profiles
              WHERE salon_id = 'main'
                AND id = 'سميرة_دينار'
          )
    )
    AND (
        SELECT COUNT(*)
        FROM hr_work_schedules
        WHERE salon_id = 'main'
          AND employee_id = '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
          AND effective_from = '2026-10-01'
          AND effective_to IS NULL
    ) = 7
    AND (
        SELECT COUNT(*)
        FROM hr_work_schedules
        WHERE salon_id = 'main'
          AND employee_id = 'سميرة_دينار'
          AND effective_from = '2026-10-04'
          AND effective_to = '2026-10-06'
    ) = 7
    AND (
        SELECT COUNT(*)
        FROM hr_work_schedules
        WHERE salon_id = 'main'
          AND employee_id = 'سميرة_دينار'
          AND effective_from = '2026-10-07'
          AND effective_to IS NULL
    ) = 7
    AND (
        SELECT COUNT(*)
        FROM hr_work_schedules
        WHERE salon_id = 'main'
          AND employee_id IN ('سميرة_دينار', '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1', '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1')
    ) = 21
THEN 1
ELSE json_extract('SAMIRA_STRICT_PREFLIGHT_FAILED', '$')
END;

-- MALIKAT / Core D1
-- One-time manual data repair: Samira canonical employee identity.
--
-- NOT an automatic schema migration.
-- DO NOT execute against Production without explicit approval.
--
-- Canonical: سميرة_دينار
-- Legacy: single and double URI-encoded identifiers.
--
-- Historical bookings, booking items, locks, audit logs,
-- idempotency records and attendance data are not modified.
--
-- Run only after fresh backup and production preflight.
-- All statements must execute within one atomic D1 operation.

-- ============================================================
-- 1. Guard: confirm all three physical identities still exist.
-- ============================================================

SELECT CASE WHEN
    (
        SELECT COUNT(*)
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id IN (
            'سميرة_دينار',
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1',
            '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
          )
    ) = 3
    AND
    (
        SELECT COUNT(*)
        FROM employee_employment
        WHERE salon_id = 'main'
          AND employee_id IN (
            'سميرة_دينار',
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1',
            '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
          )
    ) = 3
    AND
    (
        SELECT COUNT(*)
        FROM staff
        WHERE salon_id = 'main'
          AND id IN (
            'سميرة_دينار',
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1',
            '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
          )
    ) = 3
THEN 1
ELSE json_extract('SAMIRA_IDENTITY_GUARD_FAILED', '$')
END;

-- ============================================================
-- 2. Guard: preserve account and lifecycle invariants.
-- ============================================================

SELECT CASE WHEN
    (
        SELECT COUNT(*)
        FROM employee_offboarding_fences
        WHERE salon_id = 'main'
          AND employee_id IN (
            'سميرة_دينار',
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1',
            '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
          )
    ) = 0
    AND
    (
        SELECT COUNT(*)
        FROM user_employee_links
        WHERE salon_id = 'main'
          AND employee_id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
          AND link_status = 'active'
    ) = 1
    AND
    (
        SELECT COUNT(*)
        FROM user_employee_links
        WHERE salon_id = 'main'
          AND employee_id = 'سميرة_دينار'
          AND link_status = 'active'
    ) = 0
    AND
    (
        SELECT COUNT(*)
        FROM employee_notifications
        WHERE salon_id = 'main'
          AND target_employee_id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
    ) = 1
THEN 1
ELSE json_extract('SAMIRA_ACCOUNT_GUARD_FAILED', '$')
END;

-- ============================================================
-- 3. Guard: contact information must match legacy records.
-- ============================================================

SELECT CASE WHEN
    (
        SELECT email
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
    ) IS NOT NULL
    AND
    (
        SELECT email
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
    ) =
    (
        SELECT email
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
    )
    AND
    (
        SELECT phone_normalized
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
    ) =
    (
        SELECT phone_normalized
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
    )
    AND
    (
        SELECT firebase_uid
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id = 'سميرة_دينار'
    ) =
    (
        SELECT firebase_uid
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
    )
    AND
    (
        SELECT firebase_uid
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id = 'سميرة_دينار'
    ) =
    (
        SELECT firebase_uid
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
    )
THEN 1
ELSE json_extract('SAMIRA_CONTACT_GUARD_FAILED', '$')
END;

-- ============================================================
-- 4. Recover canonical contact information.
-- ============================================================

UPDATE employee_profiles
SET
    email = (
        SELECT email
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
    ),
    phone_normalized = (
        SELECT phone_normalized
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
    )
WHERE salon_id = 'main'
  AND id = 'سميرة_دينار'
  AND email IS NULL
  AND phone_normalized IS NULL;

UPDATE staff
SET phone_normalized = (
    SELECT phone_normalized
    FROM staff
    WHERE salon_id = 'main'
      AND id =
        '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
)
WHERE salon_id = 'main'
  AND id = 'سميرة_دينار'
  AND phone_normalized IS NULL;

-- ============================================================
-- 5. Move active account link and existing notification.
-- ============================================================

UPDATE user_employee_links
SET employee_id = 'سميرة_دينار'
WHERE salon_id = 'main'
  AND employee_id =
    '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
  AND link_status = 'active';

UPDATE employee_notifications
SET target_employee_id = 'سميرة_دينار'
WHERE salon_id = 'main'
  AND target_employee_id =
    '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1';

-- ============================================================
-- 6. Preserve the complete schedule timeline.
-- ============================================================

SELECT CASE WHEN
    (
        SELECT COUNT(*)
        FROM hr_work_schedules
        WHERE salon_id = 'main'
          AND employee_id =
            '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
          AND effective_from = '2026-10-01'
          AND effective_to IS NULL
    ) = 7
    AND
    (
        SELECT COUNT(*)
        FROM hr_work_schedules
        WHERE salon_id = 'main'
          AND employee_id = 'سميرة_دينار'
    ) = 14
THEN 1
ELSE json_extract('SAMIRA_SCHEDULE_GUARD_FAILED', '$')
END;

UPDATE hr_work_schedules
SET
    employee_id = 'سميرة_دينار',
    effective_to = '2026-10-03'
WHERE salon_id = 'main'
  AND employee_id =
    '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1'
  AND effective_from = '2026-10-01'
  AND effective_to IS NULL;

-- ============================================================
-- 7. Delete only redundant identity records.
-- ============================================================

DELETE FROM employee_employment
WHERE salon_id = 'main'
  AND employee_id IN (
    '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1',
    '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
  );

DELETE FROM staff
WHERE salon_id = 'main'
  AND id IN (
    '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1',
    '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
  );

DELETE FROM employee_profiles
WHERE salon_id = 'main'
  AND id IN (
    '%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1',
    '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1'
  );

-- ============================================================
-- 8. Final postcondition. Failure must abort the operation.
-- ============================================================

SELECT CASE WHEN
    (
        SELECT COUNT(*)
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id = 'سميرة_دينار'
    ) = 1
    AND
    (
        SELECT COUNT(*)
        FROM staff
        WHERE salon_id = 'main'
          AND id = 'سميرة_دينار'
    ) = 1
    AND
    (
        SELECT COUNT(*)
        FROM employee_employment
        WHERE salon_id = 'main'
          AND employee_id = 'سميرة_دينار'
    ) = 1
    AND
    (
        SELECT COUNT(*)
        FROM hr_work_schedules
        WHERE salon_id = 'main'
          AND employee_id = 'سميرة_دينار'
    ) = 21
    AND
    (
        SELECT COUNT(*)
        FROM user_employee_links
        WHERE salon_id = 'main'
          AND employee_id = 'سميرة_دينار'
          AND link_status = 'active'
    ) = 1
    AND
    (
        SELECT COUNT(*)
        FROM employee_notifications
        WHERE salon_id = 'main'
          AND target_employee_id = 'سميرة_دينار'
    ) = 1
THEN 1
ELSE json_extract('SAMIRA_POSTCONDITION_FAILED', '$')
END;


-- SAMIRA_STRICT_POSTCONDITION_V1
-- No legacy identity may remain in the six repaired tables.

SELECT CASE WHEN
    (
        SELECT COUNT(*)
        FROM employee_profiles
        WHERE salon_id = 'main'
          AND id IN ('%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1', '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1')
    ) = 0
    AND (
        SELECT COUNT(*)
        FROM employee_employment
        WHERE salon_id = 'main'
          AND employee_id IN ('%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1', '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1')
    ) = 0
    AND (
        SELECT COUNT(*)
        FROM staff
        WHERE salon_id = 'main'
          AND id IN ('%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1', '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1')
    ) = 0
    AND (
        SELECT COUNT(*)
        FROM user_employee_links
        WHERE salon_id = 'main'
          AND employee_id IN ('%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1', '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1')
    ) = 0
    AND (
        SELECT COUNT(*)
        FROM employee_notifications
        WHERE salon_id = 'main'
          AND target_employee_id IN ('%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1', '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1')
    ) = 0
    AND (
        SELECT COUNT(*)
        FROM hr_work_schedules
        WHERE salon_id = 'main'
          AND employee_id IN ('%D8%B3%D9%85%D9%8A%D8%B1%D8%A9_%D8%AF%D9%8A%D9%86%D8%A7%D8%B1', '%25D8%25B3%25D9%2585%25D9%258A%25D8%25B1%25D8%25A9_%25D8%25AF%25D9%258A%25D9%2586%25D8%25A7%25D8%25B1')
    ) = 0
THEN 1
ELSE json_extract('SAMIRA_STRICT_POSTCONDITION_FAILED', '$')
END;
