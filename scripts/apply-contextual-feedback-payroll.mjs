import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing payroll codemod anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Payroll codemod anchor is not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const pagePath = "src/pages/DashboardPayroll.tsx";
let page = readFileSync(pagePath, "utf8");

page = replaceOnce(
  page,
  `import {\n  DashboardDatePickerV2,\n  DashboardSelectV2,\n} from "../components/dashboard-v2";`,
  `import {\n  DashboardActionFeedbackV2,\n  DashboardDatePickerV2,\n  DashboardSelectV2,\n} from "../components/dashboard-v2";`,
  "dashboard-v2 import"
);

page = replaceOnce(
  page,
  `type PayrollLateApprovalDraft = {\n  employeeId: string;\n  approvalDate: string;\n  approvedAmountRiyals: string;\n  reason: string;\n};\n`,
  `type PayrollLateApprovalDraft = {\n  employeeId: string;\n  approvalDate: string;\n  approvedAmountRiyals: string;\n  reason: string;\n};\n\ntype PayrollLateApprovalErrors = {\n  approvalDate?: string;\n  approvedAmountRiyals?: string;\n  reason?: string;\n  form?: string;\n};\n\ntype PayrollRowFeedback = {\n  employeeId: string;\n  payrollMonth: string;\n  tone: "success" | "danger";\n  message: string;\n} | null;\n`,
  "late approval types"
);

page = replaceOnce(
  page,
  `  const [lateApproval, setLateApproval] =\n    useState<PayrollLateApprovalDraft | null>(null);\n`,
  `  const [lateApproval, setLateApproval] =\n    useState<PayrollLateApprovalDraft | null>(null);\n  const [lateApprovalErrors, setLateApprovalErrors] =\n    useState<PayrollLateApprovalErrors>({});\n  const [lateApprovalLauncherFeedback, setLateApprovalLauncherFeedback] =\n    useState("");\n  const [payrollRowFeedback, setPayrollRowFeedback] =\n    useState<PayrollRowFeedback>(null);\n`,
  "late approval state"
);

page = replaceOnce(
  page,
  `    if (!preferred) {\n      setError(\n        "لا توجد مسيرة غير معتمدة لهذه الفترة."\n      );\n      return;\n    }\n\n    setError("");\n    setLateApproval({`,
  `    if (!preferred) {\n      setLateApprovalLauncherFeedback(\n        "لا توجد مسيرة غير معتمدة لهذه الفترة."\n      );\n      return;\n    }\n\n    setLateApprovalLauncherFeedback("");\n    setLateApprovalErrors({});\n    setLateApproval({`,
  "open late approval"
);

const submitStart = `  const submitLateApproval = async () => {\n    if (!lateApproval || !selectedLateApprovalEntry || !canRecordLateApproval) {\n      return;\n    }\n\n    if (!lateApproval.approvalDate) {\n      setError("اختر تاريخ الاعتماد الفعلي.");\n      return;\n    }\n\n    const amountRiyals = Number(lateApproval.approvedAmountRiyals);\n    if (!Number.isFinite(amountRiyals) || amountRiyals < 0) {\n      setError("أدخل المبلغ الذي تم اعتماده فعليًا.");\n      return;\n    }\n\n    const reason = lateApproval.reason.trim();\n    if (!reason) {\n      setError("سبب التسجيل المتأخر مطلوب.");\n      return;\n    }\n\n    setBusy(\`late-approve:\${selectedLateApprovalEntry.employeeId}\`);\n    setError("");`;

const submitReplacement = `  const submitLateApproval = async () => {\n    if (!lateApproval || !selectedLateApprovalEntry || !canRecordLateApproval) {\n      return;\n    }\n\n    const nextErrors: PayrollLateApprovalErrors = {};\n    if (!lateApproval.approvalDate) {\n      nextErrors.approvalDate = "اختر تاريخ الاعتماد الفعلي.";\n    }\n\n    const amountRiyals = Number(lateApproval.approvedAmountRiyals);\n    if (!Number.isFinite(amountRiyals) || amountRiyals < 0) {\n      nextErrors.approvedAmountRiyals = "أدخل المبلغ الذي تم اعتماده فعليًا.";\n    }\n\n    const reason = lateApproval.reason.trim();\n    if (!reason) {\n      nextErrors.reason = "سبب التسجيل المتأخر مطلوب.";\n    }\n\n    if (Object.keys(nextErrors).length) {\n      setLateApprovalErrors(nextErrors);\n      return;\n    }\n\n    setBusy(\`late-approve:\${selectedLateApprovalEntry.employeeId}\`);\n    setLateApprovalErrors({});`;

page = replaceOnce(page, submitStart, submitReplacement, "late approval validation");

