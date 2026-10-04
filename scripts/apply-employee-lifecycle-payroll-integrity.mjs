import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const write = (file, content) => fs.writeFileSync(path.join(root, file), content);

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`Missing anchor: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`Ambiguous anchor: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

// Core ID aliases are one shared primitive, not repository-local knowledge.
{
  const file = "workers/core/d1.js";
  let source = read(file);
  source = replaceOnce(
    source,
    "function legacyEncodedIdCandidates(value) {",
    "export function canonicalIdCandidates(value) {",
    "export canonical id candidates",
  );
  source = source.replace(/legacyEncodedIdCandidates\(/g, "canonicalIdCandidates(");
  write(file, source);
}

// Payroll reads and compliance preflight use canonical employee identity.
{
  const file = "workers/core/repositories/payroll.js";
  let source = read(file);
  source = replaceOnce(
    source,
    "  nowIso,\n  optionalText,\n  requiredId,",
    "  nowIso,\n  optionalText,\n  normalizeId,\n  requiredId,",
    "payroll normalizeId import",
  );
  source = replaceOnce(
    source,
    "  calculateFixedActualWageHalalas,\n  calculateMonthlyDailyWageHalalas,",
    "  calculateFixedActualWageHalalas,\n  employerLoanDeductionCapHalalas,\n  calculateMonthlyDailyWageHalalas,",
    "payroll employer loan cap import",
  );

  source = replaceOnce(
    source,
    `export async function listPayrollEntries(db, salonId, query = {}) {
  let rows = await dbAll(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? ORDER BY payroll_month DESC, employee_id LIMIT 2000', [salonId]);
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  const status = cleanText(query.status);
  if (employeeId) rows = rows.filter((row) => row.employee_id === employeeId);
  if (payrollMonth) rows = rows.filter((row) => row.payroll_month === payrollMonth);
  if (status) rows = rows.filter((row) => cleanText(row.status || 'draft') === status);
  return rows;
}`,
    `export async function listPayrollEntries(db, salonId, query = {}) {
  let rows = await dbAll(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? ORDER BY payroll_month DESC, employee_id LIMIT 2000', [salonId]);
  const employeeId = normalizeId(query.employeeId || query.employee_id);
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  const status = cleanText(query.status);
  if (employeeId) rows = rows.filter((row) => normalizeId(row.employee_id) === employeeId);
  if (payrollMonth) rows = rows.filter((row) => row.payroll_month === payrollMonth);
  if (status) rows = rows.filter((row) => cleanText(row.status || 'draft') === status);
  return rows.map((row) => ({ ...row, employee_id: normalizeId(row.employee_id) }));
}`,
    "canonical payroll entry list",
  );

  source = replaceOnce(
    source,
    `export async function listPayrollAdvanceDeductions(db, salonId, query = {}) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  const rows = await dbAll(
    db,
    \`SELECT sa.employee_id, sai.payroll_month,
            COALESCE(SUM(sai.amount_halalas), 0) AS amount_halalas
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sai.status IN ('scheduled', 'deducted')
      GROUP BY sa.employee_id, sai.payroll_month
      ORDER BY sai.payroll_month, sa.employee_id\`,
    [salonId]
  );
  return rows.filter((row) =>
    (!employeeId || cleanText(row.employee_id) === employeeId) &&
    (!payrollMonth || cleanText(row.payroll_month) === payrollMonth)
  );
}`,
    `export async function listPayrollAdvanceDeductions(db, salonId, query = {}) {
  const employeeId = normalizeId(query.employeeId || query.employee_id);
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  const rows = await dbAll(
    db,
    \`SELECT sa.employee_id, sai.payroll_month,
            COALESCE(SUM(sai.amount_halalas), 0) AS amount_halalas
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sai.status IN ('scheduled', 'deducted')
      GROUP BY sa.employee_id, sai.payroll_month
      ORDER BY sai.payroll_month, sa.employee_id\`,
    [salonId]
  );

  const grouped = new Map();
  for (const row of rows) {
    const canonicalEmployeeId = normalizeId(row.employee_id);
    const canonicalPayrollMonth = cleanText(row.payroll_month);
    if (!canonicalEmployeeId || !canonicalPayrollMonth) continue;
    const key = \`${'${canonicalEmployeeId}'}|${'${canonicalPayrollMonth}'}\`;
    const current = grouped.get(key) || {
      employee_id: canonicalEmployeeId,
      payroll_month: canonicalPayrollMonth,
      amount_halalas: 0,
    };
    current.amount_halalas += Math.max(0, Number(row.amount_halalas || 0) || 0);
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).filter((row) =>
    (!employeeId || row.employee_id === employeeId) &&
    (!payrollMonth || row.payroll_month === payrollMonth)
  );
}`,
    "canonical salary advance totals",
  );

  source = replaceOnce(
    source,
    `  const canonicalDeferrableDeductionsHalalas =
    authority.absenceDeductionHalalas +
    authority.missingHoursDeductionHalalas +
    canonicalDeferrableManualDeductionsHalalas +
    canonicalAdvanceHalalas;`,
    `  // Salary-advance installments own their own immutable rescheduling ledger.
  // A generic payroll deduction deferral must never pretend to defer an advance
  // while leaving salary_advance_installments unchanged.
  const canonicalDeferrableDeductionsHalalas =
    authority.absenceDeductionHalalas +
    authority.missingHoursDeductionHalalas +
    canonicalDeferrableManualDeductionsHalalas;`,
    "exclude salary advances from generic deferral",
  );

  source = replaceOnce(
    source,
    `function assertPayrollSetupComplete(row, attendancePayrollMode = 'required') {
  const missing = payrollSetupMissing(row, attendancePayrollMode);
  if (missing.length) {
    throw new AppError(409, 'core_payroll:setup_incomplete');
  }
}`,
    `function assertPayrollSetupComplete(row, attendancePayrollMode = 'required') {
  const missing = payrollSetupMissing(row, attendancePayrollMode);
  if (missing.length) {
    throw new AppError(409, 'core_payroll:setup_incomplete');
  }
}

function assertCanonicalSalaryAdvanceCap(row) {
  const capBaseHalalas = Math.max(
    0,
    Number(row?.gross_salary_halalas || 0) -
      Number(row?.absence_deduction_halalas || 0) -
      Number(row?.missing_hours_deduction_halalas || 0)
  );
  const advanceHalalas = Math.max(0, Number(row?.advances_halalas || 0));
  const capHalalas = employerLoanDeductionCapHalalas(capBaseHalalas);
  if (advanceHalalas > capHalalas) {
    throw new AppError(
      409,
      'core_payroll:employer_loan_deduction_cap_exceeded',
      'core_payroll:employer_loan_deduction_cap_exceeded',
      {
        employeeId: normalizeId(row?.employee_id),
        payrollMonth: cleanText(row?.payroll_month),
        advanceHalalas,
        capBaseHalalas,
        capHalalas,
        excessHalalas: advanceHalalas - capHalalas,
      }
    );
  }
}`,
    "salary advance compliance preflight helper",
  );

  source = replaceOnce(
    source,
    `  assertPayrollSetupComplete(row, effectiveMode);

  const attendanceReadiness =`,
    `  assertPayrollSetupComplete(row, effectiveMode);
  assertCanonicalSalaryAdvanceCap(row);

  const attendanceReadiness =`,
    "salary advance compliance preflight",
  );

  write(file, source);
}

// Salary-advance installment lookup accepts canonical and historical aliases.
{
  const file = "workers/core/repositories/salary-advance-deferrals.js";
  let source = read(file);
  source = replaceOnce(
    source,
    "  cleanText,\n  dbAll,",
    "  canonicalIdCandidates,\n  cleanText,\n  dbAll,",
    "salary advance canonical candidates import",
  );
  source = replaceOnce(
    source,
    "  optionalText,\n  requiredId,",
    "  optionalText,\n  placeholders,\n  requiredId,\n  normalizeId,",
    "salary advance placeholders import",
  );
  source = replaceOnce(
    source,
    `  const params = [salonId, employeeId];
  let payrollMonthClause = '';
  if (payrollMonth) {
    payrollMonthClause = ' AND sai.payroll_month = ?';
    params.push(payrollMonth);
  }

  const rows = await dbAll(
    db,
    \`SELECT sai.*,
            sa.employee_id,
            sa.payment_status,
            sa.first_deduction_month
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sa.employee_id = ?${'${payrollMonthClause}'}
      ORDER BY sai.payroll_month, sai.installment_number, sai.id\`,
    params
  );

  return rows.map((row) => ({
    ...installmentDto(row),
    employeeId: row.employee_id,`,
    `  const employeeIds = canonicalIdCandidates(employeeId);
  const params = [salonId, ...employeeIds];
  let payrollMonthClause = '';
  if (payrollMonth) {
    payrollMonthClause = ' AND sai.payroll_month = ?';
    params.push(payrollMonth);
  }

  const rows = await dbAll(
    db,
    \`SELECT sai.*,
            sa.employee_id,
            sa.payment_status,
            sa.first_deduction_month
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sa.employee_id IN (${'${placeholders(employeeIds.length)}'})${'${payrollMonthClause}'}
      ORDER BY sai.payroll_month, sai.installment_number, sai.id\`,
    params
  );

  return rows.map((row) => ({
    ...installmentDto(row),
    employeeId: normalizeId(row.employee_id),`,
    "salary advance alias lookup",
  );
  source = replaceOnce(
    source,
    "  const employeeId = cleanText(query.employeeId || query.employee_id);\n  const sourcePayrollMonth = cleanText(",
    "  const employeeId = normalizeId(query.employeeId || query.employee_id);\n  const sourcePayrollMonth = cleanText(",
    "canonical partial deferral list employee id",
  );
  write(file, source);
}

// Employee request identity and salary-advance execution use canonical rules.
{
  const file = "workers/core/repositories/employee-requests-legacy.js";
  let source = read(file);
  source = replaceOnce(
    source,
    "  nowIso,\n  optionalText,",
    "  nowIso,\n  normalizeId,\n  optionalText,",
    "employee request normalizeId import",
  );
  source = replaceOnce(
    source,
    `async function resolveEmployee(db, salonId, actor, data = {}) {
  const requestedEmployeeId = cleanText(data.employeeId || data.employee_id || actor.employeeId);
  const requestedUid = cleanText(data.employeeUid || data.employee_uid || actor.uid);
  const row = await dbFirst(
    db,
    \`SELECT id, firebase_uid, name, email FROM employee_profiles
      WHERE salon_id = ? AND (id = ? OR firebase_uid = ? OR firebase_uid = ?) LIMIT 1\`,
    [salonId, requestedEmployeeId, requestedEmployeeId, requestedUid]
  );
  const employeeId = cleanText(row?.id || requestedEmployeeId);`,
    `async function resolveEmployee(db, salonId, actor, data = {}) {
  const requestedEmployeeId = normalizeId(data.employeeId || data.employee_id || actor.employeeId);
  const requestedUid = cleanText(data.employeeUid || data.employee_uid || actor.uid);
  let row = requestedEmployeeId
    ? await dbFirst(
        db,
        'SELECT id, firebase_uid, name, email FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1',
        [salonId, requestedEmployeeId]
      )
    : null;
  if (!row && (requestedUid || requestedEmployeeId)) {
    row = await dbFirst(
      db,
      'SELECT id, firebase_uid, name, email FROM employee_profiles WHERE salon_id = ? AND firebase_uid IN (?, ?) LIMIT 1',
      [salonId, requestedUid || '', requestedEmployeeId || '']
    );
  }
  const employeeId = normalizeId(row?.id || requestedEmployeeId);`,
    "canonical employee request identity resolution",
  );
  source = replaceOnce(
    source,
    `function assertOwner(row, actor) {
  const sameUid = cleanText(row.employee_uid) && cleanText(row.employee_uid) === cleanText(actor.uid);
  const sameEmployee = cleanText(row.employee_id) && cleanText(row.employee_id) === cleanText(actor.employeeId);`,
    `function assertOwner(row, actor) {
  const sameUid = cleanText(row.employee_uid) && cleanText(row.employee_uid) === cleanText(actor.uid);
  const sameEmployee = normalizeId(row.employee_id) && normalizeId(row.employee_id) === normalizeId(actor.employeeId);`,
    "canonical request owner comparison",
  );
  source = replaceOnce(
    source,
    "    const employeeId = cleanText(query.employeeId || query.employee_id);\n    if (employeeId) { clauses.push('employee_id = ?'); params.push(employeeId); }",
    "    const employeeId = normalizeId(query.employeeId || query.employee_id);\n    if (employeeId) { clauses.push('employee_id = ?'); params.push(employeeId); }",
    "canonical request employee filter",
  );
  write(file, source);
}

{
  const file = "workers/core/repositories/employee-requests.js";
  let source = read(file);
  source = replaceOnce(
    source,
    "import { AppError } from '../errors.js';\n",
    "import { AppError } from '../errors.js';\nimport { calculateFixedActualWageHalalas, employerLoanDeductionCapHalalas } from '../../../src/helpers/hr/saLaborPolicy.js';\n",
    "salary advance statutory helper import",
  );
  source = replaceOnce(
    source,
    `function assertSalaryCertificateApproval(input = {}) {`,
    `async function assertSalaryAdvanceSchedulePossible(db, salonId, employeeId, payload, input) {
  const employment = await dbFirst(
    db,
    \`SELECT base_salary_halalas, housing_allowance_halalas,
            transportation_allowance_halalas, other_allowances_halalas
       FROM employee_employment
      WHERE salon_id = ? AND employee_id = ? LIMIT 1\`,
    [salonId, employeeId]
  );
  if (!employment) {
    throw new AppError(409, 'core_employee_request:employee_salary_required');
  }

  const fixedActualWageHalalas = calculateFixedActualWageHalalas({
    baseSalaryHalalas: employment.base_salary_halalas,
    housingAllowanceHalalas: employment.housing_allowance_halalas,
    transportationAllowanceHalalas: employment.transportation_allowance_halalas,
    otherAllowancesHalalas: employment.other_allowances_halalas,
  });
  const capHalalas = employerLoanDeductionCapHalalas(fixedActualWageHalalas);
  const installmentCount = payload.repaymentMethod === 'installments'
    ? Number(payload.installmentCount || 0)
    : 1;
  const approvedHalalas = Number(input.approvedHalalas || 0);
  const largestInstallmentHalalas = installmentCount > 0
    ? Math.ceil(approvedHalalas / installmentCount)
    : approvedHalalas;

  if (capHalalas <= 0 || largestInstallmentHalalas > capHalalas) {
    const minimumInstallmentCount = capHalalas > 0
      ? Math.ceil(approvedHalalas / capHalalas)
      : null;
    throw new AppError(
      409,
      'core_employee_request:salary_advance_installment_cap_exceeded',
      'core_employee_request:salary_advance_installment_cap_exceeded',
      {
        approvedHalalas,
        installmentCount,
        largestInstallmentHalalas,
        fixedActualWageHalalas,
        capHalalas,
        minimumInstallmentCount,
      }
    );
  }
}

function assertSalaryCertificateApproval(input = {}) {`,
    "salary advance statutory schedule guard",
  );
  source = replaceOnce(
    source,
    `    input = normalizeSalaryAdvanceExecution(
      parsePayload(row.payload_json),
      input
    );`,
    `    const salaryAdvancePayload = parsePayload(row.payload_json);
    input = normalizeSalaryAdvanceExecution(
      salaryAdvancePayload,
      input
    );
    await assertSalaryAdvanceSchedulePossible(
      db,
      salonId,
      row.employee_id,
      salaryAdvancePayload,
      input
    );`,
    "salary advance schedule validation call",
  );
  source = replaceOnce(
    source,
    "    `SELECT request_type, status, source_reference_id, payload_json\n",
    "    `SELECT request_type, status, source_reference_id, payload_json, employee_id\n",
    "employee request transition employee id select",
  );
  write(file, source);
}

// Frontend Core HR boundary normalizes payroll and salary-advance employee ids.
{
  const file = "src/services/CoreHrService.ts";
  let source = read(file);
  source = replaceOnce(
    source,
    `  async listPayrollAdvanceDeductions(
    query: { employeeId?: string; payrollMonth?: string } = {}
  ) {`,
    `  async listPayrollAdvanceDeductions(
    query: { employeeId?: string; payrollMonth?: string } = {}
  ) {
    query = {
      ...query,
      ...(query.employeeId
        ? { employeeId: normalizeEmployeeIdentityId(query.employeeId) }
        : {}),
    };`,
    "CoreHr payroll advance query normalization",
  );
  source = replaceOnce(
    source,
    `  async listSalaryAdvanceInstallments(
    query: { employeeId: string; payrollMonth?: string }
  ) {`,
    `  async listSalaryAdvanceInstallments(
    query: { employeeId: string; payrollMonth?: string }
  ) {
    query = {
      ...query,
      employeeId: normalizeEmployeeIdentityId(query.employeeId),
    };`,
    "CoreHr salary advance installment query normalization",
  );
  write(file, source);
}

// Give the current legal block a specific, actionable message now; contextual
// placement remains owned by the separate dashboard feedback work.
{
  const file = "src/services/coreApiClient.ts";
  let source = read(file);
  source = replaceOnce(
    source,
    `  "core_payroll:deduction_amount_required": "اكتب مبلغًا أكبر من صفر.",`,
    `  "core_payroll:deduction_amount_required": "اكتب مبلغًا أكبر من صفر.",
  "core_payroll:employer_loan_deduction_cap_exceeded": "قسط أو استقطاع سلفة جهة العمل يتجاوز الحد النظامي البالغ 10% من الأجر المستحق لهذا الشهر. أجّل قسط السلفة أو عدّل جدول السلفة قبل الاعتماد.",
  "core_employee_request:salary_advance_installment_cap_exceeded": "جدول أقساط السلفة يتجاوز حد الاستقطاع النظامي 10%. زِد عدد الأقساط أو خفّض المبلغ المعتمد.",`,
    "specific salary advance compliance messages",
  );
  write(file, source);
}

console.log("Unified employee payroll integrity transformation applied.");
