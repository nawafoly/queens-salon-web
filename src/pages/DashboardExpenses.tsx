import DashboardNumberInputV2 from "../components/dashboard-v2/DashboardNumberInputV2";
import { useEffect, useMemo, useState } from "react";
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
import {
  PAYROLL_CLOSE_DAY,
  payrollCycleKeyFromDate,
  payrollCycleRangeForMonthKey,
} from "../helpers/hr/payrollCycle";
import {
  generatePayrollEntriesForMonths,
} from "../services/CorePayrollService";
import { CoreHrService } from "../services/CoreHrService";
import {
  projectCorePayrollEntriesToFinancialRows,
} from "../helpers/corePayrollFinancialRows";
import type { User } from "firebase/auth";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";
import { usePermissions } from "../security/PermissionContext";
import {
  listAllExpensesCore,
  removeExpenseCore,
  upsertExpenseCore,
  countMonthlyExpensesMissingNotesCore,
} from "../services/CoreExpenseService";
import { exportExpensesReportExcel, exportExpensesReportPdf } from "../helpers/reports/exportExpensesReport";
import { expensesText, type DashboardLanguage } from "../helpers/dashboardExpensesLanguage";
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

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function money(n: number, language: DashboardLanguage = "ar") {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", { maximumFractionDigits: 2 }).format(n);
}


function firebaseMsg(e: any, language: DashboardLanguage = "ar") {
  const msg = String(e?.message || e || "");
  if (msg.includes("Missing or insufficient permissions")) {
    return expensesText(language, "⚠️ لا توجد صلاحيات كافية. تأكد من صلاحيات Core D1 وتسجيل الدخول.");
  }
  if (msg.includes("not-found")) {
    return expensesText(language, "⚠️ المسار غير موجود. تأكد من اسم الـ collection ومسار السيرفس.");
  }
  if (msg.includes("requires an index")) {
    return expensesText(language, "⚠️ الاستعلام يحتاج Index.");
  }
  return expensesText(language, "تعذر تنفيذ العملية. راجع Console لمعرفة السبب.");
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

function formatMonthKeyLabel(monthKey: string, language: DashboardLanguage = "ar"): string {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || "").trim());
  if (!match) return String(monthKey || "").trim();
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return monthKey;
  if (language === "en") {
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
  }
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

function expenseTypeLabel(e: Expense, language: DashboardLanguage = "ar"): string {
  const kind = payrollKindFromExpense(e);
  if (kind === "salary") return expensesText(language, "راتب");
  if (kind === "overtime") return expensesText(language, "أوفر تايم");
  return expensesText(language, "تشغيلي");
}

function expenseDisplayTitle(e: Expense, language: DashboardLanguage = "ar"): string {
  const title = String(e.title || "").trim();
  if (language === "ar" || !title) return title;
  const kind = payrollKindFromExpense(e);
  if (kind === "salary") return title.replace(/^راتب\s*/, `${expensesText(language, "راتب")} `);
  if (kind === "overtime") return title.replace(/^أوفر تايم\s*/, `${expensesText(language, "أوفر تايم")} `);
  return title;
}

function expenseEmployeeLabel(e: Expense): string {
  if (payrollKindFromExpense(e) === "manual") return "-";
  const staffName = String(e.staffName || "").trim();
  if (staffName) return staffName;
  const parsed = extractStaffNameFromExpenseTitle(String(e.title || ""));
  return parsed || "-";
}

function expenseSourceLabel(e: Expense, language: DashboardLanguage = "ar"): string {
  const kind = payrollKindFromExpense(e);
  if (kind === "salary" || kind === "overtime") return expensesText(language, "رواتب");
  const category = String(e.category || "").trim();
  return category ? expensesText(language, category) : expensesText(language, "تشغيل");
}

function paymentMethodLabel(value: unknown, language: DashboardLanguage = "ar"): string {
  const raw = String(value || "").trim();
  const key = raw.toLowerCase();
  if (key === "cash" || raw.includes("كاش") || raw.includes("نقد")) return expensesText(language, "كاش");
  if (key === "card" || key === "mada" || raw.includes("شبكة") || raw.includes("مدى") || raw.includes("بطاق")) return expensesText(language, "شبكة");
  if (key === "transfer" || raw.includes("تحويل")) return expensesText(language, "تحويل");
  if (key === "mixed" || raw.includes("مختلط")) return expensesText(language, "مختلط");
  return raw || expensesText(language, "غير محدد");
}

function paymentMethodTone(value: unknown): "cash" | "card" | "transfer" | "other" {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "cash" || raw.includes("كاش") || raw.includes("نقد")) return "cash";
  if (raw === "card" || raw === "mada" || raw.includes("شبكة") || raw.includes("مدى") || raw.includes("بطاق")) return "card";
  if (raw === "transfer" || raw.includes("تحويل")) return "transfer";
  return "other";
}

