import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing dashboard feedback anchor: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Dashboard feedback anchor is not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function patch(path, edits) {
  let source = readFileSync(path, "utf8");
  for (const [before, after, label] of edits) source = replaceOnce(source, before, after, label);
  writeFileSync(path, source, "utf8");
}

// 1) Preserve precise Core domain reasons before generic HTTP fallbacks.
patch("src/services/coreApiClient.ts", [
  [
    `  "core_payroll:deduction_amount_required": "اكتب مبلغًا أكبر من صفر.",`,
    `  "core_payroll:deduction_amount_required": "اكتب مبلغًا أكبر من صفر.",\n  "core_payroll:employer_loan_deduction_cap_exceeded": "تعذر اعتماد المسيرة لأن قسط أو استقطاع سلفة جهة العمل يتجاوز الحد النظامي البالغ 10% من أجر الاستحقاق لهذه المسيرة. راجع أقساط السلفة أو أجّل القسط ثم أعد الاعتماد.",\n  "core_payroll:aggregate_deduction_cap_exceeded": "تعذر اعتماد المسيرة لأن إجمالي الخصومات المحمية يتجاوز الحد النظامي الإجمالي المسموح لهذه المسيرة. راجع تفاصيل الخصومات قبل الاعتماد.",\n  "core_payroll:judicial_deduction_cap_exceeded": "تعذر اعتماد المسيرة لأن استقطاعًا قضائيًا يتجاوز الحد المسموح له حسب أمر التنفيذ المسجل. راجع مبلغ الاستقطاع ومرجع الأمر القضائي.",\n  "core_payroll:deduction_legal_class_required": "يوجد خصم غير مصنف نظاميًا. حدّد نوع الخصم قبل اعتماد المسيرة.",\n  "core_payroll:deduction_evidence_reference_required": "يوجد خصم يحتاج مستندًا أو مرجع إثبات قبل اعتماد المسيرة.",\n  "core_payroll:written_consent_reference_required": "يوجد خصم يتطلب مرجع موافقة خطية قبل اعتماد المسيرة.",\n  "core_payroll:employee_not_active": "لا يمكن اعتماد المسيرة لأن الموظفة غير نشطة في Core لهذه الفترة.",\n  "core_payroll:employee_not_payroll_eligible": "لا يمكن اعتماد المسيرة لأن إعداد الراتب الأساسي للموظفة غير مكتمل أو غير صالح.",`,
    "precise payroll core messages",
  ],
  [
    `function localizedMessage(status: number, code: string, fallback: string): string {\n  const specific = CORE_API_CODE_MESSAGES[code];\n  if (specific) return specific;\n  if (status === 401) return "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.";\n  if (status === 403) return "ليست لديك صلاحية لتنفيذ هذه العملية.";\n  if (status === 409) {\n    return code.includes("slot")\n      ? "الموعد محجوز بالفعل. اختاري وقتًا آخر."\n      : "يوجد تعارض في البيانات. حدّث الصفحة وحاول مرة أخرى.";\n  }\n  if (status === 400 || status === 422) return "بعض البيانات غير صحيحة. راجع الحقول المطلوبة.";\n  if (status === 408) return "انتهت مهلة الاتصال بالخدمة الأساسية.";\n  if (status >= 500) return "الخدمة الأساسية غير متاحة مؤقتًا.";\n  const safeFallback = String(fallback || "").trim();\n  return safeFallback && !safeFallback.startsWith("core_")\n    ? safeFallback\n    : "تعذر تنفيذ الطلب.";\n}`,
    `function localizedMessage(status: number, code: string, fallback: string): string {\n  const specific = CORE_API_CODE_MESSAGES[code];\n  if (specific) return specific;\n  if (status === 401) return "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.";\n  if (status === 403) return "ليست لديك صلاحية لتنفيذ هذه العملية.";\n\n  // Domain services often return a human-readable reason alongside a stable\n  // code. Preserve that reason before falling back to a generic HTTP message.\n  const safeFallback = String(fallback || "").trim();\n  if (safeFallback && !safeFallback.startsWith("core_") && !/^HTTP\\s+\\d+/i.test(safeFallback)) {\n    return safeFallback;\n  }\n\n  if (status === 409) {\n    return code.includes("slot")\n      ? "الموعد محجوز بالفعل. اختاري وقتًا آخر."\n      : "تعذر تنفيذ الإجراء بسبب تعارض في البيانات. راجع حالة العنصر وحدّثه ثم أعد المحاولة.";\n  }\n  if (status === 400 || status === 422) return "تعذر تنفيذ الإجراء لأن بعض البيانات غير صحيحة أو ناقصة. راجع الحقول المطلوبة.";\n  if (status === 408) return "انتهت مهلة الاتصال بالخدمة الأساسية.";\n  if (status >= 500) return "الخدمة الأساسية غير متاحة مؤقتًا.";\n  return "تعذر تنفيذ الطلب لسبب غير محدد من الخدمة الأساسية.";\n}`,
    "preserve domain fallback",
  ],
]);

