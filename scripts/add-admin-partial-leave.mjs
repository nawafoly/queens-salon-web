import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, text) {
  fs.writeFileSync(path, `${text.replace(/\s+$/g, '')}\n`, 'utf8');
}

function replaceOnce(text, oldText, newText, label) {
  if (text.includes(newText)) return text;
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`[partial-leave] ${label}: expected 1 match, found ${count}`);
  return text.replace(oldText, newText);
}

function patchModal() {
  const path = 'src/components/LeaveRequestModal.tsx';
  let text = read(path);

  text = replaceOnce(text,
`    days: number;\n    deductFromBalance: boolean;`,
`    days: number;\n    durationKind: "full_day" | "partial";\n    partialStartTime: string;\n    partialEndTime: string;\n    deductFromBalance: boolean;`,
'expand modal submit payload');

  text = replaceOnce(text,
`  const [toDate, setToDate] = useState(initialDate || "");\n  const [note, setNote] = useState("");`,
`  const [toDate, setToDate] = useState(initialDate || "");\n  const [durationKind, setDurationKind] = useState<"full_day" | "partial">("full_day");\n  const [partialStartTime, setPartialStartTime] = useState("18:00");\n  const [partialEndTime, setPartialEndTime] = useState("20:00");\n  const [note, setNote] = useState("");`,
'add modal duration state');

  text = replaceOnce(text,
`  const isOtherLeaveType = type === "other";\n  const selectedTypeLabel = LEAVE_TYPE_LABELS[type] || "غير محدد";`,
`  const isOtherLeaveType = type === "other";\n  const isPartialLeave = durationKind === "partial";\n  const selectedTypeLabel = LEAVE_TYPE_LABELS[type] || "غير محدد";`,
'add partial derived state');

  text = replaceOnce(text,
`    setFromDate(initialDate || "");\n    setToDate(initialDate || "");\n    setNote("");`,
`    setFromDate(initialDate || "");\n    setToDate(initialDate || "");\n    setDurationKind("full_day");\n    setPartialStartTime("18:00");\n    setPartialEndTime("20:00");\n    setNote("");`,
'reset partial state');

  text = replaceOnce(text,
`  useEffect(() => {\n    if (isOtherLeaveType) {\n      setDeductFromBalance(false);\n      setAffectsPayroll(false);\n      return;\n    }\n    const policy = LEAVE_TYPE_POLICY[type] || { deductFromBalance: false, affectsPayroll: false };\n    setDeductFromBalance(policy.deductFromBalance);\n    setAffectsPayroll(policy.affectsPayroll);\n  }, [type, isOtherLeaveType]);`,
`  useEffect(() => {\n    if (isPartialLeave || isOtherLeaveType) {\n      setDeductFromBalance(false);\n      setAffectsPayroll(false);\n      return;\n    }\n    const policy = LEAVE_TYPE_POLICY[type] || { deductFromBalance: false, affectsPayroll: false };\n    setDeductFromBalance(policy.deductFromBalance);\n    setAffectsPayroll(policy.affectsPayroll);\n  }, [type, isOtherLeaveType, isPartialLeave]);`,
'partial leave policy');

  text = replaceOnce(text,
`  const days = useMemo(() => {\n    if (!fromDate || !toDate) return 0;\n    try {\n      const f = new Date(\`${'${fromDate}'}T00:00:00\`);\n      const t = new Date(\`${'${toDate}'}T00:00:00\`);\n      const diff = Math.floor((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)) + 1;\n      return diff > 0 ? diff : 0;\n    } catch {\n      return 0;\n    }\n  }, [fromDate, toDate]);`,
`  const days = useMemo(() => {\n    if (isPartialLeave) return fromDate ? 1 : 0;\n    if (!fromDate || !toDate) return 0;\n    try {\n      const f = new Date(\`${'${fromDate}'}T00:00:00\`);\n      const t = new Date(\`${'${toDate}'}T00:00:00\`);\n      const diff = Math.floor((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24)) + 1;\n      return diff > 0 ? diff : 0;\n    } catch {\n      return 0;\n    }\n  }, [fromDate, isPartialLeave, toDate]);`,
'partial day count');

  text = replaceOnce(text,
`    if (!toDate) result.push("اختر تاريخ النهاية.");\n    if (days <= 0) result.push("المدى الزمني غير صحيح.");\n    if (deductFromBalance && availableBalance != null && availableBalance < days) {\n      result.push("الرصيد غير كافٍ لهذه الإجازة.");\n    }\n    if (hasAttendanceInRange && hasAttendanceInRange(fromDate, toDate)) {\n      result.push("يوجد بصمة داخل النطاق المحدد.");\n    }`,
`    if (!toDate) result.push("اختر تاريخ النهاية.");\n    if (days <= 0) result.push("المدى الزمني غير صحيح.");\n    if (isPartialLeave) {\n      if (fromDate !== toDate) result.push("الإجازة الجزئية يجب أن تكون في يوم واحد.");\n      if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(partialStartTime)) result.push("حدد وقت بداية صحيح للإجازة الجزئية.");\n      if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(partialEndTime)) result.push("حدد وقت نهاية صحيح للإجازة الجزئية.");\n      if (partialStartTime >= partialEndTime) result.push("وقت نهاية الإجازة الجزئية يجب أن يكون بعد وقت البداية.");\n    }\n    if (!isPartialLeave && deductFromBalance && availableBalance != null && availableBalance < days) {\n      result.push("الرصيد غير كافٍ لهذه الإجازة.");\n    }\n    if (!isPartialLeave && hasAttendanceInRange && hasAttendanceInRange(fromDate, toDate)) {\n      result.push("يوجد بصمة داخل النطاق المحدد.");\n    }`,
'partial validation');

  text = replaceOnce(text,
`  const handleFromDateChange = (value: string) => {\n    setFromDate(value);\n    if (value && (!toDate || toDate < value)) {\n      setToDate(value);\n    }\n  };`,
`  const handleFromDateChange = (value: string) => {\n    setFromDate(value);\n    if (isPartialLeave) {\n      setToDate(value);\n      return;\n    }\n    if (value && (!toDate || toDate < value)) {\n      setToDate(value);\n    }\n  };`,
'partial date lock');

  text = replaceOnce(text,
`        days,\n        deductFromBalance,`,
`        days,\n        durationKind,\n        partialStartTime: isPartialLeave ? partialStartTime : "",\n        partialEndTime: isPartialLeave ? partialEndTime : "",\n        deductFromBalance,`,
'submit partial fields');

  const typeField = `        <DashboardFieldV2 id="leave-type-v2" label="نوع الإجازة" required>\n          <DashboardSelectV2\n            id="leave-type-v2"\n            value={type}\n            options={LEAVE_TYPE_OPTIONS}\n            onChange={(value) => {\n              setType(value);\n              setErrors([]);\n            }}\n          />\n        </DashboardFieldV2>`;
  const typeAndDuration = `${typeField}\n\n        <DashboardFieldV2 id="leave-duration-kind-v2" label="مدة الإجازة" required>\n          <DashboardSelectV2\n            id="leave-duration-kind-v2"\n            value={durationKind}\n            options={[\n              { value: "full_day", label: "يوم كامل" },\n              { value: "partial", label: "جزء من اليوم" },\n            ]}\n            onChange={(value) => {\n              const next = value === "partial" ? "partial" : "full_day";\n              setDurationKind(next);\n              if (next === "partial") {\n                setToDate(fromDate);\n                setDeductFromBalance(false);\n                setAffectsPayroll(false);\n              }\n              setErrors([]);\n            }}\n          />\n        </DashboardFieldV2>`;
  text = replaceOnce(text, typeField, typeAndDuration, 'duration selector');

  const dateBlock = `        <div className="leave-request-v2__date-grid">\n          <DashboardFieldV2 id="leave-from-date-v2" label="من تاريخ" required>\n            <DashboardDatePickerV2\n              id="leave-from-date-v2"\n              value={fromDate}\n              max={toDate || undefined}\n              onChange={handleFromDateChange}\n            />\n          </DashboardFieldV2>\n\n          <DashboardFieldV2 id="leave-to-date-v2" label="إلى تاريخ" required>\n            <DashboardDatePickerV2\n              id="leave-to-date-v2"\n              value={toDate}\n              min={fromDate || undefined}\n              onChange={setToDate}\n            />\n          </DashboardFieldV2>\n        </div>`;
  const dateAndTimeBlock = `        <div className="leave-request-v2__date-grid">\n          <DashboardFieldV2 id="leave-from-date-v2" label={isPartialLeave ? "التاريخ" : "من تاريخ"} required>\n            <DashboardDatePickerV2\n              id="leave-from-date-v2"\n              value={fromDate}\n              max={!isPartialLeave ? toDate || undefined : undefined}\n              onChange={handleFromDateChange}\n            />\n          </DashboardFieldV2>\n\n          {!isPartialLeave ? (\n            <DashboardFieldV2 id="leave-to-date-v2" label="إلى تاريخ" required>\n              <DashboardDatePickerV2\n                id="leave-to-date-v2"\n                value={toDate}\n                min={fromDate || undefined}\n                onChange={setToDate}\n              />\n            </DashboardFieldV2>\n          ) : null}\n        </div>\n\n        {isPartialLeave ? (\n          <div className="leave-request-v2__date-grid leave-request-v2__time-grid">\n            <DashboardFieldV2 id="leave-partial-start-v2" label="من الساعة" required>\n              <input\n                id="leave-partial-start-v2"\n                className="leave-request-v2__time-input"\n                type="time"\n                value={partialStartTime}\n                onChange={(event) => { setPartialStartTime(event.target.value); setErrors([]); }}\n              />\n            </DashboardFieldV2>\n            <DashboardFieldV2 id="leave-partial-end-v2" label="إلى الساعة" required>\n              <input\n                id="leave-partial-end-v2"\n                className="leave-request-v2__time-input"\n                type="time"\n                value={partialEndTime}\n                onChange={(event) => { setPartialEndTime(event.target.value); setErrors([]); }}\n              />\n            </DashboardFieldV2>\n          </div>\n        ) : null}`;
  text = replaceOnce(text, dateBlock, dateAndTimeBlock, 'partial date/time UI');

  text = replaceOnce(text,
`          <div className="leave-request-v2__summary-item">\n            <span>عدد الأيام</span>\n            <strong>{days > 0 ? \`${'${days}'} يوم\` : "—"}</strong>\n          </div>`,
`          <div className="leave-request-v2__summary-item">\n            <span>{isPartialLeave ? "الفترة" : "عدد الأيام"}</span>\n            <strong>{isPartialLeave ? \`${'${partialStartTime}'} – ${'${partialEndTime}'}\` : days > 0 ? \`${'${days}'} يوم\` : "—"}</strong>\n          </div>`,
'partial summary');

  text = replaceOnce(text,
`                {isOtherLeaveType\n                  ? "نوع «أخرى» يسمح بتحديد السياسة يدويًا."\n                  : "تم ضبط السياسة تلقائيًا حسب نوع الإجازة المختار."}`,
`                {isPartialLeave\n                  ? "الإجازة الجزئية تحجب فترة الحجز المحددة فقط، ولا تخصم يومًا كاملًا من الرصيد أو الراتب."\n                  : isOtherLeaveType\n                    ? "نوع «أخرى» يسمح بتحديد السياسة يدويًا."\n                    : "تم ضبط السياسة تلقائيًا حسب نوع الإجازة المختار."}`,
'partial policy description');

  text = text.replaceAll('disabled={!isOtherLeaveType}', 'disabled={isPartialLeave || !isOtherLeaveType}');

  write(path, text);
}

