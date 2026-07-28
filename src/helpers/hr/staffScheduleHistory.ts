export type ScheduleWorkingDay = {
  enabled?: boolean;
  start?: string;
  end?: string;
};

export type StaffScheduleVersion = {
  id: string;
  effectiveFrom: string;
  effectiveTo?: string;
  useCustomWorkingHours: boolean;
  customWorkingHours: Record<string, ScheduleWorkingDay>;
  changeReason?: string;
  createdAt?: string;
  createdByUid?: string;
};

export type StaffScheduleSnapshot = {
  useCustomWorkingHours: boolean;
  customWorkingHours: Record<string, ScheduleWorkingDay>;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export function normalizeScheduleDateKey(value: unknown) {
  const raw = cleanText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function normalizeTime(value: unknown) {
  const raw = cleanText(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeWorkingHours(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const result: Record<string, ScheduleWorkingDay> = {};
  Object.entries(source).forEach(([key, rowValue]) => {
    const row = rowValue && typeof rowValue === "object" ? (rowValue as Record<string, unknown>) : {};
    result[key] = {
      enabled: row.enabled !== false,
      start: normalizeTime(row.start),
      end: normalizeTime(row.end),
    };
  });
  return result;
}

function previousDate(dateKey: string) {
  const normalized = normalizeScheduleDateKey(dateKey);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day - 1, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function nextVersionId(effectiveFrom: string) {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `schedule-${effectiveFrom}-${random}`;
}

export function normalizeStaffScheduleVersions(value: unknown): StaffScheduleVersion[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item): StaffScheduleVersion | null => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const effectiveFrom = normalizeScheduleDateKey(row.effectiveFrom || row.effective_from);
      if (!effectiveFrom) return null;
      const effectiveTo = normalizeScheduleDateKey(row.effectiveTo || row.effective_to);
      return {
        id: cleanText(row.id) || nextVersionId(effectiveFrom),
        effectiveFrom,
        ...(effectiveTo ? { effectiveTo } : {}),
        useCustomWorkingHours: row.useCustomWorkingHours !== false,
        customWorkingHours: normalizeWorkingHours(row.customWorkingHours),
        ...(cleanText(row.changeReason) ? { changeReason: cleanText(row.changeReason) } : {}),
        ...(cleanText(row.createdAt) ? { createdAt: cleanText(row.createdAt) } : {}),
        ...(cleanText(row.createdByUid) ? { createdByUid: cleanText(row.createdByUid) } : {}),
      };
    })
    .filter((row): row is StaffScheduleVersion => Boolean(row))
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
}

export function scheduleSnapshotsEqual(left: StaffScheduleSnapshot, right: StaffScheduleSnapshot) {
  return JSON.stringify({
    useCustomWorkingHours: left.useCustomWorkingHours !== false,
    customWorkingHours: normalizeWorkingHours(left.customWorkingHours),
  }) === JSON.stringify({
    useCustomWorkingHours: right.useCustomWorkingHours !== false,
    customWorkingHours: normalizeWorkingHours(right.customWorkingHours),
  });
}

export function resolveStaffScheduleVersionForDate(
  versionsValue: unknown,
  dateKeyValue: unknown
): StaffScheduleVersion | null {
  const dateKey = normalizeScheduleDateKey(dateKeyValue);
  if (!dateKey) return null;
  const versions = normalizeStaffScheduleVersions(versionsValue);
  const matches = versions.filter((version) => {
    if (dateKey < version.effectiveFrom) return false;
    if (version.effectiveTo && dateKey > version.effectiveTo) return false;
    return true;
  });
  return matches[matches.length - 1] || null;
}

export function appendDateEffectiveScheduleVersion(input: {
  versions?: unknown;
  effectiveFrom: string;
  next: StaffScheduleSnapshot;
  previous?: StaffScheduleSnapshot | null;
  baselineEffectiveFrom?: string;
  changeReason?: string;
  createdByUid?: string;
  nowIso?: string;
}) {
  const effectiveFrom = normalizeScheduleDateKey(input.effectiveFrom);
  if (!effectiveFrom) throw new Error("schedule_effective_from_required");

  const nowIso = cleanText(input.nowIso) || new Date().toISOString();
  const baselineEffectiveFrom = normalizeScheduleDateKey(input.baselineEffectiveFrom) || "1900-01-01";
  let versions = normalizeStaffScheduleVersions(input.versions);

  if (!versions.length && input.previous) {
    versions.push({
      id: nextVersionId(baselineEffectiveFrom),
      effectiveFrom: baselineEffectiveFrom,
      ...(effectiveFrom > baselineEffectiveFrom ? { effectiveTo: previousDate(effectiveFrom) } : {}),
      useCustomWorkingHours: input.previous.useCustomWorkingHours !== false,
      customWorkingHours: normalizeWorkingHours(input.previous.customWorkingHours),
      changeReason: "ترحيل الجدول السابق قبل تفعيل السجل التاريخي",
      createdAt: nowIso,
      ...(cleanText(input.createdByUid) ? { createdByUid: cleanText(input.createdByUid) } : {}),
    });
  }

  versions = versions
    .map((version) => {
      if (version.effectiveFrom >= effectiveFrom) return null;
      if (!version.effectiveTo || version.effectiveTo >= effectiveFrom) {
        return { ...version, effectiveTo: previousDate(effectiveFrom) };
      }
      return version;
    })
    .filter((version): version is StaffScheduleVersion => Boolean(version));

  versions.push({
    id: nextVersionId(effectiveFrom),
    effectiveFrom,
    useCustomWorkingHours: input.next.useCustomWorkingHours !== false,
    customWorkingHours: normalizeWorkingHours(input.next.customWorkingHours),
    ...(cleanText(input.changeReason) ? { changeReason: cleanText(input.changeReason) } : {}),
    createdAt: nowIso,
    ...(cleanText(input.createdByUid) ? { createdByUid: cleanText(input.createdByUid) } : {}),
  });

  return normalizeStaffScheduleVersions(versions);
}
