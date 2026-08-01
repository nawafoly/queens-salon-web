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
    { label: "المبيعات المؤهلة", value: formatMoney(dashboard?.summary.totalEligibleSales), icon: FiTrendingUp },
    { label: "مبيعات غير مسندة", value: formatMoney(dashboard?.summary.unassignedSales), icon: FiActivity },
    { label: "حققت التارقت", value: String(dashboard?.summary.achievedCount || 0), icon: FiCheckCircle },
    { label: "البونص المتوقع", value: formatMoney(dashboard?.summary.expectedBonuses), icon: FiTarget },
    { label: "قريبة من الشريحة", value: String(dashboard?.summary.closeToNextTierCount || 0), icon: FiActivity },
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
          تحديث المبيعات
        </button>
      </header>

      <div className="targets-toolbar">
        <label>
          <span>السنة</span>
          <input type="number" value={year} onChange={(event) => setYear(Number(event.target.value) || initial.year)} />
        </label>
        <label>
          <span>الشهر</span>
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
                  <tr><td colSpan={8}>جاري تحميل تارقت الموظفات...</td></tr>
                ) : rows.length ? rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td><strong>{row.employeeName}</strong><small>{row.employeeId}</small></td>
                    <td>{row.plan?.name || "لا توجد خطة"}</td>
                    <td><strong>{formatMoney(targetAmountForRow(row))}</strong></td>
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
                  <tr><td colSpan={8}>لا توجد مبيعات مؤهلة في هذا الشهر حتى الآن.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="targets-mobile-list" aria-label="تقدم الموظفات للجوال">
            {loading ? (
              <p className="targets-empty">جاري تحميل تارقت الموظفات...</p>
            ) : rows.length ? rows.map((row) => (
              <article key={row.employeeId} className="targets-mobile-card">
                <header>
                  <div>
                    <strong>{row.employeeName}</strong>
                    <small>{row.employeeId}</small>
                  </div>
                  <span>{formatMoney(row.earnedBonusAmount)}</span>
                </header>

                <div className="targets-mobile-plan">
                  <span>الخطة</span>
                  <strong>{row.plan?.name || "لا توجد خطة"}</strong>
                </div>

                <div className="targets-mobile-progress">
                  <div className="targets-progress">
                    <span style={{ width: `${progressPercent(row)}%` }} />
                  </div>
                  <small>{progressPercent(row)}% · المتبقي {formatMoney(row.remainingToNextTier)}</small>
                </div>

                <dl>
                  <div><dt>التارقت</dt><dd>{formatMoney(targetAmountForRow(row))}</dd></div>
                  <div><dt>المبيعات المؤهلة</dt><dd>{formatMoney(row.netTargetAmount)}</dd></div>
                  <div><dt>الشريحة</dt><dd>{row.achievedTier?.tierName || row.nextTier?.tierName || "-"}</dd></div>
                </dl>

                <button type="button" onClick={() => void openDetails(row)}>عرض التفاصيل</button>
              </article>
            )) : (
              <p className="targets-empty">لا توجد مبيعات مؤهلة في هذا الشهر حتى الآن.</p>
            )}
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
              <div><span>التارقت</span><strong>{formatMoney(targetAmountForRow(selected))}</strong></div>
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
