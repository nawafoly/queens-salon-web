// CORE D1 ONLY — do not add Firestore fallback.

import {
  activeFlag,
  cleanText,
  dbAll,
  dbFirst,
  generatedId,
  normalizePhone,
  optionalText,
  placeholders,
  requiredId,
  requiredText,
  rowNotFound,
  updateById,
} from '../d1.js';
import { AppError } from '../errors.js';

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

async function attachCanonicalServiceAssignments(db, salonId, staffRows = []) {
  const ids = Array.from(
    new Set(staffRows.map((row) => cleanText(row?.id)).filter(Boolean))
  );
  if (!ids.length) return staffRows;

  const assignmentRows = db.__fakeD1
    ? safeFakeRows(db, "staff_services").filter(
        (row) =>
          row.salon_id === salonId &&
          Number(row.active) === 1 &&
          ids.includes(cleanText(row.staff_id))
      )
    : await dbAll(
        db,
        `SELECT staff_id, service_id
           FROM staff_services
          WHERE salon_id = ?
            AND active = 1
            AND staff_id IN (${placeholders(ids.length)})
          ORDER BY staff_id, service_id`,
        [salonId, ...ids]
      );

  const serviceIdsByStaff = new Map(ids.map((id) => [id, []]));
  for (const row of assignmentRows) {
    const staffId = cleanText(row.staff_id);
    const serviceId = cleanText(row.service_id);
    if (!staffId || !serviceId || !serviceIdsByStaff.has(staffId)) continue;
    serviceIdsByStaff.get(staffId).push(serviceId);
  }

  return staffRows.map((row) => ({
    ...row,
    // staff_services is canonical. specialties_json is exposed as a compatibility
    // projection so every UI reads the same assignments used by booking.
    specialties_json: JSON.stringify(
      Array.from(new Set(serviceIdsByStaff.get(cleanText(row.id)) || []))
    ),
  }));
}

function emptyHrStatusMaps() {
  return {
    profilesById: new Map(),
    profilesByUid: new Map(),
    employmentsById: new Map(),
    accountsByUid: new Map(),
    accountsByEmployeeId: new Map(),
  };
}

function staffIdentityScope(rows = []) {
  const ids = Array.from(
    new Set(rows.map((row) => cleanText(row?.id)).filter(Boolean))
  );
  const uids = Array.from(
    new Set(rows.map((row) => cleanText(row?.firebase_uid)).filter(Boolean))
  );
  return { ids, uids };
}