// 2) Payroll: exact reason at the row/modal that launched approval.
patch("src/pages/DashboardPayroll.tsx", [
  [
    `type PayrollRowFeedback = {\n  employeeId: string;\n  payrollMonth: string;\n  tone: "success" | "danger";\n  message: string;\n} | null;`,
    `type PayrollRowFeedback = {\n  employeeId: string;\n  payrollMonth: string;\n  tone: "success" | "danger";\n  title: string;\n  message: string;\n} | null;`,
    "payroll row feedback title",
  ],
  [
    `  const [approvalConfirmation, setApprovalConfirmation] =\n    useState<PayrollApprovalConfirmationDraft | null>(null);`,
    `  const [approvalConfirmation, setApprovalConfirmation] =\n    useState<PayrollApprovalConfirmationDraft | null>(null);\n  const [approvalConfirmationError, setApprovalConfirmationError] = useState("");`,
    "approval confirmation error state",
  ],
  [
    `  if (\n    message === "core_payroll:aggregate_deduction_cap_exceeded" ||\n    message === "core_payroll:employer_loan_deduction_cap_exceeded" ||\n    message === "core_payroll:judicial_deduction_cap_exceeded"\n  ) {\n    return "الخصومات تتجاوز الحد النظامي المسموح لهذه المسيرة. راجع تفاصيل الخصومات قبل الاعتماد.";\n  }`,
    `  if (message === "core_payroll:employer_loan_deduction_cap_exceeded") {\n    return "تعذر الاعتماد: قسط أو استقطاع سلفة جهة العمل يتجاوز الحد النظامي البالغ 10% من أجر الاستحقاق لهذه المسيرة. راجع أقساط السلفة أو أجّل القسط ثم أعد الاعتماد.";\n  }\n  if (message === "core_payroll:aggregate_deduction_cap_exceeded") {\n    return "تعذر الاعتماد: إجمالي الخصومات المحمية يتجاوز الحد النظامي الإجمالي المسموح لهذه المسيرة. راجع تفاصيل الخصومات قبل الاعتماد.";\n  }\n  if (message === "core_payroll:judicial_deduction_cap_exceeded") {\n    return "تعذر الاعتماد: يوجد استقطاع قضائي يتجاوز الحد المسموح حسب أمر التنفيذ المسجل. راجع مبلغ الاستقطاع ومرجع الأمر القضائي.";\n  }`,
    "precise payroll deduction reasons",
  ],
  [
    `      setPayrollRowFeedback({\n        employeeId: saved.employeeId,\n        payrollMonth: saved.payrollMonth,\n        tone: "success",\n        message: \`تم تسجيل اعتماد \${saved.employeeName} بأثر فعلي بتاريخ \${lateApproval.approvalDate}. وقت تسجيل العملية الحالي محفوظ في سجل التدقيق.\`,\n      });`,
    `      setPayrollRowFeedback({\n        employeeId: saved.employeeId,\n        payrollMonth: saved.payrollMonth,\n        tone: "success",\n        title: "تم تسجيل الاعتماد المتأخر",\n        message: \`تم تسجيل اعتماد \${saved.employeeName} بأثر فعلي بتاريخ \${lateApproval.approvalDate}. وقت تسجيل العملية الحالي محفوظ في سجل التدقيق.\`,\n      });`,
    "late approval row title",
  ],
  [
    `    if (!approvalReadiness.ready) {\n      setError(approvalReadiness.message);\n      return;\n    }\n\n    setBusy(\`approve:\${entry.employeeId}\`);\n    try {`,
    `    if (!approvalReadiness.ready) {\n      setPayrollRowFeedback({\n        employeeId: entry.employeeId,\n        payrollMonth: entry.payrollMonth,\n        tone: "danger",\n        title: "تعذر اعتماد الراتب",\n        message: approvalReadiness.message,\n      });\n      return;\n    }\n\n    setPayrollRowFeedback((current) =>\n      current?.employeeId === entry.employeeId && current.payrollMonth === entry.payrollMonth\n        ? null\n        : current\n    );\n    setBusy(\`approve:\${entry.employeeId}\`);\n    try {`,
    "approve readiness contextual",
  ],
  [
    `      if (payrollMoney.isPartial) {\n        setApprovalConfirmation({\n          entry: approvalEntry,\n          expectedNetHalalas: payrollMoney.expectedNetHalalas,\n        });\n        return;\n      }\n      const saved = await approvePayrollEntry(approvalEntry);\n      setEntries((current) => replaceEntry(current, saved));\n      setMessage("تم اعتماد الراتب.");\n    } catch (actionError: any) {\n      setError(payrollActionErrorMessage(actionError, "تعذر اعتماد الراتب."));\n    } finally {`,
    `      if (payrollMoney.isPartial) {\n        setApprovalConfirmationError("");\n        setApprovalConfirmation({\n          entry: approvalEntry,\n          expectedNetHalalas: payrollMoney.expectedNetHalalas,\n        });\n        return;\n      }\n      const saved = await approvePayrollEntry(approvalEntry);\n      setEntries((current) => replaceEntry(current, saved));\n      setPayrollRowFeedback({\n        employeeId: saved.employeeId,\n        payrollMonth: saved.payrollMonth,\n        tone: "success",\n        title: "تم اعتماد الراتب",\n        message: \`تم اعتماد مسيرة \${saved.employeeName} بنجاح.\`,\n      });\n    } catch (actionError: any) {\n      setPayrollRowFeedback({\n        employeeId: entry.employeeId,\n        payrollMonth: entry.payrollMonth,\n        tone: "danger",\n        title: "تعذر اعتماد الراتب",\n        message: payrollActionErrorMessage(actionError, "تعذر اعتماد الراتب."),\n      });\n    } finally {`,
    "approve result contextual",
  ],
  [
    `    const entry = approvalConfirmation.entry;\n    setBusy(\`approve:\${entry.employeeId}\`);\n    setError("");\n    try {\n      const saved = await approvePayrollEntry(entry);\n      setEntries((current) => replaceEntry(current, saved));\n      setSelectedEntry((current) =>\n        current?.employeeId === saved.employeeId ? saved : current\n      );\n      setApprovalConfirmation(null);\n      setMessage("تم اعتماد الراتب.");\n    } catch (actionError: any) {\n      setError(payrollActionErrorMessage(actionError, "تعذر اعتماد الراتب."));\n    } finally {`,
    `    const entry = approvalConfirmation.entry;\n    setBusy(\`approve:\${entry.employeeId}\`);\n    setApprovalConfirmationError("");\n    try {\n      const saved = await approvePayrollEntry(entry);\n      setEntries((current) => replaceEntry(current, saved));\n      setSelectedEntry((current) =>\n        current?.employeeId === saved.employeeId ? saved : current\n      );\n      setApprovalConfirmation(null);\n      setApprovalConfirmationError("");\n      setPayrollRowFeedback({\n        employeeId: saved.employeeId,\n        payrollMonth: saved.payrollMonth,\n        tone: "success",\n        title: "تم اعتماد الراتب",\n        message: \`تم اعتماد مسيرة \${saved.employeeName} بنجاح.\`,\n      });\n    } catch (actionError: any) {\n      setApprovalConfirmationError(\n        payrollActionErrorMessage(actionError, "تعذر اعتماد الراتب.")\n      );\n    } finally {`,
    "approval confirmation contextual error",
  ],
  [
    `                        title="تم تسجيل الاعتماد المتأخر"\n                        description={payrollRowFeedback.message}`,
    `                        title={payrollRowFeedback.title}\n                        description={payrollRowFeedback.message}`,
    "row feedback dynamic title",
  ],
  [
    `            <footer>\n              <button type="button" onClick={() => setApprovalConfirmation(null)}>`,
    `            {approvalConfirmationError ? (\n              <DashboardActionFeedbackV2\n                revealOnMount\n                focusOnMount\n                tone="danger"\n                title="تعذر اعتماد الراتب"\n                description={approvalConfirmationError}\n              />\n            ) : null}\n\n            <footer>\n              <button type="button" onClick={() => { setApprovalConfirmation(null); setApprovalConfirmationError(""); }}>`,
    "approval modal feedback",
  ],
]);

