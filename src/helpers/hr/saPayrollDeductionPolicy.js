import {
  SA_LABOR_LIMITS,
} from './saLaborPolicy.js';

export const SA_PAYROLL_DEDUCTION_POLICY_VERSION =
  'sa-labor-deductions-articles-92-94-v1';

export const SA_PAYROLL_DEDUCTION_CLASSES = Object.freeze({
  employerLoan: 'employer_loan',
  judicialDebt: 'judicial_debt',
  thriftFund: 'thrift_fund',
  housingOrBenefitInstallment: 'housing_or_benefit_installment',
  disciplinaryFine: 'disciplinary_fine',
  damageRecovery: 'damage_recovery',
  otherWithWrittenConsent: 'other_with_written_consent',
  deferredTimeNotWorkedAdjustment: 'deferred_time_not_worked_adjustment',
  socialInsurance: 'social_insurance',
  hrReviewRequired: 'hr_review_required',
});

const USER_CLASSIFIABLE = new Set([
  SA_PAYROLL_DEDUCTION_CLASSES.employerLoan,
  SA_PAYROLL_DEDUCTION_CLASSES.judicialDebt,
  SA_PAYROLL_DEDUCTION_CLASSES.thriftFund,
  SA_PAYROLL_DEDUCTION_CLASSES.housingOrBenefitInstallment,
  SA_PAYROLL_DEDUCTION_CLASSES.disciplinaryFine,
  SA_PAYROLL_DEDUCTION_CLASSES.damageRecovery,
  SA_PAYROLL_DEDUCTION_CLASSES.otherWithWrittenConsent,
]);

function money(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0
    ? Math.round(number)
    : 0;
}

function text(value) {
  return String(value ?? '').trim();
}

function bps(value, fallback) {
  const number = Math.round(Number(value ?? fallback));
  return Number.isFinite(number) && number > 0 && number <= 10000
    ? number
    : fallback;
}

export function normalizeSaPayrollDeductionClass(value) {
  const normalized = text(value).toLowerCase();
  return Object.values(SA_PAYROLL_DEDUCTION_CLASSES).includes(normalized)
    ? normalized
    : SA_PAYROLL_DEDUCTION_CLASSES.hrReviewRequired;
}

export function isUserClassifiableSaPayrollDeduction(value) {
  return USER_CLASSIFIABLE.has(normalizeSaPayrollDeductionClass(value));
}

function normalizedItem(raw = {}, trusted = false) {
  return {
    id: text(raw.id || raw.sourceId || raw.source_id) || null,
    amountHalalas: money(raw.amountHalalas ?? raw.amount_halalas ?? raw.amount),
    deductionClass: normalizeSaPayrollDeductionClass(
      raw.laborDeductionClass ?? raw.labor_deduction_class ?? raw.deductionClass
    ),
    trusted,
    sourceType: text(raw.sourceType ?? raw.source_type),
    sourceRef: text(raw.sourceRef ?? raw.source_ref),
    writtenConsentReference: text(
      raw.writtenConsentReference ?? raw.written_consent_reference
    ),
    courtOrderReference: text(
      raw.courtOrderReference ?? raw.court_order_reference
    ),
    evidenceReference: text(
      raw.evidenceReference ?? raw.evidence_reference
    ),
    judicialMonthlyCapBps: bps(
      raw.judicialMonthlyCapBps ?? raw.judicial_monthly_cap_bps,
      SA_LABOR_LIMITS.courtOrderDefaultDeductionCapBps
    ),
  };
}

