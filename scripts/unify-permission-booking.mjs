import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, text) {
  fs.writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`[permission-booking] ${label}: expected 1 match, found ${count}`);
  }
  return text.replace(before, after);
}

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) {
    throw new Error(`[permission-booking] ${label}: source text not found`);
  }
  return text.split(before).join(after);
}

function patchAttendanceCalendarData() {
  const path = 'src/helpers/hr/attendanceCalendarData.ts';
  let text = read(path);
  text = replaceOnce(
    text,
    'const LABEL_PARTIAL_LEAVE = "\\u0625\\u062c\\u0627\\u0632\\u0629 \\u062c\\u0632\\u0626\\u064a\\u0629";',
    'const LABEL_PARTIAL_LEAVE = "\\u0627\\u0633\\u062a\\u0626\\u0630\\u0627\\u0646";',
    'attendance partial label -> permission'
  );
  write(path, text);
}

function patchLeaveModal() {
  const path = 'src/components/LeaveRequestModal.tsx';
  let text = read(path);

  text = replaceRequired(text, 'الإجازة الجزئية', 'الاستئذان', 'rename partial leave copy');
  text = replaceRequired(text, 'جزء من اليوم', 'استئذان', 'rename partial option');
  text = text.replace('الاستئذان تحجب', 'الاستئذان يحجب');

  text = replaceOnce(
    text,
    '      title="تسجيل إجازة"\n      description="حدّد نوع الإجازة وفترتها، ثم راجع أثرها على الرصيد والراتب قبل الاعتماد."\n      eyebrow="طلبات الإجازات"',
    '      title={isPartialLeave ? "تسجيل استئذان" : "تسجيل إجازة"}\n      description={isPartialLeave ? "حدّد فترة الاستئذان؛ هذه الفترة فقط ستُحجب من الحجز." : "حدّد نوع الإجازة وفترتها، ثم راجع أثرها على الرصيد والراتب قبل الاعتماد."}\n      eyebrow={isPartialLeave ? "الاستئذانات" : "طلبات الإجازات"}',
    'dynamic modal title'
  );

  text = replaceOnce(
    text,
    '{submitting ? "جاري الاعتماد..." : "اعتماد الإجازة"}',
    '{submitting ? "جاري الاعتماد..." : isPartialLeave ? "اعتماد الاستئذان" : "اعتماد الإجازة"}',
    'dynamic submit label'
  );

  text = replaceOnce(
    text,
    '        <DashboardFieldV2 id="leave-duration-kind-v2" label="مدة الإجازة" required>',
    '        <DashboardFieldV2 id="leave-duration-kind-v2" label="نوع التسجيل" required>',
    'duration field label'
  );

  text = replaceOnce(
    text,
    '<strong>تعذر اعتماد الإجازة</strong>',
    '<strong>{isPartialLeave ? "تعذر اعتماد الاستئذان" : "تعذر اعتماد الإجازة"}</strong>',
    'dynamic error title'
  );

  text = text.replace('placeholder="اكتب سبب الإجازة أو أي تفاصيل يحتاجها المسؤول..."', 'placeholder={isPartialLeave ? "اكتب سبب الاستئذان أو أي تفاصيل يحتاجها المسؤول..." : "اكتب سبب الإجازة أو أي تفاصيل يحتاجها المسؤول..."}');
  write(path, text);
}

function patchEmployeeRequestsCopy() {
  const path = 'src/pages/hr/EmployeeRequests.tsx';
  let text = read(path);
  text = text.replace('partialStartTime: "بداية الإجازة الجزئية"', 'partialStartTime: "بداية الاستئذان"');
  text = text.replace('partialEndTime: "نهاية الإجازة الجزئية"', 'partialEndTime: "نهاية الاستئذان"');
  write(path, text);
}

function patchLiveAttendance() {
  const path = 'src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx';
  let text = read(path);
  text = replaceRequired(text, 'إجازة جزئية', 'استئذان', 'live partial wording');
  text = replaceRequired(text, 'جزء من اليوم', 'فترة الاستئذان', 'live partial fallback');

  text = replaceOnce(
    text,
    '  const selectedHasApprovedLeave = approvedLeaveDateKeys.includes(activeSelectedDate) || selectedSpecialDay?.kind === "leave" || selectedSpecialDay?.kind === "rest";',
    '  const selectedHasApprovedLeave = approvedLeaveDateKeys.includes(activeSelectedDate) || selectedSpecialDay?.kind === "leave" || selectedSpecialDay?.kind === "rest" || selectedSpecialDay?.kind === "partial_leave";',
    'partial permission cancellation availability'
  );

  text = replaceOnce(
    text,
    '                      إلغاء الإجازة',
    '                      {selectedSpecialDay?.kind === "partial_leave" ? "إلغاء الاستئذان" : "إلغاء الإجازة"}',
    'cancel button label'
  );

  write(path, text);
}

