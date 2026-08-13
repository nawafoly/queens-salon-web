from pathlib import Path
import re

root = Path('.')
overview_path = root / 'src/pages/hr/EmployeeOverview.tsx'
css_path = root / 'src/styles/dashboard-v2/pages/employee-portal-overview.css'
contract_path = root / 'scripts/check-employee-portal-overview-v2.mjs'

overview = overview_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')
contract = contract_path.read_text(encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str, flags=0) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')
    return result

# ---------------------------------------------------------------------------
# EmployeeOverview.tsx — canonical runtime + permission enforcement
# ---------------------------------------------------------------------------
overview = replace_once(
    overview,
    'import { resolveStaffScheduleVersionForDate, weeklyOffDaysFromScheduleSnapshot } from "../../helpers/hr/staffScheduleHistory";\n',
    'import { getWeekdayKeyForDateKey } from "../../helpers/hr/workSchedule";\n',
    'replace legacy schedule-history import',
)

overview = replace_once(
    overview,
    'import {\n  CoreEmployeeTargetService,\n  type EmployeeTargetMine,\n} from "../../services/CoreEmployeeTargetService";\n',
    'import {\n  CoreEmployeeTargetService,\n  type EmployeeTargetMine,\n} from "../../services/CoreEmployeeTargetService";\nimport { usePermissions } from "../../security/PermissionContext";\n',
    'add permission context import',
)

overview = regex_once(
    overview,
    r'const WEEKDAY_KEYS = \["sun", "mon", "tue", "wed", "thu", "fri", "sat"\] as const;.*?function readPolicyMinutes',
    '''function cleanTime(value: unknown) {\n  const raw = cleanText(value);\n  return /^\\d{1,2}:\\d{2}$/.test(raw) ? raw : "";\n}\n\nfunction readPolicyMinutes''',
    'remove profile schedule compatibility helpers',
    re.S,
)

overview = regex_once(
    overview,
    r'function scheduleForEmployeeDate\(.*?\n}\n\nfunction formatAttendanceTime',
    '''function scheduleForResolvedEmployeeDate(\n  dateKey: string,\n  resolvedShift?: CoreResolvedShift | null\n): ShiftSchedule {\n  const coreWindow = resolvedShiftWindow(resolvedShift);\n  if (coreWindow) {\n    return {\n      startTime: coreWindow.startTime,\n      endTime: coreWindow.endTime,\n      lateGraceMinutes: coreWindow.lateGraceMinutes,\n      earlyLeaveGraceMinutes: 0,\n      attendanceLockEnabled: coreWindow.attendanceLockEnabled,\n      attendanceLockAfterMinutes: coreWindow.attendanceLockAfterMinutes,\n      weeklyOffDays: [],\n    };\n  }\n\n  const source = cleanText((resolvedShift as any)?.source);\n  const exceptionType = cleanText(\n    (resolvedShift as any)?.exceptionType || (resolvedShift as any)?.exception_type\n  );\n  const noScheduledWork = Boolean(resolvedShift) && (source === "none" || exceptionType === "off");\n  const weekday = noScheduledWork ? getWeekdayKeyForDateKey(dateKey) : null;\n\n  return {\n    startTime: null,\n    endTime: null,\n    lateGraceMinutes: 0,\n    earlyLeaveGraceMinutes: 0,\n    attendanceLockEnabled: false,\n    attendanceLockAfterMinutes: 0,\n    weeklyOffDays: weekday ? [weekday] : [],\n  };\n}\n\nfunction isApprovedFullDayLeaveForDate(\n  row: EmployeeLeaveRequest & { durationKind?: string },\n  dateKey: string\n) {\n  if (cleanText(row.status).toLowerCase() !== "approved") return false;\n  const durationKind = cleanText(row.durationKind).toLowerCase();\n  if (durationKind === "partial" || durationKind === "half_day" || durationKind === "halfday") return false;\n  const fromDate = cleanText(row.fromDate);\n  const toDate = cleanText(row.toDate || row.fromDate);\n  return Boolean(fromDate && fromDate <= dateKey && toDate && toDate >= dateKey);\n}\n\nfunction formatAttendanceTime''',
    'replace legacy schedule resolver with Core-only resolver',
    re.S,
)

