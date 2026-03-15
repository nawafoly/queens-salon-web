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

  return (
    <div className="emp-modal-section">
      <b className="emp-modal-section-title">إعدادات الحجز لهذه الموظفة</b>
      <div className="emp-modal-fields emp-booking-settings">
        <div className="emp-booking-subtitle">حالة التوظيف</div>
        <div className="dash-field booking-card booking-full">
          <label className="emp-label">آخر يوم دوام (في الصالون) – استقالة أو موظفة موسمية</label>
          <input
            className="dash-input"
            type="date"
            value={employmentEndDate}
            disabled={busy}
            onChange={(e) => onEmploymentEndDateChange(e.target.value)}
          />
          <div className="emp-field-note danger">بعد هذا التاريخ لن تظهر الموظفة نهائيًا في صفحة الحجز.</div>
        </div>

        <div className="emp-booking-subtitle">ساعات الدوام الخاصة</div>
        <div className="dash-field booking-card booking-full">
          <label className="emp-label emp-check-label">
            <input
              type="checkbox"
              checked={modalUseCustomWorkingHours}
              disabled={busy}
              onChange={(e) => onModalUseCustomWorkingHoursChange(e.target.checked)}
            />
            ساعات عمل خاصة لهذه الموظفة
          </label>
        </div>

        {modalUseCustomWorkingHours ? (
          <div className="dash-field booking-card booking-full emp-working-hours-block">
            <label className="emp-label">الساعات الأسبوعية</label>
            <div className="emp-field-note">عدلي يوم واحد ثم اضغطي "نسخ لكل الأيام" لتطبيق نفس الإعداد على كل الأسبوع.</div>
            <div className="emp-working-week-grid">
              {WEEKDAY_OPTIONS.map((day) => {
                const row = modalCustomWorkingHours[day.key] || {
                  enabled: true,
                  start: "10:00",
                  end: "22:00",
                };

                return (
                  <div key={`work_${day.key}`} className="emp-working-day-row">
                    <div className="emp-working-day-name">{day.label}</div>
                    <label className="emp-mini-check">
                      <input
                        type="checkbox"
                        checked={row.enabled !== false}
                        disabled={busy}
                        onChange={(e) => onUpdateModalWorkingDay(day.key, { enabled: e.target.checked })}
                      />
                      <span>دوام</span>
                    </label>
                    <input
                      className="dash-input"
                      type="time"
                      value={normalizeTimeHHMM(row.start) || "10:00"}
                      disabled={loading || row.enabled === false}
                      onChange={(e) => onUpdateModalWorkingDay(day.key, { start: e.target.value })}
                    />
                    <input
                      className="dash-input"
                      type="time"
                      value={normalizeTimeHHMM(row.end) || "22:00"}
                      disabled={loading || row.enabled === false}
                      onChange={(e) => onUpdateModalWorkingDay(day.key, { end: e.target.value })}
                    />
                    <button
                      type="button"
                      className="exp-btn ghost sm emp-working-copy-btn"
                      disabled={busy}
                      onClick={() => onCopyModalWorkingDayToAll(day.key)}
                      title={`نسخ ساعات ${day.label} لكل الأيام`}
                    >
                      نسخ لكل الأيام
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

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
