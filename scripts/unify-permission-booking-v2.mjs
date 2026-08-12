import fs from 'node:fs';

const nl = (rows) => rows.join('\n');

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, text) {
  fs.writeFileSync(path, text.endsWith('\n') ? text : text + '\n', 'utf8');
}

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error('[permission-booking-v2] ' + label + ': expected 1 match, found ' + count);
  return text.replace(before, after);
}

function replaceRequired(text, before, after, label) {
  if (!text.includes(before)) throw new Error('[permission-booking-v2] ' + label + ': source text not found');
  return text.split(before).join(after);
}

function patchAttendanceCalendarData() {
  const path = 'src/helpers/hr/attendanceCalendarData.ts';
  let text = read(path);
  text = replaceOnce(
    text,
    'const LABEL_PARTIAL_LEAVE = "\\u0625\\u062c\\u0627\\u0632\\u0629 \\u062c\\u0632\\u0626\\u064a\\u0629";',
    'const LABEL_PARTIAL_LEAVE = "\\u0627\\u0633\\u062a\\u0626\\u0630\\u0627\\u0646";',
    'attendance label'
  );
  write(path, text);
}

function patchLeaveModal() {
  const path = 'src/components/LeaveRequestModal.tsx';
  let text = read(path);
  text = replaceRequired(text, 'الإجازة الجزئية', 'الاستئذان', 'modal partial wording');
  text = replaceRequired(text, 'جزء من اليوم', 'استئذان', 'modal partial option');
  text = text.replace('الاستئذان تحجب', 'الاستئذان يحجب');
  text = replaceOnce(
    text,
    nl([
      '      title="تسجيل إجازة"',
      '      description="حدّد نوع الإجازة وفترتها، ثم راجع أثرها على الرصيد والراتب قبل الاعتماد."',
      '      eyebrow="طلبات الإجازات"',
    ]),
    nl([
      '      title={isPartialLeave ? "تسجيل استئذان" : "تسجيل إجازة"}',
      '      description={isPartialLeave ? "حدّد فترة الاستئذان؛ هذه الفترة فقط ستُحجب من الحجز." : "حدّد نوع الإجازة وفترتها، ثم راجع أثرها على الرصيد والراتب قبل الاعتماد."}',
      '      eyebrow={isPartialLeave ? "الاستئذانات" : "طلبات الإجازات"}',
    ]),
    'modal dynamic header'
  );
  text = replaceOnce(
    text,
    '{submitting ? "جاري الاعتماد..." : "اعتماد الإجازة"}',
    '{submitting ? "جاري الاعتماد..." : isPartialLeave ? "اعتماد الاستئذان" : "اعتماد الإجازة"}',
    'modal submit label'
  );
  text = replaceOnce(
    text,
    '<DashboardFieldV2 id="leave-duration-kind-v2" label="مدة الإجازة" required>',
    '<DashboardFieldV2 id="leave-duration-kind-v2" label="نوع التسجيل" required>',
    'modal duration label'
  );
  text = replaceOnce(
    text,
    '<strong>تعذر اعتماد الإجازة</strong>',
    '<strong>{isPartialLeave ? "تعذر اعتماد الاستئذان" : "تعذر اعتماد الإجازة"}</strong>',
    'modal error title'
  );
  text = text.replace(
    'placeholder="اكتب سبب الإجازة أو أي تفاصيل يحتاجها المسؤول..."',
    'placeholder={isPartialLeave ? "اكتب سبب الاستئذان أو أي تفاصيل يحتاجها المسؤول..." : "اكتب سبب الإجازة أو أي تفاصيل يحتاجها المسؤول..."}'
  );
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
    'live cancel availability'
  );
  text = replaceOnce(
    text,
    '                      إلغاء الإجازة',
    '                      {selectedSpecialDay?.kind === "partial_leave" ? "إلغاء الاستئذان" : "إلغاء الإجازة"}',
    'live cancel label'
  );
  write(path, text);
}