overview = replace_once(
    overview,
    '''export default function EmployeeOverviewPage({ session, notifications, onRefresh, attendanceOnly = false }: Props) {\n  const navigate = useNavigate();\n  const profile = getProfileSource(session);\n  const displayName = cleanText(profile.displayName || profile.name || session.displayName || session.email || "Employee");\n  const department = cleanText(profile.department || "");\n  const title = cleanText(profile.title || "");\n  const avatarUrl = resolveOverviewAvatarUrl(session);\n  const today = new Date().toISOString().slice(0, 10);\n  const leaveFrom = cleanText(profile.leaveStartDate || profile.leaveFrom || profile.leaveFromDate || "");\n  const leaveUntil = cleanText(profile.leaveUntil || "");\n  const onLeave =\n    !!profile.onLeave &&\n    (!leaveFrom || leaveFrom <= today) &&\n    (!leaveUntil || leaveUntil >= today);\n  const active = profile.active !== false;\n''',
    '''export default function EmployeeOverviewPage({ session, notifications, onRefresh, attendanceOnly = false }: Props) {\n  const navigate = useNavigate();\n  const { hasPermission } = usePermissions();\n  const profile = getProfileSource(session);\n  const displayName = cleanText(profile.displayName || profile.name || session.displayName || session.email || "Employee");\n  const department = cleanText(profile.department || "");\n  const title = cleanText(profile.title || "");\n  const avatarUrl = resolveOverviewAvatarUrl(session);\n''',
    'replace profile-driven leave/active runtime header',
)

overview = replace_once(
    overview,
    '''  const [attendancePermissionEntries, setAttendancePermissionEntries] = useState<EmployeePermissionRequest[]>([]);\n  const [todayResolvedShift, setTodayResolvedShift] = useState<CoreResolvedShift | null>(null);\n  const [employeeBookings, setEmployeeBookings] = useState<BookingDocWithId[]>([]);\n  const [employeeBookingsLoading, setEmployeeBookingsLoading] = useState(false);\n  const [employeeLeaveRequests, setEmployeeLeaveRequests] = useState<EmployeeLeaveRequest[]>([]);\n  const [employeeTarget, setEmployeeTarget] = useState<EmployeeTargetMine | null>(null);\n''',
    '''  const [attendancePermissionEntries, setAttendancePermissionEntries] = useState<EmployeePermissionRequest[]>([]);\n  const [todayResolvedShift, setTodayResolvedShift] = useState<CoreResolvedShift | null>(null);\n  const [todayResolvedShiftLoading, setTodayResolvedShiftLoading] = useState(false);\n  const [todayResolvedShiftError, setTodayResolvedShiftError] = useState("");\n  const [employeeBookings, setEmployeeBookings] = useState<BookingDocWithId[]>([]);\n  const [employeeBookingsLoading, setEmployeeBookingsLoading] = useState(false);\n  const [employeeLeaveRequests, setEmployeeLeaveRequests] = useState<EmployeeLeaveRequest[]>([]);\n  const [employeeLeaveLoading, setEmployeeLeaveLoading] = useState(false);\n  const [employeeLeaveError, setEmployeeLeaveError] = useState("");\n  const [employeeTarget, setEmployeeTarget] = useState<EmployeeTargetMine | null>(null);\n''',
    'add runtime state',
)

overview = replace_once(
    overview,
    '''  const attendanceEmployeeId = cleanText(session.employeeId || session.uid);\n  const assignedAttendanceZoneId = resolveAssignedAttendanceZoneId(profile);\n  const attendanceDate = getTodayAttendanceDateKey();\n''',
    '''  const attendanceEmployeeId = cleanText(session.employeeId || session.uid);\n  const assignedAttendanceZoneId = resolveAssignedAttendanceZoneId(profile);\n  const attendanceDate = getTodayAttendanceDateKey();\n  const canViewAttendance = hasPermission("attendance.own.view");\n  const canViewOwnTarget = hasPermission("targets.view_own");\n  const canViewMessages = hasPermission("messages.view");\n''',
    'add feature permissions',
)

overview = replace_once(
    overview,
    '''  const approvedLeaveDateKeys = useMemo(\n    () =>\n      buildApprovedLeaveDateKeys({\n        profile,\n        leaveRequests: employeeLeaveRequests,\n        extraIds: [session.uid, session.employeeId],\n        todayDateKey: attendanceDate,\n      }),\n    [attendanceDate, employeeLeaveRequests, profile, session.employeeId, session.uid]\n  );\n\n  const todayAttendanceSchedule = useMemo(\n    () => scheduleForEmployeeDate(attendanceDate, profile, todayResolvedShift),\n    [attendanceDate, profile, todayResolvedShift]\n  );\n''',
    '''  const approvedLeaveDateKeys = useMemo(\n    () =>\n      buildApprovedLeaveDateKeys({\n        profile: {},\n        leaveRequests: employeeLeaveRequests,\n        extraIds: [session.uid, session.employeeId],\n        todayDateKey: attendanceDate,\n      }),\n    [attendanceDate, employeeLeaveRequests, session.employeeId, session.uid]\n  );\n\n  const currentApprovedLeave = useMemo(\n    () =>\n      employeeLeaveRequests.find((row) =>\n        isApprovedFullDayLeaveForDate(\n          row as EmployeeLeaveRequest & { durationKind?: string },\n          attendanceDate\n        )\n      ) || null,\n    [attendanceDate, employeeLeaveRequests]\n  );\n  const onLeave = Boolean(currentApprovedLeave);\n  const leaveUntil = cleanText(currentApprovedLeave?.toDate || currentApprovedLeave?.fromDate);\n\n  const todayAttendanceSchedule = useMemo(\n    () => scheduleForResolvedEmployeeDate(attendanceDate, todayResolvedShift),\n    [attendanceDate, todayResolvedShift]\n  );\n  const hasResolvedWorkShift = Boolean(resolvedShiftWindow(todayResolvedShift));\n''',
    'use Core leave and Core schedule only',
)

