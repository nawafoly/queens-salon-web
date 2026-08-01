import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FiActivity,
  FiCheckCircle,
  FiEdit3,
  FiRefreshCw,
  FiTarget,
  FiTrendingUp,
  FiX,
} from "react-icons/fi";

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
import "../styles/DashboardEmployeeTargets.css";

const DEFAULT_TIERS = [
  { target: 10_000, bonus: 300 },
  { target: 15_000, bonus: 600 },
  { target: 20_000, bonus: 1_000 },
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
  const [searchParams, setSearchParams] = useSearchParams();
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
      const [targetRows, planRows, employeeRows] = await Promise.all([
        CoreEmployeeTargetService.dashboard({ payrollMonth: payrollBounds.payrollMonth }),
        CoreEmployeeTargetService.plans(),
        CoreHrService.listEmployees({ status: "active" }),
      ]);
      setDashboard(targetRows);
      setPlans(planRows);
      setEmployees(employeeRows);
      const focusedEmployee = String(searchParams.get("employee") || "");
      if (focusedEmployee) {
        const row = targetRows.rows.find((item) => item.employeeId === focusedEmployee);
        if (row) {
          setSelected(row);
          setDetails(await CoreEmployeeTargetService.details(row.employeeId, { payrollMonth: payrollBounds.payrollMonth }));
        }
      }
      if (!planRows.length && !planDraft.id) {
        setPlanDraft(draftFromPlan(null, payrollBounds.monthStart));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "تعذر تحميل تارقت الموظفات.");
    } finally {
      setLoading(false);
    }
  }, [payrollBounds.monthStart, payrollBounds.payrollMonth, planDraft.id, searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = dashboard?.rows || [];
  const topCards = [
    { label: "المبيعات المؤهلة", value: formatMoney(dashboard?.summary.totalEligibleSales), icon: FiTrendingUp },
    { label: "حققت التارقت", value: String(dashboard?.summary.achievedCount || 0), icon: FiCheckCircle },
    { label: "البونص المتوقع", value: formatMoney(dashboard?.summary.expectedBonuses), icon: FiTarget },
    { label: "قريبة من الشريحة", value: String(dashboard?.summary.closeToNextTierCount || 0), icon: FiActivity },
  ];

  const openDetails = async (row: EmployeeTargetDashboardRow) => {
    setSelected(row);
    setDetails(null);
    setSearchParams({ payrollMonth: payrollBounds.payrollMonth, employee: row.employeeId });
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
      setMessage(`تمت إعادة بناء السجل. عدد الحركات: ${result.inserted}`);
      await load();
    } catch (rebuildError) {
      setError(rebuildError instanceof Error ? rebuildError.message : "تعذرت إعادة بناء سجل التارقت.");
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

  return (
    <section className="targets-page" dir="rtl">
      <header className="targets-hero">
        <div>
          <span>Employee Sales Targets</span>
          <h1>تارقت الموظفات وبونص المبيعات</h1>
          <p>احتساب من خدمات Core D1 المكتملة، الخصومات، التحصيل، الباقات، والاسترجاعات ثم ترحيله للرواتب.</p>
        </div>
        <button type="button" onClick={rebuild} disabled={!canManage || working}>
          <FiRefreshCw className={working ? "is-spinning" : ""} />
          إعادة بناء السجل
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
      {message ? <div className="targets-alert">{message}</div> : null}
      {!hasAnyPermission(["targets.manage", "targets.adjust"]) ? (
        <div className="targets-alert is-readonly">وضع قراءة فقط: يمكنك مراجعة التارقت والبونص المتوقع دون تعديل.</div>
      ) : null}

      <div className="targets-summary-grid">
        {topCards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label}>
              <Icon />
              <span>{card.label}</span>
              <strong>{card.value}</strong>
            </article>
          );
        })}
      </div>

      <div className="targets-layout">
        <section className="targets-main-panel">
          <div className="targets-panel-head">
            <div>
              <h2>تقدم الموظفات</h2>
              <p>{dashboard?.summary.topEmployee ? `الأعلى: ${dashboard.summary.topEmployee.employeeName}` : "لا توجد حركات مؤهلة حتى الآن."}</p>
            </div>
          </div>

          <div className="targets-table-wrap">
            <table className="targets-table">
              <thead>
                <tr>
                  <th>الموظفة</th>
                  <th>الخطة</th>
                  <th>المبيعات المؤهلة</th>
                  <th>التقدم</th>
                  <th>الشريحة</th>
                  <th>البونص</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7}>جاري تحميل تارقت الموظفات...</td></tr>
                ) : rows.length ? rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td><strong>{row.employeeName}</strong><small>{row.employeeId}</small></td>
                    <td>{row.plan?.name || "لا توجد خطة"}</td>
                    <td>{formatMoney(row.netTargetAmount)}</td>
                    <td>
                      <div className="targets-progress">
                        <span style={{ width: `${progressPercent(row)}%` }} />
                      </div>
                      <small>{progressPercent(row)}% · المتبقي {formatMoney(row.remainingToNextTier)}</small>
                    </td>
                    <td>{row.achievedTier?.tierName || row.nextTier?.tierName || "-"}</td>
                    <td><strong>{formatMoney(row.earnedBonusAmount)}</strong></td>
                    <td><button type="button" onClick={() => void openDetails(row)}>التفاصيل</button></td>
                  </tr>
                )) : (
                  <tr><td colSpan={7}>لا توجد مبيعات مؤهلة في هذه الفترة. استخدم إعادة بناء السجل بعد اكتمال الحجوزات.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="targets-side-panel">
          <div className="targets-panel-head">
            <div>
              <h2>خطة التارقت</h2>
              <p>الخطة الافتراضية تطبق على الموظفات ما لم توجد خطة مخصصة لاحقا.</p>
            </div>
          </div>

          <label>
            <span>خطة محفوظة</span>
            <select
              value={selectedPlanId}
              onChange={(event) => {
                const plan = plans.find((item) => item.id === event.target.value) || null;
                setPlanDraft(draftFromPlan(plan, payrollBounds.monthStart));
              }}
            >
              <option value="">خطة جديدة</option>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>

          <label>
            <span>اسم الخطة</span>
            <input value={planDraft.name} onChange={(event) => setPlanDraft((draft) => ({ ...draft, name: event.target.value }))} />
          </label>

          <label>
            <span>تبدأ من</span>
            <input type="date" value={planDraft.effectiveStart} onChange={(event) => setPlanDraft((draft) => ({ ...draft, effectiveStart: event.target.value }))} />
          </label>

          <label>
            <span>نوع البونص</span>
            <select value={planDraft.bonusType} onChange={(event) => setPlanDraft((draft) => ({ ...draft, bonusType: event.target.value as PlanDraft["bonusType"] }))}>
              <option value="fixed">مبلغ ثابت</option>
              <option value="percentage">نسبة من المبيعات</option>
            </select>
          </label>

          <label className="targets-check">
            <input type="checkbox" checked={planDraft.cumulativeTiers} onChange={(event) => setPlanDraft((draft) => ({ ...draft, cumulativeTiers: event.target.checked }))} />
            <span>احتساب الشرائح بشكل تراكمي</span>
          </label>

          <div className="targets-tier-editor">
            {planDraft.tierTargets.map((target, index) => (
              <div key={index}>
                <label>
                  <span>تارقت {index + 1}</span>
                  <input
                    value={target}
                    onChange={(event) => setPlanDraft((draft) => {
                      const tierTargets = [...draft.tierTargets];
                      tierTargets[index] = event.target.value;
                      return { ...draft, tierTargets };
                    })}
                  />
                </label>
                <label>
                  <span>{planDraft.bonusType === "percentage" ? "النسبة %" : "البونص"}</span>
                  <input
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

          <button type="button" onClick={savePlan} disabled={!canManage || working}>
            <FiEdit3 /> حفظ الخطة
          </button>

          <div className="targets-employee-pick">
            <span>إضافة تسوية سريعة</span>
            <select
              value={selected?.employeeId || ""}
              onChange={(event) => {
                const employee = employees.find((item) => item.id === event.target.value);
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
            >
              <option value="">اختيار موظفة</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </select>
            <input placeholder="المبلغ بالريال، يقبل السالب" value={adjustAmount} onChange={(event) => setAdjustAmount(event.target.value)} />
            <input placeholder="سبب التسوية" value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} />
            <button type="button" onClick={createAdjustment} disabled={!canAdjust || !selected || working}>إضافة التسوية</button>
          </div>
        </aside>
      </div>

      {selected ? (
        <div className="targets-drawer-backdrop" onMouseDown={() => setSelected(null)}>
          <aside className="targets-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span>{payrollBounds.payrollMonth}</span>
                <h2>{selected.employeeName}</h2>
                <p>{selected.plan?.name || "لا توجد خطة مفعلة"}</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="إغلاق"><FiX /></button>
            </header>

            <div className="targets-detail-metrics">
              <div><span>المؤهل</span><strong>{formatMoney(selected.netTargetAmount)}</strong></div>
              <div><span>الاسترجاعات</span><strong>{formatMoney(selected.totalRefunds)}</strong></div>
              <div><span>البونص</span><strong>{formatMoney(selected.earnedBonusAmount)}</strong></div>
            </div>

            <section>
              <h3>حركات التارقت</h3>
              {(details?.ledger || selected.ledger || []).length ? (
                <div className="targets-ledger-list">
                  {(details?.ledger || selected.ledger || []).map((row: EmployeeTargetLedgerRow) => (
                    <article key={row.id}>
                      <div>
                        <strong>{detailReason(row)}</strong>
                        <small>{String(row.performedAt || "").slice(0, 10)} · {row.transactionType}</small>
                      </div>
                      <span>{formatMoney(row.eligibleAmount)}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="targets-empty">لا توجد حركات مفصلة لهذه الفترة.</p>
              )}
            </section>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
