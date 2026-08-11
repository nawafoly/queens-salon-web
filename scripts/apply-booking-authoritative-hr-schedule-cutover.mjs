import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  booking: path.join(root, 'src/pages/Booking.tsx'),
  mapper: path.join(root, 'src/services/coreBookingMappers.ts'),
  staffRepo: path.join(root, 'workers/core/repositories/staff.js'),
  policy: path.join(root, 'workers/core/repositories/booking-staff-policy.js'),
  availability: path.join(root, 'workers/core/repositories/availability.js'),
};

function read(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return { raw, eol: raw.includes('\r\n') ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') };
}

function write(file, src, text) {
  const next = src.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  if (next === src.raw) return false;
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`[hr-cutover] expected source not found: ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`[hr-cutover] source matched more than once: ${label}`);
  return text.slice(0, first) + after + text.slice(first + before.length);
}

function replaceRegexOnce(text, regex, after, label) {
  const matches = [...text.matchAll(regex)];
  if (matches.length !== 1) throw new Error(`[hr-cutover] expected exactly one ${label}, found ${matches.length}`);
  return text.replace(regex, after);
}

// 1) Core staff API: stop shipping legacy staff_schedules at runtime.
{
  const src = read(files.staffRepo);
  let text = src.text;
  text = replaceRegexOnce(
    text,
    /async function schedulesForStaff\(db, salonId, staffId\) \{[\s\S]*?\n\}\n\n(?=export async function listStaff)/g,
    '',
    'legacy schedulesForStaff helper'
  );
  text = replaceRegexOnce(
    text,
    /  return Promise\.all\(\n    filtered\.map\(async \(row\) => \(\{\n      \.\.\.row,\n      schedules: await schedulesForStaff\(db, salonId, row\.id\),\n    \}\)\)\n  \);/g,
    '  return filtered;',
    'listStaff legacy schedules attachment'
  );
  text = replaceOnce(
    text,
    `  return {\n    ...merged,\n    schedules: await schedulesForStaff(db, salonId, merged.id),\n  };`,
    `  return merged;`,
    'getStaff legacy schedules attachment'
  );
  console.log(`[hr-cutover] staff.js: ${write(files.staffRepo, src, text) ? 'updated' : 'unchanged'}`);
}

// 2) Booking policy: HR resolver is mandatory; no legacy staff_schedules fallback.
{
  const src = read(files.policy);
  let text = src.text;
  text = replaceRegexOnce(
    text,
    /function legacyScheduleAvailability\(staff, date, startTime = '', endTime = ''\) \{[\s\S]*?\n\}\n\n(?=export async function resolveStaffBookingDay)/g,
    '',
    'legacyScheduleAvailability helper'
  );
  text = replaceRegexOnce(
    text,
    /  \/\/ Migration compatibility only: use legacy staff_schedules if no HR-dated truth exists\.[\s\S]*?\n  return \{\n    available: true,[\s\S]*?\n  \};\n\}/g,
    `  // No dated HR truth means the employee is not bookable.\n  // Never fall back to staff_schedules: hr_work_schedules / exceptions / assignments are authoritative.\n  return {\n    available: false,\n    reason: 'no_hr_schedule',\n    source: 'hr_schedule',\n    blockedRanges,\n  };\n}`,
    'legacy booking policy fallback'
  );
  console.log(`[hr-cutover] booking-staff-policy.js: ${write(files.policy, src, text) ? 'updated' : 'unchanged'}`);
}

