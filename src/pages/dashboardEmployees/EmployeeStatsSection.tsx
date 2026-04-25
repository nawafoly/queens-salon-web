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
  canManageLeaveBalanceRole,
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

type EmployeeStatsSectionProps = {
  isVisible: boolean;
  busy: boolean;
  loading: boolean;
  authRole: string | null | undefined;
  leaveBalanceDays: number;
  leaveEntries: LeaveEntry[];
  showPayrollSubTab: boolean;
  showStatsSubTab: boolean;
  currentMonthKeyLabel: string;
  payroll: {
    monthlySalary: string;
    overtimeMethod: StaffPayrollMethod;
    overtimeDaysPerMonth: string;
    overtimeBaseHoursPerDay: string;
    overtimeSeasonBaseHoursPerDay: string;
    overtimeHoursBasis: StaffOvertimeHoursBasis;
    overtimePercent: string;
    overtimeInvoicePercent: string;
    summary: PayrollSummary;
    onMonthlySalaryChange: (value: string) => void;
    onOvertimeMethodChange: (value: StaffPayrollMethod) => void;
    onOvertimeDaysPerMonthChange: (value: string) => void;
    onOvertimeBaseHoursPerDayChange: (value: string) => void;
    onOvertimeSeasonBaseHoursPerDayChange: (value: string) => void;
    onOvertimeHoursBasisChange: (value: StaffOvertimeHoursBasis) => void;
    onOvertimePercentChange: (value: string) => void;
    onOvertimeInvoicePercentChange: (value: string) => void;
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
  authRole,
  leaveBalanceDays,
  leaveEntries,
  showPayrollSubTab,
  showStatsSubTab,
  currentMonthKeyLabel,
  payroll,
  leave,
}: EmployeeStatsSectionProps) {
  if (!isVisible) return null;

  const canManageLeaveBalance = canManageLeaveBalanceRole(authRole);

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

  return (
    <div className="emp-modal-section">
      <b className="emp-modal-section-title">الإحصائيات والإجازات</b>

      {showPayrollSubTab ? (
        <div className="staff-payroll-box">
          <div className="staff-payroll-head">
            <b>الراتب + الأوفر تايم</b>
            <span>يدخل تلقائيًا ضمن المصروفات والتقارير</span>
          </div>
          <div className="staff-payroll-form">
            <div className="dash-field">
              <label className="emp-label">الراتب الشهري (ريال)</label>
              <input
                className="dash-input"
                type="number"
                min={0}
                step="0.01"
                value={payroll.monthlySalary}
                disabled={busy}
                onChange={(e) => payroll.onMonthlySalaryChange(e.target.value)}
                placeholder="مثال: 5000"
              />
            </div>
            <div className="dash-field">
              <label className="emp-label">طريقة احتساب الأوفر تايم</label>
              <select
                className="dash-select"
                value={payroll.overtimeMethod}
                disabled={busy}
                onChange={(e) => payroll.onOvertimeMethodChange(e.target.value as StaffPayrollMethod)}
              >
                <option value="hours_from_salary">من الراتب + الساعات الإضافية</option>
                <option value="invoice_percentage">نسبة من فواتير الموظفة</option>
              </select>
            </div>
            {payroll.overtimeMethod === "hours_from_salary" ? (
              <>
                <div className="dash-field">
                  <label className="emp-label">عدد الأيام للتقسيم الشهري</label>
                  <input
                    className="dash-input"
                    type="number"
                    min={1}
                    step={1}
                    value={payroll.overtimeDaysPerMonth}
                    disabled={busy}
                    onChange={(e) => payroll.onOvertimeDaysPerMonthChange(e.target.value)}
                    placeholder="مثال: 30"
                  />
                </div>
                <div className="dash-field">
                  <label className="emp-label">الساعات الأساسية اليومية (العادي)</label>
                  <input
                    className="dash-input"
                    type="number"
                    min={1}
                    step="0.25"
                    value={payroll.overtimeBaseHoursPerDay}
                    disabled={busy}
                    onChange={(e) => payroll.onOvertimeBaseHoursPerDayChange(e.target.value)}
                    placeholder="مثال: 8"
                  />
                </div>
                <div className="dash-field">
                  <label className="emp-label">الساعات الأساسية اليومية (الموسم)</label>
                  <input
                    className="dash-input"
                    type="number"
                    min={1}
                    step="0.25"
                    value={payroll.overtimeSeasonBaseHoursPerDay}
                    disabled={busy}
                    onChange={(e) => payroll.onOvertimeSeasonBaseHoursPerDayChange(e.target.value)}
                    placeholder="مثال: 6"
                  />
                </div>
                <div className="dash-field">
                  <label className="emp-label">أساس حساب الأوفر تايم</label>
                  <select
                    className="dash-select"
                    value={payroll.overtimeHoursBasis}
                    disabled={busy}
                    onChange={(e) =>
                      payroll.onOvertimeHoursBasisChange(e.target.value === "season" ? "season" : "regular")
                    }
                  >
                    <option value="regular">الأيام العادية</option>
                    <option value="season">الموسم</option>
                  </select>
                </div>
                <div className="dash-field">
                  <label className="emp-label">نسبة زيادة الأوفر تايم (%)</label>
                  <input
                    className="dash-input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={payroll.overtimePercent}
                    disabled={busy}
                    onChange={(e) => payroll.onOvertimePercentChange(e.target.value)}
                    placeholder="مثال: 25"
                  />
                </div>
              </>
            ) : (
              <div className="dash-field">
                <label className="emp-label">نسبة الأوفر تايم من فواتير الموظفة (%)</label>
                <input
                  className="dash-input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={payroll.overtimeInvoicePercent}
                  disabled={busy}
                  onChange={(e) => payroll.onOvertimeInvoicePercentChange(e.target.value)}
                  placeholder="مثال: 40"
                />
              </div>
            )}
          </div>
          <div className="staff-payroll-preview">
            <div className="staff-payroll-preview-grid">
              <div className="staff-payroll-chip">
                <span>إجمالي الراتب الشهري</span>
                <b>{fmtMoneySar(payroll.summary?.salaryAmount || 0)} ر.س</b>
              </div>
              <div className="staff-payroll-chip">
                <span>مبلغ الأوفر تايم</span>
                <b>{fmtMoneySar(payroll.summary?.overtimeAmount || 0)} ر.س</b>
              </div>
              <div className="staff-payroll-chip accent">
                <span>إجمالي المستحق الشهري</span>
                <b>{fmtMoneySar(payroll.summary?.totalAmount || 0)} ر.س</b>
              </div>
              <div className="staff-payroll-chip">
                <span>ساعات الدوام المجدولة</span>
                <b>{fmtMoneySar(payroll.summary?.schedule.scheduledHours || 0)} ساعة</b>
              </div>
              <div className="staff-payroll-chip">
                <span>الساعات الأساسية المحتسبة</span>
                <b>{fmtMoneySar(payroll.summary?.schedule.baselineHours || 0)} ساعة</b>
              </div>
              <div className="staff-payroll-chip">
                <span>أساس الحساب</span>
                <b>{payroll.summary?.config.hoursBasis === "season" ? "الموسم" : "الأيام العادية"}</b>
              </div>
              <div className="staff-payroll-chip">
                <span>ساعات الأوفر تايم</span>
                <b>{fmtMoneySar(payroll.summary?.schedule.overtimeHours || 0)} ساعة</b>
              </div>
            </div>
            <div className="staff-payroll-note">
              {payroll.summary?.method === "invoice_percentage"
                ? `طريقة الحساب: نسبة من الفواتير (${payroll.summary.config.invoicePercent}%).`
                : `طريقة الحساب: (الراتب ÷ ${payroll.summary?.config.daysPerMonth || 0} يوم ÷ ${
                    payroll.summary?.config.hoursBasis === "season"
                      ? payroll.summary?.config.seasonBaseHoursPerDay || 0
                      : payroll.summary?.config.baseHoursPerDay || 0
                  } ساعة) ثم تطبيق نسبة ${
                    payroll.summary?.config.overtimePercent || 0
                  }% على ساعات الأوفر تايم.`}
            </div>
            <div className="staff-payroll-note">
              {`أساس الحساب المعتمد: ${
                payroll.summary?.config.hoursBasis === "season" ? "الموسم" : "الأيام العادية"
              } | الساعات المستخدمة يوميًا: ${
                payroll.summary?.config.hoursBasis === "season"
                  ? payroll.summary?.config.seasonBaseHoursPerDay || 0
                  : payroll.summary?.config.baseHoursPerDay || 0
              } ساعة.`}
            </div>
            <div className="staff-payroll-note">
              {`الشهر المحتسب: ${payroll.summary?.monthKey || currentMonthKeyLabel} | فواتير الموظفة: ${
                payroll.summary?.invoiceCount || 0
              } | إيرادها: ${fmtMoneySar(payroll.summary?.invoiceRevenue || 0)} ر.س`}
            </div>
          </div>
        </div>
      ) : null}

      {showPayrollSubTab && payroll.summary ? (
        <div className="staff-payroll-note">
          {`تفصيل الساعات المجدولة (ديناميكي): من ${
            payroll.summary.schedule.periodFrom || "-"
          } إلى ${
            payroll.summary.schedule.periodTo || "-"
          } | الأيام المحتسبة: ${fmtMoneySar(
            payroll.summary.schedule.workedDays || 0
          )} | متوسط ساعات اليوم: ${fmtMoneySar(
            payroll.summary.schedule.averageHoursPerWorkedDay || 0
          )} ساعة | التوزيع: ${formatDailyHourBucketsLabel(payroll.summary.schedule.dailyHourBuckets as any)}`}
        </div>
      ) : null}

      {showStatsSubTab ? (
        <div className="staff-leave-box">
          <div className="staff-leave-head">
            <span>إعدادات الإجازات للموظفة</span>
            <b>{parsePositiveInt(String(leaveBalanceDays || 0), 0)} يوم</b>
          </div>

          <div className="staff-leave-settings-grid">
            <div className="dash-field">
              <label className="emp-label emp-check-label">
                <input
                  type="checkbox"
                  checked={leave.modalOnLeave}
                  disabled={busy}
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
                disabled={busy}
                onChange={(e) => leave.onModalLeaveUntilChange(e.target.value)}
              />
            </div>

            <div className="dash-field staff-leave-settings-wide">
              <label className="emp-label">ملاحظة الإجازة (اختياري)</label>
              <input
                className="dash-input"
                value={leave.modalLeaveNote}
                disabled={busy}
                onChange={(e) => leave.onModalLeaveNoteChange(e.target.value)}
                placeholder="مثال: عودة يوم الأحد"
              />
            </div>

            <div className="dash-field staff-leave-settings-wide">
              <label className="emp-label">الإجازة الأسبوعية الثابتة</label>
              <div className="emp-inline-actions">
                <select
                  className="dash-select"
                  value={String(leave.modalLeaveWeekdayDraft || "")}
                  disabled={busy}
                  onChange={(e) => leave.onModalLeaveWeekdayDraftChange(e.target.value as WeekdayKey | "")}
                >
                  <option value="">اختاري اليوم</option>
                  {WEEKDAY_OPTIONS.map((day) => (
                    <option key={`modal_leave_day_${day.key}`} value={day.key}>
                      {day.label}
                    </option>
                  ))}
                </select>
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
                      disabled={busy}
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
                <div className="emp-field-note">لا توجد أيام إجازة أسبوعية ثابتة.</div>
              )}
            </div>
          </div>

          {leave.modalLeaveExpired ? (
            <div className="emp-field-note danger">تاريخ الإجازة انتهى؛ بعد الحفظ سيتم اعتبار الموظفة غير مجازة.</div>
          ) : null}

          <div className="staff-leave-head">
            <span>تاريخ الاستحقاق القادم</span>
            <div className="staff-leave-head-actions">
              <div className="staff-leave-balance-card" aria-live="polite">
                <span>الرصيد الحالي</span>
                <b>{currentLeaveBalanceLabel}</b>
              </div>
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
              <button className="exp-btn primary" type="button" disabled={busy} onClick={() => leave.onApplyLeaveChange("add")}>
                إضافة رصيد
              </button>
              <button className="exp-btn ghost" type="button" disabled={busy} onClick={() => leave.onApplyLeaveChange("deduct")}>
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
                    disabled={busy}
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
  );
}