function patchAttendanceSection() {
  const path = 'src/pages/dashboardEmployees/AttendanceSection.tsx';
  let text = read(path);
  text = replaceOnce(
    text,
    nl([
      '  const [coreResolvedShiftsByDate, setCoreResolvedShiftsByDate] = useState<Record<string, CoreResolvedShift | null>>({});',
      '  const [coreShiftLoading, setCoreShiftLoading] = useState(false);',
    ]),
    nl([
      '  const [coreResolvedShiftsByDate, setCoreResolvedShiftsByDate] = useState<Record<string, CoreResolvedShift | null>>({});',
      '  const [corePermissionSpecialDays, setCorePermissionSpecialDays] = useState<AttendanceSpecialDay[]>([]);',
      '  const [coreShiftLoading, setCoreShiftLoading] = useState(false);',
    ]),
    'attendance permission state'
  );

  const effect = nl([
    '  useEffect(() => {',
    '    const identityIds = employeeIdsKey.split("|").filter(Boolean);',
    '    if (!isVisible || !identityIds.length || !/^\\d{4}-\\d{2}$/.test(monthKey)) {',
    '      setCorePermissionSpecialDays([]);',
    '      return;',
    '    }',
    '',
    '    let cancelled = false;',
    '    Promise.all(',
    '      identityIds.map((id) => CoreHrService.listLeaves({ employeeId: id, status: "approved" }).catch(() => []))',
    '    ).then((groups) => {',
    '      if (cancelled) return;',
    '      const monthPrefix = monthKey + "-";',
    '      const byInterval = new Map<string, AttendanceSpecialDay>();',
    '      groups.flat().forEach((leave) => {',
    '        if (cleanText(leave.status).toLowerCase() !== "approved") return;',
    '        if (cleanText(leave.durationKind).toLowerCase() !== "partial") return;',
    '        const date = cleanText(leave.startDate);',
    '        const startTime = cleanText(leave.partialStartTime);',
    '        const endTime = cleanText(leave.partialEndTime);',
    '        if (!date.startsWith(monthPrefix)) return;',
    '        if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(startTime) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(endTime)) return;',
    '        byInterval.set([date, startTime, endTime].join("|"), {',
    '          date,',
    '          kind: "partial_leave",',
    '          label: "استئذان",',
    '          source: "core_employee_leave",',
    '          sourceId: cleanText(leave.id),',
    '          type: cleanText(leave.leaveType),',
    '          partialStartTime: startTime,',
    '          partialEndTime: endTime,',
    '        });',
    '      });',
    '      setCorePermissionSpecialDays(Array.from(byInterval.values()).sort((a, b) => a.date.localeCompare(b.date)));',
    '    }).catch((error) => {',
    '      if (cancelled) return;',
    '      console.warn("attendance permission intervals load failed", error);',
    '      setCorePermissionSpecialDays([]);',
    '    });',
    '',
    '    return () => {',
    '      cancelled = true;',
    '    };',
    '  }, [employeeIdsKey, isVisible, monthKey]);',
  ]);

  text = replaceOnce(
    text,
    nl([
      '  useEffect(() => {',
      '    setPunchClearMessage("");',
      '    setPunchClearError("");',
      '  }, [selectedDate]);',
    ]),
    effect + '\n\n' + nl([
      '  useEffect(() => {',
      '    setPunchClearMessage("");',
      '    setPunchClearError("");',
      '  }, [selectedDate]);',
    ]),
    'attendance permission loader'
  );

  text = replaceOnce(
    text,
    '    [...specialDays, ...rowSpecialDays, ...resolvedCoreSpecialDays, ...(selectedCoreSpecialDay ? [selectedCoreSpecialDay] : [])].forEach((day) => {',
    '    [...specialDays, ...corePermissionSpecialDays, ...rowSpecialDays, ...resolvedCoreSpecialDays, ...(selectedCoreSpecialDay ? [selectedCoreSpecialDay] : [])].forEach((day) => {',
    'attendance permission merge'
  );
  text = replaceOnce(
    text,
    '  }, [resolvedCoreSpecialDays, rowSpecialDays, selectedCoreSpecialDay, specialDays, temporaryOffSpecialDays, temporaryWorkDateKeys]);',
    '  }, [corePermissionSpecialDays, resolvedCoreSpecialDays, rowSpecialDays, selectedCoreSpecialDay, specialDays, temporaryOffSpecialDays, temporaryWorkDateKeys]);',
    'attendance permission dependencies'
  );
  write(path, text);
}

