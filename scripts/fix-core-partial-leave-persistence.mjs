import fs from 'node:fs';

const path = 'workers/core/repositories/leaves.js';
let text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const explicitParams = `    params: [
      row.id,
      row.salon_id,
      row.employee_id,
      row.employee_uid,
      row.employee_name,
      row.employee_email,
      row.status,
      row.leave_type,
      row.start_date,
      row.end_date,
      row.days_count,
      row.duration_kind,
      row.partial_start_time,
      row.partial_end_time,
      row.request_id,
      row.employee_note,
      row.hr_note,
      row.decided_at,
      row.decided_by_uid,
      row.decided_by_email,
      row.decided_by_name,
      row.created_at,
      row.updated_at,
    ],`;

if (!text.includes(explicitParams)) {
  const oldParams = '    params: Object.values(row),';
  const count = text.split(oldParams).length - 1;
  if (count !== 1) {
    throw new Error(`[partial-leave-persistence] expected one Object.values(row) leave INSERT, found ${count}`);
  }
  text = text.replace(oldParams, explicitParams);
}

const requiredFragments = [
  "duration_kind: durationKind",
  "partial_start_time: partialStartTime",
  "partial_end_time: partialEndTime",
  "request_id: optionalText(data.requestId || data.request_id) || null",
  "start_date, end_date, days_count, duration_kind, partial_start_time, partial_end_time, request_id",
  "status === 'approved' && cleanText(leave.duration_kind).toLowerCase() !== 'partial'",
  "leave.status === 'approved' && cleanText(leave.duration_kind).toLowerCase() !== 'partial'",
];

for (const fragment of requiredFragments) {
  if (!text.includes(fragment)) {
    throw new Error(`[partial-leave-persistence] required Core partial-leave contract is missing: ${fragment}`);
  }
}

if (text.includes('Object.values(row)')) {
  throw new Error('[partial-leave-persistence] Object.values(row) must not remain in leave INSERT');
}

fs.writeFileSync(path, `${text.replace(/\s+$/g, '')}\n`, 'utf8');
console.log('[partial-leave-persistence] explicit Core leave persistence contract installed');
