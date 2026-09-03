// src/services/AppSettingsService.ts
import { isSeasonEnabledForDate, pickEffectivePrice } from "../helpers/seasonPricing";
import { CoreSettingsService } from "./CoreSettingsService";


export type SectionKey =
  | "overview"
  | "bookings"
  | "clients"
  | "employees"
  | "offers"
  | "reports"
  | "income"
  | "expenses"
  | "logs"
  | "settings";


/* =========================
   ✅ NEW: Booking / Services settings types
========================= */
export type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";

export type BusinessHoursDay = {
  enabled: boolean;
  start: string; // "09:00"
  end: string; // "22:00"
};

export type Holiday = {
  date: string; // "2026-01-12"
  reason?: string;
};

export type Closure = {
  from: string; // ISO date-time
  to: string; // ISO date-time
  message?: string;
};

export type BookingHourOverride = {
  id?: string;
  fromDate: string; // YYYY-MM-DD
  toDate: string; // YYYY-MM-DD
  mode: "hours" | "closed";
  start?: string; // HH:MM when mode=hours
  end?: string; // HH:MM when mode=hours
  includeWeekdays?: WeekdayKey[]; // optional: apply only on these weekdays
  blockedWeekdays?: WeekdayKey[]; // optional: close these weekdays inside range
  reason?: string; // internal note
};

export type ServiceItem = {
  id: string;
  name: string;
  durationMin: number;
  price: number;
  active: boolean;
};

// ✅ NEW: Season pricing settings
export type CatalogSeasonPricing = {
  enabled: boolean;
  from: string; // "YYYY-MM-DD"
  to: string;   // "YYYY-MM-DD"

  // ✅ Newer keys (Booking.tsx reads these first). Optional for backward compatibility.
  startDate?: string; // "YYYY-MM-DD"
  endDate?: string;   // "YYYY-MM-DD"
};

export type AttendanceSettings = {
  enabled: boolean;
  requireBiometric: boolean;
  requireWorkZone: boolean;
  maxLocationAccuracyMeters: number;
};


export type AppSettings = {
  salonName: string;
  phone: string;
  city: string;

  sections: Record<SectionKey, boolean>;

  policies: {
    allowStaffChangeStatus: boolean;
    allowReceptionChangeStatus: boolean;
    allowStaffViewClients: boolean;
    allowAdminManageUsers: boolean;
  };

  // ✅ NEW: Booking settings (flexible)
  booking?: {
    slotStepMin: number; // default 30
    bufferMin: number; // default 0
    maniPediToolsFee: number; // default 15
    maintenanceMode?: boolean;
    maintenanceMessage?: string;
    businessHours: Record<WeekdayKey, BusinessHoursDay>;
    bookingHourOverrides?: BookingHourOverride[];
    holidays: Holiday[];
    closures: Closure[];
    publicClosedMessage: string;
    sequentialBooking?: boolean;
  };

  // ✅ NEW: Services catalog (duration + price)
  services?: {
    catalog: ServiceItem[];
  };

  // ✅ NEW
  catalogSeasonPricing?: CatalogSeasonPricing;
  attendance?: AttendanceSettings;

  updatedAt?: string;
};

/**
 * ✅ IMPORTANT:
 * قبل كان يكتب في settings/app (جذر) وهذا ما تسمح به Rules عندك.
 * الآن نكتب في المسار الصحيح: salons/main/settings/app
 */
const SALON_ID = "main";

// ✅ خله نفس اللي تستخدمه صفحات الداشبورد عندك (SettingsBookings)
const LS_KEY = "qs_app_settings_cache_v1";

// ✅ المسار الصحيح المتوافق مع rules: match /salons/{salonId}/settings/{id}
const DOC_PATH = {
  col: ["salons", SALON_ID, "settings"] as const,
  id: "app",
};

function defaultBusinessHours(): Record<WeekdayKey, BusinessHoursDay> {
  return {
    sat: { enabled: true, start: "12:00", end: "22:00" },
    sun: { enabled: true, start: "12:00", end: "22:00" },
    mon: { enabled: true, start: "12:00", end: "22:00" },
    tue: { enabled: true, start: "12:00", end: "22:00" },
    wed: { enabled: true, start: "12:00", end: "22:00" },
    thu: { enabled: true, start: "12:00", end: "22:00" },
    fri: { enabled: false, start: "12:00", end: "22:00" },
  };
}