overview = replace_once(
    overview,
    '''  const loadAttendance = async () => {\n    if (!attendanceEmployeeId || !session.uid) return;\n\n    setAttendanceLoading(true);\n''',
    '''  const loadAttendance = async () => {\n    if (!canViewAttendance || !attendanceEmployeeId || !session.uid) {\n      setAttendance(null);\n      return;\n    }\n\n    setAttendanceLoading(true);\n''',
    'guard attendance load by permission',
)

overview = replace_once(
    overview,
    '''  const loadAttendanceMonth = useCallback(async () => {\n    if (!attendanceEmployeeId || !session.uid) {\n      setAttendanceMonthRows([]);\n      return;\n    }\n''',
    '''  const loadAttendanceMonth = useCallback(async () => {\n    if (!canViewAttendance || !attendanceEmployeeId || !session.uid) {\n      setAttendanceMonthRows([]);\n      return;\n    }\n''',
    'guard attendance month by permission',
)

overview = replace_once(
    overview,
    '  }, [attendanceEmployeeId, attendanceMonth, session.uid]);\n\n  useEffect(() => {\n    void loadAttendance();\n',
    '  }, [attendanceEmployeeId, attendanceMonth, canViewAttendance, session.uid]);\n\n  useEffect(() => {\n    void loadAttendance();\n',
    'attendance month dependencies',
)

overview = replace_once(
    overview,
    '''  }, [attendanceEmployeeId, attendanceDate]);\n\n  useEffect(() => {\n    if (!attendanceEmployeeId) {\n      setTodayResolvedShift(null);\n      return;\n    }\n\n    let alive = true;\n\n    async function loadTodayResolvedShift() {\n      try {\n        const row = await CoreHrService.resolveEmployeeShift(attendanceEmployeeId, attendanceDate);\n        if (alive) setTodayResolvedShift(row);\n      } catch {\n        if (alive) setTodayResolvedShift(null);\n      }\n    }\n\n    void loadTodayResolvedShift();\n\n    return () => {\n      alive = false;\n    };\n  }, [attendanceEmployeeId, attendanceDate]);\n''',
    '''  }, [canViewAttendance, attendanceEmployeeId, attendanceDate]);\n\n  useEffect(() => {\n    if (!canViewAttendance || !attendanceEmployeeId) {\n      setTodayResolvedShift(null);\n      setTodayResolvedShiftLoading(false);\n      setTodayResolvedShiftError("");\n      return;\n    }\n\n    let alive = true;\n\n    async function loadTodayResolvedShift() {\n      setTodayResolvedShiftLoading(true);\n      setTodayResolvedShiftError("");\n      try {\n        const row = await CoreHrService.resolveEmployeeShift(attendanceEmployeeId, attendanceDate);\n        if (alive) setTodayResolvedShift(row);\n      } catch (error) {\n        if (alive) {\n          setTodayResolvedShift(null);\n          setTodayResolvedShiftError(\n            cleanText((error as any)?.message || "تعذر تحميل جدول الدوام المعتمد من النظام المركزي.")\n          );\n        }\n      } finally {\n        if (alive) setTodayResolvedShiftLoading(false);\n      }\n    }\n\n    void loadTodayResolvedShift();\n\n    return () => {\n      alive = false;\n    };\n  }, [attendanceEmployeeId, attendanceDate, canViewAttendance]);\n''',
    'make Core shift failure explicit',
)

