

// ✅ src/pages/DashboardExpenses.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import "../styles/AdminDashboardExpenses.css";
import "../styles/DashboardEnterpriseWorkspaces.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileCsv, faList, faMoneyBillWave, faTriangleExclamation, faWallet } from "@fortawesome/free-solid-svg-icons";
/**
 * ✅ قاعدة الاستيراد:
 * - ستايل الصفحة الأصلي أولاً
 * - نظام مساحات العمل المؤسسي أخيرًا لتوحيد الواجهة
 */
import Modal from "../components/Modal";

import type { Expense, PaymentMethod } from "../types/finance";
import { FinanceSettingsService } from "../services/FinanceSettingsService";
import { AppSettingsService } from "../services/AppSettingsService";
import { listAllBookings } from "../services/firestoreBookings";
import {
  buildPayrollExpenseRowsForMonths,
  PAYROLL_CLOSE_DAY,
  payrollCycleKeyFromDate,
  payrollCycleRangeForMonthKey,
  type StaffPayrollSource,
  type BookingPayrollSource,
} from "../helpers/staffPayroll";

// ✅ Firebase Auth
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";

import { auth, db } from "../services/firebase";

// ✅ Firestore Expenses
import {
  listAllExpensesFS,
  removeExpenseFS,
  upsertExpenseFS,
  countMonthlyExpensesMissingNotesFS, // ✅ إضافة
} from "../services/firestoreExpenses";
import { exportExpensesReportExcel, exportExpensesReportPdf } from "../helpers/reports/exportExpensesReport";

type UiRole = "owner" | "admin" | "staff" | "client" | "guest";

function mapFirestoreRole(raw: unknown): UiRole {
  const role = String(raw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
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

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function money(n: number) {
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 2 }).format(n);
}

function toCsv(rows: Record<string, any>[]) {
  const headers = Object.keys(rows[0] || {});
  const escape = (v: any) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ];
  return lines.join("\n");
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function firebaseMsg(e: any) {
  const msg = String(e?.message || e || "");
  if (msg.includes("Missing or insufficient permissions")) {
    return "⚠️ لا توجد صلاحيات كافية. تأكد من صلاحيات Core D1 وتسجيل الدخول.";
  }
  if (msg.includes("not-found")) {
    return "⚠️ المسار غير موجود. تأكد من اسم الـ collection ومسار السيرفس.";
  }
  if (msg.includes("requires an index")) {
    return "⚠️ الاستعلام يحتاج Index.";
  }
  return "تعذر تنفيذ العملية. راجع Console لمعرفة السبب.";
}

// ✅ LocalStorage Expenses (Migration)
const LEGACY_EXPENSES_KEY = "expenses_v1";
const EXPENSES_MIGRATED_KEY = "expenses_migrated_to_firestore_v1";

function safeUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
}