// 3) Availability endpoint: remove legacy schedule query/fallback; return Core HR scheduleWindows only.
{
  const src = read(files.availability);
  let text = src.text;
  text = replaceRegexOnce(
    text,
    /async function scheduleRows\(db, salonId, staffId, weekday\) \{[\s\S]*?\n\}\n\n(?=async function slotLockRows)/g,
    '',
    'legacy availability scheduleRows helper'
  );
  text = replaceOnce(
    text,
    `  const [legacySchedules, locks, bookings, bookingDay] = await Promise.all([\n    scheduleRows(db, salonId, staffId, weekday),\n    slotLockRows(db, salonId, staffId, date),\n    bookedRows(db, salonId, staffId, date),\n    resolveStaffBookingDay(db, salonId, staff, date),\n  ]);`,
    `  const [locks, bookings, bookingDay] = await Promise.all([\n    slotLockRows(db, salonId, staffId, date),\n    bookedRows(db, salonId, staffId, date),\n    resolveStaffBookingDay(db, salonId, staff, date),\n  ]);`,
    'availability Promise.all legacy schedule query'
  );
  text = replaceRegexOnce(
    text,
    /  let scheduleWindows = \[\];\n  if \(bookingDay\.available && bookingDay\.startTime && bookingDay\.endTime\) \{[\s\S]*?\n  \}\n\n  const showOnBooking/g,
    `  const scheduleWindows = bookingDay.available && bookingDay.startTime && bookingDay.endTime\n    ? [{\n        id: \`hr:\${bookingDay.source || 'schedule'}\`,\n        startTime: cleanText(bookingDay.startTime),\n        endTime: cleanText(bookingDay.endTime),\n      }]\n    : [];\n\n  const showOnBooking`,
    'availability legacy scheduleWindows fallback'
  );
  console.log(`[hr-cutover] availability.js: ${write(files.availability, src, text) ? 'updated' : 'unchanged'}`);
}