function patchAttendanceSection() {
  const path = 'src/pages/dashboardEmployees/AttendanceSection.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
    '  const [coreResolvedShiftsByDate, setCoreResolvedShiftsByDate] = useState<Record<string, CoreResolvedShift | null>>({});\n  const [coreShiftLoading, setCoreShiftLoading] = useState(false);',
    '  const [coreResolvedShiftsByDate, setCoreResolvedShiftsByDate] = useState<Record<string, CoreResolvedShift | null>>({});\n  const [corePermissionSpecialDays, setCorePermissionSpecialDays] = useState<AttendanceSpecialDay[]>([]);\n  const [coreShiftLoading, setCoreShiftLoading] = useState(false);',
    'core permission special-day state'
  );

  const permissionEffect = `\n  useEffect(() => {\n    const identityIds = employeeIdsKey.split("|").filter(Boolean);\n    if (!isVisible || !identityIds.length || !/^\\d{4}-\\d{2}$/.test(monthKey)) {\n      setCorePermissionSpecialDays([]);\n      return;\n    }\n\n    let cancelled = false;\n    Promise.all(\n      identityIds.map((id) => CoreHrService.listLeaves({ employeeId: id, status: "approved" }).catch(() => []))\n    ).then((groups) => {\n      if (cancelled) return;\n      const monthPrefix = \\`${monthKey}-\\`;\n      const byInterval = new Map<string, AttendanceSpecialDay>();\n      groups.flat().forEach((leave) => {\n        if (cleanText(leave.status).toLowerCase() !== "approved") return;\n        if (cleanText(leave.durationKind).toLowerCase() !== "partial") return;\n        const date = cleanText(leave.startDate);\n        const startTime = cleanText(leave.partialStartTime);\n        const endTime = cleanText(leave.partialEndTime);\n        if (!date.startsWith(monthPrefix)) return;\n        if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(startTime) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(endTime)) return;\n        byInterval.set(\\`${date}|${startTime}|${endTime}\\`, {\n          date,\n          kind: "partial_leave",\n          label: "استئذان",\n          source: "core_employee_leave",\n          sourceId: cleanText(leave.id),\n          type: cleanText(leave.leaveType),\n          partialStartTime: startTime,\n          partialEndTime: endTime,\n        });\n      });\n      setCorePermissionSpecialDays(Array.from(byInterval.values()).sort((a, b) => a.date.localeCompare(b.date)));\n    }).catch((error) => {\n      if (cancelled) return;\n      console.warn("attendance permission intervals load failed", error);\n      setCorePermissionSpecialDays([]);\n    });\n\n    return () => {\n      cancelled = true;\n    };\n  }, [employeeIdsKey, isVisible, monthKey]);\n`;

  text = replaceOnce(
    text,
    '  useEffect(() => {\n    setPunchClearMessage("");\n    setPunchClearError("");\n  }, [selectedDate]);',
    `${permissionEffect}\n  useEffect(() => {\n    setPunchClearMessage("");\n    setPunchClearError("");\n  }, [selectedDate]);`,
    'core permission interval loader'
  );

  text = replaceOnce(
    text,
    '    [...specialDays, ...rowSpecialDays, ...resolvedCoreSpecialDays, ...(selectedCoreSpecialDay ? [selectedCoreSpecialDay] : [])].forEach((day) => {',
    '    [...specialDays, ...corePermissionSpecialDays, ...rowSpecialDays, ...resolvedCoreSpecialDays, ...(selectedCoreSpecialDay ? [selectedCoreSpecialDay] : [])].forEach((day) => {',
    'merge core permissions into attendance calendar'
  );

  text = replaceOnce(
    text,
    '  }, [resolvedCoreSpecialDays, rowSpecialDays, selectedCoreSpecialDay, specialDays, temporaryOffSpecialDays, temporaryWorkDateKeys]);',
    '  }, [corePermissionSpecialDays, resolvedCoreSpecialDays, rowSpecialDays, selectedCoreSpecialDay, specialDays, temporaryOffSpecialDays, temporaryWorkDateKeys]);',
    'core permission merge dependencies'
  );

  write(path, text);
}

