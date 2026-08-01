// CORE D1 ONLY - do not add Firestore fallback.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  integer,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import { recordAudit } from './audit.js';

const AUTOMATED_TYPES = new Set(['service_completed', 'service_refund', 'package_session', 'reversal']);
export const UNASSIGNED_TARGET_EMPLOYEE_ID = '__unassigned_employee_sales__';
export const TARGET_BONUS_SOURCE = 'employee_target_bonus';
export const TARGET_BONUS_LABEL = 'Target Achievement Bonus';

function intMoney(value, field = 'amount', { allowNegative = false } = {}) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || !Number.isInteger(number) || (!allowNegative && number < 0)) {
    throw new AppError(400, 'employee_targets:invalid_money', `${field} is invalid`);
  }
  return number;
}

function boolInt(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback ? 1 : 0;
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function jsonText(value, fallback) {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {}
  }
  return JSON.stringify(value === undefined ? fallback : value);
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(cleanText(value) || '');
    return parsed === undefined || parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function readJsonList(value) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed.map(cleanText).filter(Boolean) : [];
}

function addAlias(index, alias, employeeId) {
  const cleanAlias = cleanText(alias);
  const cleanEmployeeId = cleanText(employeeId);
  if (!cleanAlias || !cleanEmployeeId || cleanAlias === UNASSIGNED_TARGET_EMPLOYEE_ID) return;
  if (!index.aliasToEmployeeId.has(cleanAlias)) index.aliasToEmployeeId.set(cleanAlias, cleanEmployeeId);
}

function addEmployeeRecord(index, row, source) {
  const id = cleanText(row?.id);
  if (!id || index.employeesById.has(id)) {
    if (id) {
      const existing = index.employeesById.get(id);
      index.employeesById.set(id, {
        ...row,
        ...existing,
        name: existing?.name || row?.name || row?.display_name || id,
        source: existing?.source || source,
      });
    }
    return;
  }
  index.employeesById.set(id, {
    ...row,
    id,
    name: cleanText(row?.name || row?.display_name) || id,
    source,
  });
}

function targetNameKey(value) {
  return cleanText(value).replace(/\s+/g, ' ').toLowerCase();
}

export function createTargetIdentityIndex({ employeeProfiles = [], staffRows = [], appUsers = [], links = [] } = {}) {
  const index = {
    aliasToEmployeeId: new Map(),
    employeesById: new Map(),
  };

  for (const row of employeeProfiles) {
    const id = cleanText(row.id);
    if (!id) continue;
    addEmployeeRecord(index, row, 'employee_profiles');
    addAlias(index, id, id);
    addAlias(index, row.firebase_uid, id);
  }

  for (const row of staffRows) {
    const staffId = cleanText(row.id);
    if (!staffId) continue;
    const sameUidEmployee = cleanText(row.firebase_uid)
      ? employeeProfiles.find((employee) => cleanText(employee.firebase_uid) === cleanText(row.firebase_uid))
      : null;
    const sameNameEmployee = !sameUidEmployee && targetNameKey(row.name)
      ? employeeProfiles.find((employee) => targetNameKey(employee.name) === targetNameKey(row.name))
      : null;
    const canonicalId = cleanText(sameUidEmployee?.id || sameNameEmployee?.id || staffId);
    if (!index.employeesById.has(canonicalId)) addEmployeeRecord(index, { ...row, id: canonicalId }, 'staff');
    addAlias(index, staffId, canonicalId);
    addAlias(index, row.firebase_uid, canonicalId);
  }

  for (const link of links.filter((row) => cleanText(row.link_status || 'active') === 'active')) {
    const employeeId = cleanText(link.employee_id);
    const userId = cleanText(link.user_id);
    if (!employeeId || !userId) continue;
    addAlias(index, employeeId, employeeId);
    addAlias(index, userId, employeeId);
  }

  for (const user of appUsers) {
    const linkedEmployeeId = cleanText(links.find((link) =>
      cleanText(link.link_status || 'active') === 'active' && cleanText(link.user_id) === cleanText(user.id)
    )?.employee_id);
    const directEmployee = cleanText(user.firebase_uid)
      ? employeeProfiles.find((employee) => cleanText(employee.firebase_uid) === cleanText(user.firebase_uid))
        || staffRows.find((staff) => cleanText(staff.firebase_uid) === cleanText(user.firebase_uid))
      : null;
    const employeeId = cleanText(linkedEmployeeId || directEmployee?.id || '');
    if (!employeeId) continue;
    addAlias(index, user.id, employeeId);
    addAlias(index, user.firebase_uid, employeeId);
  }

  return index;
}

async function loadTargetIdentityIndex(db, salonId) {
  const [employeeProfiles, staffRows, appUsers, links] = await Promise.all([
    dbAll(db, 'SELECT id, firebase_uid, name, email, phone_normalized, avatar_file_id, status FROM employee_profiles WHERE salon_id = ?', [salonId]),
    dbAll(db, 'SELECT id, firebase_uid, name, phone_normalized, active, employment_status FROM staff WHERE salon_id = ?', [salonId]),
    dbAll(db, 'SELECT id, firebase_uid, display_name, email, primary_role, status FROM app_users WHERE salon_id = ?', [salonId]),
    dbAll(db, "SELECT user_id, employee_id, link_status FROM user_employee_links WHERE salon_id = ? AND link_status = 'active'", [salonId]),
  ]);
  return createTargetIdentityIndex({ employeeProfiles, staffRows, appUsers, links });
}

function resolveTargetEmployeeId(index, rawEmployeeId) {
  const raw = cleanText(rawEmployeeId);
  if (!raw || raw === UNASSIGNED_TARGET_EMPLOYEE_ID) return null;
  return cleanText(index?.aliasToEmployeeId?.get(raw) || raw);
}

export function canonicalizeTargetLedgerRows(rows = [], index = createTargetIdentityIndex()) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const details = parseJson(row.details_json, {});
    const rawEmployeeId = cleanText(row.raw_employee_id || details.rawEmployeeId || row.employee_id);
    const canonicalEmployeeId = resolveTargetEmployeeId(index, rawEmployeeId);
    const employeeExists = canonicalEmployeeId && index.employeesById.has(canonicalEmployeeId);
    const employeeId = employeeExists ? canonicalEmployeeId : UNASSIGNED_TARGET_EMPLOYEE_ID;
    return {
      ...row,
      employee_id: employeeId,
      canonical_employee_id: employeeId,
      raw_employee_id: rawEmployeeId || null,
      is_unassigned_target_sale: employeeId === UNASSIGNED_TARGET_EMPLOYEE_ID ? 1 : 0,
    };
  });
}

function groupUnassignedTargetRows(rows = []) {
  const byRaw = new Map();
  for (const row of rows) {
    const raw = cleanText(row.raw_employee_id) || '(empty)';
    const entry = byRaw.get(raw) || {
      rawEmployeeId: raw,
      eligibleAmount: 0,
      rowCount: 0,
      bookingIds: new Set(),
    };
    entry.eligibleAmount += Number(row.eligible_amount || 0);
    entry.rowCount += 1;
    if (cleanText(row.booking_id)) entry.bookingIds.add(cleanText(row.booking_id));
    byRaw.set(raw, entry);
  }
  return [...byRaw.values()].map((entry) => ({
    ...entry,
    bookingIds: [...entry.bookingIds],
  }));
}

export function targetDashboardInvariant(rows = [], unassignedSales = 0, totalEligibleSales = 0) {
  const employeeTotal = (Array.isArray(rows) ? rows : [])
    .filter((row) => cleanText(row.employee_id || row.employeeId) !== UNASSIGNED_TARGET_EMPLOYEE_ID)
    .reduce((sum, row) => sum + Number(row.net_target_amount ?? row.netTargetAmount ?? 0), 0);
  return employeeTotal + Number(unassignedSales || 0) === Number(totalEligibleSales || 0);
}

function statusPlan(value) {
  const status = cleanText(value || 'active').toLowerCase();
  if (['active', 'inactive'].includes(status)) return status;
  throw new AppError(400, 'employee_targets:invalid_plan_status');
}