overview = regex_once(
    overview,
    r'''  useEffect\(\(\) => \{\n    if \(!session\.uid\) \{\n      setEmployeeLeaveRequests\(\[\]\);\n      return;\n    \}\n\n    let alive = true;\n\n    async function loadEmployeeLeaveRequests\(\) \{\n      try \{\n        const rows = await CoreHrService\.listLeaves\(\{ employeeId: attendanceEmployeeId \}\);\n        if \(alive\) setEmployeeLeaveRequests\(rows\.map\(\(row\) => \(\{.*?\}\) as EmployeeLeaveRequest & \{ durationKind\?: string \}\)\)\);\n      \} catch \{\n        if \(alive\) setEmployeeLeaveRequests\(\[\]\);\n      \}\n    \}\n\n    void loadEmployeeLeaveRequests\(\);\n\n    return \(\) => \{\n      alive = false;\n    \};\n  \}, \[attendanceEmployeeId, session\.uid\]\);''',
    '''  useEffect(() => {\n    if (!session.uid || !attendanceEmployeeId) {\n      setEmployeeLeaveRequests([]);\n      setEmployeeLeaveLoading(false);\n      setEmployeeLeaveError("");\n      return;\n    }\n\n    let alive = true;\n\n    async function loadEmployeeLeaveRequests() {\n      setEmployeeLeaveLoading(true);\n      setEmployeeLeaveError("");\n      try {\n        const rows = await CoreHrService.listLeaves({ employeeId: attendanceEmployeeId });\n        if (alive) setEmployeeLeaveRequests(rows.map((row) => ({\n          id: row.id,\n          employeeUid: String(row.employeeUid || session.uid),\n          employeeId: row.employeeId,\n          type: row.leaveType as EmployeeLeaveRequest["type"],\n          fromDate: row.startDate,\n          toDate: row.endDate,\n          days: row.daysCount,\n          note: row.employeeNote || undefined,\n          status: row.status as EmployeeLeaveRequest["status"],\n          createdAt: row.createdAt,\n          updatedAt: row.updatedAt,\n          durationKind: row.durationKind,\n        } as EmployeeLeaveRequest & { durationKind?: string })));\n      } catch (error) {\n        if (alive) {\n          setEmployeeLeaveRequests([]);\n          setEmployeeLeaveError(\n            cleanText((error as any)?.message || "تعذر تحميل الإجازات المعتمدة من النظام المركزي.")\n          );\n        }\n      } finally {\n        if (alive) setEmployeeLeaveLoading(false);\n      }\n    }\n\n    void loadEmployeeLeaveRequests();\n\n    return () => {\n      alive = false;\n    };\n  }, [attendanceEmployeeId, session.uid]);''',
    'make Core leave failure explicit',
    re.S,
)

overview = regex_once(
    overview,
    r'''  useEffect\(\(\) => \{\n    let alive = true;\n\n    async function loadEmployeeTarget\(\) \{.*?\n  \}, \[currentTargetPeriod\.payrollMonth\]\);''',
    '''  useEffect(() => {\n    if (!canViewOwnTarget) {\n      setEmployeeTarget(null);\n      setEmployeeTargetLoading(false);\n      setEmployeeTargetError("");\n      return;\n    }\n\n    let alive = true;\n\n    async function loadEmployeeTarget() {\n      setEmployeeTargetLoading(true);\n      setEmployeeTargetError("");\n      try {\n        const row = await CoreEmployeeTargetService.mine({ payrollMonth: currentTargetPeriod.payrollMonth });\n        if (alive) setEmployeeTarget(row);\n      } catch (error) {\n        if (alive) {\n          setEmployeeTarget(null);\n          setEmployeeTargetError(employeeTargetErrorMessage(error));\n        }\n      } finally {\n        if (alive) setEmployeeTargetLoading(false);\n      }\n    }\n\n    void loadEmployeeTarget();\n\n    return () => {\n      alive = false;\n    };\n  }, [canViewOwnTarget, currentTargetPeriod.payrollMonth]);''',
    'permission-gate target runtime',
    re.S,
)

