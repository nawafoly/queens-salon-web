import fs from "node:fs";

const lines = (rows) => `${rows.join("\n")}\n`;

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content, "utf8");
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`[client-overlap] start marker missing: ${label}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`[client-overlap] end marker missing: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

function insertBefore(source, marker, insertion, label) {
  const index = source.indexOf(marker);
  if (index < 0) throw new Error(`[client-overlap] insertion marker missing: ${label}`);
  return source.slice(0, index) + insertion + source.slice(index);
}

function patchCustomerBooking() {
  const path = "src/pages/Booking.tsx";
  let source = read(path);

  source = replaceBlock(
    source,
    "  function getLocalTakenTimesForItem(",
    "  function pickEffectivePrice(",
    lines([
      "  function getLocalTakenTimesForItem(",
      "    items: CartItem[],",
      "    currentItemId: string,",
      "    employeeKey: string,",
      "    date: string,",
      "    employeeIdFallback?: string",
      "  ) {",
      "    const taken = new Set<string>();",
      "    const targetKey = String(employeeKey || \"\").trim();",
      "    const targetEmployeeId = String(employeeIdFallback || \"\").trim();",
      "    const targetDate = String(date || \"\").trim();",
      "",
      "    for (const other of items) {",
      "      if (!other || other.id === currentItemId) continue;",
      "      const d = String(other.date || \"\").trim();",
      "      const t = String(other.time || \"\").trim();",
      "      if (!d || !t || d !== targetDate) continue;",
      "",
      "      const dur = Math.max(1, Number(other.durationMin || DEFAULT_SERVICE_DURATION_MIN));",
      "",
      "      // Client-level authority: one client cannot receive overlapping services,",
      "      // even when those services are assigned to different employees.",
      "      // The employee buffer is not part of the client's occupied service interval.",
      "      expandBookingOccupiedTimes(t, dur, 0, slotStepMin).forEach((slot) => taken.add(slot));",
      "",
      "      // Preserve the stricter same-employee rule, including the configured buffer.",
      "      const otherKey = resolveEmployeeKey(other);",
      "      const otherEmployeeId = String(other.employeeId || \"\").trim();",
      "      const sameByKey = !!targetKey && otherKey === targetKey;",
      "      const sameByEmployeeId = !!targetEmployeeId && otherEmployeeId === targetEmployeeId;",
      "      const crossKeyMatch =",
      "        (!!targetEmployeeId && otherKey === targetEmployeeId) ||",
      "        (!!targetKey && otherEmployeeId === targetKey);",
      "      if (sameByKey || sameByEmployeeId || crossKeyMatch) {",
      "        expandBookingOccupiedTimes(t, dur, bufferMin, slotStepMin).forEach((slot) => taken.add(slot));",
      "      }",
      "    }",
      "",
      "    return taken;",
      "  }",
      "",
    ]),
    "customer local occupied times"
  );

  source = replaceBlock(
    source,
    "  function findCartOverlap(items: CartItem[]) {",
    "  function getLocalExactTakenStartTimesForItem(",
    lines([
      "  function findCartOverlap(items: CartItem[]) {",
      "    const list = (items || []).map((item) => ({ ...item }));",
      "    for (let i = 0; i < list.length; i++) {",
      "      for (let j = i + 1; j < list.length; j++) {",
      "        const a = list[i];",
      "        const b = list[j];",
      "        if (isSequentialOfferItem(a) || isSequentialOfferItem(b)) continue;",
      "",
      "        const dateA = String(a.date || \"\").trim();",
      "        const dateB = String(b.date || \"\").trim();",
      "        const timeA = String(a.time || \"\").trim();",
      "        const timeB = String(b.time || \"\").trim();",
      "        if (!dateA || !dateB || !timeA || !timeB || dateA !== dateB) continue;",
      "",
      "        const startA = toMinutes(timeA);",
      "        const startB = toMinutes(timeB);",
      "        if (!Number.isFinite(startA) || !Number.isFinite(startB)) continue;",
      "        const durationA = Math.max(1, Number(a.durationMin || DEFAULT_SERVICE_DURATION_MIN));",
      "        const durationB = Math.max(1, Number(b.durationMin || DEFAULT_SERVICE_DURATION_MIN));",
      "        const endA = startA + durationA;",
      "        const endB = startB + durationB;",
      "",
      "        if (startA < endB && startB < endA) {",
      "          return { ok: false as const, a, b, reason: \"client\" as const };",
      "        }",
      "",
      "        const empA = resolveEmployeeKey(a);",
      "        const empB = resolveEmployeeKey(b);",
      "        const idA = String(a.employeeId || \"\").trim();",
      "        const idB = String(b.employeeId || \"\").trim();",
      "        const sameByKey = !!empA && !!empB && empA === empB;",
      "        const sameById = !!idA && !!idB && idA === idB;",
      "        const crossKeyMatch = (!!idA && empB === idA) || (!!idB && empA === idB);",
      "        if ((sameByKey || sameById || crossKeyMatch) && startA < endB + bufferMin && startB < endA + bufferMin) {",
      "          return { ok: false as const, a, b, reason: \"staff\" as const };",
      "        }",
      "      }",
      "    }",
      "    return { ok: true as const, a: null as any, b: null as any, reason: null as null };",
      "  }",
      "",
    ]),
    "customer cart overlap"
  );

  source = replaceBlock(
    source,
    "  function getLocalExactTakenStartTimesForItem(",
    "  function findExactCartSlotConflict(",
    lines([
      "  function getLocalExactTakenStartTimesForItem(",
      "    items: CartItem[],",
      "    currentItemId: string,",
      "    _employeeId: string,",
      "    date: string",
      "  ) {",
      "    const taken = new Set<string>();",
      "    const targetDate = String(date || \"\").trim();",
      "    if (!targetDate) return taken;",
      "",
      "    for (const other of items || []) {",
      "      if (!other || String(other.id || \"\").trim() === String(currentItemId || \"\").trim()) continue;",
      "      if (isSequentialOfferItem(other)) continue;",
      "      const otherDate = String(other.date || \"\").trim();",
      "      const otherTime = String(other.time || \"\").trim();",
      "      if (!otherDate || !otherTime || otherDate !== targetDate) continue;",
      "      taken.add(otherTime);",
      "    }",
      "    return taken;",
      "  }",
      "",
    ]),
    "customer exact occupied starts"
  );

  source = replaceBlock(
    source,
    "  function findExactCartSlotConflict(",
    "  function findAnyExactCartSlotConflict(",
    lines([
      "  function findExactCartSlotConflict(",
      "    items: CartItem[],",
      "    currentItemId: string,",
      "    candidate: Partial<CartItem>",
      "  ) {",
      "    const date = String(candidate.date || \"\").trim();",
      "    const time = String(candidate.time || \"\").trim();",
      "    if (!date || !time) return null;",
      "",
      "    return (",
      "      (items || []).find((other) => {",
      "        if (!other) return false;",
      "        if (String(other.id || \"\").trim() === String(currentItemId || \"\").trim()) return false;",
      "        if (isSequentialOfferItem(other)) return false;",
      "        return String(other.date || \"\").trim() === date && String(other.time || \"\").trim() === time;",
      "      }) || null",
      "    );",
      "  }",
      "",
    ]),
    "customer exact overlap"
  );

  source = source
    .replaceAll("هذا الوقت محجوز لنفس الموظفة داخل السلة، اختاري وقت مختلف.", "العميلة لديها خدمة أخرى في هذا الوقت داخل نفس الحجز. اختاري وقتًا مختلفًا.")
    .replace("هذا الوقت يتعارض مع خدمة ثانية بنفس الموظفة داخل السلة. اختاري وقتًا آخر.", "هذا الوقت يتعارض مع خدمة أخرى لنفس العميلة داخل السلة. اختاري وقتًا آخر.")
    .replace("عندك خدمتين متداخلات بنفس الموظفة ونفس اليوم:", "عندك خدمتين متداخلات لنفس العميلة في نفس اليوم:");

  if (!source.includes('reason: "client" as const')) throw new Error("customer client overlap rule missing");
  if (!source.includes("different employees")) throw new Error("customer cross-employee rule missing");
  write(path, source);
}