function statusSummary(value) {
  const status = cleanText(value || 'open').toLowerCase();
  if (['open', 'under_review', 'approved', 'posted_to_payroll', 'closed'].includes(status)) return status;
  throw new AppError(400, 'employee_targets:invalid_summary_status');
}

function moneyShare(total, part, whole) {
  if (total <= 0 || part <= 0 || whole <= 0) return 0;
  return Math.min(part, Math.round(total * (part / whole)));
}

export function distributeAmountByWeights(amount, weights) {
  const total = weights.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
  if (amount <= 0 || total <= 0 || !weights.length) return weights.map(() => 0);
  let remaining = Math.round(amount);
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return Math.max(0, remaining);
    const share = Math.min(remaining, Math.round(amount * (Math.max(0, Number(weight || 0)) / total)));
    remaining -= share;
    return share;
  });
}

export function eligibleServiceAmount(item, bookingOrInvoiceDiscount = 0, invoicePaid = 0, invoiceTotal = 0) {
  const gross = Math.max(0, Number(item?.total_halalas ?? item?.totalHalalas ?? item?.gross_amount ?? 0));
  const explicitFinal = item?.final_total_halalas ?? item?.finalTotalHalalas;
  const itemDiscount = Math.max(0, Number(item?.discount_halalas ?? item?.discountHalalas ?? 0));
  const discount = Math.max(itemDiscount, Math.max(0, Number(bookingOrInvoiceDiscount || 0)));
  const netBeforeCollection =
    explicitFinal !== undefined && explicitFinal !== null && Number(explicitFinal) >= 0
      ? Math.max(0, Number(explicitFinal))
      : Math.max(0, gross - discount);
  const paid = Math.max(0, Number(invoicePaid || 0));
  const total = Math.max(0, Number(invoiceTotal || 0));
  const collectedRatio = total > 0 ? Math.min(1, paid / total) : paid > 0 ? 1 : 0;
  return {
    gross,
    discount,
    eligible: Math.round(netBeforeCollection * collectedRatio),
    netBeforeCollection,
    collectedRatio,
  };
}

export function calculateTierBonus(netTargetAmount, plan, tiers) {
  const activeTiers = [...(tiers || [])]
    .filter((tier) => cleanText(tier.status || 'active') === 'active')
    .sort((left, right) => Number(left.target_amount || 0) - Number(right.target_amount || 0));
  const achieved = activeTiers.filter((tier) => netTargetAmount >= Number(tier.target_amount || 0));
  if (!achieved.length) {
    return { achievedTier: null, nextTier: activeTiers[0] || null, bonusAmount: 0 };
  }
  const cumulative = Number(plan?.cumulative_tiers || 0) === 1;
  const bonusForTier = (tier) => {
    if (cleanText(plan?.bonus_type || 'fixed') === 'percentage') {
      return Math.round((netTargetAmount * Number(tier.bonus_percent_bps || 0)) / 10000);
    }
    return Math.max(0, Number(tier.bonus_amount || 0));
  };
  const highest = achieved[achieved.length - 1];
  const nextTier = activeTiers.find((tier) => netTargetAmount < Number(tier.target_amount || 0)) || null;
  return {
    achievedTier: highest,
    nextTier,
    bonusAmount: cumulative
      ? achieved.reduce((sum, tier) => sum + bonusForTier(tier), 0)
      : bonusForTier(highest),
  };
}

export function stripTargetBonusItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) =>
    cleanText(item?.source || item?.sourceType || item?.source_type) !== TARGET_BONUS_SOURCE
  );
}

function targetBonusPayrollItem(summary, period, plan, tier) {
  return {
    id: `target_bonus_${summary.id}`,
    kind: 'bonus',
    source: TARGET_BONUS_SOURCE,
    sourceReference: summary.id,
    amountHalalas: Number(summary.earned_bonus_amount || 0),
    label: TARGET_BONUS_LABEL,
    reason: TARGET_BONUS_LABEL,
    note: [
      `${period.month_start || summary.period_start} to ${period.month_end || summary.period_end}`,
      `Eligible sales: ${Number(summary.net_target_amount || 0) / 100}`,
      tier?.tier_name ? `Tier: ${tier.tier_name}` : '',
    ].filter(Boolean).join(' | '),
    targetSummaryId: summary.id,
    targetPeriodStart: period.month_start || summary.period_start,
    targetPeriodEnd: period.month_end || summary.period_end,
    targetEligibleHalalas: Number(summary.net_target_amount || 0),
    targetTierName: tier?.tier_name || null,
    targetPlanName: plan?.name || null,
  };
}

function validPeriodInput(data = {}) {
  const periodId = optionalText(data.periodId || data.payrollPeriodId || data.period_id || data.payroll_period_id);
  const payrollMonth = optionalText(data.payrollMonth || data.payroll_month);
  const start = optionalText(data.periodStart || data.startDate || data.start_date || data.monthStart || data.month_start);
  const end = optionalText(data.periodEnd || data.endDate || data.end_date || data.monthEnd || data.month_end);
  return { periodId, payrollMonth, start, end };
}

function fallbackPayrollBounds(payrollMonth) {
  const [year, month] = cleanText(payrollMonth).split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
  const pad = (value) => String(value).padStart(2, '0');
  const startDate = new Date(Date.UTC(year, month - 2, 21));
  const endDate = new Date(Date.UTC(year, month - 1, 20));
  return {
    id: null,
    payroll_month: `${year}-${pad(month)}`,
    month_start: `${startDate.getUTCFullYear()}-${pad(startDate.getUTCMonth() + 1)}-${pad(startDate.getUTCDate())}`,
    month_end: `${endDate.getUTCFullYear()}-${pad(endDate.getUTCMonth() + 1)}-${pad(endDate.getUTCDate())}`,
  };
}

