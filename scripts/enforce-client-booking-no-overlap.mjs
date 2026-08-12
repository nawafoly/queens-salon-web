import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content, "utf8");
}

function mustReplace(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`[client-overlap] replacement failed: ${label}`);
  }
  return next;
}

function patchCustomerBooking() {
  const path = "src/pages/Booking.tsx";
  let source = read(path);

  source = mustReplace(
    source,
    /  function getLocalTakenTimesForItem\([\s\S]*?\n  }\n  function pickEffectivePrice/,
    `  function getLocalTakenTimesForItem(
    items: CartItem[],
    currentItemId: string,
    employeeKey: string,
    date: string,
    employeeIdFallback?: string
  ) {
    const taken = new Set<string>();
    const targetKey = String(employeeKey || "").trim();
    const targetEmployeeId = String(employeeIdFallback || "").trim();
    const targetDate = String(date || "").trim();

    for (const other of items) {
      if (!other) continue;
      if (other.id === currentItemId) continue;

      const d = String(other.date || "").trim();
      const t = String(other.time || "").trim();
      if (!d || !t || d !== targetDate) continue;

      const dur = Math.max(1, Number(other.durationMin || DEFAULT_SERVICE_DURATION_MIN));

      // Client-level authority: the same client cannot receive two services at
      // overlapping times even when the services are assigned to different staff.
      // Buffer is an employee turnaround rule, not part of the client's service interval.
      const clientLocked = expandBookingOccupiedTimes(t, dur, 0, slotStepMin);
      clientLocked.forEach((x) => taken.add(x));

      // Preserve the stricter same-staff rule, including the configured buffer.
      const otherKey = resolveEmployeeKey(other);
      const otherEmployeeId = String(other.employeeId || "").trim();
      const sameByKey = !!targetKey && otherKey === targetKey;
      const sameByEmployeeId = !!targetEmployeeId && otherEmployeeId === targetEmployeeId;
      const crossKeyMatch =
        (!!targetEmployeeId && otherKey === targetEmployeeId) ||
        (!!targetKey && otherEmployeeId === targetKey);
      if (sameByKey || sameByEmployeeId || crossKeyMatch) {
        const staffLocked = expandBookingOccupiedTimes(t, dur, bufferMin, slotStepMin);
        staffLocked.forEach((x) => taken.add(x));
      }
    }

    return taken;
  }
  function pickEffectivePrice`,
    "customer local taken times"
  );

  source = mustReplace(
    source,
    /  function findCartOverlap\(items: CartItem\[\]\) \{[\s\S]*?\n  }\n\n  function getLocalExactTakenStartTimesForItem/,
    `  function findCartOverlap(items: CartItem[]) {
    const list = (items || []).map((x) => ({ ...x }));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (isSequentialOfferItem(a) || isSequentialOfferItem(b)) continue;

        const dateA = String(a.date || "").trim();
        const dateB = String(b.date || "").trim();
        const timeA = String(a.time || "").trim();
        const timeB = String(b.time || "").trim();
        if (!dateA || !dateB || !timeA || !timeB || dateA !== dateB) continue;

        const durationA = Math.max(1, Number(a.durationMin || DEFAULT_SERVICE_DURATION_MIN));
        const durationB = Math.max(1, Number(b.durationMin || DEFAULT_SERVICE_DURATION_MIN));
        const clientALocked = new Set(expandBookingOccupiedTimes(timeA, durationA, 0, slotStepMin));
        const clientBLocked = new Set(expandBookingOccupiedTimes(timeB, durationB, 0, slotStepMin));
        const clientOverlap = Array.from(clientALocked).some((time) => clientBLocked.has(time));
        if (clientOverlap) {
          return { ok: false as const, a, b, reason: "client" as const };
        }

        const empA = resolveEmployeeKey(a);
        const empB = resolveEmployeeKey(b);
        const idA = String(a.employeeId || "").trim();
        const idB = String(b.employeeId || "").trim();
        const sameByKey = !!empA && !!empB && empA === empB;
        const sameById = !!idA && !!idB && idA === idB;
        const crossKeyMatch = (!!idA && empB === idA) || (!!idB && empA === idB);
        if (!(sameByKey || sameById || crossKeyMatch)) continue;

        const staffALocked = new Set(expandBookingOccupiedTimes(timeA, durationA, bufferMin, slotStepMin));
        const staffBLocked = new Set(expandBookingOccupiedTimes(timeB, durationB, bufferMin, slotStepMin));
        const staffOverlap = Array.from(staffALocked).some((time) => staffBLocked.has(time));
        if (staffOverlap) {
          return { ok: false as const, a, b, reason: "staff" as const };
        }
      }
    }
    return { ok: true as const, a: null as any, b: null as any, reason: null as null };
  }

  function getLocalExactTakenStartTimesForItem`,
    "customer cart overlap"
  );

  source = mustReplace(
    source,
    /  function getLocalExactTakenStartTimesForItem\([\s\S]*?\n  }\n\n  function findExactCartSlotConflict/,
    `  function getLocalExactTakenStartTimesForItem(
    items: CartItem[],
    currentItemId: string,
    _employeeId: string,
    date: string
  ) {
    const taken = new Set<string>();
    const targetDate = String(date || "").trim();
    if (!targetDate) return taken;

    for (const other of items || []) {
      if (!other || String(other.id || "").trim() === String(currentItemId || "").trim()) continue;
      if (isSequentialOfferItem(other)) continue;

      const otherDate = String(other.date || "").trim();
      const otherTime = String(other.time || "").trim();
      if (!otherDate || !otherTime || otherDate !== targetDate) continue;
      taken.add(otherTime);
    }

    return taken;
  }

  function findExactCartSlotConflict`,
    "customer exact start taken"
  );

  source = mustReplace(
    source,
    /  function findExactCartSlotConflict\([\s\S]*?\n  }\n\n  function findAnyExactCartSlotConflict/,
    `  function findExactCartSlotConflict(
    items: CartItem[],
    currentItemId: string,
    candidate: Partial<CartItem>
  ) {
    const date = String(candidate.date || "").trim();
    const time = String(candidate.time || "").trim();
    if (!date || !time) return null;

    return (
      (items || []).find((other) => {
        if (!other) return false;
        if (String(other.id || "").trim() === String(currentItemId || "").trim()) return false;
        if (isSequentialOfferItem(other)) return false;
        return String(other.date || "").trim() === date && String(other.time || "").trim() === time;
      }) || null
    );
  }

  function findAnyExactCartSlotConflict`,
    "customer exact slot conflict"
  );

  source = source
    .replaceAll("هذا الوقت محجوز لنفس الموظفة داخل السلة، اختاري وقت مختلف.", "العميلة لديها خدمة أخرى في هذا الوقت داخل نفس الحجز. اختاري وقتًا مختلفًا.")
    .replace("هذا الوقت يتعارض مع خدمة ثانية بنفس الموظفة داخل السلة. اختاري وقتًا آخر.", "هذا الوقت يتعارض مع خدمة أخرى لنفس العميلة داخل السلة. اختاري وقتًا آخر.")
    .replace("عندك خدمتين متداخلات بنفس الموظفة ونفس اليوم:", "عندك خدمتين متداخلات لنفس العميلة في نفس اليوم:");

  if (!source.includes("reason: \"client\" as const")) throw new Error("customer client-overlap guard missing");
  if (!source.includes("Buffer is an employee turnaround rule")) throw new Error("customer buffer separation missing");
  write(path, source);
}

