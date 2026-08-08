import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FiActivity,
  FiCalendar,
  FiCheckCircle,
  FiEdit3,
  FiRefreshCw,
  FiTarget,
  FiTrendingUp,
} from "react-icons/fi";

import {
  DashboardDatePickerV2,
  DashboardDrawerV2,
  DashboardSelectV2,
} from "../components/dashboard-v2";
import { payrollMonthBounds } from "../helpers/hr/payrollCalculations";
import { usePermissions } from "../security/PermissionContext";
import { CoreHrService } from "../services/CoreHrService";
import {
  CoreEmployeeTargetService,
  type EmployeeTargetDashboard,
  type EmployeeTargetDashboardRow,
  type EmployeeTargetLedgerRow,
  type EmployeeTargetPlan,
} from "../services/CoreEmployeeTargetService";
import type { CoreHrEmployee } from "../types/hrCoreApi";

const DEFAULT_TIERS = [
  { target: 10_000, bonus: 300 },
  { target: 15_000, bonus: 600 },
  { target: 20_000, bonus: 1_000 },
];

const monthOptions = Array.from({ length: 12 }, (_, index) => {
  const value = String(index + 1);
  return { value, label: value.padStart(2, "0") };
});

const bonusTypeOptions = [
  { value: "fixed", label: "مبلغ ثابت" },
  { value: "percentage", label: "نسبة من المبيعات" },
];

function currentPayrollParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatMoney(halalas: number | undefined | null) {
  const amount = Number(halalas || 0) / 100;
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function numberFromInput(value: string) {
  const number = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function halalasFromRiyals(value: string) {
  return Math.round(numberFromInput(value) * 100);
}

function progressPercent(row: EmployeeTargetDashboardRow) {
  return Math.round(Math.max(0, Math.min(1, Number(row.progressRatio || 0))) * 100);
}

function targetAmountForRow(row: EmployeeTargetDashboardRow) {
  return Number(row.currentTargetAmount || row.nextTier?.targetAmount || row.achievedTier?.targetAmount || 0);
}

function targetNameKey(value: string | undefined | null) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ar-SA");
}

function emptyTargetDashboard(payrollBounds: ReturnType<typeof payrollMonthBounds>): EmployeeTargetDashboard {
  return {
    period: {
      payrollMonth: payrollBounds.payrollMonth,
      monthStart: payrollBounds.monthStart,
      monthEnd: payrollBounds.monthEnd,
    },
    summary: {
      totalEligibleSales: 0,
      achievedCount: 0,
      expectedBonuses: 0,
      closeToNextTierCount: 0,
      topEmployee: null,
    },
    rows: [],
  };
}

function zeroTargetRow(employee: CoreHrEmployee): EmployeeTargetDashboardRow {
  return {
    employeeId: employee.id,
    employeeName: employee.name || employee.id,
    plan: null,
    achievedTier: null,
    nextTier: null,
    currentTargetAmount: 0,
    totalEligibleServices: 0,
    totalRefunds: 0,
    netTargetAmount: 0,
    earnedBonusAmount: 0,
    progressRatio: 0,
    remainingToNextTier: 0,
    ledger: [],
  };
}

function betterTargetRow(left: EmployeeTargetDashboardRow, right: EmployeeTargetDashboardRow) {
  if (Number(left.netTargetAmount || 0) !== Number(right.netTargetAmount || 0)) {
    return Number(left.netTargetAmount || 0) > Number(right.netTargetAmount || 0) ? left : right;
  }
  if (targetAmountForRow(left) !== targetAmountForRow(right)) return targetAmountForRow(left) > targetAmountForRow(right) ? left : right;
  return left.plan ? left : right;
}

function dedupeTargetRows(targetRows: EmployeeTargetDashboardRow[]) {
  const byId = new Map<string, EmployeeTargetDashboardRow>();
  for (const row of targetRows) {
    const existing = byId.get(row.employeeId);
    byId.set(row.employeeId, existing ? betterTargetRow(existing, row) : row);
  }

  const rows: EmployeeTargetDashboardRow[] = [];
  const byName = new Map<string, number>();
  for (const row of byId.values()) {
    const nameKey = targetNameKey(row.employeeName);
    const existingIndex = byName.get(nameKey);
    if (nameKey && existingIndex !== undefined) {
      const existing = rows[existingIndex];
      if (Number(existing.netTargetAmount || 0) === 0 || Number(row.netTargetAmount || 0) === 0) {
        rows[existingIndex] = betterTargetRow(existing, row);
        continue;
      }
    }
    byName.set(nameKey, rows.length);
    rows.push(row);
  }
  return rows;
}

function mergeTargetRowsWithEmployees(
  targetRows: EmployeeTargetDashboardRow[],
  employeeRows: CoreHrEmployee[]
) {
  const dedupedRows = dedupeTargetRows(targetRows);
  const byEmployee = new Map(dedupedRows.map((row) => [row.employeeId, row]));
  const existingNames = new Set(dedupedRows.map((row) => targetNameKey(row.employeeName)).filter(Boolean));
  for (const employee of employeeRows) {
    if (!employee.id || byEmployee.has(employee.id)) continue;
    if (existingNames.has(targetNameKey(employee.name))) continue;
    byEmployee.set(employee.id, zeroTargetRow(employee));
  }
  return Array.from(byEmployee.values()).sort((left, right) => {
    const amountSort = Number(right.netTargetAmount || 0) - Number(left.netTargetAmount || 0);
    if (amountSort !== 0) return amountSort;
    return String(left.employeeName || "").localeCompare(String(right.employeeName || ""), "ar");
  });
}

function detailReason(row: EmployeeTargetLedgerRow) {
  try {
    const details = JSON.parse(String(row.detailsJson || "{}")) as Record<string, unknown>;
    return String(details.reason || details.serviceName || row.serviceId || row.transactionType || "");
  } catch {
    return String(row.serviceId || row.transactionType || "");
  }
}

type PlanDraft = {
  id: string;
  name: string;
  effectiveStart: string;
  bonusType: "fixed" | "percentage";
  cumulativeTiers: boolean;
  tierTargets: string[];
  tierBonuses: string[];
};

function draftFromPlan(plan: EmployeeTargetPlan | null, fallbackStart: string): PlanDraft {
  const tiers = plan?.tiers?.length ? plan.tiers : [];
  return {
    id: plan?.id || "",
    name: plan?.name || "Monthly employee sales target",
    effectiveStart: plan?.effectiveStart || fallbackStart,
    bonusType: plan?.bonusType || "fixed",
    cumulativeTiers: Number(plan?.cumulativeTiers || 0) === 1,
    tierTargets: DEFAULT_TIERS.map((item, index) =>
      String(Number(tiers[index]?.targetAmount || item.target * 100) / 100)
    ),
    tierBonuses: DEFAULT_TIERS.map((item, index) =>
      plan?.bonusType === "percentage"
        ? String(Number(tiers[index]?.bonusPercentBps || 0) / 100)
        : String(Number(tiers[index]?.bonusAmount || item.bonus * 100) / 100)
    ),
  };
}

export default function DashboardEmployeeTargets() {
  const initial = currentPayrollParts();
  const [searchParams] = useSearchParams();
  const queryMonth = String(searchParams.get("payrollMonth") || "");
  const [year, setYear] = useState(() => Number(queryMonth.slice(0, 4)) || initial.year);
  const [month, setMonth] = useState(() => Number(queryMonth.slice(5, 7)) || initial.month);
  const payrollBounds = useMemo(() => payrollMonthBounds(year, month), [year, month]);
  const { hasPermission, hasAnyPermission } = usePermissions();
  const canManage = hasPermission("targets.manage");
  const canAdjust = hasPermission("targets.adjust");

  const [dashboard, setDashboard] = useState<EmployeeTargetDashboard | null>(null);
  const [plans, setPlans] = useState<EmployeeTargetPlan[]>([]);
  const [employees, setEmployees] = useState<CoreHrEmployee[]>([]);
  const [selected, setSelected] = useState<EmployeeTargetDashboardRow | null>(null);
  const [details, setDetails] = useState<Record<string, any> | null>(null);
  const [planDraft, setPlanDraft] = useState<PlanDraft>(() => draftFromPlan(null, payrollBounds.monthStart));
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [targetResult, planRows, employeeRows] = await Promise.all([
        CoreEmployeeTargetService.dashboard({
          payrollMonth: payrollBounds.payrollMonth,
          rebuild: canManage ? "true" : undefined,
        }).catch(async () =>
          CoreEmployeeTargetService.dashboard({ payrollMonth: payrollBounds.payrollMonth })
        ),
        CoreEmployeeTargetService.plans(),
        CoreHrService.listEmployees({ status: "active" }),
      ]);
      const targetRows = targetResult || emptyTargetDashboard(payrollBounds);
      setDashboard(targetRows);
      setPlans(planRows);
      setEmployees(employeeRows);
      if (!planRows.length && !planDraft.id) {
        setPlanDraft(draftFromPlan(null, payrollBounds.monthStart));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل تارقت الموظفات.");
    } finally {
      setLoading(false);
    }
  }, [canManage, payrollBounds, payrollBounds.monthStart, payrollBounds.payrollMonth, planDraft.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => mergeTargetRowsWithEmployees(dashboard?.rows || [], employees),
    [dashboard?.rows, employees]
  );
  const topCards = [
    {
      label: "المبيعات المؤهلة",
      value: formatMoney(dashboard?.summary.totalEligibleSales),
      icon: FiTrendingUp,
      tone: "dsv2-metric-card--gold",
    },
    {
      label: "مبيعات غير مسندة",
      value: formatMoney(dashboard?.summary.unassignedSales),
      icon: FiActivity,
      tone: "dsv2-metric-card--danger",
    },
    {
      label: "حققت التارقت",
      value: String(dashboard?.summary.achievedCount || 0),
      icon: FiCheckCircle,
      tone: "dsv2-metric-card--success",
    },
    {
      label: "البونص المتوقع",
      value: formatMoney(dashboard?.summary.expectedBonuses),
      icon: FiTarget,
      tone: "dsv2-metric-card--dark",
    },
    {
      label: "قريبة من الشريحة",
      value: String(dashboard?.summary.closeToNextTierCount || 0),
      icon: FiActivity,
      tone: "dsv2-metric-card--gold",
    },
  ];

  const openDetails = async (row: EmployeeTargetDashboardRow) => {
    setSelected(row);
    setDetails(null);
    try {
      setDetails(await CoreEmployeeTargetService.details(row.employeeId, { payrollMonth: payrollBounds.payrollMonth }));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "تعذر تحميل تفاصيل التارقت.");
    }
  };

  const rebuild = async () => {
    setWorking(true);
    setMessage("");
    setError("");
    try {
      const result = await CoreEmployeeTargetService.rebuild({ payrollMonth: payrollBounds.payrollMonth });
      setMessage(`تم تحديث مبيعات الشهر. عدد الحركات: ${result.inserted}`);
      await load();
    } catch (rebuildError) {
      setError(rebuildError instanceof Error ? rebuildError.message : "تعذر تحديث مبيعات الشهر.");
    } finally {
      setWorking(false);
    }
  };

  const savePlan = async () => {
    setWorking(true);
    setMessage("");
    setError("");
    try {
      const tiers = planDraft.tierTargets.map((target, index) => ({
        tierName: `Tier ${index + 1}`,
        tierOrder: index + 1,
        targetAmount: halalasFromRiyals(target),
        bonusAmount: planDraft.bonusType === "fixed" ? halalasFromRiyals(planDraft.tierBonuses[index]) : 0,
        bonusPercentBps: planDraft.bonusType === "percentage" ? Math.round(numberFromInput(planDraft.tierBonuses[index]) * 100) : 0,
        status: "active",
      })).filter((tier) => tier.targetAmount > 0);
      await CoreEmployeeTargetService.savePlan({
        id: planDraft.id || undefined,
        name: planDraft.name,
        effectiveStart: planDraft.effectiveStart,
        bonusType: planDraft.bonusType,
        cumulativeTiers: planDraft.cumulativeTiers,
        tiers,
        assignments: [{ scopeType: "default", effectiveStart: planDraft.effectiveStart, status: "active" }],
      });
      setMessage("تم حفظ خطة التارقت.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ خطة التارقت.");
    } finally {
      setWorking(false);
    }
  };

  const createAdjustment = async () => {
    if (!selected) return;
    setWorking(true);
    setMessage("");
    setError("");
    try {
      await CoreEmployeeTargetService.adjust({
        employeeId: selected.employeeId,
        payrollMonth: payrollBounds.payrollMonth,
        amountHalalas: halalasFromRiyals(adjustAmount),
        reason: adjustReason,
      });
      setAdjustAmount("");
      setAdjustReason("");
      setMessage("تمت إضافة التسوية.");
      await openDetails(selected);
      await load();
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : "تعذر إضافة التسوية.");
    } finally {
      setWorking(false);
    }
  };

  const selectedPlanId = plans.find((plan) => plan.id === planDraft.id)?.id || "";
  const planOptions = useMemo(
    () => [
      { value: "", label: "خطة جديدة" },
      ...plans.map((plan) => ({ value: plan.id, label: plan.name })),
    ],
    [plans]
  );
  const employeeOptions = useMemo(
    () => [
      { value: "", label: "اختيار موظفة" },
      ...employees.map((employee) => ({ value: employee.id, label: employee.name || employee.id })),
    ],
    [employees]
  );
  const selectedLedger = ((details?.ledger || selected?.ledger || []) as EmployeeTargetLedgerRow[]);
  const renderProgress = (row: EmployeeTargetDashboardRow) => {
    const percent = progressPercent(row);
    return (
      <div className="dsv2-targets-progress-stack">
        <progress
          className="dsv2-targets-progress"
          value={percent}
          max={100}
          aria-label={`نسبة تقدم ${row.employeeName}`}
        />
        <small>{percent}%، المتبقي {formatMoney(row.remainingToNextTier)}</small>
      </div>
    );
  };

  return (
    <main className="dsv2-page dsv2-targets-page" dir="rtl">
      <header className="dsv2-page-head dsv2-targets-page-head">
        <div>
          <p className="dsv2-targets-eyebrow">Employee Sales Targets</p>
          <h1 className="dsv2-page-title">تارقت الموظفات وبونص المبيعات</h1>
          <p className="dsv2-page-subtitle">
            احتساب من خدمات Core D1 المكتملة، الخصومات، التحصيل، الباقات، والاسترجاعات ثم ترحيله للرواتب.
          </p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary dsv2-targets-rebuild"
          onClick={rebuild}
          disabled={!canManage || working}
        >
          <FiRefreshCw className={working ? "dsv2-targets-spin" : ""} />
          {working ? "جار التحديث" : "تحديث المبيعات"}
        </button>
      </header>

      <section className="dsv2-card dsv2-card--padded dsv2-targets-toolbar" aria-label="فترة التارقت">
        <label className="dsv2-field">
          <span className="dsv2-field__label">السنة</span>
          <input
            className="dsv2-input"
            type="number"
            value={year}
            onChange={(event) => setYear(Number(event.target.value) || initial.year)}
          />
        </label>
        <label className="dsv2-field">
          <span className="dsv2-field__label">الشهر</span>
          <DashboardSelectV2
            value={String(month)}
            options={monthOptions}
            onChange={(value) => setMonth(Number(value))}
          />
        </label>
        <div className="dsv2-targets-period">
          <FiCalendar aria-hidden="true" />
          <span>{payrollBounds.payrollMonth}</span>
          <strong>{payrollBounds.monthStart} إلى {payrollBounds.monthEnd}</strong>
        </div>
      </section>

      {error ? <div className="dsv2-targets-alert dsv2-targets-alert--error" role="alert">{error}</div> : null}
      {message ? <div className="dsv2-targets-alert" role="status">{message}</div> : null}
      {!hasAnyPermission(["targets.manage", "targets.adjust"]) ? (
        <div className="dsv2-targets-alert dsv2-targets-alert--readonly" role="status">
          وضع قراءة فقط: يمكنك مراجعة التارقت والبونص المتوقع دون تعديل.
        </div>
      ) : null}

      <section className="dsv2-grid--metrics dsv2-targets-summary-grid" aria-label="ملخص التارقت">
        {topCards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className={`dsv2-metric-card ${card.tone} dsv2-targets-metric`}>
              <span className="dsv2-metric-card__icon"><Icon /></span>
              <div>
                <p className="dsv2-metric-card__label">{card.label}</p>
                <p className="dsv2-metric-card__value">
                  {loading ? <span className="dsv2-skeleton dsv2-targets-skeleton-value" /> : card.value}
                </p>
              </div>
            </article>
          );
        })}
      </section>

      <div className="dsv2-targets-layout">
        <section className="dsv2-table-card dsv2-targets-main-panel" aria-labelledby="employee-targets-progress-title">
          <div className="dsv2-card--padded dsv2-targets-panel-head">
            <div>
              <p className="dsv2-targets-eyebrow">أداء الشهر</p>
              <h2 id="employee-targets-progress-title" className="dsv2-section-title">تقدم الموظفات</h2>
              <p className="dsv2-section-caption">
                {dashboard?.summary.topEmployee
                  ? `الأعلى: ${dashboard.summary.topEmployee.employeeName}`
                  : "لا توجد حركات مؤهلة حتى الآن."}
              </p>
            </div>
          </div>

          <div className="dsv2-table-scroll">
            <table className="dsv2-table dsv2-targets-table">
              <thead>
                <tr>
                  <th>الموظفة</th>
                  <th>الخطة</th>
                  <th>التارقت</th>
                  <th>المبيعات المؤهلة</th>
                  <th>التقدم</th>
                  <th>الشريحة</th>
                  <th>البونص</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="dsv2-targets-empty-cell">
                      <span className="dsv2-skeleton dsv2-skeleton--title" />
                      <span className="dsv2-skeleton" />
                      <span className="dsv2-sr-only">جاري تحميل تارقت الموظفات...</span>
                    </td>
                  </tr>
                ) : rows.length ? rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td>
                      <span className="dsv2-table__primary">{row.employeeName}</span>
                      <span className="dsv2-table__secondary" dir="ltr">{row.employeeId}</span>
                    </td>
                    <td>{row.plan?.name || "لا توجد خطة"}</td>
                    <td><span className="dsv2-badge dsv2-badge--gold">{formatMoney(targetAmountForRow(row))}</span></td>
                    <td>{formatMoney(row.netTargetAmount)}</td>
                    <td>{renderProgress(row)}</td>
                    <td>{row.achievedTier?.tierName || row.nextTier?.tierName || "-"}</td>
                    <td><span className="dsv2-table__primary">{formatMoney(row.earnedBonusAmount)}</span></td>
                    <td>
                      <button
                        type="button"
                        className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                        onClick={() => void openDetails(row)}
                      >
                        التفاصيل
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={8} className="dsv2-targets-empty-cell">لا توجد مبيعات مؤهلة في هذا الشهر حتى الآن.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="dsv2-targets-mobile-list" aria-label="تقدم الموظفات للجوال">
            {loading ? (
              <div className="dsv2-targets-mobile-state">
                <span className="dsv2-skeleton dsv2-skeleton--block" />
                <span className="dsv2-sr-only">جاري تحميل تارقت الموظفات...</span>
              </div>
            ) : rows.length ? rows.map((row) => (
              <article key={row.employeeId} className="dsv2-card dsv2-card--padded dsv2-targets-mobile-card">
                <header>
                  <div>
                    <strong>{row.employeeName}</strong>
                    <small>{row.employeeId}</small>
                  </div>
                  <span>{formatMoney(row.earnedBonusAmount)}</span>
                </header>

                <div className="dsv2-targets-mobile-plan">
                  <span>الخطة</span>
                  <strong>{row.plan?.name || "لا توجد خطة"}</strong>
                </div>

                <div className="dsv2-targets-mobile-progress">
                  {renderProgress(row)}
                </div>

                <dl>
                  <div><dt>التارقت</dt><dd>{formatMoney(targetAmountForRow(row))}</dd></div>
                  <div><dt>المبيعات المؤهلة</dt><dd>{formatMoney(row.netTargetAmount)}</dd></div>
                  <div><dt>الشريحة</dt><dd>{row.achievedTier?.tierName || row.nextTier?.tierName || "-"}</dd></div>
                </dl>

                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary dsv2-btn--block"
                  onClick={() => void openDetails(row)}
                >
                  عرض التفاصيل
                </button>
              </article>
            )) : (
              <p className="dsv2-targets-empty">لا توجد مبيعات مؤهلة في هذا الشهر حتى الآن.</p>
            )}
          </div>
        </section>

        <aside className="dsv2-card dsv2-card--padded dsv2-targets-side-panel" aria-labelledby="employee-targets-plan-title">
          <div className="dsv2-section-head dsv2-targets-side-head">
            <div>
              <p className="dsv2-targets-eyebrow">إعداد الخطة</p>
              <h2 id="employee-targets-plan-title" className="dsv2-section-title">خطة التارقت</h2>
              <p className="dsv2-section-caption">الخطة الافتراضية تطبق على الموظفات ما لم توجد خطة مخصصة لاحقا.</p>
            </div>
          </div>

          <label className="dsv2-field">
            <span className="dsv2-field__label">خطة محفوظة</span>
            <DashboardSelectV2
              value={selectedPlanId}
              options={planOptions}
              onChange={(value) => {
                const plan = plans.find((item) => item.id === value) || null;
                setPlanDraft(draftFromPlan(plan, payrollBounds.monthStart));
              }}
            />
          </label>

          <label className="dsv2-field">
            <span className="dsv2-field__label">اسم الخطة</span>
            <input
              className="dsv2-input"
              value={planDraft.name}
              onChange={(event) => setPlanDraft((draft) => ({ ...draft, name: event.target.value }))}
            />
          </label>

          <label className="dsv2-field">
            <span className="dsv2-field__label">تبدأ من</span>
            <DashboardDatePickerV2
              value={planDraft.effectiveStart}
              clearable={false}
              onChange={(value) => setPlanDraft((draft) => ({ ...draft, effectiveStart: value }))}
            />
          </label>

          <label className="dsv2-field">
            <span className="dsv2-field__label">نوع البونص</span>
            <DashboardSelectV2
              value={planDraft.bonusType}
              options={bonusTypeOptions}
              onChange={(value) => setPlanDraft((draft) => ({ ...draft, bonusType: value as PlanDraft["bonusType"] }))}
            />
          </label>

          <button
            type="button"
            className={`dsv2-targets-toggle ${planDraft.cumulativeTiers ? "is-on" : ""}`}
            role="switch"
            aria-checked={planDraft.cumulativeTiers}
            onClick={() => setPlanDraft((draft) => ({ ...draft, cumulativeTiers: !draft.cumulativeTiers }))}
          >
            <span className="dsv2-targets-toggle__mark" aria-hidden="true">{planDraft.cumulativeTiers ? "✓" : ""}</span>
            <span className="dsv2-targets-toggle__copy">
              <strong>احتساب الشرائح بشكل تراكمي</strong>
              <small>عند التفعيل يتم جمع مكافآت الشرائح المؤهلة.</small>
            </span>
          </button>

          <div className="dsv2-targets-tier-editor">
            {planDraft.tierTargets.map((target, index) => (
              <div key={index}>
                <label className="dsv2-field">
                  <span className="dsv2-field__label">تارقت {index + 1}</span>
                  <input
                    className="dsv2-input"
                    value={target}
                    onChange={(event) => setPlanDraft((draft) => {
                      const tierTargets = [...draft.tierTargets];
                      tierTargets[index] = event.target.value;
                      return { ...draft, tierTargets };
                    })}
                  />
                </label>
                <label className="dsv2-field">
                  <span className="dsv2-field__label">{planDraft.bonusType === "percentage" ? "النسبة %" : "البونص"}</span>
                  <input
                    className="dsv2-input"
                    value={planDraft.tierBonuses[index]}
                    onChange={(event) => setPlanDraft((draft) => {
                      const tierBonuses = [...draft.tierBonuses];
                      tierBonuses[index] = event.target.value;
                      return { ...draft, tierBonuses };
                    })}
                  />
                </label>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="dsv2-btn dsv2-btn--primary dsv2-targets-save-plan"
            onClick={savePlan}
            disabled={!canManage || working}
          >
            <FiEdit3 /> {working ? "جار الحفظ" : "حفظ الخطة"}
          </button>

          <div className="dsv2-targets-employee-pick">
            <div className="dsv2-targets-employee-pick__head">
              <span>إضافة تسوية سريعة</span>
              <small>تستخدم نفس صلاحية targets.adjust ونفس خدمة التسويات الحالية.</small>
            </div>
            <label className="dsv2-field">
              <span className="dsv2-field__label">الموظفة</span>
              <DashboardSelectV2
              value={selected?.employeeId || ""}
              options={employeeOptions}
              onChange={(value) => {
                const employee = employees.find((item) => item.id === value);
                if (!employee) return;
                void openDetails({
                  employeeId: employee.id,
                  employeeName: employee.name,
                  plan: null,
                  achievedTier: null,
                  nextTier: null,
                  currentTargetAmount: 0,
                  totalEligibleServices: 0,
                  totalRefunds: 0,
                  netTargetAmount: 0,
                  earnedBonusAmount: 0,
                  progressRatio: 0,
                  remainingToNextTier: 0,
                });
              }}
              />
            </label>
            <label className="dsv2-field">
              <span className="dsv2-field__label">المبلغ</span>
              <input
                className="dsv2-input"
                placeholder="المبلغ بالريال، يقبل السالب"
                value={adjustAmount}
                onChange={(event) => setAdjustAmount(event.target.value)}
              />
            </label>
            <label className="dsv2-field">
              <span className="dsv2-field__label">سبب التسوية</span>
              <input
                className="dsv2-input"
                placeholder="سبب التسوية"
                value={adjustReason}
                onChange={(event) => setAdjustReason(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--success dsv2-targets-adjust-btn"
              onClick={createAdjustment}
              disabled={!canAdjust || !selected || working}
            >
              إضافة التسوية
            </button>
          </div>
        </aside>
      </div>

      <DashboardDrawerV2
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.employeeName || "تفاصيل التارقت"}
        description={selected?.plan?.name || "لا توجد خطة مفعلة"}
        eyebrow={payrollBounds.payrollMonth}
        size="lg"
        tone="gold"
        closeLabel="إغلاق تفاصيل التارقت"
        className="dsv2-targets-drawer"
      >
        {selected ? (
          <>
            <div className="dsv2-targets-detail-metrics">
              <div><span>التارقت</span><strong>{formatMoney(targetAmountForRow(selected))}</strong></div>
              <div><span>المؤهل</span><strong>{formatMoney(selected.netTargetAmount)}</strong></div>
              <div><span>الاسترجاعات</span><strong>{formatMoney(selected.totalRefunds)}</strong></div>
              <div><span>البونص</span><strong>{formatMoney(selected.earnedBonusAmount)}</strong></div>
            </div>

            <section className="dsv2-targets-ledger-section">
              <h3 className="dsv2-section-title">حركات التارقت</h3>
              {selectedLedger.length ? (
                <div className="dsv2-targets-ledger-list">
                  {selectedLedger.map((row) => (
                    <article key={row.id}>
                      <div>
                        <strong>{detailReason(row)}</strong>
                        <small>{String(row.performedAt || "").slice(0, 10)}، {row.transactionType}</small>
                      </div>
                      <span>{formatMoney(row.eligibleAmount)}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="dsv2-targets-empty">لا توجد حركات مفصلة لهذه الفترة.</p>
              )}
            </section>
          </>
        ) : null}
      </DashboardDrawerV2>
    </main>
  );
}
