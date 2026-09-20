import DashboardNumberInputV2 from "../components/dashboard-v2/DashboardNumberInputV2";


// ✅ src/pages/DashboardIncome.tsx
import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faSearch,
  faFilter,
  faFileExcel,
  faFilePdf,
  faTrash,
  faRotate,
  faPen,
  faEye,
} from "@fortawesome/free-solid-svg-icons";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";
import { usePermissions } from "../security/PermissionContext";

import {
  listAllIncomeCore,
  removeIncomeCore,
  upsertIncomeCore,
} from "../services/CoreIncomeService";
import { CoreBookingService } from "../services/CoreBookingService";

import type { IncomeItem, PaymentMethod } from "../types/finance";
import { formatFinanceNote, isSystemFinanceNote } from "../helpers/financeDisplay";
import { incomeText, type DashboardLanguage } from "../helpers/dashboardIncomeLanguage";
import {
  exportIncomeReportExcel,
  exportIncomeReportPdf,
} from "../helpers/reports/exportIncomeReport";
import {
  exportV2ResolveEmployeeName,
  exportV2ResolveFinancialStatus,
} from "../services/exports-v2";
import {
  DashboardDatePickerV2,
  DashboardDrawerV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
  DashboardToastProviderV2,
  useDashboardToastV2,
} from "../components/dashboard-v2";

// ✅ LocalStorage Income (Migration)
const LEGACY_INCOME_KEY = "dashboard_income_v1";
const INCOME_MIGRATED_KEY = "income_migrated_to_firestore_v1";
const INCOME_EDIT_PIN = "598867395";
const OTHER_INCOME_LABEL = "\u062f\u062e\u0644 \u0622\u062e\u0631";

const INCOME_METHOD_OPTIONS = [
  { value: "cash", label: "كاش" },
  { value: "card", label: "شبكة" },
  { value: "transfer", label: "تحويل" },
  { value: "mixed", label: "مختلط" },
  { value: "other", label: "أخرى" },
] as const;

const INCOME_FILTER_METHOD_OPTIONS = [
  { value: "all", label: "كل طرق الدفع" },
  ...INCOME_METHOD_OPTIONS,
] as const;

const BOOKING_PAYMENT_TYPE_OPTIONS = [
  { value: "full", label: "دفع كامل" },
  { value: "partial", label: "عربون" },
] as const;

