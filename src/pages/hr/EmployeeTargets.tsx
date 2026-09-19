import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import { DashboardSelectBridgeV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  FiAlertCircle,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiFileText,
  FiRefreshCw,
  FiTarget,
  FiTrendingUp,
} from "react-icons/fi";

import { payrollMonthBounds } from "../../helpers/hr/payrollCalculations";
import { CoreApiError } from "../../services/coreApiClient";
import { useEmployeePortalLanguage, type EmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";
import {
  CoreEmployeeTargetService,
  type EmployeeTargetLedgerRow,
  type EmployeeTargetMine,
} from "../../services/CoreEmployeeTargetService";
import "../../styles/DashboardEmployeeTargets.css";

function currentPayrollParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatMoney(halalas: number | undefined | null, language: EmployeePortalLanguage) {
  return new Intl.NumberFormat(language === "en" ? "en-SA" : "ar-SA-u-nu-latn", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 0,
  }).format(Number(halalas || 0) / 100);
}

function formatPercent(value: number | undefined | null, language: EmployeePortalLanguage) {
  return `${(Number(value || 0) * 100).toLocaleString(language === "en" ? "en-SA" : "ar-SA-u-nu-latn", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatDate(value: string | undefined | null, language: EmployeePortalLanguage) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat(language === "en" ? "en-SA-u-ca-gregory" : "ar-SA-u-ca-gregory-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function formatDateTime(value: string | undefined | null, language: EmployeePortalLanguage) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return formatDate(value, language);
  return new Intl.DateTimeFormat(language === "en" ? "en-SA-u-ca-gregory" : "ar-SA-u-ca-gregory-nu-latn", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function transactionLabel(row: EmployeeTargetLedgerRow, language: EmployeePortalLanguage) {
  if (row.serviceName) return row.serviceName;
  if (row.reason) return row.reason;
  if (row.transactionType === "serviceRefund") return language === "en" ? "Refund" : "استرجاع";
  if (row.transactionType === "manualAdjustment") return language === "en" ? "Manual adjustment" : "تسوية يدوية";
  if (row.transactionType === "packageSession") return language === "en" ? "Package session" : "جلسة باقة";
  return language === "en" ? "Counted service" : "خدمة محتسبة";
}

function targetErrorMessage(error: unknown, language: EmployeePortalLanguage) {
  if (error instanceof CoreApiError) {
    if (error.status === 401) return language === "en" ? "Your session has expired. Sign in again to view your targets." : "انتهت جلسة الدخول. سجلي الدخول مرة أخرى لعرض التارقت.";
    if (error.code.includes("employee_link_required")) {
      return language === "en" ? "Your account is not linked to an active employee profile. Contact management to set up the link." : "حسابك غير مربوط بملف موظفة نشط. تواصلي مع الإدارة لتفعيل الربط.";
    }
    if (error.status === 403) return language === "en" ? "You do not have permission to view this account's targets." : "لا تملكين صلاحية عرض التارقت لهذا الحساب.";
  }
  return language === "en" ? "Could not load your targets." : error instanceof Error ? error.message : "تعذر تحميل بيانات التارقت.";
}

const targetCopy = {
  ar: {
    myTarget: "تارقتي", progressBonus: "تقدم المبيعات والبونص", payrollPeriod: "دورة الراتب من", to: "إلى", refresh: "تحديث", year: "السنة", payrollMonth: "شهر الراتب",
    loading: "جاري تحميل التارقت", loadingNote: "نراجع مبيعاتك المحصلة لهذه الدورة.", failed: "تعذر عرض التارقت", noPlan: "لا توجد خطة تارقت", noPlanNote: "لم يتم تعيين خطة تارقت لهذه الدورة حتى الآن.",
    closed: "دورة الراتب مغلقة. الأرقام المعروضة للقراءة فقط.", sales: "المبيعات المحصلة", target: "التارقت", progress: "نسبة الإنجاز", tier: "الشريحة الحالية", notAchieved: "لم تتحقق بعد",
    bonus: "البونص الحالي", remaining: "متبقي", nextBonus: "للحصول على بونص", highestTier: "تم تحقيق أعلى شريحة في الخطة الحالية.", bookings: "الحجوزات المحتسبة", serviceItems: "بنود الخدمات", refundsDeducted: "خصم الاسترجاعات", updated: "آخر تحديث",
    noSales: "لا توجد مبيعات مؤهلة بعد", noSalesNote: "أي حجز مدفوع ومكتمل سيظهر هنا بعد تحديث السجل.", counted: "الحركات المحتسبة", countedNote: "الخدمات والباقات التي دخلت في حساب التارقت.", noCounted: "لا توجد خدمات محتسبة في هذه الدورة.",
    refunds: "الاسترجاعات", refundsNote: "أي استرجاع يقلل المبيعات المؤهلة.", noRefunds: "لا توجد استرجاعات على تارقت هذه الدورة.", adjustments: "التسويات اليدوية", adjustmentsNote: "تعديلات الإدارة إن وجدت، للقراءة فقط.", noAdjustments: "لا توجد تسويات يدوية.",
    excluded: "الحركات المستبعدة", excludedNote: "حركات مرتبطة بحسابك لكنها لم تدخل في التارقت مع سبب الاستبعاد.", noExcluded: "لا توجد حركات مستبعدة لهذه الدورة.", service: "خدمة", noBooking: "بدون حجز",
  },
  en: {
    myTarget: "My targets", progressBonus: "Sales progress and bonus", payrollPeriod: "Payroll period from", to: "to", refresh: "Refresh", year: "Year", payrollMonth: "Payroll month",
    loading: "Loading targets", loadingNote: "Checking your collected sales for this period.", failed: "Could not show targets", noPlan: "No target plan", noPlanNote: "No target plan has been assigned for this period yet.",
    closed: "This payroll period is closed. The figures are read only.", sales: "Collected sales", target: "Target", progress: "Progress", tier: "Current tier", notAchieved: "Not achieved yet",
    bonus: "Current bonus", remaining: "Remaining", nextBonus: "to earn a bonus of", highestTier: "You have reached the highest tier in this plan.", bookings: "Counted bookings", serviceItems: "Service items", refundsDeducted: "Refund deductions", updated: "Last updated",
    noSales: "No eligible sales yet", noSalesNote: "Paid, completed bookings appear here after the ledger is updated.", counted: "Counted transactions", countedNote: "Services and packages included in your target.", noCounted: "No services counted this period.",
    refunds: "Refunds", refundsNote: "Refunds reduce eligible sales.", noRefunds: "No refunds for this period.", adjustments: "Manual adjustments", adjustmentsNote: "Management adjustments, if any, shown for your information.", noAdjustments: "No manual adjustments.",
    excluded: "Excluded transactions", excludedNote: "Transactions linked to your account that did not count toward the target, with their exclusion reasons.", noExcluded: "No excluded transactions this period.", service: "Service", noBooking: "No booking",
  },
} as const;

function TargetState({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="employee-target-state">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function LedgerSection({
  title,
  subtitle,
  rows,
  empty,
  language,
}: {
  title: string;
  subtitle: string;
  rows: EmployeeTargetLedgerRow[];
  empty: string;
  language: EmployeePortalLanguage;
}) {
  const copy = targetCopy[language];
  return (
    <section className="employee-target-detail-panel">
      <header>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <strong>{rows.length}</strong>
      </header>

      <div className="employee-target-ledger-list">
        {rows.length ? rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>{transactionLabel(row, language)}</strong>
              <small>{formatDateTime(row.performedAt, language)} · {row.bookingId || copy.noBooking}</small>
            </div>
            <span>{formatMoney(row.eligibleAmount, language)}</span>
          </article>
        )) : (
          <p>{empty}</p>
        )}
      </div>
    </section>
  );
}

export default function EmployeeTargetsPage() {
  const { language } = useEmployeePortalLanguage();
  const copy = targetCopy[language];
  const initial = currentPayrollParts();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const payrollBounds = useMemo(() => payrollMonthBounds(year, month), [year, month]);
  const [data, setData] = useState<EmployeeTargetMine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await CoreEmployeeTargetService.mine({ payrollMonth: payrollBounds.payrollMonth }));
    } catch (loadError) {
      setData(null);
      setError(targetErrorMessage(loadError, language));
    } finally {
      setLoading(false);
    }
  }, [payrollBounds.payrollMonth, language]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  const targetAmount = Number(summary?.currentTargetAmount || data?.targetCalculation?.targetAmount || 0);
  const eligibleSales = Number(summary?.netTargetAmount || 0);
  const progressRatio = Number(summary?.progressRatio || 0);
  const remaining = Number(summary?.remainingToNextTier || data?.targetCalculation?.remainingToNextTier || 0);
  const nextTier = summary?.nextTier || data?.targetCalculation?.nextTier || null;
  const achievedTier = summary?.achievedTier || data?.targetCalculation?.achievedTier || null;
  const hasPlan = Boolean(summary?.hasTargetPlan ?? summary?.plan);
  const hasSales = eligibleSales !== 0 || Boolean((data?.ledger || []).length);
  const isClosed = Boolean(data?.isPayrollClosed || data?.period?.isClosed);

  return (
    <section className="targets-page employee-targets-page employee-targets-page--staff" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <header className="employee-target-hero">
        <div>
          <span>{copy.myTarget}</span>
          <h1>{copy.progressBonus}</h1>
          <p>
            {copy.payrollPeriod} {formatDate(payrollBounds.monthStart, language)} {copy.to} {formatDate(payrollBounds.monthEnd, language)}
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          {copy.refresh}
        </button>
      </header>

      <div className="employee-target-month-switcher">
        <label>
          <span>{copy.year}</span>
          <DashboardNumberInputV2 value={year} onChange={(event) => setYear(Number(event.target.value) || initial.year)} />
        </label>
        <label>
          <span>{copy.payrollMonth}</span>
          <DashboardSelectBridgeV2 value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{String(value).padStart(2, "0")}</option>
            ))}
          </DashboardSelectBridgeV2>
        </label>
        <div>
          <FiCalendar />
          <span>{payrollBounds.payrollMonth}</span>
          <strong>{payrollBounds.monthStart} {copy.to} {payrollBounds.monthEnd}</strong>
        </div>
      </div>

      {loading ? (
        <TargetState icon={<FiClock />} title={copy.loading} text={copy.loadingNote} />
      ) : error ? (
        <TargetState icon={<FiAlertCircle />} title={copy.failed} text={error} />
      ) : !hasPlan ? (
        <TargetState icon={<FiTarget />} title={copy.noPlan} text={copy.noPlanNote} />
      ) : (
        <>
          {isClosed ? (
            <div className="targets-alert is-readonly">{copy.closed}</div>
          ) : null}

          <section className="employee-target-summary-card">
            <div className="employee-target-summary-card__top">
              <div>
                <span>{copy.sales}</span>
                <strong>{formatMoney(eligibleSales, language)}</strong>
              </div>
              <div>
                <span>{copy.target}</span>
                <strong>{formatMoney(targetAmount, language)}</strong>
              </div>
            </div>

            <div className="employee-target-progress">
              <span style={{ width: `${Math.min(100, progressRatio * 100)}%` }} />
            </div>

            <div className="employee-target-summary-card__meta">
              <span>{copy.progress}: {formatPercent(progressRatio, language)}</span>
              <span>{copy.tier}: {achievedTier?.tierName || copy.notAchieved}</span>
              <span>{copy.bonus}: {formatMoney(summary?.earnedBonusAmount, language)}</span>
            </div>

            <p>
              {nextTier
                ? `${copy.remaining} ${formatMoney(remaining, language)} ${copy.nextBonus} ${formatMoney(nextTier.bonusAmount, language)}`
                : copy.highestTier}
            </p>
          </section>

          <section className="employee-target-metrics">
            <article>
              <FiCheckCircle />
              <span>{copy.bookings}</span>
              <strong>{summary?.countedBookingCount || 0}</strong>
            </article>
            <article>
              <FiFileText />
              <span>{copy.serviceItems}</span>
              <strong>{summary?.countedServiceItemCount || 0}</strong>
            </article>
            <article>
              <FiTrendingUp />
              <span>{copy.refundsDeducted}</span>
              <strong>{formatMoney(summary?.refundDeductionAmount, language)}</strong>
            </article>
            <article>
              <FiTarget />
              <span>{copy.updated}</span>
              <strong>{formatDateTime(data?.lastUpdatedAt || summary?.lastUpdatedAt, language)}</strong>
            </article>
          </section>

          {!hasSales ? (
            <TargetState icon={<FiTarget />} title={copy.noSales} text={copy.noSalesNote} />
          ) : null}

          <LedgerSection
            title={copy.counted}
            subtitle={copy.countedNote}
            rows={data?.countedTransactions || []}
            empty={copy.noCounted}
            language={language}
          />

          <LedgerSection
            title={copy.refunds}
            subtitle={copy.refundsNote}
            rows={data?.refundDeductions || []}
            empty={copy.noRefunds}
            language={language}
          />

          <LedgerSection
            title={copy.adjustments}
            subtitle={copy.adjustmentsNote}
            rows={data?.manualAdjustments || []}
            empty={copy.noAdjustments}
            language={language}
          />

          <section className="employee-target-detail-panel">
            <header>
              <div>
                <h2>{copy.excluded}</h2>
                <p>{copy.excludedNote}</p>
              </div>
              <strong>{data?.excludedTransactions?.length || 0}</strong>
            </header>
            <div className="employee-target-ledger-list">
              {data?.excludedTransactions?.length ? data.excludedTransactions.map((row) => (
                <article key={`${row.bookingId}-${row.bookingItemId}-${row.exclusionReason}`}>
                  <div>
                    <strong>{row.serviceName || copy.service}</strong>
                    <small>{formatDate(row.transactionDate || row.performedAt, language)} · {row.exclusionReason}</small>
                  </div>
                  <span>{formatMoney(row.eligibleAmount, language)}</span>
                </article>
              )) : (
                <p>{copy.noExcluded}</p>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