function patchInternalBooking() {
  const path = "src/features/internal-booking-v2/BookingInternalV2.tsx";
  let source = read(path);

  source = replaceBlock(
    source,
    "  const getCartScheduleConflict = useCallback(",
    "  const hasCartScheduleConflict = useCallback(",
    lines([
      "  const getCartScheduleConflict = useCallback((serviceKey: string, staffKey: string, time: string) => {",
      "    const currentService = cart.find((item) => String(item.id) === serviceKey);",
      "    const start = timeToMinutes(time);",
      "    if (!currentService || start < 0 || !staffKey) return null;",
      "",
      "    const clientEnd = start + Math.max(1, serviceDuration(currentService) || 30);",
      "    const staffEnd = clientEnd + bufferMin;",
      "",
      "    for (const other of cart) {",
      "      const otherKey = String(other.id);",
      "      if (otherKey === serviceKey) continue;",
      "      const selected = scheduleByService[otherKey];",
      "      if (!selected?.time) continue;",
      "      const otherStart = timeToMinutes(selected.time);",
      "      if (otherStart < 0) continue;",
      "      const otherClientEnd = otherStart + Math.max(1, serviceDuration(other) || 30);",
      "",
      "      // Client-level rule: services in one booking cannot overlap even when",
      "      // they are assigned to different employees.",
      "      if (start < otherClientEnd && otherStart < clientEnd) {",
      "        return {",
      "          kind: \"client\" as const,",
      "          service: other,",
      "          start: selected.time,",
      "          end: `${String(Math.floor(otherClientEnd / 60)).padStart(2, \"0\")}:${String(otherClientEnd % 60).padStart(2, \"0\")}`,",
      "        };",
      "      }",
      "",
      "      // Same staff remains stricter because its turnaround buffer must also be free.",
      "      if (selected.staffId === staffKey) {",
      "        const otherStaffEnd = otherClientEnd + bufferMin;",
      "        if (start < otherStaffEnd && otherStart < staffEnd) {",
      "          return {",
      "            kind: \"staff\" as const,",
      "            service: other,",
      "            start: selected.time,",
      "            end: `${String(Math.floor(otherStaffEnd / 60)).padStart(2, \"0\")}:${String(otherStaffEnd % 60).padStart(2, \"0\")}`,",
      "          };",
      "        }",
      "      }",
      "    }",
      "    return null;",
      "  }, [cart, scheduleByService, bufferMin]);",
      "",
    ]),
    "internal cart overlap"
  );

  source = replaceBlock(
    source,
    "  const getBusyIntervalsForService = useCallback(",
    "  const conflictKeys = useMemo(",
    lines([
      "  const getBusyIntervalsForService = useCallback((serviceKey: string, staffKey: string) => {",
      "    if (!staffKey) return [];",
      "    return cart.flatMap((other) => {",
      "      const otherKey = String(other.id);",
      "      if (otherKey === serviceKey) return [];",
      "      const selected = scheduleByService[otherKey];",
      "      if (!selected?.time) return [];",
      "      const otherStart = timeToMinutes(selected.time);",
      "      if (otherStart < 0) return [];",
      "      const otherEnd = otherStart + Math.max(1, serviceDuration(other) || 30);",
      "      return [{",
      "        kind: selected.staffId === staffKey ? \"staff\" as const : \"client\" as const,",
      "        serviceTitle: serviceTitle(other),",
      "        start: selected.time,",
      "        end: `${String(Math.floor(otherEnd / 60)).padStart(2, \"0\")}:${String(otherEnd % 60).padStart(2, \"0\")}`,",
      "      }];",
      "    }).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));",
      "  }, [cart, scheduleByService]);",
      "",
    ]),
    "internal busy intervals"
  );

  source = source
    .replaceAll("الموظفة مشغولة من", "العميلة لديها خدمة من")
    .replace("هذا الموعد يتعارض مع خدمة أخرى لنفس الموظفة. اختاري وقتًا مختلفًا.", "هذا الموعد يتعارض مع خدمة أخرى في نفس حجز العميلة. اختاري وقتًا مختلفًا.");

  if (!source.includes('kind: "client" as const')) throw new Error("internal client overlap rule missing");
  if (!source.includes("different employees")) throw new Error("internal cross-employee rule missing");
  write(path, source);
}