type BookingPaymentType = "full" | "partial";
type BookingMeta = {
  bookingRef: string;
  clientName: string;
  employeeName: string;
  bookingDate?: string;
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
};
type PaymentSummaryRow = {
  kind: "paid" | "remaining";
  label: string;
  value: number;
};

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function normalizeISODate(value: unknown): string {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function methodLabel(m: PaymentMethod, language: DashboardLanguage = "ar") {
  if (m === "cash") return incomeText(language, "كاش");
  if (m === "card") return incomeText(language, "شبكة");
  if (m === "transfer") return incomeText(language, "تحويل");
  if (m === "mixed") return incomeText(language, "مختلط");
  return incomeText(language, "أخرى");
}

function sourceLabel(source: string, language: DashboardLanguage = "ar") {
  const s = String(source || "").trim().toLowerCase();
  if (!s) return incomeText(language, "غير محدد");
  if (s === "booking" || s === "حجز") return incomeText(language, "حجز");
  if (s === "invoice" || s === "فاتورة") return incomeText(language, "فاتورة");
  if (s === "internal_booking") return incomeText(language, "حجز داخلي");
  if (s === "package_purchase") return incomeText(language, "شراء باقة");
  if (s === "manual" || s === "يدوي") return incomeText(language, "يدوي");
  if (s === "refund" || s === "استرجاع") return incomeText(language, "استرجاع");
  if (
    s === "other" ||
    s === "other income" ||
    s === OTHER_INCOME_LABEL ||
    s === "\u0623\u062e\u0631\u0649" ||
    s === "\u0627\u062e\u0631\u0649"
  )
    return incomeText(language, OTHER_INCOME_LABEL);
  return String(source || "").trim();
}

function sourceKind(source: string): "booking" | "invoice" | "internal" | "manual" | "refund" | "other" {
  const s = String(source || "").trim().toLowerCase();
  if (!s) return "other";
  if (s === "booking" || s === "\u062d\u062c\u0632") return "booking";
  if (s === "invoice" || s === "\u0641\u0627\u062a\u0648\u0631\u0629") return "invoice";
  if (s === "internal_booking") return "internal";
  if (s === "manual" || s === "\u064a\u062f\u0648\u064a") return "other";
  if (s === "refund" || s === "\u0627\u0633\u062a\u0631\u062c\u0627\u0639") return "refund";
  return "other";
}

function toBookingRef(v?: string, language: DashboardLanguage = "ar") {
  const raw = String(v || "").trim().toUpperCase();
  if (!raw) return incomeText(language, "بدون حجز");
  if (/^MK-\d+$/.test(raw)) return raw;
  if (/^\d+$/.test(raw)) return `MK-${raw}`;
  return raw;
}

function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function isBookingLinkedIncomeSource(raw: string): boolean {
  const s = String(raw || "").trim().toLowerCase();
  return (
    s === "booking" ||
    s === "invoice" ||
    s === "internal_booking" ||
    s === "حجز" ||
    s === "فاتورة"
  );
}
function resolveLinkedBookingId(item: IncomeItem): string {
  const kind = sourceKind(item.source || "");
  if (kind === "refund" || Number(item.amount || 0) < 0 || String(item.id || "").startsWith("refund_")) {
    return "";
  }

  const explicit = String(item.bookingId || "").trim();
  if (explicit) {
    return isBookingLinkedIncomeSource(item.source || "") ? explicit : "";
  }

  if (kind === "booking") return String(item.id || "").trim();
  return "";
}

function parseMoneyInput(raw: string): number {
  return Number(String(raw || "").replaceAll(",", "").trim());
}

function isRefundIncomeRow(item: IncomeItem): boolean {
  const source = String(item.source || "").trim().toLowerCase();
  return (
    String(item.id || "").startsWith("refund_") ||
    source === "refund" ||
    source === "\u0627\u0633\u062a\u0631\u062c\u0627\u0639" ||
    Number(item.amount || 0) < 0
  );
}

function paymentTypeLabel(type: BookingPaymentType, language: DashboardLanguage = "ar"): string {
  return type === "partial" ? incomeText(language, "عربون") : incomeText(language, "كامل");
}

function buildPaymentSummaryRows(meta?: BookingMeta, language: DashboardLanguage = "ar"): PaymentSummaryRow[] {
  if (!meta) return [];
  const paid = round2(meta.paidAmount);
  const remaining = round2(meta.remainingAmount);
  const rows: PaymentSummaryRow[] = [];
  if (paid > 0) rows.push({ kind: "paid", label: incomeText(language, "دفعت"), value: paid });
  if (remaining > 0) rows.push({ kind: "remaining", label: incomeText(language, "المتبقي"), value: remaining });
  return rows;
}

function buildPaymentSummary(meta?: BookingMeta, language: DashboardLanguage = "ar"): string {
  if (!meta) return "";
  const rows = buildPaymentSummaryRows(meta, language);
  const typeText = paymentTypeLabel(meta.paymentType, language);
  if (!rows.length) return typeText;
  const rowsText = rows.map((r) => `${r.label} ${round2(r.value)} ${language === "en" ? "SAR" : "ر.س"}`).join(" - ");
  return `${typeText} - ${rowsText}`;
}

function buildBookingMetaByIncomeRows(rows: IncomeItem[]): Record<string, BookingMeta> {
  return rows.reduce((acc, item) => {
    const bookingId = resolveLinkedBookingId(item);
    if (!bookingId) return acc;

    const totalAmount = round2(
      Math.max(0, Number(item.bookingTotal ?? item.amount ?? 0))
    );
    const paidAmount = round2(
      Math.max(0, Math.min(totalAmount, Number(item.bookingPaid ?? item.amount ?? 0)))
    );
    const remainingAmount = round2(Math.max(0, totalAmount - paidAmount));
    const paymentStatus = String(item.bookingPaymentStatus || "").trim().toLowerCase();
    const paymentType: BookingPaymentType =
      paymentStatus === "partial" || remainingAmount > 0 ? "partial" : "full";

    acc[bookingId] = {
      bookingRef: toBookingRef(String(item.bookingPublicId || bookingId)),
      clientName: String(item.bookingClientName || item.clientName || "").trim(),
      employeeName: exportV2ResolveEmployeeName([item.bookingStaffName]),
      bookingDate: normalizeISODate(item.bookingDate),
      paymentType,
      paidAmount,
      remainingAmount,
      totalAmount,
    };

    return acc;
  }, {} as Record<string, BookingMeta>);
}

function resolveDisplayEmployeeName(item: IncomeItem, meta?: BookingMeta): string {
  const raw = item as any;
  return exportV2ResolveEmployeeName([
    meta?.employeeName,
    raw?.employeeName,
    raw?.staffName,
    raw?.addedBy,
  ]);
}

function resolveDisplayClientName(item: IncomeItem, meta?: BookingMeta, language: DashboardLanguage = "ar"): string {
  const fromMeta = String(meta?.clientName || "").trim();
  if (fromMeta) return fromMeta;

  const raw = item as any;
  const fromIncome = String(
    raw?.clientName || raw?.customerName || raw?.name || raw?.client?.name || raw?.customer?.name || ""
  ).trim();
  if (fromIncome) return fromIncome;

  return incomeText(language, "عميلة غير محددة");
}

function resolveDisplayBookingRef(item: IncomeItem, meta?: BookingMeta, language: DashboardLanguage = "ar"): string {
  const fromMeta = String(meta?.bookingRef || "").trim();
  if (fromMeta && fromMeta !== "-") return fromMeta;

  const bookingId = String(item.bookingId || "").trim();
  if (bookingId) return toBookingRef(bookingId, language);

  const kind = sourceKind(item.source || "");
  if (kind === "manual" || kind === "invoice" || kind === "refund" || kind === "other") {
    return incomeText(language, "بدون حجز");
  }
  if (kind === "internal") return incomeText(language, "حجز داخلي");
  return incomeText(language, "غير متوفر");
}

function resolveDisplayNoteText(item: IncomeItem, noteText: string, language: DashboardLanguage = "ar"): string {
  if (noteText) return noteText;
  const kind = sourceKind(item.source || "");
  if (kind === "booking") return incomeText(language, "سجل حجز بدون ملاحظة");
  if (kind === "invoice") return incomeText(language, "فاتورة بدون ملاحظة");
  if (kind === "internal") return incomeText(language, "دفع داخلي بدون ملاحظة");
  if (kind === "manual") return incomeText(language, "دخل يدوي بدون ملاحظة");
  if (kind === "refund") return incomeText(language, "استرجاع بدون ملاحظة");
  return incomeText(language, "بدون ملاحظة");
}

function buildFallbackPaymentSummaryText(item: IncomeItem, amountToShow: number, language: DashboardLanguage = "ar"): string {
  const signedAmount = round2(Number(amountToShow || item.amount || 0));
  const absAmount = Math.abs(signedAmount);
  const kind = sourceKind(item.source || "");
  if (kind === "refund" || signedAmount < 0) return `${incomeText(language, "استرجاع")} ${absAmount.toFixed(2)} ${language === "en" ? "SAR" : "ر.س"}`;
  return `${incomeText(language, "مدفوع")} ${absAmount.toFixed(2)} ${language === "en" ? "SAR" : "ر.س"}`;
}

function isRevenueStatus(status: any) {
  const s = String(status || "").toLowerCase().trim();
  return s === "confirmed" || s === "completed";
}

/**
 * ✅ PATCH: تطبيع طريقة الدفع (يدعم العربي + القديم)
 * ✅ هذا مهم للـ Migration من LocalStorage حتى ما تتحول "كاش/شبكة" إلى other
 */
function normalizePaymentMethod(x: any): PaymentMethod {
  const s = String(x ?? "").toLowerCase().trim();

  // already normalized
  if (s === "cash") return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online") return "card";
  if (s === "transfer") return "transfer";
  if (s === "mixed") return "mixed";
  if (s === "other") return "other";

  // arabic / legacy
  if (s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s.includes("شبكة") || s.includes("مدى") || s.includes("بطاق"))
    return "card";
  if (s.includes("تحويل")) return "transfer";
  if (s.includes("مختلط") || s.includes("mixed")) return "mixed";

  return "other";
}

function formatIncomeFinanceNote(raw: unknown, language: DashboardLanguage): string {
  if (language === "ar" || !isSystemFinanceNote(raw)) return formatFinanceNote(raw);

  const parts = String(raw ?? "")
    .split("|")
    .map((part) => {
      const clean = part.trim();
      const lower = clean.toLowerCase();
      const method = clean.split(":")[1] || "";
      const paymentMethod = methodLabel(normalizePaymentMethod(method), language);

      if (lower.startsWith("booking_edit_payment:")) {
        return `${incomeText(language, "تعديل دفعة حجز")} — ${paymentMethod}`;
      }
      if (lower.startsWith("invoice_from_reception:")) {
        return `${incomeText(language, "فاتورة من الاستقبال")} — ${paymentMethod}`;
      }
      if (lower.startsWith("internal_payment:")) {
        return `${incomeText(language, "دفع حجز داخلي")} — ${paymentMethod}`;
      }
      if (lower.startsWith("payment_method:")) {
        return `${incomeText(language, "طريقة الدفع")} — ${paymentMethod}`;
      }
      if (lower === "package_purchase" || lower.startsWith("package_purchase:")) {
        return incomeText(language, "شراء باقة");
      }
      return clean;
    })
    .filter(Boolean);

  return parts.join(" — ");
}

function normalizeIncomeSourceInput(raw: string): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "other";
  const lower = trimmed.toLowerCase();
  if (lower === "other" || lower === "other income") return "other";
  if (lower === "manual" || lower === "\u064a\u062f\u0648\u064a") return "other";
  if (
    trimmed === OTHER_INCOME_LABEL ||
    trimmed === "\u062f\u062e\u0644 \u0627\u062e\u0631" ||
    trimmed === "\u0623\u062e\u0631\u0649" ||
    trimmed === "\u0627\u062e\u0631\u0649"
  )
    return "other";
  return trimmed;
}

