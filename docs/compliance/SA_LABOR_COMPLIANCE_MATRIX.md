# Saudi Labor Compliance Matrix

Verified against current Ministry of Human Resources and Social Development material on 2026-08-27.

This document is an engineering control matrix, not a substitute for legal advice.
Where employee-specific facts or an exception cannot be established, runtime must fail closed to HR_REVIEW_REQUIRED rather than invent a financial result.

| Domain | Canonical product rule |
| --- | --- |
| Wage identity | Basic wage is separate from actual wage and from GOSI contributory wage. |
| Monthly actual wage | Current Core derives fixed actual wage from basic + contractual fixed allowances. Variable remuneration requires an explicit policy/override before it is treated as legal actual wage. |
| Annual leave | Minimum 21 days/year; minimum 30 days after 5 continuous years. Annual leave cannot be exchanged for cash during active service. Unused entitlement is settled when employment ends. |
| Sick leave | In the statutory sick-year: days 1-30 at 100%, days 31-90 at 75%, days 91-120 unpaid. It must never debit the annual-leave balance automatically. |
| Weekly rest | At least 24 continuous hours with full pay. Weekly rest itself is not cash-substitutable. |
| Standard hours | 8 actual hours/day or 48/week under the corresponding standard. |
| Ramadan reduced hours | 6/day or 36/week for employees to whom the statutory Ramadan reduction applies. Runtime must use an explicit applicability flag and must not infer religion. |
| Daily breaks | No more than 5 continuous hours without a break of at least 30 minutes. Breaks are not actual working time. |
| Workplace presence | General maximum 12 hours/day. |
| Overtime pay | Actual hourly wage + 50% of basic hourly wage. For monthly wage examples, HRSD calculates hourly wage using monthly wage / 30 / normal daily hours. |
| Overtime annual control | 720 overtime hours/year unless the employee consents to an increase. |
| Overtime comp leave | Requires employee agreement; not less than 1.5 hours leave per overtime hour; normally used within 60 days unless otherwise agreed; not more than 30 days/year. |
| Public holidays | Eid al-Fitr 4 days, Eid al-Adha 4 days, National Day 1 day, Founding Day 1 day. Work performed during holidays is overtime. Overlap rules must be applied separately. |
| Marriage | 5 fully-paid days. |
| Death - spouse/ascendant/descendant | 5 fully-paid days. |
| Death - sibling | 3 fully-paid days. |
| Newborn | 3 fully-paid days, used within 7 days from birth. |
| Hajj | 10-15 paid days, once during service, after at least 2 continuous years, subject to statutory conditions. |
| Exams | Actual exam days; paid/unpaid/annual treatment depends on the statutory education-approval conditions. |
| Unpaid leave | By agreement. Contract is suspended for the portion exceeding 20 days unless the parties agree otherwise. |
| Maternity | 12 weeks full pay under the current amended law; 6 weeks after birth are mandatory. |
| Child requiring continuous care | 1 paid month after maternity leave, with a further month available unpaid. |
| Widow leave | Muslim employee: 4 calendar months + 10 days, with pregnancy extension rules. Non-Muslim employee: 15 paid days. |
| General deductions | Aggregate deductions are generally capped at 50% of due wage unless the statutory/court exception is established. |
| Employer loan | Default employer-loan deduction cap: 10% of wage. |
| Court debt | Default monthly cap: 25% unless the judgment states otherwise; statutory priority rules still apply. |
| Discipline | Time-not-worked deductions and disciplinary penalties are distinct. Penalties require the regulatory workflow, recurrence rules and evidence. |
| Auditability | Payroll, leave and comp-time effects must store the policy version and source facts used for calculation. |
| Historical records | Approved/paid or executed historical financial records are never silently rewritten. Corrections use reversal/adjustment records. |

## Current repository gaps confirmed

1. `employee_employment.leave_balance` is a single legacy balance.
2. The existing balance ledger is explicitly annual-leave oriented.
3. Legacy frontend policy currently marks annual, sick and emergency leave as balance-deducting.
4. `exceptional_financial_payment` was built as annual-leave cash compensation.
5. Payroll attendance rates and overtime require migration to the central Saudi Labor policy.
6. Compensatory overtime, weekly-rest entitlement and holiday-overlap entitlement do not currently have independent ledgers.
7. Compliance-blocking cases do not currently have a durable HR review queue.

## Runtime migration rule

No legacy balance or financial payment is reclassified by migration 0038.
Historical correction, including Aida's case, is a later explicit reconciliation step with reversal records and preserved audit history.