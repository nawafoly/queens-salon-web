type StaffAvailabilityLike = {
  active?: boolean;
  showOnBooking?: boolean;
  onLeave?: boolean;
  leaveUntil?: string;
  exceptionalLeaveDates?: string[];
  exceptionalLeaveWeekdays?: string[];
};

type StaffAvailabilityOptions = {
  requireActive?: boolean;
  requireShowOnBooking?: boolean;
};

function isISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeISODate(value: string | undefined | null) {
  const s = String(value || "").trim();
  return isISODate(s) ? s : "";
}

function weekdayFromISO(dateISO: string) {
  const s = normalizeISODate(dateISO);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[d.getDay()] || "";
}

function isLeaveActiveForDate(staff: StaffAvailabilityLike, dateISO?: string) {
  const target = normalizeISODate(dateISO) || todayISO();
  const exceptional = Array.isArray(staff?.exceptionalLeaveDates)
    ? staff.exceptionalLeaveDates.map((d) => normalizeISODate(d)).filter(Boolean)
    : [];
  if (exceptional.includes(target)) return true;

  const exceptionalWeekdays = Array.isArray(staff?.exceptionalLeaveWeekdays)
    ? staff.exceptionalLeaveWeekdays.map((d) => String(d || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const targetWeekday = weekdayFromISO(target);
  if (targetWeekday && exceptionalWeekdays.includes(targetWeekday)) return true;

  if (!staff?.onLeave) return false;

  const until = normalizeISODate(staff.leaveUntil);
  if (!until) return true;

  return target <= until;
}

export function isStaffAvailableForDate(
  staff: StaffAvailabilityLike,
  dateISO?: string,
  opts?: StaffAvailabilityOptions
) {
  const requireActive = opts?.requireActive ?? true;
  const requireShowOnBooking = opts?.requireShowOnBooking ?? true;

  if (requireActive && staff?.active === false) return false;
  if (requireShowOnBooking && staff?.showOnBooking === false) return false;

  if (isLeaveActiveForDate(staff, dateISO)) return false;

  return true;
}
