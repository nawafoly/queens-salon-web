// src/services/FinanceSettingsService.ts
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
// ✅ Local Types (حل مشاكل الـ exports + توافق الدفع العربي)
export type BookingIncomeStatus = "completed" | "confirmed";

export type PaymentMethod =
  | "كاش"
  | "شبكة"
  | "تحويل"
  | "cash"
  | "card"
  | "transfer";

export type FinanceSettings = {
  expenseCategories: string[];
  paymentMethods: PaymentMethod[];
  currency: string; // "SAR"
  incomeBookingStatuses: BookingIncomeStatus[];
};

const SALON_ID = "main";
const DOC_PATH = ["salons", SALON_ID, "settings", "finance"] as const;

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

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = ["كاش", "شبكة", "تحويل"];

const DEFAULT_SETTINGS: FinanceSettings = {
  expenseCategories: DEFAULT_CATEGORIES,
  paymentMethods: DEFAULT_PAYMENT_METHODS,
  currency: "SAR",
  incomeBookingStatuses: ["completed"],
};

function normalizeStatuses(v: any): BookingIncomeStatus[] {
  if (!Array.isArray(v)) return ["completed"];
  const cleaned = v
    .map((x: any) => String(x).toLowerCase().trim())
    .filter(
      (x: string) => x === "completed" || x === "confirmed"
    ) as BookingIncomeStatus[];
  return cleaned.length ? cleaned : ["completed"];
}

function sanitize(input: any): FinanceSettings {
  const s = input || {};

  const expenseCategories =
    Array.isArray(s.expenseCategories) && s.expenseCategories.length
      ? (s.expenseCategories as string[])
      : DEFAULT_SETTINGS.expenseCategories;

  const paymentMethods =
    Array.isArray(s.paymentMethods) && s.paymentMethods.length
      ? (s.paymentMethods as PaymentMethod[])
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

export const FinanceSettingsService = {
  async get(): Promise<FinanceSettings> {
    const ref = doc(db, ...DOC_PATH);
    const snap = await getDoc(ref);

    if (!snap.exists()) return DEFAULT_SETTINGS;

    return sanitize(snap.data());
  },

  subscribe(cb: (settings: FinanceSettings) => void) {
    const ref = doc(db, ...DOC_PATH);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          cb(DEFAULT_SETTINGS);
          return;
        }
        cb(sanitize(snap.data()));
      },
      () => {}
    );

    return unsub;
  },

  async save(next: FinanceSettings) {
    const ref = doc(db, ...DOC_PATH);
    const payload = {
      ...sanitize(next),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, payload, { merge: true });
    return payload;
  },

  // ===== categories =====
  async addCategory(name: string) {
    const n = (name || "").trim();
    if (!n) return;

    const current = await this.get();
    const exists = current.expenseCategories.some(
      (c: string) => c.trim().toLowerCase() === n.toLowerCase()
    );
    if (exists) return;

    await this.save({
      ...current,
      expenseCategories: [...current.expenseCategories, n],
    });
  },

  async removeCategory(name: string) {
    const current = await this.get();
    await this.save({
      ...current,
      expenseCategories: current.expenseCategories.filter(
        (c: string) => c !== name
      ),
    });
  },

  // ===== payment methods =====
  async addPaymentMethod(name: string) {
    const n = (name || "").trim() as PaymentMethod;
    if (!n) return;

    const current = await this.get();
    if (current.paymentMethods.includes(n)) return;

    await this.save({
      ...current,
      paymentMethods: [...current.paymentMethods, n],
    });
  },

  async removePaymentMethod(name: PaymentMethod) {
    const current = await this.get();
    await this.save({
      ...current,
      paymentMethods: current.paymentMethods.filter(
        (p: PaymentMethod) => p !== name
      ),
    });
  },

  // ===== currency =====
  async setCurrency(currency: string) {
    const current = await this.get();
    await this.save({ ...current, currency: currency.trim() || "SAR" });
  },

  // ===== income rule from bookings =====
  async setIncomeBookingStatuses(statuses: BookingIncomeStatus[]) {
    const current = await this.get();
    await this.save({ ...current, incomeBookingStatuses: statuses });
  },
};
