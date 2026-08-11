import { useMemo, useState } from "react";

import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
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

type TemporaryWeeklyOffMode = "change" | "suspend";

type TemporaryWeeklyOffGroup = {
  token: string;
  baseDay: WeekdayKey;
  mode: TemporaryWeeklyOffMode;
  temporaryDay: WeekdayKey | null;
  fromDate: string;
  toDate: string;
};

type TemporaryWeeklyOffPeriodCardProps = {
  busy: boolean;
  workingDays: WorkingDayView[];
  overrides: StaffWorkingHourOverride[];
  onOverridesChange: (rows: StaffWorkingHourOverride[]) => void;
};

const TEMP_WEEKLY_OFF_PATTERN = /^\[TEMP_WEEKLY_OFF:(sat|sun|mon|tue|wed|thu|fri):(sat|sun|mon|tue|wed|thu|fri|none):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})\]/;
const TEMP_WEEKLY_OFF_SYNC_EVENT = "queens:temporary-weekly-off-updated";
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

function notifyTemporaryWeeklyOffUpdated(input: {
  employeeId: string;
  overrides: StaffWorkingHourOverride[];
  offDates: string[];
  workDates: string[];
}) {
  window.dispatchEvent(
    new CustomEvent(TEMP_WEEKLY_OFF_SYNC_EVENT, {
      detail: input,
    })
  );
}

function temporaryWeeklyOffToken(
  baseDay: WeekdayKey,
  mode: TemporaryWeeklyOffMode,
  temporaryDay: WeekdayKey | "",
  fromDate: string,
  toDate: string
) {
  const target = mode === "suspend" ? "none" : temporaryDay;
  return `[TEMP_WEEKLY_OFF:${baseDay}:${target}:${fromDate}:${toDate}]`;
}

