import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
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
import PayrollObligationsPanel from "./PayrollObligationsPanel";
import LeaveRestManagementPanel from "./LeaveRestManagementPanel";
import {
  getLeaveEntryActionType,
  getLeaveEntryBalanceAfter,
  getLeaveEntryBalanceBefore,
  getLeaveEntryChangeAmount,
  getLeaveEntryCreatedAt,
  isDeletedLeaveEntry,
} from "../../helpers/hr/leaveBalanceEntry";
import { useEmployeeLanguage } from "./employeeLanguage";
type PayrollSummary = {
  totalAmount?: number;
  invoiceRevenue?: number;
} | null;

type PayrollSetupPreview = {
  baseSalaryRiyals: number;
  housingAllowanceRiyals: number;
  transportationAllowanceRiyals: number;
  otherAllowancesRiyals: number;
  contractedMonthlySalaryRiyals: number;
  socialInsuranceCategory: "" | "saudi_existing" | "saudi_new" | "gcc" | "non_saudi";
  socialInsuranceEffectiveFrom: string;
  gosiWageMode: "derived" | "override";
  gosiContributoryWageRiyals: number;
  gosiEmployeeDeductionRiyals: number;
  gosiEmployerContributionRiyals: number;
  gosiEmployeeRateBps: number;
  gosiEmployerRateBps: number;
  gosiPolicyVersion: string;
  gosiWageSourceLabel: string;
  gosiWasFloored: boolean;
  gosiWasCapped: boolean;
  gosiPreviewError: string;
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
  employeeId: string;
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
    housingAllowance: string;
    transportationAllowance: string;
    otherAllowances: string;
    socialInsuranceCategory: "" | "saudi_existing" | "saudi_new" | "gcc" | "non_saudi";
    socialInsuranceEffectiveFrom: string;
    socialInsuranceClassificationNote: string;
    gosiWageMode: "derived" | "override";
    gosiContributoryWageOverride: string;
    gosiContributoryWageOverrideReason: string;
    gccHomeCountryCode: string;
    workDays: string;
    dailyHours: string;
    monthlyHours: string;
    overtimeEnabled: boolean;
    overtimeMultiplier: string;
    deductionMethod: PayrollDeductionMethodLiveV2;
    attendancePayrollMode: "required" | "exempt";
    attendancePayrollExemptionReason: string;
    summary: PayrollSummary;
    setupPreview: PayrollSetupPreview;
    savingSettings: boolean;
    onMonthlySalaryChange: (value: string) => void;
    onHousingAllowanceChange: (value: string) => void;
    onTransportationAllowanceChange: (value: string) => void;
    onOtherAllowancesChange: (value: string) => void;
    onSocialInsuranceCategoryChange: (value: string) => void;
    onSocialInsuranceEffectiveFromChange: (value: string) => void;
    onSocialInsuranceClassificationNoteChange: (value: string) => void;
    onGosiWageModeChange: (value: string) => void;
    onGosiContributoryWageOverrideChange: (value: string) => void;
    onGosiContributoryWageOverrideReasonChange: (value: string) => void;
    onGccHomeCountryCodeChange: (value: string) => void;
    onWorkDaysChange: (value: string) => void;
    onDailyHoursChange: (value: string) => void;
    onMonthlyHoursChange: (value: string) => void;
    onOvertimeEnabledChange: (value: boolean) => void;
    onOvertimeMultiplierChange: (value: string) => void;
    onDeductionMethodChange: (value: PayrollDeductionMethodLiveV2) => void;
    onAttendancePayrollModeChange: (
      value: "required" | "exempt"
    ) => void;
    onAttendancePayrollExemptionReasonChange: (
      value: string
    ) => void;
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

function formatNumber(value: unknown, language: "ar" | "en" = "ar") {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn") : "0";
}

function formatMoney(value: unknown, language: "ar" | "en" = "ar") {
  const number = Number(value || 0);
  if (!(Number.isFinite(number) && number > 0)) return language === "en" ? "Not specified" : "غير محدد";
  return `${number.toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn")} ${language === "en" ? "SAR" : "ر.س"}`;
}

function formatMoneyIncludingZero(value: unknown, language: "ar" | "en" = "ar") {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? `${number.toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn")} ${language === "en" ? "SAR" : "ر.س"}`
    : language === "en" ? "Not specified" : "غير محدد";
}

function formatRateBasisPoints(value: unknown, language: "ar" | "en" = "ar") {
  const bps = Number(value);
  if (!Number.isFinite(bps) || bps < 0) return language === "en" ? "Not specified" : "غير محدد";
  return `${Math.round(bps) / 100}%`;
}

function formatLeaveChange(entry: LeaveEntry, language: "ar" | "en" = "ar") {
  const changeAmount = getLeaveEntryChangeAmount(entry);
  if (!changeAmount) return language === "en" ? "Unavailable" : "غير متوفر";
  return `${changeAmount > 0 ? "+" : ""}${changeAmount} ${language === "en" ? "day(s)" : "يوم"}`;
}

function formatLeaveBalance(value: number | null, language: "ar" | "en" = "ar") {
  if (value == null) return language === "en" ? "Unavailable" : "غير متوفر";
  return `${value} ${language === "en" ? "day(s)" : "يوم"}`;
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
  if (type === "weekly_rest_substitute_use") return "راحة أسبوعية تعويضية";
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
  employeeId,
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
  const { language, t, tr } = useEmployeeLanguage();
  if (!isVisible) return null;

  const sortedLeaveEntries = leaveEntries
    .filter((entry) => !isDeletedLeaveEntry(entry))
    .slice()
    .sort((a, b) =>
      String(getLeaveEntryCreatedAt(b) || b.date || "").localeCompare(String(getLeaveEntryCreatedAt(a) || a.date || ""))
    )
    .slice(0, 12);

  const payrollSetup = payroll.setupPreview;
  const leaveBalanceLabel = loading ? t("جاري التحميل...") : tr(`${formatNumber(leaveBalanceDays, language)} يوم`, `${formatNumber(leaveBalanceDays, language)} day(s)`);
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
  const leaveStatusLabel = activeLeaveNow ? t("على إجازة") : upcomingLeave ? t("إجازة قادمة") : tr("على رأس العمل", "Active at work");

  if (showPayrollSubTab) {
    return (
      <div className="dsv2-ew-tab-panel">
        <EmployeePayrollTabLiveV2
          readOnly={readOnlyPayroll}
          monthlySalary={payroll.monthlySalary}
          housingAllowance={payroll.housingAllowance}
          transportationAllowance={payroll.transportationAllowance}
          otherAllowances={payroll.otherAllowances}
          socialInsuranceCategory={payroll.socialInsuranceCategory}
          socialInsuranceEffectiveFrom={payroll.socialInsuranceEffectiveFrom}
          socialInsuranceClassificationNote={payroll.socialInsuranceClassificationNote}
          gosiWageMode={payroll.gosiWageMode}
          gosiContributoryWageOverride={payroll.gosiContributoryWageOverride}
          gosiContributoryWageOverrideReason={payroll.gosiContributoryWageOverrideReason}
          gccHomeCountryCode={payroll.gccHomeCountryCode}
          workDays={payroll.workDays}
          dailyHours={payroll.dailyHours}
          monthlyHours={payroll.monthlyHours}
          overtimeEnabled={payroll.overtimeEnabled}
          overtimeMultiplier={payroll.overtimeMultiplier}
          deductionMethod={payroll.deductionMethod}
          attendancePayrollMode={
            payroll.attendancePayrollMode
          }
          attendancePayrollExemptionReason={
            payroll.attendancePayrollExemptionReason
          }
          savingSettings={payroll.savingSettings}
          onMonthlySalaryChange={payroll.onMonthlySalaryChange}
          onHousingAllowanceChange={payroll.onHousingAllowanceChange}
          onTransportationAllowanceChange={payroll.onTransportationAllowanceChange}
          onOtherAllowancesChange={payroll.onOtherAllowancesChange}
          onSocialInsuranceCategoryChange={payroll.onSocialInsuranceCategoryChange}
          onSocialInsuranceEffectiveFromChange={payroll.onSocialInsuranceEffectiveFromChange}
          onSocialInsuranceClassificationNoteChange={payroll.onSocialInsuranceClassificationNoteChange}
          onGosiWageModeChange={payroll.onGosiWageModeChange}
          onGosiContributoryWageOverrideChange={payroll.onGosiContributoryWageOverrideChange}
          onGosiContributoryWageOverrideReasonChange={payroll.onGosiContributoryWageOverrideReasonChange}
          onGccHomeCountryCodeChange={payroll.onGccHomeCountryCodeChange}
          onWorkDaysChange={payroll.onWorkDaysChange}
          onDailyHoursChange={payroll.onDailyHoursChange}
          onMonthlyHoursChange={payroll.onMonthlyHoursChange}
          onOvertimeEnabledChange={payroll.onOvertimeEnabledChange}
          onOvertimeMultiplierChange={payroll.onOvertimeMultiplierChange}
          onDeductionMethodChange={(value) => payroll.onDeductionMethodChange(value === "daily" ? "daily" : "hourly")}
          onAttendancePayrollModeChange={
            payroll.onAttendancePayrollModeChange
          }
          onAttendancePayrollExemptionReasonChange={
            payroll.onAttendancePayrollExemptionReasonChange
          }
          onSaveSettings={payroll.onSaveSettings}
        />

        <div className="dsv2-ew-metrics dsv2-ew-metrics--payroll">
          <WorkspaceMetricV2 label="الشهر" value={currentMonthKeyLabel} />
          <WorkspaceMetricV2 label="حالة الإعداد" value={payrollSetup.complete ? t("مكتمل") : t("غير مكتمل")} tone={payrollSetup.complete ? "success" : "gold"} />
          <WorkspaceMetricV2 label="راتب اليوم" value={formatMoney(payrollSetup.dailyRateRiyals, language)} />
          <WorkspaceMetricV2 label="راتب الساعة" value={formatMoney(payrollSetup.hourlyRateRiyals, language)} />
          <WorkspaceMetricV2 label="إجمالي الراتب التعاقدي" value={formatMoney(payrollSetup.contractedMonthlySalaryRiyals, language)} tone="success" />
          <WorkspaceMetricV2 label="إجمالي الشهر" value={formatMoney(payroll.summary?.totalAmount, language)} tone="success" />
          <WorkspaceMetricV2 label="الإيراد" value={formatMoney(payroll.summary?.invoiceRevenue, language)} />
        </div>

        <div className="dsv2-ew-metrics dsv2-ew-metrics--payroll">
          <WorkspaceMetricV2
            label="أجر الاشتراك في GOSI"
            value={
              payrollSetup.socialInsuranceCategory && payrollSetup.gosiContributoryWageRiyals > 0
                ? formatMoneyIncludingZero(payrollSetup.gosiContributoryWageRiyals, language)
                : t("غير محسوب")
            }
            tone={payrollSetup.gosiContributoryWageRiyals > 0 ? "success" : "gold"}
          />
          <WorkspaceMetricV2
            label="خصم الموظفة GOSI"
            value={
              payrollSetup.socialInsuranceCategory && !payrollSetup.gosiPreviewError
                ? formatMoneyIncludingZero(payrollSetup.gosiEmployeeDeductionRiyals, language)
                : t("غير محسوب")
            }
          />
          <WorkspaceMetricV2
            label="نسبة خصم الموظفة GOSI"
            value={
              payrollSetup.socialInsuranceCategory && !payrollSetup.gosiPreviewError
                ? formatRateBasisPoints(payrollSetup.gosiEmployeeRateBps, language)
                : t("غير محسوبة")
            }
          />
          <WorkspaceMetricV2
            label="نسبة مساهمة المنشأة GOSI"
            value={
              payrollSetup.socialInsuranceCategory && !payrollSetup.gosiPreviewError
                ? formatRateBasisPoints(payrollSetup.gosiEmployerRateBps, language)
                : t("غير محسوبة")
            }
          />
          <WorkspaceMetricV2
            label="مساهمة المنشأة GOSI"
            value={
              payrollSetup.socialInsuranceCategory && !payrollSetup.gosiPreviewError
                ? formatMoneyIncludingZero(payrollSetup.gosiEmployerContributionRiyals, language)
                : t("غير محسوب")
            }
          />
          <WorkspaceMetricV2
            label="مصدر أجر الاشتراك"
            value={payrollSetup.gosiWageSourceLabel ? t(payrollSetup.gosiWageSourceLabel) : t("غير محسوب")}
          />
          <WorkspaceMetricV2
            label="سياسة GOSI"
            value={payrollSetup.gosiPolicyVersion || t("غير محسوبة")}
          />
        </div>

        {payrollSetup.gosiPreviewError ? (
          <WorkspaceNoticeV2
            title="حساب GOSI غير جاهز"
            description={
              payrollSetup.gosiPreviewError === "gosi_gcc_extension_policy_required"
                ? "الموظفة مصنفة خليجية. لا يتم تحويلها تلقائيًا إلى غير سعودية؛ يجب استكمال سياسة مد الحماية قبل اعتماد الراتب."
                : tr("تعذر إنشاء معاينة GOSI: ", "Could not create GOSI preview: ") + payrollSetup.gosiPreviewError
            }
            tone="gold"
          />
        ) : null}

        {payrollSetup.gosiWasFloored || payrollSetup.gosiWasCapped ? (
          <WorkspaceNoticeV2
            title="تم تطبيق حد على أجر الاشتراك"
            description={
              payrollSetup.gosiWasFloored
                ? "أجر الاشتراك المدخل أقل من الحد الأدنى المطبق في سياسة GOSI الحالية، لذلك استخدم المحرك الحد الأدنى."
                : "أجر الاشتراك المدخل أعلى من الحد الأعلى المطبق في سياسة GOSI الحالية، لذلك استخدم المحرك الحد الأعلى."
            }
            tone="gold"
          />
        ) : null}

        {!payrollSetup.complete && payrollSetup.missing.length ? (
          <WorkspaceNoticeV2
            title="إعداد الراتب غير مكتمل"
            description={tr(`النواقص: ${payrollSetup.missing.join("، ")}`, `Missing: ${payrollSetup.missing.join(", ")}`)}
            tone="gold"
          />
        ) : null}

        <PayrollObligationsPanel
          employeeId={employeeId}
          currentPayrollMonth={currentMonthKeyLabel}
          readOnly={readOnlyPayroll}
        />
      </div>
    );
  }

  if (!showStatsSubTab) return null;

  return (
    <div className="dsv2-ew-tab-panel">
      <WorkspaceTabHeaderV2
        title="الإجازات والراحة"
        description="مرجع واحد للإجازة السنوية والراحة الأسبوعية والراحة التعويضية والاستدعاءات التشغيلية."
        badge={<WorkspaceStatusBadgeV2 tone={leave.modalOnLeave ? "gold" : "success"}>{leaveStatusLabel}</WorkspaceStatusBadgeV2>}
      />

      <LeaveRestManagementPanel
        employeeId={employeeId}
        readOnly={readOnlyLeave}
        weeklyRestWeekdays={leave.modalExceptionalLeaveWeekdays}
      />

      <WorkspaceCardV2
        title="تفاصيل الإجازة والرصيد السنوي"
        description="التفاصيل الإدارية الحالية تبقى هنا منفصلة عن الراحة الأسبوعية والتعويضية."
      >
      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="الرصيد الحالي" value={leaveBalanceLabel} tone="success" />
        <WorkspaceMetricV2 label="الحالة" value={leaveStatusLabel} tone={leave.modalOnLeave ? "gold" : "success"} />
        <WorkspaceMetricV2 label="بداية الإجازة" value={leave.modalLeaveFrom ? fmtIsoDate(leave.modalLeaveFrom) : t("غير محددة")} />
        <WorkspaceMetricV2 label="نهاية الإجازة" value={leave.modalLeaveUntil ? fmtIsoDate(leave.modalLeaveUntil) : t("غير محددة")} />
        <WorkspaceMetricV2 label="نوع الإجازة" value={leave.modalOnLeave ? t(leaveTypeLabel(leave.modalLeaveType)) : t("غير محددة")} />
        <WorkspaceMetricV2 label="سجل الحركات" value={sortedLeaveEntries.length} />
      </div>
      </WorkspaceCardV2>

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="حالة الإجازة الحالية" description="الإجازات هنا معتمدة ومرتبطة بالحضور والراتب.">
          <WorkspaceNoticeV2
            title={leave.modalOnLeave ? leaveStatusLabel : t("لا توجد إجازة فعالة")}
            description={
              leave.modalOnLeave
                ? tr(`${leaveTypeLabel(leave.modalLeaveType)} من ${leave.modalLeaveFrom ? fmtIsoDate(leave.modalLeaveFrom) : "تاريخ غير محدد"} إلى ${leave.modalLeaveUntil ? fmtIsoDate(leave.modalLeaveUntil) : "تاريخ غير محدد"}.${leave.modalLeaveNote ? ` ${leave.modalLeaveNote}` : ""}`, `${t(leaveTypeLabel(leave.modalLeaveType))} from ${leave.modalLeaveFrom ? fmtIsoDate(leave.modalLeaveFrom) : "date not specified"} to ${leave.modalLeaveUntil ? fmtIsoDate(leave.modalLeaveUntil) : "date not specified"}.${leave.modalLeaveNote ? ` ${leave.modalLeaveNote}` : ""}`)
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
              {tr("تسجيل إجازة معتمدة", "Record approved leave")}
            </button>
            {leave.modalOnLeave ? (
              <button
                type="button"
                className="dsv2-btn dsv2-btn--danger"
                disabled={readOnlyLeave}
                onClick={leave.onEndCurrentLeave}
              >
                {tr("إنهاء الإجازة الحالية", "End current leave")}
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
            <DashboardFieldV2 id="employee-live-v2-entitlement-date" label={t("تاريخ الاستحقاق")}>
              <DashboardDatePickerV2
                id="employee-live-v2-entitlement-date"
                value={leave.leaveEntitlementDate}
                disabled={readOnlyLeave}
                clearable
                onChange={leave.onLeaveEntitlementDateChange}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-adjust-date" label={t("تاريخ الحركة")}>
              <DashboardDatePickerV2
                id="employee-live-v2-adjust-date"
                value={leave.leaveAdjustDate}
                disabled={readOnlyLeave}
                clearable
                onChange={leave.onLeaveAdjustDateChange}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-adjust-days" label={t("عدد الأيام")}>
              <DashboardNumberInputV2
                id="employee-live-v2-adjust-days"
                className="dsv2-input"
                min="0"
                step="1"
                value={leave.leaveAdjustDays}
                disabled={readOnlyLeave}
                onChange={(event) => leave.onLeaveAdjustDaysChange(event.target.value)}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="employee-live-v2-adjust-note" label={t("سبب الحركة")}>
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
            <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={readOnlyLeave} onClick={leave.onSaveEntitlementDate}>{tr("حفظ تاريخ الاستحقاق", "Save entitlement date")}</button>
            <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm" disabled={readOnlyLeave} onClick={() => leave.onApplyLeaveChange("add")}>{tr("إضافة رصيد", "Add balance")}</button>
            <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={readOnlyLeave} onClick={() => leave.onApplyLeaveChange("deduct")}>{tr("خصم رصيد", "Deduct balance")}</button>
          </div>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2 title="سجل حركات الإجازات" description="آخر 12 حركة محفوظة.">
        <WorkspaceTableV2
          headers={["التاريخ", "النوع", "التغيير", "قبل", "بعد", "إجراء"]}
          rows={sortedLeaveEntries.map((entry) => [
            fmtIsoDate(entry.date || String(getLeaveEntryCreatedAt(entry) || "")),
            t(leaveActionLabel(entry)),
            formatLeaveChange(entry, language),
            formatLeaveBalance(getLeaveEntryBalanceBefore(entry), language),
            formatLeaveBalance(getLeaveEntryBalanceAfter(entry), language),
            <button
              key={`${entry.id || entry.date}-delete`}
              type="button"
              className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
              disabled={readOnlyLeave}
              onClick={() => leave.onDeleteLeaveEntry(entry)}
            >
              {t("حذف")}
            </button>,
          ])}
          emptyText={loading ? t("جاري تحميل السجل...") : t("لا توجد حركات إجازات محفوظة.")}
        />
      </WorkspaceCardV2>
    </div>
  );
}
