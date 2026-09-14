// CORE D1 ONLY — do not add Firestore fallback.
// Public About page staff listing from employee_profiles (+ staff specialties).

import { cleanText, dbAll } from '../d1.js';

function parseSpecialties(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean);
  try {
    const parsed = JSON.parse(cleanText(value) || '[]');
    return Array.isArray(parsed) ? parsed.map(cleanText).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Collapse detailed staff specialty ids into About category keys when possible. */
function normalizeAboutSpecialties(raw) {
  const CATEGORY_KEYS = new Set([
    'hair-care',
    'skin-care',
    'nail-care',
    'makeup',
    'massage',
    'special-packages',
    'home-services',
    'hair-color-treatments',
    'services',
  ]);
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const prefix = cleanText(item).split('_')[0];
    const key = CATEGORY_KEYS.has(prefix) ? prefix : cleanText(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function mapPublicStaff(row) {
  const specialties = normalizeAboutSpecialties(parseSpecialties(row.specialties_json));
  return {
    id: row.id,
    name: row.name || '',
    bio: row.bio || '',
    avatarUrl: row.avatar_url || '',
    cvUrl: row.cv_url || '',
    specialties,
    active: cleanText(row.status || '').toLowerCase() !== 'inactive' && Number(row.staff_active ?? 1) === 1,
    showOnAbout: Number(row.show_on_about) === 1,
    employmentEndDate: row.employment_end_date || null,
    rating: row.rating == null ? null : Number(row.rating),
    reviewsCount: row.reviews_count == null ? null : Number(row.reviews_count),
  };
}

export async function listPublicAboutStaff(db, salonId) {
  const rows = await dbAll(
    db,
    `SELECT
        ep.id,
        ep.name,
        ep.bio,
        ep.avatar_url,
        ep.cv_url,
        ep.show_on_about,
        ep.status,
        ep.rating,
        ep.reviews_count,
        s.specialties_json,
        s.active AS staff_active,
        ee.end_date AS employment_end_date
      FROM employee_profiles ep
      LEFT JOIN staff s
        ON s.salon_id = ep.salon_id AND s.id = ep.id
      LEFT JOIN employee_employment ee
        ON ee.salon_id = ep.salon_id AND ee.employee_id = ep.id
     WHERE ep.salon_id = ?
       AND ep.show_on_about = 1
       AND LOWER(COALESCE(ep.status, 'active')) = 'active'
     ORDER BY ep.name`,
    [salonId]
  );
  return rows.map(mapPublicStaff).filter((row) => row.name && row.showOnAbout && row.active);
}