function patchCoreBookings() {
  const path = "workers/core/repositories/bookings.js";
  let source = read(path);

  if (!source.includes("export function findClientItemOverlap")) {
    source = insertBefore(
      source,
      "async function existingRangeConflict(",
      lines([
        "export function findClientItemOverlap(rows = []) {",
        "  const items = Array.isArray(rows) ? rows : [];",
        "  for (let index = 0; index < items.length; index += 1) {",
        "    const left = items[index] || {};",
        "    const leftDate = cleanText(left.booking_date || left.bookingDate);",
        "    const leftStart = cleanText(left.start_time || left.startTime);",
        "    const leftEnd = cleanText(left.end_time || left.endTime);",
        "    if (!leftDate || !leftStart || !leftEnd) continue;",
        "",
        "    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {",
        "      const right = items[otherIndex] || {};",
        "      const rightDate = cleanText(right.booking_date || right.bookingDate);",
        "      const rightStart = cleanText(right.start_time || right.startTime);",
        "      const rightEnd = cleanText(right.end_time || right.endTime);",
        "      if (!rightDate || !rightStart || !rightEnd || rightDate !== leftDate) continue;",
        "      if (leftStart < rightEnd && rightStart < leftEnd) return { left, right };",
        "    }",
        "  }",
        "  return null;",
        "}",
        "",
        "function clientScheduleConflict(details = {}) {",
        "  return new AppError(",
        "    409,",
        "    \"core_booking:client_schedule_conflict\",",
        "    \"A client cannot receive overlapping services\",",
        "    details",
        "  );",
        "}",
        "",
        "export function assertNoClientItemOverlap(rows = []) {",
        "  const conflict = findClientItemOverlap(rows);",
        "  if (!conflict) return;",
        "  throw clientScheduleConflict({",
        "    leftItemId: cleanText(conflict.left?.id),",
        "    rightItemId: cleanText(conflict.right?.id),",
        "    bookingDate: cleanText(conflict.left?.booking_date || conflict.left?.bookingDate),",
        "  });",
        "}",
        "",
        "export async function existingClientRangeConflict(",
        "  db,",
        "  salonId,",
        "  clientId,",
        "  bookingDate,",
        "  startTime,",
        "  endTime,",
        "  excludeBookingId = \"\"",
        ") {",
        "  if (!clientId) return null;",
        "",
        "  if (db.__fakeD1 && typeof db.rows === \"function\") {",
        "    const bookings = db.rows(\"bookings\");",
        "    const items = db.rows(\"booking_items\");",
        "    for (const item of items) {",
        "      const booking = bookings.find(",
        "        (row) => row.id === item.booking_id && row.salon_id === salonId && row.client_id === clientId",
        "      );",
        "      if (!booking || booking.id === excludeBookingId) continue;",
        "      if (CANCELLED_STATUSES.has(cleanText(booking.status).toLowerCase())) continue;",
        "      const itemDate = cleanText(item.booking_date || booking.booking_date);",
        "      const itemStart = cleanText(item.start_time || booking.start_time);",
        "      const itemEnd = cleanText(item.end_time || booking.end_time);",
        "      if (itemDate === bookingDate && itemStart < endTime && itemEnd > startTime) return { id: booking.id };",
        "    }",
        "    return null;",
        "  }",
        "",
        "  return dbFirst(",
        "    db,",
        "    `SELECT b.id",
        "       FROM booking_items bi",
        "       INNER JOIN bookings b ON b.id = bi.booking_id AND b.salon_id = bi.salon_id",
        "      WHERE bi.salon_id = ?",
        "        AND b.client_id = ?",
        "        AND COALESCE(bi.booking_date, b.booking_date) = ?",
        "        AND LOWER(b.status) NOT IN ('cancelled', 'canceled', 'rejected')",
        "        AND b.id != ?",
        "        AND COALESCE(bi.start_time, b.start_time) < ?",
        "        AND COALESCE(bi.end_time, b.end_time) > ?",
        "      LIMIT 1`,",
        "    [salonId, clientId, bookingDate, excludeBookingId, endTime, startTime]",
        "  );",
        "}",
        "",
      ]),
      "Core client overlap helpers"
    );
  }

  if (!source.includes("assertNoClientItemOverlap(rows);")) {
    source = insertBefore(
      source,
      "  const discountApplication = await resolveBookingDiscount(",
      lines([
        "  // One client cannot be in two services at the same time, regardless of staff.",
        "  assertNoClientItemOverlap(rows);",
        "  for (const row of rows) {",
        "    const existingClientConflict = await existingClientRangeConflict(",
        "      db,",
        "      salonId,",
        "      clientId,",
        "      row.booking_date,",
        "      row.start_time,",
        "      row.end_time,",
        "      requestedBookingId || \"\"",
        "    );",
        "    if (existingClientConflict) {",
        "      throw clientScheduleConflict({",
        "        conflictingBookingId: cleanText(existingClientConflict.id),",
        "        bookingDate: row.booking_date,",
        "        startTime: row.start_time,",
        "        endTime: row.end_time,",
        "      });",
        "    }",
        "  }",
        "",
      ]),
      "Core create booking enforcement"
    );
  }

  if (!source.includes("core_booking:client_schedule_conflict")) throw new Error("Core client conflict code missing");
  if (!source.includes("existingClientRangeConflict")) throw new Error("Core existing-client overlap guard missing");
  write(path, source);
}

