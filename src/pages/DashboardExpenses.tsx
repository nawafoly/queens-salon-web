import { useEffect, useMemo, useState } from "react";
import "../styles/dashboard-v2/pages/expenses.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEye,
  faMagnifyingGlass,
  faPen,
  faPlus,
  faRotate,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
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
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import {
  listAllExpensesFS,
  removeExpenseFS,
  upsertExpenseFS,
  countMonthlyExpensesMissingNotesFS,
} from "../services/firestoreExpenses";
import { exportExpensesReportExcel, exportExpensesReportPdf } from "../helpers/reports/exportExpensesReport";
import {
  DashboardConfirmV2,
  DashboardDatePickerV2,
  DashboardDrawerV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";

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

const GREGORIAN_MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
] as const;

function formatMonthKeyLabel(monthKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || "").trim());
  if (!match) return String(monthKey || "").trim();
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return monthKey;
  return `${GREGORIAN_MONTHS_AR[month - 1]} ${year}`;
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


function paymentMethodLabel(value: unknown): string {
  const raw = String(value || "").trim();
  const key = raw.toLowerCase();
  if (key === "cash" || raw.includes("كاش") || raw.includes("نقد")) return "كاش";
  if (key === "card" || key === "mada" || raw.includes("شبكة") || raw.includes("مدى") || raw.includes("بطاق")) return "شبكة";
  if (key === "transfer" || raw.includes("تحويل")) return "تحويل";
  if (key === "mixed" || raw.includes("مختلط")) return "مختلط";
  return raw || "غير محدد";
}

function paymentMethodTone(value: unknown): "cash" | "card" | "transfer" | "other" {
  const label = paymentMethodLabel(value);
  if (label === "كاش") return "cash";
  if (label === "شبكة") return "card";
  if (label === "تحويل") return "transfer";
  return "other";
}

function formatSar(value: unknown): string {
  return `${money(Number(value || 0))} ر.س`;
}