// 3) Employee create/edit: keep failure in the employee editor instead of a top toast.
patch("src/pages/dashboardEmployees/EmployeeEditorModal.tsx", [
  [
    `  DashboardFieldV2,\n  DashboardModalV2,`,
    `  DashboardActionFeedbackV2,\n  DashboardFieldV2,\n  DashboardModalV2,`,
    "employee action feedback import",
  ],
  [
    `  saving: boolean;\n  editId: string | null;`,
    `  saving: boolean;\n  actionError?: string;\n  editId: string | null;`,
    "employee modal action error prop",
  ],
  [
    `  saving,\n  editId,`,
    `  saving,\n  actionError = "",\n  editId,`,
    "employee modal action error destructure",
  ],
  [
    `        ) : null}\n      </fieldset>`,
    `        ) : null}\n\n        {actionError ? (\n          <DashboardActionFeedbackV2\n            revealOnMount\n            focusOnMount\n            tone="danger"\n            title={t("تعذر إكمال العملية")}\n            description={t(actionError)}\n            className="employees-v2-editor__action-feedback"\n          />\n        ) : null}\n      </fieldset>`,
    "employee modal contextual error",
  ],
]);

patch("src/pages/DashboardEmployees.tsx", [
  [
    `  useEffect(() => {\n    if (!errorMsg) return;\n\n    pushToast({`,
    `  useEffect(() => {\n    if (!errorMsg || isOpen) return;\n\n    pushToast({`,
    "employee toast suppressed while editor open",
  ],
  [
    `  }, [errorMsg, pushToast, t]);`,
    `  }, [errorMsg, isOpen, pushToast, t]);`,
    "employee toast dependencies",
  ],
  [
    `              saving={saving}\n              editId={editId}`,
    `              saving={saving}\n              actionError={isOpen ? errorMsg : ""}\n              editId={editId}`,
    "employee editor error prop",
  ],
]);

