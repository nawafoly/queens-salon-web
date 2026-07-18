-- Merge the duplicate legacy Nawaf client into the Firebase-linked canonical client.
-- Source: 966546535404
-- Target: client_fd3c21ad-0984-48c3-8474-9a425a76e25f
-- Generated after production identity audit on 2026-07-18.

UPDATE bookings
SET client_id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
WHERE salon_id = 'main' AND client_id = '966546535404';

UPDATE invoices
SET client_id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
WHERE salon_id = 'main' AND client_id = '966546535404';

UPDATE payments
SET client_id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
WHERE salon_id = 'main' AND client_id = '966546535404';

UPDATE refunds
SET client_id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
WHERE salon_id = 'main' AND client_id = '966546535404';

UPDATE loyalty_point_transactions
SET client_id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
WHERE salon_id = 'main' AND client_id = '966546535404';

UPDATE client_packages
SET canonical_client_id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
WHERE salon_id = 'main' AND canonical_client_id = '966546535404';

UPDATE package_transactions
SET canonical_client_id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
WHERE salon_id = 'main' AND canonical_client_id = '966546535404';

UPDATE discounts
SET target_client_ids_json = COALESCE((
  SELECT json_group_array(value)
  FROM (
    SELECT DISTINCT
      CASE WHEN value = '966546535404' THEN 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f' ELSE value END AS value
    FROM json_each(
      CASE
        WHEN json_valid(discounts.target_client_ids_json) THEN discounts.target_client_ids_json
        ELSE '[]'
      END
    )
    WHERE value IS NOT NULL AND TRIM(value) <> ''
    ORDER BY value
  )
), '[]')
WHERE salon_id = 'main'
  AND target_client_ids_json LIKE '%"966546535404"%';

UPDATE package_catalog
SET target_client_ids_json = COALESCE((
  SELECT json_group_array(value)
  FROM (
    SELECT DISTINCT
      CASE WHEN value = '966546535404' THEN 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f' ELSE value END AS value
    FROM json_each(
      CASE
        WHEN json_valid(package_catalog.target_client_ids_json) THEN package_catalog.target_client_ids_json
        ELSE '[]'
      END
    )
    WHERE value IS NOT NULL AND TRIM(value) <> ''
    ORDER BY value
  )
), '[]')
WHERE salon_id = 'main'
  AND target_client_ids_json LIKE '%"966546535404"%';

UPDATE clients AS target_row
SET
  phone_normalized = COALESCE(
    NULLIF(TRIM(target_row.phone_normalized), ''),
    (SELECT NULLIF(TRIM(source_row.phone_normalized), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404')
  ),
  email = COALESCE(
    NULLIF(TRIM(target_row.email), ''),
    (SELECT NULLIF(TRIM(source_row.email), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404')
  ),
  vip = CASE
    WHEN COALESCE(target_row.vip, 0) = 1
      OR COALESCE((SELECT source_row.vip FROM clients AS source_row
                   WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404'), 0) = 1
    THEN 1 ELSE 0
  END,
  notes = CASE
    WHEN COALESCE(TRIM(target_row.notes), '') = ''
      THEN (SELECT source_row.notes FROM clients AS source_row
            WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404')
    WHEN COALESCE((SELECT TRIM(source_row.notes) FROM clients AS source_row
                   WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404'), '') = ''
      THEN target_row.notes
    WHEN INSTR(
      target_row.notes,
      (SELECT source_row.notes FROM clients AS source_row
       WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404')
    ) > 0
      THEN target_row.notes
    ELSE target_row.notes || CHAR(10) ||
      (SELECT source_row.notes FROM clients AS source_row
       WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404')
  END,
  legacy_client_doc_id = COALESCE(
    NULLIF(TRIM(target_row.legacy_client_doc_id), ''),
    (SELECT NULLIF(TRIM(source_row.legacy_client_doc_id), '')
     FROM clients AS source_row
     WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404'),
    '966546535404'
  ),
  legacy_ids_json = (
    SELECT json_group_array(value)
    FROM (
      SELECT DISTINCT value
      FROM (
        SELECT value
        FROM json_each(
          CASE
            WHEN json_valid(target_row.legacy_ids_json) THEN target_row.legacy_ids_json
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
              WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404'
            ))
            THEN (
              SELECT source_row.legacy_ids_json
              FROM clients AS source_row
              WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404'
            )
            ELSE '[]'
          END
        )
        UNION ALL
        SELECT '966546535404' AS value
      )
      WHERE value IS NOT NULL
        AND TRIM(value) <> ''
        AND value <> 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
      ORDER BY value
    )
  ),
  updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE target_row.salon_id = 'main'
  AND target_row.id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f'
  AND EXISTS (
    SELECT 1
    FROM clients AS source_row
    WHERE source_row.salon_id = 'main' AND source_row.id = '966546535404'
  );

UPDATE client_aliases
SET canonical_client_id = 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f',
    alias_type = CASE
      WHEN alias_type = 'migration' THEN 'merged_duplicate'
      ELSE alias_type
    END
WHERE salon_id = 'main'
  AND canonical_client_id = '966546535404';

INSERT INTO client_aliases
  (salon_id, alias_id, canonical_client_id, alias_type, created_at)
VALUES
  ('main', '966546535404', 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f', 'merged_duplicate',
   STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(salon_id, alias_id) DO UPDATE SET
  canonical_client_id = excluded.canonical_client_id,
  alias_type = excluded.alias_type;

INSERT INTO client_aliases
  (salon_id, alias_id, canonical_client_id, alias_type, created_at)
VALUES
  ('main', '0546535404', 'client_fd3c21ad-0984-48c3-8474-9a425a76e25f', 'phone',
   STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(salon_id, alias_id) DO UPDATE SET
  canonical_client_id = excluded.canonical_client_id,
  alias_type = excluded.alias_type;

DELETE FROM clients
WHERE salon_id = 'main' AND id = '966546535404';

INSERT OR IGNORE INTO audit_logs
  (id, salon_id, action, entity_type, entity_id, description, source,
   actor_uid, actor_email, actor_name, before_json, after_json, meta_json, created_at)
VALUES
  (
    'migration_merge_client_966546535404',
    'main',
    'clients.merge',
    'client',
    'client_fd3c21ad-0984-48c3-8474-9a425a76e25f',
    'Merged duplicate legacy client 966546535404 into the Firebase-linked Nawaf client.',
    'migration',
    NULL,
    NULL,
    'system',
    '{"sourceClientId":"966546535404"}',
    '{"canonicalClientId":"client_fd3c21ad-0984-48c3-8474-9a425a76e25f"}',
    '{"reason":"duplicate phone 0546535404; canonical record has Firebase UID"}',
    STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
  );
