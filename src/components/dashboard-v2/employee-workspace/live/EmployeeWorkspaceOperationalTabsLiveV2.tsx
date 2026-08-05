import { useState } from "react";
import type { AttendanceSpecialDay } from "../../../../helpers/hr/attendanceCalendarData";

import {
  DashboardDrawerV2,
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../index";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceSwitchV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "../EmployeeWorkspacePrimitivesV2";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function formatNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ar-SA") : "0";
}

function safeMonthKey(value: string) {
  const clean = cleanText(value);
  return /^\d{4}-\d{2}$/.test(clean) ? clean : new Date().toISOString().slice(0, 7);
}

function getLocalDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const AR_WEEKDAY_SHORT = ["ح", "ن", "ث", "ر", "خ", "ج", "س"];
const AR_MONTH_NAMES = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function shiftMonthKey(monthKey: string, offset: number) {
  const normalized = safeMonthKey(monthKey);
  const year = Number(normalized.slice(0, 4));
  const monthIndex = Number(normalized.slice(5, 7)) - 1;
  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(monthKey: string) {
  const normalized = safeMonthKey(monthKey);
  const year = normalized.slice(0, 4);
  const monthIndex = Number(normalized.slice(5, 7)) - 1;
  return `${AR_MONTH_NAMES[monthIndex] || normalized} ${year}`;
}

function buildMonthOptions(monthKey: string) {
  const normalized = safeMonthKey(monthKey);
  const values = Array.from({ length: 16 }, (_, index) => shiftMonthKey(normalized, 3 - index));
  return values.map((value) => ({
    value,
    label: formatMonthLabel(value),
  }));
}

function daysInMonthKey(monthKey: string) {
  const normalized = safeMonthKey(monthKey);
  return new Date(
    Number(normalized.slice(0, 4)),
    Number(normalized.slice(5, 7)),
    0
  ).getDate();
}

function coerceDateToMonth(dateKey: string, monthKey: string) {
  const normalized = safeMonthKey(monthKey);
  const cleanDate = cleanText(dateKey);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(cleanDate)
    ? Number(cleanDate.slice(8, 10))
    : 1;
  const safeDay = Math.min(Math.max(day || 1, 1), daysInMonthKey(normalized));
  return `${normalized}-${String(safeDay).padStart(2, "0")}`;
}

type AttendanceCalendarDayLiveV2 = {
  date: string;
  dayNumber: number;
  status: string;
  timeLabel: string;
  row?: EmployeeAttendanceRowLiveV2;
  specialDay?: AttendanceSpecialDay;
};

function formatAttendanceTime(value: unknown) {
  const clean = cleanText(value);
  if (!clean) return "";
  if (/^\d{2}:\d{2}/.test(clean)) return clean.slice(0, 5);
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return clean;
  return new Intl.DateTimeFormat("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatAttendanceDate(value: unknown) {
  const clean = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean || "-";
  const [year, month, day] = clean.split("-");
  return new Intl.DateTimeFormat("ar-SA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(Number(year), Number(month) - 1, Number(day)));
}

function attendanceRowStatus(row?: EmployeeAttendanceRowLiveV2 | null) {
  if (!row) return "";
  const type = cleanText(row.type).toLowerCase();
  const rawStatus = cleanText(row.status).toLowerCase();
  if (type === "leave") return "إجازة";
  if (type === "absent" || row.absentFullDay || rawStatus === "absent") return "غياب";
  if (Number(row.lateMinutes || 0) > 0) return "تأخير";
  if (Number(row.earlyLeaveMinutes || 0) > 0) return "خروج مبكر";
  if (cleanText(row.checkInAtClient || row.checkOutAtClient)) return "حضور";
  if (rawStatus === "checked_in" || rawStatus === "checked_out") return "حضور";
  if (rawStatus === "not_started") return "غياب";
  return cleanText(row.status) || "حضور";
}

function attendanceStatusTone(status: string): "default" | "gold" | "success" | "danger" {
  if (status === "حضور") return "success";
  if (status === "تأخير" || status === "خروج مبكر" || status === "إجازة" || status === "راحة" || status === "إجازة أسبوعية" || status === "راحة / يوم استثنائي") return "gold";
  if (status === "غياب") return "danger";
  return "default";
}

function attendanceSurfaceTone(status: string): "neutral" | "gold" | "success" | "danger" {
  const tone = attendanceStatusTone(status);
  return tone === "default" ? "neutral" : tone;
}

function attendanceReviewText(status: string, row?: EmployeeAttendanceRowLiveV2 | null) {
  if (status === "غياب") return "يحتاج مراجعة";
  if (status === "تأخير") return `تأخير ${formatNumber(row?.lateMinutes || 0)} دقيقة`;
  if (status === "خروج مبكر") return `خروج مبكر ${formatNumber(row?.earlyLeaveMinutes || 0)} دقيقة`;
  if (status === "راحة") return "راحة معتمدة";
  if (status === "إجازة أسبوعية") return "إجازة أسبوعية حسب الجدول";
  if (status === "راحة / يوم استثنائي") return "راحة بسبب استثناء اليوم";
  if (status === "إجازة") return "إجازة معتمدة";
  if (status === "حضور") return "مكتمل ومطابق";
  return "لا توجد بيانات";
}

function buildAttendanceCalendar(
  monthKey: string,
  rows: EmployeeAttendanceRowLiveV2[],
  approvedLeaveDateKeys: readonly string[],
  specialDays: readonly AttendanceSpecialDay[] = []
): AttendanceCalendarDayLiveV2[] {
  const normalized = safeMonthKey(monthKey);
  const year = Number(normalized.slice(0, 4));
  const month = Number(normalized.slice(5, 7));
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = getLocalDateKey();
  const leaveDates = new Set(approvedLeaveDateKeys.map(cleanText).filter(Boolean));
  const specialByDate = new Map(
    specialDays
      .map((day) => [cleanText(day.date), day] as const)
      .filter(([date]) => Boolean(date))
  );
  const byDate = new Map<string, EmployeeAttendanceRowLiveV2>();
  rows.forEach((row) => {
    const date = cleanText(row.date);
    if (date) byDate.set(date, row);
  });

  return Array.from({ length: daysInMonth }, (_, index) => {
    const dayNumber = index + 1;
    const date = `${normalized}-${String(dayNumber).padStart(2, "0")}`;
    const row = byDate.get(date);
    const checkIn = formatAttendanceTime(row?.checkInAtClient);
    const checkOut = formatAttendanceTime(row?.checkOutAtClient);
    const hasLeave = leaveDates.has(date);
    const specialDay = specialByDate.get(date);
    const hasPunch = Boolean(checkIn || checkOut);
    const rowStatus = attendanceRowStatus(row);
    const status = specialDay?.label || (hasLeave ? "\u0625\u062c\u0627\u0632\u0629" : rowStatus || (date < todayKey ? "\u063a\u064a\u0627\u0628" : "\u2014"));
    return {
      date,
      dayNumber,
      row,
      specialDay,
      status,
      timeLabel: [checkIn, checkOut].filter(Boolean).join(" → ") || "لا توجد بصمة",
    };
  });
}

type WorkingDayLiveV2 = {
  key: string;
  label: string;
  enabled: boolean;
  start: string;
  end: string;
};

export type EmployeeScheduleTabLiveV2Props = {
  readOnly: boolean;
  loading: boolean;
  employmentEndDate: string;
  useCustomWorkingHours: boolean;
  workingDays: WorkingDayLiveV2[];
  attendanceZones: Array<{ id: string; name?: string; label?: string }>;
  attendanceZonesLoading: boolean;
  selectedAttendanceZoneId: string;
  scheduleEffectiveFrom: string;
  scheduleChangeReason: string;
  onEmploymentEndDateChange: (value: string) => void;
  onUseCustomWorkingHoursChange: (value: boolean) => void;
  onWorkingDayChange: (dayKey: string, patch: Partial<WorkingDayLiveV2>) => void;
  onCopyWorkingDayToAll: (dayKey: string) => void;
  onSelectedAttendanceZoneIdChange: (value: string) => void;
  onScheduleEffectiveFromChange: (value: string) => void;
  onScheduleChangeReasonChange: (value: string) => void;
  onReloadAttendanceZones: () => void;
};

export function EmployeeScheduleTabLiveV2({
  readOnly,
  loading,
  employmentEndDate,
  useCustomWorkingHours,
  workingDays,
  attendanceZones,
  attendanceZonesLoading,
  selectedAttendanceZoneId,
  scheduleEffectiveFrom,
  scheduleChangeReason,
  onEmploymentEndDateChange,
  onUseCustomWorkingHoursChange,
  onWorkingDayChange,
  onCopyWorkingDayToAll,
  onSelectedAttendanceZoneIdChange,
  onScheduleEffectiveFromChange,
  onScheduleChangeReasonChange,
  onReloadAttendanceZones,
}: EmployeeScheduleTabLiveV2Props) {
  const openDays = workingDays.filter((day) => day.enabled).length;
  const closedDays = workingDays.length - openDays;

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="جدول الدوام"
        description="إدارة جدول الموظفة ونطاق الحضور من واجهة V2 مستقلة."
        badge={<WorkspaceStatusBadgeV2 tone={useCustomWorkingHours ? "success" : "gold"}>{useCustomWorkingHours ? "جدول مخصص" : "دوام الصالون"}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="أيام العمل" value={openDays} tone="success" />
        <WorkspaceMetricV2 label="أيام الإغلاق" value={closedDays} tone={closedDays ? "gold" : "neutral"} />
        <WorkspaceMetricV2 label="نطاق الحضور" value={selectedAttendanceZoneId ? "محدد" : "غير محدد"} tone={selectedAttendanceZoneId ? "success" : "danger"} />
        <WorkspaceMetricV2 label="حالة التحميل" value={loading ? "جاري" : "جاهز"} />
      </div>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="إعدادات الجدول" description="تاريخ بدء التطبيق وحالة استخدام جدول مخصص.">
          <WorkspaceSwitchV2
            checked={useCustomWorkingHours}
            disabled={readOnly}
            label="استخدام جدول دوام مخصص"
            description="عند التعطيل يتم الاعتماد على ساعات الصالون العامة."
            onChange={onUseCustomWorkingHoursChange}
          />

          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="employee-live-v2-schedule-effective-from" label="تطبيق الجدول من">
              <DashboardDatePickerV2
                id="employee-live-v2-schedule-effective-from"
                value={scheduleEffectiveFrom}
                disabled={readOnly}
                clearable
                onChange={onScheduleEffectiveFromChange}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-employment-end" label="تاريخ نهاية التوظيف">
              <DashboardDatePickerV2
                id="employee-live-v2-employment-end"
                value={employmentEndDate}
                disabled={readOnly}
                clearable
                onChange={onEmploymentEndDateChange}
              />
            </DashboardFieldV2>
          </div>

          <DashboardFieldV2 id="employee-live-v2-schedule-reason" label="سبب تغيير الجدول">
            <textarea
              id="employee-live-v2-schedule-reason"
              className="dsv2-textarea"
              rows={3}
              value={scheduleChangeReason}
              disabled={readOnly}
              onChange={(event) => onScheduleChangeReasonChange(event.target.value)}
            />
          </DashboardFieldV2>
        </WorkspaceCardV2>

        <WorkspaceCardV2
          title="نطاق الحضور"
          description="اختيار موقع أو نطاق يسمح بالبصمة."
          actions={
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={attendanceZonesLoading} onClick={onReloadAttendanceZones}>
              تحديث النطاقات
            </button>
          }
        >
          <DashboardFieldV2 id="employee-live-v2-attendance-zone" label="نطاق الحضور">
            <DashboardSelectV2
              id="employee-live-v2-attendance-zone"
              value={selectedAttendanceZoneId || ""}
              disabled={readOnly || attendanceZonesLoading}
              placeholder={attendanceZonesLoading ? "جاري التحميل" : "اختر النطاق"}
              options={[
                { value: "", label: "بدون نطاق محدد" },
                ...attendanceZones.map((zone) => ({
                  value: zone.id,
                  label: cleanText(zone.name || zone.label || zone.id),
                })),
              ]}
              onChange={onSelectedAttendanceZoneIdChange}
            />
          </DashboardFieldV2>

          {!selectedAttendanceZoneId ? (
            <WorkspaceNoticeV2
              title="لا يوجد نطاق حضور"
              description="تحديد النطاق يقلل أخطاء البصمة خارج الموقع."
              tone="gold"
            />
          ) : null}
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="الأسبوع التشغيلي" description="تعديل أيام وساعات عمل الموظفة.">
        <div className="dsv2-ew-week-grid">
          {workingDays.map((day) => (
            <article key={day.key} className="dsv2-ew-week-card" data-open={day.enabled ? "true" : "false"}>
              <header>
                <strong>{day.label}</strong>
                <WorkspaceStatusBadgeV2 tone={day.enabled ? "success" : "danger"}>{day.enabled ? "يعمل" : "مغلق"}</WorkspaceStatusBadgeV2>
              </header>
              <WorkspaceSwitchV2
                checked={day.enabled}
                disabled={readOnly}
                label="اليوم مفتوح"
                onChange={(checked) => onWorkingDayChange(day.key, { enabled: checked })}
              />
              <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
                <DashboardFieldV2 id={`employee-live-v2-${day.key}-start`} label="البداية">
                  <input
                    id={`employee-live-v2-${day.key}-start`}
                    className="dsv2-input"
                    type="time"
                    value={day.start}
                    disabled={readOnly || !day.enabled}
                    onChange={(event) => onWorkingDayChange(day.key, { start: event.target.value })}
                  />
                </DashboardFieldV2>
                <DashboardFieldV2 id={`employee-live-v2-${day.key}-end`} label="النهاية">
                  <input
                    id={`employee-live-v2-${day.key}-end`}
                    className="dsv2-input"
                    type="time"
                    value={day.end}
                    disabled={readOnly || !day.enabled}
                    onChange={(event) => onWorkingDayChange(day.key, { end: event.target.value })}
                  />
                </DashboardFieldV2>
              </div>
              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly} onClick={() => onCopyWorkingDayToAll(day.key)}>
                نسخ لكل الأسبوع
              </button>
            </article>
          ))}
        </div>
      </WorkspaceCardV2>
    </div>
  );
}

export type EmployeeAttendanceShiftInfoLiveV2 = {
  sourceLabel: string;
  sourceDetail?: string;
  timeLabel: string;
  statusLabel: string;
  tone?: "neutral" | "gold" | "success" | "danger" | "default";
};

export type EmployeeAttendanceRowLiveV2 = {
  date?: string;
  type?: string;
  status?: string;
  absentFullDay?: boolean;
  checkInAtClient?: string;
  checkOutAtClient?: string;
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  shiftName?: string;
  shiftSourceLabel?: string;
  shiftStatusLabel?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;
  lateGraceMinutes?: number;
  earlyLeaveGraceMinutes?: number;
  notes?: string;
  recordCount?: number;
  workZoneName?: string;
};

export type EmployeeAttendanceTabLiveV2Props = {
  readOnly: boolean;
  loading: boolean;
  error?: string;
  rows: EmployeeAttendanceRowLiveV2[];
  monthKey: string;
  selectedDate: string;
  approvedLeaveDateKeys?: string[];
  specialDays?: AttendanceSpecialDay[];
  effectiveShiftInfo?: EmployeeAttendanceShiftInfoLiveV2 | null;
  canEdit: boolean;
  canDelete: boolean;
  canCreateEmergencyLeave?: boolean;
  canCancelLeave?: boolean;
  onMonthChange: (value: string) => void;
  onSelectedDateChange: (value: string) => void;
  onReload: () => void;
  onEditPunch: (dateKey: string) => void;
  onDeletePunch: (dateKey: string) => void;
  onCreateEmergencyLeave?: (dateKey: string) => void;
  onCancelLeave?: (dateKey: string) => void;
};

export function EmployeeAttendanceTabLiveV2({
  readOnly,
  loading,
  error = "",
  rows,
  monthKey,
  selectedDate,
  approvedLeaveDateKeys = [],
  specialDays = [],
  effectiveShiftInfo = null,
  canEdit,
  canDelete,
  canCreateEmergencyLeave = false,
  canCancelLeave = false,
  onMonthChange,
  onSelectedDateChange,
  onReload,
  onEditPunch,
  onDeletePunch,
  onCreateEmergencyLeave,
  onCancelLeave,
}: EmployeeAttendanceTabLiveV2Props) {
  const [detailDrawerDate, setDetailDrawerDate] = useState("");
  const normalizedMonth = safeMonthKey(monthKey);
  const todayKey = getLocalDateKey();
  const activeSelectedDate = cleanText(selectedDate).startsWith(normalizedMonth)
    ? selectedDate
    : coerceDateToMonth(selectedDate, normalizedMonth);
  const normalizedRows = rows.filter((row) => cleanText(row.date).startsWith(normalizedMonth));
  const monthLeaveDates = approvedLeaveDateKeys.filter((date) => cleanText(date).startsWith(normalizedMonth));
  const monthSpecialDays = specialDays.filter((day) => cleanText(day.date).startsWith(normalizedMonth));
  const calendarDays = buildAttendanceCalendar(normalizedMonth, normalizedRows, monthLeaveDates, monthSpecialDays);
  const selectedDay = calendarDays.find((day) => day.date === activeSelectedDate) || null;
  const selectedRow = selectedDay?.row || null;
  const selectedSpecialDay = selectedDay?.specialDay || null;
  const selectedStatus = selectedDay?.status && selectedDay.status !== "—"
    ? selectedDay.status
    : selectedRow
      ? attendanceRowStatus(selectedRow)
      : "لا يوجد";
  const selectedHasApprovedLeave = approvedLeaveDateKeys.includes(activeSelectedDate) || selectedSpecialDay?.kind === "leave" || selectedSpecialDay?.kind === "rest";
  const selectedHasPunch = Boolean(selectedRow?.checkInAtClient || selectedRow?.checkOutAtClient);
  const effectiveShiftTone: "neutral" | "gold" | "success" | "danger" | "dark" =
    !effectiveShiftInfo?.tone || effectiveShiftInfo.tone === "default" ? "neutral" : effectiveShiftInfo.tone;
  const selectedShiftWindow = selectedRow?.scheduledStartTime || selectedRow?.scheduledEndTime
    ? `${selectedRow?.scheduledStartTime || "-"} - ${selectedRow?.scheduledEndTime || "-"}`
    : cleanText(effectiveShiftInfo?.timeLabel);
  const selectedShiftSource = cleanText(selectedRow?.shiftSourceLabel || effectiveShiftInfo?.sourceLabel);
  const selectedShiftStatus = cleanText(selectedRow?.shiftStatusLabel || effectiveShiftInfo?.statusLabel);
  const presentRows = rows.filter((row) => cleanText(row.checkInAtClient || row.checkOutAtClient)).length;
  const lateTotal = rows.reduce((sum, row) => sum + Number(row.lateMinutes || 0), 0);
  const leaveDays = calendarDays.filter((day) => day.status === "إجازة" || day.status === "راحة" || day.status === "إجازة أسبوعية" || day.status === "راحة / يوم استثنائي").length;
  const loadedDataCount = normalizedRows.length + monthLeaveDates.length + monthSpecialDays.length;
  const viewState: "loading" | "error" | "empty" | "data" = loading && !loadedDataCount
    ? "loading"
    : cleanText(error) && !loadedDataCount
      ? "error"
      : loadedDataCount
        ? "data"
        : "empty";
  const badgeTone = viewState === "error"
    ? "danger"
    : viewState === "loading"
      ? "gold"
      : viewState === "empty"
        ? "default"
        : "success";
  const badgeLabel = viewState === "loading"
    ? "تحميل"
    : viewState === "error"
      ? "تعذر التحميل"
      : viewState === "empty"
        ? "لا توجد سجلات"
      : "بيانات محملة";
  const drawerDate = cleanText(detailDrawerDate) || activeSelectedDate;
  const drawerDay = calendarDays.find((day) => day.date === drawerDate) || null;
  const drawerRow = drawerDay?.row || null;
  const drawerStatus = drawerDay?.status && drawerDay.status !== "—"
    ? drawerDay.status
    : drawerRow
      ? attendanceRowStatus(drawerRow)
      : "لا يوجد";
  const drawerShiftWindow = drawerRow?.scheduledStartTime || drawerRow?.scheduledEndTime
    ? `${drawerRow?.scheduledStartTime || "-"} - ${drawerRow?.scheduledEndTime || "-"}`
    : drawerDate === activeSelectedDate ? cleanText(effectiveShiftInfo?.timeLabel) : "";
  const drawerShiftSource = cleanText(drawerRow?.shiftSourceLabel || (drawerDate === activeSelectedDate ? effectiveShiftInfo?.sourceLabel : ""));
  const drawerShiftStatus = cleanText(drawerRow?.shiftStatusLabel || (drawerDate === activeSelectedDate ? effectiveShiftInfo?.statusLabel : ""));
  const handleMonthChange = (nextMonthKey: string) => {
    const normalizedNextMonth = safeMonthKey(nextMonthKey);
    onMonthChange(normalizedNextMonth);
    onSelectedDateChange(coerceDateToMonth(activeSelectedDate, normalizedNextMonth));
  };
  const handleSelectedDateChange = (nextDate: string) => {
    const cleanDate = cleanText(nextDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate) && !cleanDate.startsWith(normalizedMonth)) {
      onMonthChange(cleanDate.slice(0, 7));
    }
    onSelectedDateChange(cleanDate);
  };
  const openDayDetails = (nextDate: string) => {
    const cleanDate = cleanText(nextDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return;
    handleSelectedDateChange(cleanDate);
    setDetailDrawerDate(cleanDate);
  };
  const goToToday = () => handleSelectedDateChange(todayKey);
  const openTodayDetails = () => openDayDetails(todayKey);
  const closeDetailDrawer = () => setDetailDrawerDate("");

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الحضور"
        description="عرض وتعديل سجل الحضور من مكوّن V2 مستقل."
        badge={<WorkspaceStatusBadgeV2 tone={badgeTone}>{badgeLabel}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="أيام الشهر" value={calendarDays.length} />
        <WorkspaceMetricV2 label="أيام عليها بصمة" value={presentRows} tone="success" />
        <WorkspaceMetricV2 label="دقائق التأخير" value={lateTotal} tone={lateTotal ? "gold" : "neutral"} />
        <WorkspaceMetricV2 label="أيام الإجازة" value={leaveDays} tone={leaveDays ? "gold" : "neutral"} />
      </div>

      {cleanText(error) && loadedDataCount ? (
        <WorkspaceNoticeV2
          title="تعذر تحديث سجل الحضور"
          description={error}
          tone="danger"
          action={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={loading} onClick={onReload}>إعادة المحاولة</button>}
        />
      ) : null}

      <WorkspaceCardV2
        title="فلاتر الحضور"
        description="اختر الشهر وحدد اليوم المطلوب."
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="employee-live-v2-attendance-month" label="الشهر">
            <DashboardSelectV2
              id="employee-live-v2-attendance-month"
              value={normalizedMonth}
              disabled={readOnly || loading}
              options={buildMonthOptions(normalizedMonth)}
              onChange={handleMonthChange}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-attendance-date" label="اليوم">
            <DashboardDatePickerV2
              id="employee-live-v2-attendance-date"
              value={activeSelectedDate}
              disabled={readOnly || loading}
              clearable
              onChange={handleSelectedDateChange}
            />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="الشفت المطبق اليوم"
        description="المصدر الفعلي حسب أولوية: إجازة، استثناء، شفت محدد، جدول الموظفة، ثم دوام الصالون."
      >
        <div className="dsv2-ew-metrics">
          <WorkspaceMetricV2 label="المصدر" value={effectiveShiftInfo?.sourceLabel || "غير محدد"} note={effectiveShiftInfo?.sourceDetail || "يتم تحديده تلقائياً من البيانات"} tone={effectiveShiftTone} />
          <WorkspaceMetricV2 label="الوقت الفعلي" value={effectiveShiftInfo?.timeLabel || "-"} tone="dark" />
          <WorkspaceMetricV2 label="الحالة" value={effectiveShiftInfo?.statusLabel || "غير محدد"} tone={effectiveShiftTone} />
        </div>
      </WorkspaceCardV2>

      {viewState === "loading" ? (
        <WorkspaceCardV2 title="جاري تحميل الحضور" description="يتم تحميل سجلات الحضور الفعلية لهذا الشهر.">
          <article className="dsv2-ew-skeleton" aria-label="جاري تحميل سجل حضور الموظفة">
            <DashboardSkeletonV2 variant="title" width="46%" />
            <DashboardSkeletonV2 lines={3} />
            <DashboardSkeletonV2 variant="block" height={140} />
          </article>
        </WorkspaceCardV2>
      ) : viewState === "error" ? (
        <WorkspaceNoticeV2
          title="تعذر تحميل سجل الحضور"
          description={error || "تعذر تحميل سجل حضور الموظفة. أعد المحاولة بعد التحقق من الاتصال."}
          tone="danger"
          action={<button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={loading} onClick={onReload}>إعادة المحاولة</button>}
        />
      ) : viewState === "empty" ? (
        <WorkspaceCardV2 title="لا توجد سجلات حضور" description="لا توجد بصمات أو إجازات معتمدة في الشهر المحدد.">
          <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large">
            <strong>لا توجد سجلات لهذا الشهر</strong>
            <span>ستظهر البصمات والإجازات تلقائياً عند توفرها من نظام الحضور.</span>
          </div>
        </WorkspaceCardV2>
      ) : null}

      {viewState === "data" ? (
        <>
          <div className="dsv2-ew-attendance-board">
            <WorkspaceCardV2
              title={`تقويم ${formatMonthLabel(normalizedMonth)}`}
              description="اضغطي على أي يوم مسجل لفتح تفاصيله."
              actions={
                <div className="dsv2-cluster">
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={loading} onClick={goToToday} onDoubleClick={openTodayDetails}>اليوم</button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={loading} onClick={onReload}>تحديث</button>
                </div>
              }
              className="dsv2-ew-attendance-calendar-card"
            >
              <div className="dsv2-ew-calendar-head" aria-hidden="true">
                {AR_WEEKDAY_SHORT.map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="dsv2-ew-calendar dsv2-ew-attendance-month-grid">
                {calendarDays.map((day) => (
                  <button
                    key={day.date}
                    type="button"
                    className="dsv2-ew-calendar__day"
                    data-status={day.status}
                    data-special={day.specialDay?.kind || ""}
                    data-selected={activeSelectedDate === day.date ? "true" : "false"}
                    data-today={todayKey === day.date ? "true" : "false"}
                    onClick={() => handleSelectedDateChange(day.date)}
                    onDoubleClick={() => openDayDetails(day.date)}
                  >
                    <strong>{day.dayNumber}</strong>
                    <span>{day.status === "—" ? "-" : day.status}</span>
                    {day.specialDay && day.specialDay.label !== day.status ? (
                      <em className="dsv2-ew-calendar__special">{day.specialDay.label}</em>
                    ) : null}
                    <small>{day.timeLabel}</small>
                  </button>
                ))}
              </div>
            </WorkspaceCardV2>

            <WorkspaceCardV2
              title="تفاصيل اليوم المحدد"
              description={formatAttendanceDate(activeSelectedDate)}
              className="dsv2-ew-attendance-detail-card"
            >
              <div className="dsv2-ew-day-detail">
                <div className="dsv2-ew-day-detail__status">
                  <span>{attendanceReviewText(selectedStatus, selectedRow)}</span>
                  <WorkspaceStatusBadgeV2 tone={attendanceStatusTone(selectedStatus)}>
                    {selectedStatus}
                  </WorkspaceStatusBadgeV2>
                  {selectedSpecialDay && selectedSpecialDay.label !== selectedStatus ? (
                    <WorkspaceStatusBadgeV2 tone="gold">
                      {selectedSpecialDay.label}
                    </WorkspaceStatusBadgeV2>
                  ) : null}
                </div>

                <dl className="dsv2-ew-day-fields">
                  <div>
                    <dt>وقت الدخول</dt>
                    <dd>{formatAttendanceTime(selectedRow?.checkInAtClient) || "-"}</dd>
                  </div>
                  <div>
                    <dt>وقت الخروج</dt>
                    <dd>{formatAttendanceTime(selectedRow?.checkOutAtClient) || "-"}</dd>
                  </div>
                  <div>
                    <dt>الشفت الفعلي</dt>
                    <dd>
                      {selectedShiftWindow || "-"}
                      {selectedRow?.shiftName ? ` · ${selectedRow.shiftName}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>مصدر الشفت</dt>
                    <dd>{selectedShiftSource || "-"}</dd>
                  </div>
                  <div>
                    <dt>حالة الشفت</dt>
                    <dd>{selectedShiftStatus || "-"}</dd>
                  </div>
                  <div>
                    <dt>سماحية التأخير</dt>
                    <dd>{Number(selectedRow?.lateGraceMinutes || 0) ? `${formatNumber(selectedRow?.lateGraceMinutes)} د` : "0 د"}</dd>
                  </div>
                  <div>
                    <dt>الموقع</dt>
                    <dd>{cleanText(selectedRow?.workZoneName) || "-"}</dd>
                  </div>
                  <div>
                    <dt>السجلات</dt>
                    <dd>{selectedRow?.recordCount ? `${formatNumber(selectedRow.recordCount)} بصمة` : "-"}</dd>
                  </div>
                  <div>
                    <dt>الملاحظات</dt>
                    <dd>{cleanText(selectedRow?.notes) || "-"}</dd>
                  </div>
                </dl>

                <div className="dsv2-ew-action-grid">
                  <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={loading || !activeSelectedDate} onClick={onReload}>
                    مراجعة اليوم
                  </button>
                  <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={readOnly || !canEdit || !activeSelectedDate} onClick={() => activeSelectedDate && onEditPunch(activeSelectedDate)}>
                    تعديل البصمة
                  </button>
                  <button type="button" className="dsv2-btn dsv2-btn--danger" disabled={readOnly || !canDelete || !selectedRow?.date} onClick={() => selectedRow?.date && onDeletePunch(selectedRow.date)}>
                    حذف البصمة
                  </button>
                  {selectedHasApprovedLeave ? (
                    <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={readOnly || !canCancelLeave || !activeSelectedDate} onClick={() => activeSelectedDate && onCancelLeave?.(activeSelectedDate)}>
                      إلغاء الإجازة
                    </button>
                  ) : (
                    <button type="button" className="dsv2-btn dsv2-btn--secondary" disabled={readOnly || !canCreateEmergencyLeave || !activeSelectedDate || selectedHasPunch} onClick={() => activeSelectedDate && onCreateEmergencyLeave?.(activeSelectedDate)}>
                      تسجيل إجازة
                    </button>
                  )}
                </div>
              </div>
            </WorkspaceCardV2>
          </div>

          <DashboardDrawerV2
            open={Boolean(detailDrawerDate)}
            onClose={closeDetailDrawer}
            title="تفاصيل يوم الحضور"
            description="عرض البصمات والشفت والموقع والمراجعات."
            eyebrow={formatAttendanceDate(drawerDate)}
            size="md"
            side="end"
            tone={attendanceStatusTone(drawerStatus)}
            footer={
              <>
                <button type="button" className="dsv2-btn dsv2-btn--primary" disabled={readOnly || !canEdit || !drawerDate} onClick={() => drawerDate && onEditPunch(drawerDate)}>
                  تعديل البصمة
                </button>
                <button type="button" className="dsv2-btn dsv2-btn--secondary" onClick={closeDetailDrawer}>
                  إغلاق
                </button>
              </>
            }
          >
            <div className="dsv2-ew-drawer-content">
              <div className="dsv2-ew-metrics">
                <WorkspaceMetricV2 label="الدخول" value={formatAttendanceTime(drawerRow?.checkInAtClient) || "-"} tone={attendanceSurfaceTone(drawerStatus)} />
                <WorkspaceMetricV2 label="الخروج" value={formatAttendanceTime(drawerRow?.checkOutAtClient) || "-"} tone={drawerRow?.checkOutAtClient ? "success" : "neutral"} />
              </div>

              <WorkspaceTableV2
                headers={["الحدث", "الوقت", "المصدر", "الحالة"]}
                rows={[
                  ["دخول", formatAttendanceTime(drawerRow?.checkInAtClient) || "-", cleanText(drawerRow?.workZoneName) || "-", <WorkspaceStatusBadgeV2 key="in-status" tone={attendanceStatusTone(drawerStatus)}>{drawerStatus}</WorkspaceStatusBadgeV2>],
                  ["خروج", formatAttendanceTime(drawerRow?.checkOutAtClient) || "-", cleanText(drawerRow?.workZoneName) || "-", <WorkspaceStatusBadgeV2 key="out-status" tone={drawerRow?.checkOutAtClient ? "success" : "default"}>{drawerRow?.checkOutAtClient ? "مكتمل" : "غير مسجل"}</WorkspaceStatusBadgeV2>],
                ]}
              />

              <dl className="dsv2-ew-day-fields">
                <div>
                  <dt>الشفت الفعلي</dt>
                  <dd>
                    {drawerShiftWindow || "-"}
                    {drawerRow?.shiftName ? ` · ${drawerRow.shiftName}` : ""}
                  </dd>
                </div>
                <div>
                  <dt>مصدر الشفت</dt>
                  <dd>{drawerShiftSource || "-"}</dd>
                </div>
                <div>
                  <dt>حالة الشفت</dt>
                  <dd>{drawerShiftStatus || "-"}</dd>
                </div>
                <div>
                  <dt>سماحية التأخير</dt>
                  <dd>{Number(drawerRow?.lateGraceMinutes || 0) ? `${formatNumber(drawerRow?.lateGraceMinutes)} د` : "0 د"}</dd>
                </div>
                <div>
                  <dt>سماحية الخروج المبكر</dt>
                  <dd>{Number(drawerRow?.earlyLeaveGraceMinutes || 0) ? `${formatNumber(drawerRow?.earlyLeaveGraceMinutes)} د` : "0 د"}</dd>
                </div>
                <div>
                  <dt>الموقع</dt>
                  <dd>{cleanText(drawerRow?.workZoneName) || "-"}</dd>
                </div>
                <div>
                  <dt>السجلات</dt>
                  <dd>{drawerRow?.recordCount ? `${formatNumber(drawerRow.recordCount)} بصمة` : "-"}</dd>
                </div>
                <div>
                  <dt>الملاحظات</dt>
                  <dd>{cleanText(drawerRow?.notes) || "-"}</dd>
                </div>
              </dl>

              <WorkspaceNoticeV2
                title="ملاحظة المراجعة"
                description={attendanceReviewText(drawerStatus, drawerRow)}
                tone={attendanceSurfaceTone(drawerStatus)}
              />
            </div>
          </DashboardDrawerV2>

          <WorkspaceCardV2 title="سجل الشهر" description="السجلات المحملة للموظفة في الشهر الحالي.">
            <WorkspaceTableV2
              headers={["اليوم", "الحالة", "الحضور", "الانصراف", "الشفت", "التأخير", "إجراء"]}
              rows={normalizedRows.map((row) => {
                const date = cleanText(row.date);
                return [
                  date || "-",
                  attendanceRowStatus(row) || "-",
                  formatAttendanceTime(row.checkInAtClient) || "-",
                  formatAttendanceTime(row.checkOutAtClient) || "-",
                  [cleanText(row.shiftSourceLabel), cleanText(row.scheduledStartTime || row.scheduledEndTime ? `${row.scheduledStartTime || "-"} - ${row.scheduledEndTime || "-"}` : "")].filter(Boolean).join(" · ") || "-",
                  Number(row.lateMinutes || 0) ? `${formatNumber(row.lateMinutes)} د` : "-",
                  <div className="dsv2-cluster" key={`${date}-actions`}>
                    <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly || !canEdit || !date} onClick={() => onEditPunch(date)}>تعديل</button>
                    <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly || !canDelete || !date} onClick={() => onDeletePunch(date)}>حذف</button>
                  </div>,
                ];
              })}
              emptyText="لا توجد سجلات حضور في هذا الشهر."
            />
          </WorkspaceCardV2>
        </>
      ) : null}
    </div>
  );
}

export type EmployeePayrollTabLiveV2Props = {
  readOnly: boolean;
  monthlySalary: string;
  workDays: string;
  dailyHours: string;
  monthlyHours: string;
  overtimeEnabled: boolean;
  overtimeMultiplier: string;
  deductionMethod: string;
  savingSettings: boolean;
  settingsMessage?: string;
  onMonthlySalaryChange: (value: string) => void;
  onWorkDaysChange: (value: string) => void;
  onDailyHoursChange: (value: string) => void;
  onMonthlyHoursChange: (value: string) => void;
  onOvertimeEnabledChange: (value: boolean) => void;
  onOvertimeMultiplierChange: (value: string) => void;
  onDeductionMethodChange: (value: string) => void;
  onSaveSettings: () => void;
};

export function EmployeePayrollTabLiveV2({
  readOnly,
  monthlySalary,
  workDays,
  dailyHours,
  monthlyHours,
  overtimeEnabled,
  overtimeMultiplier,
  deductionMethod,
  savingSettings,
  settingsMessage,
  onMonthlySalaryChange,
  onWorkDaysChange,
  onDailyHoursChange,
  onMonthlyHoursChange,
  onOvertimeEnabledChange,
  onOvertimeMultiplierChange,
  onDeductionMethodChange,
  onSaveSettings,
}: EmployeePayrollTabLiveV2Props) {
  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="سجل الرواتب"
        description="إعدادات راتب الموظفة واحتساب الساعات والإضافي."
        badge={<WorkspaceStatusBadgeV2 tone={overtimeEnabled ? "success" : "gold"}>{overtimeEnabled ? "الإضافي مفعّل" : "الإضافي متوقف"}</WorkspaceStatusBadgeV2>}
      />

      <WorkspaceCardV2
        title="إعدادات الراتب"
        description="القيم التي تدخل في الحساب الشهري."
        actions={<button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" disabled={readOnly || savingSettings} onClick={onSaveSettings}>{savingSettings ? "حفظ..." : "حفظ الإعدادات"}</button>}
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
          <DashboardFieldV2 id="employee-live-v2-salary" label="الراتب الشهري">
            <input id="employee-live-v2-salary" className="dsv2-input" type="number" min="0" value={monthlySalary} disabled={readOnly} onChange={(event) => onMonthlySalaryChange(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-work-days" label="أيام العمل">
            <input id="employee-live-v2-work-days" className="dsv2-input" type="number" min="0" value={workDays} disabled={readOnly} onChange={(event) => onWorkDaysChange(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-daily-hours" label="ساعات اليوم">
            <input id="employee-live-v2-daily-hours" className="dsv2-input" type="number" min="0" value={dailyHours} disabled={readOnly} onChange={(event) => onDailyHoursChange(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-monthly-hours" label="ساعات الشهر">
            <input id="employee-live-v2-monthly-hours" className="dsv2-input" type="number" min="0" value={monthlyHours} disabled={readOnly} onChange={(event) => onMonthlyHoursChange(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-overtime-multiplier" label="معامل الإضافي">
            <input id="employee-live-v2-overtime-multiplier" className="dsv2-input" type="number" min="0" step="0.1" value={overtimeMultiplier} disabled={readOnly || !overtimeEnabled} onChange={(event) => onOvertimeMultiplierChange(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-deduction" label="طريقة الخصم">
            <DashboardSelectV2
              id="employee-live-v2-deduction"
              value={deductionMethod}
              disabled={readOnly}
              options={[
                { value: "daily", label: "حسب اليوم" },
                { value: "hourly", label: "حسب الساعة" },
                { value: "none", label: "بدون خصم تلقائي" },
              ]}
              onChange={onDeductionMethodChange}
            />
          </DashboardFieldV2>
        </div>

        <WorkspaceSwitchV2
          checked={overtimeEnabled}
          disabled={readOnly}
          label="تفعيل احتساب الإضافي"
          description="يعتمد على إعدادات الراتب والشفتات الحالية."
          onChange={onOvertimeEnabledChange}
        />

        {settingsMessage ? <WorkspaceNoticeV2 title="حالة الحفظ" description={settingsMessage} tone="success" /> : null}
      </WorkspaceCardV2>
    </div>
  );
}

export type EmployeeLinkedModuleTabLiveV2Props = {
  title: string;
  description: string;
  moduleLabel: string;
  actionLabel: string;
  actionHref: string;
  notes?: string[];
};

export function EmployeeLinkedModuleTabLiveV2({
  title,
  description,
  moduleLabel,
  actionLabel,
  actionHref,
  notes = [],
}: EmployeeLinkedModuleTabLiveV2Props) {
  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title={title}
        description={description}
        badge={<WorkspaceStatusBadgeV2 tone="gold">{moduleLabel}</WorkspaceStatusBadgeV2>}
      />

      <WorkspaceCardV2
        title={moduleLabel}
        description="يرتبط هذا التبويب بوحدة تشغيل مستقلة داخل النظام."
        actions={<a className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" href={actionHref}>{actionLabel}</a>}
      >
        {notes.length ? (
          <div className="dsv2-ew-note-list">
            {notes.map((note) => <span key={note}>{note}</span>)}
          </div>
        ) : (
          <WorkspaceNoticeV2 title="لا توجد ملاحظات إضافية" description="سيتم عرض البيانات عند ربط الوحدة المباشرة بهذا التبويب." tone="neutral" />
        )}
      </WorkspaceCardV2>
    </div>
  );
}
