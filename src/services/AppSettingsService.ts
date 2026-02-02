// src/services/AppSettingsService.ts
import { db } from "./firebase";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { STRICT_FIREBASE } from "../config/strictFirebase";

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
    businessHours: Record<WeekdayKey, BusinessHoursDay>;
    holidays: Holiday[];
    closures: Closure[];
    publicClosedMessage: string;
  };

  // ✅ NEW: Services catalog (duration + price)
  services?: {
    catalog: ServiceItem[];
  };

  // ✅ NEW
  catalogSeasonPricing?: CatalogSeasonPricing;


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
  salonName: "Queens Salon",
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
    businessHours: defaultBusinessHours(),
    holidays: [],
    closures: [],
    publicClosedMessage: "",
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
      businessHours,
      holidays: sanitizeHolidays(bookingRaw.holidays),
      closures: sanitizeClosures(bookingRaw.closures),
      publicClosedMessage: safeString(
        bookingRaw.publicClosedMessage,
        defaultSettings.booking!.publicClosedMessage
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

    updatedAt:
      typeof s.updatedAt === "string" ? s.updatedAt : defaultSettings.updatedAt,
  };
}

function cacheWrite(settings: AppSettings) {
  if (STRICT_FIREBASE) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch { }
}

function cacheRead(): AppSettings | null {
  if (STRICT_FIREBASE) return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** ✅ إنشاء salons/main/settings/app مرة واحدة لو غير موجود */
async function ensureRemoteExists() {
  const ref = doc(db, ...DOC_PATH.col, DOC_PATH.id);
  const snap = await getDoc(ref);
  if (snap.exists()) return;

  const payload: AppSettings = sanitize({
    ...defaultSettings,
    updatedAt: new Date().toISOString(),
  });

  await setDoc(ref, payload, { merge: true });
  cacheWrite(payload);
}

export const AppSettingsService = {
  /** ✅ مرجع ثابت للديفولت */
  getDefaults(): AppSettings {
    return defaultSettings;
  },

  getCached(): AppSettings {
    if (STRICT_FIREBASE) {
      return defaultSettings; // مؤقت فقط للـ first render
    }
    return cacheRead() || defaultSettings;
  },

  async fetchRemote(): Promise<AppSettings> {
    const ref = doc(db, ...DOC_PATH.col, DOC_PATH.id);

    const snap = await getDoc(ref);
    if (!snap.exists()) {
      if (STRICT_FIREBASE) {
        throw new Error("🔥 salons/main/settings/app does not exist in Firestore");
      }

      await ensureRemoteExists();
      cacheWrite(defaultSettings);
      return defaultSettings;
    }

    const remote = sanitize(snap.data());
    cacheWrite(remote);
    return remote;
  },

  subscribe(cb: (settings: AppSettings) => void) {
    const ref = doc(db, ...DOC_PATH.col, DOC_PATH.id);

    const unsub = onSnapshot(
      ref,
      async (snap) => {
        if (!snap.exists()) {
          // ✅ إذا غير موجود: ننشئه ثم نرجع defaults
          try {
            await ensureRemoteExists();
          } catch (e) {
            console.error("ensureRemoteExists error:", e);
          }

          cb(defaultSettings);
          cacheWrite(defaultSettings);
          return;
        }

        const remote = sanitize(snap.data());
        cacheWrite(remote);
        cb(remote);
      },
      (err) => {
        console.error("🔥 AppSettingsService subscribe error:", err);

        if (STRICT_FIREBASE) {
          throw err; // خل الصفحة تفشل بوضوح
        }

        const cached = cacheRead() || defaultSettings;
        cb(cached);
      }
    );

    return unsub;
  },

  async saveRemote(settings: AppSettings) {
    const ref = doc(db, ...DOC_PATH.col, DOC_PATH.id);

    const payload: AppSettings = sanitize({
      ...settings,
      updatedAt: new Date().toISOString(),
    });

    await setDoc(ref, payload, { merge: true });
    cacheWrite(payload);
    return payload;

  },

};

// =========================
// ✅ Season Pricing helpers (LOCAL DATE)
// =========================

export function isSeasonActiveNowLocal(sp: any) {
  const enabled = !!sp?.enabled;
  const from = String(sp?.from || "").trim();
  const to = String(sp?.to || "").trim();
  if (!enabled || !from || !to) return false;

  const m1 = from.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const m2 = to.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m1 || !m2) return false;

  // ✅ local midnight (Saudi)
  const f = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]), 0, 0, 0, 0);
  const t = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]), 0, 0, 0, 0);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  return today.getTime() >= f.getTime() && today.getTime() <= t.getTime();
}

export function getEffectiveServicePrice(
  service: { price?: any; seasonPrice?: any },
  settings: any
) {
  const base = Math.max(0, Number(service?.price ?? 0) || 0);

  const rawSP = service?.seasonPrice;
  const hasSeason = rawSP !== null && rawSP !== undefined && String(rawSP) !== "";

  const season = Math.max(0, Number(rawSP ?? 0) || 0);

  const cfg = (settings as any)?.catalogSeasonPricing || null;
  const active = isSeasonActiveNowLocal(cfg);

  // ✅ season applies only when active AND seasonPrice exists
  if (active && hasSeason) return season;

  return base;
}

