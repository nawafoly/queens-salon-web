const ATTENDANCE_ALLOWED_ROLES = new Set([
  "owner",
  "admin",
  "accountant",
  "hr",
  "staff",
  "reception",
]);
const ATTENDANCE_TYPES = new Set(["check_in", "check_out"]);
const ATTENDANCE_RESULTS = new Set(["allowed", "rejected"]);
const ATTENDANCE_ADMIN_ROLES = new Set(["owner", "admin", "hr"]);
const ATTENDANCE_BASE_MAX_ACCURACY_METERS = 150;
const ATTENDANCE_MAX_ACCURACY_METERS = 200;
const ATTENDANCE_RECORDS_DEFAULT_LIMIT = 50;
const ATTENDANCE_RECORDS_MAX_LIMIT = 200;
const EARTH_RADIUS_METERS = 6371008.8;

export async function handleAttendanceRequest({
  request,
  url,
  db,
  directoryDb,
  salonId = "main",
  resolveRequesterContext,
  fetchFirestoreDocument,
  queryFirestoreDocuments,
}) {
  const pathname = url.pathname;
  const zoneMatch = pathname.match(/^\/attendance\/work-zones\/([^/]+)$/);
  const deviceMatch = pathname.match(/^\/attendance\/admin\/devices\/([^/]+)$/);
  const securityEventMatch = pathname.match(/^\/attendance\/admin\/security-events\/([^/]+)$/);

  if (pathname === "/attendance/record" && request.method !== "POST") {
    return methodNotAllowed(["POST"]);
  }
  if (
    pathname === "/attendance/admin-adjustment" &&
    request.method !== "POST"
  ) {
    return methodNotAllowed(["POST"]);
  }
  if (
    pathname === "/attendance/monthly-summary/generate" &&
    request.method !== "POST"
  ) {
    return methodNotAllowed(["POST"]);
  }
  if (
    pathname === "/attendance/monthly-summaries" &&
    request.method !== "GET"
  ) {
    return methodNotAllowed(["GET"]);
  }
  if (pathname === "/attendance/records" && request.method !== "GET") {
    return methodNotAllowed(["GET"]);
  }
  if (
    pathname === "/attendance/admin/dashboard" &&
    request.method !== "GET"
  ) {
    return methodNotAllowed(["GET"]);
  }
  if (deviceMatch && request.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }
  if (securityEventMatch && request.method !== "PATCH") {
    return methodNotAllowed(["PATCH"]);
  }
  if (
    pathname === "/attendance/work-zones" &&
    !["GET", "POST"].includes(request.method)
  ) {
    return methodNotAllowed(["GET", "POST"]);
  }
  if (zoneMatch && !["PATCH", "DELETE"].includes(request.method)) {
    return methodNotAllowed(["PATCH", "DELETE"]);
  }
  if (
    pathname !== "/attendance/record" &&
    pathname !== "/attendance/admin-adjustment" &&
    pathname !== "/attendance/monthly-summary/generate" &&
    pathname !== "/attendance/monthly-summaries" &&
    pathname !== "/attendance/records" &&
    pathname !== "/attendance/admin/dashboard" &&
    pathname !== "/attendance/work-zones" &&
    !zoneMatch &&
    !deviceMatch &&
    !securityEventMatch
  ) {
    return json(404, { ok: false, message: "not_found" });
  }

  const requester = await resolveRequesterContext(request);
  if (!requester.ok) return requester.response;

  if (!requester.runtime?.isActive) {
    return json(403, { ok: false, message: "inactive_account" });
  }


  if (pathname === "/attendance/admin/dashboard" && request.method === "GET") {
    if (!hasRuntimePermission(requester.runtime, "attendance.view")) {
      return forbidden("attendance.view");
    }
    return getAttendanceSecurityDashboard(url, db, directoryDb);
  }

  if (deviceMatch && request.method === "PATCH") {
    if (!hasRuntimePermission(requester.runtime, "attendance.settings.manage")) {
      return forbidden("attendance.settings.manage");
    }
    return updateAttendanceDevice(
      request,
      db,
      requester,
      decodeURIComponent(deviceMatch[1])
    );
  }

  if (securityEventMatch && request.method === "PATCH") {
    if (
      !hasAnyRuntimePermission(requester.runtime, [
        "attendance.records.update",
        "attendance.settings.manage",
      ])
    ) {
      return forbidden("attendance.records.update|attendance.settings.manage");
    }
    return updateAttendanceSecurityEvent(
      request,
      db,
      requester,
      decodeURIComponent(securityEventMatch[1])
    );
  }

  if (pathname === "/attendance/work-zones" && request.method === "GET") {
    if (!hasRuntimePermission(requester.runtime, "attendance.settings.manage")) {
      return forbidden("attendance.settings.manage");
    }
    return listWorkZones(db);
  }

  if (pathname === "/attendance/records" && request.method === "GET") {
    const employeeUid = normalizeText(url.searchParams.get("employeeUid"));
    if (!canReadAttendanceRecords(requester.runtime, requester.uid, employeeUid)) {
      return json(403, {
        ok: false,
        message: "attendance_records_forbidden",
        requiredPermission: "attendance.view",
        authorization: {
          role: requester.runtime?.role || "guest",
          active: Boolean(requester.runtime?.isActive),
          permissionVersion: Number(requester.runtime?.permissionVersion || 0) || 0,
          permissions: Array.isArray(requester.runtime?.permissionsAllow)
            ? requester.runtime.permissionsAllow
            : [],
          authSource: requester.authSource || null,
          cacheHit: Boolean(requester.permissionCache?.hit),
          cacheExpiresAt: requester.permissionCache?.expiresAt || null,
        },
      });
    }
    return listAttendanceRecords(url, db, directoryDb);
  }

  if (pathname === "/attendance/monthly-summaries" && request.method === "GET") {
    const employeeUid = normalizeText(url.searchParams.get("employeeUid"));
    if (!canReadAttendanceRecords(requester.runtime, requester.uid, employeeUid)) {
      return json(403, {
        ok: false,
        message: "attendance_records_forbidden",
        requiredPermission: "attendance.view",
        authorization: {
          role: requester.runtime?.role || "guest",
          active: Boolean(requester.runtime?.isActive),
          permissionVersion: Number(requester.runtime?.permissionVersion || 0) || 0,
          permissions: Array.isArray(requester.runtime?.permissionsAllow)
            ? requester.runtime.permissionsAllow
            : [],
          authSource: requester.authSource || null,
          cacheHit: Boolean(requester.permissionCache?.hit),
          cacheExpiresAt: requester.permissionCache?.expiresAt || null,
        },
      });
    }
    return listAttendanceMonthlySummaries(url, db);
  }

  if (pathname === "/attendance/work-zones" && request.method === "POST") {
    if (!hasRuntimePermission(requester.runtime, "attendance.settings.manage")) {
      return forbidden("attendance.settings.manage");
    }
    return createWorkZone(request, db, requester);
  }

  if (pathname === "/attendance/admin-adjustment" && request.method === "POST") {
    if (
      !hasAnyRuntimePermission(requester.runtime, [
        "attendance.records.create",
        "attendance.records.update",
        "attendance.records.delete",
      ])
    ) {
      return forbidden("attendance.records.create|update|delete");
    }
    return adjustAttendanceRecords(request, db, requester);
  }

  if (
    pathname === "/attendance/monthly-summary/generate" &&
    request.method === "POST"
  ) {
    if (!hasRuntimePermission(requester.runtime, "attendance.export")) {
      return forbidden("attendance.export");
    }
    return generateAttendanceMonthlySummaryRequest(request, db);
  }

  if (zoneMatch && request.method === "PATCH") {
    if (!hasRuntimePermission(requester.runtime, "attendance.settings.manage")) {
      return forbidden("attendance.settings.manage");
    }
    return updateWorkZone(
      request,
      db,
      requester,
      decodeURIComponent(zoneMatch[1])
    );
  }

  if (zoneMatch && request.method === "DELETE") {
    if (!hasRuntimePermission(requester.runtime, "attendance.settings.manage")) {
      return forbidden("attendance.settings.manage");
    }
    return deleteWorkZone(db, decodeURIComponent(zoneMatch[1]));
  }

  if (pathname === "/attendance/record" && request.method === "POST") {
    if (!hasRuntimePermission(requester.runtime, "attendance.own.view")) {
      return forbidden("attendance.own.view");
    }
    return recordAttendance({
      request,
      db,
      requester,
      salonId,
      fetchFirestoreDocument,
      queryFirestoreDocuments,
    });
  }

  return json(500, { ok: false, message: "attendance_router_unreachable" });
}

function methodNotAllowed(methods) {
  const response = json(405, { ok: false, message: "method_not_allowed" });
  response.headers.set("Allow", methods.join(", "));
  return response;
}

function hasRuntimePermission(runtime, permission) {
  if (!runtime?.isActive) return false;

  // The central permission model defines owner as an unconditional superuser.
  // Keep this invariant at the final authorization boundary as defense in depth.
  if (runtime?.role === "owner") return true;

  const allow = new Set(
    Array.isArray(runtime?.permissionsAllow)
      ? runtime.permissionsAllow
      : Array.isArray(runtime?.permissions)
        ? runtime.permissions
        : []
  );
  const deny = new Set(
    Array.isArray(runtime?.permissionsDeny)
      ? runtime.permissionsDeny
      : []
  );

  return allow.has(permission) && !deny.has(permission);
}

function hasAnyRuntimePermission(runtime, permissions) {
  return permissions.some(permission =>
    hasRuntimePermission(runtime, permission)
  );
}

function canReadAttendanceRecords(runtime, requesterUid, employeeUid) {
  if (!runtime?.isActive) return false;

  if (hasRuntimePermission(runtime, "attendance.view")) {
    return true;
  }

  return Boolean(
    employeeUid &&
      employeeUid === requesterUid &&
      hasRuntimePermission(runtime, "attendance.own.view")
  );
}

function forbidden(requiredPermission = "attendance.permission") {
  return json(403, {
    ok: false,
    message: "attendance_permission_forbidden",
    requiredPermission,
  });
}

async function listWorkZones(db) {
  try {
    const result = await db
      .prepare(
        `
      SELECT id, name, type, center_lat, center_lng, radius_meters, active,
             office_ip, created_at, updated_at
      FROM work_zones
      ORDER BY name COLLATE NOCASE ASC, id ASC
    `
      )
      .all();
    return json(200, {
      ok: true,
      zones: (result.results || []).map(mapWorkZoneRow),
    });
  } catch (error) {
    return serverError("work_zones_query_failed", error);
  }
}


export function classifyAttendanceDeviceSecurity(input = {}) {
  const deviceId = normalizeText(input.deviceId);
  const previousDeviceId = normalizeText(input.previousDeviceId);
  const trustStatus = normalizeAttendanceDeviceStatus(input.trustStatus);
  const assignmentCount = Math.max(0, Number(input.assignmentCount || 0));
  const assignedToEmployee = Boolean(input.assignedToEmployee);
  const result = normalizeText(input.result);
  const rejectionReason = normalizeText(input.rejectionReason);
  const accuracy = Number(input.accuracy);

  const flags = {
    hasDevice: Boolean(deviceId),
    isNewDevice: Boolean(deviceId && !input.deviceExists),
    isNewForEmployee: Boolean(deviceId && !assignedToEmployee),
    deviceChanged: Boolean(
      deviceId && previousDeviceId && previousDeviceId !== deviceId
    ),
    sharedDevice: Boolean(deviceId && assignmentCount > (assignedToEmployee ? 1 : 0)),
    blockedDevice: trustStatus === "blocked",
    rejectedPunch: result === "rejected",
    poorAccuracy: Number.isFinite(accuracy) && accuracy > ATTENDANCE_BASE_MAX_ACCURACY_METERS,
  };

  const eventTypes = [];
  if (flags.isNewDevice) eventTypes.push("new_device");
  if (flags.deviceChanged) eventTypes.push("device_changed");
  if (flags.sharedDevice) eventTypes.push("shared_device");
  if (flags.blockedDevice) eventTypes.push("blocked_device_attempt");
  if (flags.rejectedPunch && rejectionReason !== "blocked_device") {
    eventTypes.push("rejected_punch");
  }
  if (flags.poorAccuracy && rejectionReason === "poor_accuracy") {
    eventTypes.push("poor_accuracy");
  }

  return {
    ...flags,
    trustStatus,
    eventTypes: Array.from(new Set(eventTypes)),
  };
}

function normalizeAttendanceDeviceStatus(value) {
  const status = normalizeText(value).toLowerCase();
  return new Set(["new", "trusted", "blocked"]).has(status) ? status : "new";
}

function normalizeAttendanceSecurityEventStatus(value) {
  const status = normalizeText(value).toLowerCase();
  return new Set(["open", "resolved", "ignored"]).has(status) ? status : "open";
}

