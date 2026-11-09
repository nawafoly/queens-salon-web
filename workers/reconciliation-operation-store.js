// Shared durable lifecycle; each database owns its local transactional outbox.
function validTable(table) {
  if (!['attendance_operations','hr_payroll_operations'].includes(table)) throw new Error('invalid_operation_table');
}
export async function readReconciliationOperation(db,id,table='attendance_operations') {
  validTable(table);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first();
}
export async function processReconciliationOperation(db, id, reconcile, table = "attendance_operations") {
  validTable(table);
  let op = await readReconciliationOperation(db,id,table);
  if (!op || op.status !== 'pending') return op;
  const now = new Date().toISOString();
  const token = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE ${table}
    SET lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
    WHERE id=? AND status='pending' AND next_attempt_at<=?
      AND (lease_until IS NULL OR lease_until<=?)
      AND NOT EXISTS (SELECT 1 FROM ${table} other WHERE other.employee_uid=${table}.employee_uid
        AND other.id<>${table}.id AND other.lease_until>?)`)
    .bind(token,new Date(Date.now()+300000).toISOString(),now,id,now,now,now).run();
  if (!claimed.meta?.changes) return readReconciliationOperation(db,id,table);
  op = await readReconciliationOperation(db,id,table);
  try {
    const result = await reconcile(op);
    await db.prepare(`UPDATE ${table} SET status='completed',reconciliation_json=?,
      last_error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?`)
      .bind(JSON.stringify(result),new Date().toISOString(),id,token).run();
  } catch (error) {
    const exhausted = op.attempts >= 8;
    const next = new Date(Date.now()+Math.min(3600000,30000*2**(op.attempts-1))).toISOString();
    await db.prepare(`UPDATE ${table} SET status=?,last_error=?,next_attempt_at=?,
      lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?`)
      .bind(exhausted ? 'needs_attention' : 'pending',String(error?.message || error).slice(0,1000),
        next,new Date().toISOString(),id,token).run();
  }
  return readReconciliationOperation(db,id,table);
}

export async function retryReconciliationOperations(db, reconcile, limit = 20, table = "attendance_operations") {
  validTable(table);
  const now = new Date().toISOString();
  const rows = await db.prepare(`SELECT id FROM ${table} WHERE status='pending'
    AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY created_at LIMIT ?`)
    .bind(now,now,limit).all();
  for (const row of rows.results || []) await processReconciliationOperation(db,row.id,reconcile,table);
}
