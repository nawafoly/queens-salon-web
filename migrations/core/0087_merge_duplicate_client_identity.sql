-- Complete the audited canonical merge:
-- source: client_f324bbdf-fc38-4a58-bc08-54783b868c0f
-- target: client_79c5ebe6-24d0-4daa-a9ad-506a527655e8
--
-- Production audit on 2026-09-27 confirmed:
-- - both records share nawaf@gmail.com
-- - target owns the authenticated Firebase UID
-- - target owns the booking/invoice/payment and Connect history
-- - source has zero references in audited client-domain tables
-- - client_aliases already redirects source ID to target ID
--
-- This migration completes the partially-finished canonicalization.
-- It is intentionally idempotent.

-- Preserve the source ID in canonical metadata before deleting the source row.
UPDATE clients AS target
SET
  legacy_ids_json = COALESCE((
    SELECT json_group_array(value)
    FROM (
      SELECT DISTINCT value
      FROM (
        SELECT value
        FROM json_each(
          CASE
            WHEN json_valid(target.legacy_ids_json)
              THEN target.legacy_ids_json
            ELSE '[]'
          END
        )

        UNION ALL

        SELECT value
        FROM json_each(
          CASE
            WHEN json_valid((
              SELECT source.legacy_ids_json
              FROM clients AS source
              WHERE source.salon_id = 'main'
                AND source.id = 'client_f324bbdf-fc38-4a58-bc08-54783b868c0f'
            ))
            THEN (
              SELECT source.legacy_ids_json
              FROM clients AS source
              WHERE source.salon_id = 'main'
                AND source.id = 'client_f324bbdf-fc38-4a58-bc08-54783b868c0f'
            )
            ELSE '[]'
          END
        )

        UNION ALL

        SELECT 'client_f324bbdf-fc38-4a58-bc08-54783b868c0f'
      )
      WHERE value IS NOT NULL
        AND TRIM(value) <> ''
        AND value <> 'client_79c5ebe6-24d0-4daa-a9ad-506a527655e8'
      ORDER BY value
    )
  ), '[]'),
  canonical_client_id = 'client_79c5ebe6-24d0-4daa-a9ad-506a527655e8',
  updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE target.salon_id = 'main'
  AND target.id = 'client_79c5ebe6-24d0-4daa-a9ad-506a527655e8'
  AND EXISTS (
    SELECT 1
    FROM clients AS source
    WHERE source.salon_id = 'main'
      AND source.id = 'client_f324bbdf-fc38-4a58-bc08-54783b868c0f'
  );

-- Ensure every alias that previously pointed at the duplicate points at canonical.
UPDATE client_aliases
SET canonical_client_id = 'client_79c5ebe6-24d0-4daa-a9ad-506a527655e8'
WHERE salon_id = 'main'
  AND canonical_client_id = 'client_f324bbdf-fc38-4a58-bc08-54783b868c0f';

-- Preserve the duplicate row ID permanently as an alias.
INSERT INTO client_aliases
  (salon_id, alias_id, canonical_client_id, alias_type, created_at)
VALUES
  (
    'main',
    'client_f324bbdf-fc38-4a58-bc08-54783b868c0f',
    'client_79c5ebe6-24d0-4daa-a9ad-506a527655e8',
    'merged_duplicate',
    STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
ON CONFLICT(salon_id, alias_id) DO UPDATE SET
  canonical_client_id = excluded.canonical_client_id,
  alias_type = excluded.alias_type;

-- The source has been audited to contain no live domain references.
DELETE FROM clients
WHERE salon_id = 'main'
  AND id = 'client_f324bbdf-fc38-4a58-bc08-54783b868c0f';

-- Permanent audit trail.
INSERT OR IGNORE INTO audit_logs
(
  id,
  salon_id,
  action,
  entity_type,
  entity_id,
  description,
  source,
  actor_uid,
  actor_email,
  actor_name,
  before_json,
  after_json,
  meta_json,
  created_at
)
VALUES
(
  'migration_merge_client_f324bbdf_fc38_4a58_bc08_54783b868c0f',
  'main',
  'clients.merge',
  'client',
  'client_79c5ebe6-24d0-4daa-a9ad-506a527655e8',
  'Completed canonical merge of an audited duplicate client identity.',
  'migration',
  NULL,
  NULL,
  'system',
  '{"sourceClientId":"client_f324bbdf-fc38-4a58-bc08-54783b868c0f"}',
  '{"canonicalClientId":"client_79c5ebe6-24d0-4daa-a9ad-506a527655e8"}',
  '{"reason":"duplicate normalized email; canonical client owns authenticated Firebase identity and operational history"}',
  STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
);
