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

async function schedulesForStaff(db, salonId, staffId) {
  if (db.__fakeD1 && typeof db.rows === "function") {
    return db
      .rows("staff_schedules")
      .filter(
        (row) =>
          row.salon_id === salonId && row.staff_id === staffId
      );
  }
  return dbAll(
    db,
    "SELECT * FROM staff_schedules WHERE salon_id = ? AND staff_id = ? ORDER BY weekday, start_time",
    [salonId, staffId]
  );
}

export async function listStaff(db, salonId, query = {}) {
  const rows = await dbAll(
    db,
    "SELECT * FROM staff WHERE salon_id = ? ORDER BY active DESC, name LIMIT 500",
    [salonId]
  );
  const activeOnly = ["1", "true", "yes"].includes(
    cleanText(query.active).toLowerCase()
  );
  const serviceId = cleanText(query.serviceId || query.service_id);

  let filtered = rows.filter(
    (row) => !activeOnly || staffIsActive(row)
  );

  if (serviceId) {
    const allowed = db.__fakeD1 && typeof db.rows === "function"
      ? db
          .rows("staff_services")
          .filter(
            (row) =>
              row.salon_id === salonId &&
              row.service_id === serviceId &&
              Number(row.active) === 1
          )
          .map((row) => row.staff_id)
      : (
          await dbAll(
            db,
            "SELECT staff_id FROM staff_services WHERE salon_id = ? AND service_id = ? AND active = 1",
            [salonId, serviceId]
          )
        ).map((row) => row.staff_id);
    const allowedIds = new Set(allowed);
    filtered = filtered.filter((row) => allowedIds.has(row.id));
  }

  return Promise.all(
    filtered.map(async (row) => ({
      ...row,
      schedules: await schedulesForStaff(db, salonId, row.id),
    }))
  );
}

export async function getStaff(db, salonId, id) {
  const row = await dbFirst(
    db,
    "SELECT * FROM staff WHERE salon_id = ? AND id = ? LIMIT 1",
    [salonId, requiredId(id)]
  );
  if (!row) rowNotFound("staff");
  return {
    ...row,
    schedules: await schedulesForStaff(db, salonId, row.id),
  };
}

export async function patchStaff(db, salonId, id, data) {
  return updateById(db, "staff", salonId, requiredId(id), {
    name:
      data.name === undefined
        ? undefined
        : requiredText(data.name, "name"),
    firebase_uid:
      data.firebaseUid === undefined && data.uid === undefined
        ? undefined
        : optionalText(data.firebaseUid || data.uid) || null,
    phone_normalized:
      data.phone === undefined && data.phoneNormalized === undefined
        ? undefined
        : normalizePhone(data.phoneNormalized || data.phone),
    active:
      data.active === undefined
        ? undefined
        : activeFlag(data.active),
    employment_status:
      data.employmentStatus === undefined &&
      data.employment_status === undefined
        ? undefined
        : cleanText(
            data.employmentStatus ||
              data.employment_status ||
              "active"
          ),
    avatar_url:
      data.avatarUrl === undefined && data.avatar_url === undefined
        ? undefined
        : optionalText(data.avatarUrl || data.avatar_url) || null,
    show_on_booking:
      data.showOnBooking === undefined &&
      data.show_on_booking === undefined
        ? undefined
        : activeFlag(
            data.showOnBooking ?? data.show_on_booking,
            1
          ),
    specialties_json:
      data.specialties === undefined &&
      data.specialties_json === undefined
        ? undefined
        : JSON.stringify(
            Array.isArray(data.specialties)
              ? data.specialties
              : []
          ),
  });
}

export function staffIsActive(row) {
  return (
    Number(row?.active) === 1 &&
    cleanText(row?.employment_status || "active") !== "terminated"
  );
}

export function nextStaffId() {
  return generatedId("staff");
}
