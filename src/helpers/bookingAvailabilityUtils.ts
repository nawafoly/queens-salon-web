import { formatTime12 } from "./timeDisplay";
import { toMinutes, type TimeSlot } from "./timeSlots";

export type EmployeeKeySource = {
  employeeUid?: string;
  employeeId: string;
};

export type EmployeeLookupKeysArgs = {
  employeeKey?: string;
  employeeIdFallback?: string;
  employeeUidFallback?: string;
  employeeNameFallback?: string;
};

export type EmployeeLookupKeysResult = {
  primaryEmployeeKeyKeys: string[];
  primaryEmployeeIdKeys: string[];
  fallbackEmployeeKeyKeys: string[];
  fallbackEmployeeIdKeys: string[];
  slotKeys: string[];
};

export type GreenStartTimesArgs = {
  allSlots: TimeSlot[];
  slotStepMin: number;
  durationMin: number;
  bufferMin: number;
  takenAll: Set<string>;
};

export type BlockedReasonSummary = {
  from: string;
  to: string;
  reasonKey: string;
  reasonLabel: string;
  reasonDetail?: string;
  count: number;
};

const BLOCKED_TIME_TOKEN_RE = /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م|a\.m\.|p\.m\.)?/g;

function safeKey(v: string) {
  return String(v || "").trim().replaceAll("/", "-").replace(/\s+/g, "_");
}

function normalizeBlockedReasonKey(reason: string) {
  return String(reason || "")
    .trim()
    .replace(BLOCKED_TIME_TOKEN_RE, "<time>")
    .replace(/\s+/g, " ");
}

function parseBlockedReason(reason: string) {
  const raw = String(reason || "").trim();
  if (!raw) {
    return {
      key: "unknown",
      label: "غير متاح",
      detail: "",
    };
  }

  if (raw.includes("لا يكفي")) {
    return {
      key: "end-limit",
      label: "لا يكفي الوقت لإنهاء الخدمة قبل الإغلاق.",
      detail: "",
    };
  }

  if (raw.includes("خارج ساعات عمل الموظفة")) {
    return {
      key: "staff-hours",
      label: "خارج ساعات عمل الموظفة.",
      detail: "",
    };
  }

  if (raw.includes("خدمة أخرى في السلة")) {
    return {
      key: "cart-conflict",
      label: "يتعارض مع خدمة أخرى في السلة.",
      detail: "",
    };
  }

  if (raw.includes("حجز/قفل فعلي")) {
    return {
      key: "booking-conflict",
      label: "يتعارض مع حجز/قفل فعلي.",
      detail: "",
    };
  }

  if (raw.includes("يتعارض عند")) {
    const meta = String(raw.split(":").slice(1).join(":") || "")
      .trim()
      .replace(/\.+$/g, "");
    return {
      key: "booking-conflict",
      label: "يتعارض مع وقت محجوز مسبقًا.",
      detail: meta,
    };
  }

  const cleaned = raw
    .replace(/\s+(?:at|عند)\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م|a\.m\.|p\.m\.)?/g, "")
    .replace(BLOCKED_TIME_TOKEN_RE, "")
    .replace(/\s+([:.,،؛])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return {
    key: normalizeBlockedReasonKey(raw),
    label: cleaned || raw,
    detail: "",
  };
}

export function resolveEmployeeKey(it: EmployeeKeySource) {
  const uid = String(it.employeeUid || "").trim();
  if (uid) return uid;
  return String(it.employeeId || "").trim();
}

export function buildSlotId(
  salonId: string,
  employeeKey: string,
  date: string,
  time: string
) {
  return `${safeKey(salonId)}__${safeKey(date)}__${safeKey(time)}__${safeKey(
    employeeKey
  )}`;
}

export function buildEmployeeLookupKeys(
  args: EmployeeLookupKeysArgs
): EmployeeLookupKeysResult {
  const primaryKey = String(args.employeeKey || "").trim();
  const primaryId = String(args.employeeIdFallback || "").trim();
  const uid = String(args.employeeUidFallback || "").trim();
  const nameKey = safeKey(String(args.employeeNameFallback || "").trim());

  const primaryEmployeeKeyKeys = new Set<string>();
  const primaryEmployeeIdKeys = new Set<string>();
  if (primaryKey) primaryEmployeeKeyKeys.add(primaryKey);
  if (primaryId) primaryEmployeeIdKeys.add(primaryId);
  if (primaryId && primaryId !== primaryKey) primaryEmployeeKeyKeys.add(primaryId);

  const fallbackEmployeeKeyKeys = new Set<string>();
  const fallbackEmployeeIdKeys = new Set<string>();
  if (uid && !primaryEmployeeKeyKeys.has(uid)) fallbackEmployeeKeyKeys.add(uid);
  if (uid && !primaryEmployeeIdKeys.has(uid)) fallbackEmployeeIdKeys.add(uid);
  if (nameKey && !primaryEmployeeKeyKeys.has(nameKey)) fallbackEmployeeKeyKeys.add(nameKey);

  const slotKeys = Array.from(
    new Set<string>([
      ...Array.from(primaryEmployeeKeyKeys),
      ...Array.from(primaryEmployeeIdKeys),
      ...Array.from(fallbackEmployeeKeyKeys),
      ...Array.from(fallbackEmployeeIdKeys),
    ])
  );

  return {
    primaryEmployeeKeyKeys: Array.from(primaryEmployeeKeyKeys),
    primaryEmployeeIdKeys: Array.from(primaryEmployeeIdKeys),
    fallbackEmployeeKeyKeys: Array.from(fallbackEmployeeKeyKeys),
    fallbackEmployeeIdKeys: Array.from(fallbackEmployeeIdKeys),
    slotKeys,
  };
}

