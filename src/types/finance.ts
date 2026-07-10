// ✅ src/types/finance.ts

export type PaymentMethod = "cash" | "card" | "transfer" | "other" | "mixed";

export type PaymentBreakdown = {
  cash?: number;
  card?: number;
};

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
  addedBy?: string;
  createdBy?: string;
  createdByName?: string;
  createdByUid?: string;
  createdByEmail?: string;
  sourceKind?: string;
  sourceRefId?: string;
  sourceType?: string;
  staffId?: string;
  staffName?: string;
  monthKey?: string;
  payrollKind?: "salary" | "overtime";
};

/** إيراد */
export type IncomeItem = {
  id: string;

  /** YYYY-MM-DD */
  date: string;

  amount: number;

  /** طريقة الدفع */
  method: PaymentMethod;

  paymentBreakdown?: PaymentBreakdown;

  /** مصدر الدخل */
  source: string;

  note?: string;

  bookingId?: string;

  /** Optional client data (may exist for booking/internal/manual rows) */
  clientName?: string;
  clientPhone?: string;

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