function patchCss() {
  const path = 'src/styles/LeaveRequestModal.css';
  let text = read(path);
  const marker = `.dashboard-v2 .leave-request-v2__date-grid :is(.dsv2-date-v2, .dsv2-date-v2__trigger),\n.dashboard-v2 .leave-request-v2__modal :is(.dsv2-select-v2, .dsv2-textarea) {\n  width: 100%;\n  min-width: 0;\n  max-width: 100%;\n}`;
  const replacement = `${marker}\n\n.dashboard-v2 .leave-request-v2__time-input {\n  width: 100%;\n  min-width: 0;\n  min-height: 42px;\n  padding: 0 var(--dsv2-space-3);\n  border: 1px solid var(--dsv2-border);\n  border-radius: var(--dsv2-radius-md);\n  color: var(--dsv2-text);\n  background: var(--dsv2-surface);\n  font: inherit;\n  font-weight: 800;\n  direction: ltr;\n}\n\n.dashboard-v2 .leave-request-v2__time-input:focus {\n  border-color: var(--dsv2-gold);\n  outline: 2px solid color-mix(in srgb, var(--dsv2-gold) 20%, transparent);\n  outline-offset: 1px;\n}`;
  text = replaceOnce(text, marker, replacement, 'time input styles');
  write(path, text);
}

