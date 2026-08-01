import { useCallback, useEffect, useMemo, useState } from "react";
import { FiRefreshCw, FiTarget, FiTrendingUp } from "react-icons/fi";

import { payrollMonthBounds } from "../../helpers/hr/payrollCalculations";
import {
  CoreEmployeeTargetService,
  type EmployeeTargetLedgerRow,
} from "../../services/CoreEmployeeTargetService";
import "../../styles/DashboardEmployeeTargets.css";

function currentPayrollParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatMoney(halalas: number | undefined | null) {
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 0,
  }).format(Number(halalas || 0) / 100);
}

function progressPercent(summary: any) {
  const currentTarget = Number(summary?.nextTier?.targetAmount || summary?.achievedTier?.targetAmount || 0);
  const net = Number(summary?.netTargetAmount || 0);
  return currentTarget > 0 ? Math.round(Math.min(1, Math.max(0, net / currentTarget)) * 100) : 0;
}

function ledgerLabel(row: EmployeeTargetLedgerRow) {
  try {
    const details = JSON.parse(String(row.detailsJson || "{}")) as Record<string, unknown>;
    return String(details.serviceName || details.reason || row.transactionType || "");
  } catch {
    return String(row.transactionType || "");
  }
}

export default function EmployeeTargetsPage() {
  const initial = currentPayrollParts();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const payrollBounds = useMemo(() => payrollMonthBounds(year, month), [year, month]);
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await CoreEmployeeTargetService.mine({ payrollMonth: payrollBounds.payrollMonth }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل تارقتك.");
    } finally {
      setLoading(false);
    }
  }, [payrollBounds.payrollMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary || {};
  const ledger = (data?.ledger || summary.ledger || []) as EmployeeTargetLedgerRow[];
  const nextTier = summary.nextTier;
  const achievedTier = summary.achievedTier;
  const percent = progressPercent(summary);
  const remaining = nextTier
    ? Math.max(0, Number(nextTier.targetAmount || 0) - Number(summary.netTargetAmount || 0))
    : 0;

  return (
    <section className="targets-page employee-targets-page" dir="rtl">
      <header className="targets-hero">
        <div>
          <span>My Sales Target</span>
          <h1>تارقتي وبونص المبيعات</h1>
          <p>متابعة مبيعاتك المؤهلة من الخدمات المكتملة والبونص المتوقع لدورة الراتب الحالية.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <FiRefreshCw className={loading ? "is-spinning" : ""} />
          تحديث
        </button>
      </header>

      <div className="targets-toolbar">
        <label>
          <span>السنة</span>
          <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value) || initial.year)} />
        </label>
        <label>
          <span>شهر الراتب</span>
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{String(value).padStart(2, "0")}</option>
            ))}
          </select>
        </label>
        <div className="targets-period">
          <span>{payrollBounds.payrollMonth}</span>
          <strong>{payrollBounds.monthStart} إلى {payrollBounds.monthEnd}</strong>
        </div>
      </div>

      {error ? <div className="targets-alert is-error">{error}</div> : null}

      <div className="targets-summary-grid">
        <article>
          <FiTrendingUp />
          <span>المبيعات المؤهلة</span>
          <strong>{formatMoney(summary.netTargetAmount)}</strong>
        </article>
        <article>
          <FiTarget />
          <span>الشريحة الحالية</span>
          <strong>{achievedTier?.tierName || nextTier?.tierName || "-"}</strong>
        </article>
        <article>
          <FiTarget />
          <span>المتبقي للشريحة التالية</span>
          <strong>{formatMoney(remaining)}</strong>
        </article>
        <article>
          <FiTrendingUp />
          <span>البونص المتوقع</span>
          <strong>{formatMoney(summary.earnedBonusAmount)}</strong>
        </article>
      </div>

      <section className="targets-main-panel">
        <div className="targets-panel-head">
          <div>
            <h2>تقدم الدورة</h2>
            <p>{summary.plan?.name || "لا توجد خطة تارقت مفعلة لهذه الفترة."}</p>
          </div>
        </div>
        <div className="employee-target-progress-card">
          <div className="targets-progress">
            <span style={{ width: `${percent}%` }} />
          </div>
          <strong>{percent}%</strong>
          <small>المبيعات المؤهلة تحتسب بعد الخصومات، التحصيل، والاسترجاعات.</small>
        </div>
      </section>

      <section className="targets-main-panel">
        <div className="targets-panel-head">
          <div>
            <h2>حركاتي المحتسبة</h2>
            <p>آخر الخدمات والتسويات الداخلة في التارقت.</p>
          </div>
        </div>
        <div className="targets-ledger-list employee-target-ledger">
          {loading ? (
            <p className="targets-empty">جاري تحميل التارقت...</p>
          ) : ledger.length ? ledger.map((row) => (
            <article key={row.id}>
              <div>
                <strong>{ledgerLabel(row)}</strong>
                <small>{String(row.performedAt || "").slice(0, 10)} · {row.transactionType}</small>
              </div>
              <span>{formatMoney(row.eligibleAmount)}</span>
            </article>
          )) : (
            <p className="targets-empty">لا توجد حركات مؤهلة في هذه الدورة حتى الآن.</p>
          )}
        </div>
      </section>
    </section>
  );
}
