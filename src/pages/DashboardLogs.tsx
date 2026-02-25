import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClockRotateLeft,
  faFilter,
  faMagnifyingGlass,
  faRotateRight,
  faTriangleExclamation,
  faChevronDown,
  faChevronUp,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import "../styles/DashboardLogs.css";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

type AuthUser = {
  uid: string;
  email: string;
  role: UiRole;
  displayName?: string;
};

function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

type LogRow = {
  id: string;
  logId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  description?: string;
  userName?: string;
  userUid?: string;
  userRole?: string;
  userEmail?: string;
  source?: string;
  createdAt?: any;
  before?: any;
  after?: any;
  meta?: any;
  sensitive?: boolean;

  atMs: number;
};

const ACTION_LABELS: Record<string, string> = {
  user_login: "تسجيل دخول",
  user_logout: "تسجيل خروج",
  booking_created: "إنشاء حجز",
  booking_updated: "تعديل حجز",
  booking_status_changed: "تغيير حالة الحجز",
  booking_confirmed: "تأكيد الحجز",
  booking_completed: "إكمال الحجز",
  booking_cancelled: "إلغاء الحجز",
  booking_reassigned: "إعادة تعيين موظفة",
  user_created: "إنشاء مستخدم",
  user_updated: "تعديل مستخدم",
  client_updated: "تعديل بروفايل عميلة",
  income_created: "إضافة دخل",
  income_updated: "تعديل دخل",
  income_deleted: "حذف دخل",
  expense_created: "إضافة مصروف",
  expense_updated: "تعديل مصروف",
  expense_deleted: "حذف مصروف",
  offer_created: "إضافة عرض",
  offer_updated: "تعديل عرض",
  offer_deleted: "حذف عرض",
  settings_updated: "تعديل الإعدادات",
  role_changed: "تغيير صلاحية مستخدم",
};

const ENTITY_LABELS: Record<string, string> = {
  booking: "حجز",
  user: "حساب",
  client: "عميلة",
  employee: "موظفة",
  service: "خدمة",
  income: "دخل",
  expense: "مصروف",
  offer: "عرض",
  settings: "إعدادات",
};

const SOURCE_LABELS: Record<string, string> = {
  dashboard: "لوحة الإدارة",
  internal_booking: "الاستقبال",
  client_app: "واجهة الدخول",
  system: "النظام",
};

