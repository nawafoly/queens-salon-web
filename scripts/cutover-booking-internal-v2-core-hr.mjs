import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'src/features/internal-booking-v2/BookingInternalV2.tsx');
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

const alreadyCut = source.includes('listCoreBookableStaffForDate') &&
  source.includes('getCoreStaffBookableStartSlots') &&
  !source.includes('filterStaffSlotsByWorkingHours') &&
  !source.includes('isStaffAvailableForDate');

if (alreadyCut) {
  console.log('[booking-internal-v2-core-hr] already cut over');
  process.exit(0);
}

function countMatches(regex) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  return [...source.matchAll(new RegExp(regex.source, flags))].length;
}

function replaceExact(regex, replacement, label, expected = 1) {
  const count = countMatches(regex);
  if (count !== expected) {
    throw new Error(`[booking-internal-v2-core-hr] ${label}: expected ${expected} match(es), got ${count}`);
  }
  source = source.replace(regex, replacement);
}

replaceExact(
  /import \{ generateSalonTimeSlots, filterSlotsByServiceEnd \} from "\.\.\/\.\.\/helpers\/timeSlots";\n/,
  '',
  'legacy salon slot generator import'
);
replaceExact(
  /import \{ filterStaffForInternalBookingTarget, isAvailabilityRangeFree, resolveEmployeeKey \} from "\.\.\/\.\.\/helpers\/bookingAvailabilityUtils";\n/,
  '',
  'legacy booking availability helpers import'
);
replaceExact(
  /import \{ filterStaffSlotsByWorkingHours, isStaffOperationallyActiveForDate, isStaffAvailableForDate \} from "\.\.\/\.\.\/helpers\/staffAvailability";\n/,
  '',
  'legacy staff availability import'
);
replaceExact(
  /import \{ formatTime12 \} from "\.\.\/\.\.\/helpers\/timeDisplay";\n/,
  `import { formatTime12 } from "../../helpers/timeDisplay";\nimport { getCoreStaffBookableStartSlots, isCoreStaffStartBookable } from "../../helpers/coreBookingAvailability";\nimport { listCoreBookableStaffForDate } from "../../services/coreBookableStaffService";\n`,
  'Core HR booking imports'
);

replaceExact(
  /  const \[allStaff, setAllStaff\] = useState<StaffRow\[\]>\(\[\]\);\n  const \[staffLoading, setStaffLoading\] = useState\(false\);/,
  `  const [eligibleStaffByService, setEligibleStaffByService] = useState<Record<string, StaffRow[]>>({});\n  const [staffLoading, setStaffLoading] = useState(false);`,
  'dated staff state'
);

