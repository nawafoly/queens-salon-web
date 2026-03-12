// src/services/firestoreAvailabilityBackfill.ts
// One-time helper: backfill aggregated availability index from legacy `booking_slots`.

import { db } from "./firebase";
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";

type BackfillEmployee = { employeeId: string; employeeKey?: string };

type BackfillOpts = {
  salonId?: string; // defaults to "main"
  fromDateISO: string; // YYYY-MM-DD (inclusive)
  toDateISO: string; // YYYY-MM-DD (inclusive)
  // Optional explicit list of employees to backfill. If omitted, loads from `staff_public`.
  employees?: BackfillEmployee[];
  dryRun?: boolean;
  // Safety valve: abort if the requested range is too large.
  maxDays?: number; // default 200 (covers -90/+90)
  // Write throttling (Spark-friendly).
  batchSize?: number; // default 450 (<= 500)
  batchDelayMs?: number; // default 250
  dayDelayMs?: number; // default 50
  // Abort hook (e.g. component unmount).
  shouldAbort?: () => boolean;
};

function parseISODateYMD(value: string): { y: number; m: number; d: number } | null {
  const m = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function toUTCDate(ymd: { y: number; m: number; d: number }) {
  return new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d));
}

function formatISODateUTC(dt: Date) {
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + 1;
  const d = dt.getUTCDate();
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function listISODateRangeInclusive(fromISO: string, toISO: string, maxDays: number) {
  const from = parseISODateYMD(fromISO);
  const to = parseISODateYMD(toISO);
  if (!from || !to) throw new Error("INVALID_DATE_RANGE");
  const start = toUTCDate(from);
  const end = toUTCDate(to);
  if (start.getTime() > end.getTime()) throw new Error("INVALID_DATE_RANGE");

  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < maxDays + 1; i++) {
    const iso = formatISODateUTC(cur);
    out.push(iso);
    if (iso === toISO) break;
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }

  if (out[out.length - 1] !== toISO) {
    throw new Error("DATE_RANGE_TOO_LARGE");
  }

  return out;
}

function sleep(ms: number) {
  const delay = Math.max(0, Number(ms || 0));
  if (!delay) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, delay));
}

async function listStaffPublicEmployees(salonId: string): Promise<BackfillEmployee[]> {
  try {
    const colRef = collection(db, "salons", salonId, "staff_public");
    const snaps = await getDocs(colRef);
    const out: BackfillEmployee[] = [];
    snaps.docs.forEach((d) => {
      const employeeId = String(d.id || "").trim();
      if (!employeeId) return;
      const data: any = d.data() || {};
      const linkedUid = String(data?.linkedUid ?? "").trim();
      out.push({ employeeId, employeeKey: linkedUid || employeeId });
    });
    return out;
  } catch (e: any) {
    console.error("[availability_backfill] staff_public load ERROR:", e?.code, e?.message, e);
    return [];
  }
}

