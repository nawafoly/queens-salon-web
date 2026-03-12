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

type BackfillOpts = {
  salonId?: string; // defaults to "main"
  fromDateISO: string; // YYYY-MM-DD (inclusive)
  toDateISO: string; // YYYY-MM-DD (inclusive)
  dryRun?: boolean;
  // Safety valve: abort if the requested range is too large.
  maxDays?: number; // default 120
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

export async function backfillAvailabilityDaysFromBookingSlots(opts: BackfillOpts) {
  const salonId = String(opts?.salonId || "main").trim() || "main";
  const fromDateISO = String(opts?.fromDateISO || "").trim();
  const toDateISO = String(opts?.toDateISO || "").trim();
  const dryRun = !!opts?.dryRun;
  const maxDays = Math.max(1, Number(opts?.maxDays ?? 120));

  const dates = listISODateRangeInclusive(fromDateISO, toDateISO, maxDays);

  let totalSlotDocs = 0;
  let totalEmployeeDocs = 0;

  for (const dateISO of dates) {
    const slotsCol = collection(db, "salons", salonId, "booking_slots");
    const snap = await getDocs(query(slotsCol, where("date", "==", dateISO)));
    totalSlotDocs += snap.size;

    const timesByEmployeeId = new Map<string, { employeeKey: string; times: Set<string> }>();

    snap.docs.forEach((d) => {
      const sd: any = d.data() || {};
      const employeeId = String(sd.employeeId ?? "").trim();
      const employeeKey = String(sd.employeeKey ?? "").trim() || employeeId;
      const time = String(sd.time || "").trim();
      if (!employeeId || !time) return;

      const entry = timesByEmployeeId.get(employeeId) || {
        employeeKey,
        times: new Set<string>(),
      };
      entry.times.add(time);
      if (!entry.employeeKey) entry.employeeKey = employeeKey;
      timesByEmployeeId.set(employeeId, entry);
    });

    if (!timesByEmployeeId.size) continue;

    totalEmployeeDocs += timesByEmployeeId.size;
    if (dryRun) continue;

    // Batch writes (safety: 500 ops per batch).
    let batch = writeBatch(db);
    let ops = 0;

    const commitIfNeeded = async () => {
      if (ops <= 0) return;
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    };

    for (const [employeeId, entry] of timesByEmployeeId.entries()) {
      const bookedSlots: Record<string, true> = {};
      entry.times.forEach((t) => {
        const k = String(t || "").trim();
        if (k) bookedSlots[k] = true;
      });

      const ref = doc(db, "salons", salonId, "availability_days", dateISO, "employees", employeeId);
      batch.set(ref, {
        date: dateISO,
        employeeId,
        employeeKey: entry.employeeKey || employeeId,
        bookedSlots,
        complete: true,
        updatedAt: serverTimestamp(),
      } as any);
      ops++;

      if (ops >= 450) {
        await commitIfNeeded();
      }
    }

    await commitIfNeeded();
  }

  return {
    salonId,
    fromDateISO,
    toDateISO,
    days: dates.length,
    totalSlotDocs,
    totalEmployeeDocs,
    dryRun,
  };
}

