// ✅ src/types/finance.ts

export type PaymentMethod = "cash" | "card" | "transfer" | "other";

/** مصروف */
export type Expense = {
  id: string;

  /** اسم المصروف */
  title: string;

  /** التصنيف */
  category: string;

  /** المبلغ */
  amount: number;

  /** YYYY-MM-DD */
  date: string;

  /** طريقة الدفع */
  paymentMethod: PaymentMethod;

  /** ملاحظات */
  note?: string;

  /** millis */
  createdAt: number;

  /** optional extras */
  bookingId?: string;
};

/** إيراد */
export type IncomeItem = {
  id: string;

  /** YYYY-MM-DD */
  date: string;

  amount: number;

  /** طريقة الدفع */
  method: PaymentMethod;

  /** مصدر الدخل */
  source: string;

  note?: string;

  bookingId?: string;

  /** millis */
  createdAt: number;
};

// ===== Settings Types (Salon UI) =====

/** طرق الدفع في الإعدادات (واجهة المستخدم) */
export type UiPaymentMethod = "كاش" | "شبكة" | "تحويل";

/** حالات الحجز التي تُحسب كدخل */
export type BookingIncomeStatus = "confirmed" | "completed";

/** إعدادات المالية */
export type FinanceSettings = {
  expenseCategories: string[];
  paymentMethods: UiPaymentMethod[];
  currency: string;
  incomeBookingStatuses: BookingIncomeStatus[];
};