function patchPermissionsRepository() {
  const path = 'workers/core/repositories/permissions.js';
  let text = read(path);

  const anchor = `  await insertEvent(db, salonId, row.id, type, actor, { time: timeValue, idempotencyKey });\n}\n\nexport async function permissionPayrollSummary`;
  const helpers = `  await insertEvent(db, salonId, row.id, type, actor, { time: timeValue, idempotencyKey });\n}\n\nfunction permissionBookingLeaveId(permissionId) {\n  return \\`permission_leave_${cleanText(permissionId).replace(/[^A-Za-z0-9_-]/g, '_')}\\`;\n}\n\nasync function syncPermissionBookingBlock(db, salonId, row, actor = {}) {\n  const permissionId = requiredId(row.id, 'permissionId');\n  const dateKey = validDate(row.date_key, 'date');\n  const startTime = validTime(row.requested_exit_time, 'startTime');\n  const endTime = validTime(row.expected_return_time, 'expectedReturnTime');\n  const leaveId = permissionBookingLeaveId(permissionId);\n  const now = nowIso();\n  const existing = await dbFirst(\n    db,\n    'SELECT id FROM employee_leaves WHERE salon_id = ? AND (id = ? OR request_id = ?) LIMIT 1',\n    [salonId, leaveId, permissionId]\n  );\n  const hrNote = 'استئذان معتمد — يحجب فترة الحجز المحددة فقط';\n\n  if (existing?.id) {\n    await dbRun(\n      db,\n      \\`UPDATE employee_leaves\n          SET employee_id = ?, employee_uid = ?, employee_name = ?, status = 'approved',\n              leave_type = 'permission', start_date = ?, end_date = ?, days_count = 0,\n              employee_note = ?, hr_note = ?, decided_at = ?, decided_by_uid = ?,\n              decided_by_name = ?, updated_at = ?, duration_kind = 'partial',\n              partial_start_time = ?, partial_end_time = ?, request_id = ?\n        WHERE salon_id = ? AND id = ?\\`,\n      [\n        row.employee_id, row.employee_uid || null, row.employee_name || null, dateKey, dateKey,\n        row.reason || 'استئذان', hrNote, now, optionalText(actor.uid) || null,\n        optionalText(actor.name) || null, now, startTime, endTime, permissionId, salonId, existing.id,\n      ]\n    );\n    return existing.id;\n  }\n\n  await dbRun(\n    db,\n    \\`INSERT INTO employee_leaves\n      (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status,\n       leave_type, start_date, end_date, days_count, employee_note, hr_note, decided_at,\n       decided_by_uid, decided_by_email, decided_by_name, created_at, updated_at,\n       duration_kind, partial_start_time, partial_end_time, request_id)\n     VALUES (?, ?, ?, ?, ?, NULL, 'approved', 'permission', ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, 'partial', ?, ?, ?)\\`,\n    [\n      leaveId, salonId, row.employee_id, row.employee_uid || null, row.employee_name || null,\n      dateKey, dateKey, row.reason || 'استئذان', hrNote, now, optionalText(actor.uid) || null,\n      optionalText(actor.name) || null, now, now, startTime, endTime, permissionId,\n    ]\n  );\n  return leaveId;\n}\n\nasync function cancelPermissionBookingBlock(db, salonId, permissionIdValue, actor = {}, reason = '') {\n  const permissionId = requiredId(permissionIdValue, 'permissionId');\n  const now = nowIso();\n  await dbRun(\n    db,\n    \\`UPDATE employee_leaves\n        SET status = 'rejected', hr_note = ?, decided_at = ?, decided_by_uid = ?,\n            decided_by_name = ?, updated_at = ?\n      WHERE salon_id = ? AND request_id = ? AND leave_type = 'permission'\\`,\n    [\n      cleanText(reason) || 'تم إلغاء الاستئذان', now, optionalText(actor.uid) || null,\n      optionalText(actor.name) || null, now, salonId, permissionId,\n    ]\n  );\n}\n\nexport async function permissionPayrollSummary`;
  text = replaceOnce(text, anchor, helpers, 'permission booking helpers');

  text = replaceOnce(
    text,
    `    await insertAttendanceEvent(db, salonId, row, 'permission_out', requestedExitTime, actor);\n    await insertAttendanceEvent(db, salonId, row, 'permission_return', expectedReturnTime, actor);\n    await refreshPayrollEntries(db, salonId, row.employee_id, row.date_key);`,
    `    await insertAttendanceEvent(db, salonId, row, 'permission_out', requestedExitTime, actor);\n    await insertAttendanceEvent(db, salonId, row, 'permission_return', expectedReturnTime, actor);\n    await syncPermissionBookingBlock(db, salonId, row, actor);\n    await refreshPayrollEntries(db, salonId, row.employee_id, row.date_key);`,
    'admin direct permission booking link'
  );

  text = replaceOnce(
    text,
    `    const updated = await getPermission(db, salonId, row.id);\n    await insertAttendanceEvent(db, salonId, updated, 'permission_out', exitTime, actor);`,
    `    const updated = await getPermission(db, salonId, row.id);\n    await syncPermissionBookingBlock(db, salonId, updated, actor);\n    await insertAttendanceEvent(db, salonId, updated, 'permission_out', exitTime, actor);`,
    'approved permission booking link'
  );

  text = replaceOnce(
    text,
    `  const updated = await getPermission(db, salonId, row.id);\n  const title = status === 'rejected'`,
    `  const updated = await getPermission(db, salonId, row.id);\n  if (status === 'rejected' || status === 'cancelled') {\n    await cancelPermissionBookingBlock(db, salonId, row.id, actor, status === 'cancelled' ? 'تم إلغاء الاستئذان' : 'تم رفض الاستئذان');\n  }\n  const title = status === 'rejected'`,
    'cancel/reject permission booking link'
  );

  text = replaceOnce(
    text,
    `  const updated = await getPermission(db, salonId, row.id);\n  await insertAttendanceEvent(db, salonId, updated, 'permission_out', actualExitTime, actor);\n  await notifyEmployee(db, salonId, updated, 'تم تسجيل خروجك للاستئذان'`,
    `  const updated = await getPermission(db, salonId, row.id);\n  if (cleanText(updated.expected_return_time)) await syncPermissionBookingBlock(db, salonId, updated, actor);\n  await insertAttendanceEvent(db, salonId, updated, 'permission_out', actualExitTime, actor);\n  await notifyEmployee(db, salonId, updated, 'تم تسجيل خروجك للاستئذان'`,
    'out permission booking link'
  );

  text = replaceOnce(
    text,
    `  const updated = await getPermission(db, salonId, row.id);\n  await insertAttendanceEvent(db, salonId, updated, 'permission_return', actualReturnTime, actor);\n  await refreshPayrollEntries(db, salonId, updated.employee_id, updated.date_key);`,
    `  const updated = await getPermission(db, salonId, row.id);\n  await syncPermissionBookingBlock(db, salonId, updated, actor);\n  await insertAttendanceEvent(db, salonId, updated, 'permission_return', actualReturnTime, actor);\n  await refreshPayrollEntries(db, salonId, updated.employee_id, updated.date_key);`,
    'returned permission booking link'
  );

  write(path, text);
}

