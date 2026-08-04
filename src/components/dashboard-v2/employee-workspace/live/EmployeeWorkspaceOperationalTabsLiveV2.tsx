import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
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

export type EmployeeAttendanceRowLiveV2 = {
  date?: string;
  status?: string;
  checkInAtClient?: string;
  checkOutAtClient?: string;
  lateMinutes?: number;
  earlyLeaveMinutes?: number;
  notes?: string;
};

export type EmployeeAttendanceTabLiveV2Props = {
  readOnly: boolean;
  loading: boolean;
  rows: EmployeeAttendanceRowLiveV2[];
  monthKey: string;
  selectedDate: string;
  canEdit: boolean;
  canDelete: boolean;
  onMonthChange: (value: string) => void;
  onSelectedDateChange: (value: string) => void;
  onReload: () => void;
  onEditPunch: (dateKey: string) => void;
  onDeletePunch: (dateKey: string) => void;
};

export function EmployeeAttendanceTabLiveV2({
  readOnly,
  loading,
  rows,
  monthKey,
  selectedDate,
  canEdit,
  canDelete,
  onMonthChange,
  onSelectedDateChange,
  onReload,
  onEditPunch,
  onDeletePunch,
}: EmployeeAttendanceTabLiveV2Props) {
  const presentRows = rows.filter((row) => cleanText(row.checkInAtClient || row.checkOutAtClient)).length;
  const lateTotal = rows.reduce((sum, row) => sum + Number(row.lateMinutes || 0), 0);

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الحضور"
        description="عرض وتعديل سجل الحضور من مكوّن V2 مستقل."
        badge={<WorkspaceStatusBadgeV2 tone={loading ? "gold" : "success"}>{loading ? "تحميل" : "جاهز"}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="أيام الشهر" value={rows.length} />
        <WorkspaceMetricV2 label="أيام عليها بصمة" value={presentRows} tone="success" />
        <WorkspaceMetricV2 label="دقائق التأخير" value={lateTotal} tone={lateTotal ? "gold" : "neutral"} />
        <WorkspaceMetricV2 label="اليوم المحدد" value={selectedDate || "-"} />
      </div>

      <WorkspaceCardV2
        title="فلاتر الحضور"
        description="الشهر واليوم المحدد وإعادة التحميل."
        actions={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={loading} onClick={onReload}>تحديث</button>}
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="employee-live-v2-attendance-month" label="الشهر">
            <input
              id="employee-live-v2-attendance-month"
              className="dsv2-input"
              type="month"
              value={monthKey}
              onChange={(event) => onMonthChange(event.target.value)}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-live-v2-attendance-date" label="اليوم">
            <DashboardDatePickerV2
              id="employee-live-v2-attendance-date"
              value={selectedDate}
              clearable
              onChange={onSelectedDateChange}
            />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="سجل الشهر" description="آخر السجلات المحملة للموظفة.">
        <WorkspaceTableV2
          headers={["اليوم", "الحالة", "الحضور", "الانصراف", "التأخير", "إجراء"]}
          rows={rows.map((row) => {
            const date = cleanText(row.date);
            return [
              date || "-",
              cleanText(row.status) || "-",
              cleanText(row.checkInAtClient) || "-",
              cleanText(row.checkOutAtClient) || "-",
              Number(row.lateMinutes || 0) ? `${formatNumber(row.lateMinutes)} د` : "-",
              <div className="dsv2-cluster" key={`${date}-actions`}>
                <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnly || !canEdit || !date} onClick={() => onEditPunch(date)}>تعديل</button>
                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnly || !canDelete || !date} onClick={() => onDeletePunch(date)}>حذف</button>
              </div>,
            ];
          })}
          emptyText={loading ? "جاري تحميل السجلات..." : "لا توجد سجلات حضور في هذا الشهر."}
        />
      </WorkspaceCardV2>
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