const defaultSettings: AppSettings = {
  salonName: "MALIKAT SALON",
  phone: "",
  city: "",

  sections: {
    overview: true,
    bookings: true,
    clients: true,
    employees: true,
    offers: true,
    reports: true,
    income: true,
    expenses: true,
    logs: true,
    settings: true,
  },

  policies: {
    allowStaffChangeStatus: false,
    allowReceptionChangeStatus: true,
    allowStaffViewClients: false,
    allowAdminManageUsers: false,
  },

  // ✅ NEW defaults
  booking: {
    slotStepMin: 5,
    bufferMin: 0,
    maniPediToolsFee: 15,
    maintenanceMode: false,
    maintenanceMessage: "",
    businessHours: defaultBusinessHours(),
    bookingHourOverrides: [],
    holidays: [],
    closures: [],
    publicClosedMessage: "",
    sequentialBooking: false,
  },

  services: {
    catalog: [],
  },

  catalogSeasonPricing: {
    enabled: false,
    from: "",
    to: "",
    startDate: "",
    endDate: "",
  },

  attendance: {
    enabled: true,
    requireBiometric: true,
    requireWorkZone: true,
    maxLocationAccuracyMeters: 120,
  },

  updatedAt: new Date().toISOString(),
};

function safeBool(v: any, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}

function safeNumber(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(v: any, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function safeDayHours(v: any, fallback: BusinessHoursDay): BusinessHoursDay {
  const x = v || {};
  return {
    enabled: safeBool(x.enabled, fallback.enabled),
    start: safeString(x.start, fallback.start),
    end: safeString(x.end, fallback.end),
  };
}

function sanitizeHolidays(v: any): Holiday[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => {
      const date = safeString(x?.date, "");
      if (!date) return null;
      const reason = typeof x?.reason === "string" ? x.reason : "";
      return reason ? { date, reason } : { date };
    })
    .filter(Boolean) as Holiday[];
}

function sanitizeClosures(v: any): Closure[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => {
      const from = safeString(x?.from, "");
      const to = safeString(x?.to, "");
      if (!from || !to) return null;
      const message = typeof x?.message === "string" ? x.message : "";
      return message ? { from, to, message } : { from, to };
    })
    .filter(Boolean) as Closure[];
}

function sanitizeServicesCatalog(v: any): ServiceItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any) => {
      const id = safeString(x?.id, "");
      const name = safeString(x?.name, "");
      if (!id || !name) return null;

      const durationMin = Math.max(5, safeNumber(x?.durationMin, 60));
      const price = Math.max(0, safeNumber(x?.price, 0));
      const active = safeBool(x?.active, true);

      return { id, name, durationMin, price, active };
    })
    .filter(Boolean) as ServiceItem[];
}

