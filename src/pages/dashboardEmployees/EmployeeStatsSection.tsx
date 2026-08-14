import {
  DashboardDatePickerV2,
  DashboardFieldV2,
} from "../../components/dashboard-v2";
import {
  EmployeePayrollTabLiveV2,
} from "../../components/dashboard-v2/employee-workspace/live";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
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
} from "../../helpers/hr/leaveBalanceEntry";
import type { StaffOvertimeHoursBasis } from "../../helpers/staffPayroll";

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

type PayrollDeductionMethodLiveV2 = "hourly" | "daily";

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
    deductionMethod: PayrollDeductionMethodLiveV2;
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
    onDeductionMethodChange: (value: PayrollDeductionMethodLiveV2) => void;
    onSaveSettings: () => void;
  };
  leave: {
    modalOnLeave: boolean;
    modalLeaveFrom: string;
    modalLeaveUntil: string;
    modalLeaveType: string;
    modalLeaveNote: string;
    modalExceptionalLeaveWeekdays: WeekdayKey[];
    modalLeaveExpired: boolean;
    leaveEntitlementDate: string;
    leaveAdjustDays: string;
    leaveAdjustDate: string;
    leaveAdjustNote: string;
    onCreateApprovedLeave: () => void;
    onEndCurrentLeave: () => void;
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

function leaveTypeLabel(value: string) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "annual") return "سنوية مدفوعة";
  if (type === "sick") return "مرضية مدفوعة";
  if (type === "emergency") return "طارئة مدفوعة";
  if (type === "unpaid") return "إجازة بدون راتب";
  if (type === "rest") return "راحة معتمدة";
  if (type === "other") return "إجازة أخرى";
  return "غير محدد";
}

function isLeaveActiveNow(fromDate: string, toDate: string) {
  const today = new Date().toISOString().slice(0, 10);
  const from = String(fromDate || "").trim();
  const to = String(toDate || "").trim();
  if (!from && !to) return false;
  return (!from || from <= today) && (!to || today <= to);
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
  // Background reads must never lock write controls. `busy` is loading || saving
  // in DashboardEmployees, so only treat it as a write lock when loading is false.
  const writeBusy = busy && !loading;
  const readOnlyPayroll = writeBusy || payroll.savingSettings || !canManagePayroll;
  const readOnlyLeave = writeBusy || !canManageLeaveBalance;
  const activeLeaveNow = leave.modalOnLeave && isLeaveActiveNow(leave.modalLeaveFrom, leave.modalLeaveUntil);
  const upcomingLeave =
    leave.modalOnLeave &&
    !!leave.modalLeaveFrom &&
    leave.modalLeaveFrom > new Date().toISOString().slice(0, 10);
  const leaveStatusLabel = activeLeaveNow ? "على إجازة" : upcomingLeave ? "إجازة قادمة" : "على رأس العمل";

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
        badge={<WorkspaceStatusBadgeV2 tone={leave.modalOnLeave ? "gold" : "success"}>{leaveStatusLabel}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="الرصيد الحالي" value={leaveBalanceLabel} tone="success" />
        <WorkspaceMetricV2 label="الحالة" value={leaveStatusLabel} tone={leave.modalOnLeave ? "gold" : "success"} />
        <WorkspaceMetricV2 label="بداية الإجازة" value={leave.modalLeaveFrom ? fmtIsoDate(leave.modalLeaveFrom) : "غير محددة"} />
        <WorkspaceMetricV2 label="نهاية الإجازة" value={leave.modalLeaveUntil ? fmtIsoDate(leave.modalLeaveUntil) : "غير محددة"} />
        <WorkspaceMetricV2 label="نوع الإجازة" value={leave.modalOnLeave ? leaveTypeLabel(leave.modalLeaveType) : "غير محددة"} />
        <WorkspaceMetricV2 label="سجل الحركات" value={sortedLeaveEntries.length} />
      </div>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="حالة الإجازة الحالية" description="الإجازات هنا معتمدة ومرتبطة بالحضور والراتب.">
          <WorkspaceNoticeV2
            title={leave.modalOnLeave ? leaveStatusLabel : "لا توجد إجازة فعالة"}
            description={
              leave.modalOnLeave
                ? `${leaveTypeLabel(leave.modalLeaveType)} من ${leave.modalLeaveFrom ? fmtIsoDate(leave.modalLeaveFrom) : "تاريخ غير محدد"} إلى ${leave.modalLeaveUntil ? fmtIsoDate(leave.modalLeaveUntil) : "تاريخ غير محدد"}.${leave.modalLeaveNote ? ` ${leave.modalLeaveNote}` : ""}`
                : "سجّل إجازة جديدة ليتم اعتمادها وإظهارها في الحضور وربط أثرها بالراتب."
            }
            tone={leave.modalOnLeave ? "gold" : "neutral"}
          />

          <div className="dsv2-cluster">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--success"
              disabled={readOnlyLeave}
              onClick={leave.onCreateApprovedLeave}
            >
              تسجيل إجازة معتمدة
            </button>
            {leave.modalOnLeave ? (
              <button
                type="button"
                className="dsv2-btn dsv2-btn--danger"
                disabled={readOnlyLeave}
                onClick={leave.onEndCurrentLeave}
              >
                إنهاء الإجازة الحالية
              </button>
            ) : null}
          </div>

          <WorkspaceNoticeV2
            title="الأثر المالي يُحدد حسب النوع"
            description="الإجازات السنوية والمرضية والطارئة تظهر في الحضور ولا تخصم من الراتب، بينما الإجازة بدون راتب تظهر كإجازة معتمدة ويُخصم مقابل أيامها من الراتب."
            tone="neutral"
          />

          {leave.modalLeaveExpired ? (
            <WorkspaceNoticeV2
              title="انتهى تاريخ الإجازة"
              description="يمكن إنهاء الحالة الحالية أو تسجيل إجازة جديدة بمدى زمني صحيح."
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

      <WorkspaceNoticeV2
        title="الراحة الأسبوعية لا تُخصم من رصيد الإجازات"
        description={
          leave.modalExceptionalLeaveWeekdays.length
            ? `الأيام الحالية: ${leave.modalExceptionalLeaveWeekdays
                .map((key) => WEEKDAY_OPTIONS.find((day) => day.key === key)?.label || key)
                .join("، ")}. يتم تعديلها من تبويب جدول الدوام.`
            : "لا توجد أيام راحة أسبوعية محددة. يتم ضبطها من تبويب جدول الدوام."
        }
        tone="neutral"
      />

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
