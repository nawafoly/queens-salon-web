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
            <select
              className="dash-input"
              value={selectedAttendanceZoneId}
              disabled={busy || attendanceZonesLoading}
              onChange={(e) => onSelectedAttendanceZoneIdChange(e.target.value)}
            >
              <option value="">
                {attendanceZonesLoading ? "جاري تحميل النطاقات..." : "اختر نطاق الحضور"}
              </option>
              {attendanceZones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name} - {zone.active ? "نشط" : "غير نشط"} - {zone.radiusMeters} م
                </option>
              ))}
            </select>
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

        <section className="emp-panel">
          <div className="emp-panel-head">
            <h4 className="emp-panel-title">ساعات الدوام</h4>
          </div>
          <div className="emp-toggle-row">
            <label className="emp-label emp-check-label">
              <input
                type="checkbox"
                checked={modalUseCustomWorkingHours}
                disabled={busy}
                onChange={(e) => onModalUseCustomWorkingHoursChange(e.target.checked)}
              />
              تفعيل ساعات عمل خاصة لهذه الموظفة
            </label>
          </div>

          {modalUseCustomWorkingHours ? (
            <div className="emp-working-week">
              <div className="emp-working-table-toolbar">
                <span>عدّلي يومًا واحدًا ثم انسخي الإعداد على بقية الأسبوع.</span>
                {firstWeekday ? (
                  <button
                    type="button"
                    className="exp-btn ghost sm"
                    disabled={busy}
                    onClick={() => onCopyModalWorkingDayToAll(firstWeekday)}
                  >
                    نسخ {WEEKDAY_OPTIONS[0]?.label} لكل الأيام
                  </button>
                ) : null}
              </div>

              <div className="emp-working-week-cards" aria-label="جدول دوام الموظفة الأسبوعي">
                {WEEKDAY_OPTIONS.map((day) => {
                  const row = modalCustomWorkingHours[day.key] || {
                    enabled: true,
                    start: "10:00",
                    end: "22:00",
                  };
                  const isOff = row.enabled === false;

                  return (
                    <article key={`work_${day.key}`} className={`emp-working-day-card ${isOff ? "is-off" : ""}`}>
                      <div className="emp-working-day-card__head">
                        <strong>{day.label}</strong>
                        <label className="emp-switch">
                          <input
                            type="checkbox"
                            checked={row.enabled !== false}
                            disabled={busy}
                            onChange={(e) => onUpdateModalWorkingDay(day.key, { enabled: e.target.checked })}
                          />
                          <span>{isOff ? "إجازة" : "دوام"}</span>
                        </label>
                      </div>

                      <div className="emp-working-day-card__times">
                        <label>
                          <span>من</span>
                          <input
                            className="dash-input"
                            type="time"
                            value={normalizeTimeHHMM(row.start) || "10:00"}
                            disabled={loading || isOff}
                            onChange={(e) => onUpdateModalWorkingDay(day.key, { start: e.target.value })}
                          />
                        </label>
                        <label>
                          <span>إلى</span>
                          <input
                            className="dash-input"
                            type="time"
                            value={normalizeTimeHHMM(row.end) || "22:00"}
                            disabled={loading || isOff}
                            onChange={(e) => onUpdateModalWorkingDay(day.key, { end: e.target.value })}
                          />
                        </label>
                      </div>

                      <button
                        type="button"
                        className="exp-btn ghost sm emp-working-copy-btn"
                        disabled={busy}
                        onClick={() => onCopyModalWorkingDayToAll(day.key)}
                        title={`نسخ ساعات ${day.label} لكل الأيام`}
                      >
                        نسخ هذا اليوم
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
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