function patchEmployeeHub() {
  const path = 'src/services/employeeHub.ts';
  let text = read(path);

  text = replaceOnce(text,
`  days?: number;\n  note?: string;`,
`  days?: number;\n  durationKind?: "full_day" | "partial";\n  partialStartTime?: string;\n  partialEndTime?: string;\n  note?: string;`,
'leave request type fields');

  text = replaceOnce(text,
`    days: Number.isFinite(Number(normalized.daysCount)) ? Number(normalized.daysCount) : undefined,\n    note: cleanText(normalized.employeeNote || data?.note || "") || undefined,`,
`    days: Number.isFinite(Number(normalized.daysCount)) ? Number(normalized.daysCount) : undefined,\n    durationKind: cleanText(data?.durationKind || data?.duration_kind).toLowerCase() === "partial" ? "partial" : "full_day",\n    partialStartTime: cleanText(data?.partialStartTime || data?.partial_start_time) || undefined,\n    partialEndTime: cleanText(data?.partialEndTime || data?.partial_end_time) || undefined,\n    note: cleanText(normalized.employeeNote || data?.note || "") || undefined,`,
'map partial request fields');

  text = replaceOnce(text,
`  days?: number;\n  createdByUid?: string;`,
`  days?: number;\n  durationKind?: "full_day" | "partial";\n  partialStartTime?: string;\n  partialEndTime?: string;\n  createdByUid?: string;`,
'create request input fields');

  text = replaceOnce(text,
`    days: Number.isFinite(Number(input.days)) ? Number(input.days) : undefined,\n    note: cleanText(input.note || "") || undefined,`,
`    days: Number.isFinite(Number(input.days)) ? Number(input.days) : undefined,\n    durationKind: input.durationKind === "partial" ? "partial" : "full_day",\n    partialStartTime: input.durationKind === "partial" ? cleanText(input.partialStartTime || "") || undefined : undefined,\n    partialEndTime: input.durationKind === "partial" ? cleanText(input.partialEndTime || "") || undefined : undefined,\n    note: cleanText(input.note || "") || undefined,`,
'persist partial request fields');

  write(path, text);
}