// 4) Frontend mapper: never translate Core staff_schedules into customWorkingHours.
{
  const src = read(files.mapper);
  let text = src.text;
  text = replaceRegexOnce(
    text,
    /const dayKeys = \[[\s\S]*?\] as const;\n\n/g,
    '',
    'legacy dayKeys mapper constant'
  );
  text = replaceRegexOnce(
    text,
    /export function coreStaffToLegacy\(\n  staff: CoreStaff\n\): StaffPublicWithId \{\n  const customWorkingHours:[\s\S]*?\n\n  return \{/g,
    `export function coreStaffToLegacy(\n  staff: CoreStaff\n): StaffPublicWithId {\n  return {`,
    'legacy customWorkingHours construction'
  );
  text = replaceOnce(
    text,
    `    useCustomWorkingHours: Boolean(staff.schedules?.length),\n    customWorkingHours,`,
    `    // Runtime booking schedule comes only from Core availability / HR resolver.\n    useCustomWorkingHours: false,`,
    'legacy customWorkingHours mapper output'
  );
  console.log(`[hr-cutover] coreBookingMappers.ts: ${write(files.mapper, src, text) ? 'updated' : 'unchanged'}`);
}

// 5) Booking UI: store authoritative Core scheduleWindows and use them for every time decision.
{
  const src = read(files.booking);
  let text = src.text;

  // The no-flash patch may already have been applied locally. Add it if it has not.
  if (!text.includes('staffFullDayResolvedKeyByItem')) {
    text = replaceOnce(
      text,
      `  const [staffFullDayByItem, setStaffFullDayByItem] = useState<\n    Record<string, Record<string, boolean>>\n  >({});`,
      `  const [staffFullDayByItem, setStaffFullDayByItem] = useState<\n    Record<string, Record<string, boolean>>\n  >({});\n  const [staffFullDayResolvedKeyByItem, setStaffFullDayResolvedKeyByItem] = useState<\n    Record<string, string>\n  >({});`,
      'no-flash resolved context state'
    );
    text = replaceOnce(text,
      `    if (currentStep !== 2) {\n      setStaffFullDayByItem({});\n      return;\n    }`,
      `    if (currentStep !== 2) {\n      setStaffFullDayByItem({});\n      setStaffFullDayResolvedKeyByItem({});\n      return;\n    }`,
      'no-flash clear context');
    text = replaceOnce(text,
      `      if (!items.length) {\n        if (!cancelled) setStaffFullDayByItem({});\n        return;\n      }\n\n      const nextState: Record<string, Record<string, boolean>> = {};\n      const availabilityCache = new Map<string, Promise<boolean>>();`,
      `      if (!items.length) {\n        if (!cancelled) {\n          setStaffFullDayByItem({});\n          setStaffFullDayResolvedKeyByItem({});\n        }\n        return;\n      }\n\n      const nextState: Record<string, Record<string, boolean>> = {};\n      const nextResolvedKeys: Record<string, string> = {};\n      const availabilityCache = new Map<string, Promise<boolean>>();`,
      'no-flash nextResolvedKeys');
    text = replaceOnce(text,
      `        const serviceStaff = (staffByService[serviceKey] || []) as StaffPublicWithId[];\n        if (!serviceStaff.length) continue;`,
      `        const serviceStaff = (staffByService[serviceKey] || []) as StaffPublicWithId[];\n        const staffFingerprint = serviceStaff\n          .map((st) => String((st as any)?.id || "").trim())\n          .filter(Boolean)\n          .sort()\n          .join(",");\n        nextResolvedKeys[itemId] = [\n          dateISO,\n          serviceKey,\n          String(Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN))),\n          staffFingerprint,\n        ].join("__");\n        nextState[itemId] = nextState[itemId] || {};\n        if (!serviceStaff.length) continue;`,
      'no-flash context fingerprint');
    text = replaceOnce(text,
      `      setStaffFullDayByItem(nextState);\n    }\n\n    const t = window.setTimeout(() => {\n      if (cancelled) return;\n      void loadStaffFullDayState();\n    }, 150);\n    return () => {\n      cancelled = true;\n      window.clearTimeout(t);\n    };`,
      `      setStaffFullDayByItem(nextState);\n      setStaffFullDayResolvedKeyByItem(nextResolvedKeys);\n    }\n\n    void loadStaffFullDayState();\n    return () => {\n      cancelled = true;\n    };`,
      'no-flash remove delay');
  }

  // Core schedule window cache. Ref is synchronous for availability calculations; state forces render refresh.
  text = replaceOnce(
    text,
    `  const autoStaffDefaultContextRef = useRef<Record<string, string>>({});\n  const manualStaffChoiceContextRef = useRef<Record<string, string>>({});`,
    `  const autoStaffDefaultContextRef = useRef<Record<string, string>>({});\n  const manualStaffChoiceContextRef = useRef<Record<string, string>>({});\n  const coreStaffWindowsRef = useRef<Record<string, ResolvedStaffWorkingWindowRange[]>>({});\n  const [, setCoreStaffWindowsVersion] = useState(0);\n\n  function coreStaffWindowsKey(dateISO: string, staffId: string) {\n    return \`${'${String(dateISO || "").trim()}__${String(staffId || "").trim()}'}\`;\n  }\n\n  function normalizeCoreScheduleWindows(availability: any): ResolvedStaffWorkingWindowRange[] {\n    return (Array.isArray(availability?.scheduleWindows) ? availability.scheduleWindows : [])\n      .map((window: any) => ({\n        start: String(window?.startTime || window?.start_time || "").trim(),\n        end: String(window?.endTime || window?.end_time || "").trim(),\n        source: "staff_fixed" as const,\n      }))\n      .filter((window: ResolvedStaffWorkingWindowRange) => !!window.start && !!window.end && window.start !== window.end);\n  }\n\n  function getCoreStaffWindows(dateISO: string, staffId: string) {\n    return coreStaffWindowsRef.current[coreStaffWindowsKey(dateISO, staffId)] || [];\n  }\n\n  function filterSlotsToCoreWindows(slots: TimeSlot[], windows: ResolvedStaffWorkingWindowRange[]) {\n    if (!windows.length) return [];\n    return (slots || []).filter((slot) =>\n      windows.some((window) =>\n        isTimeInsideWindowRange(\n          String(slot?.value24 || "").trim(),\n          String(window.start || "").trim(),\n          String(window.end || "").trim()\n        )\n      )\n    );\n  }`,
    'Core schedule window runtime cache'
  );

  // Persist scheduleWindows whenever Core availability is fetched.
  text = replaceOnce(
    text,
    `      const rows = availability.availableForDate === false`,
    `      const windowsKey = coreStaffWindowsKey(dateISO, fallbackId || key);\n      const nextCoreWindows = normalizeCoreScheduleWindows(availability);\n      const previousCoreWindows = coreStaffWindowsRef.current[windowsKey] || [];\n      const previousSignature = previousCoreWindows.map((w) => \`${'${w.start}|${w.end}'}\`).join(",");\n      const nextSignature = nextCoreWindows.map((w) => \`${'${w.start}|${w.end}'}\`).join(",");\n      coreStaffWindowsRef.current[windowsKey] = nextCoreWindows;\n      if (previousSignature !== nextSignature) setCoreStaffWindowsVersion((value) => value + 1);\n\n      const rows = availability.availableForDate === false`,
    'cache authoritative Core scheduleWindows'
  );

  // getAvailableStartsForDay: Core windows only.
  text = replaceRegexOnce(
    text,
    /    let staffScopedSlots = slotsForThisService;\n    if \(staff\) \{\n      const staffWindows = resolveStaffWorkingWindowsForDate\(staff as any, \{[\s\S]*?\n    \}\n\n    if \(!staffScopedSlots\.length\) return \[\];/g,
    `    let staffScopedSlots = slotsForThisService;\n    if (staff) {\n      const staffId = String((staff as any)?.id || employeeIdFallback || employeeKey || "").trim();\n      const staffWindows = getCoreStaffWindows(dateISO, staffId);\n      if (!staffWindows.length) return [];\n      const workingStarts = filterSlotsToCoreWindows(slotsForThisService, staffWindows);\n      const allowedByValue = new Set<string>();\n      for (const window of staffWindows) {\n        const startsInWindow = workingStarts.filter((slot) =>\n          isTimeInsideWindowRange(\n            String(slot?.value24 || "").trim(),\n            String(window.start || "").trim(),\n            String(window.end || "").trim()\n          )\n        );\n        const allowedInWindow = filterSlotsByServiceEnd(\n          startsInWindow,\n          String(window.end || "").trim(),\n          normalizedDuration,\n          bufferMin,\n          ALLOW_OVERTIME_MIN\n        );\n        for (const slot of allowedInWindow) {\n          const value = String(slot?.value24 || "").trim();\n          if (value) allowedByValue.add(value);\n        }\n      }\n      staffScopedSlots = slotsForThisService.filter((slot) =>\n        allowedByValue.has(String(slot?.value24 || "").trim())\n      );\n    }\n\n    if (!staffScopedSlots.length) return [];`,
    'getAvailableStartsForDay legacy staff windows'
  );

  // Busy-slot calculation: Core windows only.
  text = replaceRegexOnce(
    text,
    /          if \(selectedStaff\) \{\n            const staffWindows = resolveStaffWorkingWindowsForDate\(selectedStaff as any, \{[\s\S]*?\n          \}\n\n          \/\/ ✅ هذه هي “البدايات الصحيحة”/g,
    `          if (selectedStaff) {\n            const staffWindows = getCoreStaffWindows(date, employeeId);\n            if (!staffWindows.length) {\n              slotsForThisService = [];\n            } else {\n              const staffWorkingSlots = filterSlotsToCoreWindows(slotsForThisService, staffWindows);\n              const allowedByValue = new Set<string>();\n              for (const window of staffWindows) {\n                const startsInWindow = staffWorkingSlots.filter((slot) =>\n                  isTimeInsideWindowRange(\n                    String(slot?.value24 || "").trim(),\n                    String(window.start || "").trim(),\n                    String(window.end || "").trim()\n                  )\n                );\n                const allowedInWindow = filterSlotsByServiceEnd(\n                  startsInWindow,\n                  String(window.end || "").trim(),\n                  durationMin,\n                  bufferMin,\n                  ALLOW_OVERTIME_MIN\n                );\n                for (const slot of allowedInWindow) {\n                  const value = String(slot?.value24 || "").trim();\n                  if (value) allowedByValue.add(value);\n                }\n              }\n              slotsForThisService = slotsForThisService.filter((slot) =>\n                allowedByValue.has(String(slot?.value24 || "").trim())\n              );\n            }\n          }\n\n          // ✅ هذه هي “البدايات الصحيحة”`,
    'loadBusyForItems legacy staff windows'
  );

  // Rendering eligibility: Core owns leave and working-day decision; do not pre-filter with legacy staff shape.
  text = replaceOnce(
    text,
    `                          const availableStaff = staffWithLeaveMeta\n                            .filter((x) => !x.leave.isOnLeave && x.hasWorkingHours && !x.isInactive)\n                            .map((x) => x.staff);`,
    `                          const availableStaff = staffWithLeaveMeta\n                            .filter((x) => !x.isInactive)\n                            .map((x) => x.staff);`,
    'remove legacy leave/working-hours eligibility from booking UI'
  );

  // If no-flash render guard not already applied, apply it now.
  if (!text.includes('const coreAvailabilityLoading =')) {
    text = replaceOnce(
      text,
      `                          const coreUnavailableForItem = staffFullDayByItem[it.id] || {};\n                          const staffChoicesForItem = availableStaff.filter((staff: any) => {\n                            const id = String(staff?.id || "").trim();\n                            return !id || !coreUnavailableForItem[id];\n                          });\n                          const staffLoading = !!staffLoadingByService[serviceKeyForStaff];`,
      `                          const coreUnavailableForItem = staffFullDayByItem[it.id] || {};\n                          const staffFingerprintForItem = serviceStaff\n                            .map((staff: any) => String(staff?.id || "").trim())\n                            .filter(Boolean)\n                            .sort()\n                            .join(",");\n                          const coreAvailabilityKeyForItem = [\n                            dateISO,\n                            serviceKeyForStaff,\n                            String(Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN))),\n                            staffFingerprintForItem,\n                          ].join("__");\n                          const coreAvailabilityLoading =\n                            staffFullDayResolvedKeyByItem[it.id] !== coreAvailabilityKeyForItem;\n                          const staffChoicesForItem = coreAvailabilityLoading\n                            ? []\n                            : availableStaff.filter((staff: any) => {\n                                const id = String(staff?.id || "").trim();\n                                return !id || !coreUnavailableForItem[id];\n                              });\n                          const staffLoading =\n                            !!staffLoadingByService[serviceKeyForStaff] || coreAvailabilityLoading;`,
      'no-flash render guard'
    );
  }

  // Selected staff time-window rendering: Core scheduleWindows only.
  text = replaceRegexOnce(
    text,
    /                          const staffWorkingSlots = selectedStaffForTime\n                            \? filterStaffSlotsByWorkingHours\(selectedStaffForTime as any, \{[\s\S]*?\n                            : \[\];\n                          const staffWindows = selectedStaffForTime\n                            \? resolveStaffWorkingWindowsForDate\(selectedStaffForTime as any, \{[\s\S]*?\n                            : \[\];/g,
    `                          const selectedStaffId = String((selectedStaffForTime as any)?.id || "").trim();\n                          const staffWindows = selectedStaffForTime\n                            ? getCoreStaffWindows(dateISO, selectedStaffId)\n                            : [];\n                          const staffWorkingSlots = selectedStaffForTime\n                            ? filterSlotsToCoreWindows(baseSlotsForUi, staffWindows)\n                            : [];`,
    'render legacy staff windows'
  );

  console.log(`[hr-cutover] Booking.tsx: ${write(files.booking, src, text) ? 'updated' : 'unchanged'}`);
}

console.log('[hr-cutover] authoritative Core HR booking schedule cutover applied.');