function safeMs(ts: any): number {
  try {
    if (!ts) return 0;
    if (typeof ts?.toMillis === "function") return ts.toMillis();
    if (typeof ts === "number") return ts;
    if (typeof ts === "string") {
      const parsed = Date.parse(ts);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

function fmtDateTime(ms: number) {
  if (!ms) return "-";
  const d = new Date(ms);
  return d.toLocaleString("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayKey(ms: number) {
  if (!ms) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function asLabel(map: Record<string, string>, value: string | undefined, fallback = "-") {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return fallback;
  return map[key] || key;
}

function getDisplayUser(r: LogRow) {
  return String(r.userName || r.userEmail || r.userUid || "-").trim();
}

function roleLabel(roleRaw: string | undefined): string {
  const role = String(roleRaw || "").trim().toLowerCase();
  const map: Record<string, string> = {
    owner: "مالك",
    admin: "أدمن",
    reception: "استقبال",
    staff: "موظفة",
    client: "عميلة",
    guest: "زائر",
  };
  return map[role] || (role || "-");
}

function actionTone(actionRaw: string | undefined): "danger" | "success" | "warning" | "info" | "neutral" {
  const action = String(actionRaw || "").trim().toLowerCase();
  if (!action) return "neutral";
  if (action.includes("deleted") || action.includes("cancelled") || action.includes("role_changed")) {
    return "danger";
  }
  if (action.includes("created") || action.includes("confirmed") || action.includes("completed") || action.includes("login")) {
    return "success";
  }
  if (action.includes("updated") || action.includes("changed") || action.includes("reassigned") || action.includes("settings")) {
    return "warning";
  }
  if (action.includes("logout")) return "info";
  return "neutral";
}

function relativeTime(ms: number): string {
  if (!ms) return "-";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "الآن";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `قبل ${days} يوم`;
}

function summarizeRow(r: LogRow): string {
  const action = asLabel(ACTION_LABELS, r.action, "عملية");
  const entity = asLabel(ENTITY_LABELS, r.entityType, "عنصر");
  const who = getDisplayUser(r);
  const source = asLabel(SOURCE_LABELS, r.source, "");
  if (who && who !== "-") {
    if (source && source !== "-") return `${who} ${action} من ${source}`;
    return `${who} ${action}`;
  }
  if (source && source !== "-") return `${action} على ${entity} من ${source}`;
  return `${action} على ${entity}`;
}

function valueText(v: any): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  return String(v);
}

function isObj(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function keyLabel(key: string): string {
  const map: Record<string, string> = {
    role: "الصلاحية",
    active: "الحالة",
    displayName: "الاسم",
    name: "الاسم",
    amount: "المبلغ",
    method: "طريقة السداد",
    paymentMethod: "طريقة السداد",
    status: "الحالة",
    date: "التاريخ",
    time: "الوقت",
    title: "العنوان",
    value: "القيمة",
    startDate: "تاريخ البداية",
    endDate: "تاريخ النهاية",
    appliesTo: "نطاق العرض",
    serviceIds: "الخدمات",
    sections: "أقسام الداشبورد",
    booking: "إعدادات الحجز",
    businessHours: "ساعات العمل",
    sat: "السبت",
    sun: "الأحد",
    mon: "الاثنين",
    tue: "الثلاثاء",
    wed: "الأربعاء",
    thu: "الخميس",
    fri: "الجمعة",
    start: "بداية الدوام",
    end: "نهاية الدوام",
    policies: "السياسات",
    catalogSeasonPricing: "تسعير الموسم",
    enabled: "مفعّل",
    from: "من",
    to: "إلى",
    allowReceptionChangeStatus: "صلاحية الاستقبال لتغيير الحالة",
    allowStaffChangeStatus: "صلاحية الموظفة لتغيير الحالة",
    allowAdminManageUsers: "سماح الأدمن بإدارة المستخدمين",
    slotStepMin: "فاصل المواعيد (دقيقة)",
    bufferMin: "البافر (دقيقة)",
    openTime: "وقت بداية الدوام",
    closeTime: "وقت نهاية الدوام",
    currency: "العملة",
  };
  return map[key] || key;
}

function shortValue(v: any): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return `${v.length} عنصر`;
  return "تم التحديث";
}

function extractSettingsFriendlyChanges(before: any, after: any): string[] {
  if (!isObj(before) || !isObj(after)) return [];
  const out: string[] = [];

  if (JSON.stringify(before.businessHours) !== JSON.stringify(after.businessHours)) {
    const b = isObj(before.businessHours) ? before.businessHours : {};
    const a = isObj(after.businessHours) ? after.businessHours : {};
    const days = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter(
      (d) => JSON.stringify(b[d]) !== JSON.stringify(a[d])
    );
    if (days.length) {
      const names = days.map((d) => keyLabel(d));
      out.push(`تم تعديل ساعات العمل (${names.slice(0, 3).join("، ")}${days.length > 3 ? "..." : ""})`);
    } else {
      out.push("تم تعديل ساعات العمل");
    }
  }

  if (JSON.stringify(before.policies) !== JSON.stringify(after.policies)) {
    out.push("تم تعديل السياسات");
  }

  if (JSON.stringify(before.sections) !== JSON.stringify(after.sections)) {
    out.push("تم تعديل أقسام الداشبورد");
  }

  if (JSON.stringify(before.catalogSeasonPricing) !== JSON.stringify(after.catalogSeasonPricing)) {
    const b = isObj(before.catalogSeasonPricing) ? before.catalogSeasonPricing : {};
    const a = isObj(after.catalogSeasonPricing) ? after.catalogSeasonPricing : {};
    if (b.enabled !== a.enabled) {
      out.push(`تسعير الموسم: ${shortValue(b.enabled)} ← ${shortValue(a.enabled)}`);
    } else {
      out.push("تم تعديل تسعير الموسم");
    }
  }

  return out;
}

function pushNestedDiff(
  out: string[],
  parentKey: string,
  before: Record<string, any>,
  after: Record<string, any>
) {
  const nestedKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const nestedChanges: string[] = [];

  nestedKeys.forEach((nk) => {
    const nb = before[nk];
    const na = after[nk];
    if (JSON.stringify(nb) === JSON.stringify(na)) return;

    if (isObj(nb) && isObj(na)) {
      const deepKeys = Array.from(new Set([...Object.keys(nb), ...Object.keys(na)]));
      deepKeys.forEach((dk) => {
        const db = nb[dk];
        const da = na[dk];
        if (JSON.stringify(db) === JSON.stringify(da)) return;
        nestedChanges.push(
          `${keyLabel(nk)} (${keyLabel(dk)}): ${shortValue(db)} ← ${shortValue(da)}`
        );
      });
      return;
    }

    nestedChanges.push(`${keyLabel(nk)}: ${shortValue(nb)} ← ${shortValue(na)}`);
  });

  if (nestedChanges.length) {
    out.push(`${keyLabel(parentKey)}: ${nestedChanges.slice(0, 8).join(" | ")}`);
  }
}

function pushBeforeAfterDiff(out: string[], before: any, after: any) {
  if (!isObj(before) || !isObj(after)) return;

  // تفاصيل أوضح لإعدادات أقسام الداشبورد
  if (isObj(before.sections) && isObj(after.sections)) {
    const sectionKeys = Array.from(
      new Set([...Object.keys(before.sections), ...Object.keys(after.sections)])
    );
    const sectionChanges: string[] = [];
    sectionKeys.forEach((k) => {
      const bv = before.sections[k];
      const av = after.sections[k];
      if (bv === av) return;
      sectionChanges.push(`${k}: ${shortValue(bv)} ← ${shortValue(av)}`);
    });
    if (sectionChanges.length) {
      out.push(`أقسام الداشبورد: ${sectionChanges.slice(0, 6).join(" | ")}`);
    }
  }

  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const ignored = new Set(["updatedAt", "createdAt", "sections"]);

  keys.forEach((k) => {
    if (ignored.has(k)) return;
    const bv = before[k];
    const av = after[k];
    if (JSON.stringify(bv) === JSON.stringify(av)) return;

    // لو قيمة مركبة: اظهر تفاصيل الحقول الداخلية بدل "تم التحديث"
    if (isObj(bv) && isObj(av)) {
      pushNestedDiff(out, k, bv, av);
      return;
    }

    out.push(`${keyLabel(k)}: ${shortValue(bv)} ← ${shortValue(av)}`);
  });
}

function extractImportantChanges(r: LogRow): string[] {
  const out: string[] = [];
  const actionKey = String(r.action || "").toLowerCase().trim();
  const entityKey = String(r.entityType || "").toLowerCase().trim();

  if (actionKey === "settings_updated" || entityKey === "settings") {
    const friendly = extractSettingsFriendlyChanges(r.before, r.after);
    if (friendly.length) return friendly.slice(0, 6);
  }

  const meta = (r.meta && typeof r.meta === "object" ? r.meta : {}) as Record<string, any>;
  const patch =
    (meta.patch && typeof meta.patch === "object" ? meta.patch : null) ||
    (r.after && typeof r.after === "object" ? (r.after as Record<string, any>) : null);
  if (patch) {
    const keys: Array<[string, string]> = [
      ["status", "الحالة"],
      ["amount", "المبلغ"],
      ["method", "طريقة السداد"],
      ["date", "التاريخ"],
      ["time", "الوقت"],
      ["employeeName", "الموظفة"],
      ["clientName", "العميلة"],
      ["userRole", "الصلاحية"],
      ["email", "البريد"],
    ];
    keys.forEach(([k, label]) => {
      if (patch[k] !== undefined) out.push(`${label}: ${valueText(patch[k])}`);
    });
  }
  if (!out.length) {
    pushBeforeAfterDiff(out, r.before, r.after);
  }
  if (!out.length && r.description) out.push(String(r.description));
  return out.slice(0, 12);
}

const SENSITIVE_ACTIONS = new Set<string>([
  "role_changed",
  "settings_updated",
  "loyalty_settings_updated",
  "income_created",
  "income_updated",
  "income_deleted",
  "expense_created",
  "expense_updated",
  "expense_deleted",
  "booking_confirmed",
  "booking_completed",
  "booking_cancelled",
  "booking_reassigned",
  "booking_status_changed",
  "offer_created",
  "offer_updated",
  "offer_deleted",
  "user_created",
  "user_updated",
]);

function detectSensitiveLocal(row: LogRow) {
  if (row.sensitive === true) return true;
  const actionKey = String(row.action || "").toLowerCase().trim();
  if (SENSITIVE_ACTIONS.has(actionKey)) return true;

  const text = `${row.action || ""} ${row.description || ""} ${JSON.stringify(row.meta || {})}`.toLowerCase();
  return (
    text.includes("delete") ||
    text.includes("حذف") ||
    text.includes("price") ||
    text.includes("سعر") ||
    text.includes("amount") ||
    text.includes("مالي") ||
    text.includes("role") ||
    text.includes("صلاح")
  );
}

const SALON_ID = "main";

export default function DashboardLogs() {
  const authUser = useMemo(() => getAuthUser(), []);
  const canManage = authUser?.role === "owner" || authUser?.role === "admin";

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [errMsg, setErrMsg] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [qText, setQText] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [onlySensitive, setOnlySensitive] = useState(false);
  const [showLoginEvents, setShowLoginEvents] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [maxRows, setMaxRows] = useState<number>(300);

  const load = async () => {
    setLoading(true);
    setErrMsg("");

    try {
      const colRef = collection(db, "salons", SALON_ID, "logs");
      const q = query(colRef, orderBy("createdAt", "desc"), limit(Math.max(50, Math.min(1000, maxRows))));
      const snap = await getDocs(q);

      const list: LogRow[] = snap.docs.map((d) => {
        const x: any = d.data();
        const atMs =
          safeMs(x?.createdAt) ||
          safeMs(x?.at) ||
          safeMs(x?.eventAtMs) ||
          safeMs(x?.meta?.eventAtMs);
        return {
          id: d.id,
          logId: String(x?.logId || d.id),
          action: String(x?.action || x?.type || ""),
          entityType: String(x?.entityType || x?.entity || ""),
          entityId: String(x?.entityId || ""),
          description: String(x?.description || x?.note || ""),
          userName: String(x?.userName || ""),
          userUid: String(x?.userUid || x?.byUid || ""),
          userRole: String(x?.userRole || x?.byRole || ""),
          userEmail: String(x?.userEmail || x?.byEmail || ""),
          source: String(x?.source || ""),
          createdAt: x?.createdAt || x?.at,
          before: x?.before,
          after: x?.after,
          meta: x?.meta,
          sensitive: Boolean(x?.sensitive),
          atMs,
        };
      });

      list.sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
      setRows(list);
    } catch (e: any) {
      console.warn("DashboardLogs load error:", e);
      const msg = String(e?.message || e);
      setErrMsg(
        msg.includes("Missing or insufficient permissions")
          ? "⚠️ الصلاحيات تمنع قراءة السجل. لازم Rules تسمح فقط للأونر/الأدمن بقراءة salons/main/logs."
          : "❌ تعذر تحميل سجل العمليات:\n" + msg
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManage) return;
    load();
  }, [canManage, maxRows]);

  const actionOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const t = String(r.action || "").trim();
      if (t) s.add(t);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const entityOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const t = String(r.entityType || "").trim();
      if (t) s.add(t);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const userOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const u = String(r.userName || r.userEmail || r.userUid || "").trim();
      if (u) s.add(u);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();

    return rows.filter((r) => {
      if (actionFilter !== "all" && String(r.action || "") !== actionFilter) return false;
      if (entityFilter !== "all" && String(r.entityType || "") !== entityFilter) return false;
      if (sourceFilter !== "all" && String(r.source || "") !== sourceFilter) return false;

      const userToken = String(r.userName || r.userEmail || r.userUid || "");
      if (userFilter !== "all" && userToken !== userFilter) return false;

      const actionKey = String(r.action || "").trim().toLowerCase();
      if (!showLoginEvents && (actionKey === "user_login" || actionKey === "user_logout")) {
        return false;
      }

      const isSensitive = detectSensitiveLocal(r);
      if (onlySensitive && !isSensitive) return false;

      const dk = dayKey(r.atMs);
      if (fromDate && dk && dk < fromDate) return false;
      if (toDate && dk && dk > toDate) return false;

      if (!t) return true;

      const hay = String(
        `${r.logId || ""} ${r.action || ""} ${r.entityType || ""} ${r.entityId || ""} ${r.userName || ""} ${r.userEmail || ""} ${r.userUid || ""} ${r.userRole || ""} ${r.description || ""} ${r.source || ""}`
      ).toLowerCase();

      return hay.includes(t);
    });
  }, [
    rows,
    qText,
    actionFilter,
    entityFilter,
    userFilter,
    sourceFilter,
    fromDate,
    toDate,
    onlySensitive,
    showLoginEvents,
  ]);

  const analytics = useMemo(() => {
    const today = dayKey(Date.now());
    let sensitiveCount = 0;
    let todayCount = 0;
    let financialCount = 0;
    let bookingCount = 0;
    const actionCounter = new Map<string, number>();

    filtered.forEach((r) => {
      const actionKey = String(r.action || "").trim().toLowerCase();
      const entityKey = String(r.entityType || "").trim().toLowerCase();

      if (detectSensitiveLocal(r)) sensitiveCount += 1;
      if (dayKey(r.atMs) === today) todayCount += 1;
      if (actionKey) actionCounter.set(actionKey, (actionCounter.get(actionKey) || 0) + 1);

      if (
        entityKey === "income" ||
        entityKey === "expense" ||
        actionKey.startsWith("income_") ||
        actionKey.startsWith("expense_")
      ) {
        financialCount += 1;
      }

      if (entityKey === "booking" || actionKey.startsWith("booking_")) {
        bookingCount += 1;
      }
    });

    let topAction = "";
    let topCount = 0;
    actionCounter.forEach((count, key) => {
      if (count > topCount) {
        topCount = count;
        topAction = key;
      }
    });

    return {
      filteredCount: filtered.length,
      totalCount: rows.length,
      sensitiveCount,
      todayCount,
      financialCount,
      bookingCount,
      topActionLabel: topAction ? asLabel(ACTION_LABELS, topAction) : "-",
      topActionCount: topCount,
      latestMs: filtered[0]?.atMs || rows[0]?.atMs || 0,
    };
  }, [filtered, rows]);

  if (!authUser) {
    return (
      <div className="dashboard-page logs-page">
        <div className="container">
          <div className="dash-card">
            <h3>غير مصرح</h3>
            <p>سجّل دخول ثم جرّب.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="dashboard-page logs-page">
        <div className="container">
          <div className="dash-card">
            <h3>صلاحيات غير كافية</h3>
            <p>سجل العمليات للأونر/الأدمن فقط.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page logs-page">
      <div className="container">
        <div className="dash-topbar dash-topbar--sticky">
          <div className="dash-topbar-title">
            <h2>
              <FontAwesomeIcon icon={faClockRotateLeft} /> سجل العمليات التشغيلي
            </h2>
          </div>

          <div className="dash-topbar-actions">
            <button className="exp-btn" onClick={load} disabled={loading} type="button">
              <FontAwesomeIcon icon={faRotateRight} /> تحديث
            </button>
          </div>
        </div>

        {errMsg && <div className="dash-alert">{errMsg}</div>}

        <div className="dash-card logs-card">
          <div className="logs-insights">
            <div className="logs-insight-head">
              <div>
                <h3>مركز مراقبة العمليات</h3>
                <p>عرض حي للعمليات مع تصنيف لوني حسب نوع الحدث وحساسيته.</p>
              </div>
              <div className="logs-insight-updated">
                آخر عملية: <b>{fmtDateTime(analytics.latestMs)}</b>
                {analytics.latestMs ? <span> ({relativeTime(analytics.latestMs)})</span> : null}
              </div>
            </div>

            <div className="logs-kpis">
              <div className="logs-kpi logs-kpi--primary">
                <div className="k">المعروض الآن</div>
                <div className="v">{analytics.filteredCount}</div>
              </div>
              <div className="logs-kpi logs-kpi--danger">
                <div className="k">عمليات حساسة</div>
                <div className="v">{analytics.sensitiveCount}</div>
              </div>
              <div className="logs-kpi logs-kpi--success">
                <div className="k">عمليات اليوم</div>
                <div className="v">{analytics.todayCount}</div>
              </div>
              <div className="logs-kpi logs-kpi--warning">
                <div className="k">الأكثر تكرارًا</div>
                <div className="v">{analytics.topActionCount || 0}</div>
                <div className="s">{analytics.topActionLabel}</div>
              </div>
              <div className="logs-kpi logs-kpi--neutral">
                <div className="k">سجل الحجوزات</div>
                <div className="v">{analytics.bookingCount}</div>
              </div>
              <div className="logs-kpi logs-kpi--neutral">
                <div className="k">السجل المالي</div>
                <div className="v">{analytics.financialCount}</div>
              </div>
            </div>
          </div>

          <div className="logs-filters">
            <div className="logs-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                className="dash-input"
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="بحث بالنص داخل الوصف / المستخدم / نوع العملية ..."
              />
            </div>

            <div className="logs-select">
              <FontAwesomeIcon icon={faFilter} />
              <select className="dash-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                <option value="all">كل العمليات</option>
                {actionOptions.map((x) => (
                  <option key={x} value={x}>
                    {asLabel(ACTION_LABELS, x)}
                  </option>
                ))}
              </select>
            </div>

            <select className="dash-select" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              <option value="all">كل العناصر</option>
              {entityOptions.map((x) => (
                <option key={x} value={x}>
                  {asLabel(ENTITY_LABELS, x)}
                </option>
              ))}
            </select>

            <select className="dash-select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="all">كل المستخدمين</option>
              {userOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>

            <select className="dash-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">كل المصادر</option>
              <option value="dashboard">{asLabel(SOURCE_LABELS, "dashboard")}</option>
              <option value="internal_booking">{asLabel(SOURCE_LABELS, "internal_booking")}</option>
              <option value="client_app">{asLabel(SOURCE_LABELS, "client_app")}</option>
              <option value="system">{asLabel(SOURCE_LABELS, "system")}</option>
            </select>

            <input className="dash-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <input className="dash-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />

            <div className="logs-switches">
              <label className="logs-sensitive-filter">
                <input
                  type="checkbox"
                  checked={onlySensitive}
                  onChange={(e) => setOnlySensitive(e.target.checked)}
                />
                <span>العمليات الحساسة فقط</span>
              </label>

              <label className="logs-sensitive-filter">
                <input
                  type="checkbox"
                  checked={showLoginEvents}
                  onChange={(e) => setShowLoginEvents(e.target.checked)}
                />
                <span>إظهار تسجيل الدخول</span>
              </label>
            </div>

            <select className="dash-select" value={String(maxRows)} onChange={(e) => setMaxRows(Number(e.target.value))}>
              <option value="100">100</option>
              <option value="300">300</option>
              <option value="500">500</option>
              <option value="800">800</option>
              <option value="1000">1000</option>
            </select>

            <div className="logs-meta">
              المعروض: <b>{filtered.length}</b> • الإجمالي: <b>{rows.length}</b>
              {loading ? <span className="logs-loading"> • تحميل...</span> : null}
            </div>
          </div>

          {filtered.length === 0 && !loading ? (
            <div className="logs-empty">ما فيه عمليات مسجلة ضمن الفلاتر الحالية.</div>
          ) : (
            <div className="logs-table">
              <div className="logs-head">
                <div>الوقت</div>
                <div>العملية</div>
                <div>العنصر</div>
                <div>المستخدم</div>
                <div>المصدر</div>
                <div>الملخص</div>
                <div>تفاصيل</div>
              </div>

              {filtered.map((r) => {
                const sensitive = detectSensitiveLocal(r);
                const expanded = expandedId === r.id;

                return (
                  <div key={r.id} className={`logs-row ${sensitive ? "logs-row--sensitive" : ""}`}>
                    <div className="logs-time" data-label="الوقت">{fmtDateTime(r.atMs)}</div>
                    <div className="logs-type" data-label="العملية">
                      <span className={`logs-pill logs-pill--${actionTone(r.action)}`}>
                        {sensitive ? <FontAwesomeIcon className="logs-sensitive-icon" icon={faTriangleExclamation} /> : null}
                        {asLabel(ACTION_LABELS, r.action)}
                      </span>
                    </div>
                    <div className="logs-entity" data-label="العنصر">
                      <span className="logs-chip">{asLabel(ENTITY_LABELS, r.entityType)}</span>
                    </div>
                    <div className="logs-user" data-label="المستخدم">
                      <div className="logs-user-name">{getDisplayUser(r)}</div>
                      <div className="logs-user-meta">
                        {[roleLabel(r.userRole), r.userEmail, r.userUid ? `#${String(r.userUid).slice(0, 8)}` : ""]
                          .filter(Boolean)
                          .join(" | ")}
                      </div>
                    </div>
                    <div className="logs-source" data-label="المصدر">
                      <span className="logs-chip logs-chip--source">{asLabel(SOURCE_LABELS, r.source)}</span>
                    </div>
                    <div className="logs-note" data-label="الملخص">
                      <div className="logs-note-main">{summarizeRow(r)}</div>
                      {r.entityId ? <div className="logs-note-sub">ID: {r.entityId}</div> : null}
                    </div>
                    <div data-label="تفاصيل">
                      <button
                        className="logs-expand-btn"
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                      >
                        {expanded ? <FontAwesomeIcon icon={faChevronUp} /> : <FontAwesomeIcon icon={faChevronDown} />}
                        {expanded ? "إخفاء" : "عرض"}
                      </button>
                    </div>

                    {expanded ? (
                      <div className="logs-details" role="region" aria-label="تفاصيل السجل">
                        <div className="logs-detail-top">
                          <span className="logs-mini-chip">الوقت: {fmtDateTime(r.atMs)}</span>
                          {r.logId ? <span className="logs-mini-chip">Log: {r.logId}</span> : null}
                          {r.entityId ? <span className="logs-mini-chip">Entity: {r.entityId}</span> : null}
                        </div>
                        <div className="logs-detail-summary">
                          {extractImportantChanges(r).map((line, idx) => (
                            <div key={`${r.id}-line-${idx}`} className="logs-detail-line">
                              {line}
                            </div>
                          ))}
                        </div>
                        <details className="logs-raw-wrap">
                          <summary>عرض البيانات الخام (للتقني)</summary>
                          <div className="logs-detail-grid">
                            <div>
                              <h4>before</h4>
                              <pre>{JSON.stringify(r.before ?? null, null, 2)}</pre>
                            </div>
                            <div>
                              <h4>after</h4>
                              <pre>{JSON.stringify(r.after ?? null, null, 2)}</pre>
                            </div>
                          </div>
                          <div className="logs-meta-json">
                            <h4>meta</h4>
                            <pre>{JSON.stringify(r.meta ?? null, null, 2)}</pre>
                          </div>
                        </details>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