async function getAttendanceSecurityDashboard(url, db, directoryDb) {
  const params = url.searchParams;
  const limit = Math.min(200, Math.max(1, Number(params.get("limit") || 100)));
  const employeeUid = normalizeText(params.get("employeeUid"));
  const result = normalizeText(params.get("result"));
  const type = normalizeText(params.get("type"));
  const deviceId = normalizeText(params.get("deviceId"));
  const alertStatus = normalizeAttendanceSecurityEventStatus(params.get("alertStatus") || "open");
  const fromDate = normalizeText(params.get("fromDate"));
  const toDate = normalizeText(params.get("toDate"));
  const filters = [];
  const bindings = [];

  if (employeeUid) {
    filters.push("employee_uid = ?");
    bindings.push(employeeUid);
  }
  if (result) {
    if (!ATTENDANCE_RESULTS.has(result)) return invalidRecordsQuery("result");
    filters.push("result = ?");
    bindings.push(result);
  }
  if (type) {
    if (!ATTENDANCE_TYPES.has(type)) return invalidRecordsQuery("type");
    filters.push("type = ?");
    bindings.push(type);
  }
  if (deviceId) {
    filters.push("trim(json_extract(device_info, '$.deviceId')) = ?");
    bindings.push(deviceId);
  }
  if (fromDate) {
    const boundary = parseRiyadhDateBoundary(fromDate, false);
    if (!boundary) return invalidRecordsQuery("fromDate");
    filters.push("server_time >= ?");
    bindings.push(boundary);
  }
  if (toDate) {
    const boundary = parseRiyadhDateBoundary(toDate, true);
    if (!boundary) return invalidRecordsQuery("toDate");
    filters.push("server_time < ?");
    bindings.push(boundary);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const today = getRiyadhDayBounds();

  try {
    const results = await db.batch([
      db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN type = 'check_in' THEN 1 ELSE 0 END) AS check_ins,
          SUM(CASE WHEN type = 'check_out' THEN 1 ELSE 0 END) AS check_outs,
          SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          AVG(CASE WHEN location_accuracy > 0 THEN location_accuracy ELSE NULL END) AS average_accuracy
        FROM attendance_records
        WHERE server_time >= ? AND server_time < ?
      `).bind(today.start, today.end),
      db.prepare(`SELECT COUNT(*) AS checked_in FROM attendance_state WHERE status = 'checked_in'`),
      db.prepare(`SELECT COUNT(*) AS new_devices FROM attendance_devices WHERE first_seen_at >= ? AND first_seen_at < ?`).bind(today.start, today.end),
      db.prepare(`
        SELECT COUNT(*) AS shared_devices FROM (
          SELECT device_id FROM attendance_device_assignments
          GROUP BY device_id HAVING COUNT(DISTINCT employee_uid) > 1
        )
      `),
      db.prepare(`SELECT COUNT(*) AS open_alerts FROM attendance_security_events WHERE status = 'open'`),
      db.prepare(`
        SELECT
          id, employee_uid, employee_doc_id, type, server_time, client_time,
          location_lat, location_lng, location_accuracy,
          zone_id, zone_name, zone_type, allowed_zone_ids, distance_meters,
          result, rejection_reason, accuracy_accepted, device_info,
          created_by_email, created_by_role
        FROM attendance_records
        ${whereSql}
        ORDER BY server_time DESC, id DESC
        LIMIT ?
      `).bind(...bindings, limit),
      db.prepare(`
        SELECT
          device_id, first_seen_at, last_seen_at,
          first_seen_employee_uid, last_seen_employee_uid,
          platform, user_agent, language, time_zone,
          app_variant, app_version, screen_size, standalone,
          total_records, allowed_records, rejected_records,
          trust_status, notes, trusted_by_uid, trusted_at,
          blocked_by_uid, blocked_at, created_at, updated_at
        FROM attendance_devices
        ORDER BY
          CASE trust_status WHEN 'blocked' THEN 0 WHEN 'new' THEN 1 ELSE 2 END,
          last_seen_at DESC
        LIMIT 200
      `),
      db.prepare(`
        SELECT
          id, event_type, severity, employee_uid, employee_doc_id,
          device_id, record_id, title, detail, metadata_json,
          status, resolved_by_uid, resolved_at, created_at, updated_at
        FROM attendance_security_events
        WHERE status = ?
        ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
          created_at DESC
        LIMIT 200
      `).bind(alertStatus),
      db.prepare(`
        SELECT id, name, type, center_lat, center_lng, radius_meters, active,
               office_ip, created_at, updated_at
        FROM work_zones
        ORDER BY active DESC, name COLLATE NOCASE ASC
      `),
    ]);

    const recordRows = results[5]?.results || [];
    const deviceRows = results[6]?.results || [];
    const deviceIds = deviceRows.map(row => normalizeText(row.device_id)).filter(Boolean);
    const assignmentRows = deviceIds.length
      ? (await db.prepare(`
          SELECT device_id, employee_uid, employee_doc_id,
                 first_seen_at, last_seen_at, records_count,
                 allowed_count, rejected_count, is_primary
          FROM attendance_device_assignments
          WHERE device_id IN (${deviceIds.map(() => "?").join(",")})
          ORDER BY device_id ASC, last_seen_at DESC
        `).bind(...deviceIds).all()).results || []
      : [];
    const employeeNames = await loadAttendanceEmployeeNames(
      directoryDb,
      Array.from(new Set([
        ...recordRows.map(row => row.employee_uid),
        ...assignmentRows.map(row => row.employee_uid),
        ...(results[7]?.results || []).map(row => row.employee_uid),
      ]))
    );
    const sharedUsage = await loadSharedDeviceUsage(
      db,
      directoryDb,
      recordRows.map(row => safeJsonObject(row.device_info)?.deviceId)
    );
    const assignmentsByDevice = new Map();
    for (const row of assignmentRows) {
      const current = assignmentsByDevice.get(row.device_id) || [];
      current.push({
        employeeUid: row.employee_uid,
        employeeDocId: row.employee_doc_id || null,
        employeeName: employeeNames.get(row.employee_uid) || null,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        recordsCount: Number(row.records_count || 0),
        allowedCount: Number(row.allowed_count || 0),
        rejectedCount: Number(row.rejected_count || 0),
        isPrimary: Number(row.is_primary) === 1,
      });
      assignmentsByDevice.set(row.device_id, current);
    }

    const todaySummary = results[0]?.results?.[0] || {};
    return json(200, {
      ok: true,
      summary: {
        date: today.date,
        punchesToday: Number(todaySummary.total || 0),
        checkInsToday: Number(todaySummary.check_ins || 0),
        checkOutsToday: Number(todaySummary.check_outs || 0),
        rejectedToday: Number(todaySummary.rejected || 0),
        checkedInNow: Number(results[1]?.results?.[0]?.checked_in || 0),
        newDevicesToday: Number(results[2]?.results?.[0]?.new_devices || 0),
        sharedDevices: Number(results[3]?.results?.[0]?.shared_devices || 0),
        openAlerts: Number(results[4]?.results?.[0]?.open_alerts || 0),
        averageAccuracy: todaySummary.average_accuracy == null ? null : Number(todaySummary.average_accuracy),
      },
      records: recordRows.map(row =>
        mapAttendanceRecordRow(
          row,
          employeeNames.get(row.employee_uid),
          sharedUsage.get(normalizeText(safeJsonObject(row.device_info)?.deviceId))
        )
      ),
      devices: deviceRows.map(row => ({
        deviceId: row.device_id,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        firstSeenEmployeeUid: row.first_seen_employee_uid || null,
        lastSeenEmployeeUid: row.last_seen_employee_uid || null,
        platform: row.platform || null,
        userAgent: row.user_agent || null,
        language: row.language || null,
        timeZone: row.time_zone || null,
        appVariant: row.app_variant || null,
        appVersion: row.app_version || null,
        screenSize: row.screen_size || null,
        standalone: Number(row.standalone) === 1,
        totalRecords: Number(row.total_records || 0),
        allowedRecords: Number(row.allowed_records || 0),
        rejectedRecords: Number(row.rejected_records || 0),
        trustStatus: normalizeAttendanceDeviceStatus(row.trust_status),
        notes: row.notes || null,
        trustedByUid: row.trusted_by_uid || null,
        trustedAt: row.trusted_at || null,
        blockedByUid: row.blocked_by_uid || null,
        blockedAt: row.blocked_at || null,
        assignments: assignmentsByDevice.get(row.device_id) || [],
      })),
      alerts: (results[7]?.results || []).map(row => ({
        id: row.id,
        eventType: row.event_type,
        severity: row.severity,
        employeeUid: row.employee_uid,
        employeeDocId: row.employee_doc_id || null,
        employeeName: employeeNames.get(row.employee_uid) || null,
        deviceId: row.device_id || null,
        recordId: row.record_id || null,
        title: row.title,
        detail: row.detail || null,
        metadata: safeJsonObject(row.metadata_json),
        status: row.status,
        resolvedByUid: row.resolved_by_uid || null,
        resolvedAt: row.resolved_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      zones: (results[8]?.results || []).map(mapWorkZoneRow),
    });
  } catch (error) {
    return serverError("attendance_security_dashboard_query_failed", error);
  }
}

async function updateAttendanceDevice(request, db, requester, rawDeviceId) {
  const deviceId = normalizeText(rawDeviceId);
  const input = await readJsonBody(request);
  if (!input.ok) return input.response;
  const trustStatus = normalizeAttendanceDeviceStatus(input.data?.trustStatus);
  const notes = clampText(input.data?.notes, 500) || null;
  if (!deviceId) return json(400, { ok: false, message: "invalid_device_id" });
  if (!new Set(["new", "trusted", "blocked"]).has(normalizeText(input.data?.trustStatus))) {
    return json(400, { ok: false, message: "invalid_device_status" });
  }

  const now = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE attendance_devices
    SET trust_status = ?, notes = ?,
        trusted_by_uid = CASE WHEN ? = 'trusted' THEN ? ELSE NULL END,
        trusted_at = CASE WHEN ? = 'trusted' THEN ? ELSE NULL END,
        blocked_by_uid = CASE WHEN ? = 'blocked' THEN ? ELSE NULL END,
        blocked_at = CASE WHEN ? = 'blocked' THEN ? ELSE NULL END,
        updated_at = ?
    WHERE device_id = ?
  `).bind(
    trustStatus,
    notes,
    trustStatus,
    requester.uid,
    trustStatus,
    now,
    trustStatus,
    requester.uid,
    trustStatus,
    now,
    now,
    deviceId
  ).run();

  if (!Number(result.meta?.changes || 0)) {
    return json(404, { ok: false, message: "attendance_device_not_found" });
  }
  return json(200, { ok: true, deviceId, trustStatus, notes });
}

async function updateAttendanceSecurityEvent(request, db, requester, rawEventId) {
  const eventId = normalizeText(rawEventId);
  const input = await readJsonBody(request);
  if (!input.ok) return input.response;
  const status = normalizeAttendanceSecurityEventStatus(input.data?.status);
  if (!eventId) return json(400, { ok: false, message: "invalid_security_event_id" });
  if (!new Set(["open", "resolved", "ignored"]).has(normalizeText(input.data?.status))) {
    return json(400, { ok: false, message: "invalid_security_event_status" });
  }
  const now = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE attendance_security_events
    SET status = ?,
        resolved_by_uid = CASE WHEN ? = 'open' THEN NULL ELSE ? END,
        resolved_at = CASE WHEN ? = 'open' THEN NULL ELSE ? END,
        updated_at = ?
    WHERE id = ?
  `).bind(status, status, requester.uid, status, now, now, eventId).run();
  if (!Number(result.meta?.changes || 0)) {
    return json(404, { ok: false, message: "attendance_security_event_not_found" });
  }
  return json(200, { ok: true, id: eventId, status });
}

async function listAttendanceRecords(url, db, directoryDb) {
  const parsed = parseAttendanceRecordsQuery(url.searchParams);
  if (!parsed.ok) return parsed.response;

  const { filters, bindings, limit, offset, cursor } = parsed.value;
  const cursorFilters = [...filters];
  const cursorBindings = [...bindings];
  if (cursor) {
    cursorFilters.push("(server_time < ? OR (server_time = ? AND id < ?))");
    cursorBindings.push(cursor.serverTime, cursor.serverTime, cursor.id);
  }

  const whereSql = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const cursorWhereSql = cursorFilters.length
    ? `WHERE ${cursorFilters.join(" AND ")}`
    : "";
  const paginationSql = cursor ? "" : "OFFSET ?";
  const recordsBindings = cursor
    ? [...cursorBindings, limit + 1]
    : [...cursorBindings, limit + 1, offset];
  const today = getRiyadhDayBounds();

  try {
    const results = await db.batch([
      db
        .prepare(
          `
          SELECT
            id, employee_uid, employee_doc_id, type, server_time, client_time,
            location_lat, location_lng, location_accuracy,
            zone_id, zone_name, zone_type, allowed_zone_ids, distance_meters,
            result, rejection_reason, accuracy_accepted, device_info,
            created_by_email, created_by_role
          FROM attendance_records
          ${cursorWhereSql}
          ORDER BY server_time DESC, id DESC
          LIMIT ? ${paginationSql}
        `
        )
        .bind(...recordsBindings),
      db
        .prepare(`SELECT COUNT(*) AS total FROM attendance_records ${whereSql}`)
        .bind(...bindings),
      db
        .prepare(
          `
          SELECT
            SUM(CASE WHEN type = 'check_in' THEN 1 ELSE 0 END) AS check_ins,
            SUM(CASE WHEN type = 'check_out' THEN 1 ELSE 0 END) AS check_outs,
            SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END) AS rejected,
            AVG(CASE WHEN location_accuracy > 0 THEN location_accuracy ELSE NULL END) AS average_accuracy
          FROM attendance_records
          WHERE server_time >= ? AND server_time < ?
        `
        )
        .bind(today.start, today.end),
      db
        .prepare(
          `
          SELECT COUNT(*) AS new_devices
          FROM (
            SELECT
              trim(json_extract(device_info, '$.deviceId')) AS device_id,
              MIN(
                COALESCE(
                  NULLIF(trim(json_extract(device_info, '$.firstSeenAt')), ''),
                  server_time
                )
              ) AS first_seen_at
            FROM attendance_records
            WHERE length(trim(coalesce(json_extract(device_info, '$.deviceId'), ''))) > 0
            GROUP BY trim(json_extract(device_info, '$.deviceId'))
            HAVING first_seen_at >= ? AND first_seen_at < ?
          )
        `
        )
        .bind(today.start, today.end),
    ]);

    const rawRows = results[0]?.results || [];
    const hasMore = rawRows.length > limit;
    const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
    const employeeNames = await loadAttendanceEmployeeNames(
      directoryDb,
      pageRows.map(row => row.employee_uid)
    );
    const sharedDeviceUsage = await loadSharedDeviceUsage(
      db,
      directoryDb,
      pageRows.map(row => safeJsonObject(row.device_info)?.deviceId)
    );
    const lastRow = pageRows[pageRows.length - 1] || null;
    const summary = results[2]?.results?.[0] || {};
    const deviceSummary = results[3]?.results?.[0] || {};

    return json(200, {
      ok: true,
      records: pageRows.map(row =>
        mapAttendanceRecordRow(
          row,
          employeeNames.get(row.employee_uid),
          sharedDeviceUsage.get(normalizeText(safeJsonObject(row.device_info)?.deviceId))
        )
      ),
      total: Number(results[1]?.results?.[0]?.total || 0),
      page: parsed.value.page,
      limit,
      nextCursor:
        hasMore && lastRow
          ? encodeAttendanceCursor(lastRow.server_time, lastRow.id)
          : null,
      summary: {
        checkIns: Number(summary.check_ins || 0),
        checkOuts: Number(summary.check_outs || 0),
        rejected: Number(summary.rejected || 0),
        newDevices: Number(deviceSummary.new_devices || 0),
        averageAccuracy:
          summary.average_accuracy == null
            ? null
            : Number(summary.average_accuracy),
        date: today.date,
      },
    });
  } catch (error) {
    return serverError("attendance_records_query_failed", error);
  }
}

async function loadSharedDeviceUsage(db, directoryDb, rawDeviceIds) {
  const deviceIds = Array.from(
    new Set((rawDeviceIds || []).map(normalizeText).filter(Boolean))
  );
  const usage = new Map();
  if (!deviceIds.length) return usage;

  const placeholders = deviceIds.map(() => "?").join(",");

  try {
    const result = await db
      .prepare(
        `
        SELECT
          trim(json_extract(device_info, '$.deviceId')) AS device_id,
          employee_uid,
          MAX(server_time) AS last_seen_at,
          MIN(server_time) AS first_seen_at,
          COUNT(*) AS records_count
        FROM attendance_records
        WHERE trim(json_extract(device_info, '$.deviceId')) IN (${placeholders})
          AND length(trim(coalesce(employee_uid, ''))) > 0
        GROUP BY trim(json_extract(device_info, '$.deviceId')), employee_uid
        ORDER BY device_id ASC, last_seen_at DESC
      `
      )
      .bind(...deviceIds)
      .all();

    const rows = result.results || [];
    const employeeNames = await loadAttendanceEmployeeNames(
      directoryDb,
      rows.map(row => row.employee_uid)
    );

    for (const row of rows) {
      const deviceId = normalizeText(row.device_id);
      const employeeUid = normalizeText(row.employee_uid);
      if (!deviceId || !employeeUid) continue;

      const current =
        usage.get(deviceId) || {
          employeeCount: 0,
          employees: [],
        };
      current.employees.push({
        uid: employeeUid,
        name: employeeNames.get(employeeUid) || null,
        firstSeenAt: row.first_seen_at || null,
        lastSeenAt: row.last_seen_at || null,
        recordsCount: Number(row.records_count || 0),
      });
      current.employeeCount = current.employees.length;
      usage.set(deviceId, current);
    }

    for (const [deviceId, current] of usage.entries()) {
      if (current.employeeCount <= 1) {
        usage.delete(deviceId);
      }
    }
  } catch (error) {
    console.warn("[attendance] shared device usage lookup failed", error);
  }

  return usage;
}

async function generateAttendanceMonthlySummaryRequest(request, db) {
  const input = await readJsonBody(request);
  if (!input.ok) return input.response;

  const employeeUid = normalizeText(input.data?.employeeUid);
  const yearMonth = normalizeText(input.data?.yearMonth);
  if (!employeeUid) {
    return json(400, { ok: false, message: "invalid_employee" });
  }
  if (!isValidYearMonth(yearMonth)) {
    return json(400, { ok: false, message: "invalid_year_month" });
  }

  try {
    const summary = await generateAttendanceMonthlySummary(
      db,
      employeeUid,
      yearMonth
    );
    return json(200, { ok: true, summary });
  } catch (error) {
    return serverError("attendance_monthly_summary_generate_failed", error);
  }
}

async function listAttendanceMonthlySummaries(url, db) {
  const employeeUid = normalizeText(url.searchParams.get("employeeUid"));
  const fromMonth = normalizeText(url.searchParams.get("fromMonth"));
  const toMonth = normalizeText(url.searchParams.get("toMonth"));
  if (!employeeUid) {
    return json(400, { ok: false, message: "invalid_employee" });
  }
  if (fromMonth && !isValidYearMonth(fromMonth)) {
    return json(400, { ok: false, message: "invalid_from_month" });
  }
  if (toMonth && !isValidYearMonth(toMonth)) {
    return json(400, { ok: false, message: "invalid_to_month" });
  }

  const filters = ["employee_uid = ?"];
  const bindings = [employeeUid];
  if (fromMonth) {
    filters.push("year_month >= ?");
    bindings.push(fromMonth);
  }
  if (toMonth) {
    filters.push("year_month <= ?");
    bindings.push(toMonth);
  }

  try {
    const result = await db
      .prepare(
        `
          SELECT
            id, employee_uid, employee_doc_id, year_month,
            present_days, check_in_count, check_out_count, rejected_count,
            worked_minutes, late_minutes, early_leave_minutes,
            overtime_minutes, shortage_minutes, device_ids_json,
            zone_ids_json, first_check_in, last_check_out,
            source_records_count, generated_at, updated_at
          FROM attendance_monthly_summaries
          WHERE ${filters.join(" AND ")}
          ORDER BY year_month DESC
        `
      )
      .bind(...bindings)
      .all();

    return json(200, {
      ok: true,
      summaries: (result.results || []).map(mapAttendanceMonthlySummaryRow),
    });
  } catch (error) {
    return serverError("attendance_monthly_summaries_query_failed", error);
  }
}

export async function generateAttendanceMonthlySummary(db, employeeUid, yearMonth) {
  const uid = normalizeText(employeeUid);
  const month = normalizeText(yearMonth);
  const bounds = parseRiyadhMonthBoundary(month);
  if (!uid || !bounds) {
    throw new Error("invalid_attendance_monthly_summary_input");
  }

  const result = await db
    .prepare(
      `
        SELECT
          id, employee_uid, employee_doc_id, type, result, server_time,
          device_info, zone_id
        FROM attendance_records
        WHERE employee_uid = ? AND server_time >= ? AND server_time < ?
        ORDER BY server_time ASC, id ASC
      `
    )
    .bind(uid, bounds.start, bounds.end)
    .all();

  const rows = result.results || [];
  const allowedRows = rows.filter(row => row.result === "allowed");
  const checkInRows = allowedRows.filter(row => row.type === "check_in");
  const checkOutRows = allowedRows.filter(row => row.type === "check_out");
  const presentDays = new Set(
    checkInRows
      .map(row => getRiyadhDateKeyFromIso(row.server_time))
      .filter(Boolean)
  );
  const deviceIds = Array.from(
    new Set(
      rows
        .map(row => normalizeText(safeJsonObject(row.device_info)?.deviceId))
        .filter(Boolean)
    )
  ).sort();
  const zoneIds = Array.from(
    new Set(rows.map(row => normalizeText(row.zone_id)).filter(Boolean))
  ).sort();
  const now = new Date().toISOString();
  const summaryRow = {
    id: buildAttendanceMonthlySummaryId(uid, month),
    employee_uid: uid,
    employee_doc_id:
      normalizeText(rows.find(row => normalizeText(row.employee_doc_id))?.employee_doc_id) ||
      null,
    year_month: month,
    present_days: presentDays.size,
    check_in_count: checkInRows.length,
    check_out_count: checkOutRows.length,
    rejected_count: rows.filter(row => row.result === "rejected").length,
    worked_minutes: 0,
    late_minutes: 0,
    early_leave_minutes: 0,
    overtime_minutes: 0,
    shortage_minutes: 0,
    device_ids_json: JSON.stringify(deviceIds),
    zone_ids_json: JSON.stringify(zoneIds),
    first_check_in: checkInRows[0]?.server_time || null,
    last_check_out: checkOutRows[checkOutRows.length - 1]?.server_time || null,
    source_records_count: rows.length,
    generated_at: now,
    updated_at: now,
  };

  await db
    .prepare(
      `
        INSERT INTO attendance_monthly_summaries (
          id, employee_uid, employee_doc_id, year_month, present_days,
          check_in_count, check_out_count, rejected_count, worked_minutes,
          late_minutes, early_leave_minutes, overtime_minutes,
          shortage_minutes, device_ids_json, zone_ids_json, first_check_in,
          last_check_out, source_records_count, generated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(employee_uid, year_month) DO UPDATE SET
          employee_doc_id = excluded.employee_doc_id,
          present_days = excluded.present_days,
          check_in_count = excluded.check_in_count,
          check_out_count = excluded.check_out_count,
          rejected_count = excluded.rejected_count,
          worked_minutes = excluded.worked_minutes,
          late_minutes = excluded.late_minutes,
          early_leave_minutes = excluded.early_leave_minutes,
          overtime_minutes = excluded.overtime_minutes,
          shortage_minutes = excluded.shortage_minutes,
          device_ids_json = excluded.device_ids_json,
          zone_ids_json = excluded.zone_ids_json,
          first_check_in = excluded.first_check_in,
          last_check_out = excluded.last_check_out,
          source_records_count = excluded.source_records_count,
          generated_at = excluded.generated_at,
          updated_at = excluded.updated_at
      `
    )
    .bind(
      summaryRow.id,
      summaryRow.employee_uid,
      summaryRow.employee_doc_id,
      summaryRow.year_month,
      summaryRow.present_days,
      summaryRow.check_in_count,
      summaryRow.check_out_count,
      summaryRow.rejected_count,
      summaryRow.worked_minutes,
      summaryRow.late_minutes,
      summaryRow.early_leave_minutes,
      summaryRow.overtime_minutes,
      summaryRow.shortage_minutes,
      summaryRow.device_ids_json,
      summaryRow.zone_ids_json,
      summaryRow.first_check_in,
      summaryRow.last_check_out,
      summaryRow.source_records_count,
      summaryRow.generated_at,
      summaryRow.updated_at
    )
    .run();

  return mapAttendanceMonthlySummaryRow(summaryRow);
}

function mapAttendanceMonthlySummaryRow(row) {
  return {
    id: row.id,
    employeeUid: row.employee_uid,
    employeeDocId: row.employee_doc_id || null,
    yearMonth: row.year_month,
    presentDays: Number(row.present_days || 0),
    checkInCount: Number(row.check_in_count || 0),
    checkOutCount: Number(row.check_out_count || 0),
    rejectedCount: Number(row.rejected_count || 0),
    workedMinutes: Number(row.worked_minutes || 0),
    lateMinutes: Number(row.late_minutes || 0),
    earlyLeaveMinutes: Number(row.early_leave_minutes || 0),
    overtimeMinutes: Number(row.overtime_minutes || 0),
    shortageMinutes: Number(row.shortage_minutes || 0),
    deviceIds: safeJsonArray(row.device_ids_json),
    zoneIds: safeJsonArray(row.zone_ids_json),
    firstCheckIn: row.first_check_in || null,
    lastCheckOut: row.last_check_out || null,
    sourceRecordsCount: Number(row.source_records_count || 0),
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  };
}

export function parseAttendanceRecordsQuery(searchParams) {
  const filters = [];
  const bindings = [];
  const employeeUid = normalizeText(searchParams.get("employeeUid"));
  const result = normalizeText(searchParams.get("result"));
  const type = normalizeText(searchParams.get("type"));
  const deviceChanged = normalizeText(searchParams.get("deviceChanged"));
  const fromDate = normalizeText(searchParams.get("fromDate"));
  const toDate = normalizeText(searchParams.get("toDate"));

  if (employeeUid) {
    filters.push("employee_uid = ?");
    bindings.push(employeeUid);
  }
  if (result) {
    if (!ATTENDANCE_RESULTS.has(result)) return invalidRecordsQuery("result");
    filters.push("result = ?");
    bindings.push(result);
  }
  if (type) {
    if (!ATTENDANCE_TYPES.has(type)) return invalidRecordsQuery("type");
    filters.push("type = ?");
    bindings.push(type);
  }
  if (deviceChanged) {
    if (!new Set(["true", "false"]).has(deviceChanged)) {
      return invalidRecordsQuery("deviceChanged");
    }
    filters.push("json_extract(device_info, '$.deviceChanged') = ?");
    bindings.push(deviceChanged === "true" ? 1 : 0);
  }

  if (fromDate) {
    const boundary = parseRiyadhDateBoundary(fromDate, false);
    if (!boundary) return invalidRecordsQuery("fromDate");
    filters.push("server_time >= ?");
    bindings.push(boundary);
  }
  if (toDate) {
    const boundary = parseRiyadhDateBoundary(toDate, true);
    if (!boundary) return invalidRecordsQuery("toDate");
    filters.push("server_time < ?");
    bindings.push(boundary);
  }

  const rawLimit = Number(searchParams.get("limit"));
  const limit =
    Number.isInteger(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, ATTENDANCE_RECORDS_MAX_LIMIT)
      : ATTENDANCE_RECORDS_DEFAULT_LIMIT;
  const rawPage = Number(searchParams.get("page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const cursorValue = normalizeText(searchParams.get("cursor"));
  const cursor = cursorValue ? decodeAttendanceCursor(cursorValue) : null;
  if (cursorValue && !cursor) return invalidRecordsQuery("cursor");

  return {
    ok: true,
    value: {
      filters,
      bindings,
      limit,
      page,
      offset: Math.min((page - 1) * limit, 100000),
      cursor,
    },
  };
}

function invalidRecordsQuery(field) {
  return {
    ok: false,
    response: json(400, {
      ok: false,
      message: "invalid_attendance_records_query",
      field,
    }),
  };
}

function isValidYearMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(normalizeText(value))) return false;
  return Boolean(parseRiyadhMonthBoundary(value));
}

function parseRiyadhMonthBoundary(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(normalizeText(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;

  return {
    start: new Date(Date.UTC(year, month - 1, 1) - 3 * 60 * 60 * 1000).toISOString(),
    end: new Date(Date.UTC(year, month, 1) - 3 * 60 * 60 * 1000).toISOString(),
  };
}

function buildAttendanceMonthlySummaryId(employeeUid, yearMonth) {
  return `attendance-summary:${employeeUid}:${yearMonth}`;
}

function getRiyadhDateKeyFromIso(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function parseRiyadhDateBoundary(value, nextDay) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const localUtc = Date.UTC(year, month - 1, day + (nextDay ? 1 : 0));
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return new Date(localUtc - 3 * 60 * 60 * 1000).toISOString();
}

function getRiyadhDayBounds() {
  const shifted = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const date = [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
  return {
    date,
    start: parseRiyadhDateBoundary(date, false),
    end: parseRiyadhDateBoundary(date, true),
  };
}

function encodeAttendanceCursor(serverTime, id) {
  return btoa(JSON.stringify({ serverTime, id }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeAttendanceCursor(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = JSON.parse(atob(normalized + padding));
    const serverTime = normalizeText(decoded?.serverTime);
    const id = normalizeText(decoded?.id);
    if (!serverTime || !id || !Number.isFinite(Date.parse(serverTime))) {
      return null;
    }
    return { serverTime, id };
  } catch {
    return null;
  }
}

async function loadAttendanceEmployeeNames(directoryDb, employeeUids) {
  const names = new Map();
  const uniqueUids = Array.from(
    new Set(employeeUids.map(normalizeText).filter(Boolean))
  );
  if (!directoryDb || !uniqueUids.length) return names;
  const placeholders = uniqueUids.map(() => "?").join(", ");
  try {
    const result = await directoryDb
      .prepare(
        `SELECT uid, name FROM employee_directory WHERE uid IN (${placeholders})`
      )
      .bind(...uniqueUids)
      .all();
    for (const row of result.results || []) {
      names.set(row.uid, normalizeText(row.name));
    }
  } catch (error) {
    console.warn("[attendance] employee name lookup failed", error);
  }
  return names;
}

function mapAttendanceRecordRow(row, employeeName, sharedDeviceUsage = null) {
  const deviceInfo = safeJsonObject(row.device_info);
  return {
    id: row.id,
    employeeUid: row.employee_uid,
    employeeDocId: row.employee_doc_id,
    employeeName: employeeName || null,
    type: row.type,
    result: row.result,
    serverTime: row.server_time,
    clientTime: row.client_time || null,
    location: {
      lat: Number(row.location_lat),
      lng: Number(row.location_lng),
      accuracy: Number(row.location_accuracy),
    },
    zoneId: row.zone_id || null,
    zoneName: row.zone_name || null,
    zoneType: row.zone_type || null,
    distanceMeters:
      row.distance_meters == null ? null : Number(row.distance_meters),
    rejectionReason: row.rejection_reason || null,
    accuracyAccepted: Number(row.accuracy_accepted) === 1,
    deviceInfo: {
      ...deviceInfo,
      sharedDevice: sharedDeviceUsage
        ? {
            employeeCount: sharedDeviceUsage.employeeCount,
            employees: sharedDeviceUsage.employees,
          }
        : null,
    },
    createdByEmail: row.created_by_email || null,
    createdByRole: row.created_by_role || null,
  };
}

function parseRiyadhDateTime(value, time) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeText(value));
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(normalizeText(time));
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return new Date(
    Date.UTC(year, month - 1, day, hours - 3, minutes, 0, 0)
  ).toISOString();
}

async function adjustAttendanceRecords(request, db, requester) {
  const input = await readJsonBody(request);
  if (!input.ok) return input.response;

  const employeeUid = normalizeText(input.data?.employeeUid);
  const employeeDocId = normalizeText(input.data?.employeeDocId) || employeeUid;
  const date = normalizeText(input.data?.date);
  const checkInTime = normalizeText(input.data?.checkInTime);
  const checkOutTime = normalizeText(input.data?.checkOutTime);
  const clearRequested =
    input.data?.clear === true || normalizeText(input.data?.action) === "clear";
  const clearRecordIds = normalizeTextList(input.data?.recordIds);
  const clearServerTimes = normalizeTextList(input.data?.serverTimes);
  const note = clampText(input.data?.note, 500);

  if (!employeeUid || !employeeDocId) {
    return json(400, { ok: false, message: "invalid_employee" });
  }
  if (!parseRiyadhDateBoundary(date, false)) {
    return json(400, { ok: false, message: "invalid_attendance_date" });
  }

  if (clearRequested) {
    if (!hasRuntimePermission(requester.runtime, "attendance.records.delete")) {
      return forbidden("attendance.records.delete");
    }

    return clearAttendanceRecordsForDay({
      db,
      requester,
      employeeUid,
      date,
      recordIds: clearRecordIds,
      serverTimes: clearServerTimes,
      note,
    });
  }

  if (!checkInTime && !checkOutTime) {
    return json(400, { ok: false, message: "missing_attendance_time" });
  }

  const requested = [];
  if (checkInTime) requested.push(["check_in", checkInTime]);
  if (checkOutTime) requested.push(["check_out", checkOutTime]);

  const dayStart = parseRiyadhDateBoundary(date, false);
  const dayEnd = parseRiyadhDateBoundary(date, true);
  const operations = [];

  try {
    for (const [type, time] of requested) {
      const serverTime = parseRiyadhDateTime(date, time);
      if (!serverTime) {
        return json(400, { ok: false, message: "invalid_attendance_time" });
      }

      const existing = await db
        .prepare(
          `
          SELECT id
          FROM attendance_records
          WHERE employee_uid = ? AND type = ? AND result = 'allowed'
            AND server_time >= ? AND server_time < ?
          ORDER BY server_time ${type === "check_in" ? "ASC" : "DESC"}, id ASC
          LIMIT 1
        `
        )
        .bind(employeeUid, type, dayStart, dayEnd)
        .first();

      const action = existing?.id ? "update" : "create";
      const requiredPermission =
        action === "update"
          ? "attendance.records.update"
          : "attendance.records.create";

      if (!hasRuntimePermission(requester.runtime, requiredPermission)) {
        return forbidden(requiredPermission);
      }

      operations.push({
        type,
        serverTime,
        action,
        existingId: existing?.id || null,
      });
    }

    const source = JSON.stringify({
      area: "hr",
      page: "hr_employees",
      route: "worker.attendance.admin-adjustment",
      method: "manual_correction",
      note: note || null,
      adjustedByUid: requester.uid,
      adjustedByEmail: requester.email || null,
      adjustedAt: new Date().toISOString(),
    });
    const now = new Date().toISOString();
    const changed = [];

    for (const operation of operations) {
      if (operation.action === "update") {
        await db
          .prepare(
            `
            UPDATE attendance_records
            SET server_time = ?, client_time = ?, source = ?,
                updated_at = ?, created_by_uid = ?, created_by_email = ?,
                created_by_role = ?
            WHERE id = ?
          `
          )
          .bind(
            operation.serverTime,
            operation.serverTime,
            source,
            now,
            requester.uid,
            requester.email || null,
            normalizeText(requester.runtime?.role) || "hr",
            operation.existingId
          )
          .run();

        changed.push({
          id: operation.existingId,
          type: operation.type,
          action: "updated",
          serverTime: operation.serverTime,
        });
        continue;
      }

      const id = crypto.randomUUID();
      await db
        .prepare(
          `
          INSERT INTO attendance_records (
            id, employee_uid, employee_doc_id, type, server_time, client_time,
            location_lat, location_lng, location_accuracy, zone_id, zone_name,
            zone_type, allowed_zone_ids, distance_meters, result,
            rejection_reason, accuracy_accepted, device_info, source,
            created_by_uid, created_by_email, created_by_role, created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, NULL, '[]',
            NULL, 'allowed', NULL, 1, ?, ?, ?, ?, ?, ?, ?)
        `
        )
        .bind(
          id,
          employeeUid,
          employeeDocId,
          operation.type,
          operation.serverTime,
          operation.serverTime,
          JSON.stringify({ adminAdjusted: true }),
          source,
          requester.uid,
          requester.email || null,
          normalizeText(requester.runtime?.role) || "hr",
          now,
          now
        )
        .run();

      changed.push({
        id,
        type: operation.type,
        action: "created",
        serverTime: operation.serverTime,
      });
    }

    await rebuildAttendanceState(db, employeeUid);
    return json(200, { ok: true, records: changed });
  } catch (error) {
    return serverError("attendance_admin_adjustment_failed", error);
  }
}

export async function clearAttendanceRecordsForDay({
  db,
  requester,
  employeeUid,
  date,
  recordIds = [],
  serverTimes = [],
  note,
}) {
  const dayStart = parseRiyadhDateBoundary(date, false);
  const dayEnd = parseRiyadhDateBoundary(date, true);
  const source = JSON.stringify({
    area: "hr",
    page: "hr_employees",
    route: "worker.attendance.admin-adjustment",
    method: "clear_attendance_day",
    note: note || null,
    clearedByUid: requester.uid,
    clearedByEmail: requester.email || null,
    clearedAt: new Date().toISOString(),
  });

  try {
    const normalizedRecordIds = normalizeTextList(recordIds);
    const normalizedServerTimes = normalizeTextList(serverTimes);
    let idsToClear = normalizedRecordIds;

    if (!idsToClear.length && normalizedServerTimes.length) {
      const placeholders = normalizedServerTimes.map(() => "?").join(", ");
      const result = await db
        .prepare(
          `
            SELECT id
            FROM attendance_records
            WHERE employee_uid = ? AND server_time IN (${placeholders})
          `
        )
        .bind(employeeUid, ...normalizedServerTimes)
        .all();
      idsToClear = (result.results || [])
        .map(row => normalizeText(row.id))
        .filter(Boolean);
    }

    if (!idsToClear.length && !normalizedServerTimes.length) {
      const result = await db
        .prepare(
          `
            SELECT id
            FROM attendance_records
            WHERE employee_uid = ? AND server_time >= ? AND server_time < ?
          `
        )
        .bind(employeeUid, dayStart, dayEnd)
        .all();
      idsToClear = (result.results || [])
        .map(row => normalizeText(row.id))
        .filter(Boolean);
    }

    if (!idsToClear.length) {
      return json(200, {
        ok: true,
        action: "clear",
        date,
        clearedRecords: 0,
        source: safeJsonObject(source),
      });
    }

    const idPlaceholders = idsToClear.map(() => "?").join(", ");
    await db
      .prepare(
        `
          UPDATE attendance_state
          SET last_record_id = NULL,
              last_type = NULL,
              last_server_time = NULL,
              last_location_lat = NULL,
              last_location_lng = NULL,
              last_location_accuracy = NULL,
              last_zone_id = NULL,
              status = 'checked_out',
              updated_at = ?
          WHERE employee_uid = ? AND last_record_id IN (${idPlaceholders})
        `
      )
      .bind(new Date().toISOString(), employeeUid, ...idsToClear)
      .run();

    const result = await db
      .prepare(
        `
          DELETE FROM attendance_records
          WHERE employee_uid = ? AND id IN (${idPlaceholders})
        `
      )
      .bind(employeeUid, ...idsToClear)
      .run();

    return json(200, {
      ok: true,
      action: "clear",
      date,
      clearedRecords: Number(result.meta?.changes || 0),
      source: safeJsonObject(source),
    });
  } catch (error) {
    return serverError("attendance_admin_clear_failed", error);
  }
}

function normalizeTextList(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(item => normalizeText(item)).filter(Boolean))
  );
}

function safeJsonObject(value) {
  try {
    const parsed = JSON.parse(normalizeText(value) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(normalizeText(value) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function createWorkZone(request, db, requester) {
  const input = await readJsonBody(request);
  if (!input.ok) return input.response;
  const zone = normalizeWorkZoneInput(input.data);
  if (!zone.ok) return zone.response;

  const id = normalizeWorkZoneId(input.data?.id) || crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    const existing = await db
      .prepare("SELECT id FROM work_zones WHERE id = ?")
      .bind(id)
      .first();

    await db
      .prepare(
        `
      INSERT INTO work_zones (
        id, name, type, center_lat, center_lng, radius_meters, active, office_ip,
        created_by_uid, created_at, updated_by_uid, updated_at
      ) VALUES (?, ?, 'radius', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = 'radius',
        center_lat = excluded.center_lat,
        center_lng = excluded.center_lng,
        radius_meters = excluded.radius_meters,
        active = excluded.active,
        office_ip = excluded.office_ip,
        updated_by_uid = excluded.updated_by_uid,
        updated_at = excluded.updated_at
    `
      )
      .bind(
        id,
        zone.value.name,
        zone.value.center.lat,
        zone.value.center.lng,
        zone.value.radiusMeters,
        zone.value.active ? 1 : 0,
        zone.value.officeIp,
        requester.uid,
        now,
        requester.uid,
        now
      )
      .run();
    return json(existing ? 200 : 201, {
      ok: true,
      zone: { id, ...zone.value, createdAt: now, updatedAt: now },
    });
  } catch (error) {
    return serverError("work_zone_create_failed", error);
  }
}

async function updateWorkZone(request, db, requester, id) {
  if (!id) return json(400, { ok: false, message: "invalid_work_zone_id" });
  const input = await readJsonBody(request);
  if (!input.ok) return input.response;
  const zone = normalizeWorkZoneInput(input.data);
  if (!zone.ok) return zone.response;

  const now = new Date().toISOString();
  try {
    const result = await db
      .prepare(
        `
      UPDATE work_zones
      SET name = ?, type = 'radius', center_lat = ?, center_lng = ?,
          radius_meters = ?, active = ?, office_ip = ?, updated_by_uid = ?,
          updated_at = ?
      WHERE id = ?
    `
      )
      .bind(
        zone.value.name,
        zone.value.center.lat,
        zone.value.center.lng,
        zone.value.radiusMeters,
        zone.value.active ? 1 : 0,
        zone.value.officeIp,
        requester.uid,
        now,
        id
      )
      .run();
    if (!result.meta?.changes)
      return json(404, { ok: false, message: "work_zone_not_found" });
    return json(200, { ok: true, zone: { id, ...zone.value, updatedAt: now } });
  } catch (error) {
    return serverError("work_zone_update_failed", error);
  }
}

async function deleteWorkZone(db, id) {
  if (!id) return json(400, { ok: false, message: "invalid_work_zone_id" });
  try {
    const result = await db
      .prepare("DELETE FROM work_zones WHERE id = ?")
      .bind(id)
      .run();
    if (!result.meta?.changes)
      return json(404, { ok: false, message: "work_zone_not_found" });
    return json(200, { ok: true, id });
  } catch (error) {
    return serverError("work_zone_delete_failed", error);
  }
}

function uniqueTextValues(values) {
  return Array.from(
    new Set((values || []).map(value => normalizeText(value)).filter(Boolean))
  );
}

function employeeRecordUidCandidates(data) {
  return uniqueTextValues([
    data?.linkedUid,
    data?.uid,
    data?.linkedUserId,
    data?.employeeUid,
  ]);
}

function employeeRecordEmailCandidates(data) {
  return uniqueTextValues([data?.email, data?.userEmail]).map(value =>
    value.toLowerCase()
  );
}

function attendanceRecordHasZone(data) {
  return pickAllowedZoneIds(data || {}, {}).length > 0;
}

function mergeAttendanceEmployeeData(...sources) {
  const output = {};

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    for (const [key, value] of Object.entries(source)) {
      if (value === undefined || value === null) continue;

      if (Array.isArray(value)) {
        if (value.length || !Array.isArray(output[key])) {
          output[key] = value;
        }
        continue;
      }

      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof Date)
      ) {
        output[key] = mergeAttendanceEmployeeData(
          output[key],
          value
        );
        continue;
      }

      const isEmptyString =
        typeof value === "string" && !normalizeText(value);

      if (!isEmptyString || output[key] === undefined) {
        output[key] = value;
      }
    }
  }

  return output;
}

async function fetchAttendanceEmployeeRecord({
  requester,
  fetchFirestoreDocument,
  collectionName,
  id,
}) {
  const cleanId = normalizeText(id);
  if (!cleanId || typeof fetchFirestoreDocument !== "function") return null;

  const result = await fetchFirestoreDocument({
    projectId: requester.projectId,
    idToken: requester.idToken,
    documentPath: `${collectionName}/${cleanId}`,
  });

  if (!result?.ok || !result.found) return null;

  const documentId = normalizeText(result.data?.documentId || cleanId);
  return {
    id: documentId,
    source: collectionName,
    data: {
      documentId,
      id: documentId,
      ...(result.data?.data || {}),
    },
  };
}

async function queryAttendanceEmployeeRecords({
  requester,
  queryFirestoreDocuments,
  collectionName,
  fieldPath,
  value,
}) {
  const cleanValue = normalizeText(value);
  if (!cleanValue || typeof queryFirestoreDocuments !== "function") return [];

  const result = await queryFirestoreDocuments({
    projectId: requester.projectId,
    idToken: requester.idToken,
    collectionPath: collectionName,
    filters: [{ fieldPath, op: "EQUAL", value: cleanValue }],
    limit: 5,
  });

  if (!result?.ok || !Array.isArray(result.documents)) return [];

  return result.documents.map(document => {
    const documentId = normalizeText(document?.documentId);
    return {
      id: documentId,
      source: collectionName,
      data: {
        documentId,
        id: documentId,
        ...(document?.data || {}),
      },
    };
  }).filter(record => record.id);
}

function employeeRecordBelongsToRequester(
  record,
  requester,
  linkedEmployeeId,
  trustedEmailIds
) {
  const uid = normalizeText(requester.uid);
  const email = normalizeText(requester.email).toLowerCase();
  const recordUids = employeeRecordUidCandidates(record?.data);

  if (record?.id && record.id === uid) return true;
  if (linkedEmployeeId && record?.id === linkedEmployeeId) return true;
  if (recordUids.includes(uid)) return true;

  if (recordUids.length && !recordUids.includes(uid)) {
    return false;
  }

  return Boolean(
    email &&
      trustedEmailIds?.has(record?.id) &&
      employeeRecordEmailCandidates(record?.data).includes(email)
  );
}

function attendanceEmployeeRecordScore(record, preferredIds) {
  let score = 0;
  if (preferredIds.has(record.id)) score += 100;
  if (employeeRecordUidCandidates(record.data).length) score += 60;
  if (attendanceRecordHasZone(record.data)) score += 20;
  if (record.source === "employees") score += 10;
  return score;
}

async function resolveAttendanceEmployee({
  requester,
  requestedEmployeeId,
  fetchFirestoreDocument,
  queryFirestoreDocuments,
}) {
  const userData = requester.userData || {};
  const linkedEmployeeId = normalizeText(
    userData.linkedEmployeeId ||
      userData.linkedEmployeeDocId ||
      userData.employeeId
  );
  const explicitIds = uniqueTextValues([
    requestedEmployeeId,
    linkedEmployeeId,
    userData.employeeId,
    userData.linkedEmployeeDocId,
  ]).filter(id => id !== requester.uid);
  const lookupIds = uniqueTextValues([
    ...explicitIds,
    requester.uid,
  ]);

  const directRecords = await Promise.all(
    lookupIds.flatMap(id => [
      fetchAttendanceEmployeeRecord({
        requester,
        fetchFirestoreDocument,
        collectionName: "employees",
        id,
      }),
      fetchAttendanceEmployeeRecord({
        requester,
        fetchFirestoreDocument,
        collectionName: "staff_public",
        id,
      }),
    ])
  );

  const uidQueries = await Promise.all([
    queryAttendanceEmployeeRecords({
      requester,
      queryFirestoreDocuments,
      collectionName: "employees",
      fieldPath: "linkedUid",
      value: requester.uid,
    }),
    queryAttendanceEmployeeRecords({
      requester,
      queryFirestoreDocuments,
      collectionName: "employees",
      fieldPath: "uid",
      value: requester.uid,
    }),
    queryAttendanceEmployeeRecords({
      requester,
      queryFirestoreDocuments,
      collectionName: "employees",
      fieldPath: "linkedUserId",
      value: requester.uid,
    }),
    queryAttendanceEmployeeRecords({
      requester,
      queryFirestoreDocuments,
      collectionName: "staff_public",
      fieldPath: "linkedUid",
      value: requester.uid,
    }),
    queryAttendanceEmployeeRecords({
      requester,
      queryFirestoreDocuments,
      collectionName: "staff_public",
      fieldPath: "uid",
      value: requester.uid,
    }),
    queryAttendanceEmployeeRecords({
      requester,
      queryFirestoreDocuments,
      collectionName: "staff_public",
      fieldPath: "linkedUserId",
      value: requester.uid,
    }),
  ]);

  const email = normalizeText(requester.email).toLowerCase();
  const emailQueries = email
    ? await Promise.all([
        queryAttendanceEmployeeRecords({
          requester,
          queryFirestoreDocuments,
          collectionName: "staff_public",
          fieldPath: "email",
          value: email,
        }),
        queryAttendanceEmployeeRecords({
          requester,
          queryFirestoreDocuments,
          collectionName: "staff_public",
          fieldPath: "userEmail",
          value: email,
        }),
      ])
    : [];

  const byKey = new Map();
  for (const record of [
    ...directRecords.filter(Boolean),
    ...uidQueries.flat(),
    ...emailQueries.flat(),
  ]) {
    byKey.set(`${record.source}:${record.id}`, record);
  }

  const allRecords = Array.from(byKey.values());
  const emailMatchedIds = new Set(
    allRecords
      .filter(record => {
        const recordUids = employeeRecordUidCandidates(record.data);
        return (
          email &&
          employeeRecordEmailCandidates(record.data).includes(email) &&
          !recordUids.some(candidate => candidate !== requester.uid)
        );
      })
      .map(record => record.id)
  );
  const trustedEmailIds =
    emailMatchedIds.size === 1 ? emailMatchedIds : new Set();
  const preferredIds = new Set(explicitIds);
  const linkedRecords = allRecords
    .filter(record =>
      employeeRecordBelongsToRequester(
        record,
        requester,
        linkedEmployeeId,
        trustedEmailIds
      )
    )
    .sort(
      (left, right) =>
        attendanceEmployeeRecordScore(right, preferredIds) -
        attendanceEmployeeRecordScore(left, preferredIds)
    );

  const selected = linkedRecords[0] || null;
  const employeeDocId = normalizeText(
    selected?.id ||
      requestedEmployeeId ||
      linkedEmployeeId ||
      requester.uid
  );

  const [employeeRecord, staffRecord] = await Promise.all([
    fetchAttendanceEmployeeRecord({
      requester,
      fetchFirestoreDocument,
      collectionName: "employees",
      id: employeeDocId,
    }),
    fetchAttendanceEmployeeRecord({
      requester,
      fetchFirestoreDocument,
      collectionName: "staff_public",
      id: employeeDocId,
    }),
  ]);

  const employeeData = mergeAttendanceEmployeeData(
    staffRecord?.data,
    employeeRecord?.data,
    selected?.data
  );

  return {
    linkedEmployeeId,
    employeeDocId,
    employeeData,
    employeeFound: Boolean(
      selected ||
        employeeRecord ||
        staffRecord
    ),
    identityIds: uniqueTextValues([
      requester.uid,
      linkedEmployeeId,
      selected?.id,
      employeeRecord?.id,
      staffRecord?.id,
      employeeData.employeeId,
      employeeData.linkedEmployeeDocId,
      employeeData.linkedUid,
      employeeData.uid,
      employeeData.linkedUserId,
    ]),
  };
}

function requestedEmployeeMatchesResolution(requestedEmployeeId, resolution) {
  const requested = normalizeText(requestedEmployeeId);
  if (!requested) return true;
  return resolution.identityIds.includes(requested);
}

async function recordAttendance({
  request,
  db,
  requester,
  salonId,
  fetchFirestoreDocument,
  queryFirestoreDocuments,
}) {
  const input = await readJsonBody(request);
  if (!input.ok) return input.response;
  const debugRequest = normalizeAttendanceDebug(input.data?.debug);

  const type = normalizeText(input.data?.type);
  const location = normalizeLocation(
    input.data?.location || input.data?.clientLocation
  );
  if (!ATTENDANCE_TYPES.has(type)) {
    return json(400, { ok: false, message: "invalid_attendance_type" });
  }
  if (!location)
    return json(400, { ok: false, message: "invalid_gps_location" });

  const userData = requester.userData || {};
  const requestedEmployeeId = normalizeText(
    input.data?.employeeId || input.data?.employeeDocId
  );
  const requestedAttendanceZoneId = normalizeText(
    input.data?.attendanceZoneId ||
      input.data?.workZoneId ||
      input.data?.zoneId
  );
  const employeeResolution = await resolveAttendanceEmployee({
    requester,
    requestedEmployeeId,
    fetchFirestoreDocument,
    queryFirestoreDocuments,
  });
  const linkedEmployeeId = employeeResolution.linkedEmployeeId;
  const employeeDocId = employeeResolution.employeeDocId;
  const employeeData = employeeResolution.employeeData || {};

  if (
    !requestedEmployeeMatchesResolution(
      requestedEmployeeId,
      employeeResolution
    )
  ) {
    return json(403, { ok: false, message: "attendance_employee_mismatch" });
  }

  if (
    !ATTENDANCE_ALLOWED_ROLES.has(requester.runtime?.role) &&
    !userData.employeeProfileEnabled &&
    !linkedEmployeeId &&
    !requestedEmployeeId
  ) {
    return json(403, { ok: false, message: "attendance_not_enabled" });
  }

  const employeeAllowedZoneIds = pickAllowedZoneIds(employeeData, userData);
  const allowedZoneIds =
    requestedAttendanceZoneId &&
    employeeAllowedZoneIds.includes(requestedAttendanceZoneId)
      ? [requestedAttendanceZoneId]
      : employeeAllowedZoneIds;
  const zoneResolution =
    requestedAttendanceZoneId &&
    employeeAllowedZoneIds.length > 0 &&
    !employeeAllowedZoneIds.includes(requestedAttendanceZoneId)
      ? {
          zones: [],
          error: "attendance_zone_mismatch",
          requestedZoneIds: [requestedAttendanceZoneId],
          resolvedZoneIds: [],
          missingZoneIds: [],
        }
      : await resolveZones(db, allowedZoneIds, {
          fetchFirestoreDocument,
          requester,
          salonId,
        });
  const zoneCheck = evaluateAttendanceZones(location, zoneResolution.zones);
  const clientIp = getRequestClientIp(request);

  const locationDecision = evaluateLocationDecision({
    location,
    zoneError: zoneResolution.error,
    zoneCheck,
    clientIp,
  });
  const attendanceDebug = buildAttendanceDebug({
    debugRequest,
    requester,
    requestedEmployeeId,
    linkedEmployeeId,
    employeeDocId,
    employeeFound: Boolean(employeeResolution.employeeFound),
    allowedZoneIds,
    requestedAttendanceZoneId,
    employeeAllowedZoneIds,
    zoneResolution,
    zoneCheck,
    location,
    locationDecision,
  });
  if (attendanceDebug) {
    console.log("attendance_debug", attendanceDebug);
  }
  const recordId = crypto.randomUUID();
  const now = new Date().toISOString();
  const clientTime = clampText(input.data?.clientTime, 80) || null;
  const deviceInfo = normalizeDeviceInfo(input.data?.deviceInfo);
  const previousDeviceId = await readLastSuccessfulDeviceId(db, requester.uid);
  const deviceContext = await readAttendanceDeviceSecurityContext(
    db,
    deviceInfo.deviceId,
    requester.uid
  );
  const deviceChange = evaluateDeviceChange(
    deviceInfo.deviceId,
    previousDeviceId
  );
  const blockedDevice = deviceContext.trustStatus === "blocked";
  const initialResult = blockedDevice ? "rejected" : locationDecision.result;
  const initialReason = blockedDevice
    ? "blocked_device"
    : locationDecision.rejectionReason;
  const zone = zoneCheck.zone;
  const role = normalizeText(requester.runtime?.role) || "guest";
  const source = buildAttendanceSource({ clientIp, zone });

  try {
    if (initialResult === "rejected") {
      await insertRejectedRecord(db, {
        recordId,
        requester,
        employeeDocId,
        type,
        now,
        clientTime,
        location,
        zone,
        allowedZoneIds,
        distanceMeters: zoneCheck.distanceMeters,
        rejectionReason: initialReason,
        deviceInfo,
        role,
        source,
      });
      await syncAttendanceDeviceSecurity({
        db,
        requester,
        recordId,
        employeeDocId,
        now,
        result: "rejected",
        rejectionReason: initialReason,
        location,
        deviceInfo,
        previousDeviceId,
        deviceContext,
      });
      const currentState = await readAttendanceState(db, requester.uid);
      return attendanceResponse({
        recordId,
        type,
        result: "rejected",
        rejectionReason: initialReason,
        location,
        zone,
        distanceMeters: zoneCheck.distanceMeters,
        previousStatus: currentState?.status || null,
        currentStatus: currentState?.status || null,
        debug: attendanceDebug,
      });
    }

    const stateRequirement = type === "check_in" ? "checked_out" : "checked_in";
    const targetStatus = type === "check_in" ? "checked_in" : "checked_out";
    const stateRejection =
      type === "check_in" ? "duplicate_check_in" : "not_checked_in";
    const currentDay = getRiyadhDayBounds();
    const stateUpdateWhere =
      type === "check_in"
        ? "(status = 'checked_out' OR last_server_time IS NULL OR last_server_time < ? OR last_server_time >= ?)"
        : "(status = 'checked_in' AND last_server_time >= ? AND last_server_time < ?)";
    const results = await db.batch([
      buildRecordInsert(db, {
        recordId,
        requester,
        employeeDocId,
        type,
        now,
        clientTime,
        location,
        zone,
        allowedZoneIds,
        distanceMeters: zoneCheck.distanceMeters,
        result: "rejected",
        rejectionReason: stateRejection,
        deviceInfo,
        role,
        source,
      }),
      db
        .prepare(
          `
        INSERT OR IGNORE INTO attendance_state (
          employee_uid, employee_doc_id, status, updated_at
        ) VALUES (?, ?, 'checked_out', ?)
      `
        )
        .bind(requester.uid, employeeDocId, now),
      db
        .prepare(
          `
        UPDATE attendance_state
        SET employee_doc_id = ?, status = ?, last_type = ?, last_record_id = ?,
            last_server_time = ?, last_location_lat = ?, last_location_lng = ?,
            last_location_accuracy = ?, last_zone_id = ?, updated_at = ?
        WHERE employee_uid = ? AND ${stateUpdateWhere}
      `
        )
        .bind(
          employeeDocId,
          targetStatus,
          type,
          recordId,
          now,
          location.lat,
          location.lng,
          location.accuracy,
          zone?.id || null,
          now,
          requester.uid,
          currentDay.start,
          currentDay.end
        ),
      db
        .prepare(
          `
        UPDATE attendance_records
        SET result = CASE
              WHEN (SELECT last_record_id FROM attendance_state WHERE employee_uid = ?) = ?
                THEN 'allowed' ELSE 'rejected' END,
            rejection_reason = CASE
              WHEN (SELECT last_record_id FROM attendance_state WHERE employee_uid = ?) = ?
                THEN NULL ELSE ? END,
            updated_at = ?
        WHERE id = ?
      `
        )
        .bind(
          requester.uid,
          recordId,
          requester.uid,
          recordId,
          stateRejection,
          now,
          recordId
        ),
      db
        .prepare(
          `
        UPDATE attendance_records
        SET device_info = json_set(
          COALESCE(NULLIF(device_info, ''), '{}'),
          '$.deviceChanged', json(?),
          '$.previousDeviceId', json(?)
        )
        WHERE id = ? AND result = 'allowed'
      `
        )
        .bind(
          deviceChange.deviceChanged ? "true" : "false",
          deviceChange.previousDeviceId
            ? JSON.stringify(deviceChange.previousDeviceId)
            : "null",
          recordId
        ),
      db
        .prepare(
          "SELECT result, rejection_reason FROM attendance_records WHERE id = ?"
        )
        .bind(recordId),
    ]);

    const recordRows = results[5]?.results || [];
    const savedResult =
      recordRows[0]?.result === "allowed" ? "allowed" : "rejected";
    const savedReason = savedResult === "allowed" ? null : stateRejection;
    const previousStatus =
      savedResult === "allowed" ? stateRequirement : targetStatus;
    const currentStatus =
      savedResult === "allowed" ? targetStatus : previousStatus;
    await syncAttendanceDeviceSecurity({
      db,
      requester,
      recordId,
      employeeDocId,
      now,
      result: savedResult,
      rejectionReason: savedReason,
      location,
      deviceInfo,
      previousDeviceId,
      deviceContext,
    });
    return attendanceResponse({
      recordId,
      type,
      result: savedResult,
      rejectionReason: savedReason,
      location,
      zone,
      distanceMeters: zoneCheck.distanceMeters,
      previousStatus,
      currentStatus,
      debug: attendanceDebug,
    });
  } catch (error) {
    return serverError("attendance_record_failed", error);
  }
}

function buildRecordInsert(db, values) {
  return db
    .prepare(
      `
    INSERT INTO attendance_records (
      id, employee_uid, employee_doc_id, type, server_time, client_time,
      location_lat, location_lng, location_accuracy, zone_id, zone_name, zone_type,
      allowed_zone_ids, distance_meters, result, rejection_reason, accuracy_accepted,
      device_info, source, created_by_uid, created_by_email, created_by_role,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
    )
    .bind(
      values.recordId,
      values.requester.uid,
      values.employeeDocId,
      values.type,
      values.now,
      values.clientTime,
      values.location.lat,
      values.location.lng,
      values.location.accuracy,
      values.zone?.id || null,
      values.zone?.name || null,
      values.zone?.type || null,
      JSON.stringify(values.allowedZoneIds),
      values.distanceMeters,
      values.result,
      values.rejectionReason,
      values.location.accuracy <= getAllowedAccuracyMeters(values.zone) ? 1 : 0,
      JSON.stringify(values.deviceInfo),
      values.source ||
        JSON.stringify({
          area: "employee",
          page: "employee_profile",
          route: "worker.attendance.record",
          method: "gps_button",
        }),
      values.requester.uid,
      values.requester.email || null,
      values.role,
      values.now,
      values.now
    );
}

async function insertRejectedRecord(db, values) {
  await buildRecordInsert(db, {
    ...values,
    result: "rejected",
  }).run();
}

async function readAttendanceState(db, uid) {
  return db
    .prepare("SELECT status FROM attendance_state WHERE employee_uid = ?")
    .bind(uid)
    .first();
}

async function rebuildAttendanceState(db, employeeUid) {
  const latest = await db
    .prepare(
      `
      SELECT employee_uid, employee_doc_id, type, id, server_time,
             location_lat, location_lng, location_accuracy, zone_id
      FROM attendance_records
      WHERE employee_uid = ? AND result = 'allowed'
      ORDER BY server_time DESC, id DESC
      LIMIT 1
    `
    )
    .bind(employeeUid)
    .first();

  if (!latest) {
    await db
      .prepare("DELETE FROM attendance_state WHERE employee_uid = ?")
      .bind(employeeUid)
      .run();
    return;
  }

  await db
    .prepare(
      `
      INSERT INTO attendance_state (
        employee_uid, employee_doc_id, status, last_type, last_record_id,
        last_server_time, last_location_lat, last_location_lng,
        last_location_accuracy, last_zone_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(employee_uid) DO UPDATE SET
        employee_doc_id = excluded.employee_doc_id,
        status = excluded.status,
        last_type = excluded.last_type,
        last_record_id = excluded.last_record_id,
        last_server_time = excluded.last_server_time,
        last_location_lat = excluded.last_location_lat,
        last_location_lng = excluded.last_location_lng,
        last_location_accuracy = excluded.last_location_accuracy,
        last_zone_id = excluded.last_zone_id,
        updated_at = excluded.updated_at
    `
    )
    .bind(
      latest.employee_uid,
      latest.employee_doc_id,
      latest.type === "check_in" ? "checked_in" : "checked_out",
      latest.type,
      latest.id,
      latest.server_time,
      latest.location_lat,
      latest.location_lng,
      latest.location_accuracy,
      latest.zone_id || null,
      new Date().toISOString()
    )
    .run();
}


async function readAttendanceDeviceSecurityContext(db, rawDeviceId, employeeUid) {
  const deviceId = normalizeText(rawDeviceId);
  const uid = normalizeText(employeeUid);
  if (!deviceId) {
    return {
      deviceExists: false,
      trustStatus: "new",
      assignmentCount: 0,
      assignedToEmployee: false,
    };
  }

  try {
    const [deviceResult, assignmentResult] = await db.batch([
      db.prepare(`
        SELECT trust_status
        FROM attendance_devices
        WHERE device_id = ?
        LIMIT 1
      `).bind(deviceId),
      db.prepare(`
        SELECT
          COUNT(*) AS assignment_count,
          SUM(CASE WHEN employee_uid = ? THEN 1 ELSE 0 END) AS assigned_to_employee
        FROM attendance_device_assignments
        WHERE device_id = ?
      `).bind(uid, deviceId),
    ]);
    const deviceRow = deviceResult?.results?.[0] || null;
    const assignmentRow = assignmentResult?.results?.[0] || {};
    return {
      deviceExists: Boolean(deviceRow),
      trustStatus: normalizeAttendanceDeviceStatus(deviceRow?.trust_status),
      assignmentCount: Number(assignmentRow.assignment_count || 0),
      assignedToEmployee: Number(assignmentRow.assigned_to_employee || 0) > 0,
    };
  } catch (error) {
    // The endpoint can still record attendance during a staged rollout before
    // migration 0005 is applied. The deployment instructions apply it first.
    console.warn("[attendance] device security context lookup failed", error);
    return {
      deviceExists: false,
      trustStatus: "new",
      assignmentCount: 0,
      assignedToEmployee: false,
    };
  }
}

async function syncAttendanceDeviceSecurity({
  db,
  requester,
  recordId,
  employeeDocId,
  now,
  result,
  rejectionReason,
  location,
  deviceInfo,
  previousDeviceId,
  deviceContext,
}) {
  const deviceId = normalizeText(deviceInfo?.deviceId);
  const classification = classifyAttendanceDeviceSecurity({
    deviceId,
    previousDeviceId,
    trustStatus: deviceContext?.trustStatus,
    assignmentCount: deviceContext?.assignmentCount,
    assignedToEmployee: deviceContext?.assignedToEmployee,
    deviceExists: deviceContext?.deviceExists,
    result,
    rejectionReason,
    accuracy: location?.accuracy,
  });

  try {
    const statements = [];
    if (deviceId) {
      statements.push(
        db.prepare(`
          INSERT INTO attendance_devices (
            device_id, first_seen_at, last_seen_at,
            first_seen_employee_uid, last_seen_employee_uid,
            platform, user_agent, language, time_zone,
            app_variant, app_version, screen_size, standalone,
            total_records, allowed_records, rejected_records,
            trust_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'new', ?, ?)
          ON CONFLICT(device_id) DO UPDATE SET
            last_seen_at = excluded.last_seen_at,
            last_seen_employee_uid = excluded.last_seen_employee_uid,
            platform = COALESCE(excluded.platform, attendance_devices.platform),
            user_agent = COALESCE(excluded.user_agent, attendance_devices.user_agent),
            language = COALESCE(excluded.language, attendance_devices.language),
            time_zone = COALESCE(excluded.time_zone, attendance_devices.time_zone),
            app_variant = COALESCE(excluded.app_variant, attendance_devices.app_variant),
            app_version = COALESCE(excluded.app_version, attendance_devices.app_version),
            screen_size = COALESCE(excluded.screen_size, attendance_devices.screen_size),
            standalone = excluded.standalone,
            total_records = attendance_devices.total_records + 1,
            allowed_records = attendance_devices.allowed_records + excluded.allowed_records,
            rejected_records = attendance_devices.rejected_records + excluded.rejected_records,
            updated_at = excluded.updated_at
        `).bind(
          deviceId,
          now,
          now,
          requester.uid,
          requester.uid,
          deviceInfo.platform || null,
          deviceInfo.userAgent || null,
          deviceInfo.language || null,
          deviceInfo.timeZone || null,
          deviceInfo.appVariant || null,
          deviceInfo.appVersion || null,
          deviceInfo.screenSize || null,
          deviceInfo.standalone ? 1 : 0,
          result === "allowed" ? 1 : 0,
          result === "rejected" ? 1 : 0,
          now,
          now
        )
      );
      statements.push(
        db.prepare(`
          INSERT INTO attendance_device_assignments (
            device_id, employee_uid, employee_doc_id,
            first_seen_at, last_seen_at, records_count,
            allowed_count, rejected_count, is_primary,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
          ON CONFLICT(device_id, employee_uid) DO UPDATE SET
            employee_doc_id = excluded.employee_doc_id,
            last_seen_at = excluded.last_seen_at,
            records_count = attendance_device_assignments.records_count + 1,
            allowed_count = attendance_device_assignments.allowed_count + excluded.allowed_count,
            rejected_count = attendance_device_assignments.rejected_count + excluded.rejected_count,
            is_primary = CASE
              WHEN attendance_device_assignments.is_primary = 1 THEN 1
              ELSE excluded.is_primary
            END,
            updated_at = excluded.updated_at
        `).bind(
          deviceId,
          requester.uid,
          employeeDocId,
          now,
          now,
          result === "allowed" ? 1 : 0,
          result === "rejected" ? 1 : 0,
          previousDeviceId ? 0 : 1,
          now,
          now
        )
      );
    }

    statements.push(
      db.prepare(`
        UPDATE attendance_records
        SET device_info = json_set(
          COALESCE(NULLIF(device_info, ''), '{}'),
          '$.deviceChanged', json(?),
          '$.previousDeviceId', json(?),
          '$.isNewDevice', json(?),
          '$.isNewForEmployee', json(?),
          '$.sharedDevice', json(?),
          '$.trustStatus', ?
        ), updated_at = ?
        WHERE id = ?
      `).bind(
        classification.deviceChanged ? "true" : "false",
        previousDeviceId ? JSON.stringify(previousDeviceId) : "null",
        classification.isNewDevice ? "true" : "false",
        classification.isNewForEmployee ? "true" : "false",
        classification.sharedDevice ? "true" : "false",
        classification.trustStatus,
        now,
        recordId
      )
    );

    const eventSpecs = buildAttendanceSecurityEventSpecs({
      classification,
      recordId,
      employeeUid: requester.uid,
      employeeDocId,
      deviceId: deviceId || null,
      rejectionReason,
      accuracy: location?.accuracy,
      previousDeviceId,
      now,
    });
    for (const event of eventSpecs) {
      statements.push(
        db.prepare(`
          INSERT OR IGNORE INTO attendance_security_events (
            id, event_type, severity, employee_uid, employee_doc_id,
            device_id, record_id, title, detail, metadata_json,
            status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
        `).bind(
          event.id,
          event.eventType,
          event.severity,
          requester.uid,
          employeeDocId,
          deviceId || null,
          recordId,
          event.title,
          event.detail,
          JSON.stringify(event.metadata),
          now,
          now
        )
      );
    }

    if (statements.length) await db.batch(statements);
  } catch (error) {
    // Device telemetry must never erase an already-recorded punch. Log the
    // failure so the monitoring page exposes deployment/migration problems.
    console.warn("[attendance] device security sync failed", error);
  }
}

export function buildAttendanceSecurityEventSpecs(input = {}) {
  const classification = input.classification || {};
  const recordId = normalizeText(input.recordId);
  const previousDeviceId = normalizeText(input.previousDeviceId);
  const rejectionReason = normalizeText(input.rejectionReason);
  const accuracy = Number(input.accuracy);
  const definitions = {
    new_device: {
      severity: "info",
      title: "بصمة من جهاز جديد",
      detail: "تم تسجيل أول استخدام لهذا الجهاز في نظام البصمة.",
    },
    device_changed: {
      severity: "warning",
      title: "تغيير جهاز الموظفة",
      detail: previousDeviceId
        ? `تمت البصمة من جهاز مختلف عن الجهاز السابق (${previousDeviceId}).`
        : "تمت البصمة من جهاز مختلف عن الجهاز السابق.",
    },
    shared_device: {
      severity: "critical",
      title: "جهاز مستخدم لأكثر من موظفة",
      detail: "تم اكتشاف استخدام معرّف الجهاز نفسه في حساب موظفة أخرى.",
    },
    blocked_device_attempt: {
      severity: "critical",
      title: "محاولة بصمة من جهاز محظور",
      detail: "تم رفض العملية لأن الجهاز محظور من إدارة الحضور.",
    },
    rejected_punch: {
      severity: "warning",
      title: "عملية بصمة مرفوضة",
      detail: rejectionReason || "رُفضت عملية البصمة وفق قواعد الحضور.",
    },
    poor_accuracy: {
      severity: "info",
      title: "دقة موقع ضعيفة",
      detail: Number.isFinite(accuracy)
        ? `دقة الموقع المسجلة ${Math.round(accuracy)} متر.`
        : "دقة الموقع أقل من المستوى المقبول.",
    },
  };

  return (classification.eventTypes || [])
    .map(eventType => {
      const definition = definitions[eventType];
      if (!definition || !recordId) return null;
      return {
        id: `${eventType}:${recordId}`,
        eventType,
        severity: definition.severity,
        title: definition.title,
        detail: definition.detail,
        metadata: {
          rejectionReason: rejectionReason || null,
          accuracy: Number.isFinite(accuracy) ? accuracy : null,
          previousDeviceId: previousDeviceId || null,
        },
      };
    })
    .filter(Boolean);
}

async function readLastSuccessfulDeviceId(db, employeeUid) {
  const row = await db
    .prepare(
      `
      SELECT json_extract(device_info, '$.deviceId') AS device_id
      FROM attendance_records
      WHERE employee_uid = ?
        AND result = 'allowed'
        AND length(trim(coalesce(json_extract(device_info, '$.deviceId'), ''))) > 0
      ORDER BY server_time DESC, id DESC
      LIMIT 1
    `
    )
    .bind(employeeUid)
    .first();
  return normalizeText(row?.device_id) || null;
}

async function resolveZones(db, allowedZoneIds, options = {}) {
  if (!allowedZoneIds.length)
    return {
      zones: [],
      error: "zone_not_assigned",
      requestedZoneIds: [],
      resolvedZoneIds: [],
      missingZoneIds: [],
    };
  const placeholders = allowedZoneIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `
    SELECT id, name, type, center_lat, center_lng, radius_meters, active,
           office_ip, created_at, updated_at
    FROM work_zones WHERE id IN (${placeholders})
  `
    )
    .bind(...allowedZoneIds)
    .all();
  let zones = (result.results || []).map(mapWorkZoneRow);
  let resolvedZoneIds = zones.map(zone => normalizeText(zone.id)).filter(Boolean);
  let resolvedZoneIdSet = new Set(resolvedZoneIds);
  let missingZoneIds = allowedZoneIds.filter(id => !resolvedZoneIdSet.has(id));

  if (missingZoneIds.length) {
    const syncedZones = await syncMissingWorkZonesFromFirestore(
      db,
      missingZoneIds,
      options
    );
    if (syncedZones.length) {
      zones = [...zones, ...syncedZones];
      resolvedZoneIds = zones
        .map(zone => normalizeText(zone.id))
        .filter(Boolean);
      resolvedZoneIdSet = new Set(resolvedZoneIds);
      missingZoneIds = allowedZoneIds.filter(id => !resolvedZoneIdSet.has(id));
    }
  }

  if (!zones.length)
    return {
      zones: [],
      error: "zone_not_found",
      requestedZoneIds: allowedZoneIds,
      resolvedZoneIds,
      missingZoneIds,
    };
  if (zones.some(zone => zone.type !== "radius"))
    return {
      zones: [],
      error: "unsupported_zone_type",
      requestedZoneIds: allowedZoneIds,
      resolvedZoneIds,
      missingZoneIds: [],
    };
  if (zones.some(zone => !zone.active || zone.radiusMeters <= 0))
    return {
      zones: [],
      error: "zone_invalid",
      requestedZoneIds: allowedZoneIds,
      resolvedZoneIds,
      missingZoneIds: [],
    };
  return {
    zones,
    error: "",
    requestedZoneIds: allowedZoneIds,
    resolvedZoneIds,
    missingZoneIds: [],
  };
}

export function evaluateAttendanceZones(location, zones) {
  if (!Array.isArray(zones) || !zones.length) {
    return {
      zone: null,
      distanceMeters: null,
      withinZone: false,
      allowedAccuracyMeters: ATTENDANCE_BASE_MAX_ACCURACY_METERS,
    };
  }
  const evaluated = zones
    .map(zone => ({
      zone,
      distanceMeters: calculateDistanceMeters(location, zone.center),
    }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  const matching = evaluated.find(
    item => item.distanceMeters <= item.zone.radiusMeters
  );
  const matchingZones = evaluated.filter(
    item => item.distanceMeters <= item.zone.radiusMeters
  );
  const accuracyAcceptedMatch =
    matchingZones.find(
      item => location.accuracy <= getAllowedAccuracyMeters(item.zone)
    ) || null;
  const selected = accuracyAcceptedMatch || matching || evaluated[0] || null;
  const allowedAccuracyMeters = matchingZones.length
    ? Math.max(
        ...matchingZones.map(item => getAllowedAccuracyMeters(item.zone))
      )
    : ATTENDANCE_BASE_MAX_ACCURACY_METERS;

  return {
    zone: selected?.zone || null,
    distanceMeters: selected?.distanceMeters ?? null,
    withinZone: Boolean(matching),
    allowedAccuracyMeters,
  };
}

export function evaluateLocationDecision({
  location,
  zoneError,
  zoneCheck,
  clientIp = null,
}) {
  if (zoneError) {
    return { result: "rejected", rejectionReason: zoneError };
  }
  if (!zoneCheck.withinZone) {
    return { result: "rejected", rejectionReason: "outside_zone" };
  }
  if (
    location.accuracy >
    (finiteNumber(zoneCheck.allowedAccuracyMeters) ||
      getAllowedAccuracyMeters(zoneCheck.zone))
  ) {
    return { result: "rejected", rejectionReason: "poor_accuracy" };
  }

  const requiredOfficeIp = normalizeIpAddress(zoneCheck.zone?.officeIp);
  if (requiredOfficeIp) {
    const normalizedClientIp = normalizeIpAddress(clientIp);
    if (!normalizedClientIp) {
      return { result: "rejected", rejectionReason: "office_ip_unavailable" };
    }
    if (normalizedClientIp !== requiredOfficeIp) {
      return { result: "rejected", rejectionReason: "office_ip_mismatch" };
    }
  }

  return { result: "allowed", rejectionReason: null };
}

function getAllowedAccuracyMeters(zone) {
  const radiusMeters = finiteNumber(zone?.radiusMeters);
  if (!radiusMeters || radiusMeters <= 0) return ATTENDANCE_BASE_MAX_ACCURACY_METERS;
  return Math.max(
    ATTENDANCE_BASE_MAX_ACCURACY_METERS,
    Math.min(radiusMeters, ATTENDANCE_MAX_ACCURACY_METERS)
  );
}

function isServerTimeWithinBounds(serverTime, bounds) {
  if (!bounds?.start || !bounds?.end || !serverTime) return true;
  return serverTime >= bounds.start && serverTime < bounds.end;
}

export function evaluateStateTransition(type, currentStatus, options = {}) {
  const isSameAttendanceDay = isServerTimeWithinBounds(
    options.lastServerTime,
    options.dayBounds
  );
  if (
    type === "check_in" &&
    currentStatus === "checked_in" &&
    isSameAttendanceDay
  ) {
    return {
      result: "rejected",
      rejectionReason: "duplicate_check_in",
      currentStatus,
    };
  }
  if (
    type === "check_out" &&
    (currentStatus !== "checked_in" || !isSameAttendanceDay)
  ) {
    return {
      result: "rejected",
      rejectionReason: "not_checked_in",
      currentStatus: currentStatus || null,
    };
  }
  return {
    result: "allowed",
    rejectionReason: null,
    currentStatus: type === "check_in" ? "checked_in" : "checked_out",
  };
}

export function evaluateDeviceChange(currentDeviceId, previousDeviceId) {
  const current = normalizeText(currentDeviceId);
  const previous = normalizeText(previousDeviceId);
  const deviceChanged = Boolean(current && previous && current !== previous);
  return {
    deviceChanged,
    previousDeviceId: deviceChanged ? previous : null,
  };
}

function riyadhDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pickRecordDeviceId(record) {
  const snakeDeviceInfo =
    typeof record?.device_info === "string"
      ? safeJsonObject(record.device_info)
      : record?.device_info;
  return normalizeText(
    record?.deviceId ||
      record?.deviceInfo?.deviceId ||
      snakeDeviceInfo?.deviceId
  );
}

function pickRecordServerTime(record) {
  return normalizeText(record?.serverTime || record?.server_time);
}

export function isDeviceFirstSeenToday(device, records = [], todayDateKey) {
  const deviceId = normalizeText(device?.deviceId || device?.id || device);
  if (!deviceId) return false;

  const today = normalizeText(todayDateKey) || riyadhDateKey(new Date());
  const explicitFirstSeen = normalizeText(
    device?.firstSeenAt || device?.first_seen_at
  );
  if (explicitFirstSeen) {
    return riyadhDateKey(explicitFirstSeen) === today;
  }

  let firstSeenMs = Infinity;
  let firstSeenValue = "";
  for (const record of records || []) {
    if (pickRecordDeviceId(record) !== deviceId) continue;
    const serverTime = pickRecordServerTime(record);
    const serverTimeMs = Date.parse(serverTime);
    if (Number.isFinite(serverTimeMs) && serverTimeMs < firstSeenMs) {
      firstSeenMs = serverTimeMs;
      firstSeenValue = serverTime;
    }
  }

  return Boolean(firstSeenValue) && riyadhDateKey(firstSeenValue) === today;
}

export function calculateDistanceMeters(left, right) {
  const toRadians = degrees => (degrees * Math.PI) / 180;
  const latDelta = toRadians(right.lat - left.lat);
  const lngDelta = toRadians(right.lng - left.lng);
  const leftLat = toRadians(left.lat);
  const rightLat = toRadians(right.lat);
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(
    EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

function pickAllowedZoneIds(employeeData, userData) {
  const employeeEmployment =
    employeeData?.employeeProfile?.employment ||
    employeeData?.employment ||
    {};

  const userEmployment =
    userData?.employeeProfile?.employment ||
    userData?.employment ||
    {};

  return uniqueStrings(
    employeeData?.allowedZoneIds,
    employeeEmployment?.allowedZoneIds,
    userData?.allowedZoneIds,
    userEmployment?.allowedZoneIds,
    [
      employeeData?.workZoneId,
      employeeData?.zoneId,
      employeeData?.attendanceZoneId,
      employeeData?.allowedAttendanceZoneId,
      employeeData?.assignedAttendanceZoneId,
      employeeData?.attendanceScopeId,

      employeeEmployment?.workZoneId,
      employeeEmployment?.zoneId,
      employeeEmployment?.attendanceZoneId,
      employeeEmployment?.allowedAttendanceZoneId,
      employeeEmployment?.assignedAttendanceZoneId,
      employeeEmployment?.attendanceScopeId,

      userData?.workZoneId,
      userData?.zoneId,
      userData?.attendanceZoneId,
      userData?.allowedAttendanceZoneId,
      userData?.assignedAttendanceZoneId,
      userData?.attendanceScopeId,

      userEmployment?.workZoneId,
      userEmployment?.zoneId,
      userEmployment?.attendanceZoneId,
      userEmployment?.allowedAttendanceZoneId,
      userEmployment?.assignedAttendanceZoneId,
      userEmployment?.attendanceScopeId,
    ]
  );
}

function uniqueStrings(...values) {
  const output = [];
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const normalized = normalizeText(item);
      if (normalized && !output.includes(normalized)) output.push(normalized);
    }
  }
  return output;
}

function normalizeWorkZoneId(value) {
  const id = clampText(value, 220);
  if (!id || id.includes("/") || /[\u0000-\u001f\u007f]/.test(id)) {
    return "";
  }
  return id;
}

function normalizeWorkZoneInput(value) {
  const data = value && typeof value === "object" ? value : {};
  const name = clampText(data.name, 160);
  const type = normalizeText(data.type || "radius").toLowerCase();
  const center =
    data.center && typeof data.center === "object" ? data.center : {};
  const lat = finiteNumber(center.lat ?? center.latitude);
  const lng = finiteNumber(center.lng ?? center.longitude);
  const radiusMeters = finiteNumber(data.radiusMeters);
  const officeIp = normalizeIpAddress(data.officeIp ?? data.office_ip);
  const hasOfficeIpInput = Boolean(
    normalizeText(data.officeIp ?? data.office_ip)
  );
  if (
    !name ||
    type !== "radius" ||
    lat === null ||
    lat < -90 ||
    lat > 90 ||
    lng === null ||
    lng < -180 ||
    lng > 180 ||
    radiusMeters === null ||
    radiusMeters <= 0 ||
    (hasOfficeIpInput && !officeIp)
  ) {
    return {
      ok: false,
      response: json(400, { ok: false, message: "invalid_work_zone" }),
    };
  }
  return {
    ok: true,
    value: {
      name,
      type: "radius",
      center: { lat, lng },
      radiusMeters,
      active: data.active !== false,
      officeIp,
    },
  };
}

function normalizeLocation(value) {
  if (!value || typeof value !== "object") return null;
  const lat = finiteNumber(value.lat ?? value.latitude);
  const lng = finiteNumber(value.lng ?? value.longitude);
  const accuracy = finiteNumber(value.accuracy);
  if (
    lat === null ||
    lat < -90 ||
    lat > 90 ||
    lng === null ||
    lng < -180 ||
    lng > 180 ||
    accuracy === null ||
    accuracy < 0
  )
    return null;
  return { lat, lng, accuracy };
}

function normalizeDeviceInfo(value) {
  const info = value && typeof value === "object" ? value : {};
  return {
    deviceId: clampText(info.deviceId, 120) || null,
    deviceChanged: false,
    previousDeviceId: null,
    userAgent: clampText(info.userAgent, 400) || null,
    platform: clampText(info.platform, 120) || null,
    language: clampText(info.language, 40) || null,
    timeZone: clampText(info.timeZone, 80) || null,
    appVariant: clampText(info.appVariant, 40) || null,
    appVersion: clampText(info.appVersion, 80) || null,
    screenSize: clampText(info.screenSize, 40) || null,
    standalone: info.standalone === true,
    touchPoints: Math.max(0, Math.min(20, Number(info.touchPoints || 0) || 0)),
  };
}

function normalizeFirestoreWorkZone(id, data) {
  const raw = data && typeof data === "object" ? data : {};
  const center =
    raw.center && typeof raw.center === "object" ? raw.center : {};
  const zone = normalizeWorkZoneInput({
    name: raw.name || raw.title || id,
    type: raw.type || "radius",
    center: {
      lat:
        raw.lat ??
        raw.latitude ??
        raw.centerLat ??
        raw.center_lat ??
        center.lat ??
        center.latitude,
      lng:
        raw.lng ??
        raw.longitude ??
        raw.centerLng ??
        raw.center_lng ??
        center.lng ??
        center.longitude,
    },
    radiusMeters:
      raw.radiusMeters ??
      raw.radius ??
      raw.radius_meters,
    active:
      raw.active ??
      (normalizeText(raw.status).toLowerCase() === "inactive"
        ? false
        : true),
    officeIp: raw.officeIp ?? raw.office_ip,
  });

  if (!zone.ok) return null;

  return {
    id,
    ...zone.value,
    createdAt: raw.createdAt || null,
    updatedAt: raw.updatedAt || null,
  };
}

async function syncWorkZoneRow(db, zone, requesterUid) {
  const now = new Date().toISOString();
  const actorUid = normalizeText(requesterUid) || "firestore_sync";

  await db
    .prepare(
      `
      INSERT INTO work_zones (
        id, name, type, center_lat, center_lng, radius_meters, active, office_ip,
        created_by_uid, created_at, updated_by_uid, updated_at
      ) VALUES (?, ?, 'radius', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = 'radius',
        center_lat = excluded.center_lat,
        center_lng = excluded.center_lng,
        radius_meters = excluded.radius_meters,
        active = excluded.active,
        office_ip = excluded.office_ip,
        updated_by_uid = excluded.updated_by_uid,
        updated_at = excluded.updated_at
    `
    )
    .bind(
      zone.id,
      zone.name,
      zone.center.lat,
      zone.center.lng,
      zone.radiusMeters,
      zone.active ? 1 : 0,
      zone.officeIp,
      actorUid,
      now,
      actorUid,
      now
    )
    .run();
}

async function syncMissingWorkZonesFromFirestore(db, missingZoneIds, options) {
  const fetchFirestoreDocument = options?.fetchFirestoreDocument;
  const requester = options?.requester || {};
  const salonId = normalizeText(options?.salonId) || "main";

  if (
    typeof fetchFirestoreDocument !== "function" ||
    !requester.projectId ||
    !requester.idToken
  ) {
    return [];
  }

  const syncedZones = [];

  for (const rawId of missingZoneIds) {
    const id = normalizeWorkZoneId(rawId);
    if (!id) continue;

    const result = await fetchFirestoreDocument({
      projectId: requester.projectId,
      idToken: requester.idToken,
      documentPath: `salons/${salonId}/work_zones/${id}`,
    }).catch(() => null);

    if (!result?.ok || !result.found) continue;

    const zone = normalizeFirestoreWorkZone(
      id,
      result.data?.data || {}
    );
    if (!zone) continue;

    await syncWorkZoneRow(db, zone, requester.uid);
    syncedZones.push(zone);
  }

  return syncedZones;
}

function mapWorkZoneRow(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    type: "radius",
    center: { lat: Number(row.center_lat), lng: Number(row.center_lng) },
    radiusMeters: Number(row.radius_meters),
    active: Number(row.active) === 1,
    officeIp: normalizeIpAddress(row.office_ip),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function getRequestClientIp(request) {
  return normalizeIpAddress(request?.headers?.get("CF-Connecting-IP"));
}

function normalizeIpAddress(value) {
  let input = normalizeText(value).toLowerCase();
  if (!input) return null;
  if (input.startsWith("[") && input.endsWith("]")) {
    input = input.slice(1, -1);
  }
  if (isValidIpv4(input)) return input;
  if (!input.includes(":")) return null;

  try {
    const parsed = new URL(`http://[${input}]/`).hostname;
    const normalized = parsed.replace(/^\[|\]$/g, "").toLowerCase();
    return normalized.includes(":") ? normalized : null;
  } catch {
    return null;
  }
}

function isValidIpv4(value) {
  const parts = String(value || "").split(".");
  return (
    parts.length === 4 &&
    parts.every(part => {
      if (!/^\d{1,3}$/.test(part)) return false;
      if (part.length > 1 && part.startsWith("0")) return false;
      const number = Number(part);
      return number >= 0 && number <= 255;
    })
  );
}

function buildAttendanceSource({ clientIp, zone }) {
  const requiredOfficeIp = normalizeIpAddress(zone?.officeIp);
  const normalizedClientIp = normalizeIpAddress(clientIp);
  return JSON.stringify({
    area: "employee",
    page: "employee_profile",
    route: "worker.attendance.record",
    method: "gps_button",
    network: {
      clientIp: normalizedClientIp,
      officeIpRequired: Boolean(requiredOfficeIp),
      officeIpMatched: requiredOfficeIp
        ? normalizedClientIp === requiredOfficeIp
        : null,
    },
  });
}

function normalizeAttendanceDebug(value) {
  const info = value && typeof value === "object" ? value : {};
  const requestId = clampText(info.requestId, 120) || null;
  const enabled = value === true || info.enabled === true || Boolean(requestId);
  if (!enabled) return null;
  return {
    requestId,
    startedAt: clampText(info.startedAt, 80) || null,
    pageUrl: clampText(info.pageUrl, 500) || null,
  };
}

function buildAttendanceZoneDebug(zone, distanceMeters = null) {
  if (!zone) return null;
  return {
    id: zone.id || null,
    name: zone.name || null,
    type: zone.type || null,
    active: zone.active ?? null,
    radiusMeters: zone.radiusMeters ?? null,
    allowedAccuracyMeters: getAllowedAccuracyMeters(zone),
    distanceMeters,
    center: zone.center || null,
  };
}

function buildAttendanceDebug({
  debugRequest,
  requester,
  requestedEmployeeId,
  linkedEmployeeId,
  employeeDocId,
  employeeFound,
  allowedZoneIds,
  requestedAttendanceZoneId,
  employeeAllowedZoneIds,
  zoneResolution,
  zoneCheck,
  location,
  locationDecision,
}) {
  if (!debugRequest) return null;
  return {
    requestId: debugRequest.requestId,
    generatedAt: new Date().toISOString(),
    pageUrl: debugRequest.pageUrl || null,
    requester: {
      uid: requester.uid || null,
      email: requester.email || null,
      role: requester.runtime?.role || null,
    },
    employee: {
      requestedEmployeeId: requestedEmployeeId || null,
      linkedEmployeeId: linkedEmployeeId || null,
      employeeDocId: employeeDocId || null,
      employeeFound,
    },
    zones: {
      allowedZoneIds,
      employeeAllowedZoneIds: employeeAllowedZoneIds || allowedZoneIds,
      requestedAttendanceZoneId: requestedAttendanceZoneId || null,
      allowedZoneIdsCount: allowedZoneIds.length,
      resolutionError: zoneResolution.error || null,
      requestedZoneIds: zoneResolution.requestedZoneIds || allowedZoneIds,
      resolvedZoneIds: zoneResolution.resolvedZoneIds || [],
      missingZoneIds: zoneResolution.missingZoneIds || [],
      resolvedZoneCount: zoneResolution.zones?.length || 0,
      resolvedZones: (zoneResolution.zones || []).map(zone =>
        buildAttendanceZoneDebug(zone)
      ),
      selectedZone: buildAttendanceZoneDebug(
        zoneCheck.zone,
        zoneCheck.distanceMeters
      ),
      withinZone: Boolean(zoneCheck.withinZone),
      distanceMeters: zoneCheck.distanceMeters,
      allowedAccuracyMeters: zoneCheck.allowedAccuracyMeters ?? null,
    },
    location: {
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy,
    },
    decision: {
      result: locationDecision.result,
      rejectionReason: locationDecision.rejectionReason || null,
    },
  };
}

function attendanceResponse({
  recordId,
  type,
  result,
  rejectionReason,
  location,
  zone,
  distanceMeters,
  previousStatus,
  currentStatus,
  debug,
}) {
  const body = {
    ok: result === "allowed",
    id: recordId,
    result,
    type,
    rejectionReason: rejectionReason || null,
    accuracy: location.accuracy,
    zoneId: zone?.id || null,
    distanceMeters,
    allowedRadiusMeters: zone?.radiusMeters ?? null,
    previousStatus: previousStatus || null,
    currentStatus: currentStatus || null,
  };
  if (debug) body.debug = debug;
  return json(200, body);
}

async function readJsonBody(request) {
  try {
    return { ok: true, data: await request.json() };
  } catch {
    return {
      ok: false,
      response: json(400, { ok: false, message: "invalid_json_body" }),
    };
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

function clampText(value, maxLength) {
  const text = normalizeText(value);
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}

function serverError(message, error) {
  console.error(`[attendance] ${message}`, error);
  return json(500, {
    ok: false,
    message,
    detail: error instanceof Error ? error.message : String(error),
  });
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