function patchUnifiedEmployeeRequestsRepository() {
  const path = 'workers/core/repositories/employee-requests.js';
  let text = read(path);

  text = replaceOnce(
    text,
    `  const id = generatedId('permission');\n  const now = nowIso();`,
    `  const id = generatedId('permission');\n  const bookingLeaveId = \\`permission_leave_${id.replace(/[^A-Za-z0-9_-]/g, '_')}\\`;\n  const now = nowIso();`,
    'permission booking leave id'
  );

  text = replaceOnce(
    text,
    `        \\`permission:${id}:permission_return\\`, now],\n    },\n  ]);`,
    `        \\`permission:${id}:permission_return\\`, now],\n    },\n    {\n      sql: \\`INSERT OR IGNORE INTO employee_leaves\n        (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status,\n         leave_type, start_date, end_date, days_count, employee_note, hr_note, decided_at,\n         decided_by_uid, decided_by_email, decided_by_name, created_at, updated_at,\n         duration_kind, partial_start_time, partial_end_time, request_id)\n       VALUES (?, ?, ?, ?, ?, NULL, 'approved', 'permission', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, ?, ?)\\`,\n      params: [\n        bookingLeaveId, salonId, row.employee_id, row.employee_uid, row.employee_name_snapshot,\n        payload.date, payload.date, payload.reason, 'استئذان معتمد — يحجب فترة الحجز المحددة فقط',\n        now, cleanText(actor.uid) || null, cleanText(actor.email) || null, cleanText(actor.name) || null,\n        now, now, payload.startTime, payload.endTime, id,\n      ],\n    },\n  ]);`,
    'employee request permission booking block'
  );

  text = replaceOnce(
    text,
    `    const updated = result.updated;\n    if (['request-info', 'request_info'].includes(actionKey) && cleanText(input.note)) {`,
    `    const updated = result.updated;\n    if (actionStatus === 'approved' && updated.request_type === 'permission') {\n      return transitionEmployeeRequest(\n        db,\n        salonId,\n        updated.id,\n        'execute',\n        {\n          ...input,\n          version: updated.version,\n          idempotencyKey: input.idempotencyKey\n            ? \\`${input.idempotencyKey}:permission_auto_execute\\`\n            : \\`permission_auto_execute:${updated.version}\\`,\n        },\n        actor,\n        options\n      );\n    }\n    if (['request-info', 'request_info'].includes(actionKey) && cleanText(input.note)) {`,
    'auto execute approved unified permission request'
  );

  write(path, text);
}