function formatDateDisplay(value: unknown): string {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw || "—";
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

  const [addOpen, setAddOpen] = useState(false);
  const [detailsTarget, setDetailsTarget] = useState<Expense | null>(null);

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
      setAddOpen(false);
      setModalMsg("تمت إضافة المصروف بنجاح");
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
      <div className="dsv2-page expenses-v2-page">
        <section className="dsv2-card dsv2-card--padded expenses-v2-auth-state">
          <DashboardSkeletonV2 variant="title" width="38%" />
          <DashboardSkeletonV2 lines={3} />
        </section>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="dsv2-page expenses-v2-page">
        <DashboardErrorStateV2
          title="غير مصرح"
          description="هذه الصفحة خاصة بالمالك والإدارة فقط."
        />
      </div>
    );
  }

  // ✅ خيارات الدروب داون (نفس الشكل)
  const runtimeCategories = Array.from(
    new Set(
      [...categories, ...allItems.map((e) => String(e.category || "").trim()).filter(Boolean)]
    )
  );
  const categoryOptions = [
    { value: "الكل", label: "الكل" },
    ...runtimeCategories.map((c) => ({ value: c, label: c })),
  ];

  const categoryOptionsNoAll = categories.map((c) => ({
    value: c,
    label: c,
  }));

  // Dashboard Expenses V2 stage 4.1: unified month selector
  const monthOptions = (() => {
    const keys = new Set<string>();
    const currentMonth = todayISO().slice(0, 7);

    allItems.forEach((item) => {
      const key = monthKeyFromIsoDate(String(item?.date || ""));
      if (key) keys.add(key);
    });

    for (let delta = -24; delta <= 12; delta += 1) {
      const key = shiftMonthKey(currentMonth, delta);
      if (key) keys.add(key);
    }

    if (/^\d{4}-\d{2}$/.test(selectedMonthKey)) keys.add(selectedMonthKey);

    return Array.from(keys)
      .sort((a, b) => b.localeCompare(a))
      .map((value) => ({ value, label: formatMonthKeyLabel(value) }));
  })();

  const paymentOptions = [
    { value: "الكل", label: "الكل" },
    ...paymentMethods.map((p) => ({ value: String(p), label: String(p) })),
  ];

  const paymentOptionsNoAll = paymentMethods.map((p) => ({
    value: String(p),
    label: String(p),
  }));

  const recordModeOptions = [
    { value: "calendar", label: "شهر تقويمي (1-آخر الشهر)" },
    { value: "payroll_cycle", label: `دورة رواتب (${PAYROLL_CLOSE_DAY + 1}-${PAYROLL_CLOSE_DAY})` },
  ];


  const editTarget = editId ? allItems.find((item) => item.id === editId) || null : null;
  const hasActiveFilters = Boolean(
    fCategory !== "الكل" || fPayment !== "الكل" || q.trim() || onlyMissingNotes
  );
  const manualAmount = filtered
    .filter((item) => payrollKindFromExpense(item) === "manual")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const payrollAmount = Math.max(0, filteredAmount - manualAmount);
  const categoryCount = new Set(filtered.map((item) => String(item.category || "").trim()).filter(Boolean)).size;


  return (
    <>
      <div className="dsv2-page expenses-v2-page">
        <section className="dsv2-card expenses-v2-hero">
          <div className="expenses-v2-hero__content">
            <span className="dsv2-badge dsv2-badge--gold">الإدارة المالية</span>
            <h1 className="dsv2-page-title">المصروفات</h1>
            <p className="dsv2-page-subtitle">
              إدارة المصروفات التشغيلية والرواتب، ومراجعة النواقص والتقارير من مساحة واحدة.
            </p>
          </div>

          <div className="expenses-v2-actions" aria-label="إجراءات صفحة المصروفات">
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => setAddOpen(true)} disabled={loading}>
              <FontAwesomeIcon icon={faPlus} /> إضافة مصروف
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => void loadExpenses()} disabled={loading}>
              <FontAwesomeIcon icon={faRotate} /> تحديث
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={exportPdf} disabled={loading || !filtered.length}>
              تحميل PDF
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={exportExcel} disabled={loading || !filtered.length}>
              Excel منسّق
            </button>
            {hasLegacy && !migrated ? (
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => void migrateLegacyExpensesOnce()} disabled={loading}>
                ترحيل القديم ({legacyCount})
              </button>
            ) : null}
          </div>
        </section>

        <section className="expenses-v2-metrics" aria-label="ملخص المصروفات">
          <article className="dsv2-metric-card dsv2-metric-card--danger">
            <p className="dsv2-metric-card__label">إجمالي المصروفات</p>
            <p className="dsv2-metric-card__value">{formatSar(filteredAmount)}</p>
            <p className="dsv2-metric-card__meta">{activeRange.from} — {activeRange.to}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--gold">
            <p className="dsv2-metric-card__label">مصروفات الرواتب</p>
            <p className="dsv2-metric-card__value">{formatSar(payrollAmount)}</p>
            <p className="dsv2-metric-card__meta">{filteredPayrollCount} سجل محسوب تلقائيًا</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--dark">
            <p className="dsv2-metric-card__label">المصروفات التشغيلية</p>
            <p className="dsv2-metric-card__value">{formatSar(manualAmount)}</p>
            <p className="dsv2-metric-card__meta">{filteredManualCount} سجل يدوي</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--gold">
            <p className="dsv2-metric-card__label">تحتاج ملاحظة</p>
            <p className="dsv2-metric-card__value">{missingNotesInActiveRange}</p>
            <p className="dsv2-metric-card__meta">ضمن الفترة الحالية</p>
          </article>
        </section>

        <section className="expenses-v2-cycle-strip" aria-label="الفترة المرجعية">
          <div><strong>الفترة المعروضة</strong><span>{activeRange.from} إلى {activeRange.to}</span></div>
          <div><strong>الدورة المرجعية</strong><span>{activePayrollCycleKey}</span></div>
          <div><strong>التصنيفات الظاهرة</strong><span>{categoryCount}</span></div>
          <div><strong>إغلاق الرواتب</strong><span>يوم {PAYROLL_CLOSE_DAY} من كل شهر</span></div>
        </section>

        <section className="dsv2-card dsv2-card--padded expenses-v2-filter-card">
          <div className="expenses-v2-section-head">
            <div>
              <span className="dsv2-badge dsv2-badge--neutral">الفلاتر</span>
              <h2>سجل المصروفات</h2>
              <p>غيّر الفترة والتصنيف وطريقة الدفع أو ابحث داخل السجلات.</p>
            </div>
            <div className="expenses-v2-filter-actions">
              <button
                className={`dsv2-btn dsv2-btn--sm ${onlyMissingNotes ? "dsv2-btn--accent" : "dsv2-btn--secondary"}`}
                type="button"
                onClick={() => setOnlyMissingNotes((value) => !value)}
              >
                {onlyMissingNotes ? "عرض الكل" : "بدون ملاحظات"}
              </button>
              <button
                className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                type="button"
                disabled={!hasActiveFilters}
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

          <div className="expenses-v2-filter-grid">
            <DashboardFieldV2 id="expenses-v2-mode" label="وضع العرض">
              <DashboardSelectV2
                id="expenses-v2-mode"
                options={recordModeOptions}
                value={recordMode}
                onChange={(value) => setRecordMode(value === "payroll_cycle" ? "payroll_cycle" : "calendar")}
                disabled={loading}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="expenses-v2-month" label="الشهر المرجعي">
              <DashboardSelectV2
                id="expenses-v2-month"
                options={monthOptions}
                value={selectedMonthKey}
                onChange={(value) => {
                  if (/^\d{4}-\d{2}$/.test(value)) setSelectedMonthKey(value);
                }}
                disabled={loading}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="expenses-v2-category" label="التصنيف">
              <DashboardSelectV2 id="expenses-v2-category" options={categoryOptions} value={fCategory} onChange={setFCategory} disabled={loading} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="expenses-v2-payment" label="طريقة الدفع">
              <DashboardSelectV2 id="expenses-v2-payment" options={paymentOptions} value={fPayment} onChange={setFPayment} disabled={loading} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="expenses-v2-search" label="البحث" className="expenses-v2-search-field">
              <div className="expenses-v2-search-control">
                <FontAwesomeIcon icon={faMagnifyingGlass} />
                <input
                  id="expenses-v2-search"
                  className="dsv2-input"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="الوصف، الموظفة، المصدر أو الملاحظات"
                />
              </div>
            </DashboardFieldV2>
          </div>
        </section>

        <section className="dsv2-table-card expenses-v2-table-card">
          <header className="expenses-v2-table-head">
            <div>
              <h2>تفاصيل المصروفات</h2>
              <p>{filtered.length} سجل مطابق للفلاتر الحالية</p>
            </div>
            <span className="dsv2-badge dsv2-badge--gold">{formatSar(filteredAmount)}</span>
          </header>

          {loading ? (
            <div className="expenses-v2-loading-table">
              <DashboardSkeletonV2 variant="title" width="32%" />
              <DashboardSkeletonV2 lines={8} />
            </div>
          ) : !filtered.length ? (
            <div className="expenses-v2-state-wrap">
              <DashboardEmptyStateV2
                title="لا توجد مصروفات مطابقة"
                description="غيّر الفلاتر أو أضف مصروفًا جديدًا لبدء عرض البيانات."
                tone="gold"
                action={<button className="dsv2-btn dsv2-btn--accent" type="button" onClick={() => setAddOpen(true)}>إضافة مصروف</button>}
              />
            </div>
          ) : (
            <>
              <div className="dsv2-table-scroll expenses-v2-desktop-table">
                <table className="dsv2-table expenses-v2-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th><th>النوع</th><th>الوصف</th><th>الموظفة</th><th>التصنيف</th><th>الدفع</th><th>المبلغ</th><th>المصدر</th><th>ملاحظات</th><th>إجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const autoPayroll = isAutoPayrollExpenseId(item.id);
                      return (
                        <tr key={item.id}>
                          <td><span className="dsv2-table__primary">{formatDateDisplay(item.date)}</span>{item.monthKey ? <small className="dsv2-table__secondary">{item.monthKey}</small> : null}</td>
                          <td><span className="expenses-v2-type-badge" data-type={payrollKindFromExpense(item)}>{expenseTypeLabel(item)}</span></td>
                          <td><span className="dsv2-table__primary expenses-v2-title-cell" title={item.title || item.note || "—"}>{item.title || item.note || "—"}</span></td>
                          <td>{expenseEmployeeLabel(item)}</td>
                          <td>{item.category || "أخرى"}</td>
                          <td><span className="expenses-v2-payment-badge" data-method={paymentMethodTone(item.paymentMethod)}>{paymentMethodLabel(item.paymentMethod)}</span></td>
                          <td><strong className="expenses-v2-amount">{formatSar(item.amount)}</strong></td>
                          <td>{expenseSourceLabel(item)}</td>
                          <td className="expenses-v2-note-cell">{item.note || <span className="expenses-v2-missing-note">بدون ملاحظة</span>}</td>
                          <td>
                            <div className="expenses-v2-row-actions">
                              <button className="dsv2-icon-btn" type="button" aria-label="عرض التفاصيل" title="عرض التفاصيل" onClick={() => setDetailsTarget(item)}><FontAwesomeIcon icon={faEye} /></button>
                              {!autoPayroll ? <button className="dsv2-icon-btn" type="button" aria-label="تعديل" title="تعديل" onClick={() => startEdit(item)}><FontAwesomeIcon icon={faPen} /></button> : null}
                              {!autoPayroll ? <button className="dsv2-icon-btn expenses-v2-delete-action" type="button" aria-label="حذف" title="حذف" onClick={() => void removeExpense(item.id)}><FontAwesomeIcon icon={faTrash} /></button> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="expenses-v2-mobile-list">
                {filtered.map((item) => {
                  const autoPayroll = isAutoPayrollExpenseId(item.id);
                  return (
                    <article className="expenses-v2-mobile-card" key={item.id}>
                      <header><div><span>{formatDateDisplay(item.date)}</span><strong>{item.title || item.note || "—"}</strong></div><strong className="expenses-v2-amount">{formatSar(item.amount)}</strong></header>
                      <div className="expenses-v2-mobile-meta"><span>{expenseTypeLabel(item)}</span><span>{item.category || "أخرى"}</span><span>{paymentMethodLabel(item.paymentMethod)}</span><span>{expenseSourceLabel(item)}</span></div>
                      <p>{item.note || "بدون ملاحظة"}</p>
                      <footer>
                        <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => setDetailsTarget(item)}><FontAwesomeIcon icon={faEye} /> التفاصيل</button>
                        {!autoPayroll ? <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => startEdit(item)}><FontAwesomeIcon icon={faPen} /> تعديل</button> : null}
                        {!autoPayroll ? <button className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" type="button" onClick={() => void removeExpense(item.id)}><FontAwesomeIcon icon={faTrash} /> حذف</button> : null}
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
        title="إضافة مصروف"
        description="سجّل بيانات المصروف ليظهر مباشرة في السجل والتقارير."
        eyebrow="المصروفات"
        size="md"
        tone="gold"
        closeOnBackdrop={!loading}
        closeOnEscape={!loading}
        footer={
          <>
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => void addExpense()} disabled={loading}>{loading ? "جارٍ الحفظ..." : "حفظ المصروف"}</button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => setAddOpen(false)} disabled={loading}>إلغاء</button>
          </>
        }
      >
        <div className="expenses-v2-modal-grid">
          <DashboardFieldV2 id="expenses-v2-add-title" label="اسم المصروف" required>
            <input id="expenses-v2-add-title" className="dsv2-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: شراء منتجات" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-category" label="التصنيف" required>
            <DashboardSelectV2 id="expenses-v2-add-category" options={categoryOptionsNoAll.length ? categoryOptionsNoAll : [{ value: "أخرى", label: "أخرى" }]} value={category} onChange={setCategory} disabled={loading} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-amount" label="المبلغ (ر.س)" required>
            <input id="expenses-v2-add-amount" className="dsv2-input" type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-date" label="التاريخ" required>
            <DashboardDatePickerV2 id="expenses-v2-add-date" value={date} onChange={setDate} required clearable={false} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-payment" label="طريقة الدفع" required>
            <DashboardSelectV2 id="expenses-v2-add-payment" options={paymentOptionsNoAll.length ? paymentOptionsNoAll : [{ value: "كاش", label: "كاش" }, { value: "شبكة", label: "شبكة" }, { value: "تحويل", label: "تحويل" }]} value={String(paymentMethod)} onChange={(value) => setPaymentMethod(value as PaymentMethod)} disabled={loading} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-note" label="ملاحظات" className="expenses-v2-field--wide">
            <textarea id="expenses-v2-add-note" className="dsv2-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder="أي تفاصيل إضافية" />
          </DashboardFieldV2>
          <div className="expenses-v2-quick-category expenses-v2-field--wide">
            <div><strong>إضافة تصنيف سريع</strong><span>سيُحفظ ضمن إعدادات التصنيفات المالية.</span></div>
            <input className="dsv2-input" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="مثال: تأمين" />
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={addCategoryQuick}>إضافة</button>
          </div>
        </div>
      </DashboardModalV2>

      <DashboardModalV2
        open={Boolean(editTarget)}
        onClose={cancelEdit}
        title="تعديل المصروف"
        description="عدّل بيانات السجل اليدوي ثم احفظ التغييرات."
        eyebrow="تعديل السجل"
        size="md"
        tone="gold"
        closeOnBackdrop={!loading}
        closeOnEscape={!loading}
        footer={
          <>
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => editTarget && void saveEdit(editTarget)} disabled={loading}>{loading ? "جارٍ الحفظ..." : "حفظ التعديل"}</button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={cancelEdit} disabled={loading}>إلغاء</button>
          </>
        }
      >
        <div className="expenses-v2-modal-grid">
          <DashboardFieldV2 id="expenses-v2-edit-title" label="اسم المصروف" required>
            <input id="expenses-v2-edit-title" className="dsv2-input" value={editForm.title} onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-category" label="التصنيف" required>
            <DashboardSelectV2 id="expenses-v2-edit-category" options={categoryOptionsNoAll.length ? categoryOptionsNoAll : [{ value: "أخرى", label: "أخرى" }]} value={editForm.category} onChange={(value) => setEditForm((prev) => ({ ...prev, category: value }))} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-amount" label="المبلغ (ر.س)" required>
            <input id="expenses-v2-edit-amount" className="dsv2-input" type="number" min="0" step="0.01" value={editForm.amount} onChange={(event) => setEditForm((prev) => ({ ...prev, amount: event.target.value }))} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-date" label="التاريخ" required>
            <DashboardDatePickerV2 id="expenses-v2-edit-date" value={editForm.date} onChange={(value) => setEditForm((prev) => ({ ...prev, date: value }))} required clearable={false} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-payment" label="طريقة الدفع" required>
            <DashboardSelectV2 id="expenses-v2-edit-payment" options={paymentOptionsNoAll.length ? paymentOptionsNoAll : [{ value: "كاش", label: "كاش" }, { value: "شبكة", label: "شبكة" }, { value: "تحويل", label: "تحويل" }]} value={editForm.paymentMethod} onChange={(value) => setEditForm((prev) => ({ ...prev, paymentMethod: value }))} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-note" label="ملاحظات" className="expenses-v2-field--wide">
            <textarea id="expenses-v2-edit-note" className="dsv2-textarea" value={editForm.note} onChange={(event) => setEditForm((prev) => ({ ...prev, note: event.target.value }))} />
          </DashboardFieldV2>
        </div>
      </DashboardModalV2>

      <DashboardConfirmV2
        open={confirmState.open}
        onClose={() => setConfirmState({ open: false })}
        onConfirm={async () => { await confirmState.onConfirm?.(); }}
        title={confirmState.title || "تأكيد الإجراء"}
        description={confirmState.message}
        tone="danger"
        confirmLabel="تأكيد"
        cancelLabel="تراجع"
      />

      <DashboardModalV2
        open={Boolean(modalMsg)}
        onClose={() => setModalMsg("")}
        title={modalMsg.includes("تعذر") || modalMsg.includes("غير مصرح") || modalMsg.includes("⚠️") ? "تعذر تنفيذ العملية" : "تم تنفيذ العملية"}
        description={modalMsg}
        size="sm"
        tone={modalMsg.includes("تعذر") || modalMsg.includes("⚠️") ? "danger" : "success"}
        footer={<button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => setModalMsg("")}>حسنًا</button>}
      ><div /></DashboardModalV2>

      {detailsTarget ? (
        <DashboardDrawerV2
          open={Boolean(detailsTarget)}
          onClose={() => setDetailsTarget(null)}
          title="تفاصيل المصروف"
          description="عرض سريع لبيانات السجل ومصدره."
          eyebrow={detailsTarget.id}
          size="md"
          side="end"
          tone={payrollKindFromExpense(detailsTarget) === "manual" ? "gold" : "success"}
          footer={
            <>
              {!isAutoPayrollExpenseId(detailsTarget.id) ? <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => { startEdit(detailsTarget); setDetailsTarget(null); }}>تعديل المصروف</button> : null}
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => setDetailsTarget(null)}>إغلاق</button>
            </>
          }
        >
          <div className="expenses-v2-drawer-content">
            <article className="dsv2-metric-card dsv2-metric-card--danger">
              <p className="dsv2-metric-card__label">المبلغ المسجل</p>
              <p className="dsv2-metric-card__value">{formatSar(detailsTarget.amount)}</p>
              <p className="dsv2-metric-card__meta">{expenseTypeLabel(detailsTarget)}</p>
            </article>
            <dl className="expenses-v2-detail-list">
              <div><dt>الوصف</dt><dd>{detailsTarget.title || "—"}</dd></div>
              <div><dt>التاريخ</dt><dd>{formatDateDisplay(detailsTarget.date)}</dd></div>
              <div><dt>التصنيف</dt><dd>{detailsTarget.category || "أخرى"}</dd></div>
              <div><dt>طريقة الدفع</dt><dd>{paymentMethodLabel(detailsTarget.paymentMethod)}</dd></div>
              <div><dt>الموظفة</dt><dd>{expenseEmployeeLabel(detailsTarget)}</dd></div>
              <div><dt>المصدر</dt><dd>{expenseSourceLabel(detailsTarget)}</dd></div>
              <div><dt>دورة الرواتب</dt><dd>{detailsTarget.monthKey || "—"}</dd></div>
              <div><dt>ملاحظات</dt><dd>{detailsTarget.note || "لا توجد ملاحظات"}</dd></div>
            </dl>
          </div>
        </DashboardDrawerV2>
      ) : null}
    </>
  );
};

export default DashboardExpenses;
