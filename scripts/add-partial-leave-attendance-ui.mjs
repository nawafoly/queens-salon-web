import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, text) {
  fs.writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`[partial-leave-attendance-ui] ${label}: expected 1 match, found ${count}`);
  return text.replace(before, after);
}

function patchCalendarData() {
  const path = 'src/helpers/hr/attendanceCalendarData.ts';
  let text = read(path);

  text = replaceOnce(
    text,
`  durationKind?: unknown;\n  duration_kind?: unknown;\n  deleted?: unknown;`,
`  durationKind?: unknown;\n  duration_kind?: unknown;\n  partialStartTime?: unknown;\n  partialEndTime?: unknown;\n  partial_start_time?: unknown;\n  partial_end_time?: unknown;\n  deleted?: unknown;`,
    'partial leave request fields'
  );

  text = replaceOnce(
    text,
`export type AttendanceSpecialDayKind = "leave" | "rest" | "weekly_off" | "exception_off";`,
`export type AttendanceSpecialDayKind = "leave" | "partial_leave" | "rest" | "weekly_off" | "exception_off";`,
    'partial special-day kind'
  );

  text = replaceOnce(
    text,
`  sourceId?: string;\n  type?: string;\n};`,
`  sourceId?: string;\n  type?: string;\n  partialStartTime?: string;\n  partialEndTime?: string;\n};`,
    'partial special-day fields'
  );

  text = replaceOnce(
    text,
`const LABEL_LEAVE = "\\u0625\\u062c\\u0627\\u0632\\u0629";\nconst LABEL_REST =`,
`const LABEL_LEAVE = "\\u0625\\u062c\\u0627\\u0632\\u0629";\nconst LABEL_PARTIAL_LEAVE = "\\u0625\\u062c\\u0627\\u0632\\u0629 \\u062c\\u0632\\u0626\\u064a\\u0629";\nconst LABEL_REST =`,
    'partial leave label'
  );

  text = replaceOnce(
    text,
`const SPECIAL_DAY_PRIORITY: Record<AttendanceSpecialDayKind, number> = {\n  leave: 40,\n  rest: 40,\n  exception_off: 30,\n  weekly_off: 20,\n};`,
`const SPECIAL_DAY_PRIORITY: Record<AttendanceSpecialDayKind, number> = {\n  leave: 40,\n  rest: 40,\n  exception_off: 30,\n  weekly_off: 20,\n  partial_leave: 15,\n};`,
    'partial special-day priority'
  );

  const anchor = `  (input.leaveRequests || [])\n    .filter((request) => isApprovedStatus(request.status ?? request.state, false))\n    .filter((request) => !isPartialDay(request.durationKind || request.duration_kind))\n    .filter((request) => leaveRequestMatchesProfile(request, profile, input.extraIds || []))\n    .forEach((request) => {\n      const kind = leaveKindFromSource(request, "leave");\n      if (!kind) return;\n      const range = leaveDateRange(request);\n      addSpecialDateRange(days, range.from, range.to, {\n        kind,\n        label: kind === "rest" ? LABEL_REST : LABEL_LEAVE,\n        source: "leave_request",\n        sourceId: cleanText(request.id),\n        type: cleanText(request.leaveType || request.leave_type || request.type),\n      });\n    });`;

  const replacement = `${anchor}\n\n  // Partial leave is visible in attendance as an informational interval only.\n  // It must never enter approvedLeaveDateKeys or behave like a full-day closure.\n  (input.leaveRequests || [])\n    .filter((request) => isApprovedStatus(request.status ?? request.state, false))\n    .filter((request) => isPartialDay(request.durationKind || request.duration_kind))\n    .filter((request) => leaveRequestMatchesProfile(request, profile, input.extraIds || []))\n    .forEach((request) => {\n      const range = leaveDateRange(request);\n      if (!range.from) return;\n      addSpecialDate(days, {\n        date: range.from,\n        kind: "partial_leave",\n        label: LABEL_PARTIAL_LEAVE,\n        source: "leave_request",\n        sourceId: cleanText(request.id),\n        type: cleanText(request.leaveType || request.leave_type || request.type),\n        partialStartTime: cleanText(request.partialStartTime || request.partial_start_time),\n        partialEndTime: cleanText(request.partialEndTime || request.partial_end_time),\n      });\n    });`;
  text = replaceOnce(text, anchor, replacement, 'partial leave special days');

  text = replaceOnce(
    text,
`  return buildApprovedLeaveSpecialDays(input).map((day) => day.date);`,
`  return buildApprovedLeaveSpecialDays(input)\n    .filter((day) => day.kind !== "partial_leave")\n    .map((day) => day.date);`,
    'exclude partial leave from full-day date keys'
  );

  write(path, text);
}

