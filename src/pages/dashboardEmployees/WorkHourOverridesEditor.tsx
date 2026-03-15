import type { RefObject } from "react";

import {
  HIJRI_WEEKDAY_SHORT,
  WEEKDAY_OPTIONS,
  countIsoDateRangeDays,
  formatArabicInteger,
  formatIsoDateRange,
  formatIsoDateRangeByCalendar,
  formatWindow,
  fmtIsoDate,
  normalizeLeaveUntil,
  normalizeTimeHHMM,
} from "./shared";

export type WorkHourOverridesEditorProps = {
  loading: boolean;
  busy: boolean;
  editor: {
    modalHourOverrideMode: string;
    modalHourOverrideEditingDate: string;
    modalHourOverrideEditingGroupId: string;
    modalHourOverrideQuickMode: string;
    modalHourOverrideUpdateExistingOnly: boolean;
    modalHourOverrideCalendar: string;
    modalHourOverrideHijriPickerOpen: boolean;
    modalHourOverrideHijriMonthTitle: string;
    modalHourOverrideHijriWeekOffset: number;
    modalHourOverrideHijriMonthDays: Array<{ iso: string; hijriDay: number }>;
    modalHourOverrideHijriPickerTarget: "from" | "to";
    modalHourOverrideFromDate: string;
    modalHourOverrideToDate: string;
    modalHourOverrideFromDateHijri: string;
    modalHourOverrideToDateHijri: string;
    modalHourOverrideEnabled: boolean;
    modalHourOverrideStart: string;
    modalHourOverrideEnd: string;
    modalHourOverrideNote: string;
    modalHourOverridePreview: { affectedDays: number; totalHours: number; diffHours: number };
    modalHourOverrideApplyWeekdays: string[];
    modalHourOverrideApplyCount: number;
    modalHourOverrideOverwriteExisting: boolean;
    modalCustomHourOverrides: Array<any>;
    modalHourOverrideGroups: Array<any>;
    setModalHourOverrideToGregorian: (value: string) => void;
    setModalHourOverrideEditingGroupId: (value: string) => void;
    setModalHourOverrideMode: (value: any) => void;
    fillModalHourOverrideFromBaseDay: () => void;
    setModalHourOverrideQuickMode: (value: any) => void;
    setModalHourOverrideEnabled: (value: boolean) => void;
    setModalHourOverrideStart: (value: string) => void;
    setModalHourOverrideEnd: (value: string) => void;
    setModalHourOverrideApplyMethod: (value: any) => void;
    setModalHourOverrideOverwriteExisting: (value: boolean) => void;
    setModalHourOverrideUpdateExistingOnly: (value: boolean) => void;
    setModalHourOverrideCalendar: (value: any) => void;
    setModalHourOverrideHijriPickerOpen: (value: boolean) => void;
    applyModalHourOverrideHijriInput: (target: "from" | "to", raw: string, commit?: boolean) => void;
    openModalHourOverrideHijriPicker: (target: "from" | "to") => void;
    setModalHourOverrideFromGregorian: (value: string) => void;
    setModalHourOverrideHijriViewMonthISO: (updater: (prev: string) => string) => void;
    applyModalHourOverrideHijriPick: (iso: string) => void;
    setModalHourOverrideNote: (value: string) => void;
    addModalWorkingHourOverride: () => void;
    cancelModalWorkingHourOverrideEdit: () => void;
    toggleModalHourOverrideWeekday: (day: any) => void;
    startModalWorkingHourOverrideGroupEdit: (group: any) => void;
    removeModalWorkingHourOverrideGroup: (group: any) => void;
    setModalCustomHourOverrides: (value: any) => void;
    setModalHourOverrideRangeFromExisting: () => boolean;
    shiftHijriMonthStartIso: (currentMonthStartISO: string, delta: number) => string;
  };
  modalHourOverrideHijriPickerRef: RefObject<HTMLDivElement | null>;
};

function formatWindowForPreview(start: string, end: string): string {
  return formatWindow(start, end).replace(/\s-\s/g, " → ");
}

