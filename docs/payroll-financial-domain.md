# Malikat Payroll Financial Domain — GOSI and Employee Deductions

## Core principles

1. Core D1 is the canonical operational source of truth.
2. No silent money: every financial amount must retain type, source, reason, original period, application period, status, actor and timestamps.
3. Approved/Paid payroll is immutable. Post-approval corrections use payroll carryover adjustments.
4. GOSI statutory deductions are separate from administrative employee deductions and cannot be deferred by the employee-deduction scheduling feature.
5. Employer GOSI contributions are employer cost and never reduce employee net salary.
6. Contract salary and GOSI contributory wage are separate concepts.

## Salary structure

Contract monthly salary is represented by:

- basic salary
- housing allowance
- transportation allowance
- other allowances

GOSI derived contributory wage uses basic salary + housing allowance by default. Transportation and other allowances are retained in payroll salary structure but are not automatically included in the GOSI derived wage. A verified override is supported and requires an explicit reason.

## Social-insurance classifications

- `saudi_existing`
- `saudi_new`
- `gcc`
- `non_saudi`

GCC intentionally does not fall through to `non_saudi`. Calculation fails with `gosi_gcc_extension_policy_required` until Extension Protection policy data is configured.

## Rates represented by the current policy module

### Saudi existing system

Employee:
- pension: 9.00%
- SANED: 0.75%

Employer:
- pension: 9.00%
- SANED: 0.75%
- occupational hazards: 2.00%

### Saudi new system — pension branch schedule

- 2024-07-03: 9.00%
- 2025-07-01: 9.50%
- 2026-07-01: 10.00%
- 2027-07-01: 10.50%
- 2028-07-01: 11.00%

SANED remains 0.75% employee + 0.75% employer. Occupational hazards remain 2.00% employer.

### Non-Saudi

Employee statutory GOSI deduction: 0.
Employer occupational hazards: 2.00%.

## Contributory-wage boundaries

- pension branch minimum: SAR 1,500
- occupational-hazards-only minimum: SAR 400
- maximum contributory wage: SAR 45,000

The snapshot stores raw and applied wage, including whether a floor or cap was applied.

## Rounding

Money is integer halalas. Rates are integer basis points. Each insurance branch is rounded to the nearest halalah using integer arithmetic; floating-point money is not used.

## Employee payroll obligations

`employee_recurring_deductions` stores recurring/fixed deductions.

Each actual amount owed is represented by `employee_payroll_obligations`, containing the original month, original amount, source, reason and remaining balance.

Collection timing is represented by `employee_payroll_obligation_installments`. Deferring a deduction does not erase its origin. Installments keep target month and audit metadata. GOSI/statutory deductions are blocked from this mechanism.

## Carryover boundary

- Before approval: an administrative deduction may be scheduled, deferred or split into installments.
- After approval: the approved payroll snapshot is immutable; corrections use `payroll_carryover_adjustments`.