function patchInternalBooking() {
  const path = "src/features/internal-booking-v2/BookingInternalV2.tsx";
  let source = read(path);

  source = mustReplace(
    source,
    /  const getCartScheduleConflict = useCallback\([\s\S]*?\n  }, \[cart, scheduleByService, bufferMin\]\);/,
    `  const getCartScheduleConflict = useCallback((serviceKey: string, staffKey: string, time: string) => {
    const currentService = cart.find((item) => String(item.id) === serviceKey);
    const start = timeToMinutes(time);
    if (!currentService || start < 0 || !staffKey) return null;

    const clientEnd = start + Math.max(1, serviceDuration(currentService) || 30);
    const staffEnd = clientEnd + bufferMin;

    for (const other of cart) {
      const otherKey = String(other.id);
      if (otherKey === serviceKey) continue;
      const selected = scheduleByService[otherKey];
      if (!selected?.time) continue;

      const otherStart = timeToMinutes(selected.time);
      if (otherStart < 0) continue;
      const otherClientEnd = otherStart + Math.max(1, serviceDuration(other) || 30);

      // Client-level rule: services in one booking cannot overlap even when
      // they are assigned to different employees.
      if (start < otherClientEnd && otherStart < clientEnd) {
        return {
          kind: "client" as const,
          service: other,
          start: selected.time,
          end: \`${'${String(Math.floor(otherClientEnd / 60)).padStart(2, "0")}:${String(otherClientEnd % 60).padStart(2, "0")}'\`,
        };
      }

      // Keep the stricter employee buffer rule when both services use the same staff member.
      if (selected.staffId === staffKey) {
        const otherStaffEnd = otherClientEnd + bufferMin;
        if (start < otherStaffEnd && otherStart < staffEnd) {
          return {
            kind: "staff" as const,
            service: other,
            start: selected.time,
            end: \`${'${String(Math.floor(otherStaffEnd / 60)).padStart(2, "0")}:${String(otherStaffEnd % 60).padStart(2, "0")}'\`,
          };
        }
      }
    }
    return null;
  }, [cart, scheduleByService, bufferMin]);`,
    "internal cart schedule conflict"
  );

  source = mustReplace(
    source,
    /  const getBusyIntervalsForService = useCallback\([\s\S]*?\n  }, \[cart, scheduleByService, bufferMin\]\);/,
    `  const getBusyIntervalsForService = useCallback((serviceKey: string, staffKey: string) => {
    if (!staffKey) return [];
    return cart.flatMap((other) => {
      const otherKey = String(other.id);
      if (otherKey === serviceKey) return [];
      const selected = scheduleByService[otherKey];
      if (!selected?.time) return [];
      const otherStart = timeToMinutes(selected.time);
      if (otherStart < 0) return [];
      const otherEnd = otherStart + Math.max(1, serviceDuration(other) || 30);
      return [{
        kind: selected.staffId === staffKey ? "staff" as const : "client" as const,
        serviceTitle: serviceTitle(other),
        start: selected.time,
        end: \`${'${String(Math.floor(otherEnd / 60)).padStart(2, "0")}:${String(otherEnd % 60).padStart(2, "0")}'\`,
      }];
    }).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  }, [cart, scheduleByService]);`,
    "internal busy intervals"
  );

  source = source
    .replaceAll("الموظفة مشغولة من", "العميلة لديها خدمة من")
    .replace("هذا الموعد يتعارض مع خدمة أخرى لنفس الموظفة. اختاري وقتًا مختلفًا.", "هذا الموعد يتعارض مع خدمة أخرى في نفس حجز العميلة. اختاري وقتًا مختلفًا.");

  if (!source.includes('kind: "client" as const')) throw new Error("internal client conflict kind missing");
  if (!source.includes("different employees")) throw new Error("internal cross-staff client rule missing");
  write(path, source);
}

