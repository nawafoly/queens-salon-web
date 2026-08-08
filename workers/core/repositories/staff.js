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

const inactiveEmploymentStatuses = new Set([
  "inactive",
  "disabled",
  "suspended",
  "archived",
  "deleted",
  "terminated",
  "resigned",
  "ended",
  "stopped",
  "blocked",
]);

function safeFakeRows(db, table) {
  if (!db.__fakeD1 || typeof db.rows !== "function") return [];
  try {
    return db.rows(table);
  } catch {
    return [];
  }
}

async function hrStatusMapsForStaff(db, salonId) {
  if (db.__fakeD1) {
    const profiles = safeFakeRows(db, "employee_profiles").filter(
      (row) => row.salon_id === salonId
    );
    const employments = safeFakeRows(db, "employee_employment").filter(
      (row) => row.salon_id === salonId
    );
    const accounts = safeFakeRows(db, "app_users").filter(
      (row) => row.salon_id === salonId
    );
    const links = safeFakeRows(db, "user_employee_links").filter(
      (row) => row.salon_id === salonId
    );
    const accountsById = new Map(accounts.map((row) => [row.id, row]));
    const accountsByEmployeeId = new Map();
    for (const link of links) {
      const account = accountsById.get(link.user_id);
      if (account) accountsByEmployeeId.set(link.employee_id, account);
    }
    return {
      profilesById: new Map(profiles.map((row) => [row.id, row])),
      profilesByUid: new Map(
        profiles
          .filter((row) => cleanText(row.firebase_uid))
          .map((row) => [cleanText(row.firebase_uid), row])
      ),
      employmentsById: new Map(
        employments.map((row) => [row.employee_id, row])
      ),
      accountsByUid: new Map(
        accounts
          .filter((row) => cleanText(row.firebase_uid))
          .map((row) => [cleanText(row.firebase_uid), row])
      ),
      accountsByEmployeeId,
    };
  }

  try {
    const [profiles, employments, accounts, links] = await Promise.all([
      dbAll(
        db,
        "SELECT id, firebase_uid, status FROM employee_profiles WHERE salon_id = ?",
        [salonId]
      ),
      dbAll(
        db,
        "SELECT employee_id, employment_status FROM employee_employment WHERE salon_id = ?",
        [salonId]
      ),
      dbAll(
        db,
        "SELECT id, firebase_uid, status FROM app_users WHERE salon_id = ?",
        [salonId]
      ),
      dbAll(
        db,
        "SELECT user_id, employee_id, link_status FROM user_employee_links WHERE salon_id = ?",
        [salonId]
      ),
    ]);
    const accountsById = new Map(accounts.map((row) => [row.id, row]));
    const accountsByEmployeeId = new Map();
    for (const link of links) {
      const account = accountsById.get(link.user_id);
      if (account) accountsByEmployeeId.set(link.employee_id, account);
    }
    return {
      profilesById: new Map(profiles.map((row) => [row.id, row])),
      profilesByUid: new Map(
        profiles
          .filter((row) => cleanText(row.firebase_uid))
          .map((row) => [cleanText(row.firebase_uid), row])
      ),
      employmentsById: new Map(
        employments.map((row) => [row.employee_id, row])
      ),
      accountsByUid: new Map(
        accounts
          .filter((row) => cleanText(row.firebase_uid))
          .map((row) => [cleanText(row.firebase_uid), row])
      ),
      accountsByEmployeeId,
    };
  } catch {
    return {
      profilesById: new Map(),
      profilesByUid: new Map(),
      employmentsById: new Map(),
      accountsByUid: new Map(),
      accountsByEmployeeId: new Map(),
    };
  }
}

function mergeHrStatus(row, maps) {
  const profile =
    maps.profilesById.get(row.id) ||
    maps.profilesByUid.get(cleanText(row.firebase_uid)) ||
    null;
  const employment = maps.employmentsById.get(row.id) || null;
  const account =
    maps.accountsByUid.get(cleanText(row.firebase_uid)) ||
    maps.accountsByEmployeeId.get(row.id) ||
    null;
  return {
    ...row,
    hr_profile_status: profile?.status ?? row.hr_profile_status,
    hr_employment_status:
      employment?.employment_status ?? row.hr_employment_status,
    hr_account_status: account?.status ?? row.hr_account_status,
  };
}

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
  const hrStatusMaps = await hrStatusMapsForStaff(db, salonId);
  const mergedRows = rows.map((row) => mergeHrStatus(row, hrStatusMaps));
  const activeOnly = ["1", "true", "yes"].includes(
    cleanText(query.active).toLowerCase()
  );
  const serviceId = cleanText(query.serviceId || query.service_id);

  let filtered = mergedRows.filter(
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
  const hrStatusMaps = await hrStatusMapsForStaff(db, salonId);
  const merged = mergeHrStatus(row, hrStatusMaps);
  return {
    ...merged,
    schedules: await schedulesForStaff(db, salonId, merged.id),
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
    leave_start_date:
      data.leaveStartDate === undefined &&
      data.leave_start_date === undefined
        ? undefined
        : optionalText(data.leaveStartDate || data.leave_start_date) || null,
    leave_end_date:
      data.leaveEndDate === undefined &&
      data.leave_end_date === undefined
        ? undefined
        : optionalText(data.leaveEndDate || data.leave_end_date) || null,
    leave_note:
      data.leaveNote === undefined && data.leave_note === undefined
        ? undefined
        : optionalText(data.leaveNote || data.leave_note) || null,
  });
}

export function staffIsActive(row) {
  const statuses = [
    row?.employment_status,
    row?.hr_profile_status,
    row?.hr_employment_status,
    row?.hr_account_status,
  ].map((status) => cleanText(status || "active").toLowerCase());
  return (
    Number(row?.active) === 1 &&
    statuses.every((status) => !inactiveEmploymentStatuses.has(status))
  );
}

export function staffIsPubliclyBookable(row) {
  return staffIsActive(row) && Number(row?.show_on_booking ?? 1) === 1;
}

function timeInsideWindow(time, start, end) {
  const value = cleanText(time);
  const from = cleanText(start);
  const to = cleanText(end);
  return Boolean(value && from && to && value >= from && value <= to);
}

export function staffIsAvailableForDate(row, date, startTime = "", endTime = "") {
  if (!staffIsActive(row)) return false;
  const day = cleanText(date);
  const leaveStart = cleanText(row?.leave_start_date);
  const leaveEnd = cleanText(row?.leave_end_date);
  if (day && (leaveStart || leaveEnd)) {
    const afterStart = !leaveStart || day >= leaveStart;
    const beforeEnd = !leaveEnd || day <= leaveEnd;
    if (afterStart && beforeEnd) return false;
  }

  const schedules = Array.isArray(row?.schedules) ? row.schedules : [];
  if (!schedules.length || !day) return true;
  const weekday = new Date(`${day}T12:00:00.000Z`).getUTCDay();
  const daySchedules = schedules.filter(
    (schedule) =>
      Number(schedule.weekday) === weekday &&
      Number(schedule.active) === 1
  );
  if (!daySchedules.length) return false;
  if (!startTime || !endTime) return true;
  return daySchedules.some(
    (schedule) =>
      timeInsideWindow(startTime, schedule.start_time, schedule.end_time) &&
      timeInsideWindow(endTime, schedule.start_time, schedule.end_time)
  );
}

export function nextStaffId() {
  return generatedId("staff");
}