// 4) Dashboard refresh already has an inline refreshWarning; remove the duplicate native alert.
patch("src/pages/Dashboard.tsx", [
  [
    `      if (!options?.silent && !hasDashboardDataRef.current) {\n        alert(\`❌ Dashboard Refresh Failed\\\nstep: \${step}\\\ncode: \${code}\\\nmsg: \${msg}\`);\n      }`,
    `      // refreshWarning above is the contextual user-facing failure.\n      // Do not duplicate it with a native browser alert.`,
    "dashboard refresh native alert",
  ],
]);

// 5) Employee portal: partial success must still explain the attachment failure in-app.
patch("src/pages/hr/EmployeeRequests.tsx", [
  [
    `  onCreated: (request: EmployeeRequest) => void;`,
    `  onCreated: (request: EmployeeRequest, warning?: string) => void;`,
    "request created callback warning",
  ],
  [
    `      if (attachment) {\n        try {`,
    `      let creationWarning = "";\n      if (attachment) {\n        try {`,
    "request attachment warning variable",
  ],
  [
    `        } catch (uploadError) {\n          window.alert(\`${pick(language, "تم إنشاء الطلب", "Request created")} \${request.request_number}, \${pick(language, "لكن تعذر رفع المرفق", "but the attachment could not be uploaded")}: \${language === "ar" ? String((uploadError as Error)?.message || "خطأ غير معروف") : "Unknown error"}\`);\n        }\n      }\n      onCreated(request);`,
    `        } catch (uploadError) {\n          const reason = String((uploadError as Error)?.message || pick(language, "خطأ غير معروف", "Unknown error"));\n          creationWarning = \`${pick(language, "تم إنشاء الطلب", "Request created")} \${request.request_number}، \${pick(language, "لكن لم يكتمل رفع المرفق", "but the attachment upload did not complete")}: \${reason}\`;\n        }\n      }\n      onCreated(request, creationWarning || undefined);`,
    "request attachment contextual warning",
  ],
  [
    `  const [success, setSuccess] = useState<EmployeeRequest | null>(null);`,
    `  const [success, setSuccess] = useState<EmployeeRequest | null>(null);\n  const [successWarning, setSuccessWarning] = useState("");`,
    "request success warning state",
  ],
  [
    `onCreated={(request) => { setSuccess(request); closeForm(); void load(); void onPortalChange?.(); }}`,
    `onCreated={(request, warning) => { setSuccess(request); setSuccessWarning(warning || ""); closeForm(); void load(); void onPortalChange?.(); }}`,
    "request created warning capture",
  ],
  [
    `<p>{requestTypeLabel(success.request_type, language)}</p><span>{requestStatusLabel(success.status, language)} • {formatDateTime(success.submitted_at, language)}</span><div><button type="button" onClick={() => setSuccess(null)}>` ,
    `<p>{requestTypeLabel(success.request_type, language)}</p><span>{requestStatusLabel(success.status, language)} • {formatDateTime(success.submitted_at, language)}</span>{successWarning ? <div className="employee-request-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {successWarning}</div> : null}<div><button type="button" onClick={() => { setSuccess(null); setSuccessWarning(""); }}>`,
    "request success dialog warning",
  ],
]);

