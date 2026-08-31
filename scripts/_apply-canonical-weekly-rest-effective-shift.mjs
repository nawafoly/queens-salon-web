import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";

const BRANCH = "fix/canonical-weekly-rest-effective-shift";
const EXPECTED_BASE = "dea300db75659be1a96a1fbc13c197214a3d0845";
const SELF = "scripts/_apply-canonical-weekly-rest-effective-shift.mjs";
const TARGETS = [
  "workers/core/repositories/shift-control.js",
  "workers/core/repositories/rest-holiday-compliance.js",
  "workers/attendance-worker.js",
  "workers/core/repositories/booking-staff-policy.js",
  "src/pages/dashboardEmployees/AttendanceSection.tsx",
  "src/helpers/hr/attendanceCalendarData.ts",
  "src/helpers/hr/attendanceShiftResolver.ts",
  "src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx",
  "workers/malikat-core-scheduling-contract.test.mjs",
];

function run(command, args = [], options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  return execFileSync(command, args, {
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    ...options,
  });
}

function capture(command, args = []) {
  return String(run(command, args, { capture: true }) || "").trim();
}

function fail(message) {
  throw new Error(message);
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) fail(`anchor not found: ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) {
    fail(`anchor is not unique: ${label}`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function replaceRange(text, startMarker, endMarker, replacement, label) {
  const start = text.indexOf(startMarker);
  if (start < 0) fail(`range start not found: ${label}`);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (end < 0) fail(`range end not found: ${label}`);
  return text.slice(0, start) + replacement + text.slice(end);
}

function edit(path, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) fail(`no change produced for ${path}`);
  writeFileSync(path, after, "utf8");
  console.log(`patched ${path}`);
}

function restoreTargets() {
  try {
    run("git", ["restore", "--", ...TARGETS]);
  } catch {}
}

try {
  const branch = capture("git", ["branch", "--show-current"]);
  if (branch !== BRANCH) fail(`wrong branch: ${branch || "(detached)"}; expected ${BRANCH}`);

  const dirty = capture("git", ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty) fail(`tracked working tree is not clean before patch:\n${dirty}`);

  const mainSha = capture("git", ["rev-parse", "origin/main"]);
  if (mainSha !== EXPECTED_BASE) {
    fail(`origin/main moved: ${mainSha}; expected ${EXPECTED_BASE}`);
  }

  const netFiles = capture("git", ["diff", "--name-only", `${EXPECTED_BASE}...HEAD`])
    .split(/\r?\n/)
    .filter(Boolean);
  if (netFiles.length !== 1 || netFiles[0] !== SELF) {
    fail(`unexpected branch pre-patch diff: ${netFiles.join(", ") || "(none)"}`);
  }

  edit("workers/core/repositories/shift-control.js", (text) => {
    text = replaceOnce(
      text,
      "export async function resolveEmployeeShift(db, salonId, employeeIdValue, dateValue) {",
      "async function resolveEmployeeBaseShift(db, salonId, employeeIdValue, dateValue) {",
      "rename base shift resolver"
    );

    const wrapper = String.raw`

async function activeWeeklyRestWorkAssignmentForShift(
  db,
  salonId,
  employeeId,
  date
) {
  if (
    db?.__fakeD1 &&
    typeof db.rows === 'function'
  ) {
    try {
      return (
        db.rows(
          'employee_weekly_rest_work_assignments'
        )
          .filter(
            (row) =>
              row.salon_id === salonId &&
              cleanText(row.employee_id) === employeeId &&
              cleanText(row.rest_date) === date &&
              cleanText(row.status).toLowerCase() === 'assigned'
          )
          .slice()
          .sort(
            (left, right) =>
              cleanText(right.created_at).localeCompare(
                cleanText(left.created_at)
              )
          )[0] || null
      );
    } catch {
      return null;
    }
  }

  return dbFirst(
    db,
    'SELECT * FROM employee_weekly_rest_work_assignments ' +
      'WHERE salon_id=? AND employee_id=? AND rest_date=? AND status=\'assigned\' ' +
      'ORDER BY created_at DESC LIMIT 1',
    [salonId, employeeId, date]
  );
}

function weeklyRestWorkAssignmentResolvedShift(
  assignment,
  baseShift,
  date
) {
  if (!assignment) return baseShift;

  return {
    ...(baseShift || {}),
    source: 'weekly_rest_work_assignment',
    source_id: cleanText(assignment.id) || null,
    id: cleanText(assignment.id) || null,
    assignment_id: cleanText(assignment.id) || null,
    weekly_rest_work_assignment_id:
      cleanText(assignment.id) || null,
    employee_id:
      cleanText(assignment.employee_id) ||
      cleanText(baseShift?.employee_id) ||
      null,
    date,
    active: 1,
    operational: baseShift?.operational ?? true,
    exception_type: 'work',
    shift_name: 'عمل استثنائي في يوم الراحة',
    start_time: cleanText(assignment.start_time) || null,
    end_time: cleanText(assignment.end_time) || null,
    template_start_time:
      cleanText(assignment.start_time) || null,
    template_end_time:
      cleanText(assignment.end_time) || null,
    late_grace_minutes:
      Number(baseShift?.late_grace_minutes || 0),
    early_leave_grace_minutes: 0,
    attendance_lock_enabled:
      Number(assignment.attendance_lock_enabled || 0),
    attendance_lock_after_minutes:
      Number(assignment.attendance_lock_after_minutes || 0),
    break_minutes:
      Number(baseShift?.break_minutes || 0),
    overtime_after_minutes:
      Number(baseShift?.overtime_after_minutes || 0),
    reason:
      cleanText(assignment.reason) || null,
    schedule_snapshot_json:
      assignment.schedule_snapshot_json || null,
    weekly_rest_origin_is_explicit: 1,
    weekly_rest_base_source:
      cleanText(baseShift?.source) || null,
    weekly_rest_base_exception_type:
      cleanText(
        baseShift?.exception_type ||
        baseShift?.exceptionType
      ) || null,
    weekly_rest_base_active:
      baseShift?.active ?? null,
    weekly_rest_base_note:
      cleanText(baseShift?.note) || null,
  };
}

export async function resolveEmployeeShift(
  db,
  salonId,
  employeeIdValue,
  dateValue
) {
  const employeeId =
    requiredId(
      employeeIdValue,
      'employeeId'
    );
  const date =
    dateKey(
      dateValue,
      'date'
    );

  const baseShift =
    await resolveEmployeeBaseShift(
      db,
      salonId,
      employeeId,
      date
    );

  if (baseShift?.operational === false) {
    return baseShift;
  }

  const weeklyRestWorkAssignment =
    await activeWeeklyRestWorkAssignmentForShift(
      db,
      salonId,
      employeeId,
      date
    );

  return weeklyRestWorkAssignmentResolvedShift(
    weeklyRestWorkAssignment,
    baseShift,
    date
  );
}
`;

    text = replaceOnce(
      text,
      "\n\nfunction rowsByEmployeeId(rows) {",
      wrapper + "\n\nfunction rowsByEmployeeId(rows) {",
      "insert canonical weekly-rest overlay"
    );

    text = replaceOnce(
      text,
      "  const [\n    exceptions,\n    weeklySchedules,\n    assignments,\n    employmentRows,\n  ] =",
      "  const [\n    exceptions,\n    weeklySchedules,\n    assignments,\n    weeklyRestWorkAssignments,\n    employmentRows,\n  ] =",
      "batch result destructuring"
    );

    const employmentQueryMarker = "      dbAll(\n        db,\n        `SELECT employee_id,";
    const weeklyRestBatchQuery = String.raw`      dbAll(
        db,
        'SELECT * FROM employee_weekly_rest_work_assignments ' +
          'WHERE salon_id=? AND employee_id IN (' + marks + ') ' +
          'AND rest_date>=? AND rest_date<=? AND status=\'assigned\' ' +
          'ORDER BY employee_id, rest_date, created_at DESC',
        [
          salonId,
          ...employeeIds,
          dateFrom,
          dateTo,
        ]
      ),

`;
    text = replaceOnce(
      text,
      employmentQueryMarker,
      weeklyRestBatchQuery + employmentQueryMarker,
      "batch weekly-rest assignment query"
    );

    const assignmentGrouping = String.raw`  const assignmentByEmployee =
    rowsByEmployeeId(
      assignments
    );
`;
    text = replaceOnce(
      text,
      assignmentGrouping,
      assignmentGrouping + String.raw`  const weeklyRestWorkByEmployee =
    rowsByEmployeeId(
      weeklyRestWorkAssignments
    );
`,
      "batch weekly-rest grouping"
    );

    const assignmentRowsBlock = String.raw`    const assignmentRows =
      assignmentByEmployee.get(
        employeeId
      ) ||
      [];
`;
    text = replaceOnce(
      text,
      assignmentRowsBlock,
      assignmentRowsBlock + String.raw`
    const weeklyRestWorkRows =
      weeklyRestWorkByEmployee.get(
        employeeId
      ) ||
      [];
`,
      "batch weekly-rest rows"
    );

    const oldPush = String.raw`      rows.push(
        resolveEmployeeShiftFromBatchFacts(
          employeeId,
          date,
          exceptionRows,
          weeklyRows,
          assignmentRows
        )
      );`;
    const newPush = String.raw`      const baseShift =
        resolveEmployeeShiftFromBatchFacts(
          employeeId,
          date,
          exceptionRows,
          weeklyRows,
          assignmentRows
        );

      const weeklyRestWorkAssignment =
        weeklyRestWorkRows.find(
          (row) =>
            cleanText(row.rest_date) === date &&
            cleanText(row.status).toLowerCase() === 'assigned'
        ) || null;

      rows.push(
        weeklyRestWorkAssignmentResolvedShift(
          weeklyRestWorkAssignment,
          baseShift,
          date
        )
      );`;
    text = replaceOnce(
      text,
      oldPush,
      newPush,
      "batch effective-shift overlay"
    );

    return text;
  });

  edit("workers/core/repositories/rest-holiday-compliance.js", (text) => {
    const marker = String.raw`  if (
    source === 'exception' &&
    exceptionType === 'off'
  ) {`;
    const replacement = String.raw`  if (
    source === 'weekly_rest_work_assignment'
  ) {
    return Number(
      shift?.weekly_rest_origin_is_explicit || 0
    ) === 1;
  }

` + marker;
    return replaceOnce(
      text,
      marker,
      replacement,
      "weekly-rest assignment retains statutory origin"
    );
  });

  edit("workers/attendance-worker.js", (text) => {
    text = replaceOnce(
      text,
      String.raw`import {
  resolveAttendanceWorkAuthorization,
  weeklyRestAssignmentAsShift,
} from "./core/repositories/leave-rest-workflows.js";`,
      String.raw`import {
  resolveAttendanceWorkAuthorization,
} from "./core/repositories/leave-rest-workflows.js";`,
      "attendance import"
    );

    const block = String.raw`  if (authorization?.weeklyRestAssignment) {
    const shift = weeklyRestAssignmentAsShift(authorization.weeklyRestAssignment);
    return {
      ...evaluateCheckInWindow({ type, now, shift }),
      coreEmployeeId,
      shift,
      weeklyRestWorkAssignment: authorization.weeklyRestAssignment,
      dateKey: clock.dateKey,
    };
  }

`;
    text = replaceOnce(
      text,
      block,
      "",
      "remove attendance second scheduling decision"
    );
    return text;
  });

  edit("workers/core/repositories/booking-staff-policy.js", (text) => {
    text = replaceOnce(
      text,
      String.raw`import {
  activeWeeklyRestWorkAssignment,
} from './leave-rest-workflows.js';

`,
      "",
      "remove booking weekly-rest import"
    );

    text = replaceRange(
      text,
      "function weeklyRestAssignmentShift(assignment) {",
      "async function approvedLeavesForDate",
      "",
      "remove booking local weekly-rest shift adapter"
    );

    const single = String.raw`export async function resolveStaffBookingDay(
  db,
  salonId,
  staff,
  dateValue,
  startTime = "",
  endTime = ""
) {
  const employeeId =
    cleanText(
      staff?.id
    );

  const date =
    cleanText(
      dateValue
    );

  if (
    !employeeId ||
    !date ||
    !staffIsActiveForBooking(
      staff
    )
  ) {
    return resolveStaffBookingDayFromFacts(
      staff,
      date,
      [],
      null,
      null,
      startTime,
      endTime
    );
  }

  const leaves =
    await approvedLeavesForDate(
      db,
      salonId,
      employeeId,
      date
    );

  if (
    leaves.some(
      (row) =>
        !isPartialLeave(row)
    )
  ) {
    return resolveStaffBookingDayFromFacts(
      staff,
      date,
      leaves,
      null,
      null,
      startTime,
      endTime
    );
  }

  const absence =
    await absenceForDate(
      db,
      salonId,
      employeeId,
      date
    );

  if (absence) {
    return resolveStaffBookingDayFromFacts(
      staff,
      date,
      leaves,
      absence,
      null,
      startTime,
      endTime
    );
  }

  const shift =
    await resolveEmployeeShift(
      db,
      salonId,
      employeeId,
      date
    ).catch(
      () => null
    );

  return resolveStaffBookingDayFromFacts(
    staff,
    date,
    leaves,
    absence,
    shift,
    startTime,
    endTime
  );
}

`;
    text = replaceRange(
      text,
      "export async function resolveStaffBookingDay(\n",
      "export async function resolveStaffBookingDaysBatch(\n",
      single,
      "replace single booking resolver"
    );

    const batch = String.raw`export async function resolveStaffBookingDaysBatch(
  db,
  salonId,
  staffRows,
  dateValue
) {
  const date =
    cleanText(
      dateValue
    );

  const staff =
    (Array.isArray(staffRows)
      ? staffRows
      : []
    ).filter(
      (row) =>
        cleanText(row?.id)
    );

  if (!staff.length) {
    return [];
  }

  const employeeIds =
    Array.from(
      new Set(
        staff.map(
          (row) =>
            cleanText(row.id)
        )
      )
    );

  let leaves;
  let absences;

  if (db?.__fakeD1) {
    const wanted =
      new Set(
        employeeIds
      );

    const recalledLeaveIds =
      activeRecallIdsForDateFake(
        db,
        salonId,
        date
      );

    leaves =
      safeFakeRows(
        db,
        "employee_leaves"
      ).filter(
        (row) =>
          row.salon_id === salonId &&
          wanted.has(
            cleanText(row.employee_id)
          ) &&
          cleanText(row.status).toLowerCase() === "approved" &&
          cleanText(row.start_date) <= date &&
          cleanText(row.end_date) >= date &&
          !recalledLeaveIds.has(
            cleanText(row.id)
          )
      );

    absences =
      safeFakeRows(
        db,
        "employee_absences"
      ).filter(
        (row) =>
          row.salon_id === salonId &&
          wanted.has(
            cleanText(row.employee_id)
          ) &&
          cleanText(row.date_key) === date
      );
  } else {
    const marks =
      placeholders(
        employeeIds.length
      );

    [leaves, absences] =
      await Promise.all([
        dbAll(
          db,
          'SELECT leave.* FROM employee_leaves leave ' +
            'WHERE leave.salon_id = ? ' +
            'AND leave.employee_id IN (' + marks + ') ' +
            'AND LOWER(leave.status) = \'approved\' ' +
            'AND leave.start_date <= ? AND leave.end_date >= ? ' +
            'AND NOT EXISTS (' +
              'SELECT 1 FROM employee_leave_recalls recall ' +
              'WHERE recall.salon_id = leave.salon_id ' +
              'AND recall.leave_id = leave.id ' +
              'AND recall.recall_date = ? ' +
              'AND recall.status = \'active\'' +
            ') ORDER BY leave.employee_id, leave.start_date DESC',
          [
            salonId,
            ...employeeIds,
            date,
            date,
            date,
          ]
        ),
        dbAll(
          db,
          'SELECT * FROM employee_absences ' +
            'WHERE salon_id = ? ' +
            'AND employee_id IN (' + marks + ') ' +
            'AND date_key = ? ' +
            'ORDER BY employee_id, created_at DESC',
          [
            salonId,
            ...employeeIds,
            date,
          ]
        ),
      ]);
  }

  const shiftBatch =
    await resolveEmployeeShiftsBatch(
      db,
      salonId,
      {
        employeeIds,
        dateFrom: date,
        dateTo: date,
      }
    );

  const leavesByEmployee =
    new Map();

  for (const row of leaves) {
    const employeeId =
      cleanText(
        row.employee_id
      );
    const current =
      leavesByEmployee.get(
        employeeId
      ) || [];
    current.push(row);
    leavesByEmployee.set(
      employeeId,
      current
    );
  }

  const absenceByEmployee =
    new Map();

  for (const row of absences) {
    const employeeId =
      cleanText(
        row.employee_id
      );
    if (
      employeeId &&
      !absenceByEmployee.has(
        employeeId
      )
    ) {
      absenceByEmployee.set(
        employeeId,
        row
      );
    }
  }

  const shiftByEmployee =
    new Map(
      (Array.isArray(
        shiftBatch?.rows
      )
        ? shiftBatch.rows
        : []
      )
        .map(
          (row) => [
            cleanText(row?.employee_id),
            row,
          ]
        )
        .filter(
          ([employeeId]) =>
            employeeId
        )
    );

  return staff.map(
    (row) => {
      const employeeId =
        cleanText(
          row.id
        );

      return {
        employeeId,
        day:
          resolveStaffBookingDayFromFacts(
            row,
            date,
            leavesByEmployee.get(
              employeeId
            ) || [],
            absenceByEmployee.get(
              employeeId
            ) || null,
            shiftByEmployee.get(
              employeeId
            ) || null
          ),
      };
    }
  );
}

`;
    text = replaceRange(
      text,
      "export async function resolveStaffBookingDaysBatch(\n",
      "export async function staffCanPerformService",
      batch,
      "replace batch booking resolver"
    );

    return text;
  });

  edit("src/helpers/hr/attendanceCalendarData.ts", (text) => {
    text = replaceOnce(
      text,
      String.raw`export type AttendanceSpecialDayKind =
  | "leave"
  | "partial_leave"
  | "rest"
  | "weekly_off"
  | "exception_off";`,
      String.raw`export type AttendanceSpecialDayKind =
  | "leave"
  | "partial_leave"
  | "rest"
  | "weekly_off"
  | "weekly_rest_work"
  | "exception_off";`,
      "attendance special-day type"
    );

    text = replaceOnce(
      text,
      String.raw`const SPECIAL_DAY_PRIORITY: Record<AttendanceSpecialDayKind, number> = {
  leave: 40,
  rest: 40,
  exception_off: 30,
  weekly_off: 20,
  partial_leave: 15,
};`,
      String.raw`const SPECIAL_DAY_PRIORITY: Record<AttendanceSpecialDayKind, number> = {
  leave: 40,
  rest: 40,
  weekly_rest_work: 38,
  exception_off: 30,
  weekly_off: 20,
  partial_leave: 15,
};`,
      "attendance special-day priority"
    );
    return text;
  });

  edit("src/helpers/hr/attendanceShiftResolver.ts", (text) => {
    return replaceOnce(
      text,
      String.raw`  if (source === "none") return "Core: لا يوجد شفت";
  if (source === "exception") {`,
      String.raw`  if (source === "none") return "Core: لا يوجد شفت";
  if (source === "weekly_rest_work_assignment") {
    return "عمل استثنائي في يوم الراحة";
  }
  if (source === "exception") {`,
      "attendance effective-shift source label"
    );
  });

  edit("src/pages/dashboardEmployees/AttendanceSection.tsx", (text) => {
    text = replaceOnce(
      text,
      String.raw`const LABEL_EXCEPTION_OFF = "\u0631\u0627\u062d\u0629 / \u064a\u0648\u0645 \u0627\u0633\u062a\u062b\u0646\u0627\u0626\u064a";`,
      String.raw`const LABEL_WEEKLY_OFF = "راحة أسبوعية";
const LABEL_TEMP_WEEKLY_OFF = "راحة أسبوعية مؤقتة";
const LABEL_EXCEPTION_OFF = "يوم راحة استثنائي";
const LABEL_WEEKLY_REST_WORK = "عمل استثنائي في يوم الراحة";
const TEMP_WEEKLY_OFF_MARKER = "[temp_weekly_off:";`,
      "attendance labels"
    );

    text = replaceOnce(
      text,
      String.raw`  if (source === "exception" && exceptionType === "off") return 5;
  if (source === "exception") return 4;`,
      String.raw`  if (source === "weekly_rest_work_assignment") return 6;
  if (source === "exception" && exceptionType === "off") return 5;
  if (source === "exception") return 4;`,
      "effective shift ranking"
    );

    const oldOffHelper = String.raw`function isResolvedShiftOff(value?: Record<string, unknown> | CoreResolvedShift | null) {
  const row = value || {};
  return cleanText((row as Record<string, unknown>).exceptionType || (row as Record<string, unknown>).exception_type).toLowerCase() === "off";
}

`;
    const newOffHelper = oldOffHelper + String.raw`function resolvedShiftSpecialDay(
  date: string,
  shift?: CoreResolvedShift | null
): AttendanceSpecialDay | null {
  const row = (shift || {}) as Record<string, unknown>;
  const source = cleanText(row.source).toLowerCase();
  const sourceId = cleanText(
    row.weeklyRestWorkAssignmentId ||
    row.weekly_rest_work_assignment_id ||
    row.assignmentId ||
    row.assignment_id ||
    row.sourceId ||
    row.source_id ||
    row.id
  );

  if (source === "weekly_rest_work_assignment") {
    return {
      date,
      kind: "weekly_rest_work",
      label: LABEL_WEEKLY_REST_WORK,
      source: "تكليف يوم الراحة",
      sourceId,
    };
  }

  if (!isResolvedShiftOff(shift)) return null;

  if (source === "weekly_schedule") {
    return {
      date,
      kind: "weekly_off",
      label: LABEL_WEEKLY_OFF,
      source: "جدول الدوام الأسبوعي",
      sourceId,
    };
  }

  if (
    source === "exception" &&
    cleanText(row.note)
      .toLowerCase()
      .startsWith(TEMP_WEEKLY_OFF_MARKER)
  ) {
    return {
      date,
      kind: "weekly_off",
      label: LABEL_TEMP_WEEKLY_OFF,
      source: "نقل مؤقت للراحة الأسبوعية",
      sourceId,
    };
  }

  return {
    date,
    kind: "exception_off",
    label: LABEL_EXCEPTION_OFF,
    source: "استثناء يومي معتمد",
    sourceId,
  };
}

`;
    text = replaceOnce(
      text,
      oldOffHelper,
      newOffHelper,
      "resolved shift special-day classification"
    );

    text = replaceOnce(
      text,
      String.raw`  if (day.kind === "leave" || day.kind === "rest") return 40;
  if (day.kind === "weekly_off") return 35;`,
      String.raw`  if (day.kind === "leave" || day.kind === "rest") return 40;
  if (day.kind === "weekly_rest_work") return 38;
  if (day.kind === "weekly_off") return 35;`,
      "special-day local priority"
    );

    text = replaceOnce(
      text,
      String.raw`  const shiftName = cleanText(resolvedShift.shiftName || resolvedShift.shift_name);
  if (source === "exception") {`,
      String.raw`  const shiftName = cleanText(resolvedShift.shiftName || resolvedShift.shift_name);
  if (source === "weekly_rest_work_assignment") {
    return {
      sourceLabel: "تكليف يوم الراحة",
      sourceDetail: LABEL_WEEKLY_REST_WORK,
      timeLabel: windowLabel(startTime, endTime),
      statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
      tone: "gold",
    };
  }
  if (source === "exception") {`,
      "weekly-rest work selected-shift info"
    );

    text = replaceOnce(
      text,
      String.raw`    specialDay &&
    specialDay.kind !== "partial_leave"`,
      String.raw`    specialDay &&
    specialDay.kind !== "partial_leave" &&
    specialDay.kind !== "weekly_rest_work"`,
      "work assignment is not a closed special day"
    );

    const oldSpecialDays = String.raw`  const resolvedCoreSpecialDays = useMemo<AttendanceSpecialDay[]>(() => {
    return Object.entries(coreResolvedShiftsByDate).flatMap(([date, shift]) => {
      if (!date || !isResolvedShiftOff(shift)) return [];
      return [{
        date,
        kind: "exception_off" as const,
        label: LABEL_EXCEPTION_OFF,
        source: "core_exception_off",
      }];
    });
  }, [coreResolvedShiftsByDate]);`;
    const newSpecialDays = String.raw`  const resolvedCoreSpecialDays = useMemo<AttendanceSpecialDay[]>(() => {
    return Object.entries(coreResolvedShiftsByDate).flatMap(([date, shift]) => {
      if (!date) return [];
      const specialDay = resolvedShiftSpecialDay(date, shift);
      return specialDay ? [specialDay] : [];
    });
  }, [coreResolvedShiftsByDate]);`;
    text = replaceOnce(
      text,
      oldSpecialDays,
      newSpecialDays,
      "attendance calendar canonical labels"
    );

    return text;
  });

  edit("src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx", (text) => {
    text = replaceOnce(
      text,
      String.raw`status === "إجازة أسبوعية" || status === "راحة / يوم استثنائي"`,
      String.raw`status === "إجازة أسبوعية" || status === "راحة أسبوعية" || status === "راحة أسبوعية مؤقتة" || status === "يوم راحة استثنائي" || status === "عمل استثنائي في يوم الراحة" || status === "راحة / يوم استثنائي"`,
      "attendance status tones"
    );

    text = replaceOnce(
      text,
      String.raw`  if (status === "إجازة أسبوعية") return "إجازة أسبوعية حسب الجدول";
  if (status === "راحة / يوم استثنائي") return "راحة بسبب استثناء اليوم";`,
      String.raw`  if (status === "إجازة أسبوعية") return "إجازة أسبوعية حسب الجدول";
  if (status === "راحة أسبوعية") return "راحة أسبوعية حسب جدول الدوام";
  if (status === "راحة أسبوعية مؤقتة") return "راحة أسبوعية منقولة مؤقتًا لهذا اليوم";
  if (status === "يوم راحة استثنائي") return "يوم مغلق باستثناء معتمد";
  if (status === "عمل استثنائي في يوم الراحة") return "تكليف عمل مع إبقاء أصل اليوم راحة أسبوعية";
  if (status === "راحة / يوم استثنائي") return "راحة بسبب استثناء اليوم";`,
      "attendance review labels"
    );

    text = replaceOnce(
      text,
      String.raw`      const status =
        specialDay?.label ||
        (
          hasLeave
            ? "\u0625\u062c\u0627\u0632\u0629"
            : hasAbsence
              ? "\u063a\u064a\u0627\u0628"
              : rowStatus ||
                "?"
        );`,
      String.raw`      const status =
        specialDay?.kind === "weekly_rest_work" && rowStatus
          ? rowStatus
          : specialDay?.label ||
            (
              hasLeave
                ? "\u0625\u062c\u0627\u0632\u0629"
                : hasAbsence
                  ? "\u063a\u064a\u0627\u0628"
                  : rowStatus ||
                    "?"
            );`,
      "work-assignment calendar status"
    );

    return text;
  });

  edit("workers/malikat-core-scheduling-contract.test.mjs", (text) => {
    const testBlock = String.raw`

test("weekly-rest work uses the one canonical effective-shift resolver", () => {
  const shiftCore = read("workers/core/repositories/shift-control.js");
  const attendanceWorker = read("workers/attendance-worker.js");
  const bookingPolicy = read("workers/core/repositories/booking-staff-policy.js");
  const restCompliance = read("workers/core/repositories/rest-holiday-compliance.js");
  const attendanceUi = read("src/pages/dashboardEmployees/AttendanceSection.tsx");
  const attendanceCalendar = read("src/helpers/hr/attendanceCalendarData.ts");
  const attendanceShiftResolver = read("src/helpers/hr/attendanceShiftResolver.ts");

  assert.match(
    shiftCore,
    /employee_weekly_rest_work_assignments/,
    "Canonical Core shift resolver must load weekly-rest work assignments"
  );
  assert.match(
    shiftCore,
    /source:\s*['"]weekly_rest_work_assignment['"]/,
    "Canonical Core shift resolver must expose the weekly-rest work overlay"
  );
  assert.match(
    restCompliance,
    /source === ['"]weekly_rest_work_assignment['"]/,
    "Weekly-rest compliance must preserve the original statutory rest fact"
  );

  assert.equal(
    attendanceWorker.includes("weeklyRestAssignmentAsShift"),
    false,
    "Attendance must not own a second weekly-rest scheduling decision"
  );
  assert.equal(
    bookingPolicy.includes("activeWeeklyRestWorkAssignment"),
    false,
    "Booking must not read weekly-rest work assignments outside the canonical resolver"
  );
  assert.equal(
    bookingPolicy.includes("weeklyRestAssignmentShift"),
    false,
    "Booking must not reconstruct a weekly-rest work shift locally"
  );

  for (const label of [
    "راحة أسبوعية",
    "راحة أسبوعية مؤقتة",
    "يوم راحة استثنائي",
    "عمل استثنائي في يوم الراحة",
  ]) {
    assert.equal(
      attendanceUi.includes(label),
      true,
      `Attendance must expose canonical label: ${label}`
    );
  }

  assert.equal(
    attendanceUi.includes("راحة / يوم استثنائي"),
    false,
    "Attendance must not merge weekly rest and generic exception into one label"
  );
  assert.equal(
    attendanceCalendar.includes('"weekly_rest_work"'),
    true,
    "Attendance calendar must model weekly-rest work as a distinct operational day"
  );
  assert.equal(
    attendanceShiftResolver.includes('source === "weekly_rest_work_assignment"'),
    true,
    "Attendance shift labels must understand the canonical weekly-rest work source"
  );
});
`;

    if (text.includes('test("weekly-rest work uses the one canonical effective-shift resolver"')) {
      fail("contract test already exists unexpectedly");
    }
    return text.trimEnd() + testBlock + "\n";
  });

  run("node", [
    "--test",
    "workers/malikat-core-scheduling-contract.test.mjs",
    "workers/leave-rest-workflows-policy.test.mjs",
    "workers/leave-rest-booking-policy.test.mjs",
    "workers/shift-attendance-policy.test.mjs",
  ]);
  run("npm", ["run", "build"]);
  run("git", ["diff", "--check"]);

  unlinkSync(SELF);
  run("git", ["add", "-A"]);
  run("git", ["diff", "--cached", "--check"]);

  const staged = capture("git", ["diff", "--cached", "--name-only"])
    .split(/\r?\n/)
    .filter(Boolean);
  const expected = [...TARGETS].sort();
  const actual = [...staged].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`unexpected staged files:\n${actual.join("\n")}`);
  }

  run("git", ["commit", "-m", "fix: unify weekly-rest effective shift"]);
  run("git", ["push", "origin", BRANCH]);

  const head = capture("git", ["rev-parse", "HEAD"]);
  console.log("\n✅ PATCH_TEST_BUILD_PUSH_PASS");
  console.log(`HEAD=${head}`);
} catch (error) {
  console.error("\n❌ PATCH_STOP");
  console.error(error?.stack || error);
  restoreTargets();
  process.exitCode = 1;
}