function formatDayCountLabel(count: number): string {
  return count > 1 ? `${formatArabicInteger(count)} أيام` : "يوم واحد";
}

function buildPreviewText(editor: WorkHourOverridesEditorProps["editor"], isEditing: boolean): string {
  const from = normalizeLeaveUntil(editor.modalHourOverrideFromDate);
  if (!from) return "حددي الفترة وساعات العمل لعرض النتيجة النهائية لهذا الاستثناء.";

  const to = normalizeLeaveUntil(editor.modalHourOverrideToDate) || from;
  const rangeLabel = formatIsoDateRange(from, to);
  const timeLabel = formatWindowForPreview(
    normalizeTimeHHMM(editor.modalHourOverrideStart) || "10:00",
    normalizeTimeHHMM(editor.modalHourOverrideEnd) || "22:00"
  );
  const dayCount = Math.max(
    0,
    Number(editor.modalHourOverrideApplyCount || editor.modalHourOverridePreview?.affectedDays || 0)
  );

  if (isEditing) {
    if (!editor.modalHourOverrideEnabled) {
      return `سيتم تحديث هذا الاستثناء إلى إغلاق كامل خلال الفترة ${rangeLabel}.`;
    }
    return `سيتم تحديث هذا الاستثناء لتعمل الموظفة من ${timeLabel} خلال الفترة ${rangeLabel}.`;
  }

  if (dayCount <= 0) {
    return editor.modalHourOverrideUpdateExistingOnly
      ? "لا توجد استثناءات محفوظة مطابقة لهذه الفترة لتحديثها."
      : "لا يوجد أيام مطابقة للفترة المختارة.";
  }

  const dayCountLabel = formatDayCountLabel(dayCount);
  if (!editor.modalHourOverrideEnabled) {
    return editor.modalHourOverrideMode === "specific" && editor.modalHourOverrideApplyWeekdays.length
      ? `ستكون الموظفة مغلقة في الأيام المطابقة داخل الفترة ${rangeLabel} (${dayCountLabel}).`
      : `ستكون الموظفة مغلقة يوميًا خلال الفترة ${rangeLabel} (${dayCountLabel}).`;
  }

  return editor.modalHourOverrideMode === "specific" && editor.modalHourOverrideApplyWeekdays.length
    ? `ستعمل الموظفة من ${timeLabel} في الأيام المطابقة داخل الفترة ${rangeLabel} (${dayCountLabel}).`
    : `ستعمل الموظفة يوميًا من ${timeLabel} خلال الفترة ${rangeLabel} (${dayCountLabel}).`;
}

