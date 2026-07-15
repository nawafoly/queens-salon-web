// CORE D1 ONLY — do not add Firestore fallback.

import {
  activeFlag,
  cleanText,
  dbAll,
  dbFirst,
  generatedId,
  normalizePhone,
  optionalText,
  requiredId,
  requiredText,
  rowNotFound,
  updateById,
} from '../d1.js';

export async function listStaff(db, salonId) {
  return dbAll(db, "SELECT * FROM staff WHERE salon_id = ? ORDER BY active DESC, name LIMIT 500", [salonId]);
}

export async function getStaff(db, salonId, id) {
  const row = await dbFirst(db, "SELECT * FROM staff WHERE salon_id = ? AND id = ? LIMIT 1", [salonId, requiredId(id)]);
  if (!row) rowNotFound("staff");
  return row;
}

export async function patchStaff(db, salonId, id, data) {
  return updateById(db, "staff", salonId, requiredId(id), {
    name: data.name === undefined ? undefined : requiredText(data.name, "name"),
    firebase_uid: data.firebaseUid === undefined && data.uid === undefined ? undefined : (optionalText(data.firebaseUid || data.uid) || null),
    phone_normalized: data.phone === undefined && data.phoneNormalized === undefined ? undefined : normalizePhone(data.phoneNormalized || data.phone),
    active: data.active === undefined ? undefined : activeFlag(data.active),
    employment_status: data.employmentStatus === undefined && data.employment_status === undefined
      ? undefined
      : cleanText(data.employmentStatus || data.employment_status || "active"),
  });
}

export function staffIsActive(row) {
  return Number(row?.active) === 1 && cleanText(row?.employment_status || "active") !== "terminated";
}

export function nextStaffId() {
  return generatedId("staff");
}