function patchCoreBookings() {
  const path = "workers/core/repositories/bookings.js";
  let source = read(path);

  if (!source.includes("export function findClientItemOverlap")) {
    source = mustReplace(
      source,
      `function conflictError() {\n  const error = new Error("booking_conflict");\n  error.code = "core_booking:staff_slot_conflict";\n  return error;\n}\n`,
      `function conflictError() {\n  const error = new Error("booking_conflict");\n  error.code = "core_booking:staff_slot_conflict";\n  return error;\n}\n\nexport function findClientItemOverlap(rows = []) {\n  const items = Array.isArray(rows) ? rows : [];\n  for (let index = 0; index < items.length; index += 1) {\n    const left = items[index] || {};\n    const leftDate = cleanText(left.booking_date || left.bookingDate);\n    const leftStart = cleanText(left.start_time || left.startTime);\n    const leftEnd = cleanText(left.end_time || left.endTime);\n    if (!leftDate || !leftStart || !leftEnd) continue;\n\n    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {\n      const right = items[otherIndex] || {};\n      const rightDate = cleanText(right.booking_date || right.bookingDate);\n      const rightStart = cleanText(right.start_time || right.startTime);\n      const rightEnd = cleanText(right.end_time || right.endTime);\n      if (!rightDate || !rightStart || !rightEnd || rightDate !== leftDate) continue;\n      if (leftStart < rightEnd && rightStart < leftEnd) {\n        return { left, right };\n      }\n    }\n  }\n  return null;\n}\n\nexport function assertNoClientItemOverlap(rows = []) {\n  const conflict = findClientItemOverlap(rows);\n  if (!conflict) return;\n  throw new AppError(\n    409,\n    "core_booking:client_schedule_conflict",\n    "A client cannot receive overlapping services in the same booking",\n    {\n      leftItemId: cleanText(conflict.left?.id),\n      rightItemId: cleanText(conflict.right?.id),\n      bookingDate: cleanText(conflict.left?.booking_date || conflict.left?.bookingDate),\n    }\n  );\n}\n`,
      "core client overlap helper"
    );
  }

  if (!source.includes("assertNoClientItemOverlap(rows);")) {
    source = mustReplace(
      source,
      `\n  const discountApplication = await resolveBookingDiscount(`,
      `\n  // A booking belongs to one client. Different staff assignments must never\n  // allow that client to receive two services at the same time.\n  assertNoClientItemOverlap(rows);\n\n  const discountApplication = await resolveBookingDiscount(`,
      "core create booking overlap assertion"
    );
  }

  if (!source.includes("core_booking:client_schedule_conflict")) throw new Error("Core client conflict code missing");
  write(path, source);
}