function writeRegressionTest() {
  write(
    "workers/client-booking-overlap-policy.test.mjs",
    lines([
      'import assert from "node:assert/strict";',
      'import { test } from "node:test";',
      'import { assertNoClientItemOverlap, existingClientRangeConflict, findClientItemOverlap } from "./core/repositories/bookings.js";',
      "",
      'const row = (id, staffId, start, end, date = "2026-08-20") => ({',
      "  id,",
      "  staff_id: staffId,",
      "  booking_date: date,",
      "  start_time: start,",
      "  end_time: end,",
      "});",
      "",
      'test("client overlap is detected across different employees", () => {',
      "  const conflict = findClientItemOverlap([",
      '    row("hair", "staff-a", "15:00", "15:30"),',
      '    row("cut", "staff-b", "15:10", "15:40"),',
      "  ]);",
      "  assert.ok(conflict);",
      '  assert.equal(conflict.left.id, "hair");',
      '  assert.equal(conflict.right.id, "cut");',
      "});",
      "",
      'test("Core rejects overlapping services in one booking across employees", () => {',
      "  assert.throws(",
      "    () => assertNoClientItemOverlap([",
      '      row("hair", "staff-a", "15:00", "15:30"),',
      '      row("cut", "staff-b", "15:00", "15:20"),',
      "    ]),",
      '    (error) => error?.status === 409 && error?.code === "core_booking:client_schedule_conflict"',
      "  );",
      "});",
      "",
      'test("adjacent services are allowed; employee buffer is not client service time", () => {',
      "  assert.equal(findClientItemOverlap([",
      '    row("hair", "staff-a", "15:00", "15:30"),',
      '    row("cut", "staff-b", "15:30", "16:00"),',
      "  ]), null);",
      "});",
      "",
      'test("different dates do not conflict", () => {',
      "  assert.equal(findClientItemOverlap([",
      '    row("hair", "staff-a", "15:00", "15:30", "2026-08-20"),',
      '    row("cut", "staff-b", "15:00", "15:30", "2026-08-21"),',
      "  ]), null);",
      "});",
      "",
      'test("existing booking for the same client blocks an overlapping new service", async () => {',
      "  const tables = {",
      '    bookings: [{ id: "booking-old", salon_id: "main", client_id: "client-1", status: "booked", booking_date: "2026-08-20", start_time: "15:00", end_time: "15:30" }],',
      '    booking_items: [{ id: "item-old", booking_id: "booking-old", salon_id: "main", staff_id: "staff-a", booking_date: "2026-08-20", start_time: "15:00", end_time: "15:30" }],',
      "  };",
      "  const fake = { __fakeD1: true, rows: (table) => tables[table] || [] };",
      '  const conflict = await existingClientRangeConflict(fake, "main", "client-1", "2026-08-20", "15:10", "15:40");',
      '  assert.equal(conflict?.id, "booking-old");',
      "});",
      "",
      'test("another client does not block the requested time", async () => {',
      "  const tables = {",
      '    bookings: [{ id: "booking-other", salon_id: "main", client_id: "client-2", status: "booked", booking_date: "2026-08-20", start_time: "15:00", end_time: "15:30" }],',
      '    booking_items: [{ id: "item-other", booking_id: "booking-other", salon_id: "main", staff_id: "staff-a", booking_date: "2026-08-20", start_time: "15:00", end_time: "15:30" }],',
      "  };",
      "  const fake = { __fakeD1: true, rows: (table) => tables[table] || [] };",
      '  const conflict = await existingClientRangeConflict(fake, "main", "client-1", "2026-08-20", "15:10", "15:40");',
      "  assert.equal(conflict, null);",
      "});",
    ])
  );
}

patchCustomerBooking();
patchInternalBooking();
patchCoreBookings();
writeRegressionTest();
console.log("[client-overlap] patch applied");
