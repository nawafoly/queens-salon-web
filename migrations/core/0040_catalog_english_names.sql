-- Catalog bilingual names. Arabic remains canonical/fallback; English is optional.

ALTER TABLE service_sections ADD COLUMN name_en TEXT;
ALTER TABLE service_categories ADD COLUMN name_en TEXT;
ALTER TABLE services ADD COLUMN name_en TEXT;