async function hrStatusMapsForStaff(db, salonId, staffRows = []) {
  const { ids, uids } = staffIdentityScope(staffRows);
  if (!ids.length && !uids.length) return emptyHrStatusMaps();

  if (db.__fakeD1) {
    const wantedIds = new Set(ids);
    const wantedUids = new Set(uids);
    const profiles = safeFakeRows(db, "employee_profiles").filter(
      (row) =>
        row.salon_id === salonId &&
        (wantedIds.has(cleanText(row.id)) || wantedUids.has(cleanText(row.firebase_uid)))
    );
    const employments = safeFakeRows(db, "employee_employment").filter(
      (row) =>
        row.salon_id === salonId && wantedIds.has(cleanText(row.employee_id))
    );
    const accounts = safeFakeRows(db, "app_users").filter(
      (row) => row.salon_id === salonId && wantedUids.has(cleanText(row.firebase_uid))
    );
    const allAccountsById = new Map(
      safeFakeRows(db, "app_users")
        .filter((row) => row.salon_id === salonId)
        .map((row) => [cleanText(row.id), row])
    );
    const links = safeFakeRows(db, "user_employee_links").filter(
      (row) =>
        row.salon_id === salonId &&
        cleanText(row.link_status).toLowerCase() === "active" &&
        wantedIds.has(cleanText(row.employee_id))
    );
    const accountsByEmployeeId = new Map();
    for (const link of links) {
      const account = allAccountsById.get(cleanText(link.user_id));
      if (account) accountsByEmployeeId.set(cleanText(link.employee_id), account);
    }
    return {
      profilesById: new Map(profiles.map((row) => [cleanText(row.id), row])),
      profilesByUid: new Map(
        profiles
          .filter((row) => cleanText(row.firebase_uid))
          .map((row) => [cleanText(row.firebase_uid), row])
      ),
      employmentsById: new Map(
        employments.map((row) => [cleanText(row.employee_id), row])
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
    const profileClauses = [];
    const profileParams = [salonId];
    if (ids.length) {
      profileClauses.push(`id IN (${placeholders(ids.length)})`);
      profileParams.push(...ids);
    }
    if (uids.length) {
      profileClauses.push(`firebase_uid IN (${placeholders(uids.length)})`);
      profileParams.push(...uids);
    }

    const [profiles, employments, accounts, linkedAccounts] = await Promise.all([
      dbAll(
        db,
        `SELECT id, firebase_uid, status
           FROM employee_profiles
          WHERE salon_id = ?
            AND (${profileClauses.join(" OR ")})`,
        profileParams
      ),
      ids.length
        ? dbAll(
            db,
            `SELECT employee_id, employment_status
               FROM employee_employment
              WHERE salon_id = ?
                AND employee_id IN (${placeholders(ids.length)})`,
            [salonId, ...ids]
          )
        : Promise.resolve([]),
      uids.length
        ? dbAll(
            db,
            `SELECT id, firebase_uid, status
               FROM app_users
              WHERE salon_id = ?
                AND firebase_uid IN (${placeholders(uids.length)})`,
            [salonId, ...uids]
          )
        : Promise.resolve([]),
      ids.length
        ? dbAll(
            db,
            `SELECT
               l.employee_id,
               a.id,
               a.firebase_uid,
               a.status
             FROM user_employee_links l
             JOIN app_users a
               ON a.salon_id = l.salon_id
              AND a.id = l.user_id
             WHERE l.salon_id = ?
               AND l.link_status = 'active'
               AND l.employee_id IN (${placeholders(ids.length)})`,
            [salonId, ...ids]
          )
        : Promise.resolve([]),
    ]);

    return {
      profilesById: new Map(profiles.map((row) => [cleanText(row.id), row])),
      profilesByUid: new Map(
        profiles
          .filter((row) => cleanText(row.firebase_uid))
          .map((row) => [cleanText(row.firebase_uid), row])
      ),
      employmentsById: new Map(
        employments.map((row) => [cleanText(row.employee_id), row])
      ),
      accountsByUid: new Map(
        accounts
          .filter((row) => cleanText(row.firebase_uid))
          .map((row) => [cleanText(row.firebase_uid), row])
      ),
      accountsByEmployeeId: new Map(
        linkedAccounts.map((row) => [cleanText(row.employee_id), row])
      ),
    };
  } catch {
    return emptyHrStatusMaps();
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

export async function listStaff(db, salonId, query = {}) {
  const activeOnly = ["1", "true", "yes"].includes(
    cleanText(query.active).toLowerCase()
  );
  const serviceId = cleanText(query.serviceId || query.service_id);

  let rows;
  if (db.__fakeD1) {
    rows = safeFakeRows(db, "staff").filter(
      (row) => row.salon_id === salonId && (!activeOnly || Number(row.active) === 1)
    );
    if (serviceId) {
      const allowedIds = new Set(
        safeFakeRows(db, "staff_services")
          .filter(
            (row) =>
              row.salon_id === salonId &&
              cleanText(row.service_id) === serviceId &&
              Number(row.active) === 1
          )
          .map((row) => cleanText(row.staff_id))
      );
      rows = rows.filter((row) => allowedIds.has(cleanText(row.id)));
    }
    rows.sort((left, right) => {
      const activeDiff = Number(right.active || 0) - Number(left.active || 0);
      if (activeDiff) return activeDiff;
      return cleanText(left.name).localeCompare(cleanText(right.name));
    });
    rows = rows.slice(0, 500);
  } else {
    const params = [];
    let sql = "SELECT DISTINCT s.* FROM staff s";
    if (serviceId) {
      sql += ` JOIN staff_services ss
                 ON ss.salon_id = s.salon_id
                AND ss.staff_id = s.id
                AND ss.service_id = ?
                AND ss.active = 1`;
      params.push(serviceId);
    }
    sql += " WHERE s.salon_id = ?";
    params.push(salonId);
    if (activeOnly) sql += " AND s.active = 1";
    sql += " ORDER BY s.active DESC, s.name LIMIT 500";
    rows = await dbAll(db, sql, params);
  }

  rows = await attachCanonicalServiceAssignments(db, salonId, rows);
  const hrStatusMaps = await hrStatusMapsForStaff(db, salonId, rows);
  const mergedRows = rows.map((row) => mergeHrStatus(row, hrStatusMaps));
  return mergedRows.filter((row) => !activeOnly || staffIsActive(row));
}

export async function listStaffByIds(
  db,
  salonId,
  idValues = []
) {
  const ids =
    Array.from(
      new Set(
        (Array.isArray(idValues)
          ? idValues
          : []
        )
          .map(cleanText)
          .filter(Boolean)
      )
    ).map(
      (value) =>
        requiredId(
          value,
          "employeeId"
        )
    );

  if (!ids.length) {
    return [];
  }

  const wanted =
    new Set(ids);

  const rows =
    db.__fakeD1
      ? safeFakeRows(
          db,
          "staff"
        ).filter(
          (row) =>
            row.salon_id ===
              salonId &&
            wanted.has(
              cleanText(row.id)
            )
        )
      : await dbAll(
          db,
          `SELECT * FROM staff
            WHERE salon_id = ?
              AND id IN (${placeholders(ids.length)})`,
          [
            salonId,
            ...ids,
          ]
        );

  const canonicalRows =
    await attachCanonicalServiceAssignments(
      db,
      salonId,
      rows
    );

  const hrStatusMaps =
    await hrStatusMapsForStaff(
      db,
      salonId,
      canonicalRows
    );

  const byId =
    new Map(
      canonicalRows.map(
        (row) => [
          cleanText(row.id),
          mergeHrStatus(
            row,
            hrStatusMaps
          ),
        ]
      )
    );

  return ids
    .map(
      (id) =>
        byId.get(id)
    )
    .filter(Boolean);
}

export async function getStaff(db, salonId, id) {
  const row = await dbFirst(
    db,
    "SELECT * FROM staff WHERE salon_id = ? AND id = ? LIMIT 1",
    [salonId, requiredId(id)]
  );
  if (!row) rowNotFound("staff");
  const [canonicalRow] = await attachCanonicalServiceAssignments(db, salonId, [row]);
  const hrStatusMaps = await hrStatusMapsForStaff(db, salonId, [canonicalRow]);
  const merged = mergeHrStatus(canonicalRow, hrStatusMaps);
  return merged;
}

export async function patchStaff(db, salonId, id, data) {
  const existingForGuard = await getStaff(db, salonId, id).catch(() => null);
  const nextFlag = data.showOnBooking === undefined && data.show_on_booking === undefined
    ? undefined
    : (data.showOnBooking ?? data.show_on_booking);
  if (nextFlag !== undefined) {
    assertCanEnableShowOnBooking(existingForGuard || {}, nextFlag ? 1 : 0);
  }
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

export function assertCanEnableShowOnBooking(row, nextFlag) {
  if (Number(nextFlag) !== 1) return;
  if (!staffIsActive(row)) {
    throw new AppError(409, "core_staff:inactive_cannot_show_on_booking", "الحساب غير نشط. فعّل حالة الحساب أولاً ثم أعد تفعيل الظهور في صفحة الحجز.");
  }
}

export function staffIsPubliclyBookable(row) {
  return staffIsActive(row) && Number(row?.show_on_booking ?? 1) === 1;
}

export function nextStaffId() {
  return generatedId("staff");
}