overview = replace_once(
    overview,
    '''  useEffect(() => {\n    AppSettingsService.fetchRemote()\n      .then((remote) => setAttendanceSettings(remote.attendance))\n      .catch(() => {});\n\n    return AppSettingsService.subscribe((remote) => {\n      setAttendanceSettings(remote.attendance);\n    });\n  }, []);\n\n  const quickActions = [\n    { label: "تصحيح البصمة", href: "/employee/attendance", icon: faFingerprint },\n    { label: "طلب إجازة", href: "/employee/leave", icon: faCalendarDays },\n    { label: "طلب استئذان", href: "/employee/permission", icon: faPaperPlane },\n  ];\n\n  const hrInfoItems = [\n    { label: "شخصي", description: "المعلومات الشخصية، الهوية، العنوان", href: "/employee/profile", icon: faUser },\n    { label: "البيانات الوظيفية", description: "تاريخ الالتحاق، المسمى الوظيفي، نوع التوظيف", href: "/employee/profile", icon: faBriefcase },\n    { label: "جدول الدوام", description: "بداية ونهاية الدوام، أيام الراحة، ونطاق الحضور", href: "/employee/attendance", icon: faClock },\n''',
    '''  useEffect(() => {\n    if (!canViewAttendance) return;\n\n    AppSettingsService.fetchRemote()\n      .then((remote) => setAttendanceSettings(remote.attendance))\n      .catch(() => {});\n\n    return AppSettingsService.subscribe((remote) => {\n      setAttendanceSettings(remote.attendance);\n    });\n  }, [canViewAttendance]);\n\n  const quickActions = [\n    ...(canViewAttendance\n      ? [{ label: "تصحيح البصمة", href: "/employee/attendance", icon: faFingerprint }]\n      : []),\n    { label: "طلب إجازة", href: "/employee/leave", icon: faCalendarDays },\n    { label: "طلب استئذان", href: "/employee/permission", icon: faPaperPlane },\n  ];\n\n  const hrInfoItems = [\n    { label: "شخصي", description: "المعلومات الشخصية، الهوية، العنوان", href: "/employee/profile", icon: faUser },\n    { label: "البيانات الوظيفية", description: "تاريخ الالتحاق، المسمى الوظيفي، نوع التوظيف", href: "/employee/profile", icon: faBriefcase },\n    ...(canViewAttendance\n      ? [{ label: "جدول الدوام", description: "بداية ونهاية الدوام، أيام الراحة، ونطاق الحضور", href: "/employee/attendance", icon: faClock }]\n      : []),\n''',
    'permission-gate attendance settings and navigation links',
)

overview = replace_once(
    overview,
    '''  const handleAttendancePunch = async (\n    type: "check_in" | "check_out"\n  ) => {\n    if (!attendanceEmployeeId || !session.uid || attendanceBusy) {\n      return;\n    }\n    if (type === "check_in" && isCheckInWindowClosed(attendanceDate, todayAttendanceSchedule)) {\n''',
    '''  const handleAttendancePunch = async (\n    type: "check_in" | "check_out"\n  ) => {\n    if (!canViewAttendance || !attendanceEmployeeId || !session.uid || attendanceBusy) {\n      return;\n    }\n    if (type === "check_in" && (todayResolvedShiftLoading || todayResolvedShiftError || !hasResolvedWorkShift)) {\n      setAttendanceMessage(\n        todayResolvedShiftError ||\n          (todayResolvedShiftLoading\n            ? "جاري تحميل جدول الدوام المعتمد."\n            : "لا يوجد شفت عمل معتمد لهذا اليوم.")\n      );\n      return;\n    }\n    if (type === "check_in" && (attendanceDayStatus === "leave" || attendanceDayStatus === "off_day")) {\n      setAttendanceMessage(\n        attendanceDayStatus === "leave"\n          ? "اليوم مسجل كإجازة معتمدة، لذلك لا يمكن تسجيل حضور جديد."\n          : "اليوم مسجل كيوم راحة، لذلك لا يمكن تسجيل حضور جديد."\n      );\n      return;\n    }\n    if (type === "check_in" && isCheckInWindowClosed(attendanceDate, todayAttendanceSchedule)) {\n''',
    'enforce attendance permission and canonical shift before punch',
)

overview = replace_once(
    overview,
    '''      if (!active) {\n        throw new Error(\n          "لا يمكن تسجيل الحضور لموظفة غير نشطة."\n        );\n      }\n\n''',
    '',
    'remove stale profile active gate',
)

