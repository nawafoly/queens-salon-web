import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import {
  EmployeePayrollTabLiveV2,
} from "../../components/dashboard-v2/employee-workspace/live";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceSwitchV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import {
  WEEKDAY_OPTIONS,
  fmtIsoDate,
  type LeaveEntry,
  type WeekdayKey,
} from "./shared";
import {
  getLeaveEntryActionType,
  getLeaveEntryBalanceAfter,
  getLeaveEntryBalanceBefore,
  getLeaveEntryChangeAmount,
  getLeaveEntryCreatedAt,
  isDeletedLeaveEntry,
} from "../../services/firestoreLeaveBalance";
import type { StaffOvertimeHoursBasis, StaffPayrollMethod } from "../../helpers/staffPayroll";

type PayrollSummary = {
  salaryAmount?: number;
  overtimeAmount?: number;
  totalAmount?: number;
  monthKey?: string;
  invoiceCount?: number;
  invoiceRevenue?: number;
  method?: string;
  config: {
    invoicePercent?: number;
    daysPerMonth?: number;
    hoursBasis?: StaffOvertimeHoursBasis;
    seasonBaseHoursPerDay?: number;
    baseHoursPerDay?: number;
    overtimePercent?: number;
  };
  schedule: {
    scheduledHours?: number;
    baselineHours?: number;
    overtimeHours?: number;
    periodFrom?: string;
    periodTo?: string;
    workedDays?: number;
    averageHoursPerWorkedDay?: number;
    dailyHourBuckets?: unknown;
  };
} | null;

type PayrollSetupPreview = {
  baseSalaryRiyals: number;
  workDays: number;
  dailyHours: number;
  monthlyHours: number;
  monthlyHoursSource: "manual" | "computed" | "missing";
  dailyRateRiyals: number;
  hourlyRateRiyals: number;
  complete: boolean;
  missing: string[];
};

type EmployeeStatsSectionProps = {
  isVisible: boolean;
  busy: boolean;
  loading: boolean;
  canManagePayroll: boolean;
  canManageLeaveBalance: boolean;
  leaveBalanceDays: number;
  leaveEntries: LeaveEntry[];
  showPayrollSubTab: boolean;
  showStatsSubTab: boolean;
  currentMonthKeyLabel: string;
  payroll: {
    monthlySalary: string;
    workDays: string;
    dailyHours: string;
    monthlyHours: string;
    overtimeEnabled: boolean;
    overtimeMultiplier: string;
    deductionMethod: StaffPayrollMethod;
    summary: PayrollSummary;
    setupPreview: PayrollSetupPreview;
    savingSettings: boolean;
    settingsMessage?: string;
    onMonthlySalaryChange: (value: string) => void;
    onWorkDaysChange: (value: string) => void;
    onDailyHoursChange: (value: string) => void;
    onMonthlyHoursChange: (value: string) => void;
    onOvertimeEnabledChange: (value: boolean) => void;
    onOvertimeMultiplierChange: (value: string) => void;
    onDeductionMethodChange: (value: StaffPayrollMethod) => void;
    onSaveSettings: () => void;
  };
  leave: {
    modalOnLeave: boolean;
    modalLeaveUntil: string;
    modalLeaveNote: string;
    modalLeaveWeekdayDraft: WeekdayKey | "";
    modalExceptionalLeaveWeekdays: WeekdayKey[];
    modalLeaveExpired: boolean;
    leaveEntitlementDate: string;
    leaveAdjustDays: string;
    leaveAdjustDate: string;
    leaveAdjustNote: string;
    onModalOnLeaveChange: (value: boolean) => void;
    onModalLeaveUntilChange: (value: string) => void;
    onModalLeaveNoteChange: (value: string) => void;
    onModalLeaveWeekdayDraftChange: (value: WeekdayKey | "") => void;
    onModalExceptionalLeaveWeekdaysChange: (updater: (prev: WeekdayKey[]) => WeekdayKey[]) => void;
    onLeaveEntitlementDateChange: (value: string) => void;
    onLeaveAdjustDaysChange: (value: string) => void;
    onLeaveAdjustDateChange: (value: string) => void;
    onLeaveAdjustNoteChange: (value: string) => void;
    onSaveEntitlementDate: () => void;
    onApplyLeaveChange: (mode: "add" | "deduct") => void;
    onDeleteLeaveEntry: (entry: LeaveEntry) => void;
  };
};

function formatNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("ar-SA") : "0";
}

function formatMoney(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? `${number.toLocaleString("ar-SA")} ر.س` : "غير محدد";
}

function formatLeaveChange(entry: LeaveEntry) {
  const changeAmount = getLeaveEntryChangeAmount(entry);
  if (!changeAmount) return "غير متوفر";
  return `${changeAmount > 0 ? "+" : ""}${changeAmount} يوم`;
}

function formatLeaveBalance(value: number | null) {
  if (value == null) return "غير متوفر";
  return `${value} يوم`;
}

function leaveActionLabel(entry: LeaveEntry) {
  return getLeaveEntryActionType(entry) === "deduct" ? "إجازة / خصم" : "إضافة";
}