replaceExact(
  /\n  useEffect\(\(\) => \{\n    let cancelled = false;\n    async function loadStaff\(\) \{[\s\S]*?\n    void loadStaff\(\);\n    return \(\) => \{ cancelled = true; \};\n  \}, \[\]\);\n/,
  '\n',
  'legacy undated staff loader'
);

replaceExact(
  /  const eligibleStaffByService = useMemo\(\(\) => \{[\s\S]*?\n  \}, \[cart, allStaff, bookingDate\]\);/,
  `  useEffect(() => {\n    let cancelled = false;\n    const serviceRows = cart.filter((service) => String(service?.id || "").trim());\n\n    setEligibleStaffByService({});\n    setAvailableTimes({});\n\n    if (!serviceRows.length || !bookingDate || !dayHours.enabled) {\n      setStaffLoading(false);\n      return () => { cancelled = true; };\n    }\n\n    setStaffLoading(true);\n    async function loadDatedBookableStaff() {\n      try {\n        const resolved = await Promise.all(serviceRows.map(async (service) => {\n          const serviceKey = String(service.id);\n          const rows = await listCoreBookableStaffForDate({\n            serviceId: serviceKey,\n            date: bookingDate,\n            slotStepMin,\n            bufferMin,\n            requireShowOnBooking: false,\n          });\n          return [serviceKey, rows] as const;\n        }));\n        if (cancelled) return;\n\n        const nextStaff: Record<string, StaffRow[]> = {};\n        for (const [serviceKey, rows] of resolved) {\n          nextStaff[serviceKey] = rows.map((row) => row.staff as StaffRow);\n        }\n\n        setEligibleStaffByService(nextStaff);\n        setScheduleByService((current) => {\n          let changed = false;\n          const next = { ...current };\n          for (const service of serviceRows) {\n            const key = String(service.id);\n            const selected = next[key];\n            if (!selected?.staffId) continue;\n            const stillBookable = (nextStaff[key] || []).some((staff) => staffId(staff) === selected.staffId);\n            if (!stillBookable) {\n              next[key] = { staffId: "", staffName: "", time: "" };\n              changed = true;\n            }\n          }\n          return changed ? next : current;\n        });\n      } catch (error) {\n        console.error("[BookingInternalV2] dated Core staff load failed", error);\n        if (!cancelled) {\n          setEligibleStaffByService({});\n          setScheduleMessage("تعذر جلب توفر الموظفات من Core HR. أعيدي المحاولة.");\n        }\n      } finally {\n        if (!cancelled) setStaffLoading(false);\n      }\n    }\n\n    void loadDatedBookableStaff();\n    return () => { cancelled = true; };\n  }, [cart, bookingDate, dayHours.enabled, slotStepMin, bufferMin]);`,
  'dated Core staff resolver'
);

replaceExact(
  /  const loadTimesForService = useCallback\(async \(service: CatalogService, staff: StaffRow\) => \{[\s\S]*?\n  \}, \[bookingDate, dayHours\.enabled, dayHours\.start, dayHours\.end, slotStepMin, bufferMin\]\);/,
  `  const loadTimesForService = useCallback(async (service: CatalogService, staff: StaffRow) => {\n    const serviceKey = String(service.id);\n    const employeeId = staffId(staff);\n    if (!employeeId || !dayHours.enabled) {\n      setAvailableTimes((current) => ({ ...current, [serviceKey]: [] }));\n      return;\n    }\n    setTimesLoading((current) => ({ ...current, [serviceKey]: true }));\n    setScheduleMessage("");\n    try {\n      const duration = Math.max(1, serviceDuration(service) || 30);\n      const availability = await resolveCoreBookingDataSource().getStaffAvailability({\n        staffId: employeeId,\n        date: bookingDate,\n        slotStepMin,\n        bufferMin,\n        forceFresh: true,\n      });\n      const free = getCoreStaffBookableStartSlots(availability, {\n        durationMin: duration,\n        bufferMin,\n        slotStepMin,\n      }).map((slot) => slot.value24);\n      setAvailableTimes((current) => ({ ...current, [serviceKey]: free }));\n    } catch (error) {\n      console.error("[BookingInternalV2] availability load failed", error);\n      setAvailableTimes((current) => ({ ...current, [serviceKey]: [] }));\n      setScheduleMessage("تعذر جلب الأوقات المتاحة. حاولي مرة أخرى.");\n    } finally {\n      setTimesLoading((current) => ({ ...current, [serviceKey]: false }));\n    }\n  }, [bookingDate, dayHours.enabled, slotStepMin, bufferMin]);`,
  'Core scheduleWindows time loader'
);

replaceExact(
  /  const allScheduled = cart\.length > 0 && cart\.every\(\(service\) => \{\n    const key = String\(service\.id\);\n    const row = scheduleByService\[key\];\n    return Boolean\(row\?\.staffId && row\?\.time && !conflictKeys\.has\(key\)\);\n  \}\);/,
  `  const allScheduled = cart.length > 0 && cart.every((service) => {\n    const key = String(service.id);\n    const row = scheduleByService[key];\n    const staffStillBookable = Boolean(row?.staffId) &&\n      (eligibleStaffByService[key] || []).some((staff) => staffId(staff) === row.staffId);\n    return Boolean(row?.staffId && row?.time && staffStillBookable && !conflictKeys.has(key));\n  });`,
  'allScheduled Core staff membership'
);

replaceExact(
  /        const staff = allStaff\.find\(\(row\) => staffId\(row\) === selection\?\.staffId\);/,
  '        const staff = (eligibleStaffByService[serviceKey] || []).find((row) => staffId(row) === selection?.staffId);',
  'submit selected staff authority'
);

replaceExact(
  /        const availability = await resolveCoreBookingDataSource\(\)\.getStaffAvailability\(\{\n          staffId: selection\.staffId,[\s\S]{0,700}?\n          forceFresh: true,\n        \}\);\n\n        if \(!isAvailabilityRangeFree\(\{[\s\S]{0,500}?\n        \}\)\) \{\n          staleSelections\.push\(\{ service, staff, serviceKey \}\);\n        \}/,
  `        const freshRows = await listCoreBookableStaffForDate({\n          serviceId: serviceKey,\n          date: bookingDate,\n          slotStepMin,\n          bufferMin,\n          requireShowOnBooking: false,\n          forceFresh: true,\n        });\n        const fresh = freshRows.find((row) => staffId(row.staff as StaffRow) === selection.staffId);\n        const freshAvailability = fresh?.availability;\n\n        if (!freshAvailability || !isCoreStaffStartBookable(freshAvailability, selection.time, {\n          durationMin: serviceDuration(service) || 30,\n          bufferMin,\n          slotStepMin,\n        })) {\n          staleSelections.push({ service, staff, serviceKey });\n        }`,
  'submit fresh Core preflight'
);

replaceExact(
  /        const selectedStaff = allStaff\.find\(\(row\) => staffId\(row\) === schedule\.staffId\);/,
  '        const selectedStaff = (eligibleStaffByService[key] || []).find((row) => staffId(row) === schedule.staffId);',
  'booking item staff metadata'
);

replaceExact(
  /scheduleByService, allStaff, bookingDate, bookingNote/,
  'scheduleByService, eligibleStaffByService, bookingDate, bookingNote',
  'submit dependencies'
);

const forbidden = [
  'filterStaffSlotsByWorkingHours',
  'isStaffAvailableForDate',
  'isStaffOperationallyActiveForDate',
  'filterStaffForInternalBookingTarget',
  'isAvailabilityRangeFree',
  'resolveEmployeeKey',
  'generateSalonTimeSlots',
  'filterSlotsByServiceEnd',
  'allStaff',
];
for (const needle of forbidden) {
  if (source.includes(needle)) {
    throw new Error(`[booking-internal-v2-core-hr] legacy symbol remains after patch: ${needle}`);
  }
}

if (!source.includes('listCoreBookableStaffForDate') || !source.includes('getCoreStaffBookableStartSlots')) {
  throw new Error('[booking-internal-v2-core-hr] Core HR authority imports missing after patch');
}

fs.writeFileSync(file, source, 'utf8');
console.log('[booking-internal-v2-core-hr] cut over Internal V2 to Core HR availability');