overview = replace_once(
    overview,
    '''  const statusLabel = onLeave\n    ? leaveUntil\n      ? `في إجازة حتى ${formatShortDate(leaveUntil)}`\n      : "في إجازة"\n    : active\n      ? "نشط"\n      : "غير نشط";\n  const attendanceStatus = attendance?.status || "not_started";\n  const attendanceDayStatusLabel = getAttendanceDayStatusLabel(attendanceDayStatus);\n  const checkInWindowClosed = isCheckInWindowClosed(attendanceDate, todayAttendanceSchedule);\n  const canCheckIn = !attendanceBusy && !attendanceLoading && attendanceStatus === "not_started" && !checkInWindowClosed;\n  const canCheckOut = !attendanceBusy && !attendanceLoading && attendanceStatus === "checked_in";\n  const punchAction = canCheckOut ? "check_out" : "check_in";\n  const punchDisabled = !canCheckIn && !canCheckOut;\n  const punchLabel = attendanceStatus === "checked_out"\n    ? "تم اكتمال الدوام"\n    : canCheckOut\n      ? "تسجيل انصراف"\n      : checkInWindowClosed\n        ? "انتهت مهلة الحضور"\n        : "تسجيل حضور";\n''',
    '''  const statusLabel = onLeave\n    ? leaveUntil\n      ? `في إجازة حتى ${formatShortDate(leaveUntil)}`\n      : "في إجازة"\n    : employeeLeaveLoading\n      ? "جاري التحقق من الإجازات"\n      : employeeLeaveError\n        ? "حالة الإجازة غير متاحة"\n        : "نشط";\n  const attendanceStatus = attendance?.status || "not_started";\n  const checkInWindowClosed = isCheckInWindowClosed(attendanceDate, todayAttendanceSchedule);\n  const canCheckIn =\n    canViewAttendance &&\n    !attendanceBusy &&\n    !attendanceLoading &&\n    !todayResolvedShiftLoading &&\n    !todayResolvedShiftError &&\n    hasResolvedWorkShift &&\n    attendanceDayStatus !== "leave" &&\n    attendanceDayStatus !== "off_day" &&\n    attendanceStatus === "not_started" &&\n    !checkInWindowClosed;\n  const canCheckOut =\n    canViewAttendance &&\n    !attendanceBusy &&\n    !attendanceLoading &&\n    attendanceStatus === "checked_in";\n  const punchAction = canCheckOut ? "check_out" : "check_in";\n  const punchDisabled = !canCheckIn && !canCheckOut;\n  const punchLabel = attendanceStatus === "checked_out"\n    ? "تم اكتمال الدوام"\n    : canCheckOut\n      ? "تسجيل انصراف"\n      : todayResolvedShiftLoading\n        ? "جاري تحميل الشفت"\n        : todayResolvedShiftError\n          ? "تعذر تحميل الشفت"\n          : attendanceDayStatus === "leave"\n            ? "إجازة معتمدة"\n            : attendanceDayStatus === "off_day"\n              ? "يوم راحة"\n              : !hasResolvedWorkShift\n                ? "لا يوجد شفت اليوم"\n                : checkInWindowClosed\n                  ? "انتهت مهلة الحضور"\n                  : "تسجيل حضور";\n''',
    'derive status and punch availability from canonical runtime',
)

overview = replace_once(
    overview,
    '''  const punchHint = attendanceStatus === "checked_out"\n    ? "تم حفظ الحضور والانصراف لهذا اليوم"\n    : checkInWindowClosed && attendanceStatus === "not_started"\n      ? "تم إغلاق بصمة الحضور، وسيتم تسجيل الغياب تلقائيًا. راجعي الإدارة عند وجود عذر."\n      : attendanceBusy\n        ? "لا تغلق الصفحة أثناء التحقق"\n        : "";\n''',
    '''  const punchHint = attendanceStatus === "checked_out"\n    ? "تم حفظ الحضور والانصراف لهذا اليوم"\n    : todayResolvedShiftLoading\n      ? "جاري قراءة الشفت المنشور من النظام المركزي."\n      : todayResolvedShiftError\n        ? "تعذر التحقق من الشفت، لذلك تم تعطيل تسجيل حضور جديد بدل استخدام جدول قديم."\n        : attendanceDayStatus === "leave"\n          ? "هذا اليوم مغطى بإجازة معتمدة في نظام الموارد البشرية."\n          : attendanceDayStatus === "off_day"\n            ? "لا يوجد دوام مطلوب لهذا اليوم حسب الشفت المنشور."\n            : !hasResolvedWorkShift\n              ? "لا يوجد شفت منشور لهذا اليوم. راجعي الإدارة إذا كان يفترض وجود دوام."\n              : checkInWindowClosed && attendanceStatus === "not_started"\n                ? "تم إغلاق بصمة الحضور، وسيتم تسجيل الغياب تلقائيًا. راجعي الإدارة عند وجود عذر."\n                : attendanceBusy\n                  ? "لا تغلق الصفحة أثناء التحقق"\n                  : "";\n''',
    'add canonical runtime attendance states',
)

# Hero class no longer depends on stale profile.active.
overview = replace_once(
    overview,
    '          <span className={`employee-status-pill ${onLeave ? "is-leave" : active ? "is-active" : "is-inactive"}`}>{statusLabel}</span>',
    '          <span className={`employee-status-pill ${onLeave ? "is-leave" : employeeLeaveError ? "is-inactive" : "is-active"}`}>{statusLabel}</span>',
    'remove stale active presentation',
)

# Add explicit partial-data state immediately after the hero.
overview = replace_once(
    overview,
    '''      </section>\n\n      <section className="employee-overview-kpis" aria-label="ملخص التنبيهات">\n''',
    '''      </section>\n\n      {employeeLeaveError || (canViewAttendance && todayResolvedShiftError) ? (\n        <div className="employee-overview-runtime-alert" role="status" aria-live="polite">\n          <strong>بعض البيانات التشغيلية غير متاحة الآن.</strong>\n          <span>{employeeLeaveError || todayResolvedShiftError}</span>\n          <small>لم يتم استخدام أي جدول دوام أو حالة إجازة Legacy كبديل.</small>\n        </div>\n      ) : null}\n\n      <section className="employee-overview-kpis" aria-label="ملخص التنبيهات">\n''',
    'add partial runtime error state',
)