function patchAttendanceSection() {
  const path = 'src/pages/dashboardEmployees/AttendanceSection.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
`  if (day.kind === "leave" || day.kind === "rest") return 40;\n  if (day.kind === "weekly_off") return 35;\n  if (day.kind === "exception_off") return 30;\n  return 0;`,
`  if (day.kind === "leave" || day.kind === "rest") return 40;\n  if (day.kind === "weekly_off") return 35;\n  if (day.kind === "exception_off") return 30;\n  if (day.kind === "partial_leave") return 20;\n  return 0;`,
    'partial special-day merge priority'
  );

  text = replaceOnce(
    text,
`  if (specialDay) {\n    return {\n      sourceLabel: specialDay.label,\n      sourceDetail: specialDay.source,\n      timeLabel: "\\u0645\\u063a\\u0644\\u0642 \\u0627\\u0644\\u064a\\u0648\\u0645",\n      statusLabel: specialDay.label,\n      tone: "gold",\n    };\n  }`,
`  if (specialDay && specialDay.kind !== "partial_leave") {\n    return {\n      sourceLabel: specialDay.label,\n      sourceDetail: specialDay.source,\n      timeLabel: "\\u0645\\u063a\\u0644\\u0642 \\u0627\\u0644\\u064a\\u0648\\u0645",\n      statusLabel: specialDay.label,\n      tone: "gold",\n    };\n  }`,
    'partial leave must not close selected shift'
  );

  write(path, text);
}

function patchLiveAttendance() {
  const path = 'src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx';
  let text = read(path);

  text = replaceOnce(
    text,
`function attendanceStatusTone(status: string): "default" | "gold" | "success" | "danger" {\n  if (status === "حضور") return "success";\n  if (status === "تأخير" || status === "خروج مبكر" || status === "إجازة" || status === "راحة" || status === "إجازة أسبوعية" || status === "راحة / يوم استثنائي") return "gold";`,
`function attendanceStatusTone(status: string): "default" | "gold" | "success" | "danger" {\n  if (status === "حضور") return "success";\n  if (status.startsWith("إجازة جزئية")) return "gold";\n  if (status === "تأخير" || status === "خروج مبكر" || status === "إجازة" || status === "راحة" || status === "إجازة أسبوعية" || status === "راحة / يوم استثنائي") return "gold";`,
    'partial status tone'
  );

  text = replaceOnce(
    text,
`  if (status === "إجازة") return "إجازة معتمدة";\n  if (status === "حضور") return "مكتمل ومطابق";`,
`  if (status.startsWith("إجازة جزئية")) return "إجازة جزئية معتمدة — الفترة فقط محجوبة";\n  if (status === "إجازة") return "إجازة معتمدة";\n  if (status === "حضور") return "مكتمل ومطابق";`,
    'partial review text'
  );

  text = replaceOnce(
    text,
`                    {day.specialDay && day.specialDay.label !== day.status ? (\n                      <em className="dsv2-ew-calendar__special">{day.specialDay.label}</em>\n                    ) : null}\n                    <small>{day.timeLabel}</small>`,
`                    {day.specialDay?.kind === "partial_leave" ? (\n                      <em className="dsv2-ew-calendar__special">\n                        {[day.specialDay.partialStartTime, day.specialDay.partialEndTime].filter(Boolean).join(" – ") || "جزء من اليوم"}\n                      </em>\n                    ) : day.specialDay && day.specialDay.label !== day.status ? (\n                      <em className="dsv2-ew-calendar__special">{day.specialDay.label}</em>\n                    ) : null}\n                    <small>{day.timeLabel}</small>`,
    'partial interval rendering'
  );

  write(path, text);
}

function patchCss() {
  const path = 'src/styles/dashboard-v2/pages/employee-workspace.css';
  let text = read(path);
  text = replaceOnce(
    text,
`.dashboard-v2 .dsv2-employee-workspace .dsv2-ew-attendance-month-grid .dsv2-ew-calendar__day[data-special="rest"],\n.dashboard-v2 .dsv2-employee-workspace .dsv2-ew-attendance-month-grid .dsv2-ew-calendar__day[data-special="weekly_off"],`,
`.dashboard-v2 .dsv2-employee-workspace .dsv2-ew-attendance-month-grid .dsv2-ew-calendar__day[data-special="partial_leave"],\n.dashboard-v2 .dsv2-employee-workspace .dsv2-ew-attendance-month-grid .dsv2-ew-calendar__day[data-special="rest"],\n.dashboard-v2 .dsv2-employee-workspace .dsv2-ew-attendance-month-grid .dsv2-ew-calendar__day[data-special="weekly_off"],`,
    'partial calendar gold styling'
  );
  write(path, text);
}

patchCalendarData();
patchAttendanceSection();
patchLiveAttendance();
patchCss();
console.log('[partial-leave-attendance-ui] patch applied');
