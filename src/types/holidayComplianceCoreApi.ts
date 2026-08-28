export type CoreSaudiPublicHolidayCalendarEntry = Record<string, unknown> & {
  id: string;
  holidayCode: "eid_al_fitr" | "eid_al_adha" | "national_day" | "founding_day" | string;
  holidayDate: string;
  holidayNameAr: string;
  holidayNameEn: string;
  sourceType: string;
  sourceReference?: string | null;
  calendarYear: number;
  verifiedAt?: string | null;
  status: "draft" | "verified" | "superseded" | string;
};

export type CoreSaudiEidHolidayPeriod = {
  holidayCode: "eid_al_fitr" | "eid_al_adha" | string;
  startDate: string;
  dayCount: 4;
  entries: CoreSaudiPublicHolidayCalendarEntry[];
};

export type CorePublicHolidayWorkAssignment = Record<string, unknown> & {
  id: string;
  salonId: string;
  employeeId: string;
  holidayCalendarId: string;
  holidayDate: string;
  holidayCode: string;
  reason: string;
  note?: string | null;
  status: "assigned" | "cancelled" | "completed" | string;
};

export type CorePublicHolidayWorkReconciliation = Record<string, unknown> & {
  employeeId: string;
  holidayDate: string;
  publicHoliday: boolean;
  worked?: boolean;
  holiday?: CoreSaudiPublicHolidayCalendarEntry | null;
  assignment?: CorePublicHolidayWorkAssignment | null;
  attendance?: Record<string, unknown> | null;
  event?: Record<string, unknown> | null;
};

export type CoreWeeklyRestReconciliation = Record<string, unknown> & {
  employeeId: string;
  restDate: string;
  weeklyRest: boolean;
  worked?: boolean;
  attendance?: Record<string, unknown> | null;
  event?: Record<string, unknown> | null;
};