function patchPermissionsRepository() {
  const path = 'workers/core/repositories/permissions.js';
  let text = read(path);

  const anchor = nl([
    '  await insertEvent(db, salonId, row.id, type, actor, { time: timeValue, idempotencyKey });',
    '}',
    '',
    'export async function permissionPayrollSummary',
  ]);

  const helpers = nl([
    '  await insertEvent(db, salonId, row.id, type, actor, { time: timeValue, idempotencyKey });',
    '}',
    '',
    'function permissionBookingLeaveId(permissionId) {',
    '  return "permission_leave_" + cleanText(permissionId).replace(/[^A-Za-z0-9_-]/g, "_");',
    '}',
    '',
    'async function syncPermissionBookingBlock(db, salonId, row, actor = {}) {',
    '  const permissionId = requiredId(row.id, "permissionId");',
    '  const dateKey = validDate(row.date_key, "date");',
    '  const startTime = validTime(row.requested_exit_time, "startTime");',
    '  const endTime = validTime(row.expected_return_time, "expectedReturnTime");',
    '  const leaveId = permissionBookingLeaveId(permissionId);',
    '  const now = nowIso();',
    '  const existing = await dbFirst(',
    '    db,',
    '    "SELECT id FROM employee_leaves WHERE salon_id = ? AND (id = ? OR request_id = ?) LIMIT 1",',
    '    [salonId, leaveId, permissionId]',
    '  );',
    '  const hrNote = "استئذان معتمد — يحجب فترة الحجز المحددة فقط";',
    '',
    '  if (existing?.id) {',
    '    await dbRun(',
    '      db,',
    '      `UPDATE employee_leaves',
    "          SET employee_id = ?, employee_uid = ?, employee_name = ?, status = 'approved',",
    "              leave_type = 'permission', start_date = ?, end_date = ?, days_count = 0,",
    '              employee_note = ?, hr_note = ?, decided_at = ?, decided_by_uid = ?,',
    '              decided_by_name = ?, updated_at = ?, duration_kind = \'partial\',',
    '              partial_start_time = ?, partial_end_time = ?, request_id = ?',
    '        WHERE salon_id = ? AND id = ?`,',
    '      [',
    '        row.employee_id, row.employee_uid || null, row.employee_name || null, dateKey, dateKey,',
    '        row.reason || "استئذان", hrNote, now, optionalText(actor.uid) || null,',
    '        optionalText(actor.name) || null, now, startTime, endTime, permissionId, salonId, existing.id,',
    '      ]',
    '    );',
    '    return existing.id;',
    '  }',
    '',
    '  await dbRun(',
    '    db,',
    '    `INSERT INTO employee_leaves',
    '      (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status,',
    '       leave_type, start_date, end_date, days_count, employee_note, hr_note, decided_at,',
    '       decided_by_uid, decided_by_email, decided_by_name, created_at, updated_at,',
    '       duration_kind, partial_start_time, partial_end_time, request_id)',
    "     VALUES (?, ?, ?, ?, ?, NULL, 'approved', 'permission', ?, ?, 0, ?, ?, ?, ?, NULL, ?, ?, ?, 'partial', ?, ?, ?)`,",
    '    [',
    '      leaveId, salonId, row.employee_id, row.employee_uid || null, row.employee_name || null,',
    '      dateKey, dateKey, row.reason || "استئذان", hrNote, now, optionalText(actor.uid) || null,',
    '      optionalText(actor.name) || null, now, now, startTime, endTime, permissionId,',
    '    ]',
    '  );',
    '  return leaveId;',
    '}',
    '',
    'async function cancelPermissionBookingBlock(db, salonId, permissionIdValue, actor = {}, reason = "") {',
    '  const permissionId = requiredId(permissionIdValue, "permissionId");',
    '  const now = nowIso();',
    '  await dbRun(',
    '    db,',
    '    `UPDATE employee_leaves',
    "        SET status = 'rejected', hr_note = ?, decided_at = ?, decided_by_uid = ?,",
    '            decided_by_name = ?, updated_at = ?',
    "      WHERE salon_id = ? AND request_id = ? AND leave_type = 'permission'`,",
    '    [',
    '      cleanText(reason) || "تم إلغاء الاستئذان", now, optionalText(actor.uid) || null,',
    '      optionalText(actor.name) || null, now, salonId, permissionId,',
    '    ]',
    '  );',
    '}',
    '',
    'export async function permissionPayrollSummary',
  ]);

  text = replaceOnce(text, anchor, helpers, 'permission helpers');

  text = replaceOnce(
    text,
    nl([
      "    await insertAttendanceEvent(db, salonId, row, 'permission_out', requestedExitTime, actor);",
      "    await insertAttendanceEvent(db, salonId, row, 'permission_return', expectedReturnTime, actor);",
      '    await refreshPayrollEntries(db, salonId, row.employee_id, row.date_key);',
    ]),
    nl([
      "    await insertAttendanceEvent(db, salonId, row, 'permission_out', requestedExitTime, actor);",
      "    await insertAttendanceEvent(db, salonId, row, 'permission_return', expectedReturnTime, actor);",
      '    await syncPermissionBookingBlock(db, salonId, row, actor);',
      '    await refreshPayrollEntries(db, salonId, row.employee_id, row.date_key);',
    ]),
    'admin direct link'
  );

  text = replaceOnce(
    text,
    nl([
      '    const updated = await getPermission(db, salonId, row.id);',
      "    await insertAttendanceEvent(db, salonId, updated, 'permission_out', exitTime, actor);",
    ]),
    nl([
      '    const updated = await getPermission(db, salonId, row.id);',
      '    await syncPermissionBookingBlock(db, salonId, updated, actor);',
      "    await insertAttendanceEvent(db, salonId, updated, 'permission_out', exitTime, actor);",
    ]),
    'approved link'
  );

  text = replaceOnce(
    text,
    nl([
      '  const updated = await getPermission(db, salonId, row.id);',
      "  const title = status === 'rejected'",
    ]),
    nl([
      '  const updated = await getPermission(db, salonId, row.id);',
      "  if (status === 'rejected' || status === 'cancelled') {",
      "    await cancelPermissionBookingBlock(db, salonId, row.id, actor, status === 'cancelled' ? 'تم إلغاء الاستئذان' : 'تم رفض الاستئذان');",
      '  }',
      "  const title = status === 'rejected'",
    ]),
    'cancel link'
  );

  text = replaceOnce(
    text,
    nl([
      '  const updated = await getPermission(db, salonId, row.id);',
      "  await insertAttendanceEvent(db, salonId, updated, 'permission_out', actualExitTime, actor);",
      "  await notifyEmployee(db, salonId, updated, 'تم تسجيل خروجك للاستئذان'",
    ]),
    nl([
      '  const updated = await getPermission(db, salonId, row.id);',
      '  if (cleanText(updated.expected_return_time)) await syncPermissionBookingBlock(db, salonId, updated, actor);',
      "  await insertAttendanceEvent(db, salonId, updated, 'permission_out', actualExitTime, actor);",
      "  await notifyEmployee(db, salonId, updated, 'تم تسجيل خروجك للاستئذان'",
    ]),
    'out link'
  );

  text = replaceOnce(
    text,
    nl([
      '  const updated = await getPermission(db, salonId, row.id);',
      "  await insertAttendanceEvent(db, salonId, updated, 'permission_return', actualReturnTime, actor);",
      '  await refreshPayrollEntries(db, salonId, updated.employee_id, updated.date_key);',
    ]),
    nl([
      '  const updated = await getPermission(db, salonId, row.id);',
      '  await syncPermissionBookingBlock(db, salonId, updated, actor);',
      "  await insertAttendanceEvent(db, salonId, updated, 'permission_return', actualReturnTime, actor);",
      '  await refreshPayrollEntries(db, salonId, updated.employee_id, updated.date_key);',
    ]),
    'returned link'
  );

  write(path, text);
}

