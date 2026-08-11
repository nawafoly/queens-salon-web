import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const bookingPath = path.join(root, 'src/pages/Booking.tsx');
const testsPath = path.join(root, 'workers/core-worker.test.mjs');

function read(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return { raw, eol: raw.includes('\r\n') ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') };
}
function write(file, src, text) {
  const next = src.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  if (next !== src.raw) fs.writeFileSync(file, next, 'utf8');
  return next !== src.raw;
}

// Replace a function call with a balanced-parentheses parser instead of brittle full-text matching.
function replaceCalls(source, functionName, replacer) {
  let text = source;
  let cursor = 0;
  let count = 0;
  const needle = `${functionName}(`;
  while (true) {
    const start = text.indexOf(needle, cursor);
    if (start < 0) break;
    let i = start + needle.length;
    let depth = 1;
    let quote = '';
    let escaped = false;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(`[booking-callsite-sweep] unbalanced call: ${functionName}`);
    const full = text.slice(start, i + 1);
    const args = full.slice(needle.length, -1);
    const replacement = replacer(args, full);
    text = text.slice(0, start) + replacement + text.slice(i + 1);
    cursor = start + replacement.length;
    count += 1;
  }
  return { text, count };
}

function splitTopLevelArgs(args) {
  const out = [];
  let current = '';
  let round = 0, curly = 0, square = 0;
  let quote = '', escaped = false;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote) {
      current += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; current += ch; continue; }
    if (ch === '(') round += 1;
    else if (ch === ')') round -= 1;
    else if (ch === '{') curly += 1;
    else if (ch === '}') curly -= 1;
    else if (ch === '[') square += 1;
    else if (ch === ']') square -= 1;
    if (ch === ',' && round === 0 && curly === 0 && square === 0) {
      out.push(current.trim()); current = ''; continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function readObjectProp(objectText, prop) {
  const re = new RegExp(`\\b${prop}\\s*:\\s*([^,}]+)`);
  const match = objectText.match(re);
  return match ? match[1].trim() : '';
}

{
  const src = read(bookingPath);
  let text = src.text;

  let result = replaceCalls(text, 'resolveStaffWorkingWindowsForDate', (args) => {
    const parts = splitTopLevelArgs(args);
    const staffExpr = parts[0] || 'staff as any';
    const options = parts[1] || '{}';
    const dateExpr = readObjectProp(options, 'dateISO') || 'dateISO';
    return `getCoreStaffWindows(${dateExpr}, String((${staffExpr})?.id || "").trim())`;
  });
  text = result.text;
  console.log(`[booking-callsite-sweep] resolveStaffWorkingWindowsForDate replaced: ${result.count}`);

  result = replaceCalls(text, 'filterStaffSlotsByWorkingHours', (args) => {
    const parts = splitTopLevelArgs(args);
    const staffExpr = parts[0] || 'staff as any';
    const options = parts[1] || '{}';
    const dateExpr = readObjectProp(options, 'dateISO') || 'dateISO';
    const slotsExpr = readObjectProp(options, 'slots') || '[]';
    return `filterSlotsToCoreWindows(${slotsExpr}, getCoreStaffWindows(${dateExpr}, String((${staffExpr})?.id || "").trim()))`;
  });
  text = result.text;
  console.log(`[booking-callsite-sweep] filterStaffSlotsByWorkingHours replaced: ${result.count}`);

  // Make callback types explicit where the old helper used to provide inference.
  text = text.replace(/\.filter\(\(slot\) =>/g, '.filter((slot: TimeSlot) =>');
  text = text.replace(/\.some\(\(s\) => String\(s\.value24/g, '.some((s: TimeSlot) => String(s.value24');

  const forbidden = ['resolveStaffWorkingWindowsForDate(', 'filterStaffSlotsByWorkingHours('];
  const remaining = forbidden.filter((needle) => text.includes(needle));
  if (remaining.length) throw new Error(`[booking-callsite-sweep] forbidden references remain: ${remaining.join(', ')}`);

  console.log(`[booking-callsite-sweep] Booking.tsx: ${write(bookingPath, src, text) ? 'updated' : 'unchanged'}`);
}

// Test-only: every extra service used by booking tests must explicitly be assigned to staff-a.
{
  const src = read(testsPath);
  let text = src.text;
  const serviceIds = ['svc-b', 'svc-blowdry-short', 'svc-blowdry-long'];
  let inserted = 0;

  for (const serviceId of serviceIds) {
    let cursor = 0;
    const marker = `id: "${serviceId}"`;
    while (true) {
      const markerAt = text.indexOf(marker, cursor);
      if (markerAt < 0) break;
      const seedStart = text.lastIndexOf('fake.seed("services", {', markerAt);
      if (seedStart < 0) { cursor = markerAt + marker.length; continue; }
      const seedEnd = text.indexOf('\n  });', markerAt);
      if (seedEnd < 0) { cursor = markerAt + marker.length; continue; }
      const after = seedEnd + '\n  });'.length;
      const nearby = text.slice(after, Math.min(text.length, after + 420));
      const assignmentMarker = `service_id: "${serviceId}"`;
      if (!nearby.includes('fake.seed("staff_services"') || !nearby.includes(assignmentMarker)) {
        const block = `\n  fake.seed("staff_services", {\n    salon_id: "main",\n    staff_id: "staff-a",\n    service_id: "${serviceId}",\n    active: 1,\n    created_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",\n    updated_at: typeof now === "string" ? now : "2026-01-01T00:00:00.000Z",\n  });`;
        text = text.slice(0, after) + block + text.slice(after);
        cursor = after + block.length;
        inserted += 1;
      } else {
        cursor = after;
      }
    }
  }

  console.log(`[booking-callsite-sweep] test staff_service assignments inserted: ${inserted}`);
  console.log(`[booking-callsite-sweep] core-worker.test.mjs: ${write(testsPath, src, text) ? 'updated' : 'unchanged'}`);
}

console.log('[booking-callsite-sweep] completed.');