function patchDashboardCancellationAndCopy() {
  const path = 'src/pages/DashboardEmployees.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
    `import { CoreHrService } from "../services/CoreHrService";\nimport { CoreStaffService } from "../services/CoreStaffService";`,
    `import { CoreHrService } from "../services/CoreHrService";\nimport { reviewPermissionRequest } from "../services/employeePermissionRequests";\nimport { CoreStaffService } from "../services/CoreStaffService";`,
    'permission review import'
  );

  text = replaceRequired(text, 'الإجازة الجزئية', 'الاستئذان', 'dashboard partial wording');

  text = text.replace(
    'note: payload.note || "تسجيل إجازة معتمدة من إدارة الموظفات",',
    'note: payload.note || (isPartialLeave ? "تسجيل استئذان معتمد من إدارة الموظفات" : "تسجيل إجازة معتمدة من إدارة الموظفات"),'
  );
  text = text.replace(
    'employeeNote: payload.note || "تسجيل إجازة معتمدة من إدارة الموظفات",',
    'employeeNote: payload.note || (isPartialLeave ? "تسجيل استئذان معتمد من إدارة الموظفات" : "تسجيل إجازة معتمدة من إدارة الموظفات"),'
  );

  const missingLeaveBlock = `    if (!leaveRequest) {\n      setErrorMsg("لم يتم العثور على طلب إجازة معتمد لهذا اليوم.");\n      return;\n    }`;
  const fallbackBlock = `    if (!leaveRequest) {\n      const coreLeaves = await CoreHrService.listLeaves({ employeeId: selectedEmployeeId }).catch(() => []);\n      const permissionLeave = coreLeaves.find((leave) => {\n        if (cleanText(leave.status).toLowerCase() !== "approved") return false;\n        if (cleanText(leave.durationKind).toLowerCase() !== "partial") return false;\n        if (cleanText(leave.leaveType).toLowerCase() !== "permission") return false;\n        const leaveFrom = normalizeLeaveUntil(leave.startDate);\n        const leaveTo = normalizeLeaveUntil(leave.endDate) || leaveFrom;\n        return !!leaveFrom && date >= leaveFrom && date <= leaveTo;\n      });\n      const permissionId = cleanText(permissionLeave?.requestId);\n      if (!permissionLeave || !permissionId) {\n        setErrorMsg("لم يتم العثور على إجازة أو استئذان معتمد لهذا اليوم.");\n        return;\n      }\n\n      const ok = confirm(\\`سيتم إلغاء الاستئذان المعتمد ليوم ${date}. هل تريد المتابعة؟\\`);\n      if (!ok) return;\n\n      setSaving(true);\n      setErrorMsg("");\n      try {\n        await reviewPermissionRequest({\n          requestId: permissionId,\n          status: "cancelled",\n          reviewerUid: authUser.uid,\n          reviewerName: authUser.displayName || authUser.email,\n        });\n        void writeAuditLog({\n          action: "permission_cancelled",\n          entityType: "employee_permission_request",\n          entityId: permissionId,\n          source: "dashboard",\n          description: "إلغاء استئذان معتمد من سجل الحضور",\n          before: { date, status: "approved", coreLeaveId: permissionLeave.id },\n          after: { date, status: "cancelled" },\n          meta: { staffId: selectedEmployeeId },\n        });\n        await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);\n      } catch (error) {\n        setErrorMsg(toFirestoreErrorMessage(error, "تعذر إلغاء الاستئذان."));\n      } finally {\n        setSaving(false);\n      }\n      return;\n    }`;
  text = replaceOnce(text, missingLeaveBlock, fallbackBlock, 'cancel core permission from attendance');

  write(path, text);
}

function patchTests() {
  const path = 'workers/admin-partial-leave-policy.test.mjs';
  let text = read(path);
  text = replaceOnce(text, '  assert.match(modal, /جزء من اليوم/);', '  assert.match(modal, /استئذان/);', 'admin partial UI test wording');
  write(path, text);
}

patchAttendanceCalendarData();
patchLeaveModal();
patchEmployeeRequestsCopy();
patchLiveAttendance();
patchAttendanceSection();
patchPermissionsRepository();
patchUnifiedEmployeeRequestsRepository();
patchDashboardCancellationAndCopy();
patchTests();
console.log('[permission-booking] patch applied');