function formatSar(value: unknown, language: DashboardLanguage = "ar"): string {
  return `${money(Number(value || 0), language)} ${language === "en" ? "SAR" : "ر.س"}`;
}

function formatDateDisplay(value: unknown): string {
  const raw = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw || "—";
}

const DashboardExpenses: React.FC<{ language?: DashboardLanguage }> = ({ language = "ar" }) => {
  const t = (text: string) => expensesText(language, text);
  const { hasPermission } = usePermissions();
  const [authReady, setAuthReady] = useState(false);
  const allowed = hasPermission("expenses.view");

  // ✅ settings
  const [categories, setCategories] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // ✅ data (Firestore)
  const [items, setItems] = useState<Expense[]>([]);
  const [autoPayrollItems, setAutoPayrollItems] = useState<Expense[]>([]);
  const [payrollLoadWarning, setPayrollLoadWarning] = useState<string>("");
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
      const data = await listAllExpensesCore();
      const manualItems = Array.isArray(data) ? data : [];
      setItems(manualItems);

      try {
        const savedPayrollEntries =
          await CoreHrService.listPayrollEntries();

        const monthKeysSet =
          new Set<string>();

        manualItems.forEach(
          (item) => {
            const monthKey =
              monthKeyFromIsoDate(
                String(
                  item?.date ||
                  ""
                )
              );

            if (monthKey) {
              monthKeysSet.add(
                monthKey
              );
            }
          }
        );

        (
          Array.isArray(
            savedPayrollEntries
          )
            ? savedPayrollEntries
            : []
        ).forEach(
          (entry: any) => {
            const monthKey =
              String(
                entry?.payrollMonth ??
                entry?.payroll_month ??
                ""
              ).trim();

            if (
              /^\\d{4}-\\d{2}$/.test(
                monthKey
              )
            ) {
              monthKeysSet.add(
                monthKey
              );
            }
          }
        );

        if (
          /^\\d{4}-\\d{2}$/.test(
            selectedMonthKey
          )
        ) {
          monthKeysSet.add(
            selectedMonthKey
          );
        }

        monthKeysSet.add(
          todayISO().slice(0, 7)
        );

        const expandedMonthKeys =
          new Set<string>();

        monthKeysSet.forEach(
          (monthKey) => {
            expandedMonthKeys.add(
              monthKey
            );

            const previous =
              shiftMonthKey(
                monthKey,
                -1
              );

            const next =
              shiftMonthKey(
                monthKey,
                1
              );

            if (previous) {
              expandedMonthKeys.add(
                previous
              );
            }

            if (next) {
              expandedMonthKeys.add(
                next
              );
            }
          }
        );

        const payrollEntries =
          await generatePayrollEntriesForMonths({
            monthKeys:
              Array.from(
                expandedMonthKeys
              ).sort(
                (left, right) =>
                  left.localeCompare(
                    right
                  )
              ),
          });

        const payrollItems: Expense[] =
          projectCorePayrollEntriesToFinancialRows(
            payrollEntries,
            "calculated"
          ).map((row) => ({
            id: row.id,
            title: row.title,
            category: row.category,
            amount: row.amount,
            date: row.date,
            paymentMethod:
              "transfer" as PaymentMethod,
            note:
              row.note ||
              undefined,
            createdAt:
              row.createdAtMs,
            addedBy:
              row.addedBy,
            createdByName:
              row.addedBy,
            sourceKind:
              "auto_payroll",
            sourceType:
              "payroll",
            sourceRefId:
              "payroll|" +
              String(
                row.employeeId ||
                ""
              ) +
              "|" +
              String(
                row.payrollMonth ||
                ""
              ) +
              "|" +
              row.payrollKind,
            staffId:
              row.employeeId,
            staffName:
              row.employeeName,
            monthKey:
              row.payrollMonth,
            payrollKind:
              row.payrollKind,
          }));

        setAutoPayrollItems(
          payrollItems
        );
        setPayrollLoadWarning("");
      } catch (payrollErr) {
        console.warn(
          "Malikat Core payroll expenses load error:",
          payrollErr
        );

        setPayrollLoadWarning(
          t("تعذر تحديث بيانات الرواتب من المصدر التشغيلي. قد تكون أرقام المصروفات المعروضة غير مكتملة أو تعتمد على آخر بيانات رواتب تم تحميلها بنجاح.")
        );
      }

      try {
        const n = await countMonthlyExpensesMissingNotesCore();
        setMissingNotesCountFS(Number(n || 0));
      } catch {
        setMissingNotesCountFS(0);
      }
    } catch (e) {
      console.error("listAllExpensesCore error:", e);
      setModalMsg(firebaseMsg(e, language));
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
            setItems([]);
            setAutoPayrollItems([]);
            setLoading(false);
            setModalMsg(t("لا يوجد مستخدم مسجل دخول. سجّل دخول الإدارة ثم جرّب."));
            setAuthReady(true);
          }
          return;
        }


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
    if (!title.trim()) return setModalMsg(t("اكتب اسم المصروف"));
    if (!category.trim()) return setModalMsg(t("اختر التصنيف"));
    if (!date) return setModalMsg(t("اختر التاريخ"));
    if (!Number.isFinite(amt) || amt <= 0) return setModalMsg(t("اكتب مبلغ صحيح"));

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
      await upsertExpenseCore(expense);
      await loadExpenses();
      resetForm();
      setAddOpen(false);
      setModalMsg(t("تمت إضافة المصروف بنجاح"));
    } catch (e) {
      console.error("upsertExpenseCore error:", e);
      setModalMsg(firebaseMsg(e, language));
    } finally {
      setLoading(false);
    }
  };

  const removeExpense = async (id: string) => {
    if (isAutoPayrollExpenseId(id)) {
      setModalMsg(t("هذا السجل محسوب تلقائيًا (راتب/أوفر تايم) ولا يمكن حذفه يدويًا."));
      return;
    }
    setConfirmState({
      open: true,
      title: t("تأكيد الحذف"),
      message: t("متأكد تبغى حذف المصروف؟"),
      onConfirm: async () => {
        try {
          setLoading(true);
          await removeExpenseCore(id);
          await loadExpenses();
        } catch (e) {
          console.error("removeExpenseCore error:", e);
          setModalMsg(firebaseMsg(e, language));
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
      setModalMsg(t("هذا السجل محسوب تلقائيًا (راتب/أوفر تايم) ولا يمكن تعديله يدويًا."));
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
      setModalMsg(t("هذا السجل محسوب تلقائيًا (راتب/أوفر تايم) ولا يمكن تعديله يدويًا."));
      return;
    }
    const amt = Number(editForm.amount);

    if (!editForm.title.trim()) return setModalMsg(t("اكتب اسم المصروف"));
    if (!editForm.category.trim()) return setModalMsg(t("اختر التصنيف"));
    if (!editForm.date) return setModalMsg(t("اختر التاريخ"));
    if (!Number.isFinite(amt) || amt <= 0) return setModalMsg(t("اكتب مبلغ صحيح"));

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
      await upsertExpenseCore(updated);
      await loadExpenses();
      setEditId(null);
      setModalMsg(t("تم التعديل ✅"));
    } catch (e) {
      console.error("saveEdit error:", e);
      setModalMsg(firebaseMsg(e, language));
    } finally {
      setLoading(false);
    }
  };

  const migrateLegacyExpensesOnce = async () => {
    try {
      const already = localStorage.getItem(EXPENSES_MIGRATED_KEY) === "1";
      if (already) {
        setModalMsg(t("تم ترحيل المصروفات مسبقًا ✅"));
        setMigrated(true);
        setHasLegacy(false);
        setLegacyCount(0);
        return;
      }

      const legacy = loadLegacyExpenses();
      if (legacy.length === 0) {
        setModalMsg(t("لا توجد مصروفات قديمة في LocalStorage ✅"));
        setHasLegacy(false);
        setLegacyCount(0);
        return;
      }

      setConfirmState({
        open: true,
        title: t("ترحيل المصروفات"),
        message: language === "en"
          ? `${legacy.length} expenses will be migrated from LocalStorage to Firestore.\n${t("ملاحظة: العملية مرة واحدة ولن تتكرر.")}\n\nConfirm?`
          : `سيتم ترحيل ${legacy.length} مصروف من LocalStorage إلى Firestore.\n` +
            `${t("ملاحظة: العملية مرة واحدة ولن تتكرر.")}\n\nتأكيد؟`,
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

              setModalMsg(t("كل السجلات موجودة بالفعل في Firestore ✅"));
              return;
            }

            await Promise.all(toUpsert.map((x) => upsertExpenseCore(x)));

            localStorage.setItem(EXPENSES_MIGRATED_KEY, "1");
            localStorage.removeItem(LEGACY_EXPENSES_KEY);

            setMigrated(true);
            setHasLegacy(false);
            setLegacyCount(0);

            await loadExpenses();
            setModalMsg(language === "en" ? `${toUpsert.length} expenses migrated to Firestore ✅` : `تم ترحيل ${toUpsert.length} مصروف إلى Firestore ✅`);
          } catch (e) {
            console.error("migrateLegacyExpensesOnce error:", e);
            setModalMsg(firebaseMsg(e, language));
          } finally {
            setLoading(false);
            setConfirmState({ open: false });
          }
        },
      });
    } catch (e) {
      console.error("migrateLegacyExpensesOnce error:", e);
      setModalMsg(firebaseMsg(e, language));
    } finally {
      setLoading(false);
    }
  };

  const buildExpensesReportInput = () => ({
    language,
    rows: filtered.map((e) => ({
      date: e.date,
      type: expenseTypeLabel(e, language),
      category: t(String(e.category || "أخرى")),
      title: expenseDisplayTitle(e, language) || e.note || "",
      employeeName: expenseEmployeeLabel(e),
      paymentMethod: paymentMethodLabel(e.paymentMethod, language),
      amount: Number(e.amount || 0),
      source: expenseSourceLabel(e, language),
      addedBy: String((e as any).createdByName || (e as any).addedBy || t("الإدارة")),
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
      mode: recordMode === "payroll_cycle" ? t("دورة الرواتب") : t("شهر تقويمي"),
    },
    generatedBy: t("لوحة المصروفات"),
  });

  const exportPdf = () => {
    if (payrollLoadWarning) return setModalMsg(t("تعذر التصدير لأن بيانات الرواتب غير مكتملة. أعد تحميل الصفحة بعد عودة مصدر الرواتب."));
    if (!filtered.length) return setModalMsg(t("ما فيه بيانات للتصدير"));
    exportExpensesReportPdf(buildExpensesReportInput());
  };

  const exportExcel = () => {
    if (payrollLoadWarning) return setModalMsg(t("تعذر التصدير لأن بيانات الرواتب غير مكتملة. أعد تحميل الصفحة بعد عودة مصدر الرواتب."));
    if (!filtered.length) return setModalMsg(t("ما فيه بيانات للتصدير"));
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

    setModalMsg(t("تمت إضافة التصنيف ✅ (راح ننقله للإعدادات لاحقًا)"));
  };

  if (!authReady) {
    return (
      <div className="dsv2-page expenses-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <section className="dsv2-card dsv2-card--padded expenses-v2-auth-state">
          <DashboardSkeletonV2 variant="title" width="38%" />
          <DashboardSkeletonV2 lines={3} />
        </section>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="dsv2-page expenses-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <DashboardErrorStateV2
          title={t("غير مصرح")}
          description={t("هذه الصفحة خاصة بالمالك والإدارة فقط.")}
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
    { value: "الكل", label: t("الكل") },
    ...runtimeCategories.map((categoryName) => ({ value: categoryName, label: t(categoryName) })),
  ];

  const categoryOptionsNoAll = categories.map((categoryName) => ({
    value: categoryName,
    label: t(categoryName),
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
      .map((value) => ({ value, label: formatMonthKeyLabel(value, language) }));
  })();

  const paymentOptions = [
    { value: "الكل", label: t("الكل") },
    ...paymentMethods.map((p) => ({ value: String(p), label: paymentMethodLabel(p, language) })),
  ];

  const paymentOptionsNoAll = paymentMethods.map((p) => ({
    value: String(p),
    label: paymentMethodLabel(p, language),
  }));

  const recordModeOptions = [
    { value: "calendar", label: t("شهر تقويمي (1-آخر الشهر)") },
    { value: "payroll_cycle", label: language === "en" ? `Payroll cycle (${PAYROLL_CLOSE_DAY + 1}-${PAYROLL_CLOSE_DAY})` : `دورة رواتب (${PAYROLL_CLOSE_DAY + 1}-${PAYROLL_CLOSE_DAY})` },
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
      <div className="dsv2-page expenses-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <section className="dsv2-card expenses-v2-hero">
          <div className="expenses-v2-hero__content">
            <span className="dsv2-badge dsv2-badge--gold">{t("الإدارة المالية")}</span>
            <h1 className="dsv2-page-title">{t("المصروفات")}</h1>
            <p className="dsv2-page-subtitle">
              {t("إدارة المصروفات التشغيلية والرواتب، ومراجعة النواقص والتقارير من مساحة واحدة.")}
            </p>
          </div>

          <div className="expenses-v2-actions" aria-label={t("إجراءات صفحة المصروفات")}>
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => setAddOpen(true)} disabled={loading}>
              <FontAwesomeIcon icon={faPlus} /> {t("إضافة مصروف")}
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => void loadExpenses()} disabled={loading}>
              <FontAwesomeIcon icon={faRotate} /> {t("تحديث")}
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={exportPdf} disabled={loading || !filtered.length}>
              {t("تحميل PDF")}
            </button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={exportExcel} disabled={loading || !filtered.length}>
              {t("Excel منسّق")}
            </button>
            {hasLegacy && !migrated ? (
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => void migrateLegacyExpensesOnce()} disabled={loading}>
                {t("ترحيل القديم")} ({legacyCount})
              </button>
            ) : null}
          </div>
        </section>

        {payrollLoadWarning ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              margin: "0 0 16px",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(180, 120, 0, 0.28)",
              background: "rgba(255, 193, 7, 0.12)",
              fontWeight: 700,
              lineHeight: 1.7,
            }}
          >
            {payrollLoadWarning}
          </div>
        ) : null}

        <section className="expenses-v2-metrics" aria-label={t("ملخص المصروفات")}>
          <article className="dsv2-metric-card dsv2-metric-card--danger">
            <p className="dsv2-metric-card__label">{t("إجمالي المصروفات")}</p>
            <p className="dsv2-metric-card__value">{formatSar(filteredAmount, language)}</p>
            <p className="dsv2-metric-card__meta">{activeRange.from} — {activeRange.to}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--gold">
            <p className="dsv2-metric-card__label">{t("مصروفات الرواتب")}</p>
            <p className="dsv2-metric-card__value">{formatSar(payrollAmount, language)}</p>
            <p className="dsv2-metric-card__meta">{filteredPayrollCount} {t("سجل محسوب تلقائيًا")}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--dark">
            <p className="dsv2-metric-card__label">{t("المصروفات التشغيلية")}</p>
            <p className="dsv2-metric-card__value">{formatSar(manualAmount, language)}</p>
            <p className="dsv2-metric-card__meta">{filteredManualCount} {t("سجل يدوي")}</p>
          </article>
          <article className="dsv2-metric-card dsv2-metric-card--gold">
            <p className="dsv2-metric-card__label">{t("تحتاج ملاحظة")}</p>
            <p className="dsv2-metric-card__value">{missingNotesInActiveRange}</p>
            <p className="dsv2-metric-card__meta">{t("ضمن الفترة الحالية")}</p>
          </article>
        </section>

        <section className="expenses-v2-cycle-strip" aria-label={t("الفترة المرجعية")}>
          <div><strong>{t("الفترة المعروضة")}</strong><span>{activeRange.from} {t("إلى")} {activeRange.to}</span></div>
          <div><strong>{t("الدورة المرجعية")}</strong><span>{activePayrollCycleKey}</span></div>
          <div><strong>{t("التصنيفات الظاهرة")}</strong><span>{categoryCount}</span></div>
          <div><strong>{t("إغلاق الرواتب")}</strong><span>{t("يوم")} {PAYROLL_CLOSE_DAY} {t("من كل شهر")}</span></div>
        </section>

        <section className="dsv2-card dsv2-card--padded expenses-v2-filter-card">
          <div className="expenses-v2-section-head">
            <div>
              <span className="dsv2-badge dsv2-badge--neutral">{t("الفلاتر")}</span>
              <h2>{t("سجل المصروفات")}</h2>
              <p>{t("غيّر الفترة والتصنيف وطريقة الدفع أو ابحث داخل السجلات.")}</p>
            </div>
            <div className="expenses-v2-filter-actions">
              <button
                className={`dsv2-btn dsv2-btn--sm ${onlyMissingNotes ? "dsv2-btn--accent" : "dsv2-btn--secondary"}`}
                type="button"
                onClick={() => setOnlyMissingNotes((value) => !value)}
              >
                {onlyMissingNotes ? t("عرض الكل") : t("بدون ملاحظات")}
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
                {t("تصفير الفلاتر")}
              </button>
            </div>
          </div>

          <div className="expenses-v2-filter-grid">
            <DashboardFieldV2 id="expenses-v2-mode" label={t("وضع العرض")}>
              <DashboardSelectV2
                id="expenses-v2-mode"
                options={recordModeOptions}
                value={recordMode}
                onChange={(value) => setRecordMode(value === "payroll_cycle" ? "payroll_cycle" : "calendar")}
                disabled={loading}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="expenses-v2-month" label={t("الشهر المرجعي")}>
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
            <DashboardFieldV2 id="expenses-v2-category" label={t("التصنيف")}>
              <DashboardSelectV2 id="expenses-v2-category" options={categoryOptions} value={fCategory} onChange={setFCategory} disabled={loading} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="expenses-v2-payment" label={t("طريقة الدفع")}>
              <DashboardSelectV2 id="expenses-v2-payment" options={paymentOptions} value={fPayment} onChange={setFPayment} disabled={loading} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="expenses-v2-search" label={t("البحث")} className="expenses-v2-search-field">
              <div className="expenses-v2-search-control">
                <FontAwesomeIcon icon={faMagnifyingGlass} />
                <input
                  id="expenses-v2-search"
                  className="dsv2-input"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder={t("الوصف، الموظفة، المصدر أو الملاحظات")}
                />
              </div>
            </DashboardFieldV2>
          </div>
        </section>

        <section className="dsv2-table-card expenses-v2-table-card">
          <header className="expenses-v2-table-head">
            <div>
              <h2>{t("تفاصيل المصروفات")}</h2>
              <p>{filtered.length} {t("سجل مطابق للفلاتر الحالية")}</p>
            </div>
            <span className="dsv2-badge dsv2-badge--gold">{formatSar(filteredAmount, language)}</span>
          </header>

          {loading ? (
            <div className="expenses-v2-loading-table">
              <DashboardSkeletonV2 variant="title" width="32%" />
              <DashboardSkeletonV2 lines={8} />
            </div>
          ) : !filtered.length ? (
            <div className="expenses-v2-state-wrap">
              <DashboardEmptyStateV2
                title={t("لا توجد مصروفات مطابقة")}
                description={t("غيّر الفلاتر أو أضف مصروفًا جديدًا لبدء عرض البيانات.")}
                tone="gold"
                action={<button className="dsv2-btn dsv2-btn--accent" type="button" onClick={() => setAddOpen(true)}>{t("إضافة مصروف")}</button>}
              />
            </div>
          ) : (
            <>
              <div className="dsv2-table-scroll expenses-v2-desktop-table">
                <table className="dsv2-table expenses-v2-table">
                  <thead>
                    <tr>
                      <th>{t("التاريخ")}</th><th>{t("النوع")}</th><th>{t("الوصف")}</th><th>{t("الموظفة")}</th><th>{t("التصنيف")}</th><th>{t("الدفع")}</th><th>{t("المبلغ")}</th><th>{t("المصدر")}</th><th>{t("ملاحظات")}</th><th>{t("إجراء")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const autoPayroll = isAutoPayrollExpenseId(item.id);
                      return (
                        <tr key={item.id}>
                          <td><span className="dsv2-table__primary">{formatDateDisplay(item.date)}</span>{item.monthKey ? <small className="dsv2-table__secondary">{item.monthKey}</small> : null}</td>
                          <td><span className="expenses-v2-type-badge" data-type={payrollKindFromExpense(item)}>{expenseTypeLabel(item, language)}</span></td>
                          <td><span className="dsv2-table__primary expenses-v2-title-cell" title={expenseDisplayTitle(item, language) || item.note || "—"}>{expenseDisplayTitle(item, language) || item.note || "—"}</span></td>
                          <td>{expenseEmployeeLabel(item)}</td>
                          <td>{t(item.category || "أخرى")}</td>
                          <td><span className="expenses-v2-payment-badge" data-method={paymentMethodTone(item.paymentMethod)}>{paymentMethodLabel(item.paymentMethod, language)}</span></td>
                          <td><strong className="expenses-v2-amount">{formatSar(item.amount, language)}</strong></td>
                          <td>{expenseSourceLabel(item, language)}</td>
                          <td className="expenses-v2-note-cell">{item.note || <span className="expenses-v2-missing-note">{t("بدون ملاحظة")}</span>}</td>
                          <td>
                            <div className="expenses-v2-row-actions">
                              <button className="dsv2-icon-btn" type="button" aria-label={t("عرض التفاصيل")} title={t("عرض التفاصيل")} onClick={() => setDetailsTarget(item)}><FontAwesomeIcon icon={faEye} /></button>
                              {!autoPayroll ? <button className="dsv2-icon-btn" type="button" aria-label={t("تعديل")} title={t("تعديل")} onClick={() => startEdit(item)}><FontAwesomeIcon icon={faPen} /></button> : null}
                              {!autoPayroll ? <button className="dsv2-icon-btn expenses-v2-delete-action" type="button" aria-label={t("حذف")} title={t("حذف")} onClick={() => void removeExpense(item.id)}><FontAwesomeIcon icon={faTrash} /></button> : null}
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
                      <header><div><span>{formatDateDisplay(item.date)}</span><strong>{expenseDisplayTitle(item, language) || item.note || "—"}</strong></div><strong className="expenses-v2-amount">{formatSar(item.amount, language)}</strong></header>
                      <div className="expenses-v2-mobile-meta"><span>{expenseTypeLabel(item, language)}</span><span>{t(item.category || "أخرى")}</span><span>{paymentMethodLabel(item.paymentMethod, language)}</span><span>{expenseSourceLabel(item, language)}</span></div>
                      <p>{item.note || t("بدون ملاحظة")}</p>
                      <footer>
                        <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => setDetailsTarget(item)}><FontAwesomeIcon icon={faEye} /> {t("التفاصيل")}</button>
                        {!autoPayroll ? <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => startEdit(item)}><FontAwesomeIcon icon={faPen} /> {t("تعديل")}</button> : null}
                        {!autoPayroll ? <button className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" type="button" onClick={() => void removeExpense(item.id)}><FontAwesomeIcon icon={faTrash} /> {t("حذف")}</button> : null}
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
        title={t("إضافة مصروف")}
        description={t("سجّل بيانات المصروف ليظهر مباشرة في السجل والتقارير.")}
        eyebrow={t("المصروفات")}
        size="md"
        tone="gold"
        closeOnBackdrop={!loading}
        closeOnEscape={!loading}
        footer={
          <>
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => void addExpense()} disabled={loading}>{loading ? t("جارٍ الحفظ...") : t("حفظ المصروف")}</button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => setAddOpen(false)} disabled={loading}>{t("إلغاء")}</button>
          </>
        }
      >
        <div className="expenses-v2-modal-grid">
          <DashboardFieldV2 id="expenses-v2-add-title" label={t("اسم المصروف")} required>
            <input id="expenses-v2-add-title" className="dsv2-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("مثال: شراء منتجات")} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-category" label={t("التصنيف")} required>
            <DashboardSelectV2 id="expenses-v2-add-category" options={categoryOptionsNoAll.length ? categoryOptionsNoAll : [{ value: "أخرى", label: t("أخرى") }]} value={category} onChange={setCategory} disabled={loading} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-amount" label={t("المبلغ (ر.س)")} required>
            <DashboardNumberInputV2 id="expenses-v2-add-amount" className="dsv2-input" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-date" label={t("التاريخ")} required>
            <DashboardDatePickerV2 id="expenses-v2-add-date" value={date} onChange={setDate} required clearable={false} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-payment" label={t("طريقة الدفع")} required>
            <DashboardSelectV2 id="expenses-v2-add-payment" options={paymentOptionsNoAll.length ? paymentOptionsNoAll : [{ value: "كاش", label: t("كاش") }, { value: "شبكة", label: t("شبكة") }, { value: "تحويل", label: t("تحويل") }]} value={String(paymentMethod)} onChange={(value) => setPaymentMethod(value as PaymentMethod)} disabled={loading} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-add-note" label={t("ملاحظات")} className="expenses-v2-field--wide">
            <textarea id="expenses-v2-add-note" className="dsv2-textarea" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("أي تفاصيل إضافية")} />
          </DashboardFieldV2>
          <div className="expenses-v2-quick-category expenses-v2-field--wide">
            <div><strong>{t("إضافة تصنيف سريع")}</strong><span>{t("سيُحفظ ضمن إعدادات التصنيفات المالية.")}</span></div>
            <input className="dsv2-input" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder={t("مثال: تأمين")} />
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={addCategoryQuick}>{t("إضافة")}</button>
          </div>
        </div>
      </DashboardModalV2>

      <DashboardModalV2
        open={Boolean(editTarget)}
        onClose={cancelEdit}
        title={t("تعديل المصروف")}
        description={t("عدّل بيانات السجل اليدوي ثم احفظ التغييرات.")}
        eyebrow={t("تعديل السجل")}
        size="md"
        tone="gold"
        closeOnBackdrop={!loading}
        closeOnEscape={!loading}
        footer={
          <>
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => editTarget && void saveEdit(editTarget)} disabled={loading}>{loading ? t("جارٍ الحفظ...") : t("حفظ التعديل")}</button>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={cancelEdit} disabled={loading}>{t("إلغاء")}</button>
          </>
        }
      >
        <div className="expenses-v2-modal-grid">
          <DashboardFieldV2 id="expenses-v2-edit-title" label={t("اسم المصروف")} required>
            <input id="expenses-v2-edit-title" className="dsv2-input" value={editForm.title} onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-category" label={t("التصنيف")} required>
            <DashboardSelectV2 id="expenses-v2-edit-category" options={categoryOptionsNoAll.length ? categoryOptionsNoAll : [{ value: "أخرى", label: t("أخرى") }]} value={editForm.category} onChange={(value) => setEditForm((prev) => ({ ...prev, category: value }))} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-amount" label={t("المبلغ (ر.س)")} required>
            <DashboardNumberInputV2 id="expenses-v2-edit-amount" className="dsv2-input" min="0" step="0.01" value={editForm.amount} onChange={(event) => setEditForm((prev) => ({ ...prev, amount: event.target.value }))} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-date" label={t("التاريخ")} required>
            <DashboardDatePickerV2 id="expenses-v2-edit-date" value={editForm.date} onChange={(value) => setEditForm((prev) => ({ ...prev, date: value }))} required clearable={false} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-payment" label={t("طريقة الدفع")} required>
            <DashboardSelectV2 id="expenses-v2-edit-payment" options={paymentOptionsNoAll.length ? paymentOptionsNoAll : [{ value: "كاش", label: t("كاش") }, { value: "شبكة", label: t("شبكة") }, { value: "تحويل", label: t("تحويل") }]} value={editForm.paymentMethod} onChange={(value) => setEditForm((prev) => ({ ...prev, paymentMethod: value }))} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="expenses-v2-edit-note" label={t("ملاحظات")} className="expenses-v2-field--wide">
            <textarea id="expenses-v2-edit-note" className="dsv2-textarea" value={editForm.note} onChange={(event) => setEditForm((prev) => ({ ...prev, note: event.target.value }))} />
          </DashboardFieldV2>
        </div>
      </DashboardModalV2>

      <DashboardConfirmV2
        open={confirmState.open}
        onClose={() => setConfirmState({ open: false })}
        onConfirm={async () => { await confirmState.onConfirm?.(); }}
        title={confirmState.title || t("تأكيد الإجراء")}
        description={confirmState.message}
        tone="danger"
        confirmLabel={t("تأكيد")}
        cancelLabel={t("تراجع")}
      />

      <DashboardModalV2
        open={Boolean(modalMsg)}
        onClose={() => setModalMsg("")}
        title={modalMsg.includes("تعذر") || modalMsg.includes("غير مصرح") || modalMsg.includes("Could not") || modalMsg.includes("Access denied") || modalMsg.includes("⚠️") ? t("تعذر تنفيذ العملية") : t("تم تنفيذ العملية")}
        description={modalMsg}
        size="sm"
        tone={modalMsg.includes("تعذر") || modalMsg.includes("Could not") || modalMsg.includes("⚠️") ? "danger" : "success"}
        footer={<button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => setModalMsg("")}>{t("حسنًا")}</button>}
      ><div /></DashboardModalV2>

      {detailsTarget ? (
        <DashboardDrawerV2
          open={Boolean(detailsTarget)}
          onClose={() => setDetailsTarget(null)}
          title={t("تفاصيل المصروف")}
          description={t("عرض سريع لبيانات السجل ومصدره.")}
          eyebrow={detailsTarget.id}
          size="md"
          side="end"
          tone={payrollKindFromExpense(detailsTarget) === "manual" ? "gold" : "success"}
          footer={
            <>
              {!isAutoPayrollExpenseId(detailsTarget.id) ? <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => { startEdit(detailsTarget); setDetailsTarget(null); }}>{t("تعديل المصروف")}</button> : null}
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => setDetailsTarget(null)}>{t("إغلاق")}</button>
            </>
          }
        >
          <div className="expenses-v2-drawer-content">
            <article className="dsv2-metric-card dsv2-metric-card--danger">
              <p className="dsv2-metric-card__label">{t("المبلغ المسجل")}</p>
              <p className="dsv2-metric-card__value">{formatSar(detailsTarget.amount, language)}</p>
              <p className="dsv2-metric-card__meta">{expenseTypeLabel(detailsTarget, language)}</p>
            </article>
            <dl className="expenses-v2-detail-list">
              <div><dt>{t("الوصف")}</dt><dd>{expenseDisplayTitle(detailsTarget, language) || "—"}</dd></div>
              <div><dt>{t("التاريخ")}</dt><dd>{formatDateDisplay(detailsTarget.date)}</dd></div>
              <div><dt>{t("التصنيف")}</dt><dd>{t(detailsTarget.category || "أخرى")}</dd></div>
              <div><dt>{t("طريقة الدفع")}</dt><dd>{paymentMethodLabel(detailsTarget.paymentMethod, language)}</dd></div>
              <div><dt>{t("الموظفة")}</dt><dd>{expenseEmployeeLabel(detailsTarget)}</dd></div>
              <div><dt>{t("المصدر")}</dt><dd>{expenseSourceLabel(detailsTarget, language)}</dd></div>
              <div><dt>{t("دورة الرواتب")}</dt><dd>{detailsTarget.monthKey || "—"}</dd></div>
              <div><dt>{t("ملاحظات")}</dt><dd>{detailsTarget.note || t("لا توجد ملاحظات")}</dd></div>
            </dl>
          </div>
        </DashboardDrawerV2>
      ) : null}
    </>
  );
};

export default DashboardExpenses;
