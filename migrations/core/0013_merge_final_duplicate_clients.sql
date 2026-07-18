-- Merge the final two duplicate client identities blocking the packages-to-Core cutover.
-- Production audit confirmed that each UUID client owns the current invoiced booking.
-- Idempotent: after a successful merge, re-running is a no-op except alias upserts.

-- ============================================================================
-- 0547929657: merge legacy 966547929657 into canonical UUID client.
-- ============================================================================
UPDATE bookings
SET client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
WHERE salon_id = 'main' AND client_id = '966547929657';

UPDATE invoices
SET client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
WHERE salon_id = 'main' AND client_id = '966547929657';

UPDATE payments
SET client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
WHERE salon_id = 'main' AND client_id = '966547929657';

UPDATE refunds
SET client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
WHERE salon_id = 'main' AND client_id = '966547929657';

UPDATE loyalty_point_transactions
SET client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
WHERE salon_id = 'main' AND client_id = '966547929657';

UPDATE client_packages
SET canonical_client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
WHERE salon_id = 'main' AND canonical_client_id = '966547929657';

UPDATE package_transactions
SET canonical_client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
WHERE salon_id = 'main' AND canonical_client_id = '966547929657';

UPDATE discounts
SET target_client_ids_json = COALESCE((
  SELECT json_group_array(value)
  FROM (
    SELECT DISTINCT
      CASE
        WHEN value = '966547929657'
          THEN 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
        ELSE value
      END AS value
    FROM json_each(
      CASE
        WHEN json_valid(discounts.target_client_ids_json)
          THEN discounts.target_client_ids_json
        ELSE '[]'
      END
    )
    WHERE value IS NOT NULL AND TRIM(value) <> ''
    ORDER BY value
  )
), '[]')
WHERE salon_id = 'main'
  AND target_client_ids_json LIKE '%"966547929657"%';

UPDATE package_catalog
SET target_client_ids_json = COALESCE((
  SELECT json_group_array(value)
  FROM (
    SELECT DISTINCT
      CASE
        WHEN value = '966547929657'
          THEN 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
        ELSE value
      END AS value
    FROM json_each(
      CASE
        WHEN json_valid(package_catalog.target_client_ids_json)
          THEN package_catalog.target_client_ids_json
        ELSE '[]'
      END
    )
    WHERE value IS NOT NULL AND TRIM(value) <> ''
    ORDER BY value
  )
), '[]')
WHERE salon_id = 'main'
  AND target_client_ids_json LIKE '%"966547929657"%';