function patchDashboardEmployees() {
  const path = 'src/pages/DashboardEmployees.tsx';
  let text = read(path);

  text = replaceOnce(text,
`  const handleLeaveModalSubmit = useCallback(async (payload: { type: string; fromDate: string; toDate: string; days: number; deductFromBalance: boolean; affectsPayroll: boolean; note: string; }) => {`,
`  const handleLeaveModalSubmit = useCallback(async (payload: { type: string; fromDate: string; toDate: string; days: number; durationKind: "full_day" | "partial"; partialStartTime: string; partialEndTime: string; deductFromBalance: boolean; affectsPayroll: boolean; note: string; }) => {`,
'handler payload type');

  text = replaceOnce(text,
`    const leaveType = normalizeManagedLeaveType(payload.type);\n    const policy = managedLeavePolicy(leaveType);\n    const fromDate = normalizeLeaveUntil(payload.fromDate);\n    const toDate = normalizeLeaveUntil(payload.toDate);\n    const days = inclusiveLeaveDays(fromDate, toDate);`,
`    const leaveType = normalizeManagedLeaveType(payload.type);\n    const durationKind = payload.durationKind === "partial" ? "partial" : "full_day";\n    const isPartialLeave = durationKind === "partial";\n    const partialStartTime = isPartialLeave ? cleanText(payload.partialStartTime) : "";\n    const partialEndTime = isPartialLeave ? cleanText(payload.partialEndTime) : "";\n    const basePolicy = managedLeavePolicy(leaveType);\n    const policy = isPartialLeave\n      ? { deductFromBalance: false, affectsPayroll: false }\n      : basePolicy;\n    const fromDate = normalizeLeaveUntil(payload.fromDate);\n    const toDate = normalizeLeaveUntil(payload.toDate);\n    const days = inclusiveLeaveDays(fromDate, toDate);`,
'handler partial state');

  text = replaceOnce(text,
`    if (!fromDate || !toDate || days <= 0 || fromDate > toDate) {\n      throw new Error("مدى الإجازة غير صحيح.");\n    }`,
`    if (!fromDate || !toDate || days <= 0 || fromDate > toDate) {\n      throw new Error("مدى الإجازة غير صحيح.");\n    }\n    if (isPartialLeave) {\n      if (fromDate !== toDate) throw new Error("الإجازة الجزئية يجب أن تكون في يوم واحد.");\n      if (!/^([01]\\d|2[0-3]):[0-5]\\d$/.test(partialStartTime) || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(partialEndTime)) {\n        throw new Error("وقت الإجازة الجزئية غير صحيح.");\n      }\n      if (partialStartTime >= partialEndTime) throw new Error("وقت نهاية الإجازة الجزئية يجب أن يكون بعد البداية.");\n    }`,
'handler partial validation');

  text = replaceOnce(text,
`        normalizeLeaveUntil(request.toDate) === toDate &&\n        normalizeManagedLeaveType(request.type) === leaveType`,
`        normalizeLeaveUntil(request.toDate) === toDate &&\n        normalizeManagedLeaveType(request.type) === leaveType &&\n        (((request as any).durationKind === "partial" || (request as any).duration_kind === "partial") ? "partial" : "full_day") === durationKind &&\n        (!isPartialLeave || (cleanText((request as any).partialStartTime || (request as any).partial_start_time) === partialStartTime &&\n          cleanText((request as any).partialEndTime || (request as any).partial_end_time) === partialEndTime))`,
'match Firestore leave by duration');

  text = replaceOnce(text,
`          days,\n          note: payload.note || "تسجيل إجازة معتمدة من إدارة الموظفات",`,
`          days,\n          durationKind,\n          partialStartTime,\n          partialEndTime,\n          note: payload.note || "تسجيل إجازة معتمدة من إدارة الموظفات",`,
'create Firestore partial leave');

  text = replaceOnce(text,
`        normalizeLeaveUntil(leave.endDate) === toDate &&\n        normalizeManagedLeaveType(leave.leaveType) === leaveType`,
`        normalizeLeaveUntil(leave.endDate) === toDate &&\n        normalizeManagedLeaveType(leave.leaveType) === leaveType &&\n        (cleanText(leave.durationKind).toLowerCase() === "partial" ? "partial" : "full_day") === durationKind &&\n        (!isPartialLeave || (cleanText(leave.partialStartTime) === partialStartTime && cleanText(leave.partialEndTime) === partialEndTime))`,
'match Core leave by duration');

  text = replaceOnce(text,
`          daysCount: days,\n          employeeNote: payload.note || "تسجيل إجازة معتمدة من إدارة الموظفات",`,
`          daysCount: days,\n          durationKind,\n          partialStartTime: isPartialLeave ? partialStartTime : undefined,\n          partialEndTime: isPartialLeave ? partialEndTime : undefined,\n          employeeNote: payload.note || "تسجيل إجازة معتمدة من إدارة الموظفات",`,
'create Core partial leave');

  const fullProfileBlock = `      const profilePatch = {\n        onLeave: true,\n        leaveStartDate: fromDate,\n        leaveUntil: toDate,\n        leaveType,\n        leaveNote: cleanText(payload.note),\n        leaveRequestId: requestId,\n        coreLeaveId,\n        updatedAt: serverTimestamp(),\n      };\n      await Promise.all([\n        setDoc(staffPublicDoc(selectedEmployeeId), profilePatch, { merge: true }),\n        setDoc(doc(db, "salons", SALON_ID, "employees", selectedEmployeeId), profilePatch, { merge: true }),\n      ]);`;
  const conditionalProfileBlock = `      // A partial leave is operationally authoritative in employee_leaves only.\n      // Never mirror it to profile/staff full-day leave fields, otherwise the\n      // employee disappears for the entire day instead of only the blocked range.\n      if (!isPartialLeave) {\n        const profilePatch = {\n          onLeave: true,\n          leaveStartDate: fromDate,\n          leaveUntil: toDate,\n          leaveType,\n          leaveNote: cleanText(payload.note),\n          leaveRequestId: requestId,\n          coreLeaveId,\n          updatedAt: serverTimestamp(),\n        };\n        await Promise.all([\n          setDoc(staffPublicDoc(selectedEmployeeId), profilePatch, { merge: true }),\n          setDoc(doc(db, "salons", SALON_ID, "employees", selectedEmployeeId), profilePatch, { merge: true }),\n        ]);\n      }`;
  text = replaceOnce(text, fullProfileBlock, conditionalProfileBlock, 'prevent partial full-day profile mirror');

  text = replaceOnce(text,
`      setModalOnLeave(true);\n      setModalLeaveFrom(fromDate);\n      setModalLeaveUntil(toDate);\n      setModalLeaveType(leaveType);\n      setModalLeaveNote(cleanText(payload.note));`,
`      if (!isPartialLeave) {\n        setModalOnLeave(true);\n        setModalLeaveFrom(fromDate);\n        setModalLeaveUntil(toDate);\n        setModalLeaveType(leaveType);\n        setModalLeaveNote(cleanText(payload.note));\n      }`,
'prevent partial local full-day state');

  text = replaceOnce(text,
`          days,\n          affectsPayroll: policy.affectsPayroll,`,
`          days,\n          durationKind,\n          partialStartTime: isPartialLeave ? partialStartTime : null,\n          partialEndTime: isPartialLeave ? partialEndTime : null,\n          affectsPayroll: policy.affectsPayroll,`,
'audit partial fields');

  write(path, text);
}

