// src/services/FinanceSettingsService.ts
// CORE D1 ONLY — finance settings must not fall back to Firestore.
import { CoreSettingsService } from "./CoreSettingsService";
import type {
  FinanceSettings,
  UiPaymentMethod,
  BookingIncomeStatus,
} from "../types/finance";

const SETTING_KEY = "finance";

const DEFAULT_CATEGORIES: string[] = [
  "إيجار",
  "رواتب",
  "مشتريات",
  "تسويق",
  "صيانة",
  "فواتير",
  "نثريات",
  "أخرى",
];

const DEFAULT_PAYMENT_METHODS: UiPaymentMethod[] = ["كاش", "شبكة", "تحويل"];

const DEFAULT_SETTINGS: FinanceSettings = {
  expenseCategories: DEFAULT_CATEGORIES,
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  currency: "SAR",
  incomeBookingStatuses: ["completed"],
};

function normalizeStatuses(v: unknown): BookingIncomeStatus[] {
  if (!Array.isArray(v)) return ["completed"];
  const cleaned = v
    .map((x) => String(x).toLowerCase().trim())
    .filter(
      (x) => x === "completed" || x === "confirmed"
    ) as BookingIncomeStatus[];
  return cleaned.length ? cleaned : ["completed"];
}

function sanitize(input: unknown): FinanceSettings {
  const s = (input && typeof input === "object" ? input : {}) as Partial<FinanceSettings>;

  const expenseCategories =
    Array.isArray(s.expenseCategories) && s.expenseCategories.length
      ? s.expenseCategories
      : DEFAULT_SETTINGS.expenseCategories;

  const paymentMethods =
    Array.isArray(s.paymentMethods) && s.paymentMethods.length
      ? s.paymentMethods
      : DEFAULT_SETTINGS.paymentMethods;

  const currency =
    typeof s.currency === "string" && s.currency.trim()
      ? s.currency.trim()
      : DEFAULT_SETTINGS.currency;

  const incomeBookingStatuses = normalizeStatuses(s.incomeBookingStatuses);

  return {
    expenseCategories,
    paymentMethods,
    currency,
    incomeBookingStatuses,
  };
}

type FinanceSettingsSubscriber = (settings: FinanceSettings) => void;

const subscribers = new Set<FinanceSettingsSubscriber>();
let snapshot: FinanceSettings | null = null;
let refreshInFlight: Promise<FinanceSettings> | null = null;

function publish(settings: FinanceSettings) {
  snapshot = settings;
  for (const subscriber of subscribers) subscriber(settings);
}

async function readRemoteShared(): Promise<FinanceSettings> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const setting = await CoreSettingsService.get<FinanceSettings>(SETTING_KEY);
    if (!setting) {
      throw new Error("FINANCE_SETTINGS_D1_NOT_FOUND: salons/main/settings/finance is missing from Core D1.");
    }
    const remote = sanitize(setting.value);
    snapshot = remote;
    return remote;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

export const FinanceSettingsService = {
  async get(): Promise<FinanceSettings> {
    return readRemoteShared();
  },

  subscribe(cb: FinanceSettingsSubscriber) {
    subscribers.add(cb);
    if (snapshot) cb(snapshot);
    void readRemoteShared()
      .then((remote) => publish(remote))
      .catch((error) => console.error("Core D1 finance settings refresh failed closed:", error));

    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void readRemoteShared()
        .then((remote) => publish(remote))
        .catch((error) => console.error("Core D1 finance settings refresh failed closed:", error));
    };

    if (typeof window !== "undefined") {
      window.addEventListener("focus", refresh);
      window.addEventListener("online", refresh);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", refresh);
    }

    return () => {
      subscribers.delete(cb);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", refresh);
        window.removeEventListener("online", refresh);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", refresh);
      }
    };
  },

  async save(next: FinanceSettings) {
    const payload = sanitize(next);
    await CoreSettingsService.save(SETTING_KEY, payload, "private");
    publish(payload);
    return payload;
  },

  async addCategory(name: string) {
    const n = (name || "").trim();
    if (!n) return;

    const current = await this.get();
    if (current.expenseCategories.some((c) => c.trim().toLowerCase() === n.toLowerCase())) return;

    await this.save({
      ...current,
      expenseCategories: [...current.expenseCategories, n],
    });
  },

  async removeCategory(name: string) {
    const current = await this.get();
    await this.save({
      ...current,
      expenseCategories: current.expenseCategories.filter((c) => c !== name),
    });
  },

  async addPaymentMethod(name: string) {
    const n = (name || "").trim() as UiPaymentMethod;
    if (!n) return;

    const current = await this.get();
    if (current.paymentMethods.includes(n)) return;

    await this.save({
      ...current,
      paymentMethods: [...current.paymentMethods, n],
    });
  },

  async removePaymentMethod(name: UiPaymentMethod) {
    const current = await this.get();
    await this.save({
      ...current,
      paymentMethods: current.paymentMethods.filter((p) => p !== name),
    });
  },

  async setCurrency(currency: string) {
    const current = await this.get();
    await this.save({ ...current, currency: currency.trim() || "SAR" });
  },

  async setIncomeBookingStatuses(statuses: BookingIncomeStatus[]) {
    const current = await this.get();
    await this.save({ ...current, incomeBookingStatuses: statuses });
  },
};