UPDATE clients AS target_row
SET
  name = CASE
    WHEN LENGTH(TRIM(COALESCE((
      SELECT source_row.name
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966547929657'
    ), ''))) > LENGTH(TRIM(COALESCE(target_row.name, '')))
    THEN (
      SELECT source_row.name
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966547929657'
    )
    ELSE target_row.name
  END,
  phone_normalized = COALESCE(
    NULLIF(TRIM(target_row.phone_normalized), ''),
    (SELECT NULLIF(TRIM(source_row.phone_normalized), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main'
       AND source_row.id = '966547929657')
  ),
  email = COALESCE(
    NULLIF(TRIM(target_row.email), ''),
    (SELECT NULLIF(TRIM(source_row.email), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main'
       AND source_row.id = '966547929657')
  ),
  firebase_uid = COALESCE(
    NULLIF(TRIM(target_row.firebase_uid), ''),
    (SELECT NULLIF(TRIM(source_row.firebase_uid), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main'
       AND source_row.id = '966547929657')
  ),
  status = CASE
    WHEN target_row.status = 'active'
      OR COALESCE((
        SELECT source_row.status
        FROM clients AS source_row
        WHERE source_row.salon_id = 'main'
          AND source_row.id = '966547929657'
      ), '') = 'active'
    THEN 'active'
    ELSE target_row.status
  END,
  vip = CASE
    WHEN COALESCE(target_row.vip, 0) = 1
      OR COALESCE((
        SELECT source_row.vip
        FROM clients AS source_row
        WHERE source_row.salon_id = 'main'
          AND source_row.id = '966547929657'
      ), 0) = 1
    THEN 1 ELSE 0
  END,
  notes = CASE
    WHEN COALESCE(TRIM(target_row.notes), '') = ''
      THEN (
        SELECT source_row.notes
        FROM clients AS source_row
        WHERE source_row.salon_id = 'main'
          AND source_row.id = '966547929657'
      )
    WHEN COALESCE((
      SELECT TRIM(source_row.notes)
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966547929657'
    ), '') = ''
      THEN target_row.notes
    WHEN INSTR(
      target_row.notes,
      (SELECT source_row.notes
       FROM clients AS source_row
       WHERE source_row.salon_id = 'main'
         AND source_row.id = '966547929657')
    ) > 0
      THEN target_row.notes
    ELSE target_row.notes || CHAR(10) ||
      (SELECT source_row.notes
       FROM clients AS source_row
       WHERE source_row.salon_id = 'main'
         AND source_row.id = '966547929657')
  END,
  legacy_client_doc_id = COALESCE(
    NULLIF(TRIM(target_row.legacy_client_doc_id), ''),
    (SELECT NULLIF(TRIM(source_row.legacy_client_doc_id), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main'
       AND source_row.id = '966547929657'),
    '966547929657'
  ),
  canonical_client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4',
  legacy_ids_json = (
    SELECT json_group_array(value)
    FROM (
      SELECT DISTINCT value
      FROM (
        SELECT value
        FROM json_each(
          CASE
            WHEN json_valid(target_row.legacy_ids_json)
              THEN target_row.legacy_ids_json
            ELSE '[]'
          END
        )
        UNION ALL
        SELECT value
        FROM json_each(
          CASE
            WHEN json_valid((
              SELECT source_row.legacy_ids_json
              FROM clients AS source_row
              WHERE source_row.salon_id = 'main'
                AND source_row.id = '966547929657'
            ))
            THEN (
              SELECT source_row.legacy_ids_json
              FROM clients AS source_row
              WHERE source_row.salon_id = 'main'
                AND source_row.id = '966547929657'
            )
            ELSE '[]'
          END
        )
        UNION ALL
        SELECT '966547929657'
      )
      WHERE value IS NOT NULL
        AND TRIM(value) <> ''
        AND value <> 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
      ORDER BY value
    )
  ),
  created_at = CASE
    WHEN COALESCE((
      SELECT source_row.created_at
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966547929657'
    ), target_row.created_at) < target_row.created_at
    THEN (
      SELECT source_row.created_at
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966547929657'
    )
    ELSE target_row.created_at
  END,
  updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE target_row.salon_id = 'main'
  AND target_row.id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4'
  AND EXISTS (
    SELECT 1
    FROM clients AS source_row
    WHERE source_row.salon_id = 'main'
      AND source_row.id = '966547929657'
  );

UPDATE client_aliases
SET canonical_client_id = 'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4',
    alias_type = CASE
      WHEN alias_type = 'migration' THEN 'merged_duplicate'
      ELSE alias_type
    END
WHERE salon_id = 'main'
  AND canonical_client_id = '966547929657';

INSERT INTO client_aliases
  (salon_id, alias_id, canonical_client_id, alias_type, created_at)
VALUES
  (
    'main',
    '966547929657',
    'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4',
    'merged_duplicate',
    STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
ON CONFLICT(salon_id, alias_id) DO UPDATE SET
  canonical_client_id = excluded.canonical_client_id,
  alias_type = excluded.alias_type;

INSERT INTO client_aliases
  (salon_id, alias_id, canonical_client_id, alias_type, created_at)
VALUES
  (
    'main',
    '0547929657',
    'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4',
    'phone',
    STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
ON CONFLICT(salon_id, alias_id) DO UPDATE SET
  canonical_client_id = excluded.canonical_client_id,
  alias_type = excluded.alias_type;

DELETE FROM clients
WHERE salon_id = 'main' AND id = '966547929657';

INSERT OR IGNORE INTO audit_logs
  (
    id, salon_id, action, entity_type, entity_id, description, source,
    actor_uid, actor_email, actor_name, before_json, after_json, meta_json,
    created_at
  )
VALUES
  (
    'migration_merge_client_966547929657',
    'main',
    'clients.merge',
    'client',
    'client_dbe63d49-dbce-49de-93e5-c01005c5e6d4',
    'Merged duplicate legacy client 966547929657 into the canonical UUID client.',
    'migration',
    NULL,
    NULL,
    'system',
    '{"sourceClientId":"966547929657"}',
    '{"canonicalClientId":"client_dbe63d49-dbce-49de-93e5-c01005c5e6d4"}',
    '{"reason":"canonical UUID record owns the invoiced booking"}',
    STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
  );

-- ============================================================================
-- 0562208074: merge inactive legacy 966562208074 into canonical UUID client.
-- ============================================================================
UPDATE bookings
SET client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
WHERE salon_id = 'main' AND client_id = '966562208074';

UPDATE invoices
SET client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
WHERE salon_id = 'main' AND client_id = '966562208074';

UPDATE payments
SET client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
WHERE salon_id = 'main' AND client_id = '966562208074';

UPDATE refunds
SET client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
WHERE salon_id = 'main' AND client_id = '966562208074';

UPDATE loyalty_point_transactions
SET client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
WHERE salon_id = 'main' AND client_id = '966562208074';

UPDATE client_packages
SET canonical_client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
WHERE salon_id = 'main' AND canonical_client_id = '966562208074';

UPDATE package_transactions
SET canonical_client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
WHERE salon_id = 'main' AND canonical_client_id = '966562208074';

UPDATE discounts
SET target_client_ids_json = COALESCE((
  SELECT json_group_array(value)
  FROM (
    SELECT DISTINCT
      CASE
        WHEN value = '966562208074'
          THEN 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
        ELSE value
      END AS value
    FROM json_each(
      CASE
        WHEN json_valid(discounts.target_client_ids_json)
          THEN discounts.target_client_ids_json
        ELSE '[]'
      END
    )
    WHERE value IS NOT NULL AND TRIM(value) <> ''
    ORDER BY value
  )
), '[]')
WHERE salon_id = 'main'
  AND target_client_ids_json LIKE '%"966562208074"%';

UPDATE package_catalog
SET target_client_ids_json = COALESCE((
  SELECT json_group_array(value)
  FROM (
    SELECT DISTINCT
      CASE
        WHEN value = '966562208074'
          THEN 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
        ELSE value
      END AS value
    FROM json_each(
      CASE
        WHEN json_valid(package_catalog.target_client_ids_json)
          THEN package_catalog.target_client_ids_json
        ELSE '[]'
      END
    )
    WHERE value IS NOT NULL AND TRIM(value) <> ''
    ORDER BY value
  )
), '[]')
WHERE salon_id = 'main'
  AND target_client_ids_json LIKE '%"966562208074"%';

UPDATE clients AS target_row
SET
  name = CASE
    WHEN LENGTH(TRIM(COALESCE((
      SELECT source_row.name
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966562208074'
    ), ''))) > LENGTH(TRIM(COALESCE(target_row.name, '')))
    THEN (
      SELECT source_row.name
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966562208074'
    )
    ELSE target_row.name
  END,
  phone_normalized = COALESCE(
    NULLIF(TRIM(target_row.phone_normalized), ''),
    (SELECT NULLIF(TRIM(source_row.phone_normalized), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main'
       AND source_row.id = '966562208074')
  ),
  email = COALESCE(
    NULLIF(TRIM(target_row.email), ''),
    (SELECT NULLIF(TRIM(source_row.email), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main'
       AND source_row.id = '966562208074')
  ),
  firebase_uid = COALESCE(
    NULLIF(TRIM(target_row.firebase_uid), ''),
    (SELECT NULLIF(TRIM(source_row.firebase_uid), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main'
       AND source_row.id = '966562208074')
  ),
  status = CASE
    WHEN target_row.status = 'active'
      OR COALESCE((
        SELECT source_row.status
        FROM clients AS source_row
        WHERE source_row.salon_id = 'main'
          AND source_row.id = '966562208074'
      ), '') = 'active'
    THEN 'active'
    ELSE target_row.status
  END,
  vip = CASE
    WHEN COALESCE(target_row.vip, 0) = 1
      OR COALESCE((
        SELECT source_row.vip
        FROM clients AS source_row
        WHERE source_row.salon_id = 'main'
          AND source_row.id = '966562208074'
      ), 0) = 1
    THEN 1 ELSE 0
  END,
  notes = CASE
    WHEN COALESCE(TRIM(target_row.notes), '') = ''
      THEN (
        SELECT source_row.notes
        FROM clients AS source_row
        WHERE source_row.salon_id = 'main'
          AND source_row.id = '966562208074'
      )
    WHEN COALESCE((
      SELECT TRIM(source_row.notes)
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966562208074'
    ), '') = ''
      THEN target_row.notes
    WHEN INSTR(
      target_row.notes,
      (SELECT source_row.notes
       FROM clients AS source_row
       WHERE source_row.salon_id = 'main'
         AND source_row.id = '966562208074')
    ) > 0
      THEN target_row.notes
    ELSE target_row.notes || CHAR(10) ||
      (SELECT source_row.notes
       FROM clients AS source_row
       WHERE source_row.salon_id = 'main'
         AND source_row.id = '966562208074')
  END,
  legacy_client_doc_id = COALESCE(
    NULLIF(TRIM(target_row.legacy_client_doc_id), ''),
    (SELECT NULLIF(TRIM(source_row.legacy_client_doc_id), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main'
       AND source_row.id = '966562208074'),
    '966562208074'
  ),
  canonical_client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9',
  legacy_ids_json = (
    SELECT json_group_array(value)
    FROM (
      SELECT DISTINCT value
      FROM (
        SELECT value
        FROM json_each(
          CASE
            WHEN json_valid(target_row.legacy_ids_json)
              THEN target_row.legacy_ids_json
            ELSE '[]'
          END
        )
        UNION ALL
        SELECT value
        FROM json_each(
          CASE
            WHEN json_valid((
              SELECT source_row.legacy_ids_json
              FROM clients AS source_row
              WHERE source_row.salon_id = 'main'
                AND source_row.id = '966562208074'
            ))
            THEN (
              SELECT source_row.legacy_ids_json
              FROM clients AS source_row
              WHERE source_row.salon_id = 'main'
                AND source_row.id = '966562208074'
            )
            ELSE '[]'
          END
        )
        UNION ALL
        SELECT '966562208074'
      )
      WHERE value IS NOT NULL
        AND TRIM(value) <> ''
        AND value <> 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
      ORDER BY value
    )
  ),
  created_at = CASE
    WHEN COALESCE((
      SELECT source_row.created_at
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966562208074'
    ), target_row.created_at) < target_row.created_at
    THEN (
      SELECT source_row.created_at
      FROM clients AS source_row
      WHERE source_row.salon_id = 'main'
        AND source_row.id = '966562208074'
    )
    ELSE target_row.created_at
  END,
  updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE target_row.salon_id = 'main'
  AND target_row.id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9'
  AND EXISTS (
    SELECT 1
    FROM clients AS source_row
    WHERE source_row.salon_id = 'main'
      AND source_row.id = '966562208074'
  );

UPDATE client_aliases
SET canonical_client_id = 'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9',
    alias_type = CASE
      WHEN alias_type = 'migration' THEN 'merged_duplicate'
      ELSE alias_type
    END
WHERE salon_id = 'main'
  AND canonical_client_id = '966562208074';

INSERT INTO client_aliases
  (salon_id, alias_id, canonical_client_id, alias_type, created_at)
VALUES
  (
    'main',
    '966562208074',
    'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9',
    'merged_duplicate',
    STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
ON CONFLICT(salon_id, alias_id) DO UPDATE SET
  canonical_client_id = excluded.canonical_client_id,
  alias_type = excluded.alias_type;

INSERT INTO client_aliases
  (salon_id, alias_id, canonical_client_id, alias_type, created_at)
VALUES
  (
    'main',
    '0562208074',
    'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9',
    'phone',
    STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
ON CONFLICT(salon_id, alias_id) DO UPDATE SET
  canonical_client_id = excluded.canonical_client_id,
  alias_type = excluded.alias_type;

DELETE FROM clients
WHERE salon_id = 'main' AND id = '966562208074';

INSERT OR IGNORE INTO audit_logs
  (
    id, salon_id, action, entity_type, entity_id, description, source,
    actor_uid, actor_email, actor_name, before_json, after_json, meta_json,
    created_at
  )
VALUES
  (
    'migration_merge_client_966562208074',
    'main',
    'clients.merge',
    'client',
    'client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9',
    'Merged duplicate legacy client 966562208074 into the canonical UUID client.',
    'migration',
    NULL,
    NULL,
    'system',
    '{"sourceClientId":"966562208074"}',
    '{"canonicalClientId":"client_a7cde4e3-b7a4-4391-8761-9ea2c40f9cc9"}',
    '{"reason":"legacy numeric record had no activity; UUID record owns the invoiced booking"}',
    STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