function patchCoreLeaves() {
  const path = 'workers/core/repositories/leaves.js';
  let text = read(path);

  text = replaceOnce(text,
`  requiredId,\n  validDate,`,
`  requiredId,\n  validDate,\n  validTime,`,
'import validTime');

  text = replaceOnce(text,
`  const endDate = validDate(data.endDate || data.end_date, 'endDate');\n  const now = nowIso();\n  const row = {`,
`  const endDate = validDate(data.endDate || data.end_date, 'endDate');\n  const durationKind = cleanText(data.durationKind || data.duration_kind).toLowerCase() === 'partial' ? 'partial' : 'full_day';\n  if (durationKind === 'partial' && startDate !== endDate) throw new AppError(400, 'core_leave:partial_single_day');\n  const partialStartTime = durationKind === 'partial' ? validTime(data.partialStartTime || data.partial_start_time, 'partialStartTime') : null;\n  const partialEndTime = durationKind === 'partial' ? validTime(data.partialEndTime || data.partial_end_time, 'partialEndTime') : null;\n  if (durationKind === 'partial' && partialStartTime >= partialEndTime) throw new AppError(400, 'core_leave:invalid_partial_range');\n  const now = nowIso();\n  const row = {`,
'validate partial Core leave');

  text = replaceOnce(text,
`    days_count: Number(data.daysCount ?? data.days_count ?? daysBetween(startDate, endDate)),\n    employee_note: optionalText(data.employeeNote || data.employee_note) || null,`,
`    days_count: Number(data.daysCount ?? data.days_count ?? daysBetween(startDate, endDate)),\n    duration_kind: durationKind,\n    partial_start_time: partialStartTime,\n    partial_end_time: partialEndTime,\n    request_id: optionalText(data.requestId || data.request_id) || null,\n    employee_note: optionalText(data.employeeNote || data.employee_note) || null,`,
'Core leave row partial fields');

  text = replaceOnce(text,
`      (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status, leave_type,\n       start_date, end_date, days_count, employee_note, hr_note, decided_at, decided_by_uid,\n       decided_by_email, decided_by_name, created_at, updated_at)\n     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
`      (id, salon_id, employee_id, employee_uid, employee_name, employee_email, status, leave_type,\n       start_date, end_date, days_count, duration_kind, partial_start_time, partial_end_time, request_id,\n       employee_note, hr_note, decided_at, decided_by_uid, decided_by_email, decided_by_name, created_at, updated_at)\n     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
'Core leave insert partial columns');

  text = replaceOnce(text,
`  if (status === 'approved') {\n    statements.push({`,
`  if (status === 'approved' && cleanText(leave.duration_kind).toLowerCase() !== 'partial') {\n    statements.push({`,
'do not mirror partial approval to staff');

  text = replaceOnce(text,
`  } else if (leave.status === 'approved') {`,
`  } else if (leave.status === 'approved' && cleanText(leave.duration_kind).toLowerCase() !== 'partial') {`,
'do not clear staff mirror for partial');

  write(path, text);
}