export function getTimesToLock(
  allSlots: TimeSlot[],
  slotStepMin: number,
  startTime24: string,
  durationMin: number,
  bufferMin: number
) {
  const step = Math.max(1, Number(slotStepMin || 0));

  const totalMin =
    Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));

  if (totalMin <= 0) return [startTime24];

  const slotsToLock = Math.max(1, Math.ceil(totalMin / step));
  const startIdx = allSlots.findIndex(
    (s) => String(s.value24 || "").trim() === String(startTime24 || "").trim()
  );

  if (startIdx < 0) return [startTime24];

  const locked: string[] = [];
  for (let i = 0; i < slotsToLock; i++) {
    const slot = allSlots[startIdx + i];
    if (!slot) break;
    locked.push(slot.value24);
  }

  return locked.length ? locked : [startTime24];
}

export function getGreenStartTimes(args: GreenStartTimesArgs) {
  const greens = new Set<string>();

  for (const slot of args.allSlots) {
    const start24 = slot.value24;

    const needed = getTimesToLock(
      args.allSlots,
      args.slotStepMin,
      start24,
      args.durationMin,
      args.bufferMin
    );

    let ok = true;
    for (const t of needed) {
      if (args.takenAll.has(t)) {
        ok = false;
        break;
      }
    }

    if (ok) greens.add(start24);
  }

  return greens;
}

export function sortTimesBySlotOrder(times: string[], allSlots: TimeSlot[]) {
  const order = new Map<string, number>();
  allSlots.forEach((s, idx) => {
    const k = String(s.value24 || "").trim();
    if (k && !order.has(k)) order.set(k, idx);
  });
  return [...times].sort(
    (a, b) =>
      (order.get(String(a || "").trim()) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(String(b || "").trim()) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function buildUniformReasonByStarts(starts: string[], reason: string) {
  const out: Record<string, string> = {};
  for (const t of starts) out[t] = reason;
  return out;
}

export function formatBlockedRangeLabel(from: string, to: string) {
  const fromLabel = formatTime12(from, from);
  if (from === to) return `عند ${fromLabel}`;
  return `من ${fromLabel} إلى ${formatTime12(to, to)}`;
}

export function summarizeBlockedReasons(
  entries: [string, string][],
  slotStepMin: number
): BlockedReasonSummary[] {
  const sorted = [...entries].sort((a, b) => {
    const am = toMinutes(a[0]);
    const bm = toMinutes(b[0]);
    const safeA = Number.isFinite(am) ? am : Number.MAX_SAFE_INTEGER;
    const safeB = Number.isFinite(bm) ? bm : Number.MAX_SAFE_INTEGER;
    return safeA - safeB;
  });

  const step = Math.max(1, Number(slotStepMin || 0));
  const out: BlockedReasonSummary[] = [];

  for (const [time24, reason] of sorted) {
    const minute = toMinutes(time24);
    const parsed = parseBlockedReason(reason);
    const reasonKey = parsed.key;
    const reasonLabel = parsed.label;
    const reasonDetail = parsed.detail;
    const prev = out[out.length - 1];

    if (prev) {
      const prevMin = toMinutes(prev.to);
      if (
        prev.reasonKey === reasonKey &&
        Number.isFinite(prevMin) &&
        Number.isFinite(minute) &&
        minute >= prevMin &&
        minute - prevMin <= step
      ) {
        prev.to = time24;
        prev.count += 1;
        if (!prev.reasonDetail && reasonDetail) {
          prev.reasonDetail = reasonDetail;
        } else if (
          prev.reasonDetail &&
          reasonDetail &&
          prev.reasonDetail !== reasonDetail &&
          reasonKey === "booking-conflict"
        ) {
          prev.reasonDetail = "تفاصيل متعددة.";
        }
        continue;
      }
    }

    out.push({
      from: time24,
      to: time24,
      reasonKey,
      reasonLabel,
      reasonDetail,
      count: 1,
    });
  }

  return out;
}