export function evaluateSaPayrollDeductionCompliance(input = {}) {
  const capBaseHalalas = money(input.capBaseHalalas ?? input.wageDueHalalas);
  const insuranceDeductionHalalas = money(input.insuranceDeductionHalalas);
  const salaryAdvanceDeductionHalalas = money(input.salaryAdvanceDeductionHalalas);
  const items = [
    ...(Array.isArray(input.items) ? input.items : []).map((item) =>
      normalizedItem(item, Boolean(item?.trusted))
    ),
  ].filter((item) => item.amountHalalas > 0);

  const issues = [];
  if (capBaseHalalas <= 0) {
    issues.push({ code: 'deduction_cap_base_required', severity: 'blocking' });
  }

  let totalProtectedHalalas =
    insuranceDeductionHalalas + salaryAdvanceDeductionHalalas;
  let employerLoanHalalas = salaryAdvanceDeductionHalalas;
  let judicialDebtHalalas = 0;

  for (const item of items) {
    totalProtectedHalalas += item.amountHalalas;

    if (
      item.deductionClass === SA_PAYROLL_DEDUCTION_CLASSES.hrReviewRequired
    ) {
      issues.push({
        code: 'deduction_legal_class_required',
        severity: 'blocking',
        itemId: item.id,
      });
      continue;
    }

    if (
      !item.trusted &&
      [
        SA_PAYROLL_DEDUCTION_CLASSES.socialInsurance,
        SA_PAYROLL_DEDUCTION_CLASSES.deferredTimeNotWorkedAdjustment,
      ].includes(item.deductionClass)
    ) {
      issues.push({
        code: 'reserved_deduction_class_requires_canonical_source',
        severity: 'blocking',
        itemId: item.id,
      });
      continue;
    }

    switch (item.deductionClass) {
      case SA_PAYROLL_DEDUCTION_CLASSES.employerLoan:
        employerLoanHalalas += item.amountHalalas;
        if (!item.evidenceReference && !item.sourceRef) {
          issues.push({
            code: 'employer_loan_reference_required',
            severity: 'blocking',
            itemId: item.id,
          });
        }
        break;

      case SA_PAYROLL_DEDUCTION_CLASSES.judicialDebt: {
        judicialDebtHalalas += item.amountHalalas;
        if (!item.courtOrderReference) {
          issues.push({
            code: 'court_order_reference_required',
            severity: 'blocking',
            itemId: item.id,
          });
          break;
        }
        const itemCap = Math.floor(
          capBaseHalalas * item.judicialMonthlyCapBps / 10000
        );
        if (item.amountHalalas > itemCap) {
          issues.push({
            code: 'judicial_deduction_cap_exceeded',
            severity: 'blocking',
            itemId: item.id,
            capHalalas: itemCap,
          });
        }
        break;
      }

      case SA_PAYROLL_DEDUCTION_CLASSES.otherWithWrittenConsent:
        if (!item.writtenConsentReference) {
          issues.push({
            code: 'written_consent_reference_required',
            severity: 'blocking',
            itemId: item.id,
          });
        }
        break;

      case SA_PAYROLL_DEDUCTION_CLASSES.thriftFund:
      case SA_PAYROLL_DEDUCTION_CLASSES.housingOrBenefitInstallment:
      case SA_PAYROLL_DEDUCTION_CLASSES.disciplinaryFine:
      case SA_PAYROLL_DEDUCTION_CLASSES.damageRecovery:
        if (!item.evidenceReference && !item.sourceRef) {
          issues.push({
            code: 'deduction_evidence_reference_required',
            severity: 'blocking',
            itemId: item.id,
          });
        }
        break;

      default:
        break;
    }
  }

  const employerLoanCapHalalas = Math.floor(
    capBaseHalalas * SA_LABOR_LIMITS.employerLoanDeductionCapBps / 10000
  );
  if (employerLoanHalalas > employerLoanCapHalalas) {
    issues.push({
      code: 'employer_loan_deduction_cap_exceeded',
      severity: 'blocking',
      capHalalas: employerLoanCapHalalas,
    });
  }

  const overrideBps = bps(
    input.totalDeductionCapOverrideBps,
    SA_LABOR_LIMITS.generalDeductionCapBps
  );
  const overrideReference = text(input.totalDeductionCapOverrideReference);
  const totalCapBps = overrideBps > SA_LABOR_LIMITS.generalDeductionCapBps
    ? overrideReference
      ? overrideBps
      : SA_LABOR_LIMITS.generalDeductionCapBps
    : SA_LABOR_LIMITS.generalDeductionCapBps;

  if (
    overrideBps > SA_LABOR_LIMITS.generalDeductionCapBps &&
    !overrideReference
  ) {
    issues.push({
      code: 'labor_court_override_reference_required',
      severity: 'blocking',
    });
  }

  const totalCapHalalas = Math.floor(capBaseHalalas * totalCapBps / 10000);
  if (totalProtectedHalalas > totalCapHalalas) {
    issues.push({
      code: 'aggregate_deduction_cap_exceeded',
      severity: 'blocking',
      capHalalas: totalCapHalalas,
    });
  }

  return Object.freeze({
    policyVersion: SA_PAYROLL_DEDUCTION_POLICY_VERSION,
    compliant: issues.length === 0,
    status: issues.length === 0 ? 'compliant' : 'blocked',
    capBaseHalalas,
    insuranceDeductionHalalas,
    salaryAdvanceDeductionHalalas,
    employerLoanHalalas,
    employerLoanCapHalalas,
    judicialDebtHalalas,
    totalProtectedHalalas,
    totalCapBps,
    totalCapHalalas,
    totalDeductionCapOverrideReference: overrideReference || null,
    issues,
  });
}
