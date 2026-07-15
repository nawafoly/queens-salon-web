

// ✅ src/pages/DashboardIncome.tsx
import { useEffect, useMemo, useState } from "react";
import "../styles/AdminDashboardIncome.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faSearch,
  faFilter,
  faFileCsv,
  faTrash,
  faRotate,
  faPen,
} from "@fortawesome/free-solid-svg-icons";
import Modal from "../components/Modal";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";

import {
  listAllIncomeFS,
  removeIncomeFS,
  upsertIncomeFS,
} from "../services/firestoreIncome";
import { listAllBookings } from "../services/firestoreBookings";
import { getDataSourceFlags } from "../config/dataSourceFlags";
import { CoreBookingService } from "../services/CoreBookingService";

import type { IncomeItem, PaymentMethod } from "../types/finance";

const ALL_BOOKINGS_KEY = "allBookings";

// ✅ LocalStorage Income (Migration)
const LEGACY_INCOME_KEY = "dashboard_income_v1";
const INCOME_MIGRATED_KEY = "income_migrated_to_firestore_v1";
const INCOME_EDIT_PIN = "598867395";
const OTHER_INCOME_LABEL = "\u062f\u062e\u0644 \u0622\u062e\u0631";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";
type BookingPaymentType = "full" | "partial";
type BookingMeta = {
  bookingRef: string;
  clientName: string;
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

function mapFirestoreRole(raw: unknown): UiRole {
  const role = String(raw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "client") return "client";
  return "guest";
}

async function resolveRoleFromFirestore(uid: string): Promise<UiRole> {
  const id = String(uid || "").trim();
  if (!id) return "guest";

  const salonRef = doc(db, "salons", "main", "users", id);
  const salonSnap = await getDoc(salonRef);
  if (salonSnap.exists()) {
    return mapFirestoreRole((salonSnap.data() as any)?.role);
  }

  const rootRef = doc(db, "users", id);
  const rootSnap = await getDoc(rootRef);
  if (rootSnap.exists()) {
    return mapFirestoreRole((rootSnap.data() as any)?.role);
  }

  return "guest";
}

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

function methodLabel(m: PaymentMethod) {
  if (m === "cash") return "\u0643\u0627\u0634";
  if (m === "card") return "\u0634\u0628\u0643\u0629";
  if (m === "transfer") return "\u062a\u062d\u0648\u064a\u0644";
  if (m === "mixed") return "مختلط";
  return "\u0623\u062e\u0631\u0649";
}

function sourceLabel(source: string) {
  const s = String(source || "").trim().toLowerCase();
  if (!s) return "غير محدد";
  if (s === "booking" || s === "\u062d\u062c\u0632") return "\u062d\u062c\u0632";
  if (s === "invoice" || s === "\u0641\u0627\u062a\u0648\u0631\u0629") return "\u0641\u0627\u062a\u0648\u0631\u0629";
  if (s === "internal_booking") return "\u062d\u062c\u0632 \u062f\u0627\u062e\u0644\u064a";
  if (s === "manual" || s === "\u064a\u062f\u0648\u064a") return "\u064a\u062f\u0648\u064a";
  if (s === "refund" || s === "\u0627\u0633\u062a\u0631\u062c\u0627\u0639") return "\u0627\u0633\u062a\u0631\u062c\u0627\u0639";
  if (
    s === "other" ||
    s === "other income" ||
    s === OTHER_INCOME_LABEL ||
    s === "\u0623\u062e\u0631\u0649" ||
    s === "\u0627\u062e\u0631\u0649"
  )
    return OTHER_INCOME_LABEL;
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

function methodLabelFromRaw(raw?: string): string {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "غير محدد";
  if (s === "cash" || s === "\u0643\u0627\u0634") return "\u0643\u0627\u0634";
  if (s === "mixed" || s.includes("مختلط")) return "مختلط";
  if (
    s === "card" ||
    s === "mada" ||
    s.includes("\u0634\u0628\u0643") ||
    s.includes("\u0628\u0637\u0627\u0642")
  )
    return "\u0634\u0628\u0643\u0629";
  if (s === "transfer" || s.includes("\u062a\u062d\u0648\u064a\u0644")) return "\u062a\u062d\u0648\u064a\u0644";
  return String(raw || "").trim();
}

function formatIncomeNotePart(part: string): string {
  const p = String(part || "").trim();
  if (!p) return "";
  const lower = p.toLowerCase();

  if (lower.startsWith("invoice_from_reception:")) {
    const method = p.split(":")[1] || "";
    return `فاتورة من الاستقبال (${methodLabelFromRaw(method)})`;
  }
  if (lower.startsWith("internal_payment:")) {
    const method = p.split(":")[1] || "";
    return `دفع داخلي (${methodLabelFromRaw(method)})`;
  }
  if (lower.startsWith("payment_method:")) {
    const method = p.split(":")[1] || "";
    return `طريقة الدفع (${methodLabelFromRaw(method)})`;
  }

  return p;
}

function formatIncomeNote(raw?: string): string {
  const note = String(raw || "").trim();
  if (!note) return "";

  const parts = note
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!parts.length) return note;
  return parts.map((p) => formatIncomeNotePart(p)).filter(Boolean).join(" - ");
}

function isSystemIncomeNote(raw?: string): boolean {
  const note = String(raw || "").trim().toLowerCase();
  if (!note) return false;
  return (
    note.includes("invoice_from_reception:") ||
    note.includes("internal_payment:") ||
    note.includes("payment_method:")
  );
}

function toBookingRef(v?: string) {
  const raw = String(v || "").trim().toUpperCase();
  if (!raw) return "بدون حجز";
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
function normalizeBookingPaymentType(raw: unknown): BookingPaymentType | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "full" || s === "complete" || s === "\u0643\u0627\u0645\u0644") return "full";
  if (s === "partial" || s === "deposit" || s === "\u0639\u0631\u0628\u0648\u0646" || s === "\u062c\u0632\u0626\u064a") return "partial";
  return null;
}

