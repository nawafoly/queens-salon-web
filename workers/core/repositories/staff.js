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
        row.salon_id === salonId && wantedIds.has(cleanText(row.employee_id))
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
  const rows = await dbAll(
    db,
    "SELECT * FROM staff WHERE salon_id = ? ORDER BY active DESC, name LIMIT 500",
    [salonId]
  );
  const hrStatusMaps = await hrStatusMapsForStaff(db, salonId, rows);
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

  return filtered;
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

  const hrStatusMaps =
    await hrStatusMapsForStaff(
      db,
      salonId,
      rows
    );

  const byId =
    new Map(
      rows.map(
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
  const hrStatusMaps = await hrStatusMapsForStaff(db, salonId, [row]);
  const merged = mergeHrStatus(row, hrStatusMaps);
  return merged;
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

export function nextStaffId() {
  return generatedId("staff");
}