// 6) Employee workspace: blocked booking visibility explains itself next to the control.
patch("src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceCoreTabsLiveV2.tsx", [
  [
    `  DashboardDatePickerV2,\n  DashboardFieldV2,`,
    `  DashboardActionFeedbackV2,\n  DashboardDatePickerV2,\n  DashboardFieldV2,`,
    "workspace action feedback import",
  ],
  [
    `  const completeness = [name.trim(), weeklyOffLabel.trim()].filter(Boolean).length === 2 ? 100 : 75;`,
    `  const completeness = [name.trim(), weeklyOffLabel.trim()].filter(Boolean).length === 2 ? 100 : 75;\n  const [bookingVisibilityError, setBookingVisibilityError] = useState("");`,
    "workspace booking visibility state",
  ],
  [
    `                if (value && ["inactive","disabled","offboarded","archived","suspended"].includes(status)) {\n                  window.alert(t("الحساب غير نشط. فعّل حالة الحساب أولاً ثم أعد تفعيل الظهور في صفحة الحجز."));\n                  return;\n                }\n                onShowOnBookingChange(value);`,
    `                if (value && ["inactive","disabled","offboarded","archived","suspended"].includes(status)) {\n                  setBookingVisibilityError(t("الحساب غير نشط. فعّل حالة الحساب أولاً ثم أعد تفعيل الظهور في صفحة الحجز."));\n                  return;\n                }\n                setBookingVisibilityError("");\n                onShowOnBookingChange(value);`,
    "workspace blocked action feedback",
  ],
  [
    `          </div>\n\n          {!showOnBooking ? (`,
    `          </div>\n\n          {bookingVisibilityError ? (\n            <DashboardActionFeedbackV2\n              compact\n              revealOnMount\n              tone="danger"\n              title={t("تعذر تفعيل الظهور في الحجز")}\n              description={bookingVisibilityError}\n            />\n          ) : null}\n\n          {!showOnBooking ? (`,
    "workspace inline action feedback",
  ],
]);

console.log("Applied dashboard-wide contextual action feedback system patches.");
