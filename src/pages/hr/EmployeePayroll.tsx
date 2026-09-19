import { DashboardSelectBridgeV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
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
} from "../../services/employeeNotificationsCore";
import { CoreHrService } from "../../services/CoreHrService";
import type { CorePayrollEntry } from "../../types/hrCoreApi";
import { useEmployeePortalLanguage, type EmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";
import { cleanText, type HrSession } from "./shared";
import {
  getMyEmployeeRequestPayrollImpact,
  type EmployeeRequestPayrollImpact,
} from "../../services/employeeRequests";

function money(value: unknown, language: EmployeePortalLanguage) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat(language === "en" ? "en-SA" : "ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function monthLabel(monthKey: string, language: EmployeePortalLanguage) {
  const normalized = cleanText(monthKey);
  if (!/^\d{4}-\d{2}$/.test(normalized)) return normalized || "—";
  const [year, month] = normalized.split("-").map(Number);
  return new Intl.DateTimeFormat(language === "en" ? "en-SA" : "ar-SA-u-nu-latn", { year: "numeric", month: "long" }).format(new Date(year, month - 1, 1));
}

const payrollCopy = {
  ar: {
    title: "الراتب", noSession: "لم يتم العثور على جلسة موظف مسجلة.", loadError: "تعذر تحميل سجلات الرواتب.",
    heading: "تفاصيلك المالية", intro: "راجع الراتب الأساسي، الإضافي، الخصومات وصافي كل شهر بطريقة واضحة ومنفصلة.", refresh: "تحديث السجلات",
    latestNet: "صافي آخر راتب", noRecord: "لا يوجد سجل حتى الآن", baseSalary: "الراتب الأساسي", baseNote: "القيمة الأساسية المسجلة",
    overtime: "الساعات الإضافية", overtimeNote: "قيمة الأوفر تايم في آخر سجل", deductions: "إجمالي الخصومات", deductionsNote: "يشمل GOSI والغياب وبقية الخصومات المحفوظة في المسير",
    financialHistory: "السجل المالي", payrollRuns: "مسيرات الرواتب", historyNote: "كل سجل يمثل شهرًا مستقلًا وتفاصيله المالية المعتمدة.", month: "عرض الشهر", allMonths: "كل الأشهر",
    base: "الأساسي", extra: "الإضافي", gosiDeduction: "خصم GOSI", employerGosi: "مساهمة المنشأة GOSI", employerNote: "لا تخصم من صافي الراتب", net: "الصافي",
    download: "تحميل المستند", noDocument: "لا يوجد مستند مرفق", noPayroll: "لا توجد سجلات رواتب", noPayrollNote: "سيظهر السجل هنا بعد اعتماد راتب الشهر من الإدارة.",
    approvedRequests: "الطلبات المالية المعتمدة", overtimeAdvance: "الأوفرتايم والصرف المعجل", requestNote: "تظهر هنا الآثار التشغيلية التي تم تنفيذها من مركز طلبات الموظفات.",
    approvedOvertime: "أوفر تايم معتمد", advanceBalance: "رصيد السلف المتبقي", scheduledInstallments: "أقساط مجدولة", overtimeRecords: "سجلات الأوفرتايم",
    approvedMinutes: "دقيقة معتمدة", noOvertime: "لا يوجد أوفرتايم معتمد من الطلبات.", advances: "الصرف المعجل والأقساط", remaining: "المتبقي", installment: "قسط", noAdvances: "لا توجد سلف منفذة.", hours: "س", minutes: "د", currency: "ر.س",
  },
  en: {
    title: "Pay", noSession: "No employee session found.", loadError: "Could not load payroll records.",
    heading: "Your pay details", intro: "Review your base pay, overtime, deductions and net pay for each month.", refresh: "Refresh records",
    latestNet: "Latest net pay", noRecord: "No record yet", baseSalary: "Base salary", baseNote: "Recorded base amount",
    overtime: "Overtime", overtimeNote: "Overtime pay in the latest record", deductions: "Total deductions", deductionsNote: "Includes GOSI, absence and other deductions recorded in payroll",
    financialHistory: "Pay history", payrollRuns: "Payroll records", historyNote: "Each record shows one month's approved pay details.", month: "Show month", allMonths: "All months",
    base: "Base", extra: "Overtime pay", gosiDeduction: "GOSI deduction", employerGosi: "Employer GOSI contribution", employerNote: "Not deducted from net pay", net: "Net pay",
    download: "Download document", noDocument: "No document attached", noPayroll: "No payroll records", noPayrollNote: "A record will appear here once management approves the month's pay.",
    approvedRequests: "Approved financial requests", overtimeAdvance: "Overtime and salary advances", requestNote: "This shows the processed effects of employee requests.",
    approvedOvertime: "Approved overtime", advanceBalance: "Remaining advance balance", scheduledInstallments: "Scheduled installments", overtimeRecords: "Overtime records",
    approvedMinutes: "approved minutes", noOvertime: "No overtime approved through requests.", advances: "Salary advances and installments", remaining: "Remaining", installment: "installments", noAdvances: "No processed advances.", hours: "h", minutes: "m", currency: "SAR",
  },
} as const;

type EmployeePayrollView = {
  id: string;
  monthKey: string;
  baseSalary: number;
  overtime: number;
  delay: number;
  insurance: number;
  employerGosi: number;
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
    employerGosi: payrollRiyals(row.employerGosiContributionHalalas),
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
  const { language } = useEmployeePortalLanguage();
  const copy = payrollCopy[language];
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
      setMessage(language === "ar" ? cleanText((error as Error)?.message || copy.loadError) : copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [session.uid, language, copy.loadError]);

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
      <div className="employee-workspace employee-workspace--empty" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <h2>{copy.title}</h2>
        <p>{copy.noSession}</p>
      </div>
    );
  }

  return (
    <div className="employee-workspace employee-payroll-workspace" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <section className="employee-workspace-hero employee-workspace-hero--payroll">
        <div className="employee-workspace-hero__copy">
          <span className="employee-workspace-kicker">{copy.title}</span>
          <h1>{copy.heading}</h1>
          <p>{copy.intro}</p>
        </div>
        <button className="employee-secondary-action employee-secondary-action--light" type="button" onClick={() => void load()} disabled={loading}>
          <FontAwesomeIcon icon={faArrowRotateRight} spin={loading} />
          {copy.refresh}
        </button>
      </section>

      {message ? <div className="employee-workspace-alert">{message}</div> : null}

      <section className="employee-kpi-grid employee-kpi-grid--four">
        <article className="employee-kpi-card is-accent">
          <span>{copy.latestNet}</span>
          <strong>{latest ? `${money(latestNet, language)} ${copy.currency}` : "—"}</strong>
          <small>{latest ? monthLabel(latest.monthKey, language) : copy.noRecord}</small>
          <FontAwesomeIcon icon={faWallet} />
        </article>
        <article className="employee-kpi-card">
          <span>{copy.baseSalary}</span>
          <strong>{money(latest?.baseSalary ?? currentBaseSalary, language)} {copy.currency}</strong>
          <small>{copy.baseNote}</small>
          <FontAwesomeIcon icon={faMoneyBillWave} />
        </article>
        <article className="employee-kpi-card is-success">
          <span>{copy.overtime}</span>
          <strong>{money(latestOvertime, language)} {copy.currency}</strong>
          <small>{copy.overtimeNote}</small>
          <FontAwesomeIcon icon={faArrowTrendUp} />
        </article>
        <article className="employee-kpi-card is-danger">
          <span>{copy.deductions}</span>
          <strong>{money(latestDeductions, language)} {copy.currency}</strong>
          <small>{copy.deductionsNote}</small>
          <FontAwesomeIcon icon={faCircleMinus} />
        </article>
      </section>

      <section className="employee-workspace-panel">
        <div className="employee-workspace-panel__head">
          <div>
            <span className="employee-workspace-kicker">{copy.financialHistory}</span>
            <h2>{copy.payrollRuns}</h2>
            <p>{copy.historyNote}</p>
          </div>
          <label className="employee-month-filter">
            <span>{copy.month}</span>
            <DashboardSelectBridgeV2 value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
              <option value="all">{copy.allMonths}</option>
              {monthOptions.map((month) => <option key={month} value={month}>{monthLabel(month, language)}</option>)}
            </DashboardSelectBridgeV2>
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
                    <strong>{monthLabel(row.monthKey, language)}</strong>
                    <small>{row.monthKey}</small>
                  </div>
                </div>

                <div className="employee-payroll-card__figures">
                  <div><span>{copy.base}</span><strong>{money(row.baseSalary, language)} {copy.currency}</strong></div>
                  <div className="is-success"><span>{copy.extra}</span><strong>+ {money(row.overtime, language)} {copy.currency}</strong></div>
                  <div className="is-danger"><span>{copy.deductions}</span><strong>- {money(deductions, language)} {copy.currency}</strong></div>
                  <div className="is-danger"><span>{copy.gosiDeduction}</span><strong>- {money(row.insurance, language)} {copy.currency}</strong></div>
                  <div><span>{copy.employerGosi}</span><strong>{money(row.employerGosi, language)} {copy.currency}</strong><small>{copy.employerNote}</small></div>
                  <div className="is-net"><span>{copy.net}</span><strong>{money(net, language)} {copy.currency}</strong></div>
                </div>

                <div className="employee-payroll-card__actions">
                  {row.attachedDocumentUrl ? (
                    <a href={row.attachedDocumentUrl} target="_blank" rel="noreferrer" className="employee-secondary-action">
                      <FontAwesomeIcon icon={faDownload} />
                      {row.attachedDocumentName || copy.download}
                    </a>
                  ) : (
                    <span className="employee-payroll-no-document"><FontAwesomeIcon icon={faReceipt} /> {copy.noDocument}</span>
                  )}
                </div>
              </article>
            );
          })}

          {!loading && !filtered.length ? (
            <div className="employee-empty-state">
              <FontAwesomeIcon icon={faFileInvoiceDollar} />
              <h3>{copy.noPayroll}</h3>
              <p>{copy.noPayrollNote}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="employee-workspace-panel employee-request-payroll-impact">
        <div className="employee-workspace-panel__head">
          <div>
            <span className="employee-workspace-kicker">{copy.approvedRequests}</span>
            <h2>{copy.overtimeAdvance}</h2>
            <p>{copy.requestNote}</p>
          </div>
        </div>

        <div className="employee-request-payroll-summary">
          <article>
            <span>{copy.approvedOvertime}</span>
            <strong>{Math.floor(approvedOvertimeMinutes / 60)} {copy.hours} {approvedOvertimeMinutes % 60} {copy.minutes}</strong>
          </article>
          <article>
            <span>{copy.advanceBalance}</span>
            <strong>{money(activeAdvanceHalalas / 100, language)} {copy.currency}</strong>
          </article>
          <article>
            <span>{copy.scheduledInstallments}</span>
            <strong>{requestImpact.installments.filter((item) => item.status === "scheduled").length}</strong>
          </article>
        </div>

        <div className="employee-request-payroll-lists">
          <div>
            <h3>{copy.overtimeRecords}</h3>
            {requestImpact.overtime.length ? requestImpact.overtime.map((item) => (
              <article key={item.id}>
                <strong>{item.date_key}</strong>
                <span>{item.approved_minutes} {copy.approvedMinutes}</span>
                <small>{item.task_summary || item.reason || item.payout_status}</small>
              </article>
            )) : <p>{copy.noOvertime}</p>}
          </div>
          <div>
            <h3>{copy.advances}</h3>
            {requestImpact.advances.length ? requestImpact.advances.map((advance) => (
              <article key={advance.id}>
                <strong>{money(Number(advance.approved_halalas || 0) / 100, language)} {copy.currency}</strong>
                <span>{copy.remaining} {money(Number(advance.remaining_halalas || 0) / 100, language)} {copy.currency}</span>
                <small>{advance.installment_count} {copy.installment} • {language === "en" ? advance.payment_status.replaceAll("_", " ") : advance.payment_status}</small>
              </article>
            )) : <p>{copy.noAdvances}</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
