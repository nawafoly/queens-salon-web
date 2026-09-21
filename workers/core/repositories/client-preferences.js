// CORE D1 ONLY — canonical MALIKAT client relationship preferences.

import {
  cleanText,
  dbFirst,
  dbRun,
  nowIso,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';

function flag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (Number(value) === 1) return true;
  if (Number(value) === 0) return false;
  const normalized = cleanText(value).toLowerCase();
  if (['true', 'yes', 'on'].includes(normalized)) return true;
  if (['false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

async function assertClient(db, salonId, clientIdValue) {
  const clientId = requiredId(clientIdValue, 'clientId');
  const row = await dbFirst(
    db,
    'SELECT id FROM clients WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, clientId]
  );
  if (!row) throw new AppError(404, 'core_client:not_found');
  return clientId;
}

async function resolvePreferredStaff(db, salonId, staffIdValue) {
  const staffId = cleanText(staffIdValue);
  if (!staffId) return null;
  const row = await dbFirst(
    db,
    "SELECT id, name, active, employment_status FROM staff WHERE salon_id = ? AND id = ? AND active = 1 LIMIT 1",
    [salonId, requiredId(staffId, 'preferredStaffId')]
  );
  const employmentStatus = cleanText(row?.employment_status).toLowerCase();
  if (
    !row ||
    ['inactive', 'archived', 'deleted', 'terminated'].includes(employmentStatus)
  ) {
    throw new AppError(409, 'core_client_preferences:preferred_staff_unavailable');
  }
  return row;
}

function mapPreference(row, clientId) {
  return {
    clientId,
    preferredStaffId: cleanText(row?.preferred_staff_id) || null,
    preferredStaffName: cleanText(row?.preferred_staff_name) || null,
    preferredStaffSource: cleanText(row?.preferred_staff_source) || null,
    serviceMessagesEnabled:
      row ? Number(row.service_messages_enabled) === 1 : true,
    marketingConsent: row ? Number(row.marketing_consent) === 1 : false,
    connectEnabled: row ? Number(row.connect_enabled) === 1 : true,
    updatedAt: cleanText(row?.updated_at) || null,
  };
}

export async function getClientPreferences(db, salonId, clientIdValue) {
  const clientId = await assertClient(db, salonId, clientIdValue);
  const row = await dbFirst(
    db,
    `SELECT
       cp.*,
       s.name AS preferred_staff_name
     FROM client_preferences cp
     LEFT JOIN staff s
       ON s.salon_id = cp.salon_id
      AND s.id = cp.preferred_staff_id
     WHERE cp.salon_id = ?
       AND cp.client_id = ?
     LIMIT 1`,
    [salonId, clientId]
  );
  return mapPreference(row, clientId);
}

export async function updateClientPreferences(
  db,
  salonId,
  clientIdValue,
  input = {},
  actor = {},
  options = {}
) {
  const clientId = await assertClient(db, salonId, clientIdValue);
  const current = await getClientPreferences(db, salonId, clientId);
  const clientSelf = options.clientSelf === true;

  const hasPreferredStaff =
    Object.prototype.hasOwnProperty.call(input, 'preferredStaffId') ||
    Object.prototype.hasOwnProperty.call(input, 'preferred_staff_id');
  const requestedStaffId = hasPreferredStaff
    ? cleanText(input.preferredStaffId ?? input.preferred_staff_id)
    : cleanText(current.preferredStaffId);
  const staff = requestedStaffId
    ? await resolvePreferredStaff(db, salonId, requestedStaffId)
    : null;

  const serviceMessagesEnabled = clientSelf
    ? current.serviceMessagesEnabled
    : flag(
        input.serviceMessagesEnabled ?? input.service_messages_enabled,
        current.serviceMessagesEnabled
      );
  const connectEnabled = clientSelf
    ? current.connectEnabled
    : flag(
        input.connectEnabled ?? input.connect_enabled,
        current.connectEnabled
      );
  const marketingConsent = flag(
    input.marketingConsent ?? input.marketing_consent,
    current.marketingConsent
  );

  const source = hasPreferredStaff
    ? clientSelf
      ? 'client'
      : cleanText(input.preferredStaffSource ?? input.preferred_staff_source) ||
        'admin'
    : current.preferredStaffSource;

  const now = nowIso();
  const actorUid = cleanText(actor.uid || actor.identity?.uid) || null;

  await dbRun(
    db,
    `INSERT INTO client_preferences
      (salon_id, client_id, preferred_staff_id, preferred_staff_source,
       service_messages_enabled, marketing_consent, connect_enabled,
       updated_by_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(salon_id, client_id) DO UPDATE SET
       preferred_staff_id = excluded.preferred_staff_id,
       preferred_staff_source = excluded.preferred_staff_source,
       service_messages_enabled = excluded.service_messages_enabled,
       marketing_consent = excluded.marketing_consent,
       connect_enabled = excluded.connect_enabled,
       updated_by_uid = excluded.updated_by_uid,
       updated_at = excluded.updated_at`,
    [
      salonId,
      clientId,
      staff?.id || null,
      staff ? source || (clientSelf ? 'client' : 'admin') : null,
      serviceMessagesEnabled ? 1 : 0,
      marketingConsent ? 1 : 0,
      connectEnabled ? 1 : 0,
      actorUid,
      now,
      now,
    ]
  );

  return getClientPreferences(db, salonId, clientId);
}