function loadLegacyExpenses(): Expense[] {
  try {
    const raw = localStorage.getItem(LEGACY_EXPENSES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((x: any) => {
        const amount = Number(x.amount ?? 0);
        const date = String(x.date || "").trim();
        const title = String(x.title || "").trim();
        if (!title || !date || !amount || amount <= 0) return null;

        const item: Expense = {
          id: String(x.id || safeUUID()),
          title,
          category: String(x.category || "أخرى").trim() || "أخرى",
          amount,
          date,
          paymentMethod: (x.paymentMethod || "كاش") as any,
          note: x.note ? String(x.note) : undefined,
          createdAt: Number(x.createdAt || Date.now()),
        };
        return item;
      })
      .filter(Boolean) as Expense[];
  } catch {
    return [];
  }
}

function isIsoDate(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}

function monthKeyFromIsoDate(v: string) {
  return isIsoDate(v) ? String(v).slice(0, 7) : "";
}

function shiftMonthKey(monthKey: string, delta: number): string {
  const s = String(monthKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return "";
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRangeFromMonthKey(monthKey: string): { from: string; to: string } | null {
  const s = String(monthKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  const endDay = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${String(m).padStart(2, "0")}-01`,
    to: `${y}-${String(m).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  };
}

function inIsoDateRange(dateIso: string, fromIso: string, toIso: string): boolean {
  const d = String(dateIso || "").trim();
  const from = String(fromIso || "").trim();
  const to = String(toIso || "").trim();
  if (!isIsoDate(d) || !isIsoDate(from) || !isIsoDate(to)) return false;
  return d >= from && d <= to;
}

function isAutoPayrollExpenseId(id: string) {
  return String(id || "").startsWith("auto_payroll_");
}

function payrollKindFromExpense(e: Expense): "salary" | "overtime" | "manual" {
  const kind = String(e?.payrollKind || "").trim();
  if (kind === "salary" || kind === "overtime") return kind;
  const id = String(e?.id || "").trim();
  if (id.startsWith("auto_payroll_salary_")) return "salary";
  if (id.startsWith("auto_payroll_overtime_")) return "overtime";
  return "manual";
}

function extractStaffNameFromExpenseTitle(title: string): string {
  const t = String(title || "").trim();
  const m = t.match(/^(?:راتب|أوفر تايم)\s+(.+?)\s+\(\d{4}-\d{2}(?:-\d{2})?\)$/);
  if (m?.[1]) return m[1].trim();
  return "";
}

function expenseTypeLabel(e: Expense): string {
  const kind = payrollKindFromExpense(e);
  if (kind === "salary") return "راتب";
  if (kind === "overtime") return "أوفر تايم";
  return "تشغيلي";
}

function expenseEmployeeLabel(e: Expense): string {
  if (payrollKindFromExpense(e) === "manual") return "-";
  const staffName = String(e.staffName || "").trim();
  if (staffName) return staffName;
  const parsed = extractStaffNameFromExpenseTitle(String(e.title || ""));
  return parsed || "-";
}

function expenseSourceLabel(e: Expense): string {
  const kind = payrollKindFromExpense(e);
  if (kind === "salary" || kind === "overtime") return "رواتب";
  const category = String(e.category || "").trim();
  return category || "تشغيل";
}

function normalizeStaffPayrollRows(rows: any[]): StaffPayrollSource[] {
  return (Array.isArray(rows) ? rows : [])
    .map((x) => {
      const id = String(x?.id || "").trim();
      if (!id) return null;
      return {
        id,
        name: String(x?.name || "").trim() || id,
        active: x?.active !== false,
        employmentEndDate: String(x?.employmentEndDate || "").trim() || undefined,
        useCustomWorkingHours: !!x?.useCustomWorkingHours,
        customWorkingHours: x?.customWorkingHours || {},
        customWorkingHourOverrides: Array.isArray(x?.customWorkingHourOverrides)
          ? x.customWorkingHourOverrides
          : [],
        monthlySalary: Number(x?.monthlySalary ?? 0) || 0,
        overtimeMethod:
          String(x?.overtimeMethod || "").trim() === "invoice_percentage"
            ? "invoice_percentage"
            : "hours_from_salary",
        overtimeDaysPerMonth: Number(x?.overtimeDaysPerMonth ?? 30) || 30,
        overtimeBaseHoursPerDay: Number(x?.overtimeBaseHoursPerDay ?? 8) || 8,
        overtimeSeasonBaseHoursPerDay: Number(x?.overtimeSeasonBaseHoursPerDay ?? 6) || 6,
        autoSeasonOvertimeBasis: x?.autoSeasonOvertimeBasis === true,
        overtimeHoursBasis:
          String(x?.overtimeHoursBasis || "").trim() === "season" ? "season" : "regular",
        overtimePercent: Number(x?.overtimePercent ?? 0) || 0,
        overtimeInvoicePercent: Number(x?.overtimeInvoicePercent ?? 0) || 0,
      } as StaffPayrollSource;
    })
    .filter(Boolean) as StaffPayrollSource[];
}

function normalizeBookingPayrollRows(rows: any[]): BookingPayrollSource[] {
  return (Array.isArray(rows) ? rows : [])
    .map((x) => {
      const date = String(x?.date || "").trim();
      if (!isIsoDate(date)) return null;
      return {
        date,
        status: String(x?.status || "").trim().toLowerCase() || "pending",
        amount: Math.max(
          0,
          Number(x?.finalPrice ?? x?.total ?? x?.serviceSnapshot?.priceAtBooking ?? 0) || 0
        ),
        employeeId: String(x?.employeeId || "").trim() || null,
        employeeUid: String(x?.employeeUid || "").trim() || null,
        employeeKey: String(x?.employeeKey || "").trim() || null,
        employeeName: String(x?.employeeName || "").trim() || null,
      } as BookingPayrollSource;
    })
    .filter(Boolean) as BookingPayrollSource[];
}

/* =========================================
   ✅ DashDropdown (مثل DashboardOffers)
========================================= */
type DDOption = { value: string; label: string };

function DashDropdown(props: {
  value: string;
  onChange: (next: string) => void;
  options: DDOption[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const { value, onChange, options, placeholder = "اختر", disabled } = props;

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const label = options.find((o) => o.value === value)?.label || placeholder;

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="dash-dd-wrap" ref={wrapRef}>
      <button
        type="button"
        className="dash-select"
        onClick={() => !disabled && setOpen((s) => !s)}
        aria-expanded={open}
        disabled={disabled}
      >
        {label}
      </button>

      {open && !disabled ? (
        <div className="dash-dd-menu" role="listbox">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`dash-dd-item ${
                value === opt.value ? "is-active" : ""
              }`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const DashboardExpenses: React.FC = () => {
  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [authReady, setAuthReady] = useState(false);
  const allowed = uiRole === "owner" || uiRole === "admin";

  // ✅ settings
  const [categories, setCategories] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // ✅ data (Firestore)
  const [items, setItems] = useState<Expense[]>([]);
  const [autoPayrollItems, setAutoPayrollItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ NEW: كرت تنبيه + فلترة "الناقص ملاحظات"
  const [missingNotesCountFS, setMissingNotesCountFS] = useState(0);
  const [onlyMissingNotes, setOnlyMissingNotes] = useState(false);

  // ✅ Migration state
  const [hasLegacy, setHasLegacy] = useState(false);
  const [legacyCount, setLegacyCount] = useState(0);
  const [migrated, setMigrated] = useState(
    localStorage.getItem(EXPENSES_MIGRATED_KEY) === "1"
  );

  // ✅ Alert modal (بديل alert())
  const [modalMsg, setModalMsg] = useState<string>("");

  // ✅ Confirm modal (بديل confirm())
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title?: string;
    message?: string;
    onConfirm?: () => void;
  }>({ open: false });

  const [recordMode, setRecordMode] = useState<"calendar" | "payroll_cycle">("calendar");
  const [selectedMonthKey, setSelectedMonthKey] = useState(todayISO().slice(0, 7));

  // ✅ form
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("أخرى");
  const [amount, setAmount] = useState<string>("");
  const [date, setDate] = useState(todayISO());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    "كاش" as unknown as PaymentMethod
  );
  const [note, setNote] = useState("");

  // ✅ quick add category
  const [newCategory, setNewCategory] = useState("");

  // ✅ filters
  const [fCategory, setFCategory] = useState("الكل");
  const [fPayment, setFPayment] = useState("الكل");
  const [q, setQ] = useState("");

  // ✅ edit row (داخل المودال)
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    title: string;
    category: string;
    paymentMethod: string;
    amount: string;
    date: string;
    note: string;
  }>({
    title: "",
    category: "أخرى",
    paymentMethod: "كاش",
    amount: "",
    date: todayISO(),
    note: "",
  });

  useEffect(() => {
    const fallbackPays = ["كاش", "شبكة", "تحويل"] as any;

    let unsub: undefined | (() => void);

    (async () => {
      const fs = await FinanceSettingsService.get();

      const cats = (
        fs?.expenseCategories?.length ? fs.expenseCategories : ["أخرى"]
      ) as string[];

      const pays = (
        fs?.paymentMethods?.length ? (fs.paymentMethods as any) : fallbackPays
      ) as PaymentMethod[];

      setCategories(cats);
      setPaymentMethods(pays);

      setCategory((prev) =>
        prev && cats.includes(prev) ? prev : cats[0] || "أخرى"
      );

      setPaymentMethod((prev) => {
        const pv = String(prev || "");
        const ok = pays.some((x) => String(x) === pv);
        return (ok ? prev : (pays[0] as any)) as PaymentMethod;
      });

      // ✅ LIVE updates
      unsub = FinanceSettingsService.subscribe((next) => {
        const cats2 = (
          next?.expenseCategories?.length ? next.expenseCategories : ["أخرى"]
        ) as string[];

        const pays2 = (
          next?.paymentMethods?.length
            ? (next.paymentMethods as any)
            : fallbackPays
        ) as PaymentMethod[];

        setCategories(cats2);
        setPaymentMethods(pays2);

        setCategory((prev) =>
          prev && cats2.includes(prev) ? prev : cats2[0] || "أخرى"
        );

        setPaymentMethod((prev) => {
          const pv = String(prev || "");
          const ok = pays2.some((x) => String(x) === pv);
          return (ok ? prev : (pays2[0] as any)) as PaymentMethod;
        });
      });
    })();

    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ دالة تحميل Firestore
  const loadExpenses = async () => {
    try {
      setLoading(true);
      const data = await listAllExpensesFS();
      const manualItems = Array.isArray(data) ? data : [];
      setItems(manualItems);

      try {
        const [staffSnap, allBookings, appSettings] = await Promise.all([
          getDocs(collection(db, "salons", "main", "staff_public")),
          listAllBookings(),
          AppSettingsService.fetchRemote(),
        ]);

        const staffRows = normalizeStaffPayrollRows(
          staffSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
        );
        const bookingRows = normalizeBookingPayrollRows(allBookings as any[]);
        const monthKeysSet = new Set<string>();
        manualItems.forEach((x) => {
          const mk = monthKeyFromIsoDate(String(x?.date || ""));
          if (mk) monthKeysSet.add(mk);
        });
        bookingRows.forEach((x) => {
          const mk = monthKeyFromIsoDate(String(x?.date || ""));
          if (mk) monthKeysSet.add(mk);
        });
        monthKeysSet.add(todayISO().slice(0, 7));
        const expandedMonthKeys = new Set<string>();
        monthKeysSet.forEach((mk) => {
          expandedMonthKeys.add(mk);
          const prev = shiftMonthKey(mk, -1);
          const next = shiftMonthKey(mk, 1);
          if (prev) expandedMonthKeys.add(prev);
          if (next) expandedMonthKeys.add(next);
        });

        const payrollRows = buildPayrollExpenseRowsForMonths({
          staffList: staffRows,
          bookings: bookingRows,
          appSettings: appSettings || {},
          monthKeys: Array.from(expandedMonthKeys),
        });

        const payrollItems: Expense[] = payrollRows.map((x) => ({
          id: x.id,
          title: x.title,
          category: x.category,
          amount: Number(x.amount || 0),
          date: String(x.date || ""),
          paymentMethod: (x.paymentMethod || "transfer") as PaymentMethod,
          note: String(x.note || "").trim() || undefined,
          createdAt: Number(x.createdAt || Date.now()),
          addedBy: "النظام (رواتب)",
          createdByName: "النظام (رواتب)",
          sourceKind: "auto_payroll",
          sourceType: "payroll",
          sourceRefId: String(x.id || "").trim() || undefined,
          staffId: String(x.staffId || "").trim() || undefined,
          staffName: String(x.staffName || "").trim() || undefined,
          monthKey: String(x.monthKey || "").trim() || undefined,
          payrollKind: x.kind,
        }));
        setAutoPayrollItems(payrollItems);
      } catch (payrollErr) {
        console.warn("auto payroll expenses load error:", payrollErr);
        setAutoPayrollItems([]);
      }

      // ✅ NEW: عداد "بدون ملاحظات" من Firebase (هذا الشهر)
      try {
        const n = await countMonthlyExpensesMissingNotesFS("main");
        setMissingNotesCountFS(Number(n || 0));
      } catch {
        setMissingNotesCountFS(0);
      }
    } catch (e) {
      console.error("listAllExpensesFS error:", e);
      setModalMsg(firebaseMsg(e));
      setItems([]);
      setAutoPayrollItems([]);
    } finally {
      setLoading(false);
    }
  };

  // ✅ تحميل Firestore بعد ثبات تسجيل الدخول (مرة وحدة)
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        if (mounted) setAuthReady(false);
        const user = await new Promise<User | null>(
          (resolve) => {
            const unsub = onAuthStateChanged(auth, (u) => {
              unsub();
              resolve(u);
            });
          }
        );

        if (!user) {
          if (mounted) {
            setUiRole("guest");
            setItems([]);
            setAutoPayrollItems([]);
            setLoading(false);
            setModalMsg("لا يوجد مستخدم مسجل دخول. سجّل دخول الإدارة ثم جرّب.");
            setAuthReady(true);
          }
          return;
        }

        const role = await resolveRoleFromFirestore(user.uid);
        if (mounted) setUiRole(role);

        if (mounted) await loadExpenses();

        try {
          const legacy = loadLegacyExpenses();
          const already = localStorage.getItem(EXPENSES_MIGRATED_KEY) === "1";
          if (mounted) {
            setLegacyCount(legacy.length);
            setHasLegacy(legacy.length > 0);
            setMigrated(already);
          }
        } catch {
          // ignore
        }
      } finally {
        if (mounted) {
          setLoading(false);
          setAuthReady(true);
        }
      }
    };

    run();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allItems = useMemo(() => {
    const merged = new Map<string, Expense>();
    [...items, ...autoPayrollItems].forEach((x) => {
      const id = String(x?.id || "").trim();
      if (!id) return;
      merged.set(id, x);
    });
    return Array.from(merged.values()).sort((a, b) => {
      const d = String(b.date || "").localeCompare(String(a.date || ""));
      if (d !== 0) return d;
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });
  }, [items, autoPayrollItems]);

  const selectedCalendarRange = useMemo(() => {
    const fallbackMonth = todayISO().slice(0, 7);
    return (
      monthRangeFromMonthKey(selectedMonthKey) ||
      monthRangeFromMonthKey(fallbackMonth) || {
        from: todayISO(),
        to: todayISO(),
      }
    );
  }, [selectedMonthKey]);

  const selectedPayrollCycleRange = useMemo(() => {
    return (
      payrollCycleRangeForMonthKey(selectedMonthKey, PAYROLL_CLOSE_DAY) || selectedCalendarRange
    );
  }, [selectedMonthKey, selectedCalendarRange]);

  const activeRange = useMemo(
    () => (recordMode === "payroll_cycle" ? selectedPayrollCycleRange : selectedCalendarRange),
    [recordMode, selectedPayrollCycleRange, selectedCalendarRange]
  );

  const activePayrollCycleKey = useMemo(
    () => payrollCycleKeyFromDate(activeRange.to, PAYROLL_CLOSE_DAY) || selectedMonthKey,
    [activeRange.to, selectedMonthKey]
  );

  const missingNotesInActiveRange = useMemo(
    () =>
      allItems.filter((e) => {
        if (!inIsoDateRange(String(e.date || ""), activeRange.from, activeRange.to)) return false;
        return !String(e.note ?? "").trim();
      }).length,
    [allItems, activeRange.from, activeRange.to]
  );

  // ====== الفلاتر (للسجل الكامل) ======
  const filtered = useMemo(() => {
    const queryText = q.trim().toLowerCase();
    return allItems.filter((e) => {
      if (!inIsoDateRange(String(e.date || ""), activeRange.from, activeRange.to)) return false;
      if (fCategory !== "الكل" && e.category !== fCategory) return false;
      if (fPayment !== "الكل" && String(e.paymentMethod) !== String(fPayment))
        return false;

      if (queryText) {
        const hay = `${e.title} ${e.category} ${e.note || ""} ${expenseEmployeeLabel(
          e
        )} ${expenseSourceLabel(e)}`.toLowerCase();
        if (!hay.includes(queryText)) return false;
      }

      if (onlyMissingNotes) {
        const n = String(e.note ?? "").trim();
        if (n) return false;
      }

      return true;
    });
  }, [allItems, activeRange.from, activeRange.to, fCategory, fPayment, q, onlyMissingNotes]);

  const filteredAmount = useMemo(
    () => filtered.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    [filtered]
  );
  const filteredPayrollCount = useMemo(
    () => filtered.filter((expense) => isAutoPayrollExpenseId(expense.id)).length,
    [filtered]
  );
  const filteredManualCount = Math.max(0, filtered.length - filteredPayrollCount);

  // ====== فورم الإضافة ======
  const resetForm = () => {
    setTitle("");
    setAmount("");
    setNote("");
    setDate(todayISO());
    setCategory(categories[0] || "أخرى");
    setPaymentMethod((paymentMethods[0] || "كاش") as any as PaymentMethod);
  };

  const addExpense = async () => {
    const amt = Number(amount);
    if (!title.trim()) return setModalMsg("اكتب اسم المصروف");
    if (!category.trim()) return setModalMsg("اختر التصنيف");
    if (!date) return setModalMsg("اختر التاريخ");
    if (!Number.isFinite(amt) || amt <= 0) return setModalMsg("اكتب مبلغ صحيح");

    const expense: Expense = {
      id: safeUUID(),
      title: title.trim(),
      category: category.trim(),
      amount: amt,
      date,
      paymentMethod,
      note: note.trim() || undefined,
      createdAt: Date.now(),
    };

    try {
      setLoading(true);
      await upsertExpenseFS(expense);
      await loadExpenses();
      resetForm();
    } catch (e) {
      console.error("upsertExpenseFS error:", e);
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const removeExpense = async (id: string) => {
    if (isAutoPayrollExpenseId(id)) {
      setModalMsg("هذا السجل محسوب تلقائيًا (راتب/أوفر تايم) ولا يمكن حذفه يدويًا.");
      return;
    }
    setConfirmState({
      open: true,
      title: "تأكيد الحذف",
      message: "متأكد تبغى حذف المصروف؟",
      onConfirm: async () => {
        try {
          setLoading(true);
          await removeExpenseFS(id);
          await loadExpenses();
        } catch (e) {
          console.error("removeExpenseFS error:", e);
          setModalMsg(firebaseMsg(e));
        } finally {
          setLoading(false);
          setConfirmState({ open: false });
        }
      },
    });
  };

  // ✅ بدء التعديل (كل الحقول)
  const startEdit = (e: Expense) => {
    if (isAutoPayrollExpenseId(e.id)) {
      setModalMsg("هذا السجل محسوب تلقائيًا (راتب/أوفر تايم) ولا يمكن تعديله يدويًا.");
      return;
    }
    setEditId(e.id);
    setEditForm({
      title: e.title || "",
      category: e.category || "أخرى",
      paymentMethod: String(e.paymentMethod || "كاش"),
      amount: String(e.amount ?? ""),
      date: e.date || todayISO(),
      note: String(e.note ?? ""),
    });
  };

  // ❌ إلغاء التعديل
  const cancelEdit = () => {
    setEditId(null);
    setEditForm({
      title: "",
      category: "أخرى",
      paymentMethod: "كاش",
      amount: "",
      date: todayISO(),
      note: "",
    });
  };

  // 💾 حفظ التعديل (كل الحقول)
  const saveEdit = async (original: Expense) => {
    if (isAutoPayrollExpenseId(original.id)) {
      setModalMsg("هذا السجل محسوب تلقائيًا (راتب/أوفر تايم) ولا يمكن تعديله يدويًا.");
      return;
    }
    const amt = Number(editForm.amount);

    if (!editForm.title.trim()) return setModalMsg("اكتب اسم المصروف");
    if (!editForm.category.trim()) return setModalMsg("اختر التصنيف");
    if (!editForm.date) return setModalMsg("اختر التاريخ");
    if (!Number.isFinite(amt) || amt <= 0) return setModalMsg("اكتب مبلغ صحيح");

    const updated: Expense = {
      ...original,
      title: editForm.title.trim(),
      category: editForm.category.trim(),
      paymentMethod: editForm.paymentMethod as any,
      amount: amt,
      date: editForm.date,
      note: editForm.note.trim() || undefined,
    };

    try {
      setLoading(true);
      await upsertExpenseFS(updated);
      await loadExpenses();
      setEditId(null);
      setModalMsg("تم التعديل ✅");
    } catch (e) {
      console.error("saveEdit error:", e);
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const migrateLegacyExpensesOnce = async () => {
    try {
      const already = localStorage.getItem(EXPENSES_MIGRATED_KEY) === "1";
      if (already) {
        setModalMsg("تم ترحيل المصروفات مسبقًا ✅");
        setMigrated(true);
        setHasLegacy(false);
        setLegacyCount(0);
        return;
      }

      const legacy = loadLegacyExpenses();
      if (legacy.length === 0) {
        setModalMsg("لا توجد مصروفات قديمة في LocalStorage ✅");
        setHasLegacy(false);
        setLegacyCount(0);
        return;
      }

      setConfirmState({
        open: true,
        title: "ترحيل المصروفات",
        message:
          `سيتم ترحيل ${legacy.length} مصروف من LocalStorage إلى Firestore.\n` +
          `ملاحظة: العملية مرة واحدة ولن تتكرر.\n\nتأكيد؟`,
        onConfirm: async () => {
          try {
            setLoading(true);

            const existingIds = new Set(items.map((x) => x.id));
            const toUpsert = legacy.filter((x) => !existingIds.has(x.id));

            if (toUpsert.length === 0) {
              localStorage.setItem(EXPENSES_MIGRATED_KEY, "1");
              localStorage.removeItem(LEGACY_EXPENSES_KEY);

              setMigrated(true);
              setHasLegacy(false);
              setLegacyCount(0);

              setModalMsg("كل السجلات موجودة بالفعل في Firestore ✅");
              return;
            }

            await Promise.all(toUpsert.map((x) => upsertExpenseFS(x)));

            localStorage.setItem(EXPENSES_MIGRATED_KEY, "1");
            localStorage.removeItem(LEGACY_EXPENSES_KEY);

            setMigrated(true);
            setHasLegacy(false);
            setLegacyCount(0);

            await loadExpenses();
            setModalMsg(`تم ترحيل ${toUpsert.length} مصروف إلى Firestore ✅`);
          } catch (e) {
            console.error("migrateLegacyExpensesOnce error:", e);
            setModalMsg(firebaseMsg(e));
          } finally {
            setLoading(false);
            setConfirmState({ open: false });
          }
        },
      });
    } catch (e) {
      console.error("migrateLegacyExpensesOnce error:", e);
      setModalMsg(firebaseMsg(e));
    } finally {
      setLoading(false);
    }
  };

  const buildExpensesReportInput = () => ({
    rows: filtered.map((e) => ({
      date: e.date,
      type: expenseTypeLabel(e),
      category: e.category,
      title: e.title || e.note || "",
      employeeName: expenseEmployeeLabel(e),
      paymentMethod: String(e.paymentMethod || ""),
      amount: Number(e.amount || 0),
      source: expenseSourceLabel(e),
      addedBy: String((e as any).createdByName || (e as any).addedBy || "الإدارة"),
      payrollCycle:
        payrollKindFromExpense(e) === "manual"
          ? ""
          : String(e.monthKey || payrollCycleKeyFromDate(e.date, PAYROLL_CLOSE_DAY) || ""),
      note: e.note || "",
    })),
    filters: {
      fromDate: activeRange.from,
      toDate: activeRange.to,
      category: fCategory,
      paymentMethod: fPayment,
      mode: recordMode === "payroll_cycle" ? "دورة رواتب" : "شهر تقويمي",
    },
    generatedBy: "لوحة المصروفات",
  });

  const exportCsv = () => {
    if (!filtered.length) return setModalMsg("ما فيه بيانات للتصدير");

    const rows = filtered.map((e) => ({
      التاريخ: e.date,
      النوع: expenseTypeLabel(e),
      الوصف: e.title || e.note || "",
      الموظفة: expenseEmployeeLabel(e),
      التصنيف: e.category,
      المبلغ: e.amount,
      المصدر: expenseSourceLabel(e),
      طريقة_الدفع: e.paymentMethod,
      ملاحظات: e.note || "",
      دورة_الرواتب:
        payrollKindFromExpense(e) === "manual"
          ? ""
          : String(e.monthKey || payrollCycleKeyFromDate(e.date, PAYROLL_CLOSE_DAY) || ""),
    }));

    const csv = toCsv(rows);
    const filename = `expenses_${recordMode}_${selectedMonthKey}_${activeRange.from}_${activeRange.to}.csv`;
    downloadTextFile(filename, csv);
  };

  const exportPdf = () => {
    if (!filtered.length) return setModalMsg("ما فيه بيانات للتصدير");
    exportExpensesReportPdf(buildExpensesReportInput());
  };

  const exportExcel = () => {
    if (!filtered.length) return setModalMsg("ما فيه بيانات للتصدير");
    exportExpensesReportExcel(buildExpensesReportInput());
  };

  const addCategoryQuick = () => {
    const n = newCategory.trim();
    if (!n) return;

    FinanceSettingsService.addCategory(n);
    setNewCategory("");

    (async () => {
      const fresh = await FinanceSettingsService.get();
      const cats = (
        fresh?.expenseCategories?.length ? fresh.expenseCategories : ["أخرى"]
      ) as string[];

      setCategories(cats);
      if (!cats.includes(category)) setCategory(cats[0] || "أخرى");
    })();

    setModalMsg("تمت إضافة التصنيف ✅ (راح ننقله للإعدادات لاحقًا)");
  };

  if (!authReady) {
    return (
      <div className="exp-page enterprise-workspace-page enterprise-workspace-v2 enterprise-expenses-v2">
        <div className="exp-card">
          <h2>جاري التحقق من الصلاحيات...</h2>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="exp-page enterprise-workspace-page enterprise-workspace-v2 enterprise-expenses-v2">
        <div className="exp-card">
          <h2>غير مصرح</h2>
          <p>هذه الصفحة خاصة بالمالك/الإدارة فقط.</p>
        </div>
      </div>
    );
  }

  // ✅ خيارات الدروب داون (نفس الشكل)
  const runtimeCategories = Array.from(
    new Set(
      [...categories, ...allItems.map((e) => String(e.category || "").trim()).filter(Boolean)]
    )
  );
  const categoryOptions: DDOption[] = [
    { value: "الكل", label: "الكل" },
    ...runtimeCategories.map((c) => ({ value: c, label: c })),
  ];

  const categoryOptionsNoAll: DDOption[] = categories.map((c) => ({
    value: c,
    label: c,
  }));

  const paymentOptions: DDOption[] = [
    { value: "الكل", label: "الكل" },
    ...paymentMethods.map((p) => ({ value: String(p), label: String(p) })),
  ];

  const paymentOptionsNoAll: DDOption[] = paymentMethods.map((p) => ({
    value: String(p),
    label: String(p),
  }));

  const recordModeOptions: DDOption[] = [
    { value: "calendar", label: "شهر تقويمي (1-آخر الشهر)" },
    { value: "payroll_cycle", label: `دورة رواتب (${PAYROLL_CLOSE_DAY + 1}-${PAYROLL_CLOSE_DAY})` },
  ];

  return (
    <div className="exp-page enterprise-workspace-page enterprise-workspace-v2 enterprise-expenses-v2">
      {/* ✅ Header ثابت: الأزرار تظهر دائمًا (حل اختفاء التصدير) */}
      <div className="exp-header">
        <div className="enterprise-page-title">
          <span className="enterprise-page-eyebrow">FINANCE OPERATIONS</span>
          <h1>المصروفات</h1>
          <p>إدارة المصروفات التشغيلية والرواتب، مراجعة النواقص، وتصدير التقارير من مساحة عمل واحدة.</p>
        </div>

        <div className="exp-header-actions">
          {hasLegacy && !migrated ? (
            <button
              className="exp-btn"
              onClick={migrateLegacyExpensesOnce}
              disabled={loading}
              title="ترحيل المصروفات القديمة من LocalStorage إلى Firestore (مرة واحدة)"
              type="button"
            >
              ترحيل من LocalStorage ({legacyCount})
            </button>
          ) : null}

          <button
            className="exp-btn"
            onClick={loadExpenses}
            disabled={loading}
            type="button"
          >
            تحديث
          </button>

          <button
            className="reports-btn primary"
            type="button"
            onClick={() => {
              // ✅ تصدير يعتمد على filtered الحالية
              exportCsv();
            }}
            disabled={loading}
            title="CSV"
          >
            <FontAwesomeIcon icon={faFileCsv} /> CSV
          </button>

          <button
            className="reports-btn"
            type="button"
            onClick={exportPdf}
            disabled={loading || !filtered.length}
            title="PDF"
          >
            <FontAwesomeIcon icon={faFileCsv} /> PDF
          </button>

          <button
            className="reports-btn"
            type="button"
            onClick={exportExcel}
            disabled={loading || !filtered.length}
            title="Excel"
          >
            <FontAwesomeIcon icon={faFileCsv} /> Excel
          </button>
        </div>
      </div>

      <section className="enterprise-metrics" aria-label="ملخص المصروفات المعروضة">
        <article className="enterprise-metric">
          <span className="enterprise-metric__icon"><FontAwesomeIcon icon={faMoneyBillWave} /></span>
          <div><small>إجمالي الفترة</small><strong>{money(filteredAmount)} ريال</strong><em>{activeRange.from} — {activeRange.to}</em></div>
        </article>
        <article className="enterprise-metric">
          <span className="enterprise-metric__icon"><FontAwesomeIcon icon={faList} /></span>
          <div><small>السجلات المعروضة</small><strong>{filtered.length}</strong><em>بعد تطبيق الفلاتر الحالية</em></div>
        </article>
        <article className="enterprise-metric">
          <span className="enterprise-metric__icon"><FontAwesomeIcon icon={faWallet} /></span>
          <div><small>مصروفات الرواتب</small><strong>{filteredPayrollCount}</strong><em>صفوف محسوبة تلقائيًا</em></div>
        </article>
        <article className="enterprise-metric">
          <span className="enterprise-metric__icon"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
          <div><small>تحتاج ملاحظة</small><strong>{missingNotesInActiveRange}</strong><em>{filteredManualCount} مصروف يدوي معروض</em></div>
        </article>
      </section>

      <div className="exp-card exp-card--controls">
        <h3 className="exp-card-title">سجل المصروفات الكامل</h3>
        <div className="exp-control-points">
          <div>
            إغلاق دورة الرواتب ثابت يوم <b>{PAYROLL_CLOSE_DAY}</b> من كل شهر.
          </div>
          <div>
            الفترة المعروضة الآن: <b>{activeRange.from}</b> إلى <b>{activeRange.to}</b>.
          </div>
          <div>
            دورة الرواتب المرجعية: <b>{activePayrollCycleKey}</b> | بدون ملاحظات داخل الفترة:{" "}
            <b>{missingNotesInActiveRange}</b> | هذا الشهر: <b>{missingNotesCountFS}</b>.
          </div>
          <div>
            أي أوفر تايم بعد يوم {PAYROLL_CLOSE_DAY} (مثل 28-31) يترحل تلقائيًا لدورة الشهر التالي، مع الاحتفاظ
            بتاريخ يومه الفعلي.
          </div>
        </div>

        <div className="exp-filters exp-filters--controls">
          <label>
            وضع العرض
            <DashDropdown
              value={recordMode}
              onChange={(v) => setRecordMode(v === "payroll_cycle" ? "payroll_cycle" : "calendar")}
              options={recordModeOptions}
              disabled={loading}
            />
          </label>

          <label>
            الشهر المرجعي
            <input
              type="month"
              value={selectedMonthKey}
              onChange={(e) => {
                const next = String(e.target.value || "").trim();
                if (/^\d{4}-\d{2}$/.test(next)) setSelectedMonthKey(next);
              }}
            />
          </label>

          <label>
            التصنيف
            <DashDropdown
              value={fCategory}
              onChange={(v) => setFCategory(v)}
              options={categoryOptions}
              disabled={loading}
            />
          </label>

          <label>
            الدفع
            <DashDropdown
              value={fPayment}
              onChange={(v) => setFPayment(v)}
              options={paymentOptions}
              disabled={loading}
            />
          </label>

          <label className="span-2">
            بحث
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="الوصف / الموظفة / المصدر / الملاحظات..."
            />
          </label>

          <div className="span-2 exp-actions">
            <button
              className={`exp-btn ${onlyMissingNotes ? "" : "primary"}`}
              type="button"
              onClick={() => setOnlyMissingNotes(false)}
            >
              جميع المصروفات
            </button>
            <button
              className={`exp-btn ${onlyMissingNotes ? "primary" : ""}`}
              type="button"
              onClick={() => setOnlyMissingNotes(true)}
            >
              بدون ملاحظات
            </button>
            <button
              className="exp-btn"
              type="button"
              onClick={() => {
                setOnlyMissingNotes(false);
                setFCategory("الكل");
                setFPayment("الكل");
                setQ("");
              }}
            >
              تصفير الفلاتر
            </button>
          </div>
        </div>
      </div>

      {/* ===== Main Grid ===== */}
      <div className="exp-grid exp-grid--main">
        <div className="exp-card exp-card--form">
          <h3>إضافة مصروف</h3>

          <div className="exp-form">
            <label>
              اسم المصروف
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثال: شراء منتجات..."
              />
            </label>

            <label>
              التصنيف
              <DashDropdown
                value={category}
                onChange={(v) => setCategory(v)}
                options={
                  categoryOptionsNoAll.length
                    ? categoryOptionsNoAll
                    : [{ value: "أخرى", label: "أخرى" }]
                }
                disabled={loading}
              />
            </label>

            <label>
              المبلغ (ريال)
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="مثال: 250"
                inputMode="decimal"
              />
            </label>

            <label>
              التاريخ
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>

            <label>
              طريقة الدفع
              <DashDropdown
                value={String(paymentMethod)}
                onChange={(v) =>
                  setPaymentMethod(v as unknown as PaymentMethod)
                }
                options={
                  paymentOptionsNoAll.length
                    ? paymentOptionsNoAll
                    : [
                        { value: "كاش", label: "كاش" },
                        { value: "شبكة", label: "شبكة" },
                        { value: "تحويل", label: "تحويل" },
                      ]
                }
                disabled={loading}
              />
            </label>

            <label className="span-2">
              ملاحظات (اختياري)
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="أي تفاصيل..."
              />
            </label>

            <div className="span-2 exp-actions">
              <button
                className="reports-btn primary"
                onClick={addExpense}
                type="button"
                disabled={loading}
              >
                إضافة المصروف
              </button>
              <button
                className="reports-btn"
                onClick={resetForm}
                type="button"
                disabled={loading}
              >
                تفريغ
              </button>
            </div>
          </div>

          <div className="exp-divider" />

          <div className="exp-mini">
            <div className="mini-title">إضافة تصنيف جديد (مؤقتًا هنا)</div>
            <div className="exp-form">
              <input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="مثال: تأمين"
              />
              <button
                className="reports-btn"
                onClick={addCategoryQuick}
                type="button"
              >
                إضافة
              </button>
            </div>
            <div className="mini-hint">
              لاحقًا بنحطه داخل صفحة الإعدادات بشكل مرتب.
            </div>
          </div>
        </div>

        <div className="exp-card exp-card--table">
          <div className="exp-table-head">
            <h3 className="exp-card-title">جميع المصروفات</h3>
            <span className="exp-results-count">{filtered.length}</span>
          </div>
          <div className="exp-table-wrap exp-table-wrap--main">
            <table className="exp-table">
              <colgroup>
                <col style={{ width: "10%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>النوع</th>
                  <th>الوصف</th>
                  <th>الموظفة</th>
                  <th>المبلغ</th>
                  <th>المصدر</th>
                  <th>ملاحظات</th>
                  <th>إجراء</th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="empty">
                      جاري تحميل المصروفات...
                    </td>
                  </tr>
                ) : filtered.length ? (
                  filtered.map((e) => {
                    const isAutoPayroll = isAutoPayrollExpenseId(e.id);
                    const isEdit = !isAutoPayroll && editId === e.id;
                    return (
                      <tr key={e.id} className={isAutoPayroll ? "exp-row-auto-payroll" : ""}>
                        <td data-label="التاريخ">
                          {isEdit ? (
                            <input
                              type="date"
                              value={editForm.date}
                              onChange={(ev) =>
                                setEditForm((p) => ({
                                  ...p,
                                  date: ev.target.value,
                                }))
                              }
                            />
                          ) : (
                            e.date
                          )}
                        </td>

                        <td data-label="النوع">{expenseTypeLabel(e)}</td>

                        <td data-label="الوصف" className="strong exp-cell-title">
                          {isEdit ? (
                            <input
                              value={editForm.title}
                              onChange={(ev) =>
                                setEditForm((p) => ({
                                  ...p,
                                  title: ev.target.value,
                                }))
                              }
                              placeholder="الوصف"
                            />
                          ) : (
                            <div className="exp-row-title">
                              <span
                                className="exp-title-text"
                                title={e.title || e.note || "-"}
                              >
                                {e.title || e.note || "-"}
                              </span>
                            </div>
                          )}
                        </td>

                        <td data-label="الموظفة" className="exp-cell-employee">{expenseEmployeeLabel(e)}</td>

                        <td data-label="المبلغ" className="amount exp-cell-amount">
                          {isEdit ? (
                            <input
                              inputMode="decimal"
                              value={editForm.amount}
                              onChange={(ev) =>
                                setEditForm((p) => ({
                                  ...p,
                                  amount: ev.target.value,
                                }))
                              }
                              placeholder="0"
                            />
                          ) : (
                            <>{money(e.amount)} ريال</>
                          )}
                        </td>

                        <td data-label="المصدر" className="exp-cell-source">
                          {isEdit ? (
                            <div style={{ display: "grid", gap: 6 }}>
                              <DashDropdown
                                value={editForm.category}
                                onChange={(v) => setEditForm((p) => ({ ...p, category: v }))}
                                options={
                                  categoryOptionsNoAll.length
                                    ? categoryOptionsNoAll
                                    : [{ value: "أخرى", label: "أخرى" }]
                                }
                                disabled={loading}
                              />
                              <DashDropdown
                                value={editForm.paymentMethod}
                                onChange={(v) =>
                                  setEditForm((p) => ({
                                    ...p,
                                    paymentMethod: v,
                                  }))
                                }
                                options={
                                  paymentOptionsNoAll.length
                                    ? paymentOptionsNoAll
                                    : [
                                        { value: "كاش", label: "كاش" },
                                        { value: "شبكة", label: "شبكة" },
                                        { value: "تحويل", label: "تحويل" },
                                      ]
                                }
                                disabled={loading}
                              />
                            </div>
                          ) : (
                            expenseSourceLabel(e)
                          )}
                        </td>

                        <td data-label="ملاحظات" className="muted exp-cell-note">
                          {isEdit ? (
                            <input
                              value={editForm.note}
                              onChange={(ev) =>
                                setEditForm((p) => ({
                                  ...p,
                                  note: ev.target.value,
                                }))
                              }
                              placeholder="ملاحظة..."
                            />
                          ) : (
                            <span className="exp-note-text" title={e.note || "—"}>
                              {e.note || "—"}
                            </span>
                          )}
                        </td>

                        <td data-label="إجراء">
                          {isAutoPayroll ? (
                            <span className="exp-auto-pill">تلقائي</span>
                          ) : isEdit ? (
                            <div className="exp-row-actions">
                              <button
                                className="exp-btn primary"
                                type="button"
                                disabled={loading}
                                onClick={() => saveEdit(e)}
                              >
                                حفظ
                              </button>
                              <button
                                className="exp-btn"
                                type="button"
                                disabled={loading}
                                onClick={cancelEdit}
                              >
                                إلغاء
                              </button>
                            </div>
                          ) : (
                            <div className="exp-row-actions">
                              <button
                                className="exp-btn"
                                type="button"
                                disabled={loading}
                                onClick={() => startEdit(e)}
                              >
                                تعديل
                              </button>
                              <button
                                className="exp-btn danger"
                                type="button"
                                disabled={loading}
                                onClick={() => removeExpense(e.id)}
                              >
                                حذف
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="empty">
                      ما فيه مصروفات ضمن الفترة الحالية.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ✅ Alert Modal */}
      {modalMsg ? (
        <Modal
          open={!!modalMsg}
          onClose={() => setModalMsg("")}
          ariaLabel="تنبيه"
          panelClassName="modal-box is-info"
          size="sm"
        >
            <div className="modal-head">
              <div className="modal-title-wrap">
                <div className="modal-icon">ℹ️</div>
                <h3 className="modal-title">تنبيه</h3>
              </div>

              <button
                className="modal-close"
                onClick={() => setModalMsg("")}
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-text">{modalMsg}</p>
            </div>

            <div className="modal-actions">
              <button
                className="dash-pill dash-pill-primary"
                onClick={() => setModalMsg("")}
                type="button"
              >
                حسناً
              </button>
            </div>
          </Modal>
      ) : null}

      {/* ✅ Confirm Modal */}
      {confirmState.open ? (
        <Modal
          open={confirmState.open}
          onClose={() => setConfirmState({ open: false })}
          ariaLabel={confirmState.title || "تأكيد"}
          panelClassName="modal-box is-danger"
          size="sm"
        >
            <div className="modal-head">
              <div className="modal-title-wrap">
                <div className="modal-icon">⚠️</div>
                <h3 className="modal-title">{confirmState.title || "تأكيد"}</h3>
              </div>

              <button
                className="modal-close"
                onClick={() => setConfirmState({ open: false })}
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-text" style={{ whiteSpace: "pre-line" }}>
                {confirmState.message || ""}
              </p>
            </div>

            <div className="modal-actions">
              <button
                className="dash-pill dash-pill-danger"
                type="button"
                onClick={async () => {
                  const fn = confirmState.onConfirm;
                  if (fn) await fn();
                  else setConfirmState({ open: false });
                }}
              >
                تأكيد
              </button>
              <button
                className="dash-pill dash-pill-outline"
                onClick={() => setConfirmState({ open: false })}
                type="button"
              >
                إلغاء
              </button>
            </div>
          </Modal>
      ) : null}
    </div>
  );
};

export default DashboardExpenses;