function parseTemporaryWeeklyOffGroups(rows: StaffWorkingHourOverride[]) {
  const groups = new Map<string, TemporaryWeeklyOffGroup>();
  rows.forEach((row) => {
    const note = String(row?.note || "").trim();
    const match = TEMP_WEEKLY_OFF_PATTERN.exec(note);
    if (!match || groups.has(match[0])) return;
    const target = match[2];
    groups.set(match[0], {
      token: match[0],
      baseDay: match[1] as WeekdayKey,
      mode: target === "none" ? "suspend" : "change",
      temporaryDay: target === "none" ? null : target as WeekdayKey,
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
  const [mode, setMode] = useState<TemporaryWeeklyOffMode>("change");
  const [temporaryDay, setTemporaryDay] = useState<WeekdayKey | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const baseOffDays = workingDays.filter((day) => !day.enabled);
  const baseOffDay = baseOffDays.length === 1 ? baseOffDays[0] : null;
  const temporaryOffDates = mode === "change" && temporaryDay
    ? weekdayDatesInRange(fromDate, toDate, temporaryDay)
    : [];
  const temporaryWorkDates = baseOffDay ? weekdayDatesInRange(fromDate, toDate, baseOffDay.key) : [];
  const savedGroups = useMemo(() => parseTemporaryWeeklyOffGroups(overrides || []), [overrides]);
  const employeeId = dashboardEmployeeIdFromPath();

  const applyChange = async () => {
    setMessage("");
    setError("");

    if (!baseOffDay) {
      setError(
        baseOffDays.length > 1
          ? "يوجد أكثر من يوم إجازة أسبوعية أساسي. يجب أن يكون هناك يوم واحد قبل إنشاء استثناء مؤقت."
          : "حدّد يوم الإجازة الأسبوعية الأساسي أولاً من الأسبوع التشغيلي."
      );
      return;
    }
    if (mode === "change" && !temporaryDay) {
      setError("اختر يوم الإجازة الأسبوعية المؤقت.");
      return;
    }
    if (mode === "change" && temporaryDay === baseOffDay.key) {
      setError("اليوم المؤقت مطابق لليوم الأساسي؛ اختر يومًا مختلفًا.");
      return;
    }
    if (!isDateKey(fromDate) || !isDateKey(toDate)) {
      setError("حدد تاريخ البداية والنهاية للفترة المؤقتة.");
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

    const token = temporaryWeeklyOffToken(baseOffDay.key, mode, temporaryDay, fromDate, toDate);
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
        note: `${token} TEMP_OFF | ${weekdayLabel(temporaryDay as WeekdayKey)} إجازة مؤقتة بدل ${baseOffDay.label}`,
      })),
      ...temporaryWorkDates.map((date) => ({
        date,
        enabled: true,
        start: workStart,
        end: workEnd,
        note: mode === "suspend"
          ? `${token} TEMP_WORK | ${baseOffDay.label} يوم عمل لأن الإجازة الأسبوعية موقوفة مؤقتًا`
          : `${token} TEMP_WORK | ${baseOffDay.label} يوم عمل داخل فترة تغيير الإجازة`,
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
      notifyTemporaryWeeklyOffUpdated({
        employeeId,
        overrides: nextOverrides as StaffWorkingHourOverride[],
        offDates: temporaryOffDates,
        workDates: temporaryWorkDates,
      });
      setMessage(
        mode === "suspend"
          ? `تم إيقاف ${baseOffDay.label} كإجازة أسبوعية خلال الفترة. بعد ${toDate} يعود ${baseOffDay.label} إجازة أسبوعية تلقائيًا. تمت مزامنة ${result.createdCoreExceptions} يومًا مع Core.`
          : `تم الحفظ. ${weekdayLabel(temporaryDay as WeekdayKey)} إجازة داخل الفترة، و${baseOffDay.label} يوم عمل بديل. بعد ${toDate} يعود ${baseOffDay.label} إجازة أسبوعية تلقائيًا. تمت مزامنة ${result.createdCoreExceptions} يومًا مع Core.`
      );
    } catch (saveError) {
      setError(String((saveError as Error)?.message || "تعذر حفظ استثناء الإجازة الأسبوعية المؤقت."));
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
    const confirmation = group.mode === "suspend"
      ? `إزالة إيقاف الإجازة الأسبوعية للفترة ${group.fromDate} إلى ${group.toDate}؟`
      : `إزالة تغيير ${weekdayLabel(group.temporaryDay as WeekdayKey)} بدل ${weekdayLabel(group.baseDay)} للفترة ${group.fromDate} إلى ${group.toDate}؟`;
    if (!window.confirm(confirmation)) return;

    const nextOverrides = (overrides || []).filter((row) =>
      !String(row?.note || "").trim().startsWith(group.token)
    );
    const restoredWeeklyOffDates = weekdayDatesInRange(group.fromDate, group.toDate, group.baseDay);
    const restoredWorkDates = group.temporaryDay
      ? weekdayDatesInRange(group.fromDate, group.toDate, group.temporaryDay)
      : [];
    setSaving(true);
    try {
      await removeTemporaryWeeklyOff({
        employeeId,
        token: group.token,
        nextOverrides,
      });
      onOverridesChange(nextOverrides);
      notifyTemporaryWeeklyOffUpdated({
        employeeId,
        overrides: nextOverrides,
        offDates: restoredWeeklyOffDates,
        workDates: restoredWorkDates,
      });
      setMessage(`تمت إزالة الاستثناء المؤقت. عاد ${weekdayLabel(group.baseDay)} إلى الجدول الأسبوعي الأساسي.`);
    } catch (removeError) {
      setError(String((removeError as Error)?.message || "تعذر إزالة الاستثناء المؤقت."));
    } finally {
      setSaving(false);
    }
  };

  const previewReady = Boolean(
    baseOffDay &&
    isDateKey(fromDate) &&
    isDateKey(toDate) &&
    fromDate <= toDate &&
    (mode === "suspend" || temporaryDay)
  );

  return (
    <div className="dsv2-stack dsv2-stack--sm" data-weekly-off-management="true">
      <div className="dsv2-section-head">
        <div>
          <h4 className="dsv2-section-title">إدارة الإجازة الأسبوعية</h4>
          <p className="dsv2-section-caption">
            اليوم الأساسي يبقى محفوظًا دائمًا. استخدم استثناءً مؤقتًا فقط عندما تريد نقله أو إيقافه بين تاريخين.
          </p>
        </div>
        {baseOffDay ? (
          <WorkspaceStatusBadgeV2 tone="gold">اليوم الأساسي: {baseOffDay.label}</WorkspaceStatusBadgeV2>
        ) : (
          <WorkspaceStatusBadgeV2 tone="danger">اليوم الأساسي غير محدد</WorkspaceStatusBadgeV2>
        )}
      </div>

      <WorkspaceNoticeV2
        title="دليل الاستخدام"
        description={
          baseOffDay
            ? `الإجازة الأسبوعية الأساسية هي ${baseOffDay.label} وتبقى محفوظة دائمًا. اختر نوع التعديل المؤقت المناسب للحالة، وحدد تاريخ البداية والنهاية. بعد انتهاء الفترة يرجع ${baseOffDay.label} تلقائيًا بدون حذف اليوم الأساسي أو إعادة تفعيله يدويًا.`
            : "حدد يوم إجازة أسبوعية أساسي واحد من الأيام أعلاه أولًا. بعد ذلك استخدم الخيارات المؤقتة أدناه بدل حذف اليوم الأساسي أو تغييره بشكل دائم."
        }
        tone={baseOffDay ? "neutral" : "gold"}
      />

      <div className="dsv2-stack dsv2-stack--sm">
        <WorkspaceNoticeV2
          title="تغيير يوم الإجازة مؤقتًا"
          description={
            baseOffDay
              ? `استخدم هذا الخيار عندما تريد نقل الإجازة الأسبوعية من ${baseOffDay.label} إلى يوم آخر لفترة محددة فقط. مثال: إذا كانت الإجازة الأساسية ${baseOffDay.label} وتريدها الثلاثاء من 1 سبتمبر إلى 15 سبتمبر، يصبح الثلاثاء إجازة داخل هذه الفترة، ويصبح ${baseOffDay.label} يوم عمل بدلًا منه. بعد 15 سبتمبر يرجع ${baseOffDay.label} إجازة أسبوعية تلقائيًا.`
              : "بعد تحديد يوم الإجازة الأساسي، استخدم هذا الخيار لنقل الإجازة إلى يوم آخر بين تاريخين فقط، ثم يعود اليوم الأساسي تلقائيًا بعد نهاية الفترة."
          }
          tone="gold"
        />

        <WorkspaceNoticeV2
          title="إيقاف الإجازة مؤقتًا"
          description={
            baseOffDay
              ? `استخدم هذا الخيار عندما تريد أن تعمل الموظفة بدون أي إجازة أسبوعية خلال فترة محددة. لا يتم اختيار يوم راحة بديل؛ ${baseOffDay.label} نفسه يتحول إلى يوم عمل خلال الفترة. عند انتهاء تاريخ الإيقاف يرجع ${baseOffDay.label} إجازة أسبوعية تلقائيًا. مثال: إذا أوقفت الإجازة من 12 أغسطس إلى 31 أغسطس، تعمل الموظفة في أيام ${baseOffDay.label} الواقعة داخل هذه الفترة، ومن أول ${baseOffDay.label} بعد 31 أغسطس تعود الإجازة كالمعتاد.`
              : "بعد تحديد يوم الإجازة الأساسي، استخدم هذا الخيار إذا كانت الموظفة ستعمل بدون أي يوم راحة أسبوعي بين تاريخين. لا يوجد يوم بديل، وبعد نهاية الفترة يعود اليوم الأساسي تلقائيًا."
          }
          tone="neutral"
        />
      </div>

      <div className="dsv2-ew-form-grid dsv2-ew-form-grid--3">
        <DashboardFieldV2 id="employee-temp-weekly-off-mode" label="نوع التعديل المؤقت" required>
          <DashboardSelectV2
            id="employee-temp-weekly-off-mode"
            value={mode}
            disabled={busy || saving || !baseOffDay}
            options={[
              { value: "change", label: "تغيير يوم الإجازة مؤقتًا" },
              { value: "suspend", label: "إيقاف الإجازة مؤقتًا" },
            ]}
            onChange={(value) => {
              setMode(value as TemporaryWeeklyOffMode);
              setTemporaryDay("");
              setMessage("");
              setError("");
            }}
          />
        </DashboardFieldV2>

        {mode === "change" ? (
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
        ) : (
          <div className="dsv2-ew-notice" data-tone="gold">
            <div>
              <strong>بدون إجازة أسبوعية داخل الفترة</strong>
              <p>{baseOffDay ? `${baseOffDay.label} يصبح يوم عمل مؤقتًا، ثم يرجع إجازة بعد نهاية الفترة.` : "حدد اليوم الأساسي أولًا."}</p>
            </div>
          </div>
        )}

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

      {previewReady && baseOffDay ? (
        <WorkspaceNoticeV2
          title="معاينة قبل الحفظ"
          description={
            mode === "suspend"
              ? `${baseOffDay.label}: ${temporaryWorkDates.length} أيام ستتحول إلى أيام عمل داخل الفترة. لا توجد إجازة أسبوعية بديلة. بعد ${toDate} يعود ${baseOffDay.label} إجازة أسبوعية تلقائيًا.`
              : `${weekdayLabel(temporaryDay as WeekdayKey)}: ${temporaryOffDates.length} أيام إجازة. ${baseOffDay.label}: ${temporaryWorkDates.length} أيام عمل بديلة داخل الفترة. بعد ${toDate} يعود ${baseOffDay.label} إجازة أسبوعية.`
          }
          tone="gold"
        />
      ) : null}

      <div className="dsv2-cluster">
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary"
          disabled={busy || saving || !baseOffDay || !fromDate || !toDate || (mode === "change" && !temporaryDay)}
          onClick={() => void applyChange()}
        >
          {saving ? "جاري الحفظ..." : mode === "suspend" ? "حفظ إيقاف الإجازة المؤقت" : "حفظ تغيير الإجازة المؤقت"}
        </button>
      </div>

      {message ? <WorkspaceNoticeV2 title="تم التحديث" description={message} tone="success" /> : null}
      {error ? <WorkspaceNoticeV2 title="تعذر تنفيذ التغيير" description={error} tone="danger" /> : null}

      {savedGroups.length ? (
        <div className="dsv2-stack dsv2-stack--sm">
          <strong className="dsv2-section-title">الاستثناءات المؤقتة المسجلة</strong>
          {savedGroups.map((group) => (
            <div key={group.token} className="dsv2-ew-selected-item">
              <div>
                <strong>
                  {group.mode === "suspend"
                    ? `الإجازة الأسبوعية موقوفة مؤقتًا · الأساس ${weekdayLabel(group.baseDay)}`
                    : `${weekdayLabel(group.temporaryDay as WeekdayKey)} بدل ${weekdayLabel(group.baseDay)}`}
                </strong>
                <small>{group.fromDate} إلى {group.toDate} · يعود بعدها إلى {weekdayLabel(group.baseDay)}</small>
              </div>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                disabled={busy || saving}
                onClick={() => void removeChange(group)}
              >
                إزالة الاستثناء
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