# Permission-gate messages KPI.
overview = replace_once(
    overview,
    '''        <Link to="/employee/messages" className="employee-overview-kpi">\n          <FontAwesomeIcon icon={faPaperPlane} />\n          <span>الرسائل</span>\n          <strong>{summary.message}</strong>\n        </Link>\n''',
    '''        {canViewMessages ? (\n          <Link to="/employee/messages" className="employee-overview-kpi">\n            <FontAwesomeIcon icon={faPaperPlane} />\n            <span>الرسائل</span>\n            <strong>{summary.message}</strong>\n          </Link>\n        ) : null}\n''',
    'permission-gate messages KPI',
)

# Permission-gate target card as a whole.
overview = replace_once(
    overview,
    '''      <section className={`employee-target-home-card employee-target-home-card--${targetCardStatus}`} aria-label="تارقتي">\n''',
    '''      {canViewOwnTarget ? (\n      <section className={`employee-target-home-card employee-target-home-card--${targetCardStatus}`} aria-label="تارقتي">\n''',
    'open target permission gate',
)
overview = replace_once(
    overview,
    '''      </section>\n\n      <section className={`employee-attendance-card employee-attendance-card--${attendanceStatus}`} data-status={attendanceStatus}>\n''',
    '''      </section>\n      ) : null}\n\n      {canViewAttendance ? (\n      <section className={`employee-attendance-card employee-attendance-card--${attendanceStatus}`} data-status={attendanceStatus}>\n''',
    'close target and open attendance permission gate',
)
overview = replace_once(
    overview,
    '''      </section>\n\n      <section className="employee-overview-block">\n        <div className="employee-block-head">\n          <h2>اختصارات سريعة</h2>\n''',
    '''      </section>\n      ) : null}\n\n      <section className="employee-overview-block">\n        <div className="employee-block-head">\n          <h2>اختصارات سريعة</h2>\n''',
    'close attendance permission gate',
)

# Clarify the balance source instead of pretending Core currently owns it.
overview = replace_once(
    overview,
    '''          <div className="employee-balance-card">\n            <span>رصيد الإجازات</span>\n            <strong>{leaveBalanceValue === "—" ? "—" : `${leaveBalanceValue} يوم`}</strong>\n          </div>\n''',
    '''          <div className="employee-balance-card">\n            <div>\n              <span>رصيد الإجازات</span>\n              <small>نفس الرصيد التشغيلي المستخدم حاليًا في إدارة الموظفات</small>\n            </div>\n            <strong>{leaveBalanceValue === "—" ? "—" : `${leaveBalanceValue} يوم`}</strong>\n          </div>\n''',
    'document shared leave balance source in UI',
)

# ---------------------------------------------------------------------------
# Canonical V2 CSS — no patch stylesheet
# ---------------------------------------------------------------------------
css_anchor = '''.dashboard-v2 .employee-overview-v2-page > * {\n  width: 100%;\n  max-width: 1680px;\n  min-width: 0;\n  margin-inline: auto;\n}\n'''
css_insert = css_anchor + '''\n.dashboard-v2 .employee-overview-v2-page .employee-overview-runtime-alert {\n  display: grid;\n  gap: var(--dsv2-space-1);\n  padding: var(--dsv2-space-4);\n  border: 1px solid var(--dsv2-burgundy-border);\n  border-radius: var(--dsv2-radius-md);\n  background: var(--dsv2-burgundy-soft);\n  color: var(--dsv2-burgundy);\n}\n\n.dashboard-v2 .employee-overview-v2-page .employee-overview-runtime-alert strong {\n  font-size: 0.72rem;\n  font-weight: 950;\n}\n\n.dashboard-v2 .employee-overview-v2-page .employee-overview-runtime-alert span,\n.dashboard-v2 .employee-overview-v2-page .employee-overview-runtime-alert small {\n  font-size: 0.62rem;\n  font-weight: 750;\n  line-height: 1.6;\n}\n'''
css = replace_once(css, css_anchor, css_insert, 'add runtime alert V2 styling')

css = replace_once(
    css,
    '''.dashboard-v2 .employee-overview-v2-page .employee-balance-card {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n''',
    '''.dashboard-v2 .employee-overview-v2-page .employee-balance-card {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n''',
    'confirm balance card anchor',
)

# Add balance copy styling next to the existing card block without changing layout architecture.
balance_marker = '''.dashboard-v2 .employee-overview-v2-page .employee-balance-card {'''
balance_index = css.find(balance_marker)
if balance_index < 0:
    raise SystemExit('balance card marker missing')
next_rule = css.find('\n.dashboard-v2 ', balance_index + len(balance_marker))
if next_rule < 0:
    raise SystemExit('balance card block boundary missing')
