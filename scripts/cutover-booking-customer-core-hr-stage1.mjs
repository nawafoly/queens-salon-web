import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'src/pages/Booking.tsx');
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const stageMarker = 'getCoreStaffAvailabilityForDate';
if (text.includes(stageMarker) && text.includes('listCoreAssignedStaffForServices')) {
  console.log('[customer-core-hr-stage1] already applied');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`[customer-core-hr-stage1] ${label}: source not found`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[customer-core-hr-stage1] ${label}: source matched more than once`);
  }
  text = text.slice(0, first) + after + text.slice(first + before.length);
}

function replaceRegex(regex, replacement, label, expected = 1) {
  const matches = [...text.matchAll(regex)];
  if (matches.length !== expected) {
    throw new Error(`[customer-core-hr-stage1] ${label}: expected ${expected}, got ${matches.length}`);
  }
  text = text.replace(regex, replacement);
}

// Imports: add pure interval expansion and Core authority helpers.
replaceOnce(
`import {
  generateSalonTimeSlots,
  filterSlotsByServiceEnd,
  toMinutes,
  type TimeSlot,
} from "../helpers/timeSlots";`,
`import {
  expandBookingOccupiedTimes,
  generateSalonTimeSlots,
  filterSlotsByServiceEnd,
  toMinutes,
  type TimeSlot,
} from "../helpers/timeSlots";`,
  'time slot imports'
);

replaceOnce(
`import {
  isStaffAvailableForDate,
  isStaffBookableForPublicBooking,
  type ResolvedStaffWorkingWindowRange,
} from "../helpers/staffAvailability";`,
`import {
  isStaffAvailableForDate,
  type ResolvedStaffWorkingWindowRange,
} from "../helpers/staffAvailability";
import {
  getCoreStaffBookableStartSlots,
  getCoreStaffTimelineSlots,
} from "../helpers/coreBookingAvailability";
import {
  isCoreAssignedStaffPubliclyVisible,
  listCoreAssignedStaffForService,
  listCoreAssignedStaffForServices,
} from "../services/coreBookableStaffService";
import type { CoreStaffAvailability } from "../types/coreApi";`,
  'staff authority imports'
);

replaceOnce(
`import { CoreStaffService } from "../services/CoreStaffService";
import { coreStaffToLegacy } from "../services/coreBookingMappers";
`,
'',
  'old Core staff mapper imports'
);

text = text.replace(/\n  listActiveStaffAll,/g, '');
text = text.replaceAll('isStaffBookableForPublicBooking', 'isCoreAssignedStaffPubliclyVisible');

// Keep the existing race-safe window cache for now, but store the complete Core
// response beside it so all new decisions consume the same authoritative object.
replaceOnce(
`  const coreStaffWindowsRef = useRef<Record<string, ResolvedStaffWorkingWindowRange[]>>({});
  const [, setCoreStaffWindowsVersion] = useState(0);`,
`  const coreStaffWindowsRef = useRef<Record<string, ResolvedStaffWorkingWindowRange[]>>({});
  const [, setCoreStaffWindowsVersion] = useState(0);
  const coreStaffAvailabilityRef = useRef<Record<string, CoreStaffAvailability>>({});`,
  'Core availability cache state'
);

replaceOnce(
`  function getCoreStaffWindows(dateISO: string, staffId: string) {
    return coreStaffWindowsRef.current[coreStaffWindowsKey(dateISO, staffId)] || [];
  }
`,
`  function getCoreStaffWindows(dateISO: string, staffId: string) {
    return coreStaffWindowsRef.current[coreStaffWindowsKey(dateISO, staffId)] || [];
  }

  function getCoreStaffAvailabilityForDate(dateISO: string, staffId: string) {
    return coreStaffAvailabilityRef.current[coreStaffWindowsKey(dateISO, staffId)] || null;
  }
`,
  'Core availability cache getter'
);

// Local cart overlap must never depend on the salon/business-hours slot grid.
replaceRegex(
/      const dur = Number\(other\.durationMin \|\| DEFAULT_SERVICE_DURATION_MIN\);\n      const locked = getTimesToLock\(timeSlots, slotStepMin, t, dur, bufferMin\);\n      locked\.forEach\(\(x\) => taken\.add\(x\)\);/g,
`      const dur = Number(other.durationMin || DEFAULT_SERVICE_DURATION_MIN);
      const locked = expandBookingOccupiedTimes(t, dur, bufferMin, slotStepMin);
      locked.forEach((x) => taken.add(x));`,
  'local taken interval expansion'
);

replaceRegex(
/        const aLocked = new Set\(\n          getTimesToLock\(\n            timeSlots,\n            slotStepMin,\n            timeA,\n            Number\(a\.durationMin \|\| DEFAULT_SERVICE_DURATION_MIN\),\n            bufferMin\n          \)\n        \);\n        const bLocked = new Set\(\n          getTimesToLock\(\n            timeSlots,\n            slotStepMin,\n            timeB,\n            Number\(b\.durationMin \|\| DEFAULT_SERVICE_DURATION_MIN\),\n            bufferMin\n          \)\n        \);/g,
`        const aLocked = new Set(
          expandBookingOccupiedTimes(
            timeA,
            Number(a.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            bufferMin,
            slotStepMin
          )
        );
        const bLocked = new Set(
          expandBookingOccupiedTimes(
            timeB,
            Number(b.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            bufferMin,
            slotStepMin
          )
        );`,
  'cart overlap interval expansion'
);

// Service-to-staff authority: D1 staff_services only. No all-staff/specialties fallback.
replaceRegex(
/  const getAllActiveStaffCached = async \(forceRefresh = false\) => \{[\s\S]*?\n  \};\n\n  const listStaffForService = async \(serviceId: string, service\?: FlatService \| null, forceRefresh = false\) => \{[\s\S]*?\n  \};\n\n  useEffect\(\(\) => \{\n    void getAllActiveStaffCached\(\);\n    \/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\n  \}, \[\]\);/g,
`  const listStaffForService = async (serviceId: string, service?: FlatService | null, forceRefresh = false) => {
    const sid = String(serviceId || "").trim();
    if (!sid) return [] as StaffPublicWithId[];

    const target = service || getServiceById(sid);
    const resolverKey = buildStaffResolverKey(sid, target);
    const cached = staffByResolverCacheRef.current[resolverKey];
    if (!forceRefresh && Array.isArray(cached)) return cached;

    const inFlight = staffByResolverInFlightRef.current[resolverKey];
    if (!forceRefresh && inFlight) return inFlight;

    const loadPromise: Promise<StaffPublicWithId[]> = (async () => {
      if (target?.kind === "package") {
        const packageIds = Array.from(new Set([
          ...(target.packageServiceIds || []),
          ...((target.packageServices || []).map((row: any) => String(row?.serviceId || "").trim())),
        ].map((value) => String(value || "").trim()).filter(Boolean)));
        return listCoreAssignedStaffForServices(packageIds);
      }
      return listCoreAssignedStaffForService(sid);
    })();

    staffByResolverInFlightRef.current[resolverKey] = loadPromise;
    try {
      const rows = await loadPromise;
      staffByResolverCacheRef.current[resolverKey] = rows;
      return rows;
    } finally {
      delete staffByResolverInFlightRef.current[resolverKey];
    }
  };`,
  'service staff resolver'
);

text = text.replace(/  const staffAllCacheRef = useRef<StaffPublicWithId\[\] \| null>\(null\);\n  const staffAllCacheLoadedAtRef = useRef\(0\);\n/g, '');
text = text.replace(/      staffAllCacheRef\.current = null;\n      staffAllCacheLoadedAtRef\.current = 0;\n/g, '');

// Preserve the race fix: write caches only after the Core request resolves.
replaceOnce(
`      const availability = await getStaffAvailability({
        staffId: fallbackId || key,
        employeeKey: key,
        date: dateISO,
        slotStepMin,
        bufferMin,
        forceFresh,
      });
      const windowsKey = coreStaffWindowsKey(dateISO, fallbackId || key);`,
`      const availability = await getStaffAvailability({
        staffId: fallbackId || key,
        employeeKey: key,
        date: dateISO,
        slotStepMin,
        bufferMin,
        forceFresh,
      });
      const windowsKey = coreStaffWindowsKey(dateISO, fallbackId || key);
      coreStaffAvailabilityRef.current[windowsKey] = availability;`,
  'cache authoritative Core response'
);

replaceRegex(
/      const rows = availability\.availableForDate === false\n        \? Array\.from\([\s\S]*?\n          \);\n      takenTimesCacheRef\.current\[cacheKey\] = \{/g,
`      const rows = Array.from(
        new Set(
          (availability.takenTimes || [])
            .map((time) => String(time || "").trim())
            .filter(Boolean)
        )
      );
      takenTimesCacheRef.current[cacheKey] = {`,
  'remove all-day fake taken grid'
);

// Core HR scheduleWindows create the employee timeline and last start. Salon
// open/close only decides whether the whole business day is enabled.
replaceRegex(
/  async function getAvailableStartsForDay\(args: \{[\s\S]*?\n    return list\.slice\(0, Math\.max\(1, take\)\);\n  \}/g,
`  async function getAvailableStartsForDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    dateISO: string;
    durationMin: number;
    take: number;
    localTakenTimes?: Set<string>;
    staff?: StaffPublicWithId | null;
    source?: string;
  }) {
    const {
      salonId,
      employeeKey,
      employeeIdFallback,
      dateISO,
      durationMin,
      take,
      localTakenTimes,
      source,
    } = args;

    const dayCfg = getDaySettingsForDate(dateISO);
    if (!dayCfg.enabled) return [];

    await collectTakenTimesForEmployeeDay({
      salonId,
      employeeKey,
      employeeIdFallback,
      dateISO,
      source: source || "Booking.getAvailableStartsForDay",
    });

    const staffId = String(employeeIdFallback || employeeKey || "").trim();
    const availability = getCoreStaffAvailabilityForDate(dateISO, staffId);
    if (!availability) return [];

    const normalizedDuration = Math.max(1, Number(durationMin || DEFAULT_SERVICE_DURATION_MIN));
    const localTaken = localTakenTimes || new Set<string>();
    const starts = getCoreStaffBookableStartSlots(availability, {
      durationMin: normalizedDuration,
      bufferMin,
      slotStepMin,
    }).filter((slot) => {
      const occupied = expandBookingOccupiedTimes(
        slot.value24,
        normalizedDuration,
        bufferMin,
        slotStepMin
      );
      return !occupied.some((time) => localTaken.has(time));
    });

    return starts
      .map((slot) => slot.value24)
      .slice(0, Math.max(1, take));
  }`,
  'Core-only available starts function'
);

// Future-date scanning must not pre-decide a date from legacy mirrored fields.
replaceOnce(
`        const fixedAvailable = staff
          ? isCoreAssignedStaffPubliclyVisible(staff as any, dateISO) &&
            isStaffAvailableForDate(staff as any, dateISO)
          : false;
        if (!fixedAvailable) continue;
`,
`        if (!staff || !isCoreAssignedStaffPubliclyVisible(staff as any)) continue;
`,
  'future legacy dated predicate'
);

// Fail closed in full-day staff visibility if Core cannot resolve availability.
text = text.replace('.catch(() => true)', '.catch(() => false)');

// Busy-state calculation: employee timeline and valid starts come from Core HR,
// not the general business-hours grid.
replaceRegex(
/        const dayOpenTime = safeTimeHHMM\(dayCfg\.openTime, openTime\);\n        const dayCloseTime = safeTimeHHMM\(dayCfg\.closeTime, closeTime\);\n        const baseSlots = generateSalonTimeSlots\(dayOpenTime, dayCloseTime, slotStepMin\);\n        if \(!baseSlots\.length\) \{[\s\S]*?\n          continue;\n        \}\n\n/g,
'',
  'busy salon grid precheck'
);

replaceRegex(
/          \/\/ ✅ أوقات ممكن تبدأ منها \(حسب نهاية الخدمة \+ سماح\)\n          const durationMin = Number\(it\.durationMin \|\| DEFAULT_SERVICE_DURATION_MIN\);\n\n          \/\/ فقط الأوقات اللي ما تتجاوز نهاية الدوام النهائي \(صالون \+ موظفة\)\n          let slotsForThisService = filterSlotsByServiceEnd\([\s\S]*?\n          \}\n\n          \/\/ ✅ هذه هي “البدايات الصحيحة” فعلياً \(تضمن أن كل قطع الوقت المطلوبة فاضية\)\n          const greens = getGreenStartTimes\(\{\n            allSlots: baseSlots,\n            slotStepMin,\n            durationMin,\n            bufferMin,\n            takenAll, \/\/ Core \+ cart\n          \}\);/g,
`          const durationMin = Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN));
          const availability = getCoreStaffAvailabilityForDate(date, employeeId);
          if (!availability) {
            throw new Error("CORE_STAFF_AVAILABILITY_NOT_RESOLVED");
          }
          const baseSlots = getCoreStaffTimelineSlots(availability, slotStepMin);
          const slotsForThisService = getCoreStaffBookableStartSlots(availability, {
            durationMin,
            bufferMin,
            slotStepMin,
            excludeTaken: false,
          });
          const greens = new Set<string>();
          for (const slot of slotsForThisService) {
            const occupied = expandBookingOccupiedTimes(
              slot.value24,
              durationMin,
              bufferMin,
              slotStepMin
            );
            if (!occupied.some((time) => takenAll.has(time))) {
              greens.add(slot.value24);
            }
          }`,
  'busy Core schedule calculation'
);

text = text.replace(
`            if (!greens.has(t) && t !== currentTime) {
              disabled.add(t);
            }`,
`            if (!greens.has(t)) {
              disabled.add(t);
            }`
);
text = text.replace(
`            const isActuallyTaken = takenAll.has(currentTime);`,
`            const isActuallyTaken = expandBookingOccupiedTimes(
              currentTime,
              durationMin,
              bufferMin,
              slotStepMin
            ).some((time) => takenAll.has(time));`
);

const forbiddenStage1 = [
  'CoreStaffService.',
  'coreStaffToLegacy(',
  'listActiveStaffAll(',
  'getAllActiveStaffCached(',
];
for (const needle of forbiddenStage1) {
  if (text.includes(needle)) {
    throw new Error(`[customer-core-hr-stage1] forbidden stage-1 symbol remains: ${needle}`);
  }
}

if (!text.includes('getCoreStaffBookableStartSlots') || !text.includes('getCoreStaffTimelineSlots')) {
  throw new Error('[customer-core-hr-stage1] Core availability helpers missing');
}
if (!text.includes('listCoreAssignedStaffForService') || !text.includes('listCoreAssignedStaffForServices')) {
  throw new Error('[customer-core-hr-stage1] D1 staff_services helpers missing');
}

const next = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
fs.writeFileSync(file, next, 'utf8');
console.log('[customer-core-hr-stage1] customer Booking stage 1 applied');