function patchUnifiedRequestsRepository() {
  const path = 'workers/core/repositories/employee-requests.js';
  let text = read(path);
  text = replaceOnce(
    text,
    nl([
      "  const id = generatedId('permission');",
      '  const now = nowIso();',
    ]),
    nl([
      "  const id = generatedId('permission');",
      '  const bookingLeaveId = "permission_leave_" + id.replace(/[^A-Za-z0-9_-]/g, "_");',
      '  const now = nowIso();',
    ]),
    'unified permission leave id'
  );

  text = replaceOnce(
    text,
    nl([
      "        `permission:${id}:permission_return`, now],",
      '    },',
      '  ]);',
    ]),
    nl([
      "        `permission:${id}:permission_return`, now],",
      '    },',
      '    {',
      '      sql: `INSERT OR IGNORE INTO employee_leaves',
      '        (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status,',
      '         leave_type, start_date, end_date, days_count, employee_note, hr_note, decided_at,',
      '         decided_by_uid, decided_by_email, decided_by_name, created_at, updated_at,',
      '         duration_kind, partial_start_time, partial_end_time, request_id)',
      "       VALUES (?, ?, ?, ?, ?, NULL, 'approved', 'permission', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, ?, ?)`,",
      '      params: [',
      '        bookingLeaveId, salonId, row.employee_id, row.employee_uid, row.employee_name_snapshot,',
      "        payload.date, payload.date, payload.reason, 'استئذان معتمد — يحجب فترة الحجز المحددة فقط',",
      '        now, cleanText(actor.uid) || null, cleanText(actor.email) || null, cleanText(actor.name) || null,',
      '        now, now, payload.startTime, payload.endTime, id,',
      '      ],',
      '    },',
      '  ]);',
    ]),
    'unified permission employee leave'
  );

  text = replaceOnce(
    text,
    nl([
      '    const updated = result.updated;',
      "    if (['request-info', 'request_info'].includes(actionKey) && cleanText(input.note)) {",
    ]),
    nl([
      '    const updated = result.updated;',
      "    if (actionStatus === 'approved' && updated.request_type === 'permission') {",
      '      return transitionEmployeeRequest(',
      '        db,',
      '        salonId,',
      '        updated.id,',
      "        'execute',",
      '        {',
      '          ...input,',
      '          version: updated.version,',
      '          idempotencyKey: input.idempotencyKey',
      '            ? input.idempotencyKey + ":permission_auto_execute"',
      '            : "permission_auto_execute:" + updated.version,',
      '        },',
      '        actor,',
      '        options',
      '      );',
      '    }',
      "    if (['request-info', 'request_info'].includes(actionKey) && cleanText(input.note)) {",
    ]),
    'auto execute unified permission'
  );
  write(path, text);
}

