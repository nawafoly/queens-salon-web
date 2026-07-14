import EmployeeSelect from "../../components/EmployeeSelect";
import type { RefObject } from "react";

import WorkHourOverridesEditor, { type WorkHourOverridesEditorProps } from "./WorkHourOverridesEditor";
import { WEEKDAY_OPTIONS, normalizeTimeHHMM, type StaffWorkingDay, type WeekdayKey } from "./shared";
import type { WorkZone } from "../../services/attendanceSettingsService";

type BookingSettingsSectionProps = {
  isVisible: boolean;
  busy: boolean;
  loading: boolean;
  employmentEndDate: string;
  modalUseCustomWorkingHours: boolean;
  modalCustomWorkingHours: Record<WeekdayKey, StaffWorkingDay>;
  attendanceZones: WorkZone[];
  attendanceZonesLoading: boolean;
  selectedAttendanceZoneId: string;
  modalHourOverrideHijriPickerRef: RefObject<HTMLDivElement | null>;
  overrideEditor: WorkHourOverridesEditorProps["editor"];
  onEmploymentEndDateChange: (value: string) => void;
  onModalUseCustomWorkingHoursChange: (value: boolean) => void;
  onSelectedAttendanceZoneIdChange: (value: string) => void;
  onReloadAttendanceZones: () => void;
  onUpdateModalWorkingDay: (day: WeekdayKey, patch: StaffWorkingDay) => void;
  onCopyModalWorkingDayToAll: (day: WeekdayKey) => void;
};

