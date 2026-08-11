import { useEffect, useMemo, useState, type RefObject } from "react";

import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import { EmployeeScheduleTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";
import {
  WorkspaceCardV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import WorkHourOverridesEditor, { type WorkHourOverridesEditorProps } from "./WorkHourOverridesEditor";
import { WEEKDAY_OPTIONS, normalizeTimeHHMM, type StaffWorkingDay, type WeekdayKey } from "./shared";
import type { WorkZone } from "../../services/attendanceSettingsService";
import { CoreHrService } from "../../services/CoreHrService";
import type { CoreShiftTemplate } from "../../types/hrCoreApi";

type BookingSettingsSectionProps = {
  isVisible: boolean;
  busy: boolean;
  loading: boolean;
  employmentEndDate: string;
  modalUseCustomWorkingHours: boolean;
  modalCustomWorkingHours: Record<WeekdayKey, StaffWorkingDay>;
  modalExceptionalLeaveWeekdays: WeekdayKey[];
  scheduleEffectiveFrom: string;
  scheduleChangeReason: string;
  scheduleVersionCount: number;
  attendanceZones: WorkZone[];
  attendanceZonesLoading: boolean;
  selectedAttendanceZoneId: string;
  modalHourOverrideHijriPickerRef: RefObject<HTMLDivElement | null>;
  overrideEditor: WorkHourOverridesEditorProps["editor"];
  onEmploymentEndDateChange: (value: string) => void;
  onModalUseCustomWorkingHoursChange: (value: boolean) => void;
  onScheduleEffectiveFromChange: (value: string) => void;
  onScheduleChangeReasonChange: (value: string) => void;
  onSelectedAttendanceZoneIdChange: (value: string) => void;
  onReloadAttendanceZones: () => void;
  onUpdateModalWorkingDay: (day: WeekdayKey, patch: StaffWorkingDay) => void;
  onCopyModalWorkingDayToAll: (day: WeekdayKey) => void;
};

type ResolvedWorkingDay = {
  enabled: boolean;
  shiftTemplateId: string;
  shiftName: string;
  start: string;
  end: string;
};

type TemporaryWeeklyOffGroup = {
  token: string;
  baseDay: WeekdayKey;
  temporaryDay: WeekdayKey;
  fromDate: string;
  toDate: string;
  count: number;
};

const TEMP_WEEKLY_OFF_PREFIX = "[TEMP_WEEKLY_OFF:";
const TEMP_WEEKLY_OFF_PATTERN = /^\[TEMP_WEEKLY_OFF:(sat|sun|mon|tue|wed|thu|fri):(sat|sun|mon|tue|wed|thu|fri):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\]/;
const WEEKDAY_INDEX: Record<WeekdayKey, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

function resolveWorkingDay(day: WeekdayKey, rows: Record<WeekdayKey, StaffWorkingDay>): ResolvedWorkingDay {
  const current = rows[day] || { enabled: true, start: "10:00", end: "22:00" };
  return {
    enabled: current.enabled !== false,
    shiftTemplateId: String(current.shiftTemplateId || "").trim(),
    shiftName: String(current.shiftName || "").trim(),
    start: normalizeTimeHHMM(current.start) || "10:00",
    end: normalizeTimeHHMM(current.end) || "22:00",
  };
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function weekdayDatesInRange(fromDate: string, toDate: string, weekday: WeekdayKey) {
  if (!isDateKey(fromDate) || !isDateKey(toDate) || fromDate > toDate) return [];
  const [fromYear, fromMonth, fromDay] = fromDate.split("-").map(Number);
  const [toYear, toMonth, toDay] = toDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(fromYear, fromMonth - 1, fromDay, 12));
  const end = new Date(Date.UTC(toYear, toMonth - 1, toDay, 12));
  const out: string[] = [];
  let guard = 0;

  while (cursor <= end && guard < 740) {
    if (cursor.getUTCDay() === WEEKDAY_INDEX[weekday]) {
      out.push(
        `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(cursor.getUTCDate()).padStart(2, "0")}`
      );
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}

function weekdayLabel(day: WeekdayKey) {
  return WEEKDAY_OPTIONS.find((option) => option.key === day)?.label || day;
}

function temporaryWeeklyOffToken(baseDay: WeekdayKey, temporaryDay: WeekdayKey, fromDate: string, toDate: string) {
  return `[TEMP_WEEKLY_OFF:${baseDay}:${temporaryDay}:${fromDate}:${toDate}]`;
}

function parseTemporaryWeeklyOffGroups(rows: Array<any>): TemporaryWeeklyOffGroup[] {
  const groups = new Map<string, TemporaryWeeklyOffGroup>();
  rows.forEach((row) => {
    const note = String(row?.note || "").trim();
    const match = TEMP_WEEKLY_OFF_PATTERN.exec(note);
    if (!match) return;
    const token = match[0];
    const current = groups.get(token);
    if (current) {
      current.count += 1;
      return;
    }
    groups.set(token, {
      token,
      baseDay: match[1] as WeekdayKey,
      temporaryDay: match[2] as WeekdayKey,
      fromDate: match[3],
      toDate: match[4],
      count: 1,
    });
  });
  return Array.from(groups.values()).sort((left, right) => left.fromDate.localeCompare(right.fromDate));
}

export default function BookingSettingsSection({
  isVisible,
  busy,
  loading,
  employmentEndDate,
  modalUseCustomWorkingHours,
  modalCustomWorkingHours,
  modalExceptionalLeaveWeekdays,
  scheduleEffectiveFrom,
  scheduleChangeReason,
  scheduleVersionCount,
  attendanceZones,
  attendanceZonesLoading,
  selectedAttendanceZoneId,
  modalHourOverrideHijriPickerRef,
  overrideEditor,
  onEmploymentEndDateChange,
  onModalUseCustomWorkingHoursChange,
  onScheduleEffectiveFromChange,
  onScheduleChangeReasonChange,
  onSelectedAttendanceZoneIdChange,
  onReloadAttendanceZones,
  onUpdateModalWorkingDay,
  onCopyModalWorkingDayToAll,
}: BookingSettingsSectionProps) {
  const [shiftTemplates, setShiftTemplates] = useState<CoreShiftTemplate[]>([]);
  const [shiftTemplatesLoading, setShiftTemplatesLoading] = useState(false);
  const [temporaryWeeklyOffDay, setTemporaryWeeklyOffDay] = useState<WeekdayKey | "">("");
  const [temporaryWeeklyOffFrom, setTemporaryWeeklyOffFrom] = useState("");
  const [temporaryWeeklyOffTo, setTemporaryWeeklyOffTo] = useState("");
  const [temporaryWeeklyOffMessage, setTemporaryWeeklyOffMessage] = useState("");
  const [temporaryWeeklyOffError, setTemporaryWeeklyOffError] = useState("");

  useEffect(() => {
    if (!isVisible) return;
    let alive = true;
    setShiftTemplatesLoading(true);
    CoreHrService.listShiftTemplates({ active: "all" })
      .then((rows) => {
        if (alive) setShiftTemplates(rows.filter((row) => row.active === true || row.active === 1));
      })
      .catch((error) => {
        console.warn("load shift templates for weekly schedule failed", error);
        if (alive) setShiftTemplates([]);
      })
      .finally(() => {
        if (alive) setShiftTemplatesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isVisible]);

  const templateByWindow = useMemo(() => {
    const rows = new Map<string, CoreShiftTemplate>();
    for (const template of shiftTemplates) {
      const key = `${normalizeTimeHHMM(template.startTime) || ""}|${normalizeTimeHHMM(template.endTime) || ""}`;
      if (key !== "|" && !rows.has(key)) rows.set(key, template);
    }
    return rows;
  }, [shiftTemplates]);

  useEffect(() => {
    if (!isVisible || shiftTemplatesLoading || shiftTemplates.length === 0) return;

    // Legacy employee schedules may contain only start/end snapshots without a
    // shiftTemplateId. The UI already resolves those snapshots to a template by
    // matching the time window. Keep the editable parent state in sync with the
    // exact template shown in the select so save validation and Core schedules
    // use the same source of truth as the visible UI.
    WEEKDAY_OPTIONS.forEach((day) => {
      const current = resolveWorkingDay(day.key, modalCustomWorkingHours);
      if (current.shiftTemplateId) return;

      const matchedTemplate = templateByWindow.get(`${current.start}|${current.end}`) || null;
      if (!matchedTemplate?.id) return;

      onUpdateModalWorkingDay(day.key, {
        ...current,
        shiftTemplateId: matchedTemplate.id,
        shiftName: String(matchedTemplate.name || current.shiftName || "").trim(),
        start: normalizeTimeHHMM(matchedTemplate.startTime) || current.start,
        end: normalizeTimeHHMM(matchedTemplate.endTime) || current.end,
      });
    });
  }, [
    isVisible,
    modalCustomWorkingHours,
    onUpdateModalWorkingDay,
    shiftTemplates,
    shiftTemplatesLoading,
    templateByWindow,
  ]);

  const weeklyOffDays = new Set(modalExceptionalLeaveWeekdays);
  const workingDays = WEEKDAY_OPTIONS.map((day) => {
    const row = resolveWorkingDay(day.key, modalCustomWorkingHours);
    const matchedTemplate = row.shiftTemplateId
      ? shiftTemplates.find((template) => template.id === row.shiftTemplateId) || null
      : templateByWindow.get(`${row.start}|${row.end}`) || null;
    return {
      key: day.key,
      label: day.label,
      enabled: modalUseCustomWorkingHours ? row.enabled : !weeklyOffDays.has(day.key),
      shiftTemplateId: matchedTemplate?.id || row.shiftTemplateId,
      shiftName: matchedTemplate?.name || row.shiftName,
      start: normalizeTimeHHMM(matchedTemplate?.startTime) || row.start,
      end: normalizeTimeHHMM(matchedTemplate?.endTime) || row.end,
    };
  });
  const baseWeeklyOffDays = workingDays.filter((day) => !day.enabled);
  const baseWeeklyOffDay = baseWeeklyOffDays.length === 1 ? baseWeeklyOffDays[0] : null;
  const temporaryOffDates = temporaryWeeklyOffDay
    ? weekdayDatesInRange(temporaryWeeklyOffFrom, temporaryWeeklyOffTo, temporaryWeeklyOffDay)
    : [];
  const temporaryWorkDates = baseWeeklyOffDay
    ? weekdayDatesInRange(temporaryWeeklyOffFrom, temporaryWeeklyOffTo, baseWeeklyOffDay.key)
    : [];
  const savedTemporaryWeeklyOffGroups = useMemo(
    () => parseTemporaryWeeklyOffGroups(overrideEditor.modalCustomHourOverrides || []),
    [overrideEditor.modalCustomHourOverrides]
  );

  const applyTemporaryWeeklyOff = () => {
    setTemporaryWeeklyOffMessage("");
    setTemporaryWeeklyOffError("");

    if (!baseWeeklyOffDay) {
      setTemporaryWeeklyOffError(
        baseWeeklyOffDays.length > 1
          ? "يوجد أكثر من يوم إجازة أسبوعية معتمد. يجب أن يكون هناك يوم معتمد واحد قبل إنشاء تغيير مؤقت."
          : "حدّد يوم الإجازة الأسبوعية المعتمد أولاً من الأسبوع التشغيلي."
      );
      return;
    }
    if (!temporaryWeeklyOffDay) {
      setTemporaryWeeklyOffError("اختر يوم الإجازة الأسبوعية المؤقت.");
      return;
    }
    if (temporaryWeeklyOffDay === baseWeeklyOffDay.key) {
      setTemporaryWeeklyOffError("اليوم المؤقت مطابق لليوم المعتمد حاليًا؛ اختر يومًا مختلفًا.");
      return;
    }
    if (!isDateKey(temporaryWeeklyOffFrom) || !isDateKey(temporaryWeeklyOffTo)) {
      setTemporaryWeeklyOffError("حدد تاريخ البداية والنهاية للتغيير المؤقت.");
      return;
    }
    if (temporaryWeeklyOffFrom > temporaryWeeklyOffTo) {
      setTemporaryWeeklyOffError("تاريخ النهاية يجب أن يكون مساويًا لتاريخ البداية أو بعده.");
      return;
    }
    if (!temporaryOffDates.length && !temporaryWorkDates.length) {
      setTemporaryWeeklyOffError("لا توجد أيام مطابقة داخل الفترة المختارة.");
      return;
    }

    const token = temporaryWeeklyOffToken(
      baseWeeklyOffDay.key,
      temporaryWeeklyOffDay,
      temporaryWeeklyOffFrom,
      temporaryWeeklyOffTo
    );
    const affectedDates = new Set([...temporaryOffDates, ...temporaryWorkDates]);
    const currentOverrides = Array.isArray(overrideEditor.modalCustomHourOverrides)
      ? overrideEditor.modalCustomHourOverrides
      : [];
    const conflictingOverrides = currentOverrides.filter((row: any) => {
      const date = String(row?.date || "").trim();
      const note = String(row?.note || "").trim();
      return affectedDates.has(date) && !note.startsWith(TEMP_WEEKLY_OFF_PREFIX);
    });
    if (conflictingOverrides.length) {
      setTemporaryWeeklyOffError(
        `يوجد ${conflictingOverrides.length} استثناء دوام آخر على أحد الأيام المتأثرة. راجعه أولاً حتى لا نستبدل قرارًا مختلفًا بالخطأ.`
      );
      return;
    }

    const preservedOverrides = currentOverrides.filter((row: any) => {
      const date = String(row?.date || "").trim();
      const note = String(row?.note || "").trim();
      return !(affectedDates.has(date) && note.startsWith(TEMP_WEEKLY_OFF_PREFIX));
    });
    const baseStart = normalizeTimeHHMM(baseWeeklyOffDay.start) || "10:00";
    const baseEnd = normalizeTimeHHMM(baseWeeklyOffDay.end) || "22:00";
    const newOverrides = [
      ...temporaryOffDates.map((date) => ({
        date,
        enabled: false,
        note: `${token} إجازة أسبوعية مؤقتة: ${weekdayLabel(temporaryWeeklyOffDay)} بدلاً من ${baseWeeklyOffDay.label}`,
      })),
      ...temporaryWorkDates.map((date) => ({
        date,
        enabled: true,
        start: baseStart,
        end: baseEnd,
        note: `${token} يوم عمل بديل عن الإجازة الأسبوعية المعتمدة (${baseWeeklyOffDay.label})`,
      })),
    ].sort((left, right) => left.date.localeCompare(right.date));

    overrideEditor.setModalCustomHourOverrides(
      [...preservedOverrides, ...newOverrides].sort((left: any, right: any) =>
        String(left?.date || "").localeCompare(String(right?.date || ""))
      )
    );
    setTemporaryWeeklyOffMessage(
      `تم تجهيز التغيير: ${weekdayLabel(temporaryWeeklyOffDay)} إجازة خلال الفترة، و${baseWeeklyOffDay.label} يصبح يوم عمل داخل نفس الفترة فقط. بعد ${temporaryWeeklyOffTo} يعود ${baseWeeklyOffDay.label} إجازة أسبوعية تلقائيًا. اضغط «حفظ التغييرات» لاعتمادها.`
    );
  };

  const removeTemporaryWeeklyOff = (group: TemporaryWeeklyOffGroup) => {
    const currentOverrides = Array.isArray(overrideEditor.modalCustomHourOverrides)
      ? overrideEditor.modalCustomHourOverrides
      : [];
    overrideEditor.setModalCustomHourOverrides(
      currentOverrides.filter((row: any) => !String(row?.note || "").trim().startsWith(group.token))
    );
    setTemporaryWeeklyOffError("");
    setTemporaryWeeklyOffMessage(
      `تمت إزالة التغيير المؤقت ${weekdayLabel(group.temporaryDay)} بدل ${weekdayLabel(group.baseDay)}. اضغط «حفظ التغييرات» لاعتماد الإزالة.`
    );
  };

  if (!isVisible) return null;

  return (
    <section className="dsv2-ew-tab-panel">
      <EmployeeScheduleTabLiveV2
        readOnly={busy}
        loading={loading}
        employmentEndDate={employmentEndDate}
        useCustomWorkingHours={modalUseCustomWorkingHours}
        workingDays={workingDays}
        shiftTemplates={shiftTemplates}
        shiftTemplatesLoading={shiftTemplatesLoading}
        attendanceZones={attendanceZones.map((zone) => ({
          id: zone.id,
          name: `${zone.name || zone.id}${zone.active ? "" : " - غير نشط"}${zone.radiusMeters ? ` - ${zone.radiusMeters} م` : ""}`,
        }))}
        attendanceZonesLoading={attendanceZonesLoading}
        selectedAttendanceZoneId={selectedAttendanceZoneId}
        scheduleEffectiveFrom={scheduleEffectiveFrom}
        scheduleChangeReason={scheduleChangeReason || (scheduleVersionCount > 0 ? "" : "أول نسخة")}
        onEmploymentEndDateChange={onEmploymentEndDateChange}
        onUseCustomWorkingHoursChange={onModalUseCustomWorkingHoursChange}
        onSelectedAttendanceZoneIdChange={onSelectedAttendanceZoneIdChange}
        onScheduleEffectiveFromChange={onScheduleEffectiveFromChange}
        onScheduleChangeReasonChange={onScheduleChangeReasonChange}
        onReloadAttendanceZones={onReloadAttendanceZones}
        onCopyWorkingDayToAll={(dayKey) => onCopyModalWorkingDayToAll(dayKey as WeekdayKey)}
        onWorkingDayChange={(dayKey, patch) => {
          const typedDay = dayKey as WeekdayKey;
          const current = resolveWorkingDay(typedDay, modalCustomWorkingHours);
          onUpdateModalWorkingDay(typedDay, {
            ...current,
            ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
            ...(patch.shiftTemplateId !== undefined ? { shiftTemplateId: patch.shiftTemplateId } : {}),
            ...(patch.shiftName !== undefined ? { shiftName: patch.shiftName } : {}),
            ...(patch.start !== undefined ? { start: patch.start } : {}),
            ...(patch.end !== undefined ? { end: patch.end } : {}),
          });
        }}
      />

      <WorkspaceCardV2
        title="تغيير يوم الإجازة الأسبوعية لفترة محددة"
        description="غيّر يوم الإجازة الأسبوعية مؤقتًا بين تاريخين، وبعد انتهاء الفترة يعود تلقائيًا إلى اليوم المعتمد."
        actions={
          baseWeeklyOffDay ? (
            <WorkspaceStatusBadgeV2 tone="gold">اليوم المعتمد: {baseWeeklyOffDay.label}</WorkspaceStatusBadgeV2>
          ) : (
            <WorkspaceStatusBadgeV2 tone="danger">اليوم المعتمد غير محدد</WorkspaceStatusBadgeV2>
          )
        }
      >
        <WorkspaceNoticeV2
          title={baseWeeklyOffDay ? `الإجازة الأسبوعية المعتمدة حاليًا: ${baseWeeklyOffDay.label}` : "حدد يوم الإجازة المعتمد أولاً"}
          description={
            baseWeeklyOffDay
              ? "التغيير هنا لا يمسح الجدول الأساسي. داخل الفترة فقط يصبح اليوم الجديد إجازة، واليوم المعتمد يرجع يوم عمل، وبعد النهاية يعود الجدول الأساسي تلقائيًا."
              : "عطّل يومًا واحدًا من الأسبوع التشغيلي ليصبح الإجازة الأسبوعية المعتمدة، ثم استخدم هذا القسم للتغييرات المؤقتة."
          }
          tone={baseWeeklyOffDay ? "neutral" : "gold"}
        />

        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
          <DashboardFieldV2 id="employee-temp-weekly-off-day" label="اليوم المؤقت" required>
            <DashboardSelectV2
              id="employee-temp-weekly-off-day"
              value={temporaryWeeklyOffDay}
              disabled={busy || !baseWeeklyOffDay}
              placeholder="اختر اليوم"
              options={WEEKDAY_OPTIONS.map((day) => ({
                value: day.key,
                label: day.label,
                disabled: day.key === baseWeeklyOffDay?.key,
              }))}
              onChange={(value) => {
                setTemporaryWeeklyOffDay(value as WeekdayKey);
                setTemporaryWeeklyOffMessage("");
                setTemporaryWeeklyOffError("");
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-temp-weekly-off-from" label="من تاريخ" required>
            <DashboardDatePickerV2
              id="employee-temp-weekly-off-from"
              value={temporaryWeeklyOffFrom}
              disabled={busy || !baseWeeklyOffDay}
              clearable
              onChange={(value) => {
                setTemporaryWeeklyOffFrom(value);
                if (!temporaryWeeklyOffTo || value > temporaryWeeklyOffTo) setTemporaryWeeklyOffTo(value);
                setTemporaryWeeklyOffMessage("");
                setTemporaryWeeklyOffError("");
              }}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-temp-weekly-off-to" label="إلى تاريخ" required>
            <DashboardDatePickerV2
              id="employee-temp-weekly-off-to"
              value={temporaryWeeklyOffTo}
              disabled={busy || !baseWeeklyOffDay}
              min={temporaryWeeklyOffFrom || undefined}
              clearable
              onChange={(value) => {
                setTemporaryWeeklyOffTo(value);
                setTemporaryWeeklyOffMessage("");
                setTemporaryWeeklyOffError("");
              }}
            />
          </DashboardFieldV2>
        </div>

        {baseWeeklyOffDay && temporaryWeeklyOffDay && isDateKey(temporaryWeeklyOffFrom) && isDateKey(temporaryWeeklyOffTo) && temporaryWeeklyOffFrom <= temporaryWeeklyOffTo ? (
          <WorkspaceNoticeV2
            title="معاينة التغيير"
            description={`${weekdayLabel(temporaryWeeklyOffDay)}: ${temporaryOffDates.length} أيام إجازة مؤقتة. ${baseWeeklyOffDay.label}: ${temporaryWorkDates.length} أيام عمل بديلة داخل الفترة. بعد ${temporaryWeeklyOffTo} يعود ${baseWeeklyOffDay.label} إجازة أسبوعية كما هو في الجدول الأساسي.`}
            tone="gold"
          />
        ) : null}

        <div className="dsv2-cluster">
          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary"
            disabled={busy || !baseWeeklyOffDay || !temporaryWeeklyOffDay || !temporaryWeeklyOffFrom || !temporaryWeeklyOffTo}
            onClick={applyTemporaryWeeklyOff}
          >
            تطبيق التغيير المؤقت
          </button>
        </div>

        {temporaryWeeklyOffMessage ? (
          <WorkspaceNoticeV2 title="تم تجهيز التغيير" description={temporaryWeeklyOffMessage} tone="success" />
        ) : null}
        {temporaryWeeklyOffError ? (
          <WorkspaceNoticeV2 title="تعذر تطبيق التغيير" description={temporaryWeeklyOffError} tone="danger" />
        ) : null}

        {savedTemporaryWeeklyOffGroups.length ? (
          <div className="dsv2-stack dsv2-stack--sm">
            <strong className="dsv2-section-title">التغييرات المؤقتة المسجلة</strong>
            {savedTemporaryWeeklyOffGroups.map((group) => (
              <div key={group.token} className="dsv2-ew-selected-item">
                <div>
                  <strong>{weekdayLabel(group.temporaryDay)} بدل {weekdayLabel(group.baseDay)}</strong>
                  <small>{group.fromDate} إلى {group.toDate} · {group.count} سجل يومي</small>
                </div>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                  disabled={busy}
                  onClick={() => removeTemporaryWeeklyOff(group)}
                >
                  إزالة التغيير
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </WorkspaceCardV2>

      {modalUseCustomWorkingHours ? (
        <WorkHourOverridesEditor
          loading={loading}
          busy={busy}
          editor={overrideEditor}
          modalHourOverrideHijriPickerRef={modalHourOverrideHijriPickerRef}
        />
      ) : null}
    </section>
  );
}