function loadLegacyIncome(): IncomeItem[] {
  try {
    const raw = localStorage.getItem(LEGACY_INCOME_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((x: any) => {
        const amount = Number(x.amount ?? 0);
        const date = String(x.date || "").trim();
        if (!date || !amount || amount <= 0) return null;

        return {
          id: String(x.id || uid()),
          date,
          amount,
          method: normalizePaymentMethod(x.method),
          source: String(x.source || "دخل"),
          note: x.note ? String(x.note) : undefined,
          bookingId: x.bookingId ? String(x.bookingId) : undefined,
          createdAt: Number(x.createdAt || Date.now()),
        } as IncomeItem;
      })
      .filter(Boolean) as IncomeItem[];
  } catch {
    return [];
  }
}

function formatSar(value: number, language: DashboardLanguage = "ar"): string {
  const amount = Number(value || 0);
  return `${amount.toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn", { maximumFractionDigits: 2 })} ${language === "en" ? "SAR" : "ر.س"}`;
}

function firebaseMsg(e: any, language: DashboardLanguage = "ar") {
  const msg = String(e?.message || e || "");
  if (msg.includes("Missing or insufficient permissions"))
    return incomeText(language, "⚠️ لا توجد صلاحيات كافية.");
  if (msg.includes("not-found")) return incomeText(language, "⚠️ المسار غير موجود.");
  if (msg.includes("requires an index")) return incomeText(language, "⚠️ الاستعلام يحتاج Index.");
  return incomeText(language, "تعذر تنفيذ العملية.");
}

function DashboardIncomeContent({ language }: { language: DashboardLanguage }) {
  const t = (text: string) => incomeText(language, text);
  const { hasPermission } = usePermissions();
  const canManageIncome = hasPermission("income.manage");
  const canManageBookingPayment = hasPermission("bookings.payment.manage");

  const [items, setItems] = useState<IncomeItem[]>([]);
  const [bookingMetaById, setBookingMetaById] = useState<Record<string, BookingMeta>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [detailsTarget, setDetailsTarget] = useState<IncomeItem | null>(null);
  const { pushToast } = useDashboardToastV2();

  const [addOpen, setAddOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState("");

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [source, setSource] = useState(language === "en" ? "Manual" : "يدوي");
  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<IncomeItem | null>(null);
  const [editPin, setEditPin] = useState("");
  const [editError, setEditError] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editBookingTotal, setEditBookingTotal] = useState("");
  const [editPaymentType, setEditPaymentType] = useState<BookingPaymentType>("full");
  const [editPaidAmount, setEditPaidAmount] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IncomeItem | null>(null);
  const [deletePin, setDeletePin] = useState("");
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    setSource((current) => {
      if (current === "يدوي" || current === "Manual") {
        return language === "en" ? "Manual" : "يدوي";
      }
      return current;
    });
  }, [language]);

  // Filters
  const [q, setQ] = useState("");
  const [fMethod, setFMethod] = useState<PaymentMethod | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const editLinkedBookingId = editTarget ? resolveLinkedBookingId(editTarget) : "";
  const editBookingMeta = editLinkedBookingId ? bookingMetaById[editLinkedBookingId] : undefined;
  const editIsRefund = editTarget ? isRefundIncomeRow(editTarget) : false;
  const editCanAdjustPayment =
    !!editLinkedBookingId &&
    !editIsRefund &&
    canManageBookingPayment;

  useEffect(() => {
    const message = modalMsg.trim();
    if (!message) return;

    const successMessages = new Set([
      t("تم تحديث بيانات الإيرادات"),
      t("تمت إضافة سجل الإيراد"),
      t("تم حذف سجل الإيراد"),
      t("تم تعديل طريقة الدفع وتحديث الإيراد"),
      t("تم تعديل المبلغ"),
      t("تم تحميل ملف PDF"),
    ]);
    const warningMessages = new Set([
      t("الاسترجاع يُدار من صفحة الحجوزات حتى تبقى الفاتورة والمدفوعات متطابقة."),
      t("إيراد الحجز يُدار من الحجز نفسه حتى تبقى الفاتورة والمدفوعات والإيراد متطابقة."),
      t("الدفع المختلط يُعدّل من صفحة الحجوزات حتى يتم توزيع المبلغ على طرق الدفع بشكل صريح."),
      t("ما فيه بيانات للتصدير"),
    ]);
    const tone = successMessages.has(message)
      ? "success"
      : warningMessages.has(message)
        ? "warning"
        : "danger";

    pushToast({ title: message, tone });
    setModalMsg("");
  }, [language, modalMsg, pushToast]);

  const refresh = async (announce = false) => {
    try {
      setLoading(true);
      setLoadError("");
      const incomeRows = await listAllIncomeCore();
      setItems(incomeRows);
      setBookingMetaById(buildBookingMetaByIncomeRows(incomeRows));
      setLoadError("");
      if (announce) setModalMsg(t("تم تحديث بيانات الإيرادات"));
    } catch (e) {
      const message = firebaseMsg(e, language);
      setLoadError(message);
      setModalMsg(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        setLoading(true);

        const user = await new Promise<import("firebase/auth").User | null>(
          (resolve) => {
            const unsub = onAuthStateChanged(auth, (u) => {
              unsub();
              resolve(u);
            });
          }
        );

        if (!user) {
          if (mounted) setModalMsg(t("سجّل دخول الإدارة أولاً"));
          return;
        }

        const data = await listAllIncomeCore();

        // ✅ Migration (once)
        const migrated = localStorage.getItem(INCOME_MIGRATED_KEY) === "1";
        if (!migrated && data.length === 0) {
          const legacy = loadLegacyIncome();
          if (legacy.length) {
            for (const it of legacy) {
              if (String(it.bookingId || "").trim()) continue;
              await upsertIncomeCore(it);
            }
          }
          localStorage.setItem(INCOME_MIGRATED_KEY, "1");
        } else if (!migrated) {
          localStorage.setItem(INCOME_MIGRATED_KEY, "1");
        }

        const finalData = await listAllIncomeCore();
        if (mounted) {
          setItems(finalData);
          setBookingMetaById(buildBookingMetaByIncomeRows(finalData));
          setLoadError("");
        }
      } catch (e) {
        if (mounted) {
          const message = firebaseMsg(e, language);
          setLoadError(message);
          setModalMsg(message);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, []);

  const effectiveDateOf = (x: IncomeItem) => {
    const linkedBookingId = resolveLinkedBookingId(x);
    const bm = bookingMetaById[linkedBookingId];
    return normalizeISODate(bm?.bookingDate) || normalizeISODate(x.date) || String(x.date || "").trim();
  };

  // Top stat cards should follow period filters only (from/to), not text/method filters.
  const periodFiltered = useMemo(
    () =>
      items
        .filter((x) => {
          const effectiveDate = effectiveDateOf(x);
          if (from && effectiveDate < from) return false;
          if (to && effectiveDate > to) return false;
          return true;
        })
        .sort((a, b) => effectiveDateOf(b).localeCompare(effectiveDateOf(a))),
    [items, from, to, bookingMetaById]
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return periodFiltered.filter((x) => {
      if (fMethod !== "all" && x.method !== fMethod) return false;
      if (!qq) return true;

      const linkedBookingId = resolveLinkedBookingId(x);
      const bm = bookingMetaById[linkedBookingId];
      const effectiveDate = effectiveDateOf(x);
      const paymentSummary = buildPaymentSummary(bm, language);
      const noteText = formatIncomeFinanceNote(x.note, language);
      const effectiveAmount = Number(x.amount || 0);
      const a =
        `${effectiveDate} ${effectiveAmount} ${sourceLabel(x.source || "", language)} ${x.note || ""} ${noteText} ${
          x.bookingId || ""
        } ${x.id} ${bm?.clientName || ""} ${bm?.bookingRef || ""} ${paymentSummary}`.toLowerCase();
      return a.includes(qq);
    });
  }, [periodFiltered, q, fMethod, bookingMetaById]);

  const rowBookingMeta = (item: IncomeItem) => {
    const linkedBookingId = resolveLinkedBookingId(item);
    return bookingMetaById[linkedBookingId];
  };

  const rowEffectiveDate = (item: IncomeItem) => {
    const bm = rowBookingMeta(item);
    return normalizeISODate(bm?.bookingDate) || normalizeISODate(item.date) || String(item.date || "").trim();
  };

  const rowEffectiveAmount = (item: IncomeItem) => Number(item.amount || 0);

  const total = useMemo(
    () => periodFiltered.reduce((s, x) => s + rowEffectiveAmount(x), 0),
    [periodFiltered]
  );

  const totalCash = useMemo(
    () =>
      periodFiltered
        .filter((x) => x.method === "cash")
        .reduce((s, x) => s + rowEffectiveAmount(x), 0),
    [periodFiltered]
  );

  const totalCard = useMemo(
    () =>
      periodFiltered
        .filter((x) => x.method === "card")
        .reduce((s, x) => s + rowEffectiveAmount(x), 0),
    [periodFiltered]
  );

  const totalTransfer = useMemo(
    () =>
      periodFiltered
        .filter((x) => x.method === "transfer")
        .reduce((s, x) => s + rowEffectiveAmount(x), 0),
    [periodFiltered]
  );

  const totalOtherIncome = useMemo(
    () =>
      periodFiltered
        .filter((x) => sourceKind(x.source || "") === "other")
        .reduce((s, x) => s + rowEffectiveAmount(x), 0),
    [periodFiltered]
  );

  const totalRefund = useMemo(
    () =>
      Math.abs(
        periodFiltered
          .filter((x) => rowEffectiveAmount(x) < 0)
          .reduce((s, x) => s + rowEffectiveAmount(x), 0)
      ),
    [periodFiltered]
  );

  const addIncome = async () => {
    const n = Number(amount);
    const reason = String(note || "").trim();
    const cleanedSource = normalizeIncomeSourceInput(source);
    if (!date || !n || n <= 0) return setModalMsg(t("بيانات غير صحيحة"));
    if (!reason) return setModalMsg(t("سبب/مرجع الدخل مطلوب"));

    const item: IncomeItem = {
      id: uid(),
      date,
      amount: n,
      method,
      source: cleanedSource,
      note: reason,
      createdAt: Date.now(),
    };

    try {
      setLoading(true);
      await upsertIncomeCore(item);
      const next = await listAllIncomeCore();
      setItems(next);
      setAddOpen(false);
      setAmount("");
      setNote("");
      setModalMsg(t("تمت إضافة سجل الإيراد"));
    } catch (e) {
      setModalMsg(firebaseMsg(e, language));
    } finally {
      setLoading(false);
    }
  };

  const openDeleteIncomeModal = (item: IncomeItem) => {
    if (isRefundIncomeRow(item)) {
      setModalMsg(t("الاسترجاع يُدار من صفحة الحجوزات حتى تبقى الفاتورة والمدفوعات متطابقة."));
      return;
    }
    if (!canManageIncome) {
      setModalMsg(t("لا تملك صلاحية إدارة الإيرادات."));
      return;
    }
    if (resolveLinkedBookingId(item)) {
      setModalMsg(t("إيراد الحجز يُدار من الحجز نفسه حتى تبقى الفاتورة والمدفوعات والإيراد متطابقة."));
      return;
    }
    setDeleteTarget(item);
    setDeletePin("");
    setDeleteError("");
    setDeleteOpen(true);
  };

  const closeDeleteIncomeModal = () => {
    if (loading) return;
    setDeleteOpen(false);
    setDeleteTarget(null);
    setDeletePin("");
    setDeleteError("");
  };

  const confirmDeleteIncome = async () => {
    if (!deleteTarget?.id) return;
    if (!canManageIncome) {
      setDeleteError(t("لا تملك صلاحية إدارة الإيرادات."));
      return;
    }
    if (resolveLinkedBookingId(deleteTarget)) {
      setDeleteError(t("إيراد الحجز لا يُحذف مباشرة من صفحة الإيرادات."));
      return;
    }
    if (String(deletePin).trim() !== INCOME_EDIT_PIN) {
      setDeleteError(t("الرقم السري غير صحيح"));
      return;
    }

    try {
      setLoading(true);
      setDeleteError("");
      await removeIncomeCore(String(deleteTarget.id));
      const next = await listAllIncomeCore();
      setItems(next);
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeletePin("");
      setDeleteError("");
      setModalMsg(t("تم حذف سجل الإيراد"));
    } catch (e) {
      setDeleteError(firebaseMsg(e, language));
    } finally {
      setLoading(false);
    }
  };

  const openEditIncomeModal = (item: IncomeItem) => {
    if (!canManageIncome) {
      setModalMsg(t("لا تملك صلاحية إدارة الإيرادات."));
      return;
    }
    if (isRefundIncomeRow(item)) {
      setModalMsg(t("الاسترجاع يُدار من صفحة الحجوزات حتى تبقى الفاتورة والمدفوعات متطابقة."));
      return;
    }
    const linkedBookingId = resolveLinkedBookingId(item);
    if (linkedBookingId && !canManageBookingPayment) {
      setModalMsg(t("لا تملك صلاحية إدارة دفعات الحجوزات."));
      return;
    }
    if (linkedBookingId && item.method === "mixed") {
      setModalMsg(t("الدفع المختلط يُعدّل من صفحة الحجوزات حتى يتم توزيع المبلغ على طرق الدفع بشكل صريح."));
      return;
    }
    const meta = linkedBookingId ? bookingMetaById[linkedBookingId] : undefined;
    const fallbackAmount = round2(Math.max(0, Number(item.amount || 0)));

    setEditTarget(item);
    setEditPin("");
    setEditError("");
    setEditAmount(String(fallbackAmount));
    setEditBookingTotal(String(round2(meta?.totalAmount ?? fallbackAmount)));
    setEditPaymentType(meta?.paymentType || "full");
    setEditPaidAmount(String(round2(meta?.paidAmount ?? fallbackAmount)));
    setEditOpen(true);
  };

  const closeEditIncomeModal = () => {
    if (loading) return;
    setEditOpen(false);
    setEditTarget(null);
    setEditPin("");
    setEditError("");
  };

  const saveEditedIncome = async () => {
    if (!editTarget) return;
    if (String(editPin).trim() !== INCOME_EDIT_PIN) {
      setEditError(t("الرقم السري غير صحيح"));
      return;
    }

    const bookingId = resolveLinkedBookingId(editTarget);
    const bookingPaymentEdit =
      !!bookingId && !isRefundIncomeRow(editTarget);

    if (!canManageIncome) {
      setEditError(t("لا تملك صلاحية إدارة الإيرادات."));
      return;
    }
    if (bookingPaymentEdit && !canManageBookingPayment) {
      setEditError(t("لا تملك صلاحية إدارة دفعات الحجوزات."));
      return;
    }

    const canAdjustPayment =
      bookingPaymentEdit && canManageBookingPayment;

    if (canAdjustPayment && editTarget.method === "mixed") {
      setEditError(t("الدفع المختلط يُعدّل من صفحة الحجوزات حتى يتم توزيع المبلغ على طرق الدفع بشكل صريح."));
      return;
    }

    try {
      setLoading(true);
      setEditError("");

      if (canAdjustPayment) {
        const totalAmountRaw = parseMoneyInput(editBookingTotal);
        if (!Number.isFinite(totalAmountRaw) || totalAmountRaw <= 0) {
          setEditError(t("إجمالي الحجز غير صحيح."));
          return;
        }
        const totalAmount = round2(totalAmountRaw);

        let paymentType: BookingPaymentType = editPaymentType === "partial" ? "partial" : "full";
        let paidAmount =
          paymentType === "full" ? totalAmount : parseMoneyInput(editPaidAmount);

        if (paymentType === "partial") {
          if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
            setEditError(t("مبلغ العربون غير صحيح."));
            return;
          }
          if (paidAmount > totalAmount) {
            setEditError(t("مبلغ العربون لا يمكن أن يتجاوز إجمالي الحجز."));
            return;
          }
        }

        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
          setEditError(t("المبلغ المدفوع غير صحيح."));
          return;
        }

        if (paidAmount >= totalAmount) {
          paymentType = "full";
          paidAmount = totalAmount;
        }

        const paidRounded = round2(Math.max(0, Math.min(totalAmount, paidAmount)));
        const remainingAmount = round2(Math.max(0, totalAmount - paidRounded));

        const paymentMethod = editTarget.method;

        await CoreBookingService.patch(bookingId, {
          subtotalHalalas: Math.round(totalAmount * 100),
          totalHalalas: Math.round(totalAmount * 100),
          paidHalalas: Math.round(paidRounded * 100),
          paymentStatus: paymentType === "full" ? "paid" : "partial",
          reconcilePayment: true,
          paymentMethod,
        });

        await refresh();
        setModalMsg(t("تم تعديل طريقة الدفع وتحديث الإيراد"));
      } else {
        const nextAmountRaw = parseMoneyInput(editAmount);
        if (!Number.isFinite(nextAmountRaw) || nextAmountRaw <= 0) {
          setEditError(t("المبلغ غير صحيح."));
          return;
        }

        const nextAmount = round2(nextAmountRaw);
        await upsertIncomeCore({
          ...editTarget,
          amount: nextAmount,
          createdAt: Number(editTarget.createdAt) || Date.now(),
        });
        const next = await listAllIncomeCore();
        setItems(next);
        setModalMsg(t("تم تعديل المبلغ"));
      }

      setEditOpen(false);
      setEditTarget(null);
      setEditPin("");
      setEditError("");
    } catch (e) {
      setEditError(firebaseMsg(e, language));
    } finally {
      setLoading(false);
    }
  };

  const buildIncomeReportInput = () => {
    const reportRows = filtered.map((x) => {
      const bookingMeta = rowBookingMeta(x);
      const paidAmount = round2(rowEffectiveAmount(x));
      const totalAmount = round2(bookingMeta?.totalAmount ?? paidAmount);
      const isRefund = paidAmount < 0 || isRefundIncomeRow(x);
      const remainingAmount = isRefund
        ? 0
        : round2(Math.max(0, totalAmount - paidAmount));
      const noteText = formatIncomeFinanceNote(x.note, language);

      return {
        date: rowEffectiveDate(x),
        invoiceRef: resolveDisplayBookingRef(x, bookingMeta, language),
        clientName: resolveDisplayClientName(x, bookingMeta, language),
        services: sourceLabel(x.source || "", language),
        employeeName: resolveDisplayEmployeeName(x, bookingMeta),
        paymentMethod: methodLabel(x.method, language),
        source: sourceLabel(x.source || "", language),
        totalAmount,
        paidAmount,
        remainingAmount,
        status: exportV2ResolveFinancialStatus({
          totalAmount,
          paidAmount,
          remainingAmount,
          isRefund,
        }).label,
        note: resolveDisplayNoteText(x, noteText, language),
      };
    });

    return {
    rows: reportRows,
    filters: {
      fromDate: from || undefined,
      toDate: to || undefined,
      method: fMethod === "all" ? t("الكل") : methodLabel(fMethod, language),
      source: q.trim() ? `${t("بحث")}: ${q.trim()}` : t("الكل"),
    },
    summary: {
      totalRevenue: total,
      cashRevenue: totalCash,
      cardRevenue: totalCard,
      transferRevenue: totalTransfer,
      otherRevenue: totalOtherIncome,
      refundTotal: totalRefund,
      remainingTotal: reportRows.reduce((sum, row) => sum + Number(row.remainingAmount || 0), 0),
    },
    generatedBy: t("لوحة الإيرادات"),
    };
  };

  const exportPdf = async () => {
    if (!filtered.length) return setModalMsg(t("ما فيه بيانات للتصدير"));
    try {
      setLoading(true);
      await exportIncomeReportPdf(buildIncomeReportInput());
      setModalMsg(t("تم تحميل ملف PDF"));
    } catch (error) {
      setModalMsg(error instanceof Error ? error.message : t("تعذر إنشاء ملف PDF"));
    } finally {
      setLoading(false);
    }
  };

  const exportExcel = () => {
    if (!filtered.length) return setModalMsg(t("ما فيه بيانات للتصدير"));
    exportIncomeReportExcel(buildIncomeReportInput());
  };

  const hasActiveFilters = Boolean(q.trim() || fMethod !== "all" || from || to);
  const detailsBookingMeta = detailsTarget ? rowBookingMeta(detailsTarget) : undefined;
  const detailsAmount = detailsTarget ? rowEffectiveAmount(detailsTarget) : 0;
  const detailsNote = detailsTarget ? formatIncomeFinanceNote(detailsTarget.note, language) : "";

  const clearFilters = () => {
    setQ("");
    setFMethod("all");
    setFrom("");
    setTo("");
  };

  return (
    <>
      <div className="dsv2-page income-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <section className="dsv2-card income-v2-hero">
          <div className="income-v2-hero__content">
            <span className="dsv2-badge dsv2-badge--gold">{t("الإدارة المالية")}</span>
            <h1 className="dsv2-page-title">{t("الإيرادات")}</h1>
            <p className="dsv2-page-subtitle">
              {t("متابعة وتسجيل الإيرادات اليومية مع توحيد طرق الدفع والتقارير المالية.")}
            </p>
          </div>

          <div className="income-v2-actions" aria-label={t("إجراءات صفحة الإيرادات")}>
            <button
              className="dsv2-btn dsv2-btn--primary"
              type="button"
              onClick={() => setAddOpen(true)}
              disabled={loading}
            >
              <FontAwesomeIcon icon={faPlus} />
              {t("إضافة دخل")}
            </button>
            <button
              className="dsv2-btn dsv2-btn--secondary"
              type="button"
              onClick={() => void refresh(true)}
              disabled={loading}
            >
              <FontAwesomeIcon icon={faRotate} />
              {t("تحديث")}
            </button>
            <button
              className="dsv2-btn dsv2-btn--secondary"
              type="button"
              onClick={() => void exportPdf()}
              disabled={!filtered.length || loading}
            >
              <FontAwesomeIcon icon={faFilePdf} />
              {t("تحميل PDF")}
            </button>
            <button
              className="dsv2-btn dsv2-btn--secondary"
              type="button"
              onClick={exportExcel}
              disabled={!filtered.length || loading}
            >
              <FontAwesomeIcon icon={faFileExcel} />
              {t("Excel منسّق")}
            </button>
          </div>
        </section>

        <section className="income-v2-metrics" aria-label={t("ملخص الإيرادات")}>
          <article className="dsv2-metric-card dsv2-metric-card--gold">
            <p className="dsv2-metric-card__label">{t("إجمالي الإيرادات")}</p>
            <p className="dsv2-metric-card__value">{formatSar(total, language)}</p>
            <p className="dsv2-metric-card__meta">{t("حسب الفترة المحددة")}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--success">
            <p className="dsv2-metric-card__label">{t("إيرادات الكاش")}</p>
            <p className="dsv2-metric-card__value">{formatSar(totalCash, language)}</p>
            <p className="dsv2-metric-card__meta">{t("المدفوع نقدًا")}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--dark">
            <p className="dsv2-metric-card__label">{t("إيرادات الشبكة")}</p>
            <p className="dsv2-metric-card__value">{formatSar(totalCard, language)}</p>
            <p className="dsv2-metric-card__meta">{t("مدفوعات البطاقات")}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--gold">
            <p className="dsv2-metric-card__label">{t("التحويلات")}</p>
            <p className="dsv2-metric-card__value">{formatSar(totalTransfer, language)}</p>
            <p className="dsv2-metric-card__meta">{t("التحويلات البنكية")}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--dark">
            <p className="dsv2-metric-card__label">{t("دخل آخر")}</p>
            <p className="dsv2-metric-card__value">{formatSar(totalOtherIncome, language)}</p>
            <p className="dsv2-metric-card__meta">{t("الإيرادات اليدوية والأخرى")}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--danger">
            <p className="dsv2-metric-card__label">{t("إجمالي الاسترجاع")}</p>
            <p className="dsv2-metric-card__value">{formatSar(totalRefund, language)}</p>
            <p className="dsv2-metric-card__meta">{t("الحركات المالية السالبة")}</p>
          </article>
        </section>

        <section className="dsv2-card dsv2-card--padded income-v2-filter-card">
          <div className="dsv2-section-head">
            <div>
              <h2 className="dsv2-section-title">{t("البحث والفلاتر")}</h2>
              <p className="dsv2-section-caption">
                {t("تؤثر فترة التاريخ في المؤشرات، بينما يطبق البحث وطريقة الدفع على السجلات المعروضة.")}
              </p>
            </div>
            {hasActiveFilters ? (
              <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={clearFilters}>
                {t("مسح الفلاتر")}
              </button>
            ) : null}
          </div>

          <div className="income-v2-filter-grid">
            <DashboardFieldV2 id="income-v2-search" label={t("بحث")}>
              <div className="income-v2-search-control">
                <FontAwesomeIcon icon={faSearch} aria-hidden="true" />
                <input
                  id="income-v2-search"
                  name="income-v2-search"
                  className="dsv2-input"
                  type="search"
                  placeholder={t("المصدر، الملاحظة، المبلغ، العميلة أو رقم الحجز")}
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </DashboardFieldV2>

            <DashboardFieldV2 id="income-v2-method" label={t("طريقة الدفع")}>
              <DashboardSelectV2
                id="income-v2-method"
                options={INCOME_FILTER_METHOD_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
                value={fMethod}
                onChange={(value) => setFMethod(value as PaymentMethod | "all")}
              />
            </DashboardFieldV2>

            <DashboardFieldV2 id="income-v2-from" label={t("من تاريخ")}>
              <DashboardDatePickerV2
                id="income-v2-from"
                value={from}
                max={to || undefined}
                onChange={setFrom}
                placeholder={t("بداية الفترة")}
              />
            </DashboardFieldV2>

            <DashboardFieldV2 id="income-v2-to" label={t("إلى تاريخ")}>
              <DashboardDatePickerV2
                id="income-v2-to"
                value={to}
                min={from || undefined}
                onChange={setTo}
                placeholder={t("نهاية الفترة")}
              />
            </DashboardFieldV2>
          </div>
        </section>

        <section className="dsv2-table-card income-v2-table-card">
          <header className="income-v2-table-head">
            <div>
              <h2 className="dsv2-section-title">{t("سجل الإيرادات")}</h2>
              <p className="dsv2-section-caption">
                {filtered.length.toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn")} {t("سجل معروض من أصل")} {items.length.toLocaleString(language === "en" ? "en-US" : "ar-SA-u-nu-latn")}.
              </p>
            </div>
            <div className="income-v2-table-head__status">
              {loading ? <span className="dsv2-badge dsv2-badge--gold">{t("جارٍ التحديث")}</span> : null}
              <span className="dsv2-badge dsv2-badge--success">{formatSar(total, language)}</span>
            </div>
          </header>

          {loadError && !items.length ? (
            <div className="income-v2-state-wrap">
              <DashboardErrorStateV2
                title={t("تعذر تحميل الإيرادات")}
                description={loadError}
                action={
                  <button className="dsv2-btn dsv2-btn--danger" type="button" onClick={() => void refresh()}>
                    {t("إعادة المحاولة")}
                  </button>
                }
              />
            </div>
          ) : loading && !items.length ? (
            <div className="income-v2-loading-table" role="status" aria-label={t("جارٍ تحميل الإيرادات")}>
              <DashboardSkeletonV2 variant="title" width="34%" />
              <DashboardSkeletonV2 variant="text" lines={4} />
              <DashboardSkeletonV2 variant="block" height={150} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="income-v2-state-wrap">
              <DashboardEmptyStateV2
                title={t("لا توجد إيرادات مطابقة")}
                description={hasActiveFilters ? t("غيّر نطاق البحث أو امسح الفلاتر لعرض بقية السجلات.") : t("ابدأ بإضافة أول حركة إيراد.")}
                tone="gold"
                action={
                  hasActiveFilters ? (
                    <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={clearFilters}>
                      {t("مسح الفلاتر")}
                    </button>
                  ) : (
                    <button className="dsv2-btn dsv2-btn--accent" type="button" onClick={() => setAddOpen(true)}>
                      {t("إضافة دخل")}
                    </button>
                  )
                }
              />
            </div>
          ) : (
            <>
              <div className="dsv2-table-scroll income-v2-desktop-table">
                <table className="dsv2-table income-v2-table">
                  <thead>
                    <tr>
                      <th>{t("التاريخ")}</th>
                      <th>{t("المبلغ")}</th>
                      <th>{t("الدفع")}</th>
                      <th>{t("العميلة والحجز")}</th>
                      <th>{t("المصدر")}</th>
                      <th>{t("الملاحظة")}</th>
                      <th>{t("ملخص الدفع")}</th>
                      <th>{t("الإجراءات")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const bookingMeta = rowBookingMeta(item);
                      const paymentRows = buildPaymentSummaryRows(bookingMeta, language);
                      const amountToShow = rowEffectiveAmount(item);
                      const noteText = formatIncomeFinanceNote(item.note, language);
                      const srcKind = sourceKind(item.source || "");
                      const displayClientName = resolveDisplayClientName(item, bookingMeta, language);
                      const displayBookingRef = resolveDisplayBookingRef(item, bookingMeta, language);
                      const displayNoteText = resolveDisplayNoteText(item, noteText, language);
                      const fallbackSummary = buildFallbackPaymentSummaryText(item, amountToShow, language);
                      return (
                        <tr key={item.id}>
                          <td>
                            <span className="dsv2-table__primary">{rowEffectiveDate(item)}</span>
                          </td>
                          <td>
                            <strong className="income-v2-amount" data-negative={amountToShow < 0 ? "true" : "false"}>
                              {formatSar(amountToShow, language)}
                            </strong>
                          </td>
                          <td>
                            <span className="income-v2-method-badge" data-method={item.method}>
                              {methodLabel(item.method, language)}
                            </span>
                            {bookingMeta ? (
                              <span className="dsv2-table__secondary">
                                {bookingMeta.paymentType === "full" ? t("دفع كامل") : t("عربون")}
                              </span>
                            ) : null}
                          </td>
                          <td>
                            <span className="dsv2-table__primary">{displayClientName}</span>
                            <span className="dsv2-table__secondary">{displayBookingRef}</span>
                          </td>
                          <td>
                            <span className="income-v2-source-badge" data-source={srcKind}>
                              {sourceLabel(item.source || "", language)}
                            </span>
                          </td>
                          <td className="income-v2-note-cell">{displayNoteText}</td>
                          <td>
                            <div className="income-v2-payment-summary">
                              {paymentRows.length ? paymentRows.map((row) => (
                                <span key={`${item.id}-${row.kind}`} data-kind={row.kind}>
                                  {row.label}: {formatSar(row.value, language)}
                                </span>
                              )) : <span data-kind={amountToShow < 0 ? "remaining" : "paid"}>{fallbackSummary}</span>}
                            </div>
                          </td>
                          <td>
                            <div className="income-v2-row-actions">
                              <button className="dsv2-icon-btn" type="button" title={t("عرض التفاصيل")} onClick={() => setDetailsTarget(item)}>
                                <FontAwesomeIcon icon={faEye} />
                              </button>
                              {!isRefundIncomeRow(item) ? (
                                <>
                                  <button className="dsv2-icon-btn" type="button" title={t("تعديل")} onClick={() => openEditIncomeModal(item)} disabled={loading}>
                                    <FontAwesomeIcon icon={faPen} />
                                  </button>
                                  <button className="dsv2-icon-btn income-v2-delete-action" type="button" title={t("حذف")} onClick={() => openDeleteIncomeModal(item)} disabled={loading}>
                                    <FontAwesomeIcon icon={faTrash} />
                                  </button>
                                </>
                              ) : (
                                <span className="dsv2-badge dsv2-badge--danger">{t("من الحجوزات")}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="income-v2-mobile-list">
                {filtered.map((item) => {
                  const bookingMeta = rowBookingMeta(item);
                  const amountToShow = rowEffectiveAmount(item);
                  const noteText = formatIncomeFinanceNote(item.note, language);
                  return (
                    <article className="income-v2-mobile-card" key={`mobile-${item.id}`}>
                      <header>
                        <div>
                          <span>{rowEffectiveDate(item)}</span>
                          <strong data-negative={amountToShow < 0 ? "true" : "false"}>{formatSar(amountToShow, language)}</strong>
                        </div>
                        <span className="income-v2-method-badge" data-method={item.method}>{methodLabel(item.method, language)}</span>
                      </header>
                      <dl>
                        <div><dt>{t("العميلة")}</dt><dd>{resolveDisplayClientName(item, bookingMeta, language)}</dd></div>
                        <div><dt>{t("الحجز")}</dt><dd>{resolveDisplayBookingRef(item, bookingMeta, language)}</dd></div>
                        <div><dt>{t("المصدر")}</dt><dd>{sourceLabel(item.source || "", language)}</dd></div>
                        <div><dt>{t("الملاحظة")}</dt><dd>{resolveDisplayNoteText(item, noteText, language)}</dd></div>
                      </dl>
                      <footer>
                        <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => setDetailsTarget(item)}>
                          <FontAwesomeIcon icon={faEye} /> {t("عرض")}
                        </button>
                        {!isRefundIncomeRow(item) ? (
                          <>
                            <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => openEditIncomeModal(item)} disabled={loading}>
                              <FontAwesomeIcon icon={faPen} /> {t("تعديل")}
                            </button>
                            <button className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" type="button" onClick={() => openDeleteIncomeModal(item)} disabled={loading}>
                              <FontAwesomeIcon icon={faTrash} /> {t("حذف")}
                            </button>
                          </>
                        ) : null}
                      </footer>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      <DashboardModalV2
        open={addOpen}
        onClose={() => { if (!loading) setAddOpen(false); }}
        title={t("إضافة حركة إيراد")}
        description={t("سجّل بيانات الحركة المالية، ثم احفظها لتظهر في المؤشرات والتقارير.")}
        eyebrow={t("الإيرادات")}
        size="md"
        tone="gold"
        closeOnBackdrop={!loading}
        closeOnEscape={!loading}
        footer={
          <>
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => void addIncome()} disabled={loading}>
              {loading ? t("جارٍ الحفظ...") : t("حفظ الحركة")}
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => setAddOpen(false)} disabled={loading}>
              {t("إلغاء")}
            </button>
          </>
        }
      >
        <div className="income-v2-modal-grid">
          <DashboardFieldV2 id="income-v2-add-date" label={t("التاريخ")} required>
            <DashboardDatePickerV2 id="income-v2-add-date" value={date} onChange={setDate} required clearable={false} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="income-v2-add-amount" label={t("المبلغ (ر.س)")} required>
            <DashboardNumberInputV2 id="income-v2-add-amount" className="dsv2-input" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="income-v2-add-method" label={t("طريقة السداد")} required>
            <DashboardSelectV2 id="income-v2-add-method" options={INCOME_METHOD_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} value={method} onChange={(value) => setMethod(value as PaymentMethod)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="income-v2-add-source" label={t("المصدر")} required>
            <input id="income-v2-add-source" className="dsv2-input" type="text" placeholder={t("مثال: بيع منتج أو تعديل يدوي")} value={source} onChange={(event) => setSource(event.target.value)} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="income-v2-add-note" label={t("السبب أو المرجع")} required className="income-v2-field--wide">
            <textarea id="income-v2-add-note" className="dsv2-textarea" placeholder={t("اكتب سبب الحركة أو مرجعها")} value={note} onChange={(event) => setNote(event.target.value)} />
          </DashboardFieldV2>
        </div>
      </DashboardModalV2>

      <DashboardModalV2
        open={editOpen && Boolean(editTarget)}
        onClose={closeEditIncomeModal}
        title={editCanAdjustPayment ? t("تعديل الدفع للحجز") : t("تعديل مبلغ الإيراد")}
        description={t("يتطلب تعديل الحركات المالية إدخال الرقم السري المعتمد.")}
        eyebrow={t("تعديل آمن")}
        size="md"
        tone="gold"
        closeOnBackdrop={!loading}
        closeOnEscape={!loading}
        footer={
          <>
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => void saveEditedIncome()} disabled={loading}>
              {loading ? t("جارٍ الحفظ...") : t("حفظ التعديل")}
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={closeEditIncomeModal} disabled={loading}>
              {t("إلغاء")}
            </button>
          </>
        }
      >
        {editCanAdjustPayment ? (
          <div className="income-v2-booking-hint">
            <span>{t("الحجز")}: {editBookingMeta?.bookingRef || editLinkedBookingId || "-"}</span>
            <span>{t("العميلة")}: {editBookingMeta?.clientName || "-"}</span>
          </div>
        ) : null}
        <div className="income-v2-modal-grid">
          <DashboardFieldV2 id="income-v2-edit-pin" label={t("الرقم السري")} required className="income-v2-field--wide">
            <input id="income-v2-edit-pin" name="income_edit_pin" className="dsv2-input" type="password" inputMode="numeric" autoComplete="new-password" data-lpignore="true" placeholder={t("أدخل الرقم السري")} value={editPin} onChange={(event) => setEditPin(event.target.value)} disabled={loading} />
          </DashboardFieldV2>
          {editCanAdjustPayment ? (
            <>
              <DashboardFieldV2 id="income-v2-edit-total" label={t("إجمالي الحجز (ر.س)")} required>
                <DashboardNumberInputV2 id="income-v2-edit-total" className="dsv2-input" min="0" step="0.01" value={editBookingTotal} onChange={(event) => setEditBookingTotal(event.target.value)} disabled={loading} />
              </DashboardFieldV2>
              <DashboardFieldV2 id="income-v2-edit-payment-type" label={t("نوع الدفع")} required>
                <DashboardSelectV2 id="income-v2-edit-payment-type" options={BOOKING_PAYMENT_TYPE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} value={editPaymentType} onChange={(value) => setEditPaymentType(value as BookingPaymentType)} disabled={loading} />
              </DashboardFieldV2>
              {editPaymentType === "partial" ? (
                <DashboardFieldV2 id="income-v2-edit-paid" label={t("المبلغ المدفوع (ر.س)")} required>
                  <DashboardNumberInputV2 id="income-v2-edit-paid" className="dsv2-input" min="0" step="0.01" value={editPaidAmount} onChange={(event) => setEditPaidAmount(event.target.value)} disabled={loading} />
                </DashboardFieldV2>
              ) : null}
              <div className="income-v2-edit-summary income-v2-field--wide">
                {(() => {
                  const totalValue = round2(Math.max(0, parseMoneyInput(editBookingTotal)));
                  const paidRaw = editPaymentType === "full" ? totalValue : Math.max(0, parseMoneyInput(editPaidAmount));
                  const paidValue = round2(Math.min(totalValue, paidRaw));
                  return `${t("المدفوع")} ${formatSar(paidValue, language)} — ${t("المتبقي")} ${formatSar(Math.max(0, totalValue - paidValue), language)}`;
                })()}
              </div>
            </>
          ) : (
            <DashboardFieldV2 id="income-v2-edit-amount" label={t("المبلغ الجديد (ر.س)")} required>
              <DashboardNumberInputV2 id="income-v2-edit-amount" className="dsv2-input" min="0" step="0.01" value={editAmount} onChange={(event) => setEditAmount(event.target.value)} disabled={loading} />
            </DashboardFieldV2>
          )}
        </div>
        {editError ? <div className="income-v2-inline-error" role="alert">{editError}</div> : null}
      </DashboardModalV2>

      <DashboardModalV2
        open={deleteOpen && Boolean(deleteTarget)}
        onClose={closeDeleteIncomeModal}
        title={t("حذف سجل الإيراد؟")}
        description={t("لن يظهر السجل في المؤشرات أو التقارير بعد الحذف.")}
        eyebrow={t("إجراء حساس")}
        size="sm"
        tone="danger"
        role="alertdialog"
        closeOnBackdrop={!loading}
        closeOnEscape={!loading}
        footer={
          <>
            <button className="dsv2-btn dsv2-btn--danger" type="button" onClick={() => void confirmDeleteIncome()} disabled={loading}>
              {loading ? t("جارٍ الحذف...") : t("تأكيد الحذف")}
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={closeDeleteIncomeModal} disabled={loading}>
              {t("تراجع")}
            </button>
          </>
        }
      >
        {deleteTarget ? (
          <div className="income-v2-delete-summary">
            <strong>{formatSar(Number(deleteTarget.amount || 0), language)}</strong>
            <span>{deleteTarget.date || "-"}</span>
            <span>{sourceLabel(deleteTarget.source || "", language)}</span>
          </div>
        ) : null}
        <DashboardFieldV2 id="income-v2-delete-pin" label={t("الرقم السري للحذف")} required>
          <input id="income-v2-delete-pin" name="income_delete_pin" className="dsv2-input" type="password" inputMode="numeric" autoComplete="new-password" data-lpignore="true" placeholder={t("أدخل الرقم السري")} value={deletePin} onChange={(event) => setDeletePin(event.target.value)} disabled={loading} />
        </DashboardFieldV2>
        {deleteError ? <div className="income-v2-inline-error" role="alert">{deleteError}</div> : null}
      </DashboardModalV2>

      {detailsTarget ? (
        <DashboardDrawerV2
          open={Boolean(detailsTarget)}
          onClose={() => setDetailsTarget(null)}
          title={t("تفاصيل حركة الإيراد")}
          description={t("عرض سريع للسجل وبيانات الحجز المرتبطة.")}
          eyebrow={detailsTarget.id}
          size="md"
          side="end"
          tone={detailsAmount < 0 ? "danger" : "success"}
          footer={
            <>
              {!isRefundIncomeRow(detailsTarget) ? (
                <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => { const target = detailsTarget; setDetailsTarget(null); openEditIncomeModal(target); }}>
                  {t("تعديل الحركة")}
                </button>
              ) : null}
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => setDetailsTarget(null)}>
                {t("إغلاق")}
              </button>
            </>
          }
        >
          <div className="income-v2-drawer-content">
            <article className={`dsv2-metric-card ${detailsAmount < 0 ? "dsv2-metric-card--danger" : "dsv2-metric-card--success"}`}>
              <p className="dsv2-metric-card__label">{t("المبلغ المسجل")}</p>
              <p className="dsv2-metric-card__value">{formatSar(detailsAmount, language)}</p>
              <p className="dsv2-metric-card__meta">{detailsAmount < 0 ? t("حركة استرجاع") : t("حركة إيراد")}</p>
            </article>
            <dl className="income-v2-detail-list">
              <div><dt>{t("التاريخ")}</dt><dd>{rowEffectiveDate(detailsTarget)}</dd></div>
              <div><dt>{t("طريقة الدفع")}</dt><dd>{methodLabel(detailsTarget.method, language)}</dd></div>
              <div><dt>{t("العميلة")}</dt><dd>{resolveDisplayClientName(detailsTarget, detailsBookingMeta, language)}</dd></div>
              <div><dt>{t("رقم الحجز")}</dt><dd>{resolveDisplayBookingRef(detailsTarget, detailsBookingMeta, language)}</dd></div>
              <div><dt>{t("المصدر")}</dt><dd>{sourceLabel(detailsTarget.source || "", language)}</dd></div>
              <div><dt>{t("الملاحظة")}</dt><dd>{resolveDisplayNoteText(detailsTarget, detailsNote, language)}</dd></div>
              <div><dt>{t("نوع الدفع")}</dt><dd>{detailsBookingMeta?.paymentType === "partial" ? t("عربون") : detailsBookingMeta ? t("دفع كامل") : t("غير مرتبط بحجز")}</dd></div>
              <div><dt>{t("المتبقي")}</dt><dd>{formatSar(detailsBookingMeta?.remainingAmount || 0, language)}</dd></div>
            </dl>
          </div>
        </DashboardDrawerV2>
      ) : null}
    </>
  );
}

export default function DashboardIncome({ language = "ar" }: { language?: DashboardLanguage }) {
  return (
    <DashboardToastProviderV2 position="top-start">
      <DashboardIncomeContent language={language} />
    </DashboardToastProviderV2>
  );
}
