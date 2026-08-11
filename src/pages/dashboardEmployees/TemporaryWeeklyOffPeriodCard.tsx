import { useMemo, useState } from "react";

import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import {
  dashboardEmployeeIdFromPath,
  removeTemporaryWeeklyOff,
  saveTemporaryWeeklyOff,
  TEMP_WEEKLY_OFF_PREFIX,
  type TemporaryWeeklyOffOverride,
} from "../../services/temporaryWeeklyOffService";
import {
  WEEKDAY_OPTIONS,
  normalizeTimeHHMM,
  type StaffWorkingHourOverride,
  type WeekdayKey,
} from "./shared";

type WorkingDayView = {
  key: WeekdayKey;
  label: string;
  enabled: boolean;
  shiftTemplateId?: string;
  shiftName?: string;
  start: string;
  end: string;
};

type TemporaryWeeklyOffGroup = {
  token: string;
  baseDay: WeekdayKey;
  temporaryDay: WeekdayKey;
  fromDate: string;
  toDate: string;
};

type TemporaryWeeklyOffPeriodCardProps = {
  busy: boolean;
  workingDays: WorkingDayView[];
  overrides: StaffWorkingHourOverride[];
  onOverridesChange: (rows: StaffWorkingHourOverride[]) => void;
};

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

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function weekdayLabel(day: WeekdayKey) {
  return WEEKDAY_OPTIONS.find((option) => option.key === day)?.label || day;
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

function temporaryWeeklyOffToken(baseDay: WeekdayKey, temporaryDay: WeekdayKey, fromDate: string, toDate: string) {
  return `[TEMP_WEEKLY_OFF:${baseDay}:${temporaryDay}:${fromDate}:${toDate}]`;
}

function parseTemporaryWeeklyOffGroups(rows: StaffWorkingHourOverride[]) {
  const groups = new Map<string, TemporaryWeeklyOffGroup>();
  rows.forEach((row) => {
    const note = String(row?.note || "").trim();
    const match = TEMP_WEEKLY_OFF_PATTERN.exec(note);
    if (!match || groups.has(match[0])) return;
    groups.set(match[0], {
      token: match[0],
      baseDay: match[1] as WeekdayKey,
      temporaryDay: match[2] as WeekdayKey,
      fromDate: match[3],
      toDate: match[4],
    });
  });
  return Array.from(groups.values()).sort((left, right) => left.fromDate.localeCompare(right.fromDate));
}

export default function TemporaryWeeklyOffPeriodCard({
  busy,
  workingDays,
  overrides,
  onOverridesChange,
}: TemporaryWeeklyOffPeriodCardProps) {
  const [temporaryDay, setTemporaryDay] = useState<WeekdayKey | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const baseOffDays = workingDays.filter((day) => !day.enabled);
  const baseOffDay = baseOffDays.length === 1 ? baseOffDays[0] : null;
  const temporaryOffDates = temporaryDay ? weekdayDatesInRange(fromDate, toDate, temporaryDay) : [];
  const temporaryWorkDates = baseOffDay ? weekdayDatesInRange(fromDate, toDate, baseOffDay.key) : [];
  const savedGroups = useMemo(() => parseTemporaryWeeklyOffGroups(overrides || []), [overrides]);
  const employeeId = dashboardEmployeeIdFromPath();

  const applyChange = async () => {
    setMessage("");
    setError("");

    if (!baseOffDay) {
      setError(
        baseOffDays.length > 1
          ? "يوجد أكثر من يوم إجازة أسبوعية معتمد. يجب أن يكون هناك يوم معتمد واحد قبل إنشاء تغيير مؤقت."
          : "حدّد يوم الإجازة الأسبوعية المعتمد أولاً من الأسبوع التشغيلي."
      );
      return;
    }
    if (!temporaryDay) {
      setError("اختر يوم الإجازة الأسبوعية المؤقت.");
      return;
    }
    if (temporaryDay === baseOffDay.key) {
      setError("اليوم المؤقت مطابق لليوم المعتمد حاليًا؛ اختر يومًا مختلفًا.");
      return;
    }
    if (!isDateKey(fromDate) || !isDateKey(toDate)) {
      setError("حدد تاريخ البداية والنهاية للتغيير المؤقت.");
      return;
    }
    if (fromDate > toDate) {
      setError("تاريخ النهاية يجب أن يكون مساويًا لتاريخ البداية أو بعده.");
      return;
    }
    if (!employeeId) {
      setError("تعذر تحديد الموظفة من رابط الصفحة. افتح ملف الموظفة ثم أعد المحاولة.");
      return;
    }
    if (!temporaryOffDates.length && !temporaryWorkDates.length) {
      setError("لا توجد أيام مطابقة داخل الفترة المختارة.");
      return;
    }

    const token = temporaryWeeklyOffToken(baseOffDay.key, temporaryDay, fromDate, toDate);
    const affectedDates = new Set([...temporaryOffDates, ...temporaryWorkDates]);
    const currentOverrides = Array.isArray(overrides) ? overrides : [];
    const conflicts = currentOverrides.filter((row) => {
      const date = String(row?.date || "").trim();
      const note = String(row?.note || "").trim();
      return affectedDates.has(date) && !note.startsWith(TEMP_WEEKLY_OFF_PREFIX);
    });
    if (conflicts.length) {
      setError(`يوجد ${conflicts.length} استثناء دوام آخر على أحد الأيام المتأثرة. راجعه أولاً حتى لا نستبدل قرارًا مختلفًا بالخطأ.`);
      return;
    }

    const preserved = currentOverrides.filter((row) => {
      const date = String(row?.date || "").trim();
      const note = String(row?.note || "").trim();
      return !(affectedDates.has(date) && note.startsWith(TEMP_WEEKLY_OFF_PREFIX));
    });
    const workStart = normalizeTimeHHMM(baseOffDay.start) || "10:00";
    const workEnd = normalizeTimeHHMM(baseOffDay.end) || "22:00";
    const generated: TemporaryWeeklyOffOverride[] = [
      ...temporaryOffDates.map((date) => ({
        date,
        enabled: false,
        note: `${token} TEMP_OFF | ${weekdayLabel(temporaryDay)} إجازة مؤقتة بدل ${baseOffDay.label}`,
      })),
      ...temporaryWorkDates.map((date) => ({
        date,
        enabled: true,
        start: workStart,
        end: workEnd,
        note: `${token} TEMP_WORK | ${baseOffDay.label} يوم عمل داخل الفترة المؤقتة`,
      })),
    ].sort((left, right) => left.date.localeCompare(right.date));
    const nextOverrides = [...preserved, ...generated].sort((left, right) =>
      String(left?.date || "").localeCompare(String(right?.date || ""))
    );

    setSaving(true);
    try {
      const result = await saveTemporaryWeeklyOff({
        employeeId,
        token,
        affectedDates: Array.from(affectedDates),
        offDates: temporaryOffDates,
        workDates: temporaryWorkDates,
        workStart,
        workEnd,
        nextOverrides,
      });
      onOverridesChange(nextOverrides as StaffWorkingHourOverride[]);
      setMessage(
        `تم الحفظ. ${weekdayLabel(temporaryDay)} إجازة داخل الفترة، و${baseOffDay.label} يوم عمل بديل. بعد ${toDate} يعود ${baseOffDay.label} إجازة أسبوعية تلقائيًا. تمت مزامنة ${result.createdCoreExceptions} يومًا مع Core.`
      );
    } catch (saveError) {
      setError(String((saveError as Error)?.message || "تعذر حفظ تغيير الإجازة الأسبوعية المؤقت."));
    } finally {
      setSaving(false);
    }
  };

  const removeChange = async (group: TemporaryWeeklyOffGroup) => {
    setMessage("");
    setError("");
    if (!employeeId) {
      setError("تعذر تحديد الموظفة من رابط الصفحة.");
      return;
    }
    if (!window.confirm(`إزالة تغيير ${weekdayLabel(group.temporaryDay)} بدل ${weekdayLabel(group.baseDay)} للفترة ${group.fromDate} إلى ${group.toDate}؟`)) {
      return;
    }

    const nextOverrides = (overrides || []).filter((row) =>
      !String(row?.note || "").trim().startsWith(group.token)
    );
    setSaving(true);
    try {
      await removeTemporaryWeeklyOff({
        employeeId,
        token: group.token,
        nextOverrides,
      });
      onOverridesChange(nextOverrides);
      setMessage(`تمت إزالة التغيير المؤقت. عاد ${weekdayLabel(group.baseDay)} إلى الجدول الأسبوعي المعتمد.`);
    } catch (removeError) {
      setError(String((removeError as Error)?.message || "تعذر إزالة التغيير المؤقت."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <WorkspaceCardV2
      title="تغيير يوم الإجازة الأسبوعية لفترة محددة"
      description="غيّر يوم الإجازة الأسبوعية مؤقتًا بين تاريخين، وبعد انتهاء الفترة يعود تلقائيًا إلى اليوم المعتمد."
      actions={
        baseOffDay ? (
          <WorkspaceStatusBadgeV2 tone="gold">اليوم المعتمد: {baseOffDay.label}</WorkspaceStatusBadgeV2>
        ) : (
          <WorkspaceStatusBadgeV2 tone="danger">اليوم المعتمد غير محدد</WorkspaceStatusBadgeV2>
        )
      }
    >
      <WorkspaceNoticeV2
        title={baseOffDay ? `الإجازة الأسبوعية المعتمدة حاليًا: ${baseOffDay.label}` : "حدد يوم الإجازة المعتمد أولاً"}
        description={
          baseOffDay
            ? "داخل الفترة فقط يصبح اليوم الجديد إجازة، واليوم المعتمد يصبح يوم عمل. بعد تاريخ النهاية يرجع الجدول الأسبوعي الأساسي تلقائيًا."
            : "عطّل يومًا واحدًا من الأسبوع التشغيلي ليكون اليوم المعتمد، ثم استخدم هذا القسم للتغييرات المؤقتة."
        }
        tone={baseOffDay ? "neutral" : "gold"}
      />

      <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
        <DashboardFieldV2 id="employee-temp-weekly-off-day" label="اليوم المؤقت" required>
          <DashboardSelectV2
            id="employee-temp-weekly-off-day"
            value={temporaryDay}
            disabled={busy || saving || !baseOffDay}
            placeholder="اختر اليوم"
            options={WEEKDAY_OPTIONS.map((day) => ({
              value: day.key,
              label: day.label,
              disabled: day.key === baseOffDay?.key,
            }))}
            onChange={(value) => {
              setTemporaryDay(value as WeekdayKey);
              setMessage("");
              setError("");
            }}
          />
        </DashboardFieldV2>

        <DashboardFieldV2 id="employee-temp-weekly-off-from" label="من تاريخ" required>
          <DashboardDatePickerV2
            id="employee-temp-weekly-off-from"
            value={fromDate}
            disabled={busy || saving || !baseOffDay}
            clearable
            onChange={(value) => {
              setFromDate(value);
              if (!toDate || value > toDate) setToDate(value);
              setMessage("");
              setError("");
            }}
          />
        </DashboardFieldV2>

        <DashboardFieldV2 id="employee-temp-weekly-off-to" label="إلى تاريخ" required>
          <DashboardDatePickerV2
            id="employee-temp-weekly-off-to"
            value={toDate}
            disabled={busy || saving || !baseOffDay}
            min={fromDate || undefined}
            clearable
            onChange={(value) => {
              setToDate(value);
              setMessage("");
              setError("");
            }}
          />
        </DashboardFieldV2>
      </div>

      {baseOffDay && temporaryDay && isDateKey(fromDate) && isDateKey(toDate) && fromDate <= toDate ? (
        <WorkspaceNoticeV2
          title="معاينة قبل الحفظ"
          description={`${weekdayLabel(temporaryDay)}: ${temporaryOffDates.length} أيام إجازة. ${baseOffDay.label}: ${temporaryWorkDates.length} أيام عمل بديلة داخل الفترة. بعد ${toDate} يعود ${baseOffDay.label} إجازة أسبوعية.`}
          tone="gold"
        />
      ) : null}

      <div className="dsv2-cluster">
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary"
          disabled={busy || saving || !baseOffDay || !temporaryDay || !fromDate || !toDate}
          onClick={() => void applyChange()}
        >
          {saving ? "جاري الحفظ..." : "حفظ التغيير المؤقت"}
        </button>
      </div>

      {message ? <WorkspaceNoticeV2 title="تم التحديث" description={message} tone="success" /> : null}
      {error ? <WorkspaceNoticeV2 title="تعذر تنفيذ التغيير" description={error} tone="danger" /> : null}

      {savedGroups.length ? (
        <div className="dsv2-stack dsv2-stack--sm">
          <strong className="dsv2-section-title">التغييرات المؤقتة المسجلة</strong>
          {savedGroups.map((group) => (
            <div key={group.token} className="dsv2-ew-selected-item">
              <div>
                <strong>{weekdayLabel(group.temporaryDay)} بدل {weekdayLabel(group.baseDay)}</strong>
                <small>{group.fromDate} إلى {group.toDate} · يعود بعدها إلى {weekdayLabel(group.baseDay)}</small>
              </div>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                disabled={busy || saving}
                onClick={() => void removeChange(group)}
              >
                إزالة التغيير
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </WorkspaceCardV2>
  );
}