page = replaceOnce(
  page,
  `      setLateApproval(null);\n      setMessage(\n        \`تم تسجيل اعتماد \${saved.employeeName} بأثر فعلي بتاريخ \${lateApproval.approvalDate}. وقت تسجيل العملية الحالي محفوظ في سجل التدقيق.\`\n      );\n    } catch (actionError: any) {\n      setError(\n        payrollActionErrorMessage(\n          actionError,\n          "تعذر تسجيل الاعتماد المتأخر."\n        )\n      );\n    } finally {`,
  `      setPayrollRowFeedback({\n        employeeId: saved.employeeId,\n        payrollMonth: saved.payrollMonth,\n        tone: "success",\n        message: \`تم تسجيل اعتماد \${saved.employeeName} بأثر فعلي بتاريخ \${lateApproval.approvalDate}. وقت تسجيل العملية الحالي محفوظ في سجل التدقيق.\`,\n      });\n      setLateApprovalErrors({});\n      setLateApproval(null);\n    } catch (actionError: any) {\n      setLateApprovalErrors({\n        form: payrollActionErrorMessage(\n          actionError,\n          "تعذر تسجيل الاعتماد المتأخر."\n        ),\n      });\n    } finally {`,
  "late approval result"
);

page = replaceOnce(
  page,
  `          <div className="payroll-actions-group payroll-actions-group--exports">`,
  `          {lateApprovalLauncherFeedback ? (\n            <DashboardActionFeedbackV2\n              compact\n              revealOnMount\n              tone="danger"\n              title="تعذر فتح الاعتماد المتأخر"\n              description={lateApprovalLauncherFeedback}\n            />\n          ) : null}\n\n          <div className="payroll-actions-group payroll-actions-group--exports">`,
  "late approval launcher feedback"
);

page = replaceOnce(
  page,
  `                    <div className="payroll-row-badges">\n                      <span className={\`payroll-mini-badge \${entry.saved ? "is-saved" : "is-preview"}\`}>\n                        {entry.saved ? "محفوظ" : "معاينة غير محفوظة"}\n                      </span>\n                      {manualAdjustments ? <span className="payroll-mini-badge is-manual">بنود يدوية</span> : null}\n                    </div>`,
  `                    <div className="payroll-row-badges">\n                      <span className={\`payroll-mini-badge \${entry.saved ? "is-saved" : "is-preview"}\`}>\n                        {entry.saved ? "محفوظ" : "معاينة غير محفوظة"}\n                      </span>\n                      {manualAdjustments ? <span className="payroll-mini-badge is-manual">بنود يدوية</span> : null}\n                    </div>\n                    {payrollRowFeedback?.employeeId === entry.employeeId &&\n                    payrollRowFeedback.payrollMonth === entry.payrollMonth ? (\n                      <DashboardActionFeedbackV2\n                        compact\n                        tone={payrollRowFeedback.tone}\n                        title="تم تسجيل الاعتماد المتأخر"\n                        description={payrollRowFeedback.message}\n                        className="payroll-row-feedback"\n                      />\n                    ) : null}`,
  "row success feedback"
);

page = replaceOnce(
  page,
  `          onMouseDown={() => setLateApproval(null)}\n        >`,
  `          onMouseDown={() => {\n            if (!busy.startsWith("late-approve:")) setLateApproval(null);\n          }}\n        >`,
  "late approval backdrop close"
);

page = replaceOnce(
  page,
  `                onClick={() => setLateApproval(null)}\n                aria-label="إغلاق"`,
  `                onClick={() => setLateApproval(null)}\n                disabled={busy.startsWith("late-approve:")}\n                aria-label="إغلاق"`,
  "late approval close button"
);

page = replaceOnce(
  page,
  `                  onChange={(employeeId) => {\n                    const nextEntry = lateApprovalCandidates.find(\n                      (entry) => entry.employeeId === employeeId\n                    );\n                    setLateApproval({`,
  `                  disabled={busy.startsWith("late-approve:")}\n                  onChange={(employeeId) => {\n                    const nextEntry = lateApprovalCandidates.find(\n                      (entry) => entry.employeeId === employeeId\n                    );\n                    setLateApprovalErrors({});\n                    setLateApproval({`,
  "late approval employee field"
);

page = replaceOnce(
  page,
  `                  clearable={false}\n                  placeholder="اختر التاريخ"\n                  onChange={(approvalDate) =>\n                    setLateApproval({ ...lateApproval, approvalDate })\n                  }\n                />`,
  `                  clearable={false}\n                  disabled={busy.startsWith("late-approve:")}\n                  placeholder="اختر التاريخ"\n                  aria-invalid={Boolean(lateApprovalErrors.approvalDate)}\n                  aria-describedby={lateApprovalErrors.approvalDate ? "payroll-late-approval-date-error" : undefined}\n                  onChange={(approvalDate) => {\n                    setLateApprovalErrors((current) => ({ ...current, approvalDate: undefined, form: undefined }));\n                    setLateApproval({ ...lateApproval, approvalDate });\n                  }}\n                />\n                {lateApprovalErrors.approvalDate ? (\n                  <small id="payroll-late-approval-date-error" className="dsv2-field__error" role="alert">\n                    {lateApprovalErrors.approvalDate}\n                  </small>\n                ) : null}`,
  "late approval date field"
);