balance_extra = '''\n.dashboard-v2 .employee-overview-v2-page .employee-balance-card > div {\n  display: grid;\n  min-width: 0;\n  gap: var(--dsv2-space-1);\n}\n\n.dashboard-v2 .employee-overview-v2-page .employee-balance-card small {\n  color: var(--dsv2-muted);\n  font-size: 0.56rem;\n  font-weight: 700;\n  line-height: 1.5;\n}\n'''
css = css[:next_rule] + balance_extra + css[next_rule:]

# ---------------------------------------------------------------------------
# Strengthen permanent contract so runtime legacy cannot regress.
# ---------------------------------------------------------------------------
contract = replace_once(
    contract,
    '''  const behaviorMarkers = [\n    "getBrowserPosition",\n''',
    '''  const behaviorMarkers = [\n    "usePermissions",\n    "canViewAttendance",\n    "canViewOwnTarget",\n    "getBrowserPosition",\n''',
    'extend behavior markers with permissions',
)

contract = replace_once(
    contract,
    '''    "CoreHrService.resolveEmployeeShift",\n    "buildApprovedLeaveDateKeys",\n''',
    '''    "CoreHrService.resolveEmployeeShift",\n    "CoreHrService.listLeaves",\n    "profile: {}",\n    "buildApprovedLeaveDateKeys",\n''',
    'extend canonical runtime behavior markers',
)

contract_anchor = '''  for (const marker of behaviorMarkers) {\n    if (!overview.includes(marker)) errors.push(`Employee overview behavior marker missing: ${marker}`);\n  }\n\n'''
contract_insert = contract_anchor + '''  const forbiddenRuntimeMarkers = [\n    "workingScheduleVersions",\n    "customWorkingHourOverrides",\n    "exceptionalLeaveWeekdays",\n    "profile.onLeave",\n    "profile.leaveStartDate",\n    "profile.leaveFromDate",\n    "scheduleForEmployeeDate",\n  ];\n  for (const marker of forbiddenRuntimeMarkers) {\n    if (overview.includes(marker)) {\n      errors.push(`Employee overview still contains legacy runtime marker: ${marker}`);\n    }\n  }\n\n  if (!overview.includes('hasPermission("attendance.own.view")')) {\n    errors.push("Employee overview attendance runtime is not permission-gated.");\n  }\n  if (!overview.includes('hasPermission("targets.view_own")')) {\n    errors.push("Employee overview target runtime is not permission-gated.");\n  }\n  if (!overview.includes('hasPermission("messages.view")')) {\n    errors.push("Employee overview messages KPI is not permission-gated.");\n  }\n  if (!overview.includes("لم يتم استخدام أي جدول دوام أو حالة إجازة Legacy كبديل")) {\n    errors.push("Employee overview is missing its explicit partial-runtime failure state.");\n  }\n\n'''
contract = replace_once(contract, contract_anchor, contract_insert, 'add legacy runtime regression guard')

contract = replace_once(
    contract,
    '''  const attendanceCssMarkers = [\n    ".employee-attendance-side",\n''',
    '''  const attendanceCssMarkers = [\n    ".employee-overview-runtime-alert",\n    ".employee-attendance-side",\n''',
    'add runtime alert css marker',
)

# Final sanity checks before writing.
for forbidden in [
    'workingScheduleVersions',
    'customWorkingHourOverrides',
    'exceptionalLeaveWeekdays',
    'profile.onLeave',
    'profile.leaveStartDate',
    'profile.leaveFromDate',
    'scheduleForEmployeeDate',
]:
    if forbidden in overview:
        raise SystemExit(f'legacy runtime marker remains after patch: {forbidden}')

required = [
    'scheduleForResolvedEmployeeDate',
    'CoreHrService.resolveEmployeeShift',
    'CoreHrService.listLeaves',
    'hasPermission("attendance.own.view")',
    'hasPermission("targets.view_own")',
    'hasPermission("messages.view")',
    'profile: {},',
    'employee-overview-runtime-alert',
]
for marker in required:
    if marker not in overview and marker != 'employee-overview-runtime-alert':
        raise SystemExit(f'required overview marker missing after patch: {marker}')
if 'employee-overview-runtime-alert' not in overview or 'employee-overview-runtime-alert' not in css:
    raise SystemExit('runtime alert markup/style missing after patch')

if '!important' in css:
    raise SystemExit('canonical overview CSS gained !important')
if re.search(r'#[0-9a-fA-F]{3,8}\\b', css):
    raise SystemExit('canonical overview CSS gained raw hex color')

overview_path.write_text(overview, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
contract_path.write_text(contract, encoding='utf-8')

print('Employee overview runtime finalization patch applied.')