function patchDashboard() {
  const path = 'src/pages/DashboardEmployees.tsx';
  let text = read(path);
  text = replaceOnce(
    text,
    nl([
      'import { CoreHrService } from "../services/CoreHrService";',
      'import { CoreStaffService } from "../services/CoreStaffService";',
    ]),
    nl([
      'import { CoreHrService } from "../services/CoreHrService";',
      'import { reviewPermissionRequest } from "../services/employeePermissionRequests";',
      'import { CoreStaffService } from "../services/CoreStaffService";',
    ]),
    'dashboard permission import'
  );
  text = replaceRequired(text, 'الإجازة الجزئية', 'الاستئذان', 'dashboard wording');
  text = text.replace(
    'note: payload.note || "تسجيل إجازة معتمدة من إدارة الموظفات",',
    'note: payload.note || (isPartialLeave ? "تسجيل استئذان معتمد من إدارة الموظفات" : "تسجيل إجازة معتمدة من إدارة الموظفات"),'
  );
  text = text.replace(
    'employeeNote: payload.note || "تسجيل إجازة معتمدة من إدارة الموظفات",',
    'employeeNote: payload.note || (isPartialLeave ? "تسجيل استئذان معتمد من إدارة الموظفات" : "تسجيل إجازة معتمدة من إدارة الموظفات"),'
  );

  const missing = nl([
    '    if (!leaveRequest) {',
    '      setErrorMsg("لم يتم العثور على طلب إجازة معتمد لهذا اليوم.");',
    '      return;',
    '    }',
  ]);
  const fallback = nl([
    '    if (!leaveRequest) {',
    '      const coreLeaves = await CoreHrService.listLeaves({ employeeId: selectedEmployeeId }).catch(() => []);',
    '      const permissionLeave = coreLeaves.find((leave) => {',
    '        if (cleanText(leave.status).toLowerCase() !== "approved") return false;',
    '        if (cleanText(leave.durationKind).toLowerCase() !== "partial") return false;',
    '        if (cleanText(leave.leaveType).toLowerCase() !== "permission") return false;',
    '        const leaveFrom = normalizeLeaveUntil(leave.startDate);',
    '        const leaveTo = normalizeLeaveUntil(leave.endDate) || leaveFrom;',
    '        return !!leaveFrom && date >= leaveFrom && date <= leaveTo;',
    '      });',
    '      const permissionId = cleanText(permissionLeave?.requestId);',
    '      if (!permissionLeave || !permissionId) {',
    '        setErrorMsg("لم يتم العثور على إجازة أو استئذان معتمد لهذا اليوم.");',
    '        return;',
    '      }',
    '',
    '      const ok = confirm("سيتم إلغاء الاستئذان المعتمد ليوم " + date + ". هل تريد المتابعة؟");',
    '      if (!ok) return;',
    '',
    '      setSaving(true);',
    '      setErrorMsg("");',
    '      try {',
    '        await reviewPermissionRequest({',
    '          requestId: permissionId,',
    '          status: "cancelled",',
    '          reviewerUid: authUser.uid,',
    '          reviewerName: authUser.displayName || authUser.email,',
    '        });',
    '        void writeAuditLog({',
    '          action: "permission_cancelled",',
    '          entityType: "employee_permission_request",',
    '          entityId: permissionId,',
    '          source: "dashboard",',
    '          description: "إلغاء استئذان معتمد من سجل الحضور",',
    '          before: { date, status: "approved", coreLeaveId: permissionLeave.id },',
    '          after: { date, status: "cancelled" },',
    '          meta: { staffId: selectedEmployeeId },',
    '        });',
    '        await Promise.all([load(), loadSelectedEmployeeAttendance({ force: true })]);',
    '      } catch (error) {',
    '        setErrorMsg(toFirestoreErrorMessage(error, "تعذر إلغاء الاستئذان."));',
    '      } finally {',
    '        setSaving(false);',
    '      }',
    '      return;',
    '    }',
  ]);
  text = replaceOnce(text, missing, fallback, 'dashboard permission cancellation');
  write(path, text);
}

function patchTest() {
  const path = 'workers/admin-partial-leave-policy.test.mjs';
  let text = read(path);
  text = replaceOnce(text, '  assert.match(modal, /جزء من اليوم/);', '  assert.match(modal, /استئذان/);', 'test wording');
  write(path, text);
}

patchAttendanceCalendarData();
patchLeaveModal();
patchEmployeeRequestsCopy();
patchLiveAttendance();
patchAttendanceSection();
patchPermissionsRepository();
patchUnifiedRequestsRepository();
patchDashboard();
patchTest();
console.log('[permission-booking-v2] patch applied');
