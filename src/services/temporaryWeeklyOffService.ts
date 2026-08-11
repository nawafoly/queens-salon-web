import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { db } from "./firebase";
import { CoreHrService } from "./CoreHrService";

export const TEMP_WEEKLY_OFF_PREFIX = "[TEMP_WEEKLY_OFF:";

export type TemporaryWeeklyOffOverride = {
  date: string;
  enabled?: boolean;
  start?: string;
  end?: string;
  note?: string;
};

type SaveTemporaryWeeklyOffInput = {
  employeeId: string;
  token: string;
  affectedDates: string[];
  offDates: string[];
  workDates: string[];
  workStart: string;
  workEnd: string;
  nextOverrides: TemporaryWeeklyOffOverride[];
};

type RemoveTemporaryWeeklyOffInput = {
  employeeId: string;
  token: string;
  nextOverrides: TemporaryWeeklyOffOverride[];
};

const SALON_ID = "main";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function isDateKey(value: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function rangesOverlapDate(row: Record<string, unknown>, dates: Set<string>) {
  const from = cleanText(row.dateFrom || row.date_from);
  const to = cleanText(row.dateTo || row.date_to || from);
  if (!isDateKey(from) || !isDateKey(to)) return false;
  for (const date of dates) {
    if (date >= from && date <= to) return true;
  }
  return false;
}

function isApprovedException(row: Record<string, unknown>) {
  return cleanText(row.status).toLowerCase() === "approved";
}

function isTemporaryWeeklyOffException(row: Record<string, unknown>) {
  return cleanText(row.note).startsWith(TEMP_WEEKLY_OFF_PREFIX);
}

async function saveProfileOverrides(employeeId: string, overrides: TemporaryWeeklyOffOverride[]) {
  await setDoc(
    doc(db, "salons", SALON_ID, "staff_public", employeeId),
    {
      customWorkingHourOverrides: overrides,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function cancelCoreExceptions(rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const id = cleanText(row.id);
    if (!id) continue;
    await CoreHrService.updateScheduleException(id, {
      status: "cancelled",
      enabled: false,
      note: `${cleanText(row.note)} [CANCELLED_TEMP_WEEKLY_OFF]`.trim(),
    });
  }
}

export function dashboardEmployeeIdFromPath(pathname = window.location.pathname) {
  const match = String(pathname || "").match(/\/dashboard\/employees\/([^/?#]+)/i);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

export async function saveTemporaryWeeklyOff(input: SaveTemporaryWeeklyOffInput) {
  const employeeId = cleanText(input.employeeId);
  if (!employeeId) throw new Error("تعذر تحديد الموظفة لحفظ تغيير الإجازة الأسبوعية.");

  const affectedDates = new Set(input.affectedDates.filter(isDateKey));
  if (!affectedDates.size) throw new Error("لا توجد أيام مطابقة داخل الفترة المختارة.");

  const existing = (await CoreHrService.listScheduleExceptions({ employeeId })) as Array<Record<string, unknown>>;
  const conflicts = existing.filter((row) =>
    isApprovedException(row) &&
    rangesOverlapDate(row, affectedDates) &&
    !isTemporaryWeeklyOffException(row)
  );
  if (conflicts.length) {
    throw new Error(`يوجد ${conflicts.length} استثناء شفت آخر في Core على أحد الأيام المتأثرة. راجعه أولاً حتى لا يتم استبداله.`);
  }

  const previousTemporary = existing.filter((row) =>
    isApprovedException(row) &&
    isTemporaryWeeklyOffException(row) &&
    rangesOverlapDate(row, affectedDates)
  );

  const createdIds: string[] = [];
  try {
    for (const date of input.offDates) {
      const saved = await CoreHrService.createScheduleException({
        employeeId,
        dateFrom: date,
        dateTo: date,
        exceptionType: "off",
        // In Core, `enabled` means the exception row itself is active. The
        // `exceptionType=off` value is what makes the workday closed.
        enabled: true,
        startTime: null,
        endTime: null,
        note: `${input.token} TEMP_OFF`,
        status: "approved",
      });
      if (saved?.id) createdIds.push(saved.id);
    }

    for (const date of input.workDates) {
      const saved = await CoreHrService.createScheduleException({
        employeeId,
        dateFrom: date,
        dateTo: date,
        exceptionType: "custom",
        enabled: true,
        startTime: input.workStart,
        endTime: input.workEnd,
        note: `${input.token} TEMP_WORK`,
        status: "approved",
      });
      if (saved?.id) createdIds.push(saved.id);
    }
  } catch (error) {
    // Best effort rollback for rows created by this attempt. Existing rows are
    // not cancelled until all replacements are successfully created.
    for (const id of createdIds) {
      await CoreHrService.updateScheduleException(id, {
        status: "cancelled",
        enabled: false,
        note: `${input.token} ROLLBACK_TEMP_WEEKLY_OFF`,
      }).catch(() => undefined);
    }
    throw error;
  }

  await cancelCoreExceptions(previousTemporary);

  try {
    await saveProfileOverrides(employeeId, input.nextOverrides);
  } catch (error) {
    // Core remains the operational source of truth. Surface the compatibility
    // mirror failure instead of hiding it so the admin can retry the save.
    throw new Error(`تم حفظ التغيير في Core لكن تعذرت مزامنة ملف الموظفة: ${cleanText((error as Error)?.message) || "خطأ غير معروف"}`);
  }

  return {
    employeeId,
    createdCoreExceptions: createdIds.length,
    cancelledCoreExceptions: previousTemporary.length,
  };
}

export async function removeTemporaryWeeklyOff(input: RemoveTemporaryWeeklyOffInput) {
  const employeeId = cleanText(input.employeeId);
  if (!employeeId) throw new Error("تعذر تحديد الموظفة لإزالة تغيير الإجازة الأسبوعية.");

  const existing = (await CoreHrService.listScheduleExceptions({ employeeId })) as Array<Record<string, unknown>>;
  const matching = existing.filter((row) =>
    isApprovedException(row) && cleanText(row.note).startsWith(input.token)
  );

  await cancelCoreExceptions(matching);
  await saveProfileOverrides(employeeId, input.nextOverrides);

  return {
    employeeId,
    cancelledCoreExceptions: matching.length,
  };
}
