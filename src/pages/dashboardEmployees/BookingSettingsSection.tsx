import type { RefObject } from "react";

import WorkHourOverridesEditor, { type WorkHourOverridesEditorProps } from "./WorkHourOverridesEditor";
import { WEEKDAY_OPTIONS, normalizeTimeHHMM, type StaffWorkingDay, type WeekdayKey } from "./shared";

type BookingSettingsSectionProps = {
  isVisible: boolean;
  busy: boolean;
  loading: boolean;
  employmentEndDate: string;
  modalUseCustomWorkingHours: boolean;
  modalCustomWorkingHours: Record<WeekdayKey, StaffWorkingDay>;
  modalHourOverrideHijriPickerRef: RefObject<HTMLDivElement | null>;
  overrideEditor: WorkHourOverridesEditorProps["editor"];
  onEmploymentEndDateChange: (value: string) => void;
  onModalUseCustomWorkingHoursChange: (value: boolean) => void;
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
  modalHourOverrideHijriPickerRef,
  overrideEditor,
  onEmploymentEndDateChange,
  onModalUseCustomWorkingHoursChange,
  onUpdateModalWorkingDay,
  onCopyModalWorkingDayToAll,
}: BookingSettingsSectionProps) {
  if (!isVisible) return null;

  const firstWeekday = WEEKDAY_OPTIONS[0]?.key;

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
            <div className="emp-working-table-wrap">
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
              <table className="emp-working-table">
                <thead>
                  <tr>
                    <th scope="col">اليوم</th>
                    <th scope="col">دوام</th>
                    <th scope="col">من</th>
                    <th scope="col">إلى</th>
                    <th scope="col">نسخ</th>
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAY_OPTIONS.map((day) => {
                    const row = modalCustomWorkingHours[day.key] || {
                      enabled: true,
                      start: "10:00",
                      end: "22:00",
                    };
                    const isOff = row.enabled === false;

                    return (
                      <tr key={`work_${day.key}`} className={isOff ? "is-off" : undefined}>
                        <td className="day-cell" data-label="اليوم">
                          {day.label}
                        </td>
                        <td data-label="دوام">
                          <label className="emp-mini-check">
                            <input
                              type="checkbox"
                              checked={row.enabled !== false}
                              disabled={busy}
                              onChange={(e) => onUpdateModalWorkingDay(day.key, { enabled: e.target.checked })}
                            />
                            <span>دوام</span>
                          </label>
                        </td>
                        <td data-label="من">
                          <input
                            className="dash-input"
                            type="time"
                            value={normalizeTimeHHMM(row.start) || "10:00"}
                            disabled={loading || isOff}
                            onChange={(e) => onUpdateModalWorkingDay(day.key, { start: e.target.value })}
                          />
                        </td>
                        <td data-label="إلى">
                          <input
                            className="dash-input"
                            type="time"
                            value={normalizeTimeHHMM(row.end) || "22:00"}
                            disabled={loading || isOff}
                            onChange={(e) => onUpdateModalWorkingDay(day.key, { end: e.target.value })}
                          />
                        </td>
                        <td data-label="نسخ">
                          <button
                            type="button"
                            className="exp-btn ghost sm emp-working-copy-btn"
                            disabled={busy}
                            onClick={() => onCopyModalWorkingDayToAll(day.key)}
                            title={`نسخ ساعات ${day.label} لكل الأيام`}
                          >
                            نسخ
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