export default function EmployeeStatsSection({
  isVisible,
  busy,
  loading,
  canManagePayroll,
  canManageLeaveBalance,
  leaveBalanceDays,
  leaveEntries,
  showPayrollSubTab,
  showStatsSubTab,
  currentMonthKeyLabel,
  payroll,
  leave,
}: EmployeeStatsSectionProps) {
  if (!isVisible) return null;

  const sortedLeaveEntries = leaveEntries
    .filter((entry) => !isDeletedLeaveEntry(entry))
    .slice()
    .sort((a, b) =>
      String(getLeaveEntryCreatedAt(b) || b.date || "").localeCompare(String(getLeaveEntryCreatedAt(a) || a.date || ""))
    )
    .slice(0, 12);

  const payrollSetup = payroll.setupPreview;
  const leaveBalanceLabel = loading ? "جاري التحميل..." : `${formatNumber(leaveBalanceDays)} يوم`;
  const readOnlyPayroll = busy || !canManagePayroll;
  const readOnlyLeave = busy || !canManageLeaveBalance;

  if (showPayrollSubTab) {
    return (
      <div className="dsv2-ew-tab-panel">
        <EmployeePayrollTabLiveV2
          readOnly={readOnlyPayroll}
          monthlySalary={payroll.monthlySalary}
          workDays={payroll.workDays}
          dailyHours={payroll.dailyHours}
          monthlyHours={payroll.monthlyHours}
          overtimeEnabled={payroll.overtimeEnabled}
          overtimeMultiplier={payroll.overtimeMultiplier}
          deductionMethod={payroll.deductionMethod}
          savingSettings={payroll.savingSettings}
          settingsMessage={payroll.settingsMessage}
          onMonthlySalaryChange={payroll.onMonthlySalaryChange}
          onWorkDaysChange={payroll.onWorkDaysChange}
          onDailyHoursChange={payroll.onDailyHoursChange}
          onMonthlyHoursChange={payroll.onMonthlyHoursChange}
          onOvertimeEnabledChange={payroll.onOvertimeEnabledChange}
          onOvertimeMultiplierChange={payroll.onOvertimeMultiplierChange}
          onDeductionMethodChange={(value) => payroll.onDeductionMethodChange(value === "daily" ? "daily" : "hourly")}
          onSaveSettings={payroll.onSaveSettings}
        />

        <div className="dsv2-ew-metrics dsv2-ew-metrics--payroll">
          <WorkspaceMetricV2 label="الشهر" value={currentMonthKeyLabel} />
          <WorkspaceMetricV2 label="حالة الإعداد" value={payrollSetup.complete ? "مكتمل" : "غير مكتمل"} tone={payrollSetup.complete ? "success" : "gold"} />
          <WorkspaceMetricV2 label="راتب اليوم" value={formatMoney(payrollSetup.dailyRateRiyals)} />
          <WorkspaceMetricV2 label="راتب الساعة" value={formatMoney(payrollSetup.hourlyRateRiyals)} />
          <WorkspaceMetricV2 label="إجمالي الشهر" value={formatMoney(payroll.summary?.totalAmount)} tone="success" />
          <WorkspaceMetricV2 label="الإيراد" value={formatMoney(payroll.summary?.invoiceRevenue)} />
        </div>

        {!payrollSetup.complete && payrollSetup.missing.length ? (
          <WorkspaceNoticeV2
            title="إعداد الراتب غير مكتمل"
            description={`النواقص: ${payrollSetup.missing.join("، ")}`}
            tone="gold"
          />
        ) : null}
      </div>
    );
  }

  if (!showStatsSubTab) return null;

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الإجازات"
        description="إدارة رصيد الإجازات والحالة الحالية وسجل الحركات من واجهة V2."
        badge={<WorkspaceStatusBadgeV2 tone={leave.modalOnLeave ? "gold" : "success"}>{leave.modalOnLeave ? "على إجازة" : "على رأس العمل"}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="الرصيد الحالي" value={leaveBalanceLabel} tone="success" />
        <WorkspaceMetricV2 label="الحالة" value={leave.modalOnLeave ? "إجازة" : "عمل"} tone={leave.modalOnLeave ? "gold" : "success"} />
        <WorkspaceMetricV2 label="نهاية الإجازة" value={leave.modalLeaveUntil ? fmtIsoDate(leave.modalLeaveUntil) : "غير محددة"} />
        <WorkspaceMetricV2 label="سجل الحركات" value={sortedLeaveEntries.length} />
      </div>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="حالة الإجازة الحالية" description="تحديث حالة الموظفة وملاحظات الإجازة.">
          <WorkspaceSwitchV2
            checked={leave.modalOnLeave}
            disabled={readOnlyLeave}
            label="الموظفة على إجازة"
            description="عند التفعيل يتم إيقاف توفرها حسب إعدادات الحجز."
            onChange={leave.onModalOnLeaveChange}
          />

          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="employee-live-v2-leave-until" label="الإجازة حتى">
              <DashboardDatePickerV2
                id="employee-live-v2-leave-until"
                value={leave.modalLeaveUntil}
                disabled={readOnlyLeave}
                clearable
                onChange={leave.onModalLeaveUntilChange}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-leave-weekday" label="يوم إجازة أسبوعي سريع">
              <DashboardSelectV2
                id="employee-live-v2-leave-weekday"
                value={leave.modalLeaveWeekdayDraft}
                disabled={readOnlyLeave}
                placeholder="اختر اليوم"
                options={[
                  { value: "", label: "بدون اختيار" },
                  ...WEEKDAY_OPTIONS.map((day) => ({ value: day.key, label: day.label })),
                ]}
                onChange={(value) => leave.onModalLeaveWeekdayDraftChange(value as WeekdayKey | "")}
              />
            </DashboardFieldV2>
          </div>

          <DashboardFieldV2 id="employee-live-v2-leave-note" label="ملاحظة الإجازة">
            <textarea
              id="employee-live-v2-leave-note"
              className="dsv2-textarea"
              rows={4}
              value={leave.modalLeaveNote}
              disabled={readOnlyLeave}
              onChange={(event) => leave.onModalLeaveNoteChange(event.target.value)}
            />
          </DashboardFieldV2>

          {leave.modalLeaveExpired ? (
            <WorkspaceNoticeV2
              title="انتهى تاريخ الإجازة"
              description="راجع حالة الموظفة أو حدّث تاريخ العودة."
              tone="danger"
            />
          ) : null}
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="رصيد الإجازات" description="تاريخ الاستحقاق وتعديل الرصيد.">
          <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
            <DashboardFieldV2 id="employee-live-v2-entitlement-date" label="تاريخ الاستحقاق">
              <DashboardDatePickerV2
                id="employee-live-v2-entitlement-date"
                value={leave.leaveEntitlementDate}
                disabled={readOnlyLeave}
                clearable
                onChange={leave.onLeaveEntitlementDateChange}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-adjust-date" label="تاريخ الحركة">
              <DashboardDatePickerV2
                id="employee-live-v2-adjust-date"
                value={leave.leaveAdjustDate}
                disabled={readOnlyLeave}
                clearable
                onChange={leave.onLeaveAdjustDateChange}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-adjust-days" label="عدد الأيام">
              <input
                id="employee-live-v2-adjust-days"
                className="dsv2-input"
                type="number"
                min="0"
                step="1"
                value={leave.leaveAdjustDays}
                disabled={readOnlyLeave}
                onChange={(event) => leave.onLeaveAdjustDaysChange(event.target.value)}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-adjust-note" label="سبب الحركة">
              <input
                id="employee-live-v2-adjust-note"
                className="dsv2-input"
                value={leave.leaveAdjustNote}
                disabled={readOnlyLeave}
                onChange={(event) => leave.onLeaveAdjustNoteChange(event.target.value)}
              />
            </DashboardFieldV2>
          </div>

          <div className="dsv2-cluster">
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnlyLeave} onClick={leave.onSaveEntitlementDate}>حفظ تاريخ الاستحقاق</button>
            <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm" disabled={readOnlyLeave} onClick={() => leave.onApplyLeaveChange("add")}>إضافة رصيد</button>
            <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnlyLeave} onClick={() => leave.onApplyLeaveChange("deduct")}>خصم رصيد</button>
          </div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="أيام الإجازة الأسبوعية" description="اختيار أكثر من يوم ثابت للموظفة.">
        <div className="dsv2-ew-pills" role="group" aria-label="أيام الإجازة الأسبوعية">
          {WEEKDAY_OPTIONS.map((day) => {
            const active = leave.modalExceptionalLeaveWeekdays.includes(day.key);
            return (
              <button
                key={day.key}
                type="button"
                className="dsv2-ew-pill"
                data-active={active ? "true" : "false"}
                disabled={readOnlyLeave}
                onClick={() => {
                  leave.onModalExceptionalLeaveWeekdaysChange((prev) =>
                    prev.includes(day.key) ? prev.filter((item) => item !== day.key) : [...prev, day.key]
                  );
                }}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2 title="سجل حركات الإجازات" description="آخر 12 حركة محفوظة.">
        <WorkspaceTableV2
          headers={["التاريخ", "النوع", "التغيير", "قبل", "بعد", "إجراء"]}
          rows={sortedLeaveEntries.map((entry) => [
            fmtIsoDate(entry.date || String(getLeaveEntryCreatedAt(entry) || "")),
            leaveActionLabel(entry),
            formatLeaveChange(entry),
            formatLeaveBalance(getLeaveEntryBalanceBefore(entry)),
            formatLeaveBalance(getLeaveEntryBalanceAfter(entry)),
            <button
              key={`${entry.id || entry.date}-delete`}
              type="button"
              className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
              disabled={readOnlyLeave}
              onClick={() => leave.onDeleteLeaveEntry(entry)}
            >
              حذف
            </button>,
          ])}
          emptyText={loading ? "جاري تحميل السجل..." : "لا توجد حركات إجازات محفوظة."}
        />
      </WorkspaceCardV2>
    </div>
  );
}
