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

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`[booking-cutover-final] expected source not found: ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[booking-cutover-final] source matched more than once: ${label}`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

// Booking runtime: eliminate every remaining static staff working-hours decision.
{
  const src = readSource(bookingPath);
  let text = src.text;

  text = replaceOnce(
    text,
`        const candidateStaff = bookingVisibleStaff.filter((st) => {
          const leave = getStaffLeaveMetaForDate(st, dateISO);
          if (leave.isOnLeave) return false;
          const workingSlots = filterStaffSlotsByWorkingHours(st as any, {
            dateISO,
            slots: baseSlotsForDate,
            fallbackOpenTime: dayOpenTime,
            fallbackCloseTime: dayCloseTime,
          });
          return workingSlots.length > 0;
        });`,
`        // Core availability is the only dated schedule/leave truth.
        // getAvailableStartsForDay below resolves each candidate against Core HR.
        const candidateStaff = bookingVisibleStaff;`,
    'automatic staff candidate legacy filter'
  );

  text = replaceOnce(
    text,
`              const leave = getStaffLeaveMetaForDate(st as any, dateISO);
              const workingSlots = filterStaffSlotsByWorkingHours(st as any, {
                dateISO,
                slots: baseSlotsForDate,
                fallbackOpenTime: dayOpenTime,
                fallbackCloseTime: dayCloseTime,
              });

              if (leave.isOnLeave || !workingSlots.length) {
                nextState[itemId][empId] = false;
                return;
              }

`,
`              // Do not pre-filter from legacy/static staff fields.
              // The authoritative Core request below decides leave, weekly off,
              // exceptions, shift window, partial leave and taken slots.
`,
    'full-day state legacy prefilter'
  );

  text = replaceOnce(
    text,
`      const staffWindows = resolveStaffWorkingWindowsForDate(staff as any, {
        dateISO: date,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });
      if (!staffWindows.length) {
        return { ok: false, msg: "الموظفة غير متاحة في هذا اليوم." };
      }
      const staffWorkingStarts = filterStaffSlotsByWorkingHours(staff as any, {
        dateISO: date,
        slots: salonAllowedStarts,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });`,
`      const staffId = String((staff as any)?.id || "").trim();
      const staffWindows = getCoreStaffWindows(date, staffId);
      if (!staffWindows.length) {
        return { ok: false, msg: "الموظفة غير متاحة في هذا اليوم." };
      }
      const staffWorkingStarts: TimeSlot[] = filterSlotsToCoreWindows(salonAllowedStarts, staffWindows);`,
    'single-item validation legacy windows'
  );

  text = replaceOnce(
    text,
`      const staffWindows = resolveStaffWorkingWindowsForDate(staff as any, {
        dateISO: d,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });
      if (!staffWindows.length) return true;
      const staffWorkingStarts = filterStaffSlotsByWorkingHours(staff as any, {
        dateISO: d,
        slots: salonAllowedStarts,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });`,
`      const staffId = String((staff as any)?.id || "").trim();
      const staffWindows = getCoreStaffWindows(d, staffId);
      if (!staffWindows.length) return true;
      const staffWorkingStarts: TimeSlot[] = filterSlotsToCoreWindows(salonAllowedStarts, staffWindows);`,
    'final cart validation legacy windows'
  );

  text = replaceOnce(
    text,
`                          const staffWithLeaveMeta = bookingVisibleStaff.map((st) => {
                            const leave = getStaffLeaveMetaForDate(st, dateISO);
                            const workingSlots = filterStaffSlotsByWorkingHours(st as any, {
                              dateISO,
                              slots: baseSlotsForUi,
                              fallbackOpenTime: dayOpenTimeForItem,
                              fallbackCloseTime: dayCloseTimeForItem,
                            });
                            return {
                              staff: st,
                              leave,
                              hasWorkingHours: workingSlots.length > 0,
                              isInactive: false,
                            };
                          });
                          const availableStaff = staffWithLeaveMeta
                            .filter((x) => !x.leave.isOnLeave && x.hasWorkingHours && !x.isInactive)
                            .map((x) => x.staff);`,
`                          // Staff cards are held until Core availability resolves below.
                          // Never derive dated availability from mapped legacy staff fields.
                          const availableStaff = bookingVisibleStaff;`,
    'staff card legacy working-hours projection'
  );

  const forbidden = [
    'resolveStaffWorkingWindowsForDate(',
    'filterStaffSlotsByWorkingHours(',
  ];
  for (const needle of forbidden) {
    if (text.includes(needle)) {
      throw new Error(`[booking-cutover-final] remaining forbidden runtime reference: ${needle}`);
    }
  }

  console.log(`[booking-cutover-final] Booking.tsx: ${writeSource(bookingPath, src, text) ? 'updated' : 'unchanged'}`);
}

// Tests: seed explicit service assignments for test-only services.
{
  const src = readSource(testsPath);
  let text = src.text;

  text = replaceOnce(
    text,
`  fake.seed("services", {
    id: "svc-blowdry-long",
    salon_id: "main",
    name: "استشوار طويل",
    section_id: "hair-care",
    category_id: "blowdry",
    duration_minutes: 45,
    price_halalas: 7500,
    active: 1,
    sort_order: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch`,
`  fake.seed("services", {
    id: "svc-blowdry-long",
    salon_id: "main",
    name: "استشوار طويل",
    section_id: "hair-care",
    category_id: "blowdry",
    duration_minutes: 45,
    price_halalas: 7500,
    active: 1,
    sort_order: 3,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });
  fake.seed("staff_services", {
    salon_id: "main",
    staff_id: "staff-a",
    service_id: "svc-blowdry-short",
    active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  const response = await worker.fetch`,
    'Arabic canonical service test assignment'
  );

  const serviceBSeedNeedle = `  fake.seed("services", {
    id: "svc-b",
    salon_id: "main",
    name: "Service B",
    section_id: "hair",
    category_id: "cat-b",
    description: null,
    duration_minutes: 45,
    price_halalas: 9000,
    active: 1,
    image_url: null,
    sort_order: 2,
    created_at: now,
    updated_at: now,
  });`;
  text = replaceOnce(
    text,
    serviceBSeedNeedle,
    `${serviceBSeedNeedle}\n  fake.seed("staff_services", { salon_id: "main", staff_id: "staff-a", service_id: "svc-b", active: 1, created_at: now, updated_at: now });`,
    'dashboard edit svc-b assignment'
  );

  const offerServiceBSeed = `  fake.seed("services", { id: "svc-b", salon_id: "main", name: "Service B", category_id: "cat-b", description: null, duration_minutes: 30, price_halalas: 2500, active: 1, image_url: null, sort_order: 1, created_at: now, updated_at: now });`;
  text = replaceOnce(
    text,
    offerServiceBSeed,
    `${offerServiceBSeed}\n  fake.seed("staff_services", { salon_id: "main", staff_id: "staff-a", service_id: "svc-b", active: 1, created_at: now, updated_at: now });`,
    'offer svc-b assignment'
  );

  console.log(`[booking-cutover-final] core-worker.test.mjs: ${writeSource(testsPath, src, text) ? 'updated' : 'unchanged'}`);
}

console.log('[booking-cutover-final] final runtime cutover fixes applied.');