function resolveBookingPayment(raw: any): {
  paymentType: BookingPaymentType;
  paidAmount: number;
  remainingAmount: number;
  totalAmount: number;
} {
  const totalAmount = Math.max(
    0,
    Number(
      raw?.finalPrice ??
        raw?.total ??
        raw?.serviceSnapshot?.priceAtBooking ??
        raw?.packageSnapshot?.finalPriceAtBooking ??
        0
    ) || 0
  );
  const normalizedType = normalizeBookingPaymentType(raw?.paymentType);
  const hasExplicitPaid = Number.isFinite(Number(raw?.paidAmount));
  const explicitPaid = hasExplicitPaid ? Number(raw?.paidAmount) : NaN;
  const status = String(raw?.status || "").trim().toLowerCase();
  const isRevenueStatus = status === "confirmed" || status === "completed";

  let paymentType: BookingPaymentType = normalizedType || (isRevenueStatus ? "full" : "partial");
  let paidAmount: number;
  if (hasExplicitPaid) {
    paidAmount = Math.max(0, Math.min(totalAmount, explicitPaid));
  } else if (paymentType === "partial") {
    paidAmount = 0;
  } else {
    paidAmount = isRevenueStatus ? totalAmount : 0;
  }

  if (paymentType === "full") {
    paidAmount = isRevenueStatus ? totalAmount : Math.max(0, Math.min(totalAmount, paidAmount));
  } else {
    paymentType = paidAmount >= totalAmount ? "full" : "partial";
  }

  return {
    paymentType,
    paidAmount: round2(Math.max(0, Math.min(totalAmount, paidAmount))),
    remainingAmount: round2(Math.max(0, totalAmount - paidAmount)),
    totalAmount: round2(totalAmount),
  };
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

function paymentTypeLabel(type: BookingPaymentType): string {
  return type === "partial" ? "\u0639\u0631\u0628\u0648\u0646" : "\u0643\u0627\u0645\u0644";
}

function buildPaymentSummaryRows(meta?: BookingMeta): PaymentSummaryRow[] {
  if (!meta) return [];
  const paid = round2(meta.paidAmount);
  const remaining = round2(meta.remainingAmount);
  const rows: PaymentSummaryRow[] = [];
  if (paid > 0) rows.push({ kind: "paid", label: "\u062f\u0641\u0639\u062a", value: paid });
  if (remaining > 0) rows.push({ kind: "remaining", label: "\u0627\u0644\u0645\u062a\u0628\u0642\u064a", value: remaining });
  return rows;
}

function buildPaymentSummary(meta?: BookingMeta): string {
  if (!meta) return "";
  const rows = buildPaymentSummaryRows(meta);
  const typeText = paymentTypeLabel(meta.paymentType);
  if (!rows.length) return typeText;
  const rowsText = rows.map((r) => `${r.label} ${round2(r.value)} \u0631.\u0633`).join(" - ");
  return `${typeText} - ${rowsText}`;
}

function resolveDisplayClientName(item: IncomeItem, meta?: BookingMeta): string {
  const fromMeta = String(meta?.clientName || "").trim();
  if (fromMeta) return fromMeta;

  const raw = item as any;
  const fromIncome = String(
    raw?.clientName || raw?.customerName || raw?.name || raw?.client?.name || raw?.customer?.name || ""
  ).trim();
  if (fromIncome) return fromIncome;

  return "عميلة غير محددة";
}

function resolveDisplayBookingRef(item: IncomeItem, meta?: BookingMeta): string {
  const fromMeta = String(meta?.bookingRef || "").trim();
  if (fromMeta && fromMeta !== "-") return fromMeta;

  const bookingId = String(item.bookingId || "").trim();
  if (bookingId) return toBookingRef(bookingId);

  const kind = sourceKind(item.source || "");
  if (kind === "manual" || kind === "invoice" || kind === "refund" || kind === "other") {
    return "بدون حجز";
  }
  if (kind === "internal") return "حجز داخلي";
  return "غير متوفر";
}

function resolveDisplayNoteText(item: IncomeItem, noteText: string): string {
  if (noteText) return noteText;
  const kind = sourceKind(item.source || "");
  if (kind === "booking") return "سجل حجز بدون ملاحظة";
  if (kind === "invoice") return "فاتورة بدون ملاحظة";
  if (kind === "internal") return "دفع داخلي بدون ملاحظة";
  if (kind === "manual") return "دخل يدوي بدون ملاحظة";
  if (kind === "refund") return "استرجاع بدون ملاحظة";
  return "بدون ملاحظة";
}

function buildFallbackPaymentSummaryText(item: IncomeItem, amountToShow: number): string {
  const signedAmount = round2(Number(amountToShow || item.amount || 0));
  const absAmount = Math.abs(signedAmount);
  const kind = sourceKind(item.source || "");
  if (kind === "refund" || signedAmount < 0) return `استرجاع ${absAmount.toFixed(2)} ر.س`;
  return `مدفوع ${absAmount.toFixed(2)} ر.س`;
}

function toCsv(items: IncomeItem[]) {
  const header = ["date", "amount", "method", "source", "note", "id"].join(",");
  const lines = items.map((x) =>
    [
      x.date,
      x.amount,
      methodLabel(x.method),
      sourceLabel(x.source || "").replaceAll(",", " "),
      (x.note || "").replaceAll(",", " "),
      String(x.id || ""),
    ].join(",")
  );
  return [header, ...lines].join("\n");
}

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadBookings(): any[] {
  try {
    const raw = localStorage.getItem(ALL_BOOKINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

function normalizeConfirmedPaymentMethod(raw: any): "cash" | "card" | "transfer" | "mixed" | null {
  const m = normalizePaymentMethod(raw);
  if (m === "cash" || m === "card" || m === "transfer" || m === "mixed") return m;
  return null;
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

function firebaseMsg(e: any) {
  const msg = String(e?.message || e || "");
  if (msg.includes("Missing or insufficient permissions"))
    return "⚠️ لا توجد صلاحيات كافية.";
  if (msg.includes("not-found")) return "⚠️ المسار غير موجود.";
  if (msg.includes("requires an index")) return "⚠️ الاستعلام يحتاج Index.";
  return "تعذر تنفيذ العملية.";
}

export default function DashboardIncome() {
  const [items, setItems] = useState<IncomeItem[]>([]);
  const [bookingMetaById, setBookingMetaById] = useState<Record<string, BookingMeta>>({});
  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [modalMsg, setModalMsg] = useState("");

  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [source, setSource] = useState("يدوي");
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

  // Filters
  const [q, setQ] = useState("");
  const [fMethod, setFMethod] = useState<PaymentMethod | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const editLinkedBookingId = editTarget ? resolveLinkedBookingId(editTarget) : "";
  const editBookingMeta = editLinkedBookingId ? bookingMetaById[editLinkedBookingId] : undefined;
  const editIsRefund = editTarget ? isRefundIncomeRow(editTarget) : false;
  const editCanAdjustPayment = !!editLinkedBookingId && !editIsRefund;

  const refresh = async () => {
    try {
      setLoading(true);
      const [incomeRows, bookingRows] = await Promise.all([listAllIncomeFS(), listAllBookings()]);
      const bookingMap = bookingRows.reduce(
        (acc, b: any) => {
          const payment = resolveBookingPayment(b);
          acc[String(b.id)] = {
            bookingRef: toBookingRef(String(b.publicId || "")),
            clientName: String(
              b.clientName || b.customerName || b.name || b.client?.name || b.customer?.name || ""
            ).trim(),
            paymentType: payment.paymentType,
            paidAmount: payment.paidAmount,
            remainingAmount: payment.remainingAmount,
            totalAmount: payment.totalAmount,
          };
          return acc;
        },
        {} as Record<string, BookingMeta>
      );
      setItems(incomeRows);
      setBookingMetaById(bookingMap);
    } catch (e) {
      setModalMsg(firebaseMsg(e));
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
          if (mounted) setModalMsg("سجّل دخول الإدارة أولاً");
          return;
        }

        const role = await resolveRoleFromFirestore(user.uid);
        if (mounted) setUiRole(role);

        const data = await listAllIncomeFS();

        // ✅ Migration (once)
        const migrated = localStorage.getItem(INCOME_MIGRATED_KEY) === "1";
        if (!migrated && data.length === 0) {
          const legacy = loadLegacyIncome();
          if (legacy.length) {
            for (const it of legacy) {
              await upsertIncomeFS(it);
            }
          }
          localStorage.setItem(INCOME_MIGRATED_KEY, "1");
        } else if (!migrated) {
          localStorage.setItem(INCOME_MIGRATED_KEY, "1");
        }

        const [finalData, bookingRows] = await Promise.all([listAllIncomeFS(), listAllBookings()]);
        const bookingMap = bookingRows.reduce(
          (acc, b: any) => {
            const payment = resolveBookingPayment(b);
            acc[String(b.id)] = {
              bookingRef: toBookingRef(String(b.publicId || "")),
              clientName: String(
                b.clientName || b.customerName || b.name || b.client?.name || b.customer?.name || ""
              ).trim(),
              bookingDate: normalizeISODate(b?.date),
              paymentType: payment.paymentType,
              paidAmount: payment.paidAmount,
              remainingAmount: payment.remainingAmount,
              totalAmount: payment.totalAmount,
            };
            return acc;
          },
          {} as Record<string, BookingMeta>
        );
        if (mounted) {
          setItems(finalData);
          setBookingMetaById(bookingMap);
        }
      } catch (e) {
        if (mounted) setModalMsg(firebaseMsg(e));
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
      const paymentSummary = buildPaymentSummary(bm);
      const noteText = formatIncomeNote(x.note);
      const effectiveAmount = bm ? Number(bm.paidAmount || 0) : Number(x.amount || 0);
      const a =
        `${effectiveDate} ${effectiveAmount} ${sourceLabel(x.source || "")} ${x.note || ""} ${noteText} ${
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

  const rowEffectiveAmount = (item: IncomeItem) => {
    const bm = rowBookingMeta(item);
    return bm ? Number(bm.paidAmount || 0) : Number(item.amount || 0);
  };

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
    if (!date || !n || n <= 0) return setModalMsg("بيانات غير صحيحة");
    if (!reason) return setModalMsg("سبب/مرجع الدخل مطلوب");

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
      await upsertIncomeFS(item);
      const next = await listAllIncomeFS();
      setItems(next);
      setAddOpen(false);
      setAmount("");
      setNote("");
      setModalMsg("");
    } catch (e) {
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const openDeleteIncomeModal = (item: IncomeItem) => {
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
    if (String(deletePin).trim() !== INCOME_EDIT_PIN) {
      setDeleteError("الرقم السري غير صحيح");
      return;
    }

    try {
      setLoading(true);
      setDeleteError("");
      await removeIncomeFS(String(deleteTarget.id));
      const next = await listAllIncomeFS();
      setItems(next);
      setDeleteOpen(false);
      setDeleteTarget(null);
      setDeletePin("");
      setDeleteError("");
      setModalMsg("تم حذف سجل الإيراد");
    } catch (e) {
      setDeleteError(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const openEditIncomeModal = (item: IncomeItem) => {
    const linkedBookingId = resolveLinkedBookingId(item);
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
      setEditError("الرقم السري غير صحيح");
      return;
    }

    const bookingId = resolveLinkedBookingId(editTarget);
    const canAdjustPayment = !!bookingId && !isRefundIncomeRow(editTarget);

    try {
      setLoading(true);
      setEditError("");

      if (canAdjustPayment) {
        const totalAmountRaw = parseMoneyInput(editBookingTotal);
        if (!Number.isFinite(totalAmountRaw) || totalAmountRaw <= 0) {
          setEditError("إجمالي الحجز غير صحيح.");
          return;
        }
        const totalAmount = round2(totalAmountRaw);

        let paymentType: BookingPaymentType = editPaymentType === "partial" ? "partial" : "full";
        let paidAmount =
          paymentType === "full" ? totalAmount : parseMoneyInput(editPaidAmount);

        if (paymentType === "partial") {
          if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
            setEditError("مبلغ العربون غير صحيح.");
            return;
          }
          if (paidAmount > totalAmount) {
            setEditError("مبلغ العربون لا يمكن أن يتجاوز إجمالي الحجز.");
            return;
          }
        }

        if (!Number.isFinite(paidAmount) || paidAmount < 0) {
          setEditError("المبلغ المدفوع غير صحيح.");
          return;
        }

        if (paidAmount >= totalAmount) {
          paymentType = "full";
          paidAmount = totalAmount;
        }

        const paidRounded = round2(Math.max(0, Math.min(totalAmount, paidAmount)));
        const remainingAmount = round2(Math.max(0, totalAmount - paidRounded));

        if (getDataSourceFlags().useCoreD1) {
          await Promise.all([
            upsertIncomeFS({
              ...editTarget,
              amount: paidRounded,
              createdAt: Number(editTarget.createdAt) || Date.now(),
            }),
            CoreBookingService.patch(bookingId, {
              subtotalHalalas: Math.round(totalAmount * 100),
              totalHalalas: Math.round(totalAmount * 100),
              paymentStatus: paymentType === "full" ? "paid" : "partial",
            }),
          ]);
        } else {
          await Promise.all([
            upsertIncomeFS({
              ...editTarget,
              amount: paidRounded,
              createdAt: Number(editTarget.createdAt) || Date.now(),
            }),
            setDoc(
              doc(db, "salons", "main", "bookings", bookingId),
              {
                total: totalAmount,
                finalPrice: totalAmount,
                paymentType,
                paidAmount: paidRounded,
                remainingAmount,
                updatedAt: serverTimestamp(),
                amountEditedFromIncome: true,
                amountEditedAt: serverTimestamp(),
              },
              { merge: true }
            ),
            setDoc(
              doc(db, "salons", "main", "booking_tracks", bookingId),
              {
                total: totalAmount,
                finalPrice: totalAmount,
                paymentType,
                paidAmount: paidRounded,
                remainingAmount,
                updatedAt: serverTimestamp(),
                amountEditedFromIncome: true,
                amountEditedAt: serverTimestamp(),
              },
              { merge: true }
            ),
          ]);
        }

        await refresh();
        setModalMsg("تم تعديل طريقة الدفع وتحديث الإيراد");
      } else {
        const nextAmountRaw = parseMoneyInput(editAmount);
        if (!Number.isFinite(nextAmountRaw) || nextAmountRaw <= 0) {
          setEditError("المبلغ غير صحيح.");
          return;
        }

        const nextAmount = round2(nextAmountRaw);
        await upsertIncomeFS({
          ...editTarget,
          amount: nextAmount,
          createdAt: Number(editTarget.createdAt) || Date.now(),
        });
        const next = await listAllIncomeFS();
        setItems(next);
        setModalMsg("تم تعديل المبلغ");
      }

      setEditOpen(false);
      setEditTarget(null);
      setEditPin("");
      setEditError("");
    } catch (e) {
      setEditError(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = () => {
    const csvRows = filtered.map((x) => ({ ...x, date: rowEffectiveDate(x) }));
    const csv = toCsv(csvRows);
    downloadTextFile(`income_${todayISO()}.csv`, csv);
  };

  const canFixPaymentMethods = uiRole === "owner" || uiRole === "admin";

  const fixPaymentMethods = async () => {
    if (getDataSourceFlags().useCoreD1) {
      setModalMsg("إصلاح طرق الدفع القديمة مخصص لمسار Firestore قبل النقل فقط؛ مدفوعات D1 محفوظة كسجلات مستقلة.");
      return;
    }
    if (!canFixPaymentMethods) {
      setModalMsg("هذه العملية تتطلب صلاحية Owner/Admin.");
      return;
    }

    try {
      setLoading(true);

      const bookings = await listAllBookings();
      const targets = bookings.filter((b: any) => {
        const status = String(b?.status || "").toLowerCase().trim();
        if (!(status === "confirmed" || status === "completed")) return false;
        const method = normalizeConfirmedPaymentMethod((b as any)?.paymentMethod);
        return !method || method === "cash";
      });

      await Promise.all(
        targets.map(async (b: any) => {
          const id = String(b?.id || "").trim();
          if (!id) return;
          await setDoc(
            doc(db, "salons", "main", "bookings", id),
            {
              paymentMethod: "transfer",
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
          await setDoc(
            doc(db, "salons", "main", "booking_tracks", id),
            {
              paymentMethod: "transfer",
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        })
      );

      await refresh();
      setModalMsg(`تم إصلاح ${targets.length} حجز: تم تعيين paymentMethod = transfer.`);
    } catch (e) {
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-section income-page">
      <div className="income-container">
        {/* Header */}
        <div className="income-header">
          <div className="income-title-block qs-black">
            <h2 className="income-title">الإيرادات</h2>
            <p className="income-subtitle">
              إدارة وتسجيل الإيرادات اليومية
            </p>
          </div>

          <div className="income-actions">
            {canFixPaymentMethods && (
              <button
                className="dash-pill dash-pill-outline"
                onClick={fixPaymentMethods}
                type="button"
                disabled={loading}
                title="إصلاح طرق الدفع"
              >
                إصلاح طرق الدفع
              </button>
            )}
            <button
              className="dash-pill dash-pill-outline"
              onClick={refresh}
              type="button"
              disabled={loading}
              title="تحديث"
            >
              <FontAwesomeIcon icon={faRotate} /> تحديث
            </button>

            <button
              className="dash-pill dash-pill-outline"
              onClick={exportCsv}
              type="button"
              disabled={!filtered.length}
              title="تصدير CSV"
            >
              <FontAwesomeIcon icon={faFileCsv} /> تصدير CSV
            </button>

            <button
              className="dash-pill dash-pill-primary"
              onClick={() => setAddOpen(true)}
              type="button"
            >
              <FontAwesomeIcon icon={faPlus} /> إضافة دخل
            </button>
          </div>
        </div>

        {/* Quick Stat */}
        {/* INCOME_INLINE_STATS_FIX */}
        <style>{`
          @media (max-width: 900px) {
            .income-page .income-container {
              width: 100% !important;
              max-width: 100% !important;
              min-width: 0 !important;
              padding-inline: 10px !important;
              overflow-x: hidden !important;
              box-sizing: border-box !important;
            }

            .income-page .income-quick {
              width: 100% !important;
              max-width: 100% !important;
              min-width: 0 !important;

              display: grid !important;
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
              gap: 8px !important;

              margin: 10px 0 0 !important;
              padding: 0 !important;

              overflow: hidden !important;
              overflow-x: hidden !important;
              box-sizing: border-box !important;
            }

            .income-page .income-quick > .stat-card {
              width: 100% !important;
              max-width: 100% !important;
              min-width: 0 !important;

              height: 78px !important;
              min-height: 78px !important;

              margin: 0 !important;
              padding: 9px !important;

              flex: none !important;
              grid-column: auto !important;

              overflow: hidden !important;
              box-sizing: border-box !important;
              border-radius: 14px !important;
            }

            .income-page .income-quick .stat-info {
              width: 100% !important;
              min-width: 0 !important;
              max-width: 100% !important;
            }

            .income-page .income-quick .stat-info h3 {
              width: 100% !important;
              margin: 0 !important;
              overflow: hidden !important;

              color: #101a39 !important;
              -webkit-text-fill-color: #101a39 !important;

              font-size: 11px !important;
              line-height: 1.25 !important;

              text-overflow: ellipsis !important;
              white-space: nowrap !important;
            }

            .income-page .income-quick .stat-info p {
              width: 100% !important;
              margin: 4px 0 0 !important;
              overflow: hidden !important;

              color: #68758a !important;
              -webkit-text-fill-color: #68758a !important;

              font-size: 8px !important;

              text-overflow: ellipsis !important;
              white-space: nowrap !important;
            }
          }
        `}</style>
        <div className="income-quick">
          <div className="stat-card stat-card-total">
            <div className="stat-info">
              <h3>{total.toLocaleString()} ريال</h3>
              <p>الإجمالي (حسب الفلترة)</p>
            </div>
          </div>

          <div className="stat-card stat-card-cash">
            <div className="stat-info">
              <h3>{totalCash.toLocaleString()} ريال</h3>
              <p>كاش</p>
            </div>
          </div>

          <div className="stat-card stat-card-card">
            <div className="stat-info">
              <h3>{totalCard.toLocaleString()} ريال</h3>
              <p>شبكة</p>
            </div>
          </div>

          <div className="stat-card stat-card-transfer">
            <div className="stat-info">
              <h3>{totalTransfer.toLocaleString()} ريال</h3>
              <p>تحويل</p>
            </div>
          </div>

          <div className="stat-card stat-card-other">
            <div className="stat-info">
              <h3>{totalOtherIncome.toLocaleString()} ريال</h3>
              <p>دخل آخر</p>
            </div>
          </div>

          <div className="stat-card stat-card-refund">
            <div className="stat-info">
              <h3>{totalRefund.toLocaleString()} ريال</h3>
              <p>إجمالي الاسترجاع</p>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="income-filters">
          <div className="income-filter-head">
            <div className="income-filter-title">
              <FontAwesomeIcon icon={faFilter} /> فلترة وبحث
            </div>
          </div>

          <div className="income-filter-grid">
            <div className="income-input">
              <div className="income-input__icon">
                <FontAwesomeIcon icon={faSearch} />
              </div>
              <input
                id="income_filters_search"
                name="income_filters_search"
                type="search"
                className="form-control"
                placeholder="بحث (المصدر / الملاحظة / المبلغ / المعرف...)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>

            <select
              className="form-control"
              value={fMethod}
              onChange={(e) => setFMethod(e.target.value as any)}
            >
              <option value="all">كل طرق الدفع</option>
              <option value="cash">كاش</option>
              <option value="card">شبكة</option>
              <option value="transfer">تحويل</option>
              <option value="mixed">مختلط</option>
              <option value="other">أخرى</option>
            </select>

            <input
              type="date"
              className="form-control"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="من"
            />

            <input
              type="date"
              className="form-control"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="إلى"
            />
          </div>
        </div>

        {/* Table */}
        <div className="income-table-wrap">
          <div className="income-table-head">
            <div className="income-table-count">
              السجلات: {filtered.length.toLocaleString()}
            </div>
            {loading && (
              <div className="income-table-loading">...جاري التحميل</div>
            )}
          </div>

          <div className="income-table-responsive">
            <table className="income-table">
              <thead>
                <tr>
                  <th className="income-col-date">التاريخ</th>
                  <th className="income-col-amount">المبلغ</th>
                  <th className="income-col-method">الدفع</th>
                  <th className="income-col-client">العميلة</th>
                  <th className="income-col-booking">رقم الحجز</th>
                  <th className="income-col-source">المصدر</th>
                  <th className="income-col-note">ملاحظة</th>
                  <th className="income-col-payment-summary">ملخص الدفع</th>
                  <th className="income-col-actions">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="income-empty-cell">
                      لا يوجد بيانات مطابقة للفترة الحالية.
                    </td>
                  </tr>
                ) : (
                  filtered.map((x) => {
                    const bookingMeta = rowBookingMeta(x);
                    const paymentSummaryRows = buildPaymentSummaryRows(bookingMeta);
                    const amountToShow = rowEffectiveAmount(x);
                    const noteText = formatIncomeNote(x.note);
                    const noteClass = `income-note-primary${isSystemIncomeNote(x.note) ? " income-note-primary-system" : ""}`;
                    const srcKind = sourceKind(x.source || "");
                    const hasPaymentSummary = paymentSummaryRows.length > 0;
                    const displayClientName = resolveDisplayClientName(x, bookingMeta);
                    const displayBookingRef = resolveDisplayBookingRef(x, bookingMeta);
                    const displayNoteText = resolveDisplayNoteText(x, noteText);
                    const fallbackPaymentSummaryText = buildFallbackPaymentSummaryText(x, amountToShow);
                    const fallbackPaymentSummaryClass =
                      srcKind === "refund" || Number(amountToShow) < 0
                        ? "income-payment-line-remaining"
                        : "income-payment-line-paid";
                    return (
                      <tr key={x.id} className={"income-row income-row-" + x.method}>
                        <td className="income-col-date income-date">{rowEffectiveDate(x)}</td>
                        <td className="income-col-amount">
                          <span className="income-amount">
                            {(Number(amountToShow) || 0).toLocaleString()} ريال
                          </span>
                        </td>
                        <td className="income-col-method">
                          <div className="income-method-cell">
                            <span className={"income-method-badge " + x.method}>{methodLabel(x.method)}</span>
                            {bookingMeta ? (
                              <span className={`income-pay-kind ${bookingMeta.paymentType}`}>
                                {paymentTypeLabel(bookingMeta.paymentType)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="income-col-client">
                          <span className="income-client-text">{displayClientName}</span>
                        </td>
                        <td className="income-col-booking">
                          <span className="income-booking-text">{displayBookingRef}</span>
                        </td>
                        <td className="income-col-source">
                          <div className="income-source-cell">
                            <span className={`income-source-badge ${srcKind}`}>
                              {sourceLabel(x.source || "")}
                            </span>
                          </div>
                        </td>
                        <td className="income-col-note">
                          <div className="income-note-text">
                            <span className={noteText ? noteClass : "income-note-primary"}>{displayNoteText}</span>
                          </div>
                        </td>
                        <td className="income-col-payment-summary">
                          <div className="income-payment-summary-cell">
                            {hasPaymentSummary ? (
                              <span className="income-payment-summary">
                                {paymentSummaryRows.map((row) => (
                                  <span
                                    key={row.kind}
                                    className={`income-payment-line income-payment-line-${row.kind}`}
                                  >
                                    {row.label} {row.value.toFixed(2)} ر.س
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span
                                className={`income-payment-line ${fallbackPaymentSummaryClass}`}
                              >
                                {fallbackPaymentSummaryText}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="income-col-actions income-actions-cell">
                          <div className="income-row-actions">
                            <button
                              className="dash-icon-btn qs-black income-edit-btn"
                              type="button"
                              title="تعديل المبلغ"
                              onClick={() => openEditIncomeModal(x)}
                              disabled={loading}
                            >
                              <FontAwesomeIcon icon={faPen} />
                            </button>
                            <button
                              className="dash-icon-btn qs-black income-delete-btn"
                              type="button"
                              title="حذف"
                              onClick={() => openDeleteIncomeModal(x)}
                              disabled={loading}
                            >
                              <FontAwesomeIcon icon={faTrash} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="income-mobile-list">
            {filtered.length === 0 ? (
              <div className="income-mobile-empty">
                لا يوجد بيانات مطابقة للفترة الحالية.
              </div>
            ) : (
              filtered.map((x) => {
                const bookingMeta = rowBookingMeta(x);
                const paymentSummaryRows = buildPaymentSummaryRows(bookingMeta);
                const amountToShow = rowEffectiveAmount(x);
                const noteText = formatIncomeNote(x.note);
                const noteClass = `income-note-primary${isSystemIncomeNote(x.note) ? " income-note-primary-system" : ""}`;
                const srcKind = sourceKind(x.source || "");
                const hasPaymentSummary = paymentSummaryRows.length > 0;
                const displayClientName = resolveDisplayClientName(x, bookingMeta);
                const displayBookingRef = resolveDisplayBookingRef(x, bookingMeta);
                const displayNoteText = resolveDisplayNoteText(x, noteText);
                const fallbackPaymentSummaryText = buildFallbackPaymentSummaryText(x, amountToShow);
                const fallbackPaymentSummaryClass =
                  srcKind === "refund" || Number(amountToShow) < 0
                    ? "income-payment-line-remaining"
                    : "income-payment-line-paid";
                return (
                  <article className="income-mobile-card" key={"mob_" + x.id}>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">التاريخ</span>
                      <span className="income-mobile-value income-mobile-value--date">{rowEffectiveDate(x)}</span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">المبلغ</span>
                      <span className="income-mobile-value income-mobile-amount">
                        {(Number(amountToShow) || 0).toLocaleString()} ريال
                      </span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">الدفع</span>
                      <span className="income-mobile-value">
                        <span className="income-method-cell">
                          <span className={"income-method-badge " + x.method}>{methodLabel(x.method)}</span>
                          {bookingMeta ? (
                            <span className={`income-pay-kind ${bookingMeta.paymentType}`}>
                              {paymentTypeLabel(bookingMeta.paymentType)}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">العميلة</span>
                      <span className="income-mobile-value">{displayClientName}</span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">رقم الحجز</span>
                      <span className="income-mobile-value">{displayBookingRef}</span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">المصدر</span>
                      <span className="income-mobile-value income-source-cell">
                        <span className={`income-source-badge ${srcKind}`}>
                          {sourceLabel(x.source || "")}
                        </span>
                      </span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">ملاحظة</span>
                      <span className="income-mobile-value">
                        <span className={noteText ? noteClass : "income-note-primary"}>{displayNoteText}</span>
                      </span>
                    </div>
                    <div className="income-mobile-row">
                      <span className="income-mobile-label">ملخص الدفع</span>
                      <span className="income-mobile-value">
                        {hasPaymentSummary ? (
                          <span className="income-payment-summary">
                            {paymentSummaryRows.map((row) => (
                              <span
                                key={row.kind}
                                className={`income-payment-line income-payment-line-${row.kind}`}
                              >
                                {row.label} {row.value.toFixed(2)} ر.س
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className={`income-payment-line ${fallbackPaymentSummaryClass}`}>
                            {fallbackPaymentSummaryText}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="income-mobile-actions">
                      <button
                        className="dash-pill dash-pill-outline income-mobile-edit"
                        type="button"
                        title="تعديل المبلغ"
                        onClick={() => openEditIncomeModal(x)}
                        disabled={loading}
                      >
                        <FontAwesomeIcon icon={faPen} /> تعديل
                      </button>
                      <button
                        className="dash-pill dash-pill-outline income-mobile-delete"
                        type="button"
                        title="حذف"
                        onClick={() => openDeleteIncomeModal(x)}
                        disabled={loading}
                      >
                        <FontAwesomeIcon icon={faTrash} /> حذف
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>

        {/* Errors */}
        {modalMsg && <p style={{ color: "red", marginTop: 12 }}>{modalMsg}</p>}
      </div>

      {/* ✅ Modal (Scoped to Income CSS) */}
      {addOpen && (
        <Modal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          ariaLabel="إضافة دخل"
          panelClassName="income-page-modal__card"
          size="sm"
        >
            <div className="income-page-modal__head">
              <div className="income-page-modal__title">إضافة دخل</div>
              <button
                className="income-modal-close-btn"
                onClick={() => setAddOpen(false)}
                type="button"
              >
                إغلاق
              </button>
            </div>

            <div className="income-page-modal__body">
              <div className="income-modal-grid">
                <label className="income-modal-field">
                  <span>التاريخ</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="income-modal-input"
                  />
                </label>

                <label className="income-modal-field">
                  <span>المبلغ (ر.س)</span>
                  <input
                    type="number"
                    placeholder="أدخلي المبلغ"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="income-modal-input"
                  />
                </label>

                <label className="income-modal-field">
                  <span>طريقة السداد</span>
                  <select
                    className="income-modal-input"
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    <option value="cash">كاش</option>
                    <option value="card">شبكة</option>
                    <option value="transfer">تحويل</option>
                    <option value="mixed">مختلط</option>
                    <option value="other">أخرى</option>
                  </select>
                </label>

                <label className="income-modal-field">
                  <span>المصدر</span>
                  <input
                    type="text"
                    placeholder="مثال: بيع منتج / تعديل يدوي"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="income-modal-input"
                    list="income_source_options"
                  />
                  <datalist id="income_source_options">
                    <option value="\u064a\u062f\u0648\u064a" />
                    <option value={OTHER_INCOME_LABEL} />
                  </datalist>
                </label>

                <label className="income-modal-field">
                  <span>سبب/مرجع (إلزامي)</span>
                  <input
                    type="text"
                    placeholder="مثال: بيع منتج، عربون، تعديل يدوي"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="income-modal-input"
                  />
                </label>
              </div>

              <div className="income-modal-actions">
                <button
                  className="income-modal-btn income-modal-btn--primary"
                  onClick={addIncome}
                  type="button"
                  disabled={loading}
                >
                  حفظ
                </button>

                <button
                  className="income-modal-btn income-modal-btn--secondary"
                  onClick={() => setAddOpen(false)}
                  type="button"
                  disabled={loading}
                >
                  إلغاء
                </button>
              </div>
            </div>
        </Modal>
      )}

      {editOpen && editTarget && (
        <Modal
          open={editOpen}
          onClose={closeEditIncomeModal}
          ariaLabel="تعديل دخل"
          panelClassName="income-page-modal__card"
          size="sm"
        >
          <div className="income-page-modal__head">
            <div className="income-page-modal__title">
              {editCanAdjustPayment ? "تعديل الدفع للحجز" : "تعديل مبلغ الدخل"}
            </div>
            <button
              className="income-modal-close-btn"
              onClick={closeEditIncomeModal}
              type="button"
              disabled={loading}
            >
              إغلاق
            </button>
          </div>

          <div className="income-page-modal__body">
            {editCanAdjustPayment ? (
              <div className="income-edit-booking-hint">
                <span>رقم الحجز: {editBookingMeta?.bookingRef || editLinkedBookingId || "-"}</span>
                <span>العميلة: {editBookingMeta?.clientName || "-"}</span>
              </div>
            ) : null}

            <div className="income-modal-grid">
              <label className="income-modal-field">
                <span>الرقم السري</span>
                <input
                  type="password"
                  placeholder="أدخلي الرقم السري"
                  value={editPin}
                  onChange={(e) => setEditPin(e.target.value)}
                  className="income-modal-input"
                  disabled={loading}
                  autoComplete="new-password"
                  name="income_edit_pin"
                  inputMode="numeric"
                  data-lpignore="true"
                />
              </label>

              {editCanAdjustPayment ? (
                <>
                  <label className="income-modal-field">
                    <span>إجمالي الحجز (ر.س)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={editBookingTotal}
                      onChange={(e) => setEditBookingTotal(e.target.value)}
                      className="income-modal-input"
                      disabled={loading}
                    />
                  </label>

                  <label className="income-modal-field">
                    <span>نوع الدفع</span>
                    <select
                      className="income-modal-input"
                      value={editPaymentType}
                      onChange={(e) => setEditPaymentType(e.target.value as BookingPaymentType)}
                      disabled={loading}
                    >
                      <option value="full">دفع كامل</option>
                      <option value="partial">عربون</option>
                    </select>
                  </label>

                  {editPaymentType === "partial" ? (
                    <label className="income-modal-field">
                      <span>المبلغ المدفوع (ر.س)</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={editPaidAmount}
                        onChange={(e) => setEditPaidAmount(e.target.value)}
                        className="income-modal-input"
                        disabled={loading}
                      />
                    </label>
                  ) : null}

                  <div className="income-edit-summary">
                    {(() => {
                      const total = round2(Math.max(0, parseMoneyInput(editBookingTotal)));
                      const paidRaw =
                        editPaymentType === "full" ? total : Math.max(0, parseMoneyInput(editPaidAmount));
                      const paid = round2(Math.min(total, paidRaw));
                      const remaining = round2(Math.max(0, total - paid));
                      return `دفعت ${paid} ر.س - المتبقي ${remaining} ر.س`;
                    })()}
                  </div>
                </>
              ) : (
                <label className="income-modal-field">
                  <span>المبلغ الجديد (ر.س)</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    className="income-modal-input"
                    disabled={loading}
                  />
                </label>
              )}
            </div>

            {editError ? <div className="income-edit-error">{editError}</div> : null}

            <div className="income-modal-actions">
              <button
                className="income-modal-btn income-modal-btn--primary"
                onClick={saveEditedIncome}
                type="button"
                disabled={loading}
              >
                {loading ? "جاري الحفظ..." : "حفظ التعديل"}
              </button>

              <button
                className="income-modal-btn income-modal-btn--secondary"
                onClick={closeEditIncomeModal}
                type="button"
                disabled={loading}
              >
                إلغاء
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteOpen && deleteTarget && (
        <Modal
          open={deleteOpen}
          onClose={closeDeleteIncomeModal}
          ariaLabel="حذف دخل"
          panelClassName="income-page-modal__card"
          size="sm"
        >
          <div className="income-page-modal__head">
            <div className="income-page-modal__title">تأكيد حذف سجل الإيراد</div>
            <button
              className="income-modal-close-btn"
              onClick={closeDeleteIncomeModal}
              type="button"
              disabled={loading}
            >
              إغلاق
            </button>
          </div>

          <div className="income-page-modal__body">
            <div className="income-edit-booking-hint">
              <span>التاريخ: {deleteTarget.date || "-"}</span>
              <span>المبلغ: {Number(deleteTarget.amount || 0).toLocaleString()} ر.س</span>
              <span>المصدر: {sourceLabel(deleteTarget.source || "")}</span>
            </div>

            <div className="income-modal-grid">
              <label className="income-modal-field">
                <span>الرقم السري للحذف</span>
                <input
                  type="password"
                  placeholder="أدخلي الرقم السري"
                  value={deletePin}
                  onChange={(e) => setDeletePin(e.target.value)}
                  className="income-modal-input"
                  disabled={loading}
                  autoComplete="new-password"
                  name="income_delete_pin"
                  inputMode="numeric"
                  data-lpignore="true"
                />
              </label>
            </div>

            {deleteError ? <div className="income-edit-error">{deleteError}</div> : null}

            <div className="income-modal-actions">
              <button
                className="income-modal-btn income-modal-btn--primary"
                onClick={confirmDeleteIncome}
                type="button"
                disabled={loading}
              >
                {loading ? "جاري الحذف..." : "تأكيد الحذف"}
              </button>

              <button
                className="income-modal-btn income-modal-btn--secondary"
                onClick={closeDeleteIncomeModal}
                type="button"
                disabled={loading}
              >
                إلغاء
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// 🔕 silence unused helpers
void loadBookings;
void isRevenueStatus;


