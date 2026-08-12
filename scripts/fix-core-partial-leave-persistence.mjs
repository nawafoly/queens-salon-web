import fs from 'node:fs';

const path = 'workers/core/repositories/leaves.js';
let text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

function replaceOnce(oldText, newText, label) {
  if (text.includes(newText)) return;
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`[partial-leave-persistence] ${label}: expected 1 match, found ${count}`);
  text = text.replace(oldText, newText);
}

// The staged cutover intentionally inserts normalized partial-day fields beside
// days_count. The historical row already carried raw partial fields at the end,
// which creates duplicate object keys and makes persistence/order hard to reason
// about. Keep exactly one authoritative normalized set.
replaceOnce(
`    updated_at: now,
    duration_kind: optionalText(data.durationKind || data.duration_kind) || null,
    partial_start_time: optionalText(data.partialStartTime || data.partial_start_time) || null,
    partial_end_time: optionalText(data.partialEndTime || data.partial_end_time) || null,
    request_id: optionalText(data.requestId || data.request_id) || null,
  };`,
`    updated_at: now,
  };`,
'remove duplicate trailing partial fields'
);

// Never rely on Object.values(row) for SQL persistence. Column order is part of
// the database contract and must stay explicit, especially when migrations add
// fields in the middle of an INSERT statement.
replaceOnce(
`    Object.values(row)
  );`,
`    [
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
    ]
  );`,
'explicit leave INSERT parameter order'
);

if (!text.includes("duration_kind: durationKind")) {
  throw new Error('[partial-leave-persistence] normalized duration_kind is missing');
}
if (!text.includes("status === 'approved' && cleanText(leave.duration_kind).toLowerCase() !== 'partial'")) {
  throw new Error('[partial-leave-persistence] partial approval mirror guard is missing');
}
if (text.includes('Object.values(row)')) {
  throw new Error('[partial-leave-persistence] Object.values(row) must not remain in leave INSERT');
}

fs.writeFileSync(path, `${text.replace(/\s+$/g, '')}\n`, 'utf8');
console.log('[partial-leave-persistence] explicit Core leave persistence contract installed');
