export function financePaymentMethodLabel(raw: unknown): string {
  const value = String(raw || "").trim().toLowerCase();

  if (!value) return "غير محدد";
  if (value === "cash" || value === "كاش" || value.includes("نقد")) return "كاش";

  if (
    value === "card" ||
    value === "mada" ||
    value === "pos_card" ||
    value === "mada_online" ||
    value.includes("شبك") ||
    value.includes("مدى") ||
    value.includes("بطاق")
  ) {
    return "شبكة";
  }

  if (value === "transfer" || value.includes("تحويل")) return "تحويل";
  if (value === "mixed" || value.includes("مختلط")) return "مختلط";
  if (value === "other" || value.includes("أخرى") || value.includes("اخرى")) return "أخرى";

  return String(raw || "").trim();
}

export function financeSourceLabel(raw: unknown): string {
  const value = String(raw || "").trim().toLowerCase();

  if (value === "booking" || value === "حجز") return "حجز";
  if (value === "invoice" || value === "فاتورة") return "فاتورة";
  if (value === "internal_booking") return "حجز داخلي";
  if (value === "package_purchase") return "شراء باقة";
  if (value === "manual" || value === "يدوي") return "عملية يدوية";
  if (value === "refund" || value === "استرجاع") return "استرجاع";
  if (value === "income" || value === "revenue") return "إيراد";
  if (
    value === "other" ||
    value === "other income" ||
    value === "دخل آخر"
  ) {
    return "دخل آخر";
  }

  return String(raw || "").trim() || "عملية مالية";
}

export function formatFinanceNotePart(raw: unknown): string {
  const part = String(raw || "").trim();
  if (!part) return "";

  const lower = part.toLowerCase();
  const method = part.split(":")[1] || "";

  if (lower.startsWith("booking_edit_payment:")) {
    return `تعديل دفعة حجز — ${financePaymentMethodLabel(method)}`;
  }

  if (lower.startsWith("invoice_from_reception:")) {
    return `فاتورة من الاستقبال — ${financePaymentMethodLabel(method)}`;
  }

  if (lower.startsWith("internal_payment:")) {
    return `دفع حجز داخلي — ${financePaymentMethodLabel(method)}`;
  }

  if (lower.startsWith("payment_method:")) {
    return `طريقة الدفع — ${financePaymentMethodLabel(method)}`;
  }

  if (
    lower === "package_purchase" ||
    lower.startsWith("package_purchase:")
  ) {
    return "شراء باقة";
  }

  return part;
}

export function formatFinanceNote(raw: unknown): string {
  const note = String(raw || "").trim();
  if (!note) return "";

  const parts = note
    .split("|")
    .map((part) => formatFinanceNotePart(part))
    .filter(Boolean);

  return parts.length ? parts.join(" — ") : note;
}

export function formatFinanceTransactionTitle(
  note: unknown,
  source?: unknown,
): string {
  return formatFinanceNote(note) || financeSourceLabel(source);
}

export function isSystemFinanceNote(raw: unknown): boolean {
  const note = String(raw || "").trim().toLowerCase();
  if (!note) return false;

  return (
    note.includes("invoice_from_reception:") ||
    note.includes("internal_payment:") ||
    note.includes("payment_method:") ||
    note.includes("booking_edit_payment:") ||
    note.includes("package_purchase")
  );
}
