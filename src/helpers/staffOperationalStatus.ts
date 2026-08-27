import {
  todayISO,
} from "./bookingDateUtils";

export type StaffOperationalStatusLike = {
  active?: boolean | number | string | null;
  isActive?: boolean | number | string | null;
  disabled?: boolean | number | string | null;
  showOnBooking?: boolean | number | string | null;
  status?: string | null;
  employmentStatus?: string | null;
  accountStatus?: string | null;
  state?: string | null;
  employmentEndDate?: string;
  employeeProfile?: Record<string, unknown> | null;
  employment?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  appUser?: Record<string, unknown> | null;
  bookingProfile?: Record<string, unknown> | null;
};

const INACTIVE_STATUSES =
  new Set([
    "inactive",
    "disabled",
    "suspended",
    "archived",
    "deleted",
    "terminated",
    "resigned",
    "ended",
    "stopped",
    "blocked",
  ]);

const HIDDEN_BOOKING_STATUSES =
  new Set([
    "hidden",
    "private",
    "not_bookable",
    "not-bookable",
    "booking_disabled",
    "booking-disabled",
  ]);

function normalizeISODate(
  value: unknown
) {
  const text =
    String(value ?? "").trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(
    text
  )
    ? text
    : "";
}

function rowSources(
  staff:
    | StaffOperationalStatusLike
    | null
    | undefined
) {
  const base =
    (staff || {}) as Record<
      string,
      unknown
    >;

  return [
    base,
    base.employeeProfile,
    base.employment,
    base.account,
    base.appUser,
    base.bookingProfile,
  ].filter(
    (
      value
    ): value is Record<
      string,
      unknown
    > =>
      Boolean(
        value &&
        typeof value ===
          "object" &&
        !Array.isArray(value)
      )
  );
}

function readBool(
  value: unknown
): boolean | undefined {
  if (
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    typeof value === "number"
  ) {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  const text =
    String(value ?? "")
      .trim()
      .toLowerCase();

  if (!text) {
    return undefined;
  }

  if (
    [
      "true",
      "1",
      "yes",
      "on",
      "active",
      "enabled",
    ].includes(text)
  ) {
    return true;
  }

  if (
    [
      "false",
      "0",
      "no",
      "off",
      "inactive",
      "disabled",
      "suspended",
      "deleted",
    ].includes(text)
  ) {
    return false;
  }

  return undefined;
}

function hasFalseFlag(
  staff: StaffOperationalStatusLike,
  keys: string[]
) {
  return rowSources(staff).some(
    (source) =>
      keys.some(
        (key) =>
          readBool(
            source[key]
          ) === false
      )
  );
}

function hasTrueFlag(
  staff: StaffOperationalStatusLike,
  keys: string[]
) {
  return rowSources(staff).some(
    (source) =>
      keys.some(
        (key) =>
          readBool(
            source[key]
          ) === true
      )
  );
}

function statusValues(
  staff: StaffOperationalStatusLike
) {
  const keys = [
    "status",
    "employmentStatus",
    "employment_status",
    "hrProfileStatus",
    "hr_profile_status",
    "hrEmploymentStatus",
    "hr_employment_status",
    "accountStatus",
    "account_status",
    "hrAccountStatus",
    "hr_account_status",
    "state",
  ];

  return rowSources(staff)
    .flatMap((source) =>
      keys.map(
        (key) => source[key]
      )
    )
    .map((value) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
}

export function isStaffOperationallyInactive(
  staff:
    | StaffOperationalStatusLike
    | null
    | undefined
) {
  if (!staff) return true;

  if (
    hasFalseFlag(
      staff,
      [
        "active",
        "isActive",
      ]
    )
  ) {
    return true;
  }

  if (
    hasTrueFlag(
      staff,
      [
        "disabled",
        "isDisabled",
        "accountDisabled",
      ]
    )
  ) {
    return true;
  }

  return statusValues(
    staff
  ).some((status) =>
    INACTIVE_STATUSES.has(
      status
    )
  );
}

export function isStaffBookingVisibilityEnabled(
  staff:
    | StaffOperationalStatusLike
    | null
    | undefined
) {
  if (!staff) return false;

  if (
    hasFalseFlag(
      staff,
      [
        "showOnBooking",
        "show_on_booking",
        "bookingEnabled",
        "visibleOnBooking",
      ]
    )
  ) {
    return false;
  }

  return !statusValues(
    staff
  ).some((status) =>
    HIDDEN_BOOKING_STATUSES.has(
      status
    )
  );
}

export function resolveEmploymentEndDate(
  staff:
    | StaffOperationalStatusLike
    | null
    | undefined
) {
  const row =
    (staff || {}) as Record<
      string,
      unknown
    >;

  return (
    normalizeISODate(
      row.employmentEndDate
    ) ||
    normalizeISODate(
      row.lastWorkingDate
    ) ||
    normalizeISODate(
      row.resignationDate
    )
  );
}

export function isStaffEmploymentEndedForDate(
  staff: StaffOperationalStatusLike,
  dateISO?: string
) {
  const target =
    normalizeISODate(
      dateISO
    ) ||
    todayISO();

  const endDate =
    resolveEmploymentEndDate(
      staff
    );

  if (!endDate) {
    return false;
  }

  return target > endDate;
}

export function isStaffOperationallyActiveForDate(
  staff:
    | StaffOperationalStatusLike
    | null
    | undefined,
  dateISO?: string
) {
  if (!staff) return false;

  if (
    isStaffOperationallyInactive(
      staff
    )
  ) {
    return false;
  }

  if (
    isStaffEmploymentEndedForDate(
      staff,
      dateISO
    )
  ) {
    return false;
  }

  return true;
}

export function isStaffBookableForPublicBooking(
  staff:
    | StaffOperationalStatusLike
    | null
    | undefined,
  dateISO?: string
) {
  if (
    !staff ||
    !isStaffOperationallyActiveForDate(
      staff,
      dateISO
    )
  ) {
    return false;
  }

  return isStaffBookingVisibilityEnabled(
    staff
  );
}
