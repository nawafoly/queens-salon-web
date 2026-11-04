-- Read-only employee custody report index. No movement or balance mutation.
-- Apply to isolated Staging only before testing; Production release requires
-- explicit approval and backup.
CREATE INDEX IF NOT EXISTS idx_inv_movements_employee_custody
  ON inventory_stock_movements (salon_id, movement_type, employee_id, item_id);