page = replaceOnce(
  page,
  `                    value={lateApproval.approvedAmountRiyals}\n                    onChange={(event) =>\n                      setLateApproval({\n                        ...lateApproval,\n                        approvedAmountRiyals: event.target.value,\n                      })\n                    }\n                    placeholder="3610.00"`,
  `                    value={lateApproval.approvedAmountRiyals}\n                    disabled={busy.startsWith("late-approve:")}\n                    aria-invalid={Boolean(lateApprovalErrors.approvedAmountRiyals)}\n                    aria-describedby={lateApprovalErrors.approvedAmountRiyals ? "payroll-late-approval-amount-error" : undefined}\n                    onChange={(event) => {\n                      setLateApprovalErrors((current) => ({ ...current, approvedAmountRiyals: undefined, form: undefined }));\n                      setLateApproval({\n                        ...lateApproval,\n                        approvedAmountRiyals: event.target.value,\n                      });\n                    }}\n                    placeholder="3610.00"`,
  "late approval amount control"
);

page = replaceOnce(
  page,
  `                  <span className="payroll-late-approval-currency">SAR</span>\n                </div>\n                {selectedLateApprovalEntry ? (`,
  `                  <span className="payroll-late-approval-currency">SAR</span>\n                </div>\n                {lateApprovalErrors.approvedAmountRiyals ? (\n                  <small id="payroll-late-approval-amount-error" className="dsv2-field__error" role="alert">\n                    {lateApprovalErrors.approvedAmountRiyals}\n                  </small>\n                ) : null}\n                {selectedLateApprovalEntry ? (`,
  "late approval amount error"
);

page = replaceOnce(
  page,
  `                  value={lateApproval.reason}\n                  onChange={(event) =>\n                    setLateApproval({\n                      ...lateApproval,\n                      reason: event.target.value,\n                    })\n                  }\n                />\n              </label>`,
  `                  value={lateApproval.reason}\n                  disabled={busy.startsWith("late-approve:")}\n                  aria-invalid={Boolean(lateApprovalErrors.reason)}\n                  aria-describedby={lateApprovalErrors.reason ? "payroll-late-approval-reason-error" : undefined}\n                  onChange={(event) => {\n                    setLateApprovalErrors((current) => ({ ...current, reason: undefined, form: undefined }));\n                    setLateApproval({\n                      ...lateApproval,\n                      reason: event.target.value,\n                    });\n                  }}\n                />\n                {lateApprovalErrors.reason ? (\n                  <small id="payroll-late-approval-reason-error" className="dsv2-field__error" role="alert">\n                    {lateApprovalErrors.reason}\n                  </small>\n                ) : null}\n              </label>`,
  "late approval reason field"
);

page = replaceOnce(
  page,
  `            <footer>\n              <button type="button" onClick={() => setLateApproval(null)}>\n                إلغاء\n              </button>`,
  `            {lateApprovalErrors.form ? (\n              <DashboardActionFeedbackV2\n                revealOnMount\n                focusOnMount\n                tone="danger"\n                title="تعذر تسجيل الاعتماد المتأخر"\n                description={lateApprovalErrors.form}\n              />\n            ) : null}\n\n            <footer>\n              <button\n                type="button"\n                disabled={busy.startsWith("late-approve:")}\n                onClick={() => setLateApproval(null)}\n              >\n                إلغاء\n              </button>`,
  "late approval form feedback"
);

writeFileSync(pagePath, page, "utf8");

const cssPath = "src/styles/dashboard-v2/pages/payroll.css";
let css = readFileSync(cssPath, "utf8");
const marker = "/* Contextual action feedback — payroll */";
if (!css.includes(marker)) {
  css += `\n\n${marker}\n.dashboard-v2 .dsv2-payroll-page .payroll-row-feedback {\n  margin-block-start: var(--dsv2-space-2);\n  min-width: min(260px, 42vw);\n}\n\nbody > .dashboard-v2.payroll-modal-backdrop\n  .payroll-late-approval-modal\n  .dsv2-field__error {\n  display: block;\n  margin-block-start: var(--dsv2-space-1);\n}\n`;
  writeFileSync(cssPath, css, "utf8");
}

console.log("Applied contextual payroll feedback codemod.");
