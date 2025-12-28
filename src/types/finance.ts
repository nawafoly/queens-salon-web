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
