// ✅ src/pages/DashboardExpenses.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileCsv } from "@fortawesome/free-solid-svg-icons";
/**
 * ✅ قاعدة الاستيراد:
 * - المشترك/العام أولاً
 * - ستايل الصفحة الخاصة آخر شيء عشان يفوز بالأولوية
 */
import "../styles/DashboardModals.css";
import "../styles/DashboardExpenses.css";

import type { Expense, PaymentMethod } from "../types/finance";
import { FinanceSettingsService } from "../services/FinanceSettingsService";

// ✅ Firebase Auth
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../services/firebase";

// ✅ Firestore Expenses
import {
  listAllExpensesFS,
  removeExpenseFS,
  upsertExpenseFS,
  countMonthlyExpensesMissingNotesFS, // ✅ إضافة
} from "../services/firestoreExpenses";

type UiRole = "owner" | "admin" | "staff" | "client" | "guest";

function getUiRole(): UiRole {
  const raw = (localStorage.getItem("userRole") || "").toLowerCase().trim();
  if (raw === "owner") return "owner";
  if (raw === "admin") return "admin";
  if (raw === "staff") return "staff";
  if (raw === "client") return "client";
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
    return "⚠️ لا توجد صلاحيات كافية. تأكد من Firestore Rules + role داخل users/{uid} + تسجيل الدخول.";
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

function parseISODate(iso: string) {
  // iso: YYYY-MM-DD
  const [y, m, d] = String(iso || "").split("-").map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// ✅ أسبوع يبدأ السبت
function startOfWeekSaturday(d: Date) {
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const diff = (day - 6 + 7) % 7; // days since Saturday
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - diff);
  return s;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
              className={`dash-dd-item ${value === opt.value ? "is-active" : ""}`}
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
  const role = getUiRole();
  const allowed = role === "owner" || role === "admin";

  // ✅ settings
  const [categories, setCategories] = useState<string[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);

  // ✅ data (Firestore)
  const [items, setItems] = useState<Expense[]>([]);
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

  // ✅ سجل المصروفات (Modal)
  const [recordOpen, setRecordOpen] = useState(false);

  // ✅ form
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("أخرى");
  const [amount, setAmount] = useState<string>("");
  const [date, setDate] = useState(todayISO());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    ("كاش" as unknown) as PaymentMethod
  );
  const [note, setNote] = useState("");

  // ✅ quick add category
  const [newCategory, setNewCategory] = useState("");

  // ✅ filters (للسجل داخل المودال)
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
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

  // ✅ تحميل الإعدادات مرة واحدة (FIX: get() قد يرجّع Promise)
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const fs = await FinanceSettingsService.get();

        const cats = (fs?.expenseCategories?.length
          ? fs.expenseCategories
          : ["أخرى"]) as string[];

        const pays = (fs?.paymentMethods?.length
          ? (fs.paymentMethods as any)
          : (["كاش"] as any)) as PaymentMethod[];

        if (!mounted) return;

        setCategories(cats);
        setPaymentMethods(pays);

        setCategory((prev) =>
          prev && cats.includes(prev) ? prev : cats[0] || "أخرى"
        );
        setPaymentMethod((prev) => (prev ? prev : pays[0]));
      } catch (e) {
        console.error("FinanceSettingsService.get() failed:", e);

        if (!mounted) return;

        const cats = ["أخرى"];
        const pays = (["كاش"] as any) as PaymentMethod[];

        setCategories(cats);
        setPaymentMethods(pays);
        setCategory((prev) => (prev && cats.includes(prev) ? prev : "أخرى"));
        setPaymentMethod((prev) => (prev ? prev : pays[0]));
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ دالة تحميل Firestore
  const loadExpenses = async () => {
    try {
      setLoading(true);
      const data = await listAllExpensesFS();
      setItems(Array.isArray(data) ? data : []);

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
    } finally {
      setLoading(false);
    }
  };

  // ✅ تحميل Firestore بعد ثبات تسجيل الدخول (مرة وحدة)
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        const user = await new Promise<import("firebase/auth").User | null>(
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
            setLoading(false);
            setModalMsg("لا يوجد مستخدم مسجل دخول. سجّل دخول الإدارة ثم جرّب.");
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
        if (mounted) setLoading(false);
      }
    };

    run();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ====== ملخص اليوم/الأسبوع/الشهر (لوحة خفيفة) ======
  const summary = useMemo(() => {
    const now = new Date();
    const startWeek = startOfWeekSaturday(now);
    const endWeek = new Date(startWeek);
    endWeek.setDate(endWeek.getDate() + 7);

    const monthKey = todayISO().slice(0, 7); // YYYY-MM
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(
      prevMonthDate.getMonth() + 1
    ).padStart(2, "0")}`;

    let todayTotal = 0;
    let weekTotal = 0;
    let monthTotal = 0;
    let prevMonthTotal = 0;

    items.forEach((e) => {
      const amt = Number(e.amount) || 0;
      const d = parseISODate(e.date);
      if (d) {
        if (isSameDay(d, now)) todayTotal += amt;
        if (d >= startWeek && d < endWeek) weekTotal += amt;
      }
      if ((e.date || "").startsWith(monthKey)) monthTotal += amt;
      if ((e.date || "").startsWith(prevMonthKey)) prevMonthTotal += amt;
    });

    return { todayTotal, weekTotal, monthTotal, prevMonthTotal };
  }, [items]);

  // ====== تنبيهات ذكية (سطرية خفيفة) ======
  const smartAlerts = useMemo(() => {
    const alerts: { icon: string; text: string }[] = [];

    // 1) مقارنة الشهر الحالي بالسابق
    if (summary.prevMonthTotal > 0) {
      const diff = summary.monthTotal - summary.prevMonthTotal;
      const pct = (diff / summary.prevMonthTotal) * 100;
      const dir = diff >= 0 ? "أعلى" : "أقل";
      alerts.push({
        icon: diff >= 0 ? "📈" : "📉",
        text: `مصروفات هذا الشهر ${dir} من الشهر الماضي بـ ${Math.abs(pct).toFixed(
          0
        )}%`,
      });
    } else if (summary.monthTotal > 0) {
      alerts.push({
        icon: "ℹ️",
        text: "الشهر الماضي: لا توجد مصروفات مسجلة للمقارنة",
      });
    }

    // 2) أعلى تصنيف هذا الشهر
    const monthKey = todayISO().slice(0, 7);
    const map = new Map<string, number>();
    items.forEach((e) => {
      if ((e.date || "").startsWith(monthKey)) {
        const k = e.category || "أخرى";
        map.set(k, (map.get(k) || 0) + (Number(e.amount) || 0));
      }
    });
    const top = Array.from(map.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top) {
      alerts.push({
        icon: "📌",
        text: `أعلى تصنيف هذا الشهر: ${top[0]} (${money(top[1])} ريال)`,
      });
    }

    // 3) بدون ملاحظات (هذا الشهر)
    const missingNotes = items.filter((e) => {
      if (!e.date || !e.date.startsWith(monthKey)) return false;
      const n = String(e.note ?? "").trim();
      return !n;
    }).length;

    if (missingNotes > 0) {
      alerts.push({
        icon: "⚠️",
        text: `${missingNotes} مصروف/مصروفات هذا الشهر بدون ملاحظات`,
      });
    } else if (items.some((e) => (e.date || "").startsWith(monthKey))) {
      alerts.push({
        icon: "✅",
        text: "كل مصروفات هذا الشهر تحتوي على ملاحظات",
      });
    }

    return alerts.slice(0, 4);
  }, [items, summary.monthTotal, summary.prevMonthTotal]);

  // ====== الفلاتر (للسجل داخل المودال) ======
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((e) => {
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      if (fCategory !== "الكل" && e.category !== fCategory) return false;
      if (fPayment !== "الكل" && String(e.paymentMethod) !== String(fPayment))
        return false;

      if (query) {
        const hay = `${e.title} ${e.category} ${e.note || ""}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      // ✅ NEW: فلترة الناقص ملاحظة فقط
      if (onlyMissingNotes) {
        const n = String(e.note ?? "").trim();
        if (n) return false;
      }
      return true;
    });
  }, [items, from, to, fCategory, fPayment, q, onlyMissingNotes]);

  const totalFiltered = useMemo(
    () => filtered.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [filtered]
  );

  const byCategoryFiltered = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((e) => {
      map.set(
        e.category,
        (map.get(e.category) || 0) + (Number(e.amount) || 0)
      );
    });

    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // ====== فورم الإضافة ======
  const resetForm = () => {
    setTitle("");
    setAmount("");
    setNote("");
    setDate(todayISO());
    setCategory(categories[0] || "أخرى");
    setPaymentMethod(
      ((paymentMethods[0] || ("كاش" as any)) as unknown) as PaymentMethod
    );
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

  const exportCsv = () => {
    if (!filtered.length) return setModalMsg("ما فيه بيانات للتصدير");

    const rows = filtered.map((e) => ({
      التاريخ: e.date,
      المصروف: e.title,
      التصنيف: e.category,
      المبلغ: e.amount,
      طريقة_الدفع: e.paymentMethod,
      ملاحظات: e.note || "",
    }));

    const csv = toCsv(rows);
    const filename = `expenses_${from || "all"}_${to || "all"}.csv`;
    downloadTextFile(filename, csv);
  };

  const addCategoryQuick = async () => {
    const n = newCategory.trim();
    if (!n) return;

    FinanceSettingsService.addCategory(n);
    setNewCategory("");

    // ✅ FIX: get() قد يرجّع Promise
    const fresh = await FinanceSettingsService.get();

    const cats = (fresh?.expenseCategories?.length
      ? fresh.expenseCategories
      : ["أخرى"]) as string[];

    setCategories(cats);
    if (!cats.includes(category)) setCategory(cats[0] || "أخرى");

    setModalMsg("تمت إضافة التصنيف ✅ (راح ننقله للإعدادات لاحقًا)");
  };

  if (!allowed) {
    return (
      <div className="exp-page">
        <div className="exp-card">
          <h2>غير مصرح</h2>
          <p>هذه الصفحة خاصة بالمالك/الإدارة فقط.</p>
        </div>
      </div>
    );
  }

  // ✅ خيارات الدروب داون (نفس الشكل)
  const categoryOptions: DDOption[] = [
    { value: "الكل", label: "الكل" },
    ...categories.map((c) => ({ value: c, label: c })),
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

  return (
    <div className="exp-page">
      {/* ===== Header + Actions (بدون تكرار) ===== */}
      {missingNotesCountFS > 0 ? (
        <div className="exp-alert-card">
          <div className="exp-alert-left">
            <div className="exp-alert-ico">⚠️</div>
            <div className="exp-alert-texts">
              <div className="exp-alert-title">تنبيه</div>
              <div className="exp-alert-desc">
                عندك <b>{missingNotesCountFS}</b> مصروف هذا الشهر بدون ملاحظات.
              </div>
            </div>
          </div>

          <div className="exp-alert-right">
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
              className="reports-btn"
              type="button"
              onClick={() => {
                setOnlyMissingNotes(true);
                setFrom("");
                setTo("");
                setFCategory("الكل");
                setFPayment("الكل");
                setQ("");
                setRecordOpen(true);
              }}
            >
              عرض المصروفات بدون ملاحظات
            </button>

            <button
              className="reports-btn primary"
              type="button"
              onClick={() => {
                setOnlyMissingNotes(false);
                setRecordOpen(true);
              }}
            >
              عرض كل المصروفات
            </button>
          </div>
        </div>
      ) : null}

      {/* ===== Summary Cards (3 فقط) ===== */}
      <div className="exp-stats" style={{ marginTop: 12 }}>
        <div className="exp-stat">
          <div className="k">مصروفات اليوم</div>
          <div className="v">{money(summary.todayTotal)} ريال</div>
        </div>

        <div className="exp-stat">
          <div className="k">مصروفات هذا الأسبوع (يبدأ السبت)</div>
          <div className="v">{money(summary.weekTotal)} ريال</div>
        </div>

        <div className="exp-stat">
          <div className="k">مصروفات هذا الشهر</div>
          <div className="v">{money(summary.monthTotal)} ريال</div>
        </div>
      </div>

      {/* ===== Smart Alerts (سطرية خفيفة) ===== */}
      <div className="exp-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginBottom: 10 }}>تنبيهات ذكية</h3>

        {smartAlerts.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            لا توجد تنبيهات حالياً — أضف مصروفات وستظهر التحليلات تلقائيًا.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {smartAlerts.map((a, i) => (
              <div
                key={`al_${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 14,
                  background: "#fff",
                  fontSize: 13,
                }}
              >
                <span style={{ width: 22, textAlign: "center" }}>{a.icon}</span>
                <span>{a.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Main Grid: Add Form فقط ===== */}
      <div className="exp-grid" style={{ marginTop: 12 }}>
        <div className="exp-card">
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
              {/* ✅ Custom Dropdown بدل select */}
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
              {/* ✅ Custom Dropdown بدل select */}
              <DashDropdown
                value={String(paymentMethod)}
                onChange={(v) =>
                  setPaymentMethod(v as unknown as PaymentMethod)
                }
                options={
                  paymentOptionsNoAll.length
                    ? paymentOptionsNoAll
                    : [{ value: "كاش", label: "كاش" }]
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

        {/* ✅ لوحة ملخص بدل الفراغ */}
        <div className="exp-card">
          <h3 style={{ marginBottom: 10 }}>ملخص سريع</h3>

          {/* أعلى 3 تصنيفات (هذا الشهر) */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 20, marginBottom: 8 }}>
              أعلى 3 تصنيفات (هذا الشهر)
            </div>

            {(() => {
              const monthKey = todayISO().slice(0, 7);
              const map = new Map<string, number>();

              items.forEach((e) => {
                if ((e.date || "").startsWith(monthKey)) {
                  const cat = (e.category || "أخرى").trim() || "أخرى";
                  map.set(cat, (map.get(cat) || 0) + (Number(e.amount) || 0));
                }
              });

              const top3 = Array.from(map.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

              if (!top3.length)
                return <div style={{ fontSize: 13, opacity: 0.75 }}>—</div>;

              return (
                <div style={{ display: "grid", gap: 8 }}>
                  {top3.map(([name, value]) => (
                    <div
                      key={name}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 12px",
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 14,
                        background: "#fff",
                        fontSize: 13,
                      }}
                    >
                      <span>{name}</span>
                      <b>{money(value)} ريال</b>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* آخر 5 مصروفات */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 20 }}>آخر 5 مصروفات</div>
            </div>

            {(() => {
              const latest = [...items]
                .sort(
                  (a, b) =>
                    (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)
                )
                .slice(0, 5);

              if (!latest.length) {
                return (
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    لا يوجد مصروفات بعد.
                  </div>
                );
              }

              return (
                <div style={{ display: "grid", gap: 8 }}>
                  {latest.map((e) => (
                    <div
                      key={e.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "10px 12px",
                        border: "1px solid rgba(0,0,0,0.08)",
                        borderRadius: 14,
                        background: "#fff",
                        fontSize: 13,
                      }}
                    >
                      <div style={{ display: "grid", gap: 2 }}>
                        <b>{e.title}</b>
                        <span style={{ opacity: 0.75 }}>
                          {e.date} • {e.category}
                        </span>
                      </div>
                      <b>{money(Number(e.amount) || 0)} ريال</b>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ===== سجل المصروفات (Modal كبير) ===== */}
      {recordOpen ? (
        <div
          className="dash-modal-overlay"
          onClick={() => setRecordOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999999,
            padding: 16,
          }}
        >
          <div
            className="dash-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1180px, 96vw)",
              maxHeight: "86vh",
              overflow: "auto",
              background: "#fff",
              borderRadius: 18,
              padding: 16,
              boxShadow: "0 14px 40px rgba(0,0,0,0.22)",
              direction: "rtl",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div>
                <h3 style={{ margin: 0 }}>سجل المصروفات</h3>
                <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
                  فلترة + بحث + جدول عريض + توزيع حسب التصنيف
                </div>
              </div>

              <div className="ep-filter-row">
                <button
                  className="exp-btn"
                  onClick={loadExpenses}
                  disabled={loading}
                  type="button"
                >
                  تحديث
                </button>

                <button
                  className="reports-btn"
                  type="button"
                  onClick={exportCsv}
                  disabled={loading}
                  title="Excel .xlsx"
                >
                  <FontAwesomeIcon icon={faFileCsv} /> تصدير Excel
                </button>

                <button
                  className="exp-btn primary"
                  onClick={() => setRecordOpen(false)}
                  type="button"
                >
                  إغلاق
                </button>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div className="exp-filters">
                <label>
                  من
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>

                <label>
                  إلى
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>

                <label>
                  التصنيف
                  {/* ✅ Custom Dropdown بدل select */}
                  <DashDropdown
                    value={fCategory}
                    onChange={(v) => setFCategory(v)}
                    options={categoryOptions}
                    disabled={loading}
                  />
                </label>

                <label>
                  الدفع
                  {/* ✅ Custom Dropdown بدل select */}
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
                    placeholder="اسم/تصنيف/ملاحظة..."
                  />
                </label>

                <div className="span-2 exp-actions">
                  <button
                    className="exp-btn"
                    type="button"
                    onClick={() => {
                      setFrom("");
                      setTo("");
                      setFCategory("الكل");
                      setFPayment("الكل");
                      setQ("");
                    }}
                  >
                    تصفير الفلاتر
                  </button>

                  <div
                    style={{
                      marginInlineStart: "auto",
                      fontSize: 13,
                      opacity: 0.85,
                    }}
                  >
                    الإجمالي بعد الفلترة: <b>{money(totalFiltered)} ريال</b>
                  </div>
                </div>
              </div>

              <div className="exp-table-wrap" style={{ marginTop: 10 }}>
                <table className="exp-table">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      <th>المصروف</th>
                      <th>التصنيف</th>
                      <th>الدفع</th>
                      <th>المبلغ</th>
                      <th>ملاحظات</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>

                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7} className="empty">
                          جاري تحميل المصروفات...
                        </td>
                      </tr>
                    ) : filtered.length ? (
                      filtered.map((e) => {
                        const isEdit = editId === e.id;

                        return (
                          <tr key={e.id}>
                            {/* التاريخ */}
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

                            {/* المصروف */}
                            <td data-label="التصنيف" className="strong">
                              {isEdit ? (
                                <input
                                  value={editForm.title}
                                  onChange={(ev) =>
                                    setEditForm((p) => ({
                                      ...p,
                                      title: ev.target.value,
                                    }))
                                  }
                                  placeholder="اسم المصروف"
                                />
                              ) : (
                                e.title
                              )}
                            </td>

                            {/* التصنيف */}
                            <td data-label="التصنيف">
                              {isEdit ? (
                                <DashDropdown
                                  value={editForm.category}
                                  onChange={(v) =>
                                    setEditForm((p) => ({
                                      ...p,
                                      category: v,
                                    }))
                                  }
                                  options={
                                    categoryOptionsNoAll.length
                                      ? categoryOptionsNoAll
                                      : [{ value: "أخرى", label: "أخرى" }]
                                  }
                                  disabled={loading}
                                />
                              ) : (
                                e.category
                              )}
                            </td>

                            {/* الدفع */}
                            <td data-label="الدفع">
                              {isEdit ? (
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
                                      : [{ value: "كاش", label: "كاش" }]
                                  }
                                  disabled={loading}
                                />
                              ) : (
                                String(e.paymentMethod)
                              )}
                            </td>

                            {/* المبلغ */}
                            <td data-label="المبلغ" className="amount">
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
                                <>
                                  {money(e.amount)} ريال
                                </>
                              )}
                            </td>

                            {/* ملاحظات */}
                            <td data-label="ملاحظات" className="muted">
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
                                e.note || "—"
                              )}
                            </td>

                            {/* إجراء */}
                            <td data-label="إجراء">
                              {isEdit ? (
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
                        <td colSpan={7} className="empty">
                          ما فيه مصروفات حسب الفلاتر الحالية.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="exp-breakdown" style={{ marginTop: 12 }}>
                <div className="bd-head">
                  <div>
                    <div className="bd-title">توزيع المصروفات حسب التصنيف</div>
                    <div className="bd-sub">
                      الإجمالي بعد الفلترة: <b>{money(totalFiltered)} ريال</b>
                    </div>
                  </div>
                  <div className="bd-pill">{byCategoryFiltered.length} تصنيف</div>
                </div>

                <div className="bd-list">
                  {byCategoryFiltered.length ? (
                    byCategoryFiltered.map((c) => {
                      const pct =
                        totalFiltered > 0
                          ? Math.round((c.value / totalFiltered) * 100)
                          : 0;

                      return (
                        <div key={c.name} className="bd-item">
                          <div className="bd-row">
                            <div className="bd-left">
                              <span className="bd-dot" />
                              <span className="bd-name">{c.name}</span>
                            </div>

                            <div className="bd-right">
                              <span className="bd-amount">
                                {money(c.value)} ريال
                              </span>
                              <span className="bd-pct">{pct}%</span>
                            </div>
                          </div>

                          <div className="bd-bar">
                            <div
                              className="bd-fill"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="bd-empty">—</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ✅ Alert Modal */}
      {modalMsg ? (
        <div className="modal-overlay" onClick={() => setModalMsg("")}>
          <div
            className="modal-box is-info"
            onClick={(e) => e.stopPropagation()}
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
          </div>
        </div>
      ) : null}

      {/* ✅ Confirm Modal */}
      {confirmState.open ? (
        <div
          className="modal-overlay"
          onClick={() => setConfirmState({ open: false })}
        >
          <div
            className="modal-box is-danger"
            onClick={(e) => e.stopPropagation()}
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
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DashboardExpenses;
