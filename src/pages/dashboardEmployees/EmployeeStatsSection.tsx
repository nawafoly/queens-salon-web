import EmployeeSelect from "../../components/EmployeeSelect";
import {
  WEEKDAY_OPTIONS,
  formatDailyHourBucketsLabel,
  fmtIsoDate,
  fmtMoneySar,
  normalizeExceptionalLeaveWeekdays,
  normalizeWeekdayKey,
  parsePositiveInt,
  type LeaveEntry,
  type WeekdayKey,
} from "./shared";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash } from "@fortawesome/free-solid-svg-icons";
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
    deductionMethod: "hourly" | "daily";
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
    onDeductionMethodChange: (value: "hourly" | "daily") => void;
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

  const formatLeaveChange = (entry: LeaveEntry) => {
    const changeAmount = getLeaveEntryChangeAmount(entry);
    if (!changeAmount) return "غير متوفر";
    return `${changeAmount > 0 ? "+" : ""}${changeAmount} يوم`;
  };

  const formatLeaveBalance = (value: number | null) => {
    if (value == null) return "غير متوفر";
    return `${value}`;
  };

  const leaveActionLabel = (entry: LeaveEntry) =>
    getLeaveEntryActionType(entry) === "deduct" ? "إجازة / خصم" : "إضافة";

  const currentLeaveBalance = parsePositiveInt(String(leaveBalanceDays || 0), 0);
  const currentLeaveBalanceLabel = loading ? "جاري التحميل..." : `${currentLeaveBalance} يوم`;
  const payrollSetup = payroll.setupPreview;
  const payrollSetupStatusLabel = payrollSetup.complete ? "مكتمل" : "غير مكتمل";
  const payrollMonthlyHoursLabel =
    payrollSetup.monthlyHours > 0 ? `${fmtMoneySar(payrollSetup.monthlyHours)} ساعة` : "غير محدد";
  const payrollDailyRateLabel =
    payrollSetup.dailyRateRiyals > 0 ? `${fmtMoneySar(payrollSetup.dailyRateRiyals)} ر.س` : "غير محدد";
  const payrollHourlyRateLabel =
    payrollSetup.hourlyRateRiyals > 0 ? `${fmtMoneySar(payrollSetup.hourlyRateRiyals)} ر.س` : "غير محدد";

  return (
    <div className="emp-modal-section">
      <header className="emp-section-header">
        <div className="emp-section-header__main">
          <h3 className="emp-modal-section-title">الإحصائيات والإجازات</h3>
          <p className="emp-section-lead">
            الراتب، الأوفر تايم، رصيد الإجازات، وسجل الحركات في مكان واحد.
          </p>
        </div>
        {showStatsSubTab ? (
          <div className="emp-section-header__aside">
            <span className="emp-badge accent">الرصيد: {currentLeaveBalanceLabel}</span>
          </div>
        ) : null}
      </header>

      <div className="emp-stats-stack">
      {showPayrollSubTab ? (
        <div className="staff-payroll-box" id="payroll-settings">
          <div className="staff-payroll-head">
            <div>
              <b>الراتب والدوام</b>
              <span>هذه الإعدادات تُستخدم في مسيرات الرواتب الشهرية.</span>
            </div>
            <em className={payrollSetup.complete ? "is-complete" : "is-incomplete"}>
              {payrollSetupStatusLabel}
            </em>
          </div>
          <div className="staff-payroll-form">
            <div className="dash-field">
              <label className="emp-label">الراتب الأساسي الشهري (ريال)</label>
              <input
                className="dash-input"
                type="number"
                min={0}
                step="0.01"
                value={payroll.monthlySalary}
                disabled={busy || !canManagePayroll}
                onChange={(e) => payroll.onMonthlySalaryChange(e.target.value)}
                placeholder="مثال: 3000"
              />
            </div>
            <div className="dash-field">
              <label className="emp-label">أيام العمل الشهرية المعتمدة</label>
              <input
                className="dash-input"
                type="number"
                min={0}
                step={1}
                value={payroll.workDays}
                disabled={busy || !canManagePayroll}
                onChange={(e) => payroll.onWorkDaysChange(e.target.value)}
                placeholder="مثال: 30"
              />
            </div>
            <div className="dash-field">
              <label className="emp-label">ساعات العمل اليومية</label>
              <input
                className="dash-input"
                type="number"
                min={0}
                step="0.25"
                value={payroll.dailyHours}
                disabled={busy || !canManagePayroll}
                onChange={(e) => payroll.onDailyHoursChange(e.target.value)}
                placeholder="مثال: 8"
              />
            </div>
            <div className="dash-field">
              <label className="emp-label">ساعات الشهر المعتمدة</label>
              <input
                className="dash-input"
                type="number"
                min={0}
                step="0.25"
                value={payroll.monthlyHours}
                disabled={busy || !canManagePayroll}
                onChange={(e) => payroll.onMonthlyHoursChange(e.target.value)}
                placeholder="اتركيه فارغًا للحساب التلقائي"
              />
            </div>
            <div className="dash-field">
              <label className="emp-label">ساعات الشهر المحسوبة</label>
              <div className="staff-payroll-calculated">
                <strong>{payrollMonthlyHoursLabel}</strong>
                <small>
                  {payrollSetup.monthlyHoursSource === "manual"
                    ? "مدخلة يدويًا"
                    : payrollSetup.monthlyHoursSource === "computed"
                      ? "من أيام العمل × ساعات اليوم"
                      : "تحتاج أيام العمل وساعات اليوم أو ساعات الشهر"}
                </small>
              </div>
            </div>
            <div className="dash-field">
              <label className="emp-label">احتساب الأوفر تايم</label>
              <label className="staff-payroll-toggle">
                <input
                  type="checkbox"
                  checked={payroll.overtimeEnabled}
                  disabled={busy || !canManagePayroll}
                  onChange={(e) => payroll.onOvertimeEnabledChange(e.target.checked)}
                />
                <span>{payroll.overtimeEnabled ? "مفعل" : "غير مفعل"}</span>
              </label>
            </div>
            {payroll.overtimeEnabled ? (
              <div className="dash-field">
                <label className="emp-label">معامل الأوفر تايم</label>
                <input
                  className="dash-input"
                  type="number"
                  min={0}
                  step="0.05"
                  value={payroll.overtimeMultiplier}
                  disabled={busy || !canManagePayroll}
                  onChange={(e) => payroll.onOvertimeMultiplierChange(e.target.value)}
                  placeholder="1.5"
                />
              </div>
            ) : null}
            <div className="dash-field">
              <label className="emp-label">طريقة خصم نقص الساعات</label>
              <EmployeeSelect
                value={payroll.deductionMethod}
                disabled={busy || !canManagePayroll}
                ariaLabel="طريقة خصم نقص الساعات"
                options={[
                  { value: "hourly", label: "حسب راتب الساعة" },
                  { value: "daily", label: "حسب راتب اليوم" },
                ]}
                onChange={(value) => payroll.onDeductionMethodChange(value === "daily" ? "daily" : "hourly")}
              />
            </div>
          </div>
          <div className="staff-payroll-preview">
            <div className="staff-payroll-preview-grid">
              <div className="staff-payroll-chip">
                <span>حالة الإعداد</span>
                <b>{payrollSetupStatusLabel}</b>
              </div>
              <div className="staff-payroll-chip">
                <span>ساعات الشهر</span>
                <b>{payrollMonthlyHoursLabel}</b>
              </div>
              <div className="staff-payroll-chip">
                <span>راتب اليوم</span>
                <b>{payrollDailyRateLabel}</b>
              </div>
              <div className="staff-payroll-chip">
                <span>راتب الساعة</span>
                <b>{payrollHourlyRateLabel}</b>
              </div>
              <div className="staff-payroll-chip">
                <span>الأوفر تايم</span>
                <b>{payroll.overtimeEnabled ? `مفعل × ${payroll.overtimeMultiplier || "1.5"}` : "غير مفعل"}</b>
              </div>
              <div className="staff-payroll-chip">
                <span>طريقة الخصم</span>
                <b>{payroll.deductionMethod === "daily" ? "حسب راتب اليوم" : "حسب راتب الساعة"}</b>
              </div>
            </div>
            <div className="staff-payroll-notes">
              <div className="staff-payroll-note">
                لن يتم احتساب الراتب في إدارة الرواتب حتى تكتمل: الراتب الأساسي، أيام العمل، وساعات الشهر أو ساعات اليوم.
              </div>
              {!payrollSetup.complete ? (
                <div className="staff-payroll-note is-warning">
                  النواقص: {payrollSetup.missing.join("، ")}
                </div>
              ) : null}
              {payroll.settingsMessage ? (
                <div className="staff-payroll-note is-success">
                  {payroll.settingsMessage}
                </div>
              ) : null}
            </div>
            <div className="staff-payroll-actions">
              <button
                type="button"
                className="exp-btn primary"
                disabled={busy || payroll.savingSettings || !canManagePayroll}
                onClick={payroll.onSaveSettings}
              >
                حفظ إعدادات الراتب
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showStatsSubTab ? (
        <div className="staff-leave-box">
          <div className="emp-kpi-strip">
            <div className="emp-kpi-card accent">
              <span>الرصيد الحالي</span>
              <b>{currentLeaveBalanceLabel}</b>
            </div>
            <div className="emp-kpi-card">
              <span>حالة الإجازة</span>
              <b>{leave.modalOnLeave ? "مجازة" : "في الدوام"}</b>
            </div>
            <div className="emp-kpi-card">
              <span>أيام الإجازة الثابتة</span>
              <b>{leave.modalExceptionalLeaveWeekdays.length} يوم</b>
            </div>
          </div>

          <div className="staff-leave-head">
            <span>إعدادات الإجازات</span>
          </div>

          <div className="staff-leave-settings-grid">
            <div className="dash-field">
              <label className="emp-label emp-check-label">
                <input
                  type="checkbox"
                  checked={leave.modalOnLeave}
                  disabled={busy || !canManageLeaveBalance}
                  onChange={(e) => leave.onModalOnLeaveChange(e.target.checked)}
                />
                في إجازة الآن
              </label>
            </div>

            <div className="dash-field">
              <label className="emp-label">تاريخ العودة</label>
              <input
                className="dash-input"
                type="date"
                value={leave.modalLeaveUntil}
                disabled={busy || !canManageLeaveBalance}
                onChange={(e) => leave.onModalLeaveUntilChange(e.target.value)}
              />
            </div>

            <div className="dash-field staff-leave-settings-wide">
              <label className="emp-label">ملاحظة الإجازة (اختياري)</label>
              <input
                className="dash-input"
                value={leave.modalLeaveNote}
                disabled={busy || !canManageLeaveBalance}
                onChange={(e) => leave.onModalLeaveNoteChange(e.target.value)}
                placeholder="مثال: عودة يوم الأحد"
              />
            </div>

            <div className="dash-field staff-leave-settings-wide">
              <label className="emp-label">الإجازة الأسبوعية الثابتة</label>
              <div className="emp-inline-actions">
                                <EmployeeSelect
                  value={String(
                    leave.modalLeaveWeekdayDraft || ""
                  )}
                  disabled={busy || !canManageLeaveBalance}
                  ariaLabel="الإجازة الأسبوعية الثابتة"
                  placeholder="اختاري اليوم"
                  options={[
                    {
                      value: "",
                      label: "اختاري اليوم",
                    },
                    ...WEEKDAY_OPTIONS.map((day) => ({
                      value: day.key,
                      label: day.label,
                    })),
                  ]}
                  onChange={(value) =>
                    leave.onModalLeaveWeekdayDraftChange(
                      value as WeekdayKey | ""
                    )
                  }
                />
                <button
                  type="button"
                  className="exp-btn ghost sm"
                  disabled={loading || !normalizeWeekdayKey(leave.modalLeaveWeekdayDraft)}
                  onClick={() => {
                    const next = normalizeWeekdayKey(leave.modalLeaveWeekdayDraft);
                    if (!next) return;
                    leave.onModalExceptionalLeaveWeekdaysChange((prev) =>
                      normalizeExceptionalLeaveWeekdays([...prev, next])
                    );
                    leave.onModalLeaveWeekdayDraftChange("");
                  }}
                >
                  إضافة اليوم
                </button>
              </div>

              {leave.modalExceptionalLeaveWeekdays.length > 0 ? (
                <div className="emp-tags-row">
                  {leave.modalExceptionalLeaveWeekdays.map((day) => (
                    <button
                      key={`modal_leave_chip_${day}`}
                      type="button"
                      className="exp-btn ghost sm"
                      disabled={busy || !canManageLeaveBalance}
                      onClick={() =>
                        leave.onModalExceptionalLeaveWeekdaysChange((prev) => prev.filter((item) => item !== day))
                      }
                      title="حذف يوم الإجازة الثابتة"
                    >
                      {WEEKDAY_OPTIONS.find((item) => item.key === day)?.label || day} ×
                    </button>
                  ))}
                </div>
              ) : (
                <div className="emp-field-note is-boxed">لا توجد أيام إجازة أسبوعية ثابتة.</div>
              )}
            </div>
          </div>

          {leave.modalLeaveExpired ? (
            <div className="emp-field-note danger">تاريخ الإجازة انتهى؛ بعد الحفظ سيتم اعتبار الموظفة غير مجازة.</div>
          ) : null}

          <div className="staff-leave-head">
            <span>تاريخ الاستحقاق القادم</span>
            <div className="staff-leave-head-actions">
              <input
                className="dash-input"
                type="date"
                value={leave.leaveEntitlementDate}
                disabled={busy || !canManageLeaveBalance}
                onChange={(e) => leave.onLeaveEntitlementDateChange(e.target.value)}
              />
              <button
                className="exp-btn"
                type="button"
                onClick={leave.onSaveEntitlementDate}
                disabled={busy || !canManageLeaveBalance}
              >
                حفظ الاستحقاق
              </button>
            </div>
          </div>

          {canManageLeaveBalance ? (
            <div className="staff-leave-controls">
              <input
                className="dash-input staff-leave-input"
                type="number"
                min={1}
                step={1}
                value={leave.leaveAdjustDays}
                onChange={(e) => leave.onLeaveAdjustDaysChange(e.target.value)}
                placeholder="عدد الأيام"
              />
              <input
                className="dash-input"
                type="date"
                value={leave.leaveAdjustDate}
                onChange={(e) => leave.onLeaveAdjustDateChange(e.target.value)}
              />
              <input
                className="dash-input"
                value={leave.leaveAdjustNote}
                onChange={(e) => leave.onLeaveAdjustNoteChange(e.target.value)}
                placeholder="ملاحظة (اختياري)"
              />
              <button className="exp-btn primary" type="button" disabled={busy || !canManageLeaveBalance} onClick={() => leave.onApplyLeaveChange("add")}>
                إضافة رصيد
              </button>
              <button className="exp-btn ghost" type="button" disabled={busy || !canManageLeaveBalance} onClick={() => leave.onApplyLeaveChange("deduct")}>
                تسجيل إجازة (خصم)
              </button>
            </div>
          ) : null}

          <div className="leave-log-list">
            <div className="leave-log-title">سجل الإجازات</div>
            <div className="leave-log-head">
              <span>النوع</span>
              <span>التغيير</span>
              <span>الرصيد قبل</span>
              <span>الرصيد بعد</span>
              <span>التاريخ</span>
              <span>الملاحظة</span>
              <span>حذف/تراجع</span>
            </div>
            {sortedLeaveEntries.map((entry) => (
              <div className="leave-log-row" key={entry.id}>
                <span className={`leave-log-type ${getLeaveEntryActionType(entry) === "deduct" ? "deduct" : "add"}`}>
                  {leaveActionLabel(entry)}
                </span>
                <span className="leave-log-change">{formatLeaveChange(entry)}</span>
                <span className="leave-log-balance">{formatLeaveBalance(getLeaveEntryBalanceBefore(entry))}</span>
                <span className="leave-log-balance">{formatLeaveBalance(getLeaveEntryBalanceAfter(entry))}</span>
                <span className="leave-log-date">{fmtIsoDate(entry.date)}</span>
                <span className="leave-log-note">{String(entry.note || "-")}</span>
                {canManageLeaveBalance ? (
                  <button
                    type="button"
                    className="leave-log-delete"
                    disabled={busy || !canManageLeaveBalance}
                    title="حذف السجل"
                    onClick={() => leave.onDeleteLeaveEntry(entry)}
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                ) : null}
              </div>
            ))}
            {sortedLeaveEntries.length === 0 ? <div className="leave-log-empty">لا يوجد سجل إجازات حتى الآن.</div> : null}
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
