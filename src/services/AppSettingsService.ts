// src/services/AppSettingsService.ts
import { db } from "./firebase";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";

export type SectionKey =
  | "overview"
  | "bookings"
  | "clients"
  | "employees"
  | "offers"
  | "reports"
  | "income"
  | "expenses";

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

  updatedAt?: string;
};

const LS_KEY = "app_settings_cache_v1";
const DOC_PATH = { col: "settings", id: "app" };

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
  },

  policies: {
    allowStaffChangeStatus: false,
    allowReceptionChangeStatus: true,
    allowStaffViewClients: false,
    allowAdminManageUsers: false,
  },

  updatedAt: new Date().toISOString(),
};

function safeBool(v: any, fallback: boolean) {
  return typeof v === "boolean" ? v : fallback;
}

function sanitize(input: any): AppSettings {
  const s = input || {};
  const sectionsRaw = s.sections || {};
  const policiesRaw = s.policies || {};

  return {
    ...defaultSettings,

    salonName: typeof s.salonName === "string" ? s.salonName : defaultSettings.salonName,
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

    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : defaultSettings.updatedAt,
  };
}

function cacheWrite(settings: AppSettings) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch {}
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

/** ✅ إنشاء settings/app مرة واحدة لو غير موجود */
async function ensureRemoteExists() {
  const ref = doc(db, DOC_PATH.col, DOC_PATH.id);
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
    return cacheRead() || defaultSettings;
  },

  async fetchRemote(): Promise<AppSettings> {
    const ref = doc(db, DOC_PATH.col, DOC_PATH.id);

    const snap = await getDoc(ref);
    if (!snap.exists()) {
      // ✅ بدل ما نرجّع ديفولت فقط: ننشئ الوثيقة في Firestore
      await ensureRemoteExists();
      cacheWrite(defaultSettings);
      return defaultSettings;
    }

    const remote = sanitize(snap.data());
    cacheWrite(remote);
    return remote;
  },

  subscribe(cb: (settings: AppSettings) => void) {
    const ref = doc(db, DOC_PATH.col, DOC_PATH.id);

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
        console.error("AppSettingsService subscribe error:", err);
        // fallback على الكاش عشان ما تفضى الصفحة
        const cached = cacheRead() || defaultSettings;
        cb(cached);
      }
    );

    return unsub;
  },

  async saveRemote(settings: AppSettings) {
    const ref = doc(db, DOC_PATH.col, DOC_PATH.id);

    const payload: AppSettings = sanitize({
      ...settings,
      updatedAt: new Date().toISOString(),
    });

    await setDoc(ref, payload, { merge: true });
    cacheWrite(payload);
    return payload;
  },
};