export default function WorkHourOverridesEditor({
  loading,
  busy,
  editor,
  modalHourOverrideHijriPickerRef,
}: WorkHourOverridesEditorProps) {
  const isEditing = !!editor.modalHourOverrideEditingDate || !!editor.modalHourOverrideEditingGroupId;
  const previewText = buildPreviewText(editor, isEditing);
  const advancedActive =
    editor.modalHourOverrideMode === "specific" ||
    editor.modalHourOverrideUpdateExistingOnly ||
    !editor.modalHourOverrideOverwriteExisting ||
    editor.modalHourOverrideApplyWeekdays.length > 0;
  const canSubmit =
    !loading &&
    !!normalizeLeaveUntil(editor.modalHourOverrideFromDate) &&
    (isEditing || editor.modalHourOverridePreview.affectedDays > 0);

  return (
    <div className="dash-field booking-card booking-full emp-working-override-block">
      <div className="emp-override-editor-head">
        <div>
          <label className="emp-label">استثناءات الدوام</label>
          <div className="emp-field-note">حددي الفترة التي تعمل فيها الموظفة أو تكون مغلقة خلالها.</div>
        </div>
        <button
          type="button"
          className="exp-btn ghost sm"
          disabled={busy}
          onClick={() => {
            editor.setModalHourOverrideQuickMode("manual");
            editor.fillModalHourOverrideFromBaseDay();
          }}
        >
          تطبيق ساعات يوم البداية
        </button>
      </div>

      <div className="emp-working-override-grid emp-working-override-grid-redesigned">
        <div className="emp-working-override-form emp-working-override-form-redesigned">
          <div className="emp-ov-field emp-ov-calendar-toggle">
            <label className="emp-label">نوع التاريخ</label>
            <div className="emp-ov-calendar-toggle-buttons" role="group" aria-label="نوع التاريخ">
              <button
                type="button"
                className={`exp-btn ghost sm ${editor.modalHourOverrideCalendar === "gregory" ? "is-active" : ""}`}
                disabled={busy}
                onClick={() => {
                  editor.setModalHourOverrideCalendar("gregory");
                  editor.setModalHourOverrideHijriPickerOpen(false);
                }}
              >
                ميلادي
              </button>
              <button
                type="button"
                className={`exp-btn ghost sm ${editor.modalHourOverrideCalendar === "hijri" ? "is-active" : ""}`}
                disabled={busy}
                onClick={() => {
                  editor.setModalHourOverrideCalendar("hijri");
                  editor.openModalHourOverrideHijriPicker("from");
                }}
              >
                هجري
              </button>
            </div>
          </div>

          <div className="emp-ov-field emp-ov-from-date">
            <label className="emp-label">من تاريخ</label>
            {editor.modalHourOverrideCalendar === "hijri" ? (
              <>
                <div className="emp-ov-hijri-row">
                  <input
                    className="dash-input emp-ov-hijri-input"
                    type="text"
                    inputMode="numeric"
                    value={editor.modalHourOverrideFromDateHijri}
                    placeholder="مثال: 09/09/1447"
                    disabled={busy}
                    onChange={(e) => editor.applyModalHourOverrideHijriInput("from", e.target.value, false)}
                    onBlur={(e) => editor.applyModalHourOverrideHijriInput("from", e.target.value, true)}
                  />
                  <button
                    type="button"
                    className="exp-btn ghost sm emp-ov-hijri-pick-btn"
                    disabled={busy}
                    onClick={() => editor.openModalHourOverrideHijriPicker("from")}
                  >
                    اختيار التاريخ
                  </button>
                </div>
                <div className="emp-field-note">الميلادي المقابل: {fmtIsoDate(editor.modalHourOverrideFromDate)}</div>
              </>
            ) : (
              <input
                className="dash-input"
                type="date"
                value={editor.modalHourOverrideFromDate}
                disabled={busy}
                onChange={(e) => editor.setModalHourOverrideFromGregorian(e.target.value)}
              />
            )}
          </div>

          <div className="emp-ov-field emp-ov-to-date">
            <label className="emp-label">إلى تاريخ</label>
            {editor.modalHourOverrideCalendar === "hijri" ? (
              <>
                <div className="emp-ov-hijri-row">
                  <input
                    className="dash-input emp-ov-hijri-input"
                    type="text"
                    inputMode="numeric"
                    value={editor.modalHourOverrideToDateHijri}
                    placeholder="مثال: 19/09/1447"
                    disabled={loading || !!editor.modalHourOverrideEditingDate}
                    onChange={(e) => editor.applyModalHourOverrideHijriInput("to", e.target.value, false)}
                    onBlur={(e) => editor.applyModalHourOverrideHijriInput("to", e.target.value, true)}
                  />
                  <button
                    type="button"
                    className="exp-btn ghost sm emp-ov-hijri-pick-btn"
                    disabled={loading || !!editor.modalHourOverrideEditingDate}
                    onClick={() => editor.openModalHourOverrideHijriPicker("to")}
                  >
                    اختيار التاريخ
                  </button>
                </div>
                <div className="emp-field-note">
                  الميلادي المقابل:{" "}
                  {fmtIsoDate(normalizeLeaveUntil(editor.modalHourOverrideToDate) || editor.modalHourOverrideFromDate)}
                </div>
              </>
            ) : (
              <input
                className="dash-input"
                type="date"
                value={editor.modalHourOverrideToDate}
                disabled={loading || !!editor.modalHourOverrideEditingDate}
                onChange={(e) => editor.setModalHourOverrideToGregorian(e.target.value)}
              />
            )}
          </div>

          {editor.modalHourOverrideCalendar === "hijri" && editor.modalHourOverrideHijriPickerOpen ? (
            <div className="emp-ov-field emp-ov-hijri-picker-wrap">
              <div className="emp-ov-hijri-picker" ref={modalHourOverrideHijriPickerRef}>
                <div className="emp-ov-hijri-picker-head">
                  <button
                    type="button"
                    className="exp-btn ghost sm"
                    disabled={busy}
                    onClick={() =>
                      editor.setModalHourOverrideHijriViewMonthISO((prev: string) =>
                        editor.shiftHijriMonthStartIso(prev, -1)
                      )
                    }
                  >
                    السابق
                  </button>
                  <div className="emp-ov-hijri-picker-title">
                    <strong>{editor.modalHourOverrideHijriMonthTitle || "التقويم الهجري"}</strong>
                    <span>
                      الحقل الحالي: {editor.modalHourOverrideHijriPickerTarget === "from" ? "من تاريخ" : "إلى تاريخ"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="exp-btn ghost sm"
                    disabled={busy}
                    onClick={() =>
                      editor.setModalHourOverrideHijriViewMonthISO((prev: string) =>
                        editor.shiftHijriMonthStartIso(prev, 1)
                      )
                    }
                  >
                    التالي
                  </button>
                </div>
                <div className="emp-ov-hijri-picker-grid emp-ov-hijri-picker-weekdays">
                  {HIJRI_WEEKDAY_SHORT.map((weekday) => (
                    <span key={`ov_hijri_wd_${weekday}`}>{weekday}</span>
                  ))}
                </div>
                <div className="emp-ov-hijri-picker-grid">
                  {Array.from({ length: editor.modalHourOverrideHijriWeekOffset }).map((_, idx) => (
                    <span key={`ov_hijri_gap_${idx}`} className="emp-ov-hijri-day is-gap" aria-hidden="true" />
                  ))}
                  {editor.modalHourOverrideHijriMonthDays.map((cell) => {
                    const activeIso =
                      editor.modalHourOverrideHijriPickerTarget === "from"
                        ? normalizeLeaveUntil(editor.modalHourOverrideFromDate)
                        : normalizeLeaveUntil(editor.modalHourOverrideToDate) ||
                          normalizeLeaveUntil(editor.modalHourOverrideFromDate);
                    const isActive = cell.iso === activeIso;
                    return (
                      <button
                        key={`ov_hijri_day_${cell.iso}`}
                        type="button"
                        className={`emp-ov-hijri-day ${isActive ? "is-active" : ""}`}
                        disabled={busy}
                        onClick={() => editor.applyModalHourOverrideHijriPick(cell.iso)}
                      >
                        {String(cell.hijriDay)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}

          <label className="emp-mini-check emp-ov-toggle emp-ov-toggle-redesigned">
            <input
              type="checkbox"
              checked={editor.modalHourOverrideEnabled}
              disabled={loading}
              onChange={(e) => {
                editor.setModalHourOverrideQuickMode("manual");
                editor.setModalHourOverrideEnabled(e.target.checked);
              }}
            />
            <span>{editor.modalHourOverrideEnabled ? "تعمل الموظفة خلال هذه الفترة" : "الموظفة مغلقة خلال هذه الفترة"}</span>
          </label>

          <div className="emp-ov-field emp-ov-from-time">
            <label className="emp-label">من الساعة</label>
            <input
              className="dash-input"
              type="time"
              value={editor.modalHourOverrideStart}
              disabled={loading || !editor.modalHourOverrideEnabled}
              onChange={(e) => {
                editor.setModalHourOverrideQuickMode("manual");
                editor.setModalHourOverrideStart(e.target.value);
              }}
            />
          </div>

          <div className="emp-ov-field emp-ov-to-time">
            <label className="emp-label">إلى الساعة</label>
            <input
              className="dash-input"
              type="time"
              value={editor.modalHourOverrideEnd}
              disabled={loading || !editor.modalHourOverrideEnabled}
              onChange={(e) => {
                editor.setModalHourOverrideQuickMode("manual");
                editor.setModalHourOverrideEnd(e.target.value);
              }}
            />
          </div>

          <div className="emp-ov-field emp-ov-note">
            <label className="emp-label">ملاحظة داخلية (اختياري)</label>
            <input
              className="dash-input"
              value={editor.modalHourOverrideNote}
              disabled={busy}
              onChange={(e) => editor.setModalHourOverrideNote(e.target.value)}
              placeholder="مثال: رمضان / تدريب / دوام موسمي"
            />
          </div>
        </div>

        <div className="emp-override-preview-card">
          <span className="emp-override-preview-label">المعاينة</span>
          <p>{previewText}</p>
        </div>

        <details className="emp-override-advanced">
          <summary>
            إعدادات متقدمة
            {advancedActive ? <span className="emp-override-advanced-flag">مفعّلة</span> : null}
          </summary>
          <div className="emp-override-advanced-body">
            {!isEditing ? (
              <div className="emp-working-override-mode-tabs">
                <button
                  type="button"
                  className={`exp-btn ghost sm ${editor.modalHourOverrideMode === "single" ? "is-active" : ""}`}
                  disabled={loading}
                  onClick={() => {
                    editor.setModalHourOverrideEditingGroupId("");
                    editor.setModalHourOverrideMode("single");
                  }}
                >
                  يوم واحد
                </button>
                <button
                  type="button"
                  className={`exp-btn ghost sm ${editor.modalHourOverrideMode === "range" ? "is-active" : ""}`}
                  disabled={loading}
                  onClick={() => {
                    editor.setModalHourOverrideEditingGroupId("");
                    editor.setModalHourOverrideMode("range");
                  }}
                >
                  فترة
                </button>
                <button
                  type="button"
                  className={`exp-btn ghost sm ${editor.modalHourOverrideMode === "specific" ? "is-active" : ""}`}
                  disabled={loading}
                  onClick={() => {
                    editor.setModalHourOverrideEditingGroupId("");
                    editor.setModalHourOverrideMode("specific");
                  }}
                >
                  أيام محددة
                </button>
              </div>
            ) : null}

            {!isEditing && editor.modalHourOverrideMode === "specific" ? (
              <div className="emp-working-override-weekdays">
                <label className="emp-label">الأيام المطلوبة داخل الفترة</label>
                <div className="emp-working-override-weekday-chips">
                  {WEEKDAY_OPTIONS.map((day) => {
                    const active = editor.modalHourOverrideApplyWeekdays.includes(day.key);
                    return (
                      <button
                        key={`ov_day_${day.key}`}
                        type="button"
                        className={`emp-weekday-chip ${active ? "active" : ""}`}
                        disabled={busy}
                        onClick={() => editor.toggleModalHourOverrideWeekday(day.key)}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {!isEditing ? (
              <div className="emp-working-override-presets emp-working-override-presets--advanced">
                <label
                  className={`emp-mini-check emp-ov-apply-method-row ${
                    !editor.modalHourOverrideUpdateExistingOnly ? "is-active" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="overrideApplyMethod"
                    checked={!editor.modalHourOverrideUpdateExistingOnly}
                    disabled={busy}
                    onChange={() => {
                      editor.setModalHourOverrideApplyMethod("replace");
                      editor.setModalHourOverrideOverwriteExisting(true);
                      editor.setModalHourOverrideUpdateExistingOnly(false);
                    }}
                  />
                  <span>استبدال أي استثناء محفوظ يقع في نفس التاريخ</span>
                </label>
                <label
                  className={`emp-mini-check emp-ov-apply-method-row ${
                    editor.modalHourOverrideUpdateExistingOnly ? "is-active" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="overrideApplyMethod"
                    checked={editor.modalHourOverrideUpdateExistingOnly}
                    disabled={busy}
                    onChange={() => {
                      const ok = editor.setModalHourOverrideRangeFromExisting();
                      if (!ok) return;
                      editor.setModalHourOverrideApplyMethod("replace");
                      editor.setModalHourOverrideOverwriteExisting(true);
                      editor.setModalHourOverrideUpdateExistingOnly(true);
                    }}
                  />
                  <span>تحديث الاستثناءات المحفوظة فقط</span>
                </label>
              </div>
            ) : null}
          </div>
        </details>

        <div className="emp-override-editor-actions">
          <button
            type="button"
            className="exp-btn primary"
            disabled={!canSubmit}
            onClick={editor.addModalWorkingHourOverride}
          >
            {isEditing ? "حفظ التعديل" : "إضافة الاستثناء"}
          </button>
          {isEditing ? (
            <button
              type="button"
              className="exp-btn ghost"
              disabled={busy}
              onClick={editor.cancelModalWorkingHourOverrideEdit}
            >
              إلغاء التعديل
            </button>
          ) : null}
        </div>

        {editor.modalCustomHourOverrides.length ? (
          <div className="emp-override-list">
            <div className="emp-override-list-head">
              <span>
                الاستثناءات المحفوظة: {editor.modalHourOverrideGroups.length} نطاق {" • "}
                {editor.modalCustomHourOverrides.length} يوم
              </span>
              <button
                type="button"
                className="exp-btn ghost sm"
                disabled={busy}
                onClick={() => editor.setModalCustomHourOverrides([])}
              >
                حذف الكل
              </button>
            </div>
            {editor.modalHourOverrideGroups.map((group: any, groupIndex: number) => {
              const from = normalizeLeaveUntil(group.fromDate);
              const to = normalizeLeaveUntil(group.toDate) || from;
              const activeFrom = normalizeLeaveUntil(editor.modalHourOverrideFromDate);
              const activeTo = normalizeLeaveUntil(editor.modalHourOverrideToDate) || activeFrom;
              const isEditingGroup =
                !normalizeLeaveUntil(editor.modalHourOverrideEditingDate) &&
                editor.modalHourOverrideUpdateExistingOnly &&
                activeFrom === from &&
                activeTo === to;
              const itemStart = normalizeTimeHHMM(group.start) || "10:00";
              const itemEnd = normalizeTimeHHMM(group.end) || "22:00";
              const rangeGregorian = formatIsoDateRange(from, to);
              const rangeHijri = formatIsoDateRangeByCalendar(from, to, "hijri");
              const rangeDays = countIsoDateRangeDays(from, to);
              const dayCount = rangeDays > 0 ? rangeDays : Math.max(1, Number(group.count) || 1);
              const dayCountLabel = formatDayCountLabel(dayCount);
              const toneClass = `tone-${(groupIndex % 4) + 1}`;

              return (
                <div
                  key={`ov_group_${group.id}`}
                  className={`emp-override-item ${toneClass} ${isEditingGroup ? "editing" : ""}`}
                >
                  <div className="emp-override-item-main">
                    <span className="emp-override-item-badge">استثناء {groupIndex + 1}</span>
                    <span className="emp-override-item-date">{rangeGregorian}</span>
                    <span className="emp-override-item-time">{dayCountLabel}</span>
                    <span className="emp-override-item-time">
                      {group.enabled === false ? "مغلق بالكامل" : `الدوام: ${formatWindow(itemStart, itemEnd)}`}
                    </span>
                    {rangeHijri !== rangeGregorian ? (
                      <span className="emp-override-item-time">هجري: {rangeHijri}</span>
                    ) : null}
                    {group.note ? <span className="emp-override-item-time">ملاحظة: {group.note}</span> : null}
                  </div>
                  <div className="emp-override-item-actions">
                    <button
                      type="button"
                      className="exp-btn ghost sm"
                      disabled={busy}
                      onClick={() => editor.startModalWorkingHourOverrideGroupEdit(group)}
                    >
                      تعديل
                    </button>
                    <button
                      type="button"
                      className="exp-btn ghost sm"
                      disabled={busy}
                      onClick={() => editor.removeModalWorkingHourOverrideGroup(group)}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="emp-field-note">لا توجد استثناءات محفوظة حالياً.</div>
        )}
      </div>
    </div>
  );
}