export async function resolvePayrollPeriodForTargets(db, salonId, data = {}) {
  const input = validPeriodInput(data);
  if (input.periodId) {
    const row = await dbFirst(db, 'SELECT * FROM payroll_periods WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, input.periodId]);
    if (row) return row;
  }
  if (input.payrollMonth) {
    const row = await dbFirst(db, 'SELECT * FROM payroll_periods WHERE salon_id = ? AND payroll_month = ? LIMIT 1', [salonId, input.payrollMonth]);
    if (row) return row;
    const fallback = fallbackPayrollBounds(input.payrollMonth);
    if (fallback) return fallback;
  }
  if (input.start && input.end) {
    return {
      id: null,
      payroll_month: input.payrollMonth || null,
      month_start: validDate(input.start, 'periodStart'),
      month_end: validDate(input.end, 'periodEnd'),
    };
  }
  throw new AppError(400, 'employee_targets:period_required');
}

async function payrollPeriodForDate(db, salonId, dateKey) {
  return dbFirst(
    db,
    `SELECT * FROM payroll_periods
      WHERE salon_id = ? AND month_start <= ? AND month_end >= ?
      ORDER BY month_start DESC LIMIT 1`,
    [salonId, dateKey, dateKey]
  );
}

async function getPlanTiers(db, salonId, planId) {
  if (!planId) return [];
  return dbAll(
    db,
    'SELECT * FROM employee_target_tiers WHERE salon_id = ? AND plan_id = ? ORDER BY tier_order, target_amount',
    [salonId, planId]
  );
}

export async function resolveEmployeeTargetPlan(db, salonId, employeeId, periodStart, periodEnd) {
  const rows = await dbAll(
    db,
    `SELECT p.*, a.scope_type, a.employee_id AS assigned_employee_id, a.branch_id AS assigned_branch_id
       FROM employee_target_assignments a
       INNER JOIN employee_target_plans p ON p.id = a.plan_id AND p.salon_id = a.salon_id
      WHERE a.salon_id = ?
        AND a.status = 'active'
        AND p.status = 'active'
        AND a.effective_start <= ?
        AND COALESCE(a.effective_end, '9999-12-31') >= ?
        AND p.effective_start <= ?
        AND COALESCE(p.effective_end, '9999-12-31') >= ?
        AND (a.scope_type = 'default' OR (a.scope_type = 'employee' AND a.employee_id = ?))
      ORDER BY CASE WHEN a.scope_type = 'employee' THEN 0 ELSE 1 END, a.effective_start DESC, p.effective_start DESC
      LIMIT 1`,
    [salonId, periodEnd, periodStart, periodEnd, periodStart, employeeId]
  );
  const plan = rows[0] || null;
  return plan ? { plan, tiers: await getPlanTiers(db, salonId, plan.id) } : { plan: null, tiers: [] };
}

function assertTierOrder(tiers = []) {
  const amounts = new Set();
  const orders = new Set();
  let lastAmount = -1;
  for (const raw of tiers) {
    const target = intMoney(raw.targetAmount ?? raw.target_amount, 'targetAmount');
    const order = integer(raw.tierOrder ?? raw.tier_order, 'tierOrder', { min: 1, max: 1000 });
    if (amounts.has(target)) throw new AppError(409, 'employee_targets:duplicate_tier_amount');
    if (orders.has(order)) throw new AppError(409, 'employee_targets:duplicate_tier_order');
    if (target < lastAmount) throw new AppError(400, 'employee_targets:invalid_tier_order');
    amounts.add(target);
    orders.add(order);
    lastAmount = target;
  }
}

export async function listTargetPlans(db, salonId) {
  const plans = await dbAll(db, 'SELECT * FROM employee_target_plans WHERE salon_id = ? ORDER BY effective_start DESC, name', [salonId]);
  const tiers = await dbAll(db, 'SELECT * FROM employee_target_tiers WHERE salon_id = ? ORDER BY plan_id, tier_order, target_amount', [salonId]);
  const assignments = await dbAll(db, 'SELECT * FROM employee_target_assignments WHERE salon_id = ? ORDER BY effective_start DESC', [salonId]);
  return plans.map((plan) => ({
    ...plan,
    tiers: tiers.filter((tier) => tier.plan_id === plan.id),
    assignments: assignments.filter((assignment) => assignment.plan_id === plan.id),
  }));
}

export async function saveTargetPlan(db, salonId, data = {}, actor = {}) {
  const now = nowIso();
  const id = requiredId(data.id || generatedId('target_plan'));
  const existing = await dbFirst(db, 'SELECT * FROM employee_target_plans WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  const tiers = Array.isArray(data.tiers) ? data.tiers : undefined;
  if (tiers) assertTierOrder(tiers);
  const row = {
    id,
    salon_id: salonId,
    name: cleanText(data.name || existing?.name),
    description: optionalText(data.description) || existing?.description || null,
    status: statusPlan(data.status || existing?.status || 'active'),
    effective_start: validDate(data.effectiveStart || data.effective_start || existing?.effective_start || now.slice(0, 10), 'effectiveStart'),
    effective_end: data.effectiveEnd === null || data.effective_end === null
      ? null
      : optionalText(data.effectiveEnd || data.effective_end || existing?.effective_end) || null,
    period_type: cleanText(data.periodType || data.period_type || existing?.period_type || 'payroll_cycle'),
    branch_id: optionalText(data.branchId || data.branch_id || existing?.branch_id) || null,
    applies_to_all_branches: boolInt(data.appliesToAllBranches ?? data.applies_to_all_branches ?? existing?.applies_to_all_branches ?? 1, 1),
    cumulative_tiers: boolInt(data.cumulativeTiers ?? data.cumulative_tiers ?? existing?.cumulative_tiers ?? 0),
    bonus_type: cleanText(data.bonusType || data.bonus_type || existing?.bonus_type || 'fixed') === 'percentage' ? 'percentage' : 'fixed',
    included_service_ids_json: jsonText(data.includedServiceIds ?? data.included_service_ids_json ?? existing?.included_service_ids_json, []),
    included_category_ids_json: jsonText(data.includedCategoryIds ?? data.included_category_ids_json ?? existing?.included_category_ids_json, []),
    excluded_service_ids_json: jsonText(data.excludedServiceIds ?? data.excluded_service_ids_json ?? existing?.excluded_service_ids_json, []),
    excluded_category_ids_json: jsonText(data.excludedCategoryIds ?? data.excluded_category_ids_json ?? existing?.excluded_category_ids_json, []),
    created_by_uid: existing?.created_by_uid || optionalText(actor.uid) || null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (!row.name) throw new AppError(400, 'employee_targets:plan_name_required');
  if (row.effective_end && row.effective_end < row.effective_start) throw new AppError(400, 'employee_targets:invalid_effective_dates');

  const statements = [{
    sql: `INSERT INTO employee_target_plans
      (id, salon_id, name, description, status, effective_start, effective_end, period_type, branch_id,
       applies_to_all_branches, cumulative_tiers, bonus_type, included_service_ids_json,
       included_category_ids_json, excluded_service_ids_json, excluded_category_ids_json,
       created_by_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, description = excluded.description, status = excluded.status,
       effective_start = excluded.effective_start, effective_end = excluded.effective_end,
       period_type = excluded.period_type, branch_id = excluded.branch_id,
       applies_to_all_branches = excluded.applies_to_all_branches,
       cumulative_tiers = excluded.cumulative_tiers, bonus_type = excluded.bonus_type,
       included_service_ids_json = excluded.included_service_ids_json,
       included_category_ids_json = excluded.included_category_ids_json,
       excluded_service_ids_json = excluded.excluded_service_ids_json,
       excluded_category_ids_json = excluded.excluded_category_ids_json,
       updated_at = excluded.updated_at`,
    params: Object.values(row),
  }];
  if (tiers) {
    statements.push({ sql: 'DELETE FROM employee_target_tiers WHERE salon_id = ? AND plan_id = ?', params: [salonId, id] });
    for (const raw of tiers) {
      statements.push({
        sql: `INSERT INTO employee_target_tiers
          (id, salon_id, plan_id, tier_name, tier_order, target_amount, bonus_amount, bonus_percent_bps, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          requiredId(raw.id || generatedId('target_tier')),
          salonId,
          id,
          cleanText(raw.tierName || raw.tier_name || raw.name) || `Tier ${raw.tierOrder || raw.tier_order}`,
          integer(raw.tierOrder ?? raw.tier_order, 'tierOrder', { min: 1, max: 1000 }),
          intMoney(raw.targetAmount ?? raw.target_amount, 'targetAmount'),
          intMoney(raw.bonusAmount ?? raw.bonus_amount ?? 0, 'bonusAmount'),
          integer(raw.bonusPercentBps ?? raw.bonus_percent_bps ?? 0, 'bonusPercentBps', { min: 0, max: 100000 }),
          cleanText(raw.status || 'active') === 'inactive' ? 'inactive' : 'active',
          now,
          now,
        ],
      });
    }
  }
  await dbBatch(db, statements);

  if (Array.isArray(data.assignments)) {
    await replaceTargetAssignments(db, salonId, id, data.assignments, actor);
  }
  await recordAudit(db, salonId, {
    action: existing ? 'employee_target_plan_updated' : 'employee_target_plan_created',
    entityType: 'employee_target_plan',
    entityId: id,
    before: existing || null,
    after: row,
    source: 'dashboard',
  }, actor);
  return (await listTargetPlans(db, salonId)).find((plan) => plan.id === id);
}

export async function replaceTargetAssignments(db, salonId, planId, assignments = [], actor = {}) {
  const now = nowIso();
  const statements = [{ sql: 'DELETE FROM employee_target_assignments WHERE salon_id = ? AND plan_id = ?', params: [salonId, planId] }];
  for (const raw of assignments) {
    const scopeType = cleanText(raw.scopeType || raw.scope_type || (raw.employeeId || raw.employee_id ? 'employee' : 'default'));
    if (!['default', 'employee', 'branch'].includes(scopeType)) throw new AppError(400, 'employee_targets:invalid_assignment_scope');
    const employeeId = optionalText(raw.employeeId || raw.employee_id) || null;
    const branchId = optionalText(raw.branchId || raw.branch_id) || null;
    if (scopeType === 'employee' && !employeeId) throw new AppError(400, 'employee_targets:employee_assignment_required');
    statements.push({
      sql: `INSERT INTO employee_target_assignments
        (id, salon_id, plan_id, scope_type, employee_id, branch_id, status, effective_start, effective_end, created_by_uid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        requiredId(raw.id || generatedId('target_assignment')),
        salonId,
        planId,
        scopeType,
        employeeId,
        branchId,
        cleanText(raw.status || 'active') === 'inactive' ? 'inactive' : 'active',
        validDate(raw.effectiveStart || raw.effective_start, 'effectiveStart'),
        optionalText(raw.effectiveEnd || raw.effective_end) || null,
        optionalText(actor.uid) || null,
        now,
        now,
      ],
    });
  }
  await dbBatch(db, statements);
}

function serviceIncludedByPlan(plan, item) {
  if (!plan) return true;
  const includedServices = readJsonList(plan.included_service_ids_json);
  const includedCategories = readJsonList(plan.included_category_ids_json);
  const excludedServices = readJsonList(plan.excluded_service_ids_json);
  const excludedCategories = readJsonList(plan.excluded_category_ids_json);
  const serviceId = cleanText(item.service_id);
  const categoryId = cleanText(item.category_id);
  if (excludedServices.includes(serviceId) || excludedCategories.includes(categoryId)) return false;
  if (includedServices.length && !includedServices.includes(serviceId)) return false;
  if (includedCategories.length && !includedCategories.includes(categoryId)) return false;
  return true;
}

async function bookingRowsForPeriod(db, salonId, periodStart, periodEnd, bookingId = '') {
  const params = [salonId];
  const idWhere = bookingId ? 'AND b.id = ?' : '';
  if (bookingId) params.push(bookingId);
  params.push(periodStart, periodEnd);
  return dbAll(
    db,
    `SELECT b.id AS booking_id, b.salon_id, b.status AS booking_status, b.booking_date, b.start_time, b.discount_halalas AS booking_discount_halalas,
            b.total_halalas AS booking_total_halalas,
            i.id AS invoice_id, i.total_halalas AS invoice_total_halalas, i.paid_halalas AS invoice_paid_halalas,
            i.discount_halalas AS invoice_discount_halalas,
            bi.id AS booking_item_id, bi.service_id, bi.service_name_snapshot,
            bi.staff_id AS booking_item_staff_id, b.staff_id AS booking_staff_id,
            COALESCE(NULLIF(bi.staff_id, ''), NULLIF(b.staff_id, '')) AS employee_id,
            s.category_id, bi.client_package_id, bi.package_reservation_id, bi.package_covered,
            bi.total_halalas, bi.discount_halalas, bi.final_total_halalas,
            COALESCE(bi.booking_date, b.booking_date) AS performed_date,
            COALESCE(bi.start_time, b.start_time, '00:00') AS performed_time
       FROM bookings b
       INNER JOIN booking_items bi ON bi.booking_id = b.id AND bi.salon_id = b.salon_id
       LEFT JOIN invoices i ON i.booking_id = b.id AND i.salon_id = b.salon_id
       LEFT JOIN services s ON s.id = bi.service_id AND s.salon_id = bi.salon_id
      WHERE b.salon_id = ?
        ${idWhere}
        AND COALESCE(b.deleted_at, '') = ''
        AND LOWER(COALESCE(b.status, '')) <> 'cancelled'
        AND (
          LOWER(COALESCE(b.status, '')) = 'completed'
          OR COALESCE(i.paid_halalas, 0) > 0
        )
        AND COALESCE(bi.booking_date, b.booking_date) >= ?
        AND COALESCE(bi.booking_date, b.booking_date) <= ?
      ORDER BY b.booking_date, b.start_time, bi.created_at, bi.id`,
    params
  );
}

async function bookingAuditRowsForPeriod(db, salonId, periodStart, periodEnd) {
  return dbAll(
    db,
    `SELECT b.id AS booking_id, b.salon_id, b.status AS booking_status, b.booking_date, b.start_time, b.discount_halalas AS booking_discount_halalas,
            b.total_halalas AS booking_total_halalas,
            i.id AS invoice_id, i.total_halalas AS invoice_total_halalas, i.paid_halalas AS invoice_paid_halalas,
            i.discount_halalas AS invoice_discount_halalas,
            bi.id AS booking_item_id, bi.service_id, bi.service_name_snapshot,
            bi.staff_id AS booking_item_staff_id, b.staff_id AS booking_staff_id,
            COALESCE(NULLIF(bi.staff_id, ''), NULLIF(b.staff_id, '')) AS employee_id,
            s.category_id, bi.client_package_id, bi.package_reservation_id, bi.package_covered,
            bi.total_halalas, bi.discount_halalas, bi.final_total_halalas,
            COALESCE(bi.booking_date, b.booking_date) AS performed_date,
            COALESCE(bi.start_time, b.start_time, '00:00') AS performed_time
       FROM bookings b
       INNER JOIN booking_items bi ON bi.booking_id = b.id AND bi.salon_id = b.salon_id
       LEFT JOIN invoices i ON i.booking_id = b.id AND i.salon_id = b.salon_id
       LEFT JOIN services s ON s.id = bi.service_id AND s.salon_id = bi.salon_id
      WHERE b.salon_id = ?
        AND COALESCE(b.deleted_at, '') = ''
        AND COALESCE(bi.booking_date, b.booking_date) >= ?
        AND COALESCE(bi.booking_date, b.booking_date) <= ?
      ORDER BY b.booking_date, b.start_time, bi.created_at, bi.id`,
    [salonId, periodStart, periodEnd]
  );
}

async function refundRowsForPeriod(db, salonId, periodStart, periodEnd, bookingId = '') {
  const params = [salonId];
  const idWhere = bookingId ? 'AND r.booking_id = ?' : '';
  if (bookingId) params.push(bookingId);
  params.push(periodStart, periodEnd);
  return dbAll(
    db,
    `SELECT r.*
       FROM refunds r
      WHERE r.salon_id = ?
        ${idWhere}
        AND LOWER(COALESCE(r.status, 'completed')) = 'completed'
        AND SUBSTR(COALESCE(r.refunded_at, r.created_at), 1, 10) >= ?
        AND SUBSTR(COALESCE(r.refunded_at, r.created_at), 1, 10) <= ?
      ORDER BY r.refunded_at, r.id`,
    params
  );
}

function resolveBookingRowEmployee(row, identityIndex) {
  const rawEmployeeId = cleanText(row.booking_item_staff_id) || cleanText(row.booking_staff_id) || cleanText(row.employee_id);
  if (!identityIndex) {
    return {
      rawEmployeeId,
      employeeId: rawEmployeeId || UNASSIGNED_TARGET_EMPLOYEE_ID,
      unassigned: !rawEmployeeId,
    };
  }
  const canonicalEmployeeId = resolveTargetEmployeeId(identityIndex, rawEmployeeId);
  const employeeId = canonicalEmployeeId && identityIndex.employeesById.has(canonicalEmployeeId)
    ? canonicalEmployeeId
    : UNASSIGNED_TARGET_EMPLOYEE_ID;
  return {
    rawEmployeeId,
    employeeId,
    unassigned: employeeId === UNASSIGNED_TARGET_EMPLOYEE_ID,
  };
}

function withResolvedBookingEmployees(rows, identityIndex) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const resolution = resolveBookingRowEmployee(row, identityIndex);
    return {
      ...row,
      employee_id: resolution.employeeId,
      raw_employee_id: resolution.rawEmployeeId,
      is_unassigned_target_sale: resolution.unassigned ? 1 : 0,
    };
  });
}

function buildServiceLedgerRows(rows, period, now, identityIndex = null) {
  const resolvedRows = withResolvedBookingEmployees(rows, identityIndex);
  const rowsByBooking = new Map();
  for (const row of resolvedRows) {
    if (!rowsByBooking.has(row.booking_id)) rowsByBooking.set(row.booking_id, []);
    rowsByBooking.get(row.booking_id).push(row);
  }
  const ledger = [];
  for (const group of rowsByBooking.values()) {
    const grossWeights = group.map((row) => Math.max(0, Number(row.total_halalas || 0)));
    const invoiceDiscount = Math.max(0, Number(group[0].invoice_discount_halalas ?? group[0].booking_discount_halalas ?? 0));
    const explicitItemDiscountTotal = group.reduce((sum, row) => sum + Math.max(0, Number(row.discount_halalas || 0)), 0);
    const allocatedDiscounts = explicitItemDiscountTotal > 0 ? group.map((row) => Math.max(0, Number(row.discount_halalas || 0))) : distributeAmountByWeights(invoiceDiscount, grossWeights);
    for (let index = 0; index < group.length; index += 1) {
      const row = group[index];
      const amount = eligibleServiceAmount(
        row,
        allocatedDiscounts[index] || 0,
        Number(row.invoice_paid_halalas || 0),
        Number(row.invoice_total_halalas || row.booking_total_halalas || 0)
      );
      if (amount.eligible <= 0) continue;
      ledger.push({
        id: generatedId('target_ledger'),
        salon_id: row.salon_id,
        employee_id: cleanText(row.employee_id),
        booking_id: row.booking_id,
        booking_item_id: row.booking_item_id,
        service_id: row.service_id,
        package_session_id: cleanText(row.package_reservation_id || row.client_package_id) || null,
        transaction_type: Number(row.package_covered || 0) === 1 ? 'package_session' : 'service_completed',
        gross_amount: amount.gross,
        discount_amount: amount.discount,
        refund_amount: 0,
        eligible_amount: amount.eligible,
        performed_at: `${row.performed_date}T${row.performed_time || '00:00'}:00`,
        payroll_period_id: period.id || null,
        source_reference: `${Number(row.package_covered || 0) === 1 ? 'package_session' : 'service'}:${row.booking_item_id}`,
        details_json: JSON.stringify({
          serviceName: row.service_name_snapshot || '',
          collectedRatio: amount.collectedRatio,
          invoiceId: row.invoice_id || null,
          packageCovered: Number(row.package_covered || 0) === 1,
          rawEmployeeId: row.raw_employee_id || null,
          bookingItemStaffId: row.booking_item_staff_id || null,
          bookingStaffId: row.booking_staff_id || null,
          employeeResolution: row.is_unassigned_target_sale ? 'unassigned' : 'canonical',
        }),
        created_by_uid: null,
        created_at: now,
        updated_at: now,
      });
    }
  }
  return ledger;
}

function buildRefundLedgerRows(serviceRows, refunds, period, now, identityIndex = null) {
  const resolvedServiceRows = withResolvedBookingEmployees(serviceRows, identityIndex);
  const serviceByBooking = new Map();
  for (const row of resolvedServiceRows) {
    if (!serviceByBooking.has(row.booking_id)) serviceByBooking.set(row.booking_id, []);
    serviceByBooking.get(row.booking_id).push(row);
  }
  const ledger = [];
  for (const refund of refunds) {
    const group = serviceByBooking.get(cleanText(refund.booking_id)) || [];
    if (!group.length) continue;
    const weights = group.map((row) => Math.max(0, Number(row.final_total_halalas ?? row.total_halalas ?? 0)));
    const allocations = distributeAmountByWeights(Number(refund.amount_halalas || 0), weights);
    for (let index = 0; index < group.length; index += 1) {
      const row = group[index];
      const refundAmount = allocations[index] || 0;
      if (refundAmount <= 0) continue;
      ledger.push({
        id: generatedId('target_ledger'),
        salon_id: row.salon_id,
        employee_id: cleanText(row.employee_id),
        booking_id: row.booking_id,
        booking_item_id: row.booking_item_id,
        service_id: row.service_id,
        package_session_id: null,
        transaction_type: 'service_refund',
        gross_amount: 0,
        discount_amount: 0,
        refund_amount: refundAmount,
        eligible_amount: -refundAmount,
        performed_at: cleanText(refund.refunded_at || refund.created_at) || now,
        payroll_period_id: period.id || null,
        source_reference: `refund:${refund.id}:${row.booking_item_id}`,
        details_json: JSON.stringify({
          refundId: refund.id,
          reason: refund.reason || null,
          method: refund.method || null,
          rawEmployeeId: row.raw_employee_id || null,
          bookingItemStaffId: row.booking_item_staff_id || null,
          bookingStaffId: row.booking_staff_id || null,
          employeeResolution: row.is_unassigned_target_sale ? 'unassigned' : 'canonical',
        }),
        created_by_uid: refund.created_by_uid || null,
        created_at: now,
        updated_at: now,
      });
    }
  }
  return ledger;
}

async function insertLedgerRows(db, rows) {
  if (!rows.length) return [];
  await dbBatch(db, rows.map((row) => ({
    sql: `INSERT OR REPLACE INTO employee_target_ledger
      (id, salon_id, employee_id, booking_id, booking_item_id, service_id, package_session_id,
       transaction_type, gross_amount, discount_amount, refund_amount, eligible_amount,
       performed_at, payroll_period_id, source_reference, details_json, created_by_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      row.id,
      row.salon_id,
      row.employee_id,
      row.booking_id,
      row.booking_item_id,
      row.service_id,
      row.package_session_id,
      row.transaction_type,
      row.gross_amount,
      row.discount_amount,
      row.refund_amount,
      row.eligible_amount,
      row.performed_at,
      row.payroll_period_id,
      row.source_reference,
      row.details_json,
      row.created_by_uid,
      row.created_at,
      row.updated_at,
    ],
  })));
  return rows;
}

export async function rebuildEmployeeTargetLedgerForPeriod(db, salonId, data = {}) {
  const period = await resolvePayrollPeriodForTargets(db, salonId, data);
  const periodStart = validDate(period.month_start, 'periodStart');
  const periodEnd = validDate(period.month_end, 'periodEnd');
  const now = nowIso();
  await dbRun(
    db,
    `DELETE FROM employee_target_ledger
      WHERE salon_id = ?
        AND transaction_type IN ('service_completed', 'service_refund', 'package_session', 'reversal')
        AND SUBSTR(performed_at, 1, 10) >= ?
        AND SUBSTR(performed_at, 1, 10) <= ?`,
    [salonId, periodStart, periodEnd]
  );
  const identityIndex = await loadTargetIdentityIndex(db, salonId);
  const serviceRows = await bookingRowsForPeriod(db, salonId, periodStart, periodEnd);
  const refunds = await refundRowsForPeriod(db, salonId, periodStart, periodEnd);
  const serviceLedger = buildServiceLedgerRows(serviceRows, period, now, identityIndex);
  const refundLedger = buildRefundLedgerRows(serviceRows, refunds, period, now, identityIndex);
  const rows = await insertLedgerRows(db, [...serviceLedger, ...refundLedger]);
  return { period, inserted: rows.length };
}

export async function refreshEmployeeTargetLedgerForBooking(db, salonId, bookingId) {
  const id = cleanText(bookingId);
  if (!id) return { inserted: 0 };
  const booking = await dbFirst(db, 'SELECT * FROM bookings WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
  if (!booking) return { inserted: 0 };
  const dateKey = cleanText(booking.booking_date);
  const period = await payrollPeriodForDate(db, salonId, dateKey);
  if (!period) return { inserted: 0, skipped: 'payroll_period_missing' };
  const now = nowIso();
  await dbRun(
    db,
    `DELETE FROM employee_target_ledger
      WHERE salon_id = ? AND booking_id = ?
        AND transaction_type IN ('service_completed', 'service_refund', 'package_session', 'reversal')`,
    [salonId, id]
  );
  const identityIndex = await loadTargetIdentityIndex(db, salonId);
  const serviceRows = await bookingRowsForPeriod(db, salonId, period.month_start, period.month_end, id);
  const refunds = await refundRowsForPeriod(db, salonId, period.month_start, period.month_end, id);
  const rows = await insertLedgerRows(db, [
    ...buildServiceLedgerRows(serviceRows, period, now, identityIndex),
    ...buildRefundLedgerRows(serviceRows, refunds, period, now, identityIndex),
  ]);
  return { inserted: rows.length, period };
}

async function ledgerForPeriod(db, salonId, period, employeeId = '') {
  const params = [salonId, period.month_start, period.month_end];
  const employeeWhere = employeeId ? 'AND employee_id = ?' : '';
  if (employeeId) params.push(employeeId);
  return dbAll(
    db,
    `SELECT *
       FROM employee_target_ledger
      WHERE salon_id = ?
        AND SUBSTR(performed_at, 1, 10) >= ?
        AND SUBSTR(performed_at, 1, 10) <= ?
        ${employeeWhere}
      ORDER BY performed_at DESC, created_at DESC`,
    params
  );
}

function targetLedgerDetails(row) {
  return parseJson(row?.details_json, {});
}

function targetLedgerDisplayRow(row) {
  const details = targetLedgerDetails(row);
  return {
    ...row,
    service_name: cleanText(details.serviceName) || cleanText(row.service_id) || null,
    reason: cleanText(details.reason) || cleanText(details.notes) || null,
    raw_employee_id: cleanText(row.raw_employee_id || details.rawEmployeeId) || null,
    booking_item_staff_id: cleanText(details.bookingItemStaffId) || null,
    booking_staff_id: cleanText(details.bookingStaffId) || null,
    details,
  };
}

function targetPeriodClosed(period) {
  const status = cleanText(period?.status || period?.period_status || period?.lock_status).toLowerCase();
  return ['closed', 'locked', 'posted', 'posted_to_payroll', 'paid'].includes(status);
}

function decorateTargetSummary(summary) {
  const nextTarget = Number(summary?.nextTier?.target_amount || 0);
  const achievedTarget = Number(summary?.achievedTier?.target_amount || 0);
  const currentTargetAmount = nextTarget || achievedTarget || 0;
  const netTargetAmount = Number(summary?.net_target_amount || 0);
  const ledger = (summary?.ledger || []).map(targetLedgerDisplayRow);
  const progressRatio = currentTargetAmount > 0 ? Math.min(1, Math.max(0, netTargetAmount / currentTargetAmount)) : 0;
  const positiveServiceRows = ledger.filter((row) =>
    ['service_completed', 'package_session'].includes(cleanText(row.transaction_type)) && Number(row.eligible_amount || 0) > 0
  );
  const manualRows = ledger.filter((row) => cleanText(row.transaction_type) === 'manual_adjustment');
  const refundRows = ledger.filter((row) => cleanText(row.transaction_type) === 'service_refund' || Number(row.refund_amount || 0) > 0);
  const lastUpdatedAt = ledger
    .map((row) => cleanText(row.updated_at || row.created_at || row.performed_at))
    .filter(Boolean)
    .sort()
    .pop() || null;
  return {
    ...summary,
    ledger,
    current_target_amount: currentTargetAmount,
    progress_ratio: Math.round(progressRatio * 10000) / 10000,
    remaining_to_next_tier: summary?.nextTier ? Math.max(0, Number(summary.nextTier.target_amount || 0) - netTargetAmount) : 0,
    counted_booking_count: new Set(positiveServiceRows.map((row) => cleanText(row.booking_id)).filter(Boolean)).size,
    counted_service_item_count: new Set(positiveServiceRows.map((row) => cleanText(row.booking_item_id)).filter(Boolean)).size,
    refund_deduction_amount: refundRows.reduce((sum, row) => sum + Math.max(0, Number(row.refund_amount || 0)), 0),
    manual_adjustment_amount: manualRows.reduce((sum, row) => sum + Number(row.eligible_amount || 0), 0),
    service_eligible_amount: positiveServiceRows.reduce((sum, row) => sum + Number(row.eligible_amount || 0), 0),
    last_updated_at: lastUpdatedAt,
    has_target_plan: Boolean(summary?.plan),
  };
}

function bookingAuditExclusionReason(row, amount, plan, countedSources) {
  const sourceReference = `${Number(row.package_covered || 0) === 1 ? 'package_session' : 'service'}:${row.booking_item_id}`;
  const status = cleanText(row.booking_status).toLowerCase();
  if (countedSources.has(sourceReference)) return '';
  if (status === 'cancelled') return 'الحجز ملغي';
  if (!serviceIncludedByPlan(plan, row)) return 'الخدمة خارج خطة التارقت';
  if (Number(row.invoice_paid_halalas || 0) <= 0) return 'لم يتم تحصيل مبلغ مدفوع';
  if (amount.eligible <= 0) return 'المبلغ المحصل غير مؤهل للتارقت';
  return 'غير محتسبة لمنع التكرار أو لعدم اكتمال شروط التارقت';
}

async function excludedTargetTransactionsForEmployee(db, salonId, period, employeeId, summary, identityIndex) {
  const auditRows = await bookingAuditRowsForPeriod(db, salonId, period.month_start, period.month_end);
  const resolvedRows = withResolvedBookingEmployees(auditRows, identityIndex)
    .filter((row) => cleanText(row.employee_id) === cleanText(employeeId));
  const rowsByBooking = new Map();
  for (const row of resolvedRows) {
    if (!rowsByBooking.has(row.booking_id)) rowsByBooking.set(row.booking_id, []);
    rowsByBooking.get(row.booking_id).push(row);
  }
  const countedSources = new Set((summary.ledger || []).map((row) => cleanText(row.source_reference)).filter(Boolean));
  const excluded = [];
  for (const group of rowsByBooking.values()) {
    const grossWeights = group.map((row) => Math.max(0, Number(row.total_halalas || 0)));
    const invoiceDiscount = Math.max(0, Number(group[0].invoice_discount_halalas ?? group[0].booking_discount_halalas ?? 0));
    const explicitItemDiscountTotal = group.reduce((sum, row) => sum + Math.max(0, Number(row.discount_halalas || 0)), 0);
    const allocatedDiscounts = explicitItemDiscountTotal > 0 ? group.map((row) => Math.max(0, Number(row.discount_halalas || 0))) : distributeAmountByWeights(invoiceDiscount, grossWeights);
    for (let index = 0; index < group.length; index += 1) {
      const row = group[index];
      const amount = eligibleServiceAmount(
        row,
        allocatedDiscounts[index] || 0,
        Number(row.invoice_paid_halalas || 0),
        Number(row.invoice_total_halalas || row.booking_total_halalas || 0)
      );
      const reason = bookingAuditExclusionReason(row, amount, summary.plan, countedSources);
      if (!reason) continue;
      excluded.push({
        booking_id: row.booking_id,
        booking_item_id: row.booking_item_id,
        service_id: row.service_id,
        service_name: cleanText(row.service_name_snapshot) || cleanText(row.service_id) || 'Service',
        transaction_date: cleanText(row.performed_date || row.booking_date),
        performed_at: `${row.performed_date || row.booking_date}T${row.performed_time || row.start_time || '00:00'}:00`,
        booking_status: row.booking_status,
        raw_employee_id: row.raw_employee_id || null,
        booking_item_staff_id: row.booking_item_staff_id || null,
        booking_staff_id: row.booking_staff_id || null,
        invoice_paid_amount: Number(row.invoice_paid_halalas || 0),
        gross_amount: amount.gross,
        discount_amount: amount.discount,
        eligible_amount: amount.eligible,
        exclusion_reason: reason,
      });
    }
  }
  return excluded;
}

async function summarizeEmployee(db, salonId, period, employeeId, rows) {
  const periodStart = period.month_start;
  const periodEnd = period.month_end;
  const { plan, tiers } = await resolveEmployeeTargetPlan(db, salonId, employeeId, periodStart, periodEnd);
  const filteredRows = rows.filter((row) => serviceIncludedByPlan(plan, row));
  const totalRefunds = filteredRows.reduce((sum, row) => sum + Math.max(0, Number(row.refund_amount || 0)), 0);
  const netTargetAmount = filteredRows.reduce((sum, row) => sum + Number(row.eligible_amount || 0), 0);
  const tier = calculateTierBonus(netTargetAmount, plan, tiers);
  const grossEligible = filteredRows
    .filter((row) => Number(row.eligible_amount || 0) > 0)
    .reduce((sum, row) => sum + Number(row.eligible_amount || 0), 0);
  return {
    employee_id: employeeId,
    payroll_period_id: period.id || null,
    payroll_month: period.payroll_month || null,
    period_start: periodStart,
    period_end: periodEnd,
    plan_id: plan?.id || null,
    plan,
    tiers,
    achievedTier: tier.achievedTier,
    nextTier: tier.nextTier,
    total_eligible_services: grossEligible,
    total_refunds: totalRefunds,
    net_target_amount: netTargetAmount,
    earned_bonus_amount: tier.bonusAmount,
    ledger: filteredRows,
  };
}

export async function calculateTargetSummaries(db, salonId, data = {}) {
  const period = await resolvePayrollPeriodForTargets(db, salonId, data);
  const identityIndex = await loadTargetIdentityIndex(db, salonId);
  const requestedEmployeeId = optionalText(data.employeeId || data.employee_id);
  const requestedCanonicalId = requestedEmployeeId ? resolveTargetEmployeeId(identityIndex, requestedEmployeeId) || requestedEmployeeId : '';
  const allRows = await ledgerForPeriod(db, salonId, period, '');
  const canonicalRows = canonicalizeTargetLedgerRows(allRows, identityIndex);
  const scopedRows = requestedCanonicalId
    ? canonicalRows.filter((row) => cleanText(row.employee_id) === requestedCanonicalId)
    : canonicalRows;
  const assignedRows = scopedRows.filter((row) => cleanText(row.employee_id) !== UNASSIGNED_TARGET_EMPLOYEE_ID);
  const unassignedRows = requestedCanonicalId
    ? []
    : scopedRows.filter((row) => cleanText(row.employee_id) === UNASSIGNED_TARGET_EMPLOYEE_ID);
  const employeeIds = requestedCanonicalId
    ? [requestedCanonicalId]
    : [
        ...new Set([
          ...assignedRows.map((row) => cleanText(row.employee_id)).filter(Boolean),
          ...identityIndex.employeesById.keys(),
        ]),
      ];
  const summaries = [];
  for (const id of employeeIds) {
    if (!id || id === UNASSIGNED_TARGET_EMPLOYEE_ID) continue;
    summaries.push(await summarizeEmployee(db, salonId, period, id, assignedRows.filter((row) => cleanText(row.employee_id) === id)));
  }
  const unassignedSales = unassignedRows.reduce((sum, row) => sum + Number(row.eligible_amount || 0), 0);
  const totalEligibleSales = summaries.reduce((sum, row) => sum + Number(row.net_target_amount || 0), 0) + unassignedSales;
  return {
    period,
    summaries,
    unassignedSales,
    unassignedRows,
    unmatchedEmployeeIds: groupUnassignedTargetRows(unassignedRows),
    totalEligibleSales,
    identityIndex,
  };
}

export async function listEmployeeTargetDashboard(db, salonId, query = {}) {
  if (cleanText(query.rebuild) === 'true') await rebuildEmployeeTargetLedgerForPeriod(db, salonId, query);
  const result = await calculateTargetSummaries(db, salonId, query);
  const rows = result.summaries.map((summary) => {
    const employee = result.identityIndex?.employeesById?.get(summary.employee_id) || {};
    const currentTarget = summary.nextTier?.target_amount || summary.achievedTier?.target_amount || 0;
    const progress = currentTarget > 0 ? Math.min(1, Math.max(0, summary.net_target_amount / currentTarget)) : 0;
    return {
      ...summary,
      employeeName: employee.name || summary.employee_id,
      employeeAvatarFileId: employee.avatar_file_id || null,
      currentTargetAmount: currentTarget,
      progressRatio: Math.round(progress * 10000) / 10000,
      remainingToNextTier: summary.nextTier ? Math.max(0, Number(summary.nextTier.target_amount || 0) - summary.net_target_amount) : 0,
    };
  });
  const achievedCount = rows.filter((row) => row.achievedTier).length;
  const top = [...rows].sort((left, right) => right.net_target_amount - left.net_target_amount)[0] || null;
  const closeCount = rows.filter((row) => row.nextTier && row.progressRatio >= 0.8).length;
  const totalEligibleSales = Number(result.totalEligibleSales || 0);
  if (!targetDashboardInvariant(rows, result.unassignedSales, totalEligibleSales)) {
    throw new AppError(500, 'employee_targets:dashboard_invariant_failed');
  }
  return {
    period: result.period,
    summary: {
      totalEligibleSales,
      unassignedSales: Number(result.unassignedSales || 0),
      unmatchedEmployeeIds: result.unmatchedEmployeeIds || [],
      achievedCount,
      expectedBonuses: rows.reduce((sum, row) => sum + row.earned_bonus_amount, 0),
      topEmployee: top ? { employeeId: top.employee_id, employeeName: top.employeeName, amount: top.net_target_amount } : null,
      closeToNextTierCount: closeCount,
    },
    rows,
  };
}

export async function getEmployeeTargetDetails(db, salonId, employeeId, query = {}) {
  const result = await calculateTargetSummaries(db, salonId, { ...query, employeeId });
  const canonicalEmployeeId = cleanText(result.summaries[0]?.employee_id || resolveTargetEmployeeId(result.identityIndex, employeeId) || employeeId);
  const summary = decorateTargetSummary(result.summaries[0] || await summarizeEmployee(db, salonId, result.period, canonicalEmployeeId, []));
  const byService = new Map();
  const byDate = new Map();
  for (const row of summary.ledger) {
    const service = cleanText(row.service_name) || cleanText(row.service_id) || 'Service';
    byService.set(service, (byService.get(service) || 0) + Number(row.eligible_amount || 0));
    const date = cleanText(row.performed_at).slice(0, 10);
    byDate.set(date, (byDate.get(date) || 0) + Number(row.eligible_amount || 0));
  }
  const countedTransactions = summary.ledger.filter((row) =>
    ['service_completed', 'package_session'].includes(cleanText(row.transaction_type)) && Number(row.eligible_amount || 0) > 0
  );
  const refundDeductions = summary.ledger.filter((row) =>
    cleanText(row.transaction_type) === 'service_refund' || Number(row.refund_amount || 0) > 0
  );
  const manualAdjustments = summary.ledger.filter((row) => cleanText(row.transaction_type) === 'manual_adjustment');
  const excludedTransactions = await excludedTargetTransactionsForEmployee(
    db,
    salonId,
    result.period,
    canonicalEmployeeId,
    summary,
    result.identityIndex
  );
  return {
    period: {
      ...result.period,
      is_closed: targetPeriodClosed(result.period) ? 1 : 0,
    },
    summary,
    groupedByService: [...byService.entries()].map(([name, amount]) => ({ name, amount })),
    groupedByDate: [...byDate.entries()].map(([date, amount]) => ({ date, amount })),
    ledger: summary.ledger,
    countedTransactions,
    refundDeductions,
    manualAdjustments,
    excludedTransactions,
    targetCalculation: {
      plan_id: summary.plan_id || null,
      plan_name: summary.plan?.name || null,
      target_amount: summary.current_target_amount,
      net_target_amount: summary.net_target_amount,
      progress_ratio: summary.progress_ratio,
      achieved_tier: summary.achievedTier || null,
      next_tier: summary.nextTier || null,
      earned_bonus_amount: summary.earned_bonus_amount,
      remaining_to_next_tier: summary.remaining_to_next_tier,
      cumulative_tiers: Number(summary.plan?.cumulative_tiers || 0) === 1 ? 1 : 0,
      bonus_type: cleanText(summary.plan?.bonus_type || 'fixed'),
    },
    lastUpdatedAt: summary.last_updated_at,
    isPayrollClosed: targetPeriodClosed(result.period),
    authScope: { own_only: Boolean(query?.ownOnly) },
  };
}

export async function createTargetAdjustment(db, salonId, data = {}, actor = {}) {
  const requestedEmployeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const identityIndex = await loadTargetIdentityIndex(db, salonId);
  const employeeId = requiredId(resolveTargetEmployeeId(identityIndex, requestedEmployeeId) || requestedEmployeeId, 'employeeId');
  if (!identityIndex.employeesById.has(employeeId)) throw new AppError(404, 'employee_targets:employee_not_found');
  const reason = cleanText(data.reason);
  if (!reason) throw new AppError(400, 'employee_targets:adjustment_reason_required');
  const period = await resolvePayrollPeriodForTargets(db, salonId, data);
  const amount = intMoney(data.amountHalalas ?? data.amount_halalas, 'amountHalalas', { allowNegative: true });
  if (amount === 0) throw new AppError(400, 'employee_targets:adjustment_amount_required');
  const now = nowIso();
  const row = {
    id: requiredId(data.id || generatedId('target_ledger')),
    salon_id: salonId,
    employee_id: employeeId,
    booking_id: null,
    booking_item_id: null,
    service_id: null,
    package_session_id: null,
    transaction_type: 'manual_adjustment',
    gross_amount: amount > 0 ? amount : 0,
    discount_amount: 0,
    refund_amount: amount < 0 ? Math.abs(amount) : 0,
    eligible_amount: amount,
    performed_at: optionalText(data.performedAt || data.performed_at) || now,
    payroll_period_id: period.id || null,
    source_reference: optionalText(data.sourceReference || data.source_reference) || `manual_adjustment:${employeeId}:${period.id || period.month_start}:${now}`,
    details_json: JSON.stringify({ reason, notes: optionalText(data.notes) || null, byUid: optionalText(actor.uid) || null }),
    created_by_uid: optionalText(actor.uid) || null,
    created_at: now,
    updated_at: now,
  };
  await insertLedgerRows(db, [row]);
  await recordAudit(db, salonId, {
    action: 'employee_target_adjustment_created',
    entityType: 'employee_target_ledger',
    entityId: row.id,
    after: row,
    source: 'dashboard',
  }, actor);
  return row;
}

export async function upsertTargetSummarySnapshot(db, salonId, summary, status = 'open', actor = {}, payrollEntryId = null) {
  const now = nowIso();
  const id = requiredId(summary.id || `target_summary_${summary.employee_id}_${summary.payroll_period_id || summary.payroll_month || `${summary.period_start}_${summary.period_end}`}`.replace(/[^A-Za-z0-9_-]/g, '_'));
  const row = {
    id,
    salon_id: salonId,
    employee_id: summary.employee_id,
    payroll_period_id: summary.payroll_period_id || null,
    payroll_month: summary.payroll_month || null,
    period_start: summary.period_start,
    period_end: summary.period_end,
    plan_id: summary.plan?.id || summary.plan_id || null,
    plan_snapshot_json: summary.plan ? JSON.stringify(summary.plan) : null,
    total_eligible_services: Number(summary.total_eligible_services || 0),
    total_refunds: Number(summary.total_refunds || 0),
    net_target_amount: Number(summary.net_target_amount || 0),
    achieved_tier_id: summary.achievedTier?.id || null,
    achieved_tier_snapshot_json: summary.achievedTier ? JSON.stringify(summary.achievedTier) : null,
    earned_bonus_amount: Number(summary.earned_bonus_amount || 0),
    status: statusSummary(status),
    approved_at: ['approved', 'posted_to_payroll', 'closed'].includes(status) ? now : null,
    approved_by_uid: ['approved', 'posted_to_payroll', 'closed'].includes(status) ? optionalText(actor.uid) || null : null,
    payroll_entry_id: payrollEntryId || null,
    created_at: now,
    updated_at: now,
  };
  await dbRun(
    db,
    `INSERT INTO employee_target_period_summaries
      (id, salon_id, employee_id, payroll_period_id, payroll_month, period_start, period_end, plan_id,
       plan_snapshot_json, total_eligible_services, total_refunds, net_target_amount,
       achieved_tier_id, achieved_tier_snapshot_json, earned_bonus_amount, status,
       approved_at, approved_by_uid, payroll_entry_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(salon_id, employee_id, payroll_period_id) DO UPDATE SET
       payroll_month = excluded.payroll_month,
       period_start = excluded.period_start,
       period_end = excluded.period_end,
       plan_id = excluded.plan_id,
       plan_snapshot_json = excluded.plan_snapshot_json,
       total_eligible_services = excluded.total_eligible_services,
       total_refunds = excluded.total_refunds,
       net_target_amount = excluded.net_target_amount,
       achieved_tier_id = excluded.achieved_tier_id,
       achieved_tier_snapshot_json = excluded.achieved_tier_snapshot_json,
       earned_bonus_amount = excluded.earned_bonus_amount,
       status = excluded.status,
       approved_at = COALESCE(excluded.approved_at, employee_target_period_summaries.approved_at),
       approved_by_uid = COALESCE(excluded.approved_by_uid, employee_target_period_summaries.approved_by_uid),
       payroll_entry_id = COALESCE(excluded.payroll_entry_id, employee_target_period_summaries.payroll_entry_id),
       updated_at = excluded.updated_at`,
    Object.values(row)
  );
  return dbFirst(db, 'SELECT * FROM employee_target_period_summaries WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, id]);
}

export async function applyTargetBonusToPayrollData(db, salonId, data = {}, actor = {}) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const period = await resolvePayrollPeriodForTargets(db, salonId, data);
  await rebuildEmployeeTargetLedgerForPeriod(db, salonId, {
    periodId: period.id,
    payrollMonth: period.payroll_month,
    periodStart: period.month_start,
    periodEnd: period.month_end,
  });
  const result = await calculateTargetSummaries(db, salonId, { ...data, employeeId, periodId: period.id, payrollMonth: period.payroll_month });
  const summary = result.summaries[0] || await summarizeEmployee(db, salonId, period, employeeId, []);
  const targetSummary = await upsertTargetSummarySnapshot(db, salonId, summary, 'open', actor);
  const rawAdditions = parseJson(data.additions ?? data.additions_json, []);
  const previousTargetBonus = (Array.isArray(rawAdditions) ? rawAdditions : [])
    .filter((item) => cleanText(item?.source || item?.sourceType || item?.source_type) === TARGET_BONUS_SOURCE)
    .reduce((sum, item) => sum + Number(item.amountHalalas || item.amount_halalas || 0), 0);
  const baseAdditions = stripTargetBonusItems(rawAdditions);
  const bonus = Number(summary.earned_bonus_amount || 0);
  const addition = bonus > 0 ? [targetBonusPayrollItem(targetSummary || { ...summary, id: summary.id }, period, summary.plan, summary.achievedTier)] : [];
  const additions = [...baseAdditions, ...addition];
  const bonusDelta = bonus - previousTargetBonus;
  return {
    additions,
    targetBonusHalalas: bonus,
    targetSummary,
    targetComputation: summary,
    manualAdditionsHalalas: Number(data.manualAdditionsHalalas ?? data.manual_additions_halalas ?? 0) + bonusDelta,
    grossSalaryHalalas: Number(data.grossSalaryHalalas ?? data.gross_salary_halalas ?? 0) + bonusDelta,
    finalSalaryHalalas: Number(data.finalSalaryHalalas ?? data.final_salary_halalas ?? 0) + bonusDelta,
    netSalaryHalalas: Number(data.netSalaryHalalas ?? data.net_salary_halalas ?? data.finalSalaryHalalas ?? data.final_salary_halalas ?? 0) + bonusDelta,
  };
}

export async function approveEmployeeTargetSummary(db, salonId, data = {}, actor = {}, payrollEntryId = null) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const result = await calculateTargetSummaries(db, salonId, data);
  const summary = result.summaries.find((row) => row.employee_id === employeeId) || await summarizeEmployee(db, salonId, result.period, employeeId, []);
  const row = await upsertTargetSummarySnapshot(db, salonId, summary, payrollEntryId ? 'posted_to_payroll' : 'approved', actor, payrollEntryId);
  await recordAudit(db, salonId, {
    action: payrollEntryId ? 'employee_target_bonus_posted_to_payroll' : 'employee_target_summary_approved',
    entityType: 'employee_target_period_summary',
    entityId: row.id,
    after: row,
    source: 'payroll',
  }, actor);
  return row;
}

export async function safeRefreshTargetsForBooking(db, salonId, bookingId) {
  try {
    return await refreshEmployeeTargetLedgerForBooking(db, salonId, bookingId);
  } catch (error) {
    const message = cleanText(error?.message).toLowerCase();
    if (message.includes('no such table') || message.includes('unhandled fake d1')) return { skipped: 'schema_missing' };
    if (message.includes('employee_target')) throw error;
    throw error;
  }
}
