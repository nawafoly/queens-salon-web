import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const bookingPath = path.join(root, 'src/pages/Booking.tsx');
const testsPath = path.join(root, 'workers/core-worker.test.mjs');

function readSource(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return { raw, eol: raw.includes('\r\n') ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') };
}

function writeSource(filePath, source, text) {
  const next = source.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  if (next === source.raw) return false;
  fs.writeFileSync(filePath, next, 'utf8');
  return true;
}

function replaceRegex(text, regex, replacement, label, { min = 1, max = 1 } = {}) {
  const matches = [...text.matchAll(regex)];
  if (matches.length < min || matches.length > max) {
    throw new Error(`[booking-cutover-resilient] ${label}: expected ${min}..${max} matches, found ${matches.length}`);
  }
  return text.replace(regex, replacement);
}

function ensureServiceAssignment(text, serviceId, anchorRegex, label) {
  const assignmentNeedle = `staff_id: "staff-a", service_id: "${serviceId}"`;
  if (text.includes(assignmentNeedle)) return text;

  const matches = [...text.matchAll(anchorRegex)];
  if (matches.length !== 1) {
    throw new Error(`[booking-cutover-resilient] ${label}: expected one service seed, found ${matches.length}`);
  }
  const full = matches[0][0];
  const nowExpr = full.includes('created_at: now') ? 'now' : '"2026-01-01T00:00:00.000Z"';
  const assignment = `\n  fake.seed("staff_services", { salon_id: "main", staff_id: "staff-a", service_id: "${serviceId}", active: 1, created_at: ${nowExpr}, updated_at: ${nowExpr} });`;
  return text.replace(anchorRegex, `${full}${assignment}`);
}

// Booking.tsx: remove the five remaining legacy/static schedule decisions.
{
  const src = readSource(bookingPath);
  let text = src.text;

  // 1) Automatic staff candidate selection: Core availability below is authoritative.
  if (text.includes('filterStaffSlotsByWorkingHours(st as any')) {
    text = replaceRegex(
      text,
      /        const candidateStaff = bookingVisibleStaff\.filter\(\(st\) => \{\n          const leave = getStaffLeaveMetaForDate\(st, dateISO\);\n          if \(leave\.isOnLeave\) return false;\n          const workingSlots = filterStaffSlotsByWorkingHours\(st as any, \{[\s\S]*?\n          return workingSlots\.length > 0;\n        \}\);/g,
      `        // Core availability is the only dated schedule/leave truth.\n        const candidateStaff = bookingVisibleStaff;`,
      'automatic candidate legacy filter'
    );
  }

  // 2) Full-day staff state: do not pre-filter from mapped legacy hours.
  text = replaceRegex(
    text,
    /              const leave = getStaffLeaveMetaForDate\(st as any, dateISO\);\n              const workingSlots = filterStaffSlotsByWorkingHours\(st as any, \{[\s\S]*?\n              if \(leave\.isOnLeave \|\| !workingSlots\.length\) \{\n                nextState\[itemId\]\[empId\] = false;\n                return;\n              \}\n\n/g,
    `              // Core availability below decides leave, weekly off, exceptions and shift window.\n`,
    'full-day state legacy prefilter',
    { min: 1, max: 1 }
  );

  // 3 + 4) Validation blocks: replace both dated legacy window resolvers with cached Core scheduleWindows.
  text = replaceRegex(
    text,
    /      const staffWindows = resolveStaffWorkingWindowsForDate\(staff as any, \{\n        dateISO: (date|d),\n        fallbackOpenTime: dayOpenTime,\n        fallbackCloseTime: dayCloseTime,\n      \}\);\n      if \(!staffWindows\.length\) ([^\n]+)\n      const staffWorkingStarts = filterStaffSlotsByWorkingHours\(staff as any, \{\n        dateISO: \1,\n        slots: salonAllowedStarts,\n        fallbackOpenTime: dayOpenTime,\n        fallbackCloseTime: dayCloseTime,\n      \}\);/g,
    (_match, dateVar, unavailableLine) => `      const staffId = String((staff as any)?.id || "").trim();\n      const staffWindows = getCoreStaffWindows(${dateVar}, staffId);\n      if (!staffWindows.length) ${unavailableLine}\n      const staffWorkingStarts: TimeSlot[] = filterSlotsToCoreWindows(salonAllowedStarts, staffWindows);`,
    'validation legacy windows',
    { min: 2, max: 2 }
  );

  // 5) Staff card projection: cards wait for Core result, never mapped static hours.
  text = replaceRegex(
    text,
    /                          const staffWithLeaveMeta = bookingVisibleStaff\.map\(\(st\) => \{[\s\S]*?                          const availableStaff = staffWithLeaveMeta\n                            \.filter\([\s\S]*?\n                            \.map\(\(x\) => x\.staff\);/g,
    `                          // Dated staff availability is resolved by Core; do not project legacy staff hours here.\n                          const availableStaff = bookingVisibleStaff;`,
    'staff card legacy projection',
    { min: 1, max: 1 }
  );

  const remaining = [
    'resolveStaffWorkingWindowsForDate(',
    'filterStaffSlotsByWorkingHours(',
  ].filter((needle) => text.includes(needle));
  if (remaining.length) {
    throw new Error(`[booking-cutover-resilient] remaining legacy runtime references: ${remaining.join(', ')}`);
  }

  const changed = writeSource(bookingPath, src, text);
  console.log(`[booking-cutover-resilient] Booking.tsx: ${changed ? 'updated' : 'unchanged'}`);
}

// Tests: preserve strict production service assignment policy; fix only missing fixture data.
{
  const src = readSource(testsPath);
  let text = src.text;

  text = ensureServiceAssignment(
    text,
    'svc-blowdry-short',
    /  fake\.seed\("services", \{\n    id: "svc-blowdry-short",[\s\S]*?\n  \}\);/g,
    'Arabic canonical service fixture'
  );

  // There are two svc-b seeds in distinct tests; add an assignment after each seed if missing locally.
  const svcBAssignmentCount = (text.match(/staff_id: "staff-a", service_id: "svc-b"/g) || []).length;
  if (svcBAssignmentCount < 2) {
    const svcBSeeds = [...text.matchAll(/  fake\.seed\("services", \{(?:\n| )+id: "svc-b",[\s\S]*?\n  \}\);|  fake\.seed\("services", \{ id: "svc-b",[^\n]+\}\);/g)];
    if (svcBSeeds.length !== 2) {
      throw new Error(`[booking-cutover-resilient] svc-b fixtures: expected 2 service seeds, found ${svcBSeeds.length}`);
    }
    let offset = 0;
    for (const match of svcBSeeds) {
      const full = match[0];
      const nowExpr = full.includes('created_at: now') ? 'now' : '"2027-01-01T00:00:00.000Z"';
      const assignment = `\n  fake.seed("staff_services", { salon_id: "main", staff_id: "staff-a", service_id: "svc-b", active: 1, created_at: ${nowExpr}, updated_at: ${nowExpr} });`;
      const index = (match.index ?? 0) + offset + full.length;
      text = text.slice(0, index) + assignment + text.slice(index);
      offset += assignment.length;
    }
  }

  const changed = writeSource(testsPath, src, text);
  console.log(`[booking-cutover-resilient] core-worker.test.mjs: ${changed ? 'updated' : 'unchanged'}`);
}

console.log('[booking-cutover-resilient] final authoritative HR cutover fix applied.');
