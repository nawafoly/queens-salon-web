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

function formatMoney(halalas: number | undefined | null) {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 0,
  }).format(Number(halalas || 0) / 100);
}

function formatPercent(value: number | undefined | null) {
  return `${(Number(value || 0) * 100).toLocaleString("ar-SA-u-nu-latn", {
    maximumFractionDigits: 1,
  })}%`;
}

function formatDate(value: string | undefined | null) {
  if (!value) return "—";
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function formatDateTime(value: string | undefined | null) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return formatDate(value);
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(parsed));
}

function transactionLabel(row: EmployeeTargetLedgerRow) {
  if (row.serviceName) return row.serviceName;
  if (row.reason) return row.reason;
  if (row.transactionType === "serviceRefund") return "استرجاع";
  if (row.transactionType === "manualAdjustment") return "تسوية يدوية";
  if (row.transactionType === "packageSession") return "جلسة باقة";
  return "خدمة محتسبة";
}

function targetErrorMessage(error: unknown) {
  if (error instanceof CoreApiError) {
    if (error.status === 401) return "انتهت جلسة الدخول. سجلي الدخول مرة أخرى لعرض التارقت.";
    if (error.code.includes("employee_link_required")) {
      return "حسابك غير مربوط بملف موظفة نشط. تواصلي مع الإدارة لتفعيل الربط.";
    }
    if (error.status === 403) return "لا تملكين صلاحية عرض التارقت لهذا الحساب.";
  }
  return error instanceof Error ? error.message : "تعذر تحميل بيانات التارقت.";
}

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
}: {
  title: string;
  subtitle: string;
  rows: EmployeeTargetLedgerRow[];
  empty: string;
}) {
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
              <strong>{transactionLabel(row)}</strong>
              <small>{formatDateTime(row.performedAt)} · {row.bookingId || "بدون حجز"}</small>
            </div>
            <span>{formatMoney(row.eligibleAmount)}</span>
          </article>
        )) : (
          <p>{empty}</p>
        )}
      </div>
    </section>
  );
}

export default function EmployeeTargetsPage() {
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
      setError(targetErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [payrollBounds.payrollMonth]);

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
    <section className="targets-page employee-targets-page employee-targets-page--staff" dir="rtl">
      <header className="employee-target-hero">
        <div>
          <span>تارقتي</span>
          <h1>تقدم المبيعات والبونص</h1>
          <p>
            دورة الراتب من {formatDate(payrollBounds.monthStart)} إلى {formatDate(payrollBounds.monthEnd)}
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          تحديث
        </button>
      </header>

      <div className="employee-target-month-switcher">
        <label>
          <span>السنة</span>
          <DashboardNumberInputV2 value={year} onChange={(event) => setYear(Number(event.target.value) || initial.year)} />
        </label>
        <label>
          <span>شهر الراتب</span>
          <DashboardSelectBridgeV2 value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{String(value).padStart(2, "0")}</option>
            ))}
          </DashboardSelectBridgeV2>
        </label>
        <div>
          <FiCalendar />
          <span>{payrollBounds.payrollMonth}</span>
          <strong>{payrollBounds.monthStart} إلى {payrollBounds.monthEnd}</strong>
        </div>
      </div>

      {loading ? (
        <TargetState icon={<FiClock />} title="جاري تحميل التارقت" text="نراجع مبيعاتك المحصلة لهذه الدورة." />
      ) : error ? (
        <TargetState icon={<FiAlertCircle />} title="تعذر عرض التارقت" text={error} />
      ) : !hasPlan ? (
        <TargetState icon={<FiTarget />} title="لا توجد خطة تارقت" text="لم يتم تعيين خطة تارقت لهذه الدورة حتى الآن." />
      ) : (
        <>
          {isClosed ? (
            <div className="targets-alert is-readonly">دورة الراتب مغلقة. الأرقام المعروضة للقراءة فقط.</div>
          ) : null}

          <section className="employee-target-summary-card">
            <div className="employee-target-summary-card__top">
              <div>
                <span>المبيعات المحصلة</span>
                <strong>{formatMoney(eligibleSales)}</strong>
              </div>
              <div>
                <span>التارقت</span>
                <strong>{formatMoney(targetAmount)}</strong>
              </div>
            </div>

            <div className="employee-target-progress">
              <span style={{ width: `${Math.min(100, progressRatio * 100)}%` }} />
            </div>

            <div className="employee-target-summary-card__meta">
              <span>نسبة الإنجاز: {formatPercent(progressRatio)}</span>
              <span>الشريحة الحالية: {achievedTier?.tierName || "لم تتحقق بعد"}</span>
              <span>البونص الحالي: {formatMoney(summary?.earnedBonusAmount)}</span>
            </div>

            <p>
              {nextTier
                ? `متبقي ${formatMoney(remaining)} للحصول على بونص ${formatMoney(nextTier.bonusAmount)}`
                : "تم تحقيق أعلى شريحة في الخطة الحالية."}
            </p>
          </section>

          <section className="employee-target-metrics">
            <article>
              <FiCheckCircle />
              <span>الحجوزات المحتسبة</span>
              <strong>{summary?.countedBookingCount || 0}</strong>
            </article>
            <article>
              <FiFileText />
              <span>بنود الخدمات</span>
              <strong>{summary?.countedServiceItemCount || 0}</strong>
            </article>
            <article>
              <FiTrendingUp />
              <span>خصم الاسترجاعات</span>
              <strong>{formatMoney(summary?.refundDeductionAmount)}</strong>
            </article>
            <article>
              <FiTarget />
              <span>آخر تحديث</span>
              <strong>{formatDateTime(data?.lastUpdatedAt || summary?.lastUpdatedAt)}</strong>
            </article>
          </section>

          {!hasSales ? (
            <TargetState icon={<FiTarget />} title="لا توجد مبيعات مؤهلة بعد" text="أي حجز مدفوع ومكتمل سيظهر هنا بعد تحديث السجل." />
          ) : null}

          <LedgerSection
            title="الحركات المحتسبة"
            subtitle="الخدمات والباقات التي دخلت في حساب التارقت."
            rows={data?.countedTransactions || []}
            empty="لا توجد خدمات محتسبة في هذه الدورة."
          />

          <LedgerSection
            title="الاسترجاعات"
            subtitle="أي استرجاع يقلل المبيعات المؤهلة."
            rows={data?.refundDeductions || []}
            empty="لا توجد استرجاعات على تارقت هذه الدورة."
          />

          <LedgerSection
            title="التسويات اليدوية"
            subtitle="تعديلات الإدارة إن وجدت، للقراءة فقط."
            rows={data?.manualAdjustments || []}
            empty="لا توجد تسويات يدوية."
          />

          <section className="employee-target-detail-panel">
            <header>
              <div>
                <h2>الحركات المستبعدة</h2>
                <p>حركات مرتبطة بحسابك لكنها لم تدخل في التارقت مع سبب الاستبعاد.</p>
              </div>
              <strong>{data?.excludedTransactions?.length || 0}</strong>
            </header>
            <div className="employee-target-ledger-list">
              {data?.excludedTransactions?.length ? data.excludedTransactions.map((row) => (
                <article key={`${row.bookingId}-${row.bookingItemId}-${row.exclusionReason}`}>
                  <div>
                    <strong>{row.serviceName || "خدمة"}</strong>
                    <small>{formatDate(row.transactionDate || row.performedAt)} · {row.exclusionReason}</small>
                  </div>
                  <span>{formatMoney(row.eligibleAmount)}</span>
                </article>
              )) : (
                <p>لا توجد حركات مستبعدة لهذه الدورة.</p>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
