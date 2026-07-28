// CORE D1 ONLY — reusable shift templates and date-effective assignments.
import {
  activeFlag,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  generatedId,
  integer,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
  rowNotFound,
} from '../d1.js';

function dateKey(value, field) {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error(`${field}_invalid`);
    error.code = 'core_hr:invalid_date';
    throw error;
  }
  return text;
}

function timeValue(value, field, nullable = true) {
  const text = cleanText(value);
  if (!text && nullable) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) {
    const error = new Error(`${field}_invalid`);
    error.code = 'core_hr:invalid_time';
    throw error;
  }
  return text;
}

function jsonObject(value) {
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value)); } catch {}
  }
  return JSON.stringify(value && typeof value === 'object' ? value : {});
}

function addDays(dateKeyValue, days) {
  const [year, month, day] = String(dateKeyValue).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

async function audit(db, salonId, actor, action, entityType, entityId, before, after, reason) {
  await dbBatch(db, [{
    sql: `INSERT INTO hr_shift_audit_log
      (id, salon_id, actor_uid, action, entity_type, entity_id, before_json, after_json, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [generatedId('shift_audit'), salonId, optionalText(actor?.uid) || null, action,
      entityType, entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null,
      optionalText(reason) || null, nowIso()],
  }]);
}

export async function listShiftTemplates(db, salonId, query = {}) {
  const rows = await dbAll(db,
    `SELECT * FROM hr_shift_templates WHERE salon_id = ?
     ${cleanText(query.active) === 'all' ? '' : 'AND active = 1'} ORDER BY name`, [salonId]);
  return rows;
}

export async function saveShiftTemplate(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = requiredId(data.id || generatedId('shift'));
  const before = await dbFirst(db, 'SELECT * FROM hr_shift_templates WHERE salon_id = ? AND id = ?', [salonId, id]);
  const row = {
    id, salon_id: salonId, name: requiredText(data.name, 'name'), code: optionalText(data.code) || null,
    start_time: timeValue(data.startTime ?? data.start_time, 'startTime'),
    end_time: timeValue(data.endTime ?? data.end_time, 'endTime'),
    crosses_midnight: activeFlag(data.crossesMidnight ?? data.crosses_midnight, 0),
    break_minutes: integer(data.breakMinutes ?? data.break_minutes ?? 0, 'breakMinutes', { min: 0, max: 720 }),
    break_paid: activeFlag(data.breakPaid ?? data.break_paid, 0),
    late_grace_minutes: integer(data.lateGraceMinutes ?? data.late_grace_minutes ?? 0, 'lateGraceMinutes', { min: 0, max: 240 }),
    early_leave_grace_minutes: integer(data.earlyLeaveGraceMinutes ?? data.early_leave_grace_minutes ?? 0, 'earlyLeaveGraceMinutes', { min: 0, max: 240 }),
    overtime_after_minutes: integer(data.overtimeAfterMinutes ?? data.overtime_after_minutes ?? 0, 'overtimeAfterMinutes', { min: 0, max: 1440 }),
    active: activeFlag(data.active, 1), created_at: before?.created_at || now, updated_at: now,
  };
  await dbBatch(db, [{
    sql: `INSERT INTO hr_shift_templates
      (id, salon_id, name, code, start_time, end_time, crosses_midnight, break_minutes, break_paid,
       late_grace_minutes, early_leave_grace_minutes, overtime_after_minutes, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, code=excluded.code, start_time=excluded.start_time,
       end_time=excluded.end_time, crosses_midnight=excluded.crosses_midnight, break_minutes=excluded.break_minutes,
       break_paid=excluded.break_paid, late_grace_minutes=excluded.late_grace_minutes,
       early_leave_grace_minutes=excluded.early_leave_grace_minutes,
       overtime_after_minutes=excluded.overtime_after_minutes, active=excluded.active, updated_at=excluded.updated_at`,
    params: Object.values(row),
  }]);
  const saved = await dbFirst(db, 'SELECT * FROM hr_shift_templates WHERE salon_id = ? AND id = ?', [salonId, id]);
  await audit(db, salonId, actor, before ? 'update' : 'create', 'shift_template', id, before, saved, data.reason);
  return saved;
}

export async function listShiftAssignments(db, salonId, query = {}) {
  const employeeId = optionalText(query.employeeId || query.employee_id);
  return dbAll(db,
    `SELECT a.*, t.name AS shift_name, t.code AS shift_code
       FROM hr_shift_assignments a LEFT JOIN hr_shift_templates t ON t.id = a.shift_template_id
      WHERE a.salon_id = ? ${employeeId ? 'AND a.employee_id = ?' : ''}
      ORDER BY a.employee_id, a.effective_from DESC`, employeeId ? [salonId, employeeId] : [salonId]);
}

export async function createShiftAssignment(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = requiredId(data.id || generatedId('shift_assignment'));
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const effectiveFrom = dateKey(data.effectiveFrom || data.effective_from, 'effectiveFrom');
  const effectiveToRaw = optionalText(data.effectiveTo || data.effective_to);
  const effectiveTo = effectiveToRaw ? dateKey(effectiveToRaw, 'effectiveTo') : null;
  if (effectiveTo && effectiveTo < effectiveFrom) throw Object.assign(new Error('effective_range_invalid'), { code: 'core_hr:invalid_date_range' });
  const shouldReplaceOverlaps = activeFlag(data.replaceOverlaps ?? data.closeExisting ?? data.closeOpenAssignments, 0) === 1;
  if (shouldReplaceOverlaps) {
    const overlappingRows = await dbAll(db,
      `SELECT * FROM hr_shift_assignments WHERE salon_id=? AND employee_id=? AND status!='cancelled'
        AND effective_from <= COALESCE(?, '9999-12-31') AND COALESCE(effective_to, '9999-12-31') >= ?
        ORDER BY effective_from`,
      [salonId, employeeId, effectiveTo, effectiveFrom]);
    for (const existing of overlappingRows) {
      if (existing.effective_from < effectiveFrom) {
        const closedTo = addDays(effectiveFrom, -1);
        await dbBatch(db, [{
          sql: `UPDATE hr_shift_assignments SET effective_to=?, updated_at=? WHERE salon_id=? AND id=?`,
          params: [closedTo, now, salonId, existing.id],
        }]);
        const after = await dbFirst(db, 'SELECT * FROM hr_shift_assignments WHERE salon_id=? AND id=?', [salonId, existing.id]);
        await audit(db, salonId, actor, 'close', 'shift_assignment', existing.id, existing, after, data.reason || 'replace_overlap');
      } else {
        await dbBatch(db, [{
          sql: `UPDATE hr_shift_assignments SET status='cancelled', updated_at=? WHERE salon_id=? AND id=?`,
          params: [now, salonId, existing.id],
        }]);
        const after = await dbFirst(db, 'SELECT * FROM hr_shift_assignments WHERE salon_id=? AND id=?', [salonId, existing.id]);
        await audit(db, salonId, actor, 'cancel', 'shift_assignment', existing.id, existing, after, data.reason || 'replace_overlap');
      }
    }
  }

  const overlap = await dbFirst(db,
    `SELECT id FROM hr_shift_assignments WHERE salon_id=? AND employee_id=? AND status!='cancelled'
      AND effective_from <= COALESCE(?, '9999-12-31') AND COALESCE(effective_to, '9999-12-31') >= ? LIMIT 1`,
    [salonId, employeeId, effectiveTo, effectiveFrom]);
  if (overlap) throw Object.assign(new Error('shift_assignment_overlap'), { code: 'core_hr:shift_assignment_overlap' });
  const templateId = optionalText(data.shiftTemplateId || data.shift_template_id) || null;
  const template = templateId ? await dbFirst(db, 'SELECT * FROM hr_shift_templates WHERE salon_id=? AND id=?', [salonId, templateId]) : null;
  if (templateId && !template) rowNotFound('shift_template');
  const snapshot = data.snapshot || template || {};
  const row = [id, salonId, employeeId, templateId, effectiveFrom, effectiveTo,
    cleanText(data.assignmentType || data.assignment_type || 'permanent'),
    cleanText(data.status || 'published'), optionalText(data.reason) || null, jsonObject(snapshot),
    optionalText(actor.uid) || null, now, now];
  await dbBatch(db, [{
    sql: `INSERT INTO hr_shift_assignments
      (id,salon_id,employee_id,shift_template_id,effective_from,effective_to,assignment_type,status,reason,snapshot_json,created_by_uid,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, params: row,
  }]);
  const saved = await dbFirst(db, 'SELECT * FROM hr_shift_assignments WHERE salon_id=? AND id=?', [salonId, id]);
  await audit(db, salonId, actor, 'create', 'shift_assignment', id, null, saved, data.reason);
  return saved;
}


export async function updateShiftAssignment(db, salonId, idValue, data, actor = {}) {
  const id = requiredId(idValue, 'id');
  const before = await dbFirst(db, 'SELECT * FROM hr_shift_assignments WHERE salon_id=? AND id=?', [salonId, id]);
  if (!before) rowNotFound('shift_assignment');
  const now = nowIso();
  const effectiveToRaw = data.effectiveTo ?? data.effective_to;
  const effectiveTo = effectiveToRaw === null || effectiveToRaw === '' ? null : dateKey(effectiveToRaw, 'effectiveTo');
  const status = optionalText(data.status) || before.status;
  await dbBatch(db, [{
    sql: `UPDATE hr_shift_assignments SET effective_to=?, status=?, reason=COALESCE(?, reason), updated_at=? WHERE salon_id=? AND id=?`,
    params: [effectiveTo, status, optionalText(data.reason) || null, now, salonId, id],
  }]);
  const saved = await dbFirst(db, 'SELECT * FROM hr_shift_assignments WHERE salon_id=? AND id=?', [salonId, id]);
  await audit(db, salonId, actor, 'update', 'shift_assignment', id, before, saved, data.reason);
  return saved;
}

export async function cancelShiftAssignment(db, salonId, idValue, data = {}, actor = {}) {
  return updateShiftAssignment(db, salonId, idValue, { status: 'cancelled', effectiveTo: data.effectiveTo ?? null, reason: data.reason || 'cancelled' }, actor);
}

export async function createScheduleException(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = requiredId(data.id || generatedId('schedule_exception'));
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const from = dateKey(data.dateFrom || data.date_from, 'dateFrom');
  const to = dateKey(data.dateTo || data.date_to || from, 'dateTo');
  if (to < from) throw Object.assign(new Error('exception_range_invalid'), { code: 'core_hr:invalid_date_range' });
  const row = [id, salonId, employeeId, from, to, requiredText(data.exceptionType || data.exception_type, 'exceptionType'),
    optionalText(data.shiftTemplateId || data.shift_template_id) || null, activeFlag(data.enabled, 1),
    timeValue(data.startTime || data.start_time, 'startTime'), timeValue(data.endTime || data.end_time, 'endTime'),
    optionalText(data.note) || null, cleanText(data.status || 'approved'), optionalText(data.approvedByUid || actor.uid) || null,
    optionalText(actor.uid) || null, now, now];
  await dbBatch(db, [{ sql: `INSERT INTO hr_schedule_exceptions
    (id,salon_id,employee_id,date_from,date_to,exception_type,shift_template_id,enabled,start_time,end_time,note,status,approved_by_uid,created_by_uid,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, params: row }]);
  const saved = await dbFirst(db, 'SELECT * FROM hr_schedule_exceptions WHERE salon_id=? AND id=?', [salonId, id]);
  await audit(db, salonId, actor, 'create', 'schedule_exception', id, null, saved, data.note);
  return saved;
}

export async function listScheduleExceptions(db, salonId, query = {}) {
  const employeeId = optionalText(query.employeeId || query.employee_id);
  return dbAll(db, `SELECT * FROM hr_schedule_exceptions WHERE salon_id=? ${employeeId ? 'AND employee_id=?' : ''}
    ORDER BY date_from DESC`, employeeId ? [salonId, employeeId] : [salonId]);
}


export async function updateScheduleException(db, salonId, idValue, data, actor = {}) {
  const id = requiredId(idValue, 'id');
  const before = await dbFirst(db, 'SELECT * FROM hr_schedule_exceptions WHERE salon_id=? AND id=?', [salonId, id]);
  if (!before) rowNotFound('schedule_exception');
  const now = nowIso();
  const status = optionalText(data.status) || before.status;
  const enabled = data.enabled === undefined ? before.enabled : activeFlag(data.enabled, before.enabled);
  await dbBatch(db, [{
    sql: `UPDATE hr_schedule_exceptions SET status=?, enabled=?, note=COALESCE(?, note), updated_at=? WHERE salon_id=? AND id=?`,
    params: [status, enabled, optionalText(data.note) || null, now, salonId, id],
  }]);
  const saved = await dbFirst(db, 'SELECT * FROM hr_schedule_exceptions WHERE salon_id=? AND id=?', [salonId, id]);
  await audit(db, salonId, actor, 'update', 'schedule_exception', id, before, saved, data.note);
  return saved;
}

export async function resolveEmployeeShift(db, salonId, employeeIdValue, dateValue) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const date = dateKey(dateValue, 'date');
  const exception = await dbFirst(db, `SELECT e.*, t.name AS shift_name, t.start_time AS template_start_time,
    t.end_time AS template_end_time, t.crosses_midnight, t.break_minutes, t.late_grace_minutes,
    t.early_leave_grace_minutes, t.overtime_after_minutes
    FROM hr_schedule_exceptions e LEFT JOIN hr_shift_templates t ON t.id=e.shift_template_id
    WHERE e.salon_id=? AND e.employee_id=? AND e.status='approved' AND e.date_from<=? AND e.date_to>=?
    ORDER BY e.created_at DESC LIMIT 1`, [salonId, employeeId, date, date]);
  if (exception) return { source: 'exception', date, ...exception };
  const assignment = await dbFirst(db, `SELECT a.*, t.name AS shift_name FROM hr_shift_assignments a
    LEFT JOIN hr_shift_templates t ON t.id=a.shift_template_id
    WHERE a.salon_id=? AND a.employee_id=? AND a.status='published' AND a.effective_from<=?
      AND (a.effective_to IS NULL OR a.effective_to>=?) ORDER BY a.effective_from DESC LIMIT 1`,
    [salonId, employeeId, date, date]);
  return assignment ? { source: 'assignment', date, ...assignment } : { source: 'none', date, employee_id: employeeId };
}
