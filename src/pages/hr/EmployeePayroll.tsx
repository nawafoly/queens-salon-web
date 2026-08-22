import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faArrowTrendUp,
  faCircleMinus,
  faDownload,
  faFileInvoiceDollar,
  faMoneyBillWave,
  faReceipt,
  faWallet,
} from "@fortawesome/free-solid-svg-icons";

import {
  listEmployeeNotifications,
  markEmployeeNotificationsRead,
} from "../../services/employeeHub";
import { CoreHrService } from "../../services/CoreHrService";
import type { CorePayrollEntry } from "../../types/hrCoreApi";
import { cleanText, type HrSession } from "./shared";
import {
  getMyEmployeeRequestPayrollImpact,
  type EmployeeRequestPayrollImpact,
} from "../../services/employeeRequests";

function money(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("ar-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function monthLabel(monthKey: string) {
  const normalized = cleanText(monthKey);
  if (!/^\d{4}-\d{2}$/.test(normalized)) return normalized || "—";
  const [year, month] = normalized.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-SA", { year: "numeric", month: "long" }).format(new Date(year, month - 1, 1));
}

type EmployeePayrollView = {
  id: string;
  monthKey: string;
  baseSalary: number;
  overtime: number;
  delay: number;
  insurance: number;
  deductions: number;
  absencePenalties: number;
  total: number;
  salary: number;
  attachedDocumentUrl?: string;
  attachedDocumentName?: string;
};

function payrollRiyals(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount / 100 : 0;
}

function mapCorePayrollRecord(row: CorePayrollEntry): EmployeePayrollView {
  const delay = payrollRiyals(row.delayDeductionHalalas);
  const insurance = payrollRiyals(row.insuranceDeductionHalalas);
  const absencePenalties = payrollRiyals(row.absenceDeductionHalalas);
  const totalDeductions = payrollRiyals(row.totalDeductionsHalalas);
  return {
    id: cleanText(row.id),
    monthKey: cleanText(row.payrollMonth),
    baseSalary: payrollRiyals(row.baseSalaryHalalas),
    overtime: payrollRiyals(row.overtimeValueHalalas ?? row.overtimeBonusHalalas),
    delay,
    insurance,
    absencePenalties,
    deductions: Math.max(0, totalDeductions - delay - insurance - absencePenalties),
    total: payrollRiyals(row.finalSalaryHalalas),
    salary: payrollRiyals(row.netSalaryHalalas ?? row.finalSalaryHalalas),
  };
}

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

export default function EmployeePayrollPage({ session, onPortalChange }: Props) {
  const [records, setRecords] = useState<EmployeePayrollView[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [requestImpact, setRequestImpact] = useState<EmployeeRequestPayrollImpact>({ overtime: [], advances: [], installments: [], financialPayments: [] });

  const currentBaseSalary = 0;

  const load = useCallback(async () => {
    if (!session.uid) return;
    setLoading(true);
    setMessage("");
    try {
      const [rows, impact] = await Promise.all([
        CoreHrService.listMyPayrollEntries(),
        getMyEmployeeRequestPayrollImpact().catch(() => ({ overtime: [], advances: [], installments: [], financialPayments: [] })),
      ]);
      setRecords(rows.map(mapCorePayrollRecord).slice(0, 24));
      setRequestImpact(impact);
    } catch (error) {
      setMessage(cleanText((error as any)?.message || "تعذر تحميل سجلات الرواتب."));
    } finally {
      setLoading(false);
    }
  }, [session.uid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session.uid) return;
    void (async () => {
      try {
        const notifications = await listEmployeeNotifications({
          targetUid: session.uid,
          targetEmployeeId: session.employeeId,
          limitCount: 200,
        });
        const ids = notifications
          .filter((item) => !item.isRead && (item.route === "/employee/payroll" || item.type === "payroll"))
          .map((item) => item.id);
        if (!ids.length) return;
        await markEmployeeNotificationsRead({ notificationIds: ids, readerUid: session.uid });
        await Promise.resolve(onPortalChange?.());
      } catch {
        // no-op
      }
    })();
  }, [onPortalChange, session.employeeId, session.uid]);

  const sorted = useMemo(
    () => [...records].sort((a, b) => cleanText(b.monthKey).localeCompare(cleanText(a.monthKey))),
    [records],
  );
  const latest = sorted[0] || null;
  const monthOptions = useMemo(() => Array.from(new Set(sorted.map((item) => cleanText(item.monthKey)).filter(Boolean))), [sorted]);
  const filtered = selectedMonth === "all" ? sorted : sorted.filter((item) => item.monthKey === selectedMonth);

  const latestNet = Number(latest?.salary ?? latest?.total ?? 0);
  const latestOvertime = Number(latest?.overtime || 0);
  const latestDeductions = Number(latest?.deductions || 0) + Number(latest?.insurance || 0) + Number(latest?.absencePenalties || 0) + Number(latest?.delay || 0);
  const approvedOvertimeMinutes = requestImpact.overtime.reduce((sum, item) => sum + Number(item.approved_minutes || 0), 0);
  const activeAdvanceHalalas = requestImpact.advances.reduce((sum, item) => sum + Number(item.remaining_halalas || 0), 0);

  if (!session.user) {
    return (
      <div className="employee-workspace employee-workspace--empty">
        <h2>الراتب</h2>
        <p>لم يتم العثور على جلسة موظف مسجلة.</p>
      </div>
    );
  }

  return (
    <div className="employee-workspace employee-payroll-workspace" dir="rtl">
      <section className="employee-workspace-hero employee-workspace-hero--payroll">
        <div className="employee-workspace-hero__copy">
          <span className="employee-workspace-kicker">الراتب</span>
          <h1>تفاصيلك المالية</h1>
          <p>راجع الراتب الأساسي، الإضافي، الخصومات وصافي كل شهر بطريقة واضحة ومنفصلة.</p>
        </div>
        <button className="employee-secondary-action employee-secondary-action--light" type="button" onClick={() => void load()} disabled={loading}>
          <FontAwesomeIcon icon={faArrowRotateRight} spin={loading} />
          تحديث السجلات
        </button>
      </section>

      {message ? <div className="employee-workspace-alert">{message}</div> : null}

      <section className="employee-kpi-grid employee-kpi-grid--four">
        <article className="employee-kpi-card is-accent">
          <span>صافي آخر راتب</span>
          <strong>{latest ? `${money(latestNet)} ر.س` : "—"}</strong>
          <small>{latest ? monthLabel(latest.monthKey) : "لا يوجد سجل حتى الآن"}</small>
          <FontAwesomeIcon icon={faWallet} />
        </article>
        <article className="employee-kpi-card">
          <span>الراتب الأساسي</span>
          <strong>{money(latest?.baseSalary ?? currentBaseSalary)} ر.س</strong>
          <small>القيمة الأساسية المسجلة</small>
          <FontAwesomeIcon icon={faMoneyBillWave} />
        </article>
        <article className="employee-kpi-card is-success">
          <span>الساعات الإضافية</span>
          <strong>{money(latestOvertime)} ر.س</strong>
          <small>قيمة الأوفر تايم في آخر سجل</small>
          <FontAwesomeIcon icon={faArrowTrendUp} />
        </article>
        <article className="employee-kpi-card is-danger">
          <span>إجمالي الخصومات</span>
          <strong>{money(latestDeductions)} ر.س</strong>
          <small>التأمين والتأخير والغياب والخصومات</small>
          <FontAwesomeIcon icon={faCircleMinus} />
        </article>
      </section>

      <section className="employee-workspace-panel">
        <div className="employee-workspace-panel__head">
          <div>
            <span className="employee-workspace-kicker">السجل المالي</span>
            <h2>مسيرات الرواتب</h2>
            <p>كل سجل يمثل شهرًا مستقلًا وتفاصيله المالية المعتمدة.</p>
          </div>
          <label className="employee-month-filter">
            <span>عرض الشهر</span>
            <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              <option value="all">كل الأشهر</option>
              {monthOptions.map((month) => <option key={month} value={month}>{monthLabel(month)}</option>)}
            </select>
          </label>
        </div>

        <div className="employee-payroll-list">
          {filtered.map((row) => {
            const deductions = Number(row.deductions || 0) + Number(row.insurance || 0) + Number(row.absencePenalties || 0) + Number(row.delay || 0);
            const net = Number(row.salary ?? row.total ?? 0);
            return (
              <article key={row.id} className="employee-payroll-card">
                <div className="employee-payroll-card__month">
                  <span><FontAwesomeIcon icon={faFileInvoiceDollar} /></span>
                  <div>
                    <strong>{monthLabel(row.monthKey)}</strong>
                    <small>{row.monthKey}</small>
                  </div>
                </div>

                <div className="employee-payroll-card__figures">
                  <div><span>الأساسي</span><strong>{money(row.baseSalary)} ر.س</strong></div>
                  <div className="is-success"><span>الإضافي</span><strong>+ {money(row.overtime)} ر.س</strong></div>
                  <div className="is-danger"><span>الخصومات</span><strong>- {money(deductions)} ر.س</strong></div>
                  <div className="is-net"><span>الصافي</span><strong>{money(net)} ر.س</strong></div>
                </div>

                <div className="employee-payroll-card__actions">
                  {row.attachedDocumentUrl ? (
                    <a href={row.attachedDocumentUrl} target="_blank" rel="noreferrer" className="employee-secondary-action">
                      <FontAwesomeIcon icon={faDownload} />
                      {row.attachedDocumentName || "تحميل المستند"}
                    </a>
                  ) : (
                    <span className="employee-payroll-no-document"><FontAwesomeIcon icon={faReceipt} /> لا يوجد مستند مرفق</span>
                  )}
                </div>
              </article>
            );
          })}

          {!loading && !filtered.length ? (
            <div className="employee-empty-state">
              <FontAwesomeIcon icon={faFileInvoiceDollar} />
              <h3>لا توجد سجلات رواتب</h3>
              <p>سيظهر السجل هنا بعد اعتماد راتب الشهر من الإدارة.</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="employee-workspace-panel employee-request-payroll-impact">
        <div className="employee-workspace-panel__head">
          <div>
            <span className="employee-workspace-kicker">الطلبات المالية المعتمدة</span>
            <h2>الأوفرتايم والصرف المعجل</h2>
            <p>تظهر هنا الآثار التشغيلية التي تم تنفيذها من مركز طلبات الموظفات.</p>
          </div>
        </div>

        <div className="employee-request-payroll-summary">
          <article>
            <span>أوفر تايم معتمد</span>
            <strong>{Math.floor(approvedOvertimeMinutes / 60)} س {approvedOvertimeMinutes % 60} د</strong>
          </article>
          <article>
            <span>رصيد السلف المتبقي</span>
            <strong>{money(activeAdvanceHalalas / 100)} ر.س</strong>
          </article>
          <article>
            <span>أقساط مجدولة</span>
            <strong>{requestImpact.installments.filter((item) => item.status === "scheduled").length}</strong>
          </article>
        </div>

        <div className="employee-request-payroll-lists">
          <div>
            <h3>سجلات الأوفرتايم</h3>
            {requestImpact.overtime.length ? requestImpact.overtime.map((item) => (
              <article key={item.id}>
                <strong>{item.date_key}</strong>
                <span>{item.approved_minutes} دقيقة معتمدة</span>
                <small>{item.task_summary || item.reason || item.payout_status}</small>
              </article>
            )) : <p>لا يوجد أوفرتايم معتمد من الطلبات.</p>}
          </div>
          <div>
            <h3>الصرف المعجل والأقساط</h3>
            {requestImpact.advances.length ? requestImpact.advances.map((advance) => (
              <article key={advance.id}>
                <strong>{money(Number(advance.approved_halalas || 0) / 100)} ر.س</strong>
                <span>المتبقي {money(Number(advance.remaining_halalas || 0) / 100)} ر.س</span>
                <small>{advance.installment_count} قسط • {advance.payment_status}</small>
              </article>
            )) : <p>لا توجد سلف منفذة.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
