import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const file = path.join(root, 'src/pages/Booking.tsx');
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

if (
  text.includes('authoritativeStaffViolation') &&
  text.includes('cacheCoreStaffAvailability') &&
  !text.includes('getStaffLeaveMetaForDate') &&
  !text.includes('filterSlotsToCoreWindows')
) {
  console.log('[customer-core-hr-stage2] already applied');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`[customer-core-hr-stage2] ${label}: source not found`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[customer-core-hr-stage2] ${label}: source matched more than once`);
  }
  text = text.slice(0, first) + after + text.slice(first + before.length);
}

function replaceRegex(regex, replacement, label, expected = 1) {
  const matches = [...text.matchAll(regex)];
  if (matches.length !== expected) {
    throw new Error(`[customer-core-hr-stage2] ${label}: expected ${expected}, got ${matches.length}`);
  }
  text = text.replace(regex, replacement);
}

function replaceBetween(start, end, replacement, label) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) throw new Error(`[customer-core-hr-stage2] ${label}: start marker not found`);
  const secondStart = text.indexOf(start, startIndex + start.length);
  if (secondStart >= 0) throw new Error(`[customer-core-hr-stage2] ${label}: start marker is not unique`);
  const endIndex = text.indexOf(end, startIndex + start.length);
  if (endIndex < 0) throw new Error(`[customer-core-hr-stage2] ${label}: end marker not found`);
  text = text.slice(0, startIndex) + replacement + text.slice(endIndex);
}

// ---- Imports: no local dated staff policy or local overtime policy. ----
text = text.replace('  getStaffLeaveMetaForDate,\n', '');
text = text.replace('  ALLOW_OVERTIME_MIN,\n', '');
text = text.replace('  filterSlotsByServiceEnd,\n', '');

replaceRegex(
  /import \{\n  isStaffAvailableForDate,\n  type ResolvedStaffWorkingWindowRange,\n\} from "\.\.\/helpers\/staffAvailability";\n/,
  '',
  'remove legacy staffAvailability import'
);

replaceOnce(
`import {
  getCoreStaffBookableStartSlots,
  getCoreStaffTimelineSlots,
} from "../helpers/coreBookingAvailability";`,
`import {
  getCoreStaffBookableStartSlots,
  getCoreStaffScheduleWindows,
  getCoreStaffTimelineSlots,
  isCoreStaffStartBookable,
  type CoreBookingScheduleWindow,
} from "../helpers/coreBookingAvailability";`,
  'Core availability imports'
);

replaceOnce(
`import {
  isCoreAssignedStaffPubliclyVisible,
  listCoreAssignedStaffForService,
  listCoreAssignedStaffForServices,
} from "../services/coreBookableStaffService";`,
`import {
  isCoreAssignedStaffPubliclyVisible,
  listCoreAssignedStaffForService,
  listCoreAssignedStaffForServices,
  listCoreBookableStaffForDate,
} from "../services/coreBookableStaffService";`,
  'Core dated staff import'
);

// ---- Core window display type only. No local window resolver. ----
replaceRegex(
  /function isTimeInsideWindowRange\([\s\S]*?\n}\n\nfunction buildStaffWindowLabel\(window: ResolvedStaffWorkingWindowRange, index: number, total: number\) \{[\s\S]*?\n}\n/,
`function buildStaffWindowLabel(window: CoreBookingScheduleWindow, index: number, total: number) {
  const start = String(window.startTime || "").trim();
  const end = String(window.endTime || "").trim();
  const range = \`${'${start}'}–${'${end}'}\`;
  if (total === 1) return \`الفترة: ${'${range}'}\`;
  if (index === 0) return \`الفترة الصباحية: ${'${range}'}\`;
  if (index === 1) return \`الفترة المسائية: ${'${range}'}\`;
  return \`الفترة ${'${index + 1}'}: ${'${range}'}\`;
}
`,
  'replace legacy staff-window helpers'
);

// ---- One full Core availability cache. The race fix remains request-first. ----
replaceBetween(
  '  const coreStaffWindowsRef = useRef<Record<string, ResolvedStaffWorkingWindowRange[]>>({});',
  '  async function openFutureSearchFromItem(it: CartItem) {',
`  const coreStaffAvailabilityRef = useRef<Record<string, CoreStaffAvailability>>({});
  const [, setCoreStaffAvailabilityVersion] = useState(0);

  function coreStaffAvailabilityKey(dateISO: string, staffId: string) {
    return \`${'${String(dateISO || "").trim()}'}__${'${String(staffId || "").trim()}'}\`;
  }

  function getCoreStaffAvailabilityForDate(dateISO: string, staffId: string) {
    return coreStaffAvailabilityRef.current[coreStaffAvailabilityKey(dateISO, staffId)] || null;
  }

  function cacheCoreStaffAvailability(
    dateISO: string,
    staffId: string,
    availability: CoreStaffAvailability
  ) {
    const key = coreStaffAvailabilityKey(dateISO, staffId);
    const previous = coreStaffAvailabilityRef.current[key];
    coreStaffAvailabilityRef.current[key] = availability;
    const previousSignature = previous
      ? JSON.stringify([
          previous.availableForDate,
          previous.unavailableReason,
          previous.scheduleWindows,
          previous.takenTimes,
        ])
      : "";
    const nextSignature = JSON.stringify([
      availability.availableForDate,
      availability.unavailableReason,
      availability.scheduleWindows,
      availability.takenTimes,
    ]);
    if (previousSignature !== nextSignature) {
      setCoreStaffAvailabilityVersion((value) => value + 1);
    }
  }

`,
  'replace schedule-window bridge with full Core availability cache'
);

// ---- collectTakenTimes: store the authoritative response after await; no fake full-day grid. ----
replaceRegex(
  /    const pending = \(async \(\) => \{\n      const availability = await getStaffAvailability\(\{[\s\S]*?\n      return rows;\n    \}\)\(\);/,
`    const pending = (async () => {
      const availability = await getStaffAvailability({
        staffId: fallbackId || key,
        employeeKey: key,
        date: dateISO,
        slotStepMin,
        bufferMin,
        forceFresh,
      });
      cacheCoreStaffAvailability(dateISO, fallbackId || key, availability);

      const rows = Array.from(
        new Set(
          (availability.takenTimes || [])
            .map((time) => String(time || "").trim())
            .filter(Boolean)
        )
      );
      takenTimesCacheRef.current[cacheKey] = {
        ts: Date.now(),
        values: rows,
      };
      return rows;
    })();`,
  'authoritative availability cache write'
);

// ---- Sequential offers: dated service-to-staff decision comes from Core. ----
replaceRegex(
  /      const sv = getServiceById\(step\.serviceId\);\n      const staffRaw = await listStaffForService\(step\.serviceId, sv\);\n      const staffList = \(staffRaw \|\| \[\]\)\.filter\(\(st: any\) =>\n        isCoreAssignedStaffPubliclyVisible\(st, dateISO\) &&\n        isStaffAvailableForDate\(st, dateISO\)\n      \);/,
`      const staffRows = await listCoreBookableStaffForDate({
        serviceId: step.serviceId,
        date: dateISO,
        slotStepMin,
        bufferMin,
        forceFresh: true,
      });
      const staffList = staffRows.map((row) => row.staff);`,
  'sequential offer dated staff authority'
);

// ---- Package common assignment: staff_services intersection only. ----
replaceRegex(
  /        const list = \(\(staffByService\[sid\] \|\| \[\]\) as StaffPublicWithId\[\]\)\.filter\(\(st: any\) => \{[\s\S]*?\n        perService\.push\(strictByService\);/,
`        const list = ((staffByService[sid] || []) as StaffPublicWithId[])
          .filter((st: any) => String(st?.name || "").trim())
          .filter((st: any) => isCoreAssignedStaffPubliclyVisible(st));
        if (!list.length) hasStrictCoverageForAll = false;
        perService.push(list);`,
  'package staff_services intersection'
);

// ---- Package quick eligibility: full dated Core availability per service. ----
replaceRegex(
  /        const perService: StaffPublicWithId\[\]\[\] = \[\];\n        for \(const sid of serviceIds\) \{[\s\S]*?\n        \}\n\n        const first = perService\[0\] \|\| \[\];/,
`        const perService: StaffPublicWithId[][] = [];
        for (const sid of serviceIds) {
          try {
            const rows = await listCoreBookableStaffForDate({
              serviceId: sid,
              date: dateISO,
              slotStepMin,
              bufferMin,
            });
            perService.push(rows.map((row) => row.staff));
          } catch {
            perService.push([]);
          }
        }

        const first = perService[0] || [];`,
  'package dated quick eligibility'
);

// ---- Package starts and selection use Core employee timeline, never salon hours. ----
replaceBetween(
  '  const loadPackageQuickStarts = async (runIdRaw: string, employeeIdRaw: string) => {',
  '  const applyPackageQuickSelection = async (',
`  const loadPackageQuickStarts = async (runIdRaw: string, employeeIdRaw: string) => {
    const runId = String(runIdRaw || "").trim();
    const employeeId = String(employeeIdRaw || "").trim();
    if (!runId || !employeeId) return;
    const runMeta = packageRunMetaByRun[runId];
    if (!runMeta || !runMeta.items.length) return;
    const quickCommonStaff = packageQuickEligibilityByRun[runId]?.commonStaff || [];
    if (!quickCommonStaff.length) return;

    const dateISO = String(runMeta.dateISO || bookingDate || todayISO()).trim();
    const selectedStaff = quickCommonStaff.find(
      (st: any) => String(st?.id || "").trim() === employeeId
    );
    if (!selectedStaff || !isCoreAssignedStaffPubliclyVisible(selectedStaff as any)) return;

    const employeeKey =
      String((selectedStaff as any)?.linkedUid || "").trim() ||
      String((selectedStaff as any)?.id || "").trim();
    const employeeIdFallback = String((selectedStaff as any)?.id || "").trim();
    const dayCfg = getDaySettingsForDate(dateISO);
    setPackageQuickByRun((prev) => ({
      ...prev,
      [runId]: { employeeId, times: [], loading: true, error: "" },
    }));
    if (!dayCfg.enabled) {
      setPackageQuickByRun((prev) => ({
        ...prev,
        [runId]: {
          employeeId,
          times: [],
          loading: false,
          error: "هذا اليوم مغلق للحجوزات.",
        },
      }));
      return;
    }

    try {
      const takenFs = await collectTakenTimesForEmployeeDay({
        salonId: SALON_ID,
        employeeKey,
        employeeIdFallback,
        dateISO,
        forceFresh: true,
        source: "Booking.loadPackageQuickTimes",
      });
      const availability = getCoreStaffAvailabilityForDate(dateISO, employeeIdFallback);
      if (!availability?.availableForDate) throw new Error("CORE_STAFF_UNAVAILABLE");
      const baseSlots = getCoreStaffTimelineSlots(availability, slotStepMin);
      if (!baseSlots.length) throw new Error("CORE_STAFF_NO_SCHEDULE");
      const takenLocal = collectLocalTakenOutsidePackageRun({
        runId,
        employeeKey,
        employeeIdFallback,
        dateISO,
        baseSlots,
      });
      const takenBase = new Set<string>([...Array.from(takenFs), ...Array.from(takenLocal)]);
      const totalWindowMin = Math.max(
        1,
        Number(runMeta.totalWindowMin || runMeta.totalDurationMin || DEFAULT_SERVICE_DURATION_MIN)
      );
      const startsBase = getCoreStaffBookableStartSlots(availability, {
        durationMin: totalWindowMin,
        bufferMin: 0,
        slotStepMin,
      });
      const starts = sortTimesBySlotOrder(
        startsBase
          .map((s) => String(s.value24 || "").trim())
          .filter(Boolean)
          .filter((start) => {
            const simulated = buildPackageRunPlan({
              runItems: runMeta.items,
              startTime24: start,
              baseSlots,
              takenBase,
            });
            return simulated.ok;
          }),
        baseSlots
      ).slice(0, 48);

      setPackageQuickByRun((prev) => ({
        ...prev,
        [runId]: {
          employeeId,
          times: starts,
          loading: false,
          error: starts.length ? "" : "لا توجد أوقات متاحة لهذه الموظفة لكامل مدة البكج.",
        },
      }));
    } catch (e: any) {
      setPackageQuickByRun((prev) => ({
        ...prev,
        [runId]: {
          employeeId,
          times: [],
          loading: false,
          error: String(e?.message || "").startsWith("CORE_STAFF_")
            ? "الموظفة غير متاحة لهذا اليوم حسب Core HR."
            : \`تعذر تحميل الأوقات: ${'${String(e?.message || e || "خطأ غير معروف")}'}\`,
        },
      }));
    }
  };

`,
  'package quick starts Core timeline'
);

replaceBetween(
  '  const applyPackageQuickSelection = async (',
  '  // ✅ Default to first truly available staff only',
`  const applyPackageQuickSelection = async (
    runIdRaw: string,
    employeeIdRaw: string,
    startTime24Raw: string
  ) => {
    const runId = String(runIdRaw || "").trim();
    const employeeId = String(employeeIdRaw || "").trim();
    const startTime24 = String(startTime24Raw || "").trim();
    if (!runId || !employeeId || !startTime24) return;

    const runMeta = packageRunMetaByRun[runId];
    if (!runMeta || !runMeta.items.length) return;
    const quickCommonStaff = packageQuickEligibilityByRun[runId]?.commonStaff || [];
    if (!quickCommonStaff.length) return;
    const dateISO = String(runMeta.dateISO || bookingDate || todayISO()).trim();
    const selectedStaff = quickCommonStaff.find(
      (st: any) => String(st?.id || "").trim() === employeeId
    );
    if (!selectedStaff || !isCoreAssignedStaffPubliclyVisible(selectedStaff as any)) {
      openModal({
        title: "الموظفة غير متاحة للحجز",
        message: "الموظفة المختارة لم تعد متاحة للحجوزات الجديدة. اختاري موظفة أخرى.",
        variant: "danger",
      });
      return;
    }

    const employeeKey =
      String((selectedStaff as any)?.linkedUid || "").trim() ||
      String((selectedStaff as any)?.id || "").trim();
    const employeeIdFallback = String((selectedStaff as any)?.id || "").trim();

    try {
      const takenFs = await collectTakenTimesForEmployeeDay({
        salonId: SALON_ID,
        employeeKey,
        employeeIdFallback,
        dateISO,
        forceFresh: true,
        source: "Booking.applyPackageQuickSelection",
      });
      const availability = getCoreStaffAvailabilityForDate(dateISO, employeeIdFallback);
      if (!availability?.availableForDate) throw new Error("CORE_STAFF_UNAVAILABLE");
      const baseSlots = getCoreStaffTimelineSlots(availability, slotStepMin);
      if (!baseSlots.length) throw new Error("CORE_STAFF_NO_SCHEDULE");
      const takenLocal = collectLocalTakenOutsidePackageRun({
        runId,
        employeeKey,
        employeeIdFallback,
        dateISO,
        baseSlots,
      });
      const takenBase = new Set<string>([...Array.from(takenFs), ...Array.from(takenLocal)]);
      const plan = buildPackageRunPlan({
        runItems: runMeta.items,
        startTime24,
        baseSlots,
        takenBase,
      });
      if (!plan.ok) {
        openModal({
          title: "الوقت لم يعد متاحًا",
          message: "تغيّر التوفر لهذا الوقت. اختاري وقتًا آخر من القائمة.",
          variant: "danger",
        });
        void loadPackageQuickStarts(runId, employeeId);
        return;
      }

      const employeeName = String((selectedStaff as any)?.name || "").trim();
      setFormData((prev) => ({
        ...prev,
        items: (prev.items || []).map((it) => {
          if (String(it.packageRunId || "").trim() !== runId) return it;
          const nextTime = String(plan.plan.get(String(it.id || "").trim()) || "").trim();
          if (!nextTime) return it;
          return {
            ...it,
            date: dateISO,
            employeeId,
            employeeUid: String((selectedStaff as any)?.linkedUid || "").trim(),
            employeeName,
            time: nextTime,
            locked: true,
          };
        }),
      }));
    } catch (e: any) {
      openModal({
        title: "تعذر تطبيق اختيار البكج",
        message: String(e?.message || e || "حدث خطأ غير متوقع."),
        variant: "danger",
      });
    }
  };

`,
  'package quick selection Core timeline'
);

// ---- Auto-selection: Core request decides dated availability; no cache precheck. ----
replaceRegex(
  /        const dayCfg = getDaySettingsForDate\(dateISO\);\n        if \(!dayCfg\.enabled\) continue;\n        const dayOpenTime = safeTimeHHMM\(dayCfg\.openTime, openTime\);\n        const dayCloseTime = safeTimeHHMM\(dayCfg\.closeTime, closeTime\);\n        const baseSlotsForDate = generateSalonTimeSlots\(dayOpenTime, dayCloseTime, slotStepMin\);\n        if \(!baseSlotsForDate\.length\) continue;/,
`        const dayCfg = getDaySettingsForDate(dateISO);
        if (!dayCfg.enabled) continue;`,
  'auto staff salon-grid precheck'
);
replaceRegex(
  /        const bookingVisibleStaff = serviceStaff\.filter\(\(st\) =>\n          isCoreAssignedStaffPubliclyVisible\(st as any, dateISO\)\n        \);\n\n        const candidateStaff = bookingVisibleStaff\.filter\(\(st\) => \{[\s\S]*?\n        \}\);/,
`        const bookingVisibleStaff = serviceStaff.filter((st) =>
          isCoreAssignedStaffPubliclyVisible(st as any)
        );
        const candidateStaff = bookingVisibleStaff;`,
  'auto staff Core-only candidate decision'
);

// ---- Full-day staff state: no salon-grid precheck; fail closed already in stage1. ----
replaceRegex(
  /        const dayOpenTime = safeTimeHHMM\(dayCfg\.openTime, openTime\);\n        const dayCloseTime = safeTimeHHMM\(dayCfg\.closeTime, closeTime\);\n        const baseSlotsForDate = generateSalonTimeSlots\(dayOpenTime, dayCloseTime, slotStepMin\);\n        if \(!baseSlotsForDate\.length\) continue;\n\n        const serviceKey =/,
`        const serviceKey =`,
  'full-day salon-grid precheck'
);
text = text.replaceAll('isCoreAssignedStaffPubliclyVisible(st as any, dateISO)', 'isCoreAssignedStaffPubliclyVisible(st as any)');
text = text.replaceAll('isCoreAssignedStaffPubliclyVisible(st, dateISO)', 'isCoreAssignedStaffPubliclyVisible(st)');

// ---- Confirm one cart item against a fresh authoritative Core response. ----
replaceBetween(
  '  const checkOneItemSlot = async (it: CartItem) => {',
  '  // =========================\n  // Submit',
`  const checkOneItemSlot = async (it: CartItem) => {
    const employeeKey = resolveEmployeeKey(it);
    const date = String(it.date || "").trim();
    const time = String(it.time || "").trim();
    if (!employeeKey || !date || !time) return { ok: false, msg: "بيانات الوقت ناقصة" };

    const dayCfg = getDaySettingsForDate(date);
    if (!dayCfg.enabled) {
      return { ok: false, msg: "اليوم المختار مغلق للحجوزات." };
    }

    const serviceKey =
      resolveCanonicalServiceId(
        String(it.serviceId || "").trim(),
        String((it as any)?.serviceName || "").trim()
      ) || String(it.serviceId || "").trim();
    if (!serviceKey) return { ok: false, msg: "الخدمة غير مرتبطة بكتالوج Core." };

    try {
      const rows = await listCoreBookableStaffForDate({
        serviceId: serviceKey,
        date,
        slotStepMin,
        bufferMin,
        forceFresh: true,
      });
      const selected = rows.find((row) => cartItemMatchesStaff(row.staff, it));
      if (!selected) {
        return { ok: false, msg: "الموظفة المختارة غير متاحة لهذا اليوم حسب Core HR." };
      }

      const selectedStaffId = String((selected.staff as any)?.id || "").trim();
      cacheCoreStaffAvailability(date, selectedStaffId, selected.availability);
      const durationMin = Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN));
      if (!isCoreStaffStartBookable(selected.availability, time, {
        durationMin,
        bufferMin,
        slotStepMin,
      })) {
        return { ok: false, msg: "الوقت لم يعد متاحًا أو لا يكفي لإنهاء الخدمة والبفر ضمن شفت الموظفة." };
      }

      const timesToCheck = expandBookingOccupiedTimes(time, durationMin, bufferMin, slotStepMin);
      const localTaken = getLocalTakenTimesForItem(
        formData.items || [],
        it.id,
        employeeKey,
        date,
        String(it.employeeId || "").trim()
      );
      if (timesToCheck.some((t) => localTaken.has(t))) {
        return { ok: false, msg: "هذا الوقت يتعارض مع خدمة ثانية بنفس الموظفة داخل السلة. اختاري وقتًا آخر." };
      }

      return { ok: true, msg: "" };
    } catch {
      return { ok: false, msg: "تعذر فحص التوفر من Core HR. جرّبي وقتًا آخر." };
    }
  };

`,
  'fresh Core one-item slot confirmation'
);

// ---- Final submit preflight: one force-fresh Core policy for staff + time. ----
replaceBetween(
  '    const unavailableStaffItem = (',
  '    const missing = items.find((it) => {',
`    const authoritativeStaffViolation = (
      await Promise.all(
        items.map(async (it) => {
          if (isSequentialOfferItem(it)) return null;
          const serviceId = String(it.serviceId || "").trim();
          const date = String(it.date || bookingDate || "").trim();
          const time = String(it.time || "").trim();
          const hasSelectedStaff =
            !!String(it.employeeId || "").trim() ||
            !!String(it.employeeUid || "").trim();
          if (!serviceId || !date || !time || !hasSelectedStaff) return null;

          try {
            const rows = await listCoreBookableStaffForDate({
              serviceId,
              date,
              slotStepMin,
              bufferMin,
              forceFresh: true,
            });
            const selected = rows.find((row) => cartItemMatchesStaff(row.staff, it));
            if (!selected) return { item: it, reason: "staff" as const };

            const staffId = String((selected.staff as any)?.id || "").trim();
            cacheCoreStaffAvailability(date, staffId, selected.availability);
            const ok = isCoreStaffStartBookable(selected.availability, time, {
              durationMin: Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN)),
              bufferMin,
              slotStepMin,
            });
            return ok ? null : { item: it, reason: "time" as const };
          } catch {
            return { item: it, reason: "core" as const };
          }
        })
      )
    ).find(Boolean);

    if (authoritativeStaffViolation) {
      const failedItem = authoritativeStaffViolation.item;
      const isStaffFailure = authoritativeStaffViolation.reason === "staff";
      openModal({
        title: isStaffFailure ? "الموظفة غير متاحة للحجز" : "الوقت لم يعد متاحًا",
        message: isStaffFailure
          ? \`الموظفة "${'${String(failedItem.employeeName || "المختارة").trim()}'}" غير متاحة لهذه الخدمة/التاريخ حسب Core HR. اختاري موظفة أخرى.\`
          : \`وقت "${'${formatTime12ForClient(String(failedItem.time || ""))}'}" لم يعد صالحًا للخدمة "${'${String(failedItem.serviceName || "الخدمة").trim()}'}" حسب شفت الموظفة ومدة الخدمة والبفر.\`,
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

`,
  'final fresh Core preflight'
);

// ---- Staff picker: hide only after dated Core result is resolved; no local leave/window prediction. ----
replaceRegex(
  /                          const dayOpenTimeForItem = safeTimeHHMM\(daySettingsForItem\.openTime, openTime\);\n                          const dayCloseTimeForItem = safeTimeHHMM\(daySettingsForItem\.closeTime, closeTime\);\n                          const baseSlotsForUi = daySettingsForItem\.enabled\n                            \? generateSalonTimeSlots\(dayOpenTimeForItem, dayCloseTimeForItem, slotStepMin\)\n                            : \[\];\n\n/,
  '',
  'UI salon-grid variables'
);
replaceBetween(
  '                          const bookingVisibleStaff = serviceStaff.filter((st) =>',
  '                          const packageRunMeta = packageRunId ? packageRunMetaByRun[packageRunId] : undefined;',
`                          const bookingVisibleStaff = serviceStaff.filter((st) =>
                            isCoreAssignedStaffPubliclyVisible(st as any)
                          );
                          const coreUnavailableForItem = staffFullDayByItem[it.id] || {};
                          const staffFingerprintForItem = serviceStaff
                            .map((staff: any) => String(staff?.id || "").trim())
                            .filter(Boolean)
                            .sort()
                            .join(",");
                          const coreAvailabilityKeyForItem = [
                            dateISO,
                            serviceKeyForStaff,
                            String(Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN))),
                            staffFingerprintForItem,
                          ].join("__");
                          const coreAvailabilityLoading =
                            staffFullDayResolvedKeyByItem[it.id] !== coreAvailabilityKeyForItem;
                          const staffChoicesForItem = coreAvailabilityLoading
                            ? []
                            : bookingVisibleStaff.filter((staff: any) => {
                                const id = String(staff?.id || "").trim();
                                return !id || !coreUnavailableForItem[id];
                              });
                          const staffLoading =
                            !!staffLoadingByService[serviceKeyForStaff] || coreAvailabilityLoading;
                          const staffError = staffErrorByService[serviceKeyForStaff] || "";
                          const selectedEmployeeAvailable = staffChoicesForItem.some(
                            (emp) => String(emp?.id || "").trim() === String(it.employeeId || "").trim()
                          );
`,
  'UI Core staff choices'
);
text = text.replace(
`                          const quickCommonStaff = (quickEligibility?.commonStaff || []).filter((st: any) =>
                            isCoreAssignedStaffPubliclyVisible(st, dateISO)
                          );`,
`                          const quickCommonStaff = quickEligibility?.commonStaff || [];`
);

// ---- Time picker: display/group starts from Core scheduleWindows only. ----
replaceBetween(
  '                          const staffUnavailableMsg = ',
  '                          const availableSlotsForItem = staffWindowSections.flatMap((x) =>',
`                          const staffUnavailableMsg =
                            (!staffLoading && !staffError && bookingVisibleStaff.length > 0 && staffChoicesForItem.length === 0)
                              ? "لا توجد موظفات متاحات لهذا التاريخ."
                              : "";
                          const dayFullyBookedMsg =
                            "هذه الموظفة ممتلئ جدولها اليوم. ابحثي عن أقرب يوم متاح لها.";
                          const futureSearchBtnLabel = "بحث عن أقرب موعد";
                          const selectedStaffForTime = staffChoicesForItem.find(
                            (x) => String(x.id || "").trim() === String(it.employeeId || "").trim()
                          );
                          const selectedStaffId = String((selectedStaffForTime as any)?.id || "").trim();
                          const selectedAvailability = selectedStaffForTime
                            ? getCoreStaffAvailabilityForDate(dateISO, selectedStaffId)
                            : null;
                          const staffWindows = selectedAvailability
                            ? getCoreStaffScheduleWindows(selectedAvailability)
                            : [];
                          const authoritativeStarts = selectedAvailability
                            ? getCoreStaffBookableStartSlots(selectedAvailability, {
                                durationMin: Math.max(1, Number(dur || DEFAULT_SERVICE_DURATION_MIN)),
                                bufferMin,
                                slotStepMin,
                                excludeTaken: false,
                              })
                            : [];
                          const authoritativeStartSet = new Set(
                            authoritativeStarts.map((slot) => String(slot.value24 || "").trim())
                          );
                          const exactCartTakenStarts = getLocalExactTakenStartTimesForItem(
                            itemsList,
                            it.id,
                            String(it.employeeId || "").trim(),
                            dateISO
                          );
                          const staffWindowSections: Array<{
                            key: string;
                            label: string;
                            slotCards: TimeSlotCard[];
                          }> = selectedStaffForTime
                              ? staffWindows.map((window, idx) => {
                                const windowSlots = generateSalonTimeSlots(
                                  window.startTime,
                                  window.endTime,
                                  slotStepMin
                                );
                                const startCandidates = windowSlots.filter((slot) =>
                                  authoritativeStartSet.has(String(slot.value24 || "").trim())
                                );
                                const slotCards: TimeSlotCard[] = startCandidates.map((slot) => {
                                  const value24 = String(slot?.value24 || "").trim();
                                  const occupied = expandBookingOccupiedTimes(
                                    value24,
                                    Math.max(1, Number(dur || DEFAULT_SERVICE_DURATION_MIN)),
                                    bufferMin,
                                    slotStepMin
                                  );
                                  const hasBusyConflict =
                                    occupied.some((t) => busy.busyTimes.has(String(t || "").trim())) ||
                                    exactCartTakenStarts.has(value24);
                                  const disabledByRules = busy.disabledStartTimes.has(value24);
                                  if (hasBusyConflict) {
                                    return {
                                      slot,
                                      value24,
                                      state: "booked" as SlotChipState,
                                      reason: "محجوز",
                                      isSelected: String(it.time || "").trim() === value24,
                                    };
                                  }
                                  if (disabledByRules) {
                                    return {
                                      slot,
                                      value24,
                                      state: "unavailable" as SlotChipState,
                                      reason: "غير متاح بسبب التعارض أو البفر",
                                      isSelected: String(it.time || "").trim() === value24,
                                    };
                                  }
                                  return {
                                    slot,
                                    value24,
                                    state: "available" as SlotChipState,
                                    reason: "متاح",
                                    isSelected: String(it.time || "").trim() === value24,
                                  };
                                });
                                return {
                                  key: \`${'${idx}'}_${'${window.startTime}'}_${'${window.endTime}'}\`,
                                  label: buildStaffWindowLabel(window, idx, staffWindows.length),
                                  slotCards,
                                };
                              })
                              : [];
`,
  'UI Core schedule windows and starts'
);

// `daySettingsForItem` remains a salon-wide open/closed display decision only.
void 0;

const forbidden = [
  'getStaffLeaveMetaForDate',
  'isStaffAvailableForDate',
  'isStaffBookableForPublicBooking',
  'filterSlotsByServiceEnd',
  'ResolvedStaffWorkingWindowRange',
  'getCoreStaffWindows',
  'filterSlotsToCoreWindows',
  'isTimeInsideWindowRange',
  'ALLOW_OVERTIME_MIN',
  'CoreStaffService.',
  'coreStaffToLegacy(',
  'listActiveStaffAll(',
];
for (const needle of forbidden) {
  if (text.includes(needle)) {
    throw new Error(`[customer-core-hr-stage2] forbidden booking runtime symbol remains: ${needle}`);
  }
}

for (const required of [
  'listCoreBookableStaffForDate',
  'getCoreStaffBookableStartSlots',
  'getCoreStaffScheduleWindows',
  'isCoreStaffStartBookable',
  'cacheCoreStaffAvailability',
  'authoritativeStaffViolation',
]) {
  if (!text.includes(required)) {
    throw new Error(`[customer-core-hr-stage2] required Core authority symbol missing: ${required}`);
  }
}

const next = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
fs.writeFileSync(file, next, 'utf8');
console.log('[customer-core-hr-stage2] customer Booking stage 2 applied');