function normalizeWeekdayList(v: any): WeekdayKey[] {
  if (!Array.isArray(v)) return [];
  const valid = new Set<WeekdayKey>([
    "sat",
    "sun",
    "mon",
    "tue",
    "wed",
    "thu",
    "fri",
  ]);
  const out: WeekdayKey[] = [];
  for (const x of v) {
    const d = String(x || "").trim().toLowerCase() as WeekdayKey;
    if (valid.has(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

function sanitizeBookingHourOverrides(v: any): BookingHourOverride[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x: any, idx: number) => {
      const fromDate = safeString(x?.fromDate, "");
      const toDate = safeString(x?.toDate, "");
      if (!fromDate || !toDate) return null;
      const modeRaw = safeString(x?.mode, "hours").toLowerCase();
      const mode: "hours" | "closed" = modeRaw === "closed" ? "closed" : "hours";
      const includeWeekdays = normalizeWeekdayList(x?.includeWeekdays);
      const blockedWeekdays = normalizeWeekdayList(x?.blockedWeekdays);
      const reason = safeString(x?.reason, "").trim();
      const id = safeString(x?.id, `ovr_${idx}_${fromDate}_${toDate}`);

      if (mode === "closed") {
        const out: BookingHourOverride = { id, fromDate, toDate, mode };
        if (includeWeekdays.length) out.includeWeekdays = includeWeekdays;
        if (blockedWeekdays.length) out.blockedWeekdays = blockedWeekdays;
        if (reason) out.reason = reason;
        return out;
      }

      const start = safeString(x?.start, "10:00");
      const end = safeString(x?.end, "22:00");
      const out: BookingHourOverride = { id, fromDate, toDate, mode, start, end };
      if (includeWeekdays.length) out.includeWeekdays = includeWeekdays;
      if (blockedWeekdays.length) out.blockedWeekdays = blockedWeekdays;
      if (reason) out.reason = reason;
      return out;
    })
    .filter(Boolean) as BookingHourOverride[];
}

function sanitize(input: any): AppSettings {
  const s = input || {};
  const sectionsRaw = s.sections || {};
  const policiesRaw = s.policies || {};

  // ✅ NEW sanitize booking/services (backward compatible)
  const bookingRaw = s.booking || {};
  const servicesRaw = s.services || {};

  const bhFallback = defaultSettings.booking!.businessHours;

  const businessHours: Record<WeekdayKey, BusinessHoursDay> = {
    sat: safeDayHours(bookingRaw.businessHours?.sat, bhFallback.sat),
    sun: safeDayHours(bookingRaw.businessHours?.sun, bhFallback.sun),
    mon: safeDayHours(bookingRaw.businessHours?.mon, bhFallback.mon),
    tue: safeDayHours(bookingRaw.businessHours?.tue, bhFallback.tue),
    wed: safeDayHours(bookingRaw.businessHours?.wed, bhFallback.wed),
    thu: safeDayHours(bookingRaw.businessHours?.thu, bhFallback.thu),
    fri: safeDayHours(bookingRaw.businessHours?.fri, bhFallback.fri),
  };

  const slotStepMin = Math.max(
    5,
    safeNumber(bookingRaw.slotStepMin, defaultSettings.booking!.slotStepMin)
  );
  const bufferMin = Math.max(
    0,
    safeNumber(bookingRaw.bufferMin, defaultSettings.booking!.bufferMin)
  );
  const maniPediToolsFee = Math.max(
    0,
    safeNumber(
      bookingRaw.maniPediToolsFee,
      defaultSettings.booking!.maniPediToolsFee
    )
  );

  return {
    ...defaultSettings,

    salonName:
      typeof s.salonName === "string" ? s.salonName : defaultSettings.salonName,
    phone: typeof s.phone === "string" ? s.phone : defaultSettings.phone,
    city: typeof s.city === "string" ? s.city : defaultSettings.city,

    sections: {
      overview: safeBool(sectionsRaw.overview, defaultSettings.sections.overview),
      bookings: safeBool(sectionsRaw.bookings, defaultSettings.sections.bookings),
      clients: safeBool(sectionsRaw.clients, defaultSettings.sections.clients),
      employees: safeBool(sectionsRaw.employees, defaultSettings.sections.employees),
      offers: safeBool(sectionsRaw.offers, defaultSettings.sections.offers),
      reports: safeBool(sectionsRaw.reports, defaultSettings.sections.reports),
      income: safeBool(sectionsRaw.income, defaultSettings.sections.income),
      expenses: safeBool(sectionsRaw.expenses, defaultSettings.sections.expenses),

      logs: safeBool((sectionsRaw as any).logs, defaultSettings.sections.logs),
      settings: safeBool((sectionsRaw as any).settings, defaultSettings.sections.settings),
    },


    policies: {
      allowStaffChangeStatus: safeBool(
        policiesRaw.allowStaffChangeStatus,
        defaultSettings.policies.allowStaffChangeStatus
      ),
      allowReceptionChangeStatus: safeBool(
        policiesRaw.allowReceptionChangeStatus,
        defaultSettings.policies.allowReceptionChangeStatus
      ),
      allowStaffViewClients: safeBool(
        policiesRaw.allowStaffViewClients,
        defaultSettings.policies.allowStaffViewClients
      ),
      allowAdminManageUsers: safeBool(
        policiesRaw.allowAdminManageUsers,
        defaultSettings.policies.allowAdminManageUsers
      ),
    },

    // ✅ NEW
    booking: {
      slotStepMin,
      bufferMin,
      maniPediToolsFee,
      maintenanceMode: safeBool(
        bookingRaw.maintenanceMode,
        defaultSettings.booking!.maintenanceMode || false
      ),
      maintenanceMessage: safeString(
        bookingRaw.maintenanceMessage,
        defaultSettings.booking!.maintenanceMessage || ""
      ),
      businessHours,
      bookingHourOverrides: sanitizeBookingHourOverrides(bookingRaw.bookingHourOverrides),
      holidays: sanitizeHolidays(bookingRaw.holidays),
      closures: sanitizeClosures(bookingRaw.closures),
      publicClosedMessage: safeString(
        bookingRaw.publicClosedMessage,
        defaultSettings.booking!.publicClosedMessage
      ),
      sequentialBooking: safeBool(
        bookingRaw.sequentialBooking,
        defaultSettings.booking!.sequentialBooking || false
      ),
    },

    services: {
      catalog: sanitizeServicesCatalog(servicesRaw.catalog),
    },


    // ✅ Season pricing (needed by Booking.tsx)
    catalogSeasonPricing: {
      enabled: safeBool((s as any)?.catalogSeasonPricing?.enabled, false),
      from: safeString((s as any)?.catalogSeasonPricing?.from, ""),
      to: safeString((s as any)?.catalogSeasonPricing?.to, ""),

      // Booking.tsx prefers startDate/endDate, so ensure they exist:
      startDate: safeString(
        (s as any)?.catalogSeasonPricing?.startDate,
        safeString((s as any)?.catalogSeasonPricing?.from, "")
      ),
      endDate: safeString(
        (s as any)?.catalogSeasonPricing?.endDate,
        safeString((s as any)?.catalogSeasonPricing?.to, "")
      ),
    },

    attendance: {
      enabled: safeBool((s as any)?.attendance?.enabled, defaultSettings.attendance!.enabled),
      requireBiometric: safeBool(
        (s as any)?.attendance?.requireBiometric,
        defaultSettings.attendance!.requireBiometric
      ),
      requireWorkZone: safeBool(
        (s as any)?.attendance?.requireWorkZone,
        defaultSettings.attendance!.requireWorkZone
      ),
      maxLocationAccuracyMeters: Math.max(
        10,
        safeNumber(
          (s as any)?.attendance?.maxLocationAccuracyMeters,
          defaultSettings.attendance!.maxLocationAccuracyMeters
        )
      ),
    },

    updatedAt:
      typeof s.updatedAt === "string" ? s.updatedAt : defaultSettings.updatedAt,
  };
}

function cacheWrite(settings: AppSettings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch { }
}

function cacheRead(): AppSettings | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

type SettingsSubscriber = (settings: AppSettings) => void;

const SETTINGS_REVALIDATE_AFTER_MS = 30_000;
const SETTINGS_ACTIVE_EVENT_DEDUPE_MS = 1_000;
const settingsSubscribers = new Set<SettingsSubscriber>();
let settingsSnapshot: AppSettings | null = null;
let settingsRefreshInFlight: Promise<AppSettings> | null = null;
let settingsListenersInstalled = false;
let lastSettingsRefreshAt = 0;
let lastSettingsActiveRefreshRequestAt = 0;

function publishSettings(settings: AppSettings) {
  settingsSnapshot = settings;
  for (const subscriber of settingsSubscribers) {
    subscriber(settings);
  }
}

function reportSettingsSubscriptionError(error: unknown) {
  console.error("Core D1 settings subscription failed closed:", error);
  globalThis.setTimeout(() => {
    throw error;
  }, 0);
}

async function readRemoteSettingsShared(): Promise<AppSettings> {
  if (settingsRefreshInFlight) return settingsRefreshInFlight;

  settingsRefreshInFlight = (async () => {
    const setting = await CoreSettingsService.get<AppSettings>(DOC_PATH.id);
    if (!setting) {
      throw new Error("SETTINGS_D1_NOT_FOUND: salons/main/settings/app is missing from Core D1.");
    }
    const remote = sanitize(setting.value);
    cacheWrite(remote);
    settingsSnapshot = remote;
    lastSettingsRefreshAt = Date.now();
    return remote;
  })().finally(() => {
    settingsRefreshInFlight = null;
  });

  return settingsRefreshInFlight;
}

function refreshSettingsSubscribers(force = false) {
  if (!settingsSubscribers.size) return;
  if (!force && settingsSnapshot && Date.now() - lastSettingsRefreshAt < SETTINGS_REVALIDATE_AFTER_MS) {
    return;
  }

  void readRemoteSettingsShared()
    .then((remote) => publishSettings(remote))
    .catch(reportSettingsSubscriptionError);
}

function refreshSettingsWhenActive() {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const now = Date.now();
  if (now - lastSettingsActiveRefreshRequestAt < SETTINGS_ACTIVE_EVENT_DEDUPE_MS) return;
  lastSettingsActiveRefreshRequestAt = now;
  refreshSettingsSubscribers(true);
}

function installSettingsRefreshListeners() {
  if (settingsListenersInstalled || typeof window === "undefined" || typeof document === "undefined") return;
  settingsListenersInstalled = true;
  window.addEventListener("focus", refreshSettingsWhenActive);
  window.addEventListener("online", refreshSettingsWhenActive);
  document.addEventListener("visibilitychange", refreshSettingsWhenActive);
}

function removeSettingsRefreshListenersIfIdle() {
  if (!settingsListenersInstalled || settingsSubscribers.size || typeof window === "undefined" || typeof document === "undefined") return;
  settingsListenersInstalled = false;
  window.removeEventListener("focus", refreshSettingsWhenActive);
  window.removeEventListener("online", refreshSettingsWhenActive);
  document.removeEventListener("visibilitychange", refreshSettingsWhenActive);
}

/** ✅ إنشاء salons/main/settings/app مرة واحدة لو غير موجود */


export const AppSettingsService = {
  getDefaults(): AppSettings {
    return defaultSettings;
  },

  // First render only. This is not an operational fallback: every remote read
  // still goes to Core and Core errors are surfaced.
  getCached(): AppSettings {
    return cacheRead() || defaultSettings;
  },

  async fetchRemote(): Promise<AppSettings> {
    return readRemoteSettingsShared();
  },

  subscribe(cb: SettingsSubscriber) {
    settingsSubscribers.add(cb);
    installSettingsRefreshListeners();

    if (settingsSnapshot) {
      cb(settingsSnapshot);
      refreshSettingsSubscribers(false);
    } else {
      refreshSettingsSubscribers(true);
    }

    return () => {
      settingsSubscribers.delete(cb);
      removeSettingsRefreshListenersIfIdle();
    };
  },

  async saveRemote(settings: AppSettings) {
    const payload: AppSettings = sanitize({
      ...settings,
      updatedAt: new Date().toISOString(),
    });
    await CoreSettingsService.save(DOC_PATH.id, payload, "public");
    cacheWrite(payload);
    settingsSnapshot = payload;
    lastSettingsRefreshAt = Date.now();
    publishSettings(payload);
    return payload;
  },
};

// =========================
// ✅ Season Pricing helpers (LOCAL DATE)
// =========================

export function isSeasonActiveForDateLocal(sp: any, bookingDateISO: string) {
  return isSeasonEnabledForDate({ catalogSeasonPricing: sp || {} }, bookingDateISO).ok;
}


export function getEffectiveServicePrice(
  service: { price?: any; seasonPrice?: any },
  settings: any,
  bookingDateISO: string
) {
  return pickEffectivePrice({
    basePrice: Math.max(0, Number(service?.price ?? 0) || 0),
    seasonPrice:
      service?.seasonPrice === null || service?.seasonPrice === undefined || String(service?.seasonPrice) === ""
        ? undefined
        : Math.max(0, Number(service?.seasonPrice ?? 0) || 0),
    appSettings: settings,
    dateISO: bookingDateISO,
  }).price;
}