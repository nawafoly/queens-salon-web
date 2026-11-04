// Read-only employee material custody, derived from the append-mostly ledger.
// Each item/employee/unit is separate; quantities from different units are
// never added into a meaningless grand total.
import { dbAll, requiredId } from '../d1.js';

export async function getEmployeeCustodyReport(db, salonId, query = {}) {
  const employeeId = query.employeeId || query.employee_id;
  const params = [salonId];
  let employeeFilter = '';
  if (employeeId) {
    employeeFilter = 'AND m.employee_id = ?';
    params.push(requiredId(employeeId, 'employeeId'));
  }

  const rows = await dbAll(db, `
    SELECT m.employee_id,
      COALESCE(s.name, m.employee_id) AS employee_name,
      m.item_id, COALESCE(i.name, m.item_id) AS item_name,
      m.unit,
      SUM(CASE WHEN m.movement_type = 'EMPLOYEE_ISSUE_OUT' THEN -m.quantity_delta ELSE 0 END) AS issued_qty,
      SUM(CASE WHEN m.movement_type = 'EMPLOYEE_RETURN_IN' THEN m.quantity_delta ELSE 0 END) AS returned_qty,
      SUM(-m.quantity_delta) AS outstanding_qty
    FROM inventory_stock_movements m
    LEFT JOIN inventory_items i ON i.salon_id = m.salon_id AND i.id = m.item_id
    LEFT JOIN staff s ON s.salon_id = m.salon_id AND s.id = m.employee_id
    WHERE m.salon_id = ? AND m.employee_id IS NOT NULL AND TRIM(m.employee_id) <> ''
      AND m.movement_type IN ('EMPLOYEE_ISSUE_OUT', 'EMPLOYEE_RETURN_IN')
      ${employeeFilter}
    GROUP BY m.employee_id, s.name, m.item_id, i.name, m.unit
    HAVING ABS(SUM(-m.quantity_delta)) > 0.000000001
    ORDER BY employee_name, item_name, m.unit`, params);

  return {
    lines: rows,
    summary: {
      outstanding_lines: rows.filter((row) => Number(row.outstanding_qty) > 0).length,
      anomalies: rows.filter((row) => Number(row.outstanding_qty) < 0).length,
    },
  };
}