function writeRegressionTest() {
  const path = "workers/client-booking-overlap-policy.test.mjs";
  const content = `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { assertNoClientItemOverlap, findClientItemOverlap } from "./core/repositories/bookings.js";\n\nconst row = (id, staffId, start, end, date = "2026-08-20") => ({\n  id,\n  staff_id: staffId,\n  booking_date: date,\n  start_time: start,\n  end_time: end,\n});\n\ntest("client overlap is detected across different employees", () => {\n  const conflict = findClientItemOverlap([\n    row("hair", "staff-a", "15:00", "15:30"),\n    row("cut", "staff-b", "15:10", "15:40"),\n  ]);\n  assert.ok(conflict);\n  assert.equal(conflict.left.id, "hair");\n  assert.equal(conflict.right.id, "cut");\n});\n\ntest("Core rejects overlapping services for one client even with different employees", () => {\n  assert.throws(\n    () => assertNoClientItemOverlap([\n      row("hair", "staff-a", "15:00", "15:30"),\n      row("cut", "staff-b", "15:00", "15:20"),\n    ]),\n    (error) => error?.status === 409 && error?.code === "core_booking:client_schedule_conflict"\n  );\n});\n\ntest("adjacent services are allowed because client buffer is not service time", () => {\n  assert.equal(findClientItemOverlap([\n    row("hair", "staff-a", "15:00", "15:30"),\n    row("cut", "staff-b", "15:30", "16:00"),\n  ]), null);\n});\n\ntest("same clock time on different dates is allowed", () => {\n  assert.equal(findClientItemOverlap([\n    row("hair", "staff-a", "15:00", "15:30", "2026-08-20"),\n    row("cut", "staff-b", "15:00", "15:30", "2026-08-21"),\n  ]), null);\n});\n`;
  write(path, content);
}

patchCustomerBooking();
patchInternalBooking();
patchCoreBookings();
writeRegressionTest();
console.log("[client-overlap] patch applied");