export async function backfillAvailabilityDaysFromBookingSlots(opts: BackfillOpts) {
  const salonId = String(opts?.salonId || "main").trim() || "main";
  const fromDateISO = String(opts?.fromDateISO || "").trim();
  const toDateISO = String(opts?.toDateISO || "").trim();
  const dryRun = !!opts?.dryRun;
  const maxDays = Math.max(1, Number(opts?.maxDays ?? 200));
  const batchSize = Math.min(450, Math.max(1, Number(opts?.batchSize ?? 450)));
  const batchDelayMs = Math.max(0, Number(opts?.batchDelayMs ?? 250));
  const dayDelayMs = Math.max(0, Number(opts?.dayDelayMs ?? 50));
  const shouldAbort = typeof opts?.shouldAbort === "function" ? opts.shouldAbort : undefined;

  const dates = listISODateRangeInclusive(fromDateISO, toDateISO, maxDays);

  const providedEmployees = Array.isArray(opts?.employees) ? opts.employees : undefined;
  const baseEmployees =
    providedEmployees && providedEmployees.length
      ? providedEmployees
          .map((e) => ({
            employeeId: String(e?.employeeId || "").trim(),
            employeeKey: String(e?.employeeKey || "").trim() || undefined,
          }))
          .filter((e) => !!e.employeeId)
      : await listStaffPublicEmployees(salonId);

  const employeeKeyById = new Map<string, string>();
  baseEmployees.forEach((e) => {
    const id = String(e.employeeId || "").trim();
    if (!id) return;
    const key = String(e.employeeKey || "").trim() || id;
    employeeKeyById.set(id, key);
  });

  console.log("[availability_backfill] start", {
    salonId,
    fromDateISO,
    toDateISO,
    days: dates.length,
    employees: employeeKeyById.size,
    dryRun,
    batchSize,
    batchDelayMs,
    dayDelayMs,
  });

  let totalSlotDocs = 0;
  let totalAvailabilityDocsRead = 0;
  let totalWritesPlanned = 0;
  let totalWritesCommitted = 0;
  let totalSkippedComplete = 0;
  let totalDaysSkippedAllComplete = 0;
  let totalBatchesCommitted = 0;

  if (!employeeKeyById.size) {
    console.warn("[availability_backfill] No employees found; aborting.");
    return {
      salonId,
      fromDateISO,
      toDateISO,
      days: dates.length,
      employeeCount: 0,
      totalSlotDocs: 0,
      totalAvailabilityDocsRead: 0,
      totalWritesPlanned: 0,
      totalWritesCommitted: 0,
      totalSkippedComplete: 0,
      totalDaysSkippedAllComplete: 0,
      totalBatchesCommitted: 0,
      dryRun,
      aborted: true as const,
    };
  }

  // Shared booking_slots query root.
  const slotsCol = collection(db, "salons", salonId, "booking_slots");

  // Batch writes (safety: 500 ops per batch).
  let batch = writeBatch(db);
  let ops = 0;

  const commitBatch = async (reason: string) => {
    if (ops <= 0) return;
    if (shouldAbort?.()) throw new Error("ABORTED");
    await batch.commit();
    totalWritesCommitted += ops;
    totalBatchesCommitted += 1;
    console.log("[availability_backfill] committed", { reason, ops, totalWritesCommitted });
    batch = writeBatch(db);
    ops = 0;
    if (batchDelayMs > 0) await sleep(batchDelayMs);
  };

  for (let di = 0; di < dates.length; di++) {
    const dateISO = dates[di];
    if (shouldAbort?.()) throw new Error("ABORTED");

    // 1) Read existing availability docs to skip `complete=true` ones.
    const availCol = collection(db, "salons", salonId, "availability_days", dateISO, "employees");
    const availSnap = await getDocs(availCol);
    totalAvailabilityDocsRead += availSnap.size;

    const existing = new Map<string, { exists: true; complete: boolean; employeeKey?: string }>();
    availSnap.docs.forEach((d) => {
      const data: any = d.data() || {};
      existing.set(String(d.id || "").trim(), {
        exists: true,
        complete: data?.complete === true,
        employeeKey: String(data?.employeeKey ?? "").trim() || undefined,
      });
    });

    // Determine which base employees still need work on this date.
    const pendingBase: BackfillEmployee[] = [];
    for (const [employeeId, employeeKey] of employeeKeyById.entries()) {
      const ex = existing.get(employeeId);
      if (ex?.complete === true) {
        totalSkippedComplete += 1;
        continue;
      }
      pendingBase.push({ employeeId, employeeKey });
    }

    if (!pendingBase.length) {
      totalDaysSkippedAllComplete += 1;
      console.log("[availability_backfill] skip day (all complete)", {
        dateISO,
        day: `${di + 1}/${dates.length}`,
      });
      if (dayDelayMs > 0) await sleep(dayDelayMs);
      continue;
    }

    // 2) Read booking_slots for that day and group by employeeId.
    const slotSnap = await getDocs(query(slotsCol, where("date", "==", dateISO)));
    totalSlotDocs += slotSnap.size;

    const timesByEmployeeId = new Map<string, { employeeKey: string; times: Set<string> }>();
    slotSnap.docs.forEach((d) => {
      const sd: any = d.data() || {};
      const employeeId = String(sd.employeeId ?? "").trim();
      const time = String(sd.time || "").trim();
      if (!employeeId || !time) return;

      const employeeKey = String(sd.employeeKey ?? "").trim() || employeeId;
      const entry = timesByEmployeeId.get(employeeId) || {
        employeeKey,
        times: new Set<string>(),
      };
      entry.times.add(time);
      if (!entry.employeeKey) entry.employeeKey = employeeKey;
      timesByEmployeeId.set(employeeId, entry);
    });

    // Also backfill any employeeIds that appear in booking_slots but are not in staff_public.
    const extraEmployees: BackfillEmployee[] = [];
    for (const [employeeId, entry] of timesByEmployeeId.entries()) {
      if (employeeKeyById.has(employeeId)) continue;
      const ex = existing.get(employeeId);
      if (ex?.complete === true) {
        totalSkippedComplete += 1;
        continue;
      }
      extraEmployees.push({ employeeId, employeeKey: entry.employeeKey || employeeId });
    }

    const employeesForDay = [...pendingBase, ...extraEmployees];

    console.log("[availability_backfill] day", {
      dateISO,
      day: `${di + 1}/${dates.length}`,
      pending: employeesForDay.length,
      slotDocs: slotSnap.size,
    });

    // 3) Write availability_days for each pending employee (empty map allowed).
    for (const emp of employeesForDay) {
      if (shouldAbort?.()) throw new Error("ABORTED");
      const employeeId = String(emp.employeeId || "").trim();
      if (!employeeId) continue;

      const bookedSlots: Record<string, true> = {};
      const entry = timesByEmployeeId.get(employeeId);
      entry?.times.forEach((t) => {
        const k = String(t || "").trim();
        if (k) bookedSlots[k] = true;
      });

      const employeeKey =
        String(emp.employeeKey || "").trim() ||
        String(existing.get(employeeId)?.employeeKey || "").trim() ||
        String(entry?.employeeKey || "").trim() ||
        employeeId;

      const ref = doc(db, "salons", salonId, "availability_days", dateISO, "employees", employeeId);
      totalWritesPlanned += 1;

      if (!dryRun) {
        if (existing.get(employeeId)?.exists) {
          // Use update to REPLACE the bookedSlots map (fixes stale keys) while preserving other fields (e.g. breakSlots).
          batch.update(ref, {
            date: dateISO,
            employeeId,
            employeeKey,
            bookedSlots,
            complete: true,
            updatedAt: serverTimestamp(),
          } as any);
        } else {
          batch.set(
            ref,
            {
              date: dateISO,
              employeeId,
              employeeKey,
              bookedSlots,
              complete: true,
              updatedAt: serverTimestamp(),
            } as any,
            { merge: true } as any
          );
        }
        ops++;
      }

      if (ops >= batchSize) {
        await commitBatch("batchSize");
      }
    }

    if (dayDelayMs > 0) await sleep(dayDelayMs);
  }

  await commitBatch("final");

  const result = {
    salonId,
    fromDateISO,
    toDateISO,
    days: dates.length,
    employeeCount: employeeKeyById.size,
    totalSlotDocs,
    totalAvailabilityDocsRead,
    totalWritesPlanned,
    totalWritesCommitted,
    totalSkippedComplete,
    totalDaysSkippedAllComplete,
    totalBatchesCommitted,
    dryRun,
    aborted: false as const,
  };

  console.log("[availability_backfill] done", result);
  return result;
}
