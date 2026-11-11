// Conservative reconciliation of materialized target summaries for a historical
// service reassignment. No payroll monetary data is rewritten here: a transfer
// is permitted only when BOTH existing and resulting target bonuses are zero.
import { dbAll, dbFirst, cleanText, nowIso } from '../d1.js';
import { AppError } from '../errors.js';
import { calculateTargetSummaries, calculateTierBonus, serviceIncludedByPlan } from './employee-targets.js';

const invalidSnapshot = () => new AppError(409, 'core_booking_item:target_summary_requires_review');
const int = (value) => Number(value || 0);
const parseArray = (value) => {
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : null; }
  catch { return null; }
};

// Any broken optimistic lock inside D1.batch raises a SQLite error and rolls
// back the complete transaction, including the prior booking-item UPDATE.
const assertPreviousUpdate = {
  sql: "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('INVALID_OPTIMISTIC_LOCK', '$.value') END AS asserted",
  params: [],
};

export async function prepareDraftTargetSummaryTransfer(db, salonId, {
  workDate, serviceId, targetRow, previousStaffId, nextStaffId,
  canonicalPreviousStaffId, canonicalNextStaffId, targetEmployeeIds,
}) {
  const identities = [...new Set(targetEmployeeIds)];
  const placeholders = identities.map(() => '?').join(', ');
  const rows = await dbAll(db,
    `SELECT * FROM employee_target_period_summaries
      WHERE salon_id = ? AND employee_id IN (${placeholders})
        AND period_start <= ? AND period_end >= ?`,
    [salonId, ...identities, workDate, workDate]);
  if (!rows.length) return { snapshots: [], statements: [], atomicGuard: '', atomicGuardParams: [] };
  if (!targetRow || !targetRow.payroll_period_id ||
      !canonicalPreviousStaffId || !canonicalNextStaffId ||
      canonicalPreviousStaffId === canonicalNextStaffId ||
      rows.length !== 2) throw invalidSnapshot();

  const pair = [canonicalPreviousStaffId, canonicalNextStaffId];
  const summaries = await calculateTargetSummaries(db, salonId, { periodId: targetRow.payroll_period_id });
  const snapshotRows = pair.map(id => rows.find(row => cleanText(row.employee_id) === id));
  const calculatedRows = pair.map(id => summaries.summaries.find(row => cleanText(row.employee_id) === id));
  if (snapshotRows.some(row => !row) || calculatedRows.some(row => !row)) throw invalidSnapshot();

  // Ledger summaries filter persisted employee_target_ledger rows. Those rows
  // contain service_id but no category_id: use EXACTLY the same row shape,
  // otherwise category-specific plans yield incorrect transfer deltas.
  const item = { service_id: serviceId };
  const amount = int(targetRow.eligible_amount);
  if (!Number.isSafeInteger(amount) || amount < 0) throw invalidSnapshot();
  const now = nowIso();
  const changes = [];
  const statements = [];
  const guardClauses = [];
  const guardParams = [];

  for (let index = 0; index < 2; index += 1) {
    const snapshot = snapshotRows[index];
    const calculated = calculatedRows[index];
    const id = pair[index];
    const delta = (index === 0 ? -amount : amount) *
      Number(serviceIncludedByPlan(calculated.plan, item));

    if (cleanText(snapshot.payroll_period_id) !== cleanText(targetRow.payroll_period_id) ||
        cleanText(snapshot.payroll_month) !== cleanText(summaries.period.payroll_month) ||
        !['open', 'posted_to_payroll'].includes(snapshot.status) ||
        int(snapshot.earned_bonus_amount) !== 0 ||
        int(calculated.earned_bonus_amount) !== 0 ||
        int(snapshot.total_eligible_services) !== int(calculated.total_eligible_services) ||
        int(snapshot.net_target_amount) !== int(calculated.net_target_amount) ||
        int(snapshot.total_refunds) !== int(calculated.total_refunds) ||
        cleanText(snapshot.plan_id) !== cleanText(calculated.plan?.id) ||
        cleanText(snapshot.achieved_tier_id) !== cleanText(calculated.achievedTier?.id)) throw invalidSnapshot();

    const newNet = int(calculated.net_target_amount) + delta;
    const newGross = int(calculated.total_eligible_services) + delta;
    if (newNet < 0 || newGross < 0) throw invalidSnapshot();
    const newTier = calculateTierBonus(newNet, calculated.plan, calculated.tiers);
    if (newTier.bonusAmount !== 0 ||
        cleanText(newTier.achievedTier?.id) !== cleanText(calculated.achievedTier?.id)) throw invalidSnapshot();

    const payrollId = cleanText(snapshot.payroll_entry_id);
    if (snapshot.status === 'posted_to_payroll' && !payrollId) throw invalidSnapshot();
    if (payrollId) {
      const payroll = await dbFirst(db,
        'SELECT id, employee_id, payroll_month, status, additions_json FROM payroll_entries WHERE salon_id = ? AND id = ? LIMIT 1',
        [salonId, payrollId]);
      const additions = parseArray(payroll?.additions_json);
      if (!payroll || !additions || cleanText(payroll.employee_id) !== id ||
          cleanText(payroll.payroll_month) !== cleanText(summaries.period.payroll_month) ||
          cleanText(payroll.status).toLowerCase() !== 'draft' ||
          additions.some(entry => ['employee_target_bonus'].includes(cleanText(entry?.source || entry?.sourceType || entry?.source_type)))) throw invalidSnapshot();
      guardClauses.push(`EXISTS (SELECT 1 FROM payroll_entries
        WHERE salon_id = ? AND id = ? AND employee_id = ? AND payroll_month = ?
          AND status = 'draft' AND COALESCE(additions_json, '[]') = ?)`);
      guardParams.push(salonId, payrollId, id, payroll.payroll_month, payroll.additions_json || '[]');
    }
    // This CAS is rerun inside the same D1 transaction after the booking
    // attribution has changed, guarding against a racing payroll publication.
    guardClauses.push(`EXISTS (SELECT 1 FROM employee_target_period_summaries
      WHERE salon_id = ? AND id = ? AND employee_id = ? AND status = ?
        AND net_target_amount = ? AND total_eligible_services = ?
        AND earned_bonus_amount = 0 AND COALESCE(updated_at, '') = ?)`);
    guardParams.push(salonId, snapshot.id, id, snapshot.status,
      int(snapshot.net_target_amount), int(snapshot.total_eligible_services), snapshot.updated_at);
    statements.push({
      sql: `UPDATE employee_target_period_summaries
        SET net_target_amount = ?, total_eligible_services = ?, updated_at = ?
        WHERE salon_id = ? AND id = ? AND employee_id = ? AND status = ?
          AND net_target_amount = ? AND total_eligible_services = ?
          AND earned_bonus_amount = 0 AND COALESCE(updated_at, '') = ?`,
      params: [newNet, newGross, now, salonId, snapshot.id, id, snapshot.status,
        int(snapshot.net_target_amount), int(snapshot.total_eligible_services), snapshot.updated_at],
    }, assertPreviousUpdate);
    changes.push({ employeeId: id, previousAmount: int(snapshot.net_target_amount), newAmount: newNet, bonusAmount: 0 });
  }

  return {
    snapshots: changes,
    statements,
    atomicGuard: guardClauses.map(clause => `AND ${clause}`).join('\n'),
    atomicGuardParams: guardParams,
  };
}