function writeTest() {
  const path = 'workers/admin-partial-leave-policy.test.mjs';
  const content = `import assert from "node:assert/strict";\nimport { readFileSync } from "node:fs";\nimport { test } from "node:test";\nimport { createLeave, decideLeave } from "./core/repositories/leaves.js";\n\nclass LeaveFakeD1 {\n  constructor() {\n    this.__fakeD1 = true;\n    this.leaves = new Map();\n    this.staff = new Map([["staff-1", { id: "staff-1", salon_id: "main", leave_start_date: null, leave_end_date: null, leave_note: null }]]);\n    this.staffMirrorWrites = 0;\n  }\n\n  async first(sql, params = []) {\n    const normalized = sql.replace(/\\s+/g, " ").trim();\n    if (normalized.startsWith("SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ?")) {\n      const [salonId, id] = params;\n      const row = this.leaves.get(id);\n      return row && row.salon_id === salonId ? { ...row } : null;\n    }\n    return null;\n  }\n\n  async batch(statements) {\n    for (const statement of statements) {\n      const sql = statement.sql.replace(/\\s+/g, " ").trim();\n      const p = statement.params || [];\n      if (sql.startsWith("INSERT INTO employee_leaves")) {\n        const keys = ["id","salon_id","employee_id","employee_uid","employee_name","employee_email","status","leave_type","start_date","end_date","days_count","duration_kind","partial_start_time","partial_end_time","request_id","employee_note","hr_note","decided_at","decided_by_uid","decided_by_email","decided_by_name","created_at","updated_at"];\n        this.leaves.set(p[0], Object.fromEntries(keys.map((key, index) => [key, p[index]])));\n        continue;\n      }\n      if (sql.startsWith("UPDATE employee_leaves SET status = ?")) {\n        const [status, hrNote, decidedAt, uid, email, name, updatedAt, salonId, id] = p;\n        const row = this.leaves.get(id);\n        if (row && row.salon_id === salonId) Object.assign(row, { status, hr_note: hrNote, decided_at: decidedAt, decided_by_uid: uid, decided_by_email: email, decided_by_name: name, updated_at: updatedAt });\n        continue;\n      }\n      if (sql.startsWith("UPDATE staff SET leave_start_date = ?")) {\n        this.staffMirrorWrites += 1;\n        const [start, end, note, , salonId, id] = p;\n        const row = this.staff.get(id);\n        if (row && row.salon_id === salonId) Object.assign(row, { leave_start_date: start, leave_end_date: end, leave_note: note });\n        continue;\n      }\n      if (sql.startsWith("UPDATE staff SET leave_start_date = NULL")) {\n        this.staffMirrorWrites += 1;\n      }\n    }\n    return [];\n  }\n}\n\ntest("admin partial leave persists its time range and never becomes a full-day staff mirror", async () => {\n  const db = new LeaveFakeD1();\n  const leave = await createLeave(db, "main", {\n    id: "partial-1", employeeId: "staff-1", leaveType: "emergency", startDate: "2026-08-30", endDate: "2026-08-30",\n    durationKind: "partial", partialStartTime: "18:00", partialEndTime: "20:00", daysCount: 1,\n  }, { uid: "admin-1" });\n  assert.equal(leave.duration_kind, "partial");\n  assert.equal(leave.partial_start_time, "18:00");\n  assert.equal(leave.partial_end_time, "20:00");\n\n  const approved = await decideLeave(db, "main", "partial-1", { status: "approved", hrNote: "approved" }, { uid: "admin-1" });\n  assert.equal(approved.status, "approved");\n  assert.equal(db.staffMirrorWrites, 0);\n  assert.equal(db.staff.get("staff-1").leave_start_date, null);\n});\n\ntest("full-day leave keeps the historical staff mirror behavior", async () => {\n  const db = new LeaveFakeD1();\n  await createLeave(db, "main", { id: "full-1", employeeId: "staff-1", leaveType: "annual", startDate: "2026-08-30", endDate: "2026-08-30", daysCount: 1 });\n  await decideLeave(db, "main", "full-1", { status: "approved", hrNote: "approved" }, { uid: "admin-1" });\n  assert.equal(db.staffMirrorWrites, 1);\n  assert.equal(db.staff.get("staff-1").leave_start_date, "2026-08-30");\n});\n\ntest("admin UI and dashboard pass the partial leave contract end to end", () => {\n  const modal = readFileSync("src/components/LeaveRequestModal.tsx", "utf8");\n  const dashboard = readFileSync("src/pages/DashboardEmployees.tsx", "utf8");\n  const hub = readFileSync("src/services/employeeHub.ts", "utf8");\n  assert.match(modal, /جزء من اليوم/);\n  assert.match(modal, /partialStartTime/);\n  assert.match(modal, /partialEndTime/);\n  assert.match(dashboard, /durationKind,/);\n  assert.match(dashboard, /partialStartTime: isPartialLeave/);\n  assert.match(dashboard, /if \(!isPartialLeave\)/);\n  assert.match(hub, /durationKind: input\.durationKind === "partial"/);\n});\n`;
  write(path, content);
}

patchModal();
patchCss();
patchEmployeeHub();
patchDashboardEmployees();
patchCoreLeaves();
writeTest();
console.log('[partial-leave] admin partial-day leave cutover applied');