function parseTimeMinutes(value?: string): number | null {
  const normalized = normalizeTimeHHMM(value);
  if (!normalized) return null;

  const [hoursText, minutesText] = normalized.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getShiftDurationLabel(day: StaffWorkingDay): string {
  if (day.enabled === false) return "إجازة";

  const start = parseTimeMinutes(day.start);
  const end = parseTimeMinutes(day.end);
  if (start === null || end === null) return "غير مكتمل";

  let duration = end - start;
  if (duration <= 0) duration += 24 * 60;

  const hours = Math.floor(duration / 60);
  const minutes = duration % 60;

  if (hours === 0) return `${minutes} دقيقة`;
  if (minutes === 0) return `${hours} ساعة`;
  return `${hours} س ${minutes} د`;
}

export default function BookingSettingsSection({
  isVisible,
  busy,
  loading,
  employmentEndDate,
  modalUseCustomWorkingHours,
  modalCustomWorkingHours,
  attendanceZones,
  attendanceZonesLoading,
  selectedAttendanceZoneId,
  modalHourOverrideHijriPickerRef,
  overrideEditor,
  onEmploymentEndDateChange,
  onModalUseCustomWorkingHoursChange,
  onSelectedAttendanceZoneIdChange,
  onReloadAttendanceZones,
  onUpdateModalWorkingDay,
  onCopyModalWorkingDayToAll,
}: BookingSettingsSectionProps) {
  if (!isVisible) return null;

  const firstWeekday = WEEKDAY_OPTIONS[0]?.key;
  const selectedZone = attendanceZones.find((zone) => zone.id === selectedAttendanceZoneId) || null;
  const enabledDaysCount = WEEKDAY_OPTIONS.reduce((count, day) => {
    const row = modalCustomWorkingHours[day.key];
    return count + (row?.enabled === false ? 0 : 1);
  }, 0);

  return (
    <div className="emp-modal-section">
      <header className="emp-section-header">
        <div className="emp-section-header__main">
          <h3 className="emp-modal-section-title">إعدادات الحجز</h3>
          <p className="emp-section-lead">
            حدّدي جدول العمل وتاريخ انتهاء التوظيف. ساعات العمل الخاصة تُفعَّل فقط عند اختلافها عن بقية الفريق.
          </p>
        </div>
      </header>

      <div className="emp-form-grid">
        <section className="emp-panel">
          <div className="emp-panel-head">
            <h4 className="emp-panel-title">حالة التوظيف</h4>
          </div>
          <div className="dash-field">
            <label className="emp-label">آخر يوم دوام (استقالة أو موسمية)</label>
            <input
              className="dash-input"
              type="date"
              value={employmentEndDate}
              disabled={busy}
              onChange={(e) => onEmploymentEndDateChange(e.target.value)}
            />
            <div className="emp-field-note danger">بعد هذا التاريخ لن تظهر الموظفة في صفحة الحجز.</div>
          </div>
        </section>

        <section className="emp-panel">
          <div className="emp-panel-head">
            <h4 className="emp-panel-title">نطاق الحضور والبصمة</h4>
            <button
              type="button"
              className="exp-btn ghost sm"
              disabled={busy || attendanceZonesLoading}
              onClick={onReloadAttendanceZones}
            >
              تحديث النطاقات
            </button>
          </div>
          <div className="dash-field">
            <label className="emp-label">النطاق المسموح للحضور</label>
            <EmployeeSelect
              value={selectedAttendanceZoneId}
              disabled={busy || attendanceZonesLoading}
              ariaLabel="النطاق المسموح للحضور"
              placeholder={attendanceZonesLoading ? "جاري تحميل النطاقات..." : "اختر نطاق الحضور"}
              options={attendanceZones.map((zone) => ({
                value: zone.id,
                label: `${zone.name} - ${zone.active ? "نشط" : "غير نشط"} - ${zone.radiusMeters} م`,
              }))}
              onChange={onSelectedAttendanceZoneIdChange}
            />
            {selectedZone ? (
              <div className="emp-field-note">
                النطاق المختار: {selectedZone.name} · الحالة: {selectedZone.active ? "نشط" : "غير نشط"} · نصف القطر: {selectedZone.radiusMeters} م
              </div>
            ) : (
              <div className="emp-field-note danger">
                يجب تحديد نطاق للموظفة حتى تتمكن من تسجيل الحضور من بوابة الموظف.
              </div>
            )}
          </div>
        </section>

        <section className="emp-panel emp-hours-panel">
          <div className="emp-hours-shell">
            <div className="emp-hours-intro">
              <div className="emp-hours-intro__copy">
                <span className="emp-hours-eyebrow">الجدول الأسبوعي</span>
                <h4>ساعات الدوام</h4>
                <p>عدّلي أوقات كل يوم من مكان واحد، ثم انسخي أي يوم إلى بقية الأسبوع عند الحاجة.</p>
              </div>

              <div className="emp-hours-intro__stats" aria-label="ملخص جدول الدوام">
                <span>
                  <b>{enabledDaysCount}</b>
                  أيام دوام
                </span>
                <span>
                  <b>{WEEKDAY_OPTIONS.length - enabledDaysCount}</b>
                  أيام إجازة
                </span>
              </div>
            </div>

            <label className="emp-hours-master-toggle">
              <span className="emp-hours-master-toggle__control">
                <input
                  type="checkbox"
                  checked={modalUseCustomWorkingHours}
                  disabled={busy}
                  onChange={(e) => onModalUseCustomWorkingHoursChange(e.target.checked)}
                />
                <i aria-hidden="true" />
              </span>
              <span className="emp-hours-master-toggle__copy">
                <strong>تفعيل جدول خاص لهذه الموظفة</strong>
                <small>
                  {modalUseCustomWorkingHours
                    ? "الجدول أدناه مستقل عن ساعات الفريق العامة."
                    : "تستخدم الموظفة حاليًا جدول الفريق الافتراضي."}
                </small>
              </span>
              <span className={`emp-hours-master-toggle__state ${modalUseCustomWorkingHours ? "is-on" : ""}`}>
                {modalUseCustomWorkingHours ? "مفعّل" : "غير مفعّل"}
              </span>
            </label>

            {modalUseCustomWorkingHours ? (
              <div className="emp-hours-board">
                <div className="emp-hours-board__toolbar">
                  <div>
                    <strong>توزيع الأسبوع</strong>
                    <span>يمكنك تعديل يوم واحد ثم تطبيقه على الأيام كلها.</span>
                  </div>
                  {firstWeekday ? (
                    <button
                      type="button"
                      className="emp-hours-copy-all"
                      disabled={busy}
                      onClick={() => onCopyModalWorkingDayToAll(firstWeekday)}
                    >
                      <span aria-hidden="true">↻</span>
                      نسخ {WEEKDAY_OPTIONS[0]?.label} لكل الأيام
                    </button>
                  ) : null}
                </div>

                <div className="emp-hours-table" aria-label="جدول دوام الموظفة الأسبوعي">
                  <div className="emp-hours-table__head" aria-hidden="true">
                    <span>اليوم</span>
                    <span>الحالة</span>
                    <span>بداية الدوام</span>
                    <span>نهاية الدوام</span>
                    <span>المدة</span>
                    <span>نسخ</span>
                  </div>

                  <div className="emp-hours-table__body">
                    {WEEKDAY_OPTIONS.map((day) => {
                      const row = modalCustomWorkingHours[day.key] || {
                        enabled: true,
                        start: "10:00",
                        end: "22:00",
                      };
                      const isOff = row.enabled === false;

                      return (
                        <article key={`work_${day.key}`} className={`emp-hours-row ${isOff ? "is-off" : ""}`}>
                          <div className="emp-hours-row__day">
                            <span>{day.label.slice(0, 1)}</span>
                            <div>
                              <strong>{day.label}</strong>
                              <small>{isOff ? "يوم إجازة" : "يوم عمل"}</small>
                            </div>
                          </div>

                          <label className="emp-hours-status">
                            <input
                              type="checkbox"
                              checked={!isOff}
                              disabled={busy}
                              onChange={(e) => onUpdateModalWorkingDay(day.key, { enabled: e.target.checked })}
                            />
                            <span>{isOff ? "إجازة" : "دوام"}</span>
                          </label>

                          <label className="emp-hours-time-field emp-hours-time-field--start">
                            <span>من</span>
                            <input
                              type="time"
                              value={normalizeTimeHHMM(row.start) || "10:00"}
                              disabled={loading || isOff}
                              onChange={(e) => onUpdateModalWorkingDay(day.key, { start: e.target.value })}
                            />
                          </label>

                          <label className="emp-hours-time-field emp-hours-time-field--end">
                            <span>إلى</span>
                            <input
                              type="time"
                              value={normalizeTimeHHMM(row.end) || "22:00"}
                              disabled={loading || isOff}
                              onChange={(e) => onUpdateModalWorkingDay(day.key, { end: e.target.value })}
                            />
                          </label>

                          <div className="emp-hours-duration">
                            <span>المدة</span>
                            <strong>{getShiftDurationLabel(row)}</strong>
                          </div>

                          <button
                            type="button"
                            className="emp-hours-copy-day"
                            disabled={busy}
                            onClick={() => onCopyModalWorkingDayToAll(day.key)}
                            title={`نسخ ساعات ${day.label} لكل الأيام`}
                            aria-label={`نسخ ساعات ${day.label} لكل الأيام`}
                          >
                            <span aria-hidden="true">⧉</span>
                            <b>نسخ</b>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="emp-hours-inherited-note">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>لا يوجد جدول خاص</strong>
                  <p>سيتم الاعتماد على ساعات الدوام العامة المطبقة على الفريق.</p>
                </div>
              </div>
            )}
          </div>
        </section>

        {modalUseCustomWorkingHours ? (
          <WorkHourOverridesEditor
            loading={loading}
            busy={busy}
            editor={overrideEditor}
            modalHourOverrideHijriPickerRef={modalHourOverrideHijriPickerRef}
          />
        ) : null}
      </div>
    </div>
  );
}
