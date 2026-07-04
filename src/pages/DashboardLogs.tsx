import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
} from "firebase/firestore";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronUp,
  faFilter,
  faMagnifyingGlass,
  faRotateRight,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";

import ConfirmModal from "../components/ConfirmModal";
import { db } from "../services/firebase";
import { upsertExpenseFS } from "../services/firestoreExpenses";
import { upsertIncomeFS } from "../services/firestoreIncome";
import { writeAuditLog } from "../services/logService";
import type { Expense, IncomeItem, PaymentMethod } from "../types/finance";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

type AuthUser = {
  uid: string;
  email: string;
  role: UiRole;
  displayName?: string;
};

type LogDisplay = {
  clientName?: string;
  bookingPublicId?: string;
  bookingShortId?: string;
  bookingId?: string;
};

type LogChange = {
  field: string;
  before?: string;
  after?: string;
};

type LogRow = {
  id: string;
  logId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  description?: string;
  summary?: string;
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
  severity?: "info" | "warning" | "critical";
  display?: LogDisplay;
  changedFields?: string[];
  changesPreview?: LogChange[];
  hasSnapshot?: boolean;
  snapshotId?: string;
  restore?: {
    eligible?: boolean;
    kind?: string;
  };
  atMs: number;
};

type LogSnapshot = {
  before?: any;
  after?: any;
};

type LogDetails = {
  loading: boolean;
  error?: string;
  changes?: LogChange[];
  snapshot?: LogSnapshot | null;
  fullOpen?: boolean;
  hasSnapshot?: boolean;
};

const SALON_ID = "main";
const PAGE_SIZE = 40;

function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

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
  user_created: "إضافة مستخدم",
  user_updated: "تعديل مستخدم",
  client_updated: "تعديل عميلة",
  income_created: "إضافة دخل",
  income_updated: "تعديل دخل",
  income_deleted: "حذف دخل",
  income_restored: "استرجاع دخل",
  expense_created: "إضافة مصروف",
  expense_updated: "تعديل مصروف",
  expense_deleted: "حذف مصروف",
  expense_restored: "استرجاع مصروف",
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
    if (typeof ts?.seconds === "number") {
      return Math.round(Number(ts.seconds) * 1000 + Number(ts.nanoseconds || 0) / 1_000_000);
    }
    if (typeof ts?._seconds === "number") {
      return Math.round(Number(ts._seconds) * 1000 + Number(ts._nanoseconds || 0) / 1_000_000);
    }
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
  const name = String(r.userName || "").trim();
  if (name) return name;
  const email = String(r.userEmail || "").trim();
  if (email) return email.split("@")[0];
  const uid = String(r.userUid || "").trim();
  if (uid) return uid.slice(0, 8);
  return "النظام";
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

function isObj(v: any): v is Record<string, any> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeValue(v: any): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  const raw = String(v);
  if (raw.length > 120) return `${raw.slice(0, 117)}...`;
  return raw;
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
    employeeName: "الموظفة",
    clientName: "العميلة",
  };
  return map[key] || key;
}

function actionSeverityFallback(actionRaw: string | undefined): "info" | "warning" | "critical" {
  const action = String(actionRaw || "").trim().toLowerCase();
  if (!action) return "info";
  if (
    action.includes("cancel") ||
    action.includes("deleted") ||
    action.includes("restore") ||
    action.includes("role_changed") ||
    action.includes("status_changed") ||
    action.includes("reassigned")
  ) {
    return "critical";
  }
  if (action.includes("updated") || action.includes("changed") || action.includes("settings")) {
    return "warning";
  }
  return "info";
}

function severityLabel(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return "طارئة";
  if (severity === "warning") return "تحتاج مراجعة";
  return "نجحت";
}

function resolveSummary(r: LogRow): string {
  const direct = String(r.summary || "").trim();
  if (direct) return direct;
  const desc = String(r.description || "").trim();
  if (desc) return desc;
  const action = asLabel(ACTION_LABELS, r.action, "عملية");
  const entity = asLabel(ENTITY_LABELS, r.entityType, "عنصر");
  return `${action} على ${entity}`;
}

function resolveDisplay(r: LogRow): LogDisplay | null {
  const raw = r.display || (isObj(r.meta?.display) ? (r.meta.display as LogDisplay) : null);
  if (raw) return raw;
  const clientName = String((r.after as any)?.clientName || (r.before as any)?.clientName || "").trim();
  const bookingPublicId = String((r.after as any)?.publicId || (r.before as any)?.publicId || "").trim();
  const bookingId = String(r.entityId || "").trim();
  if (!clientName && !bookingPublicId && !bookingId) return null;
  return {
    clientName: clientName || undefined,
    bookingPublicId: bookingPublicId || undefined,
    bookingShortId: bookingId ? bookingId.slice(0, 6) : undefined,
    bookingId: bookingId || undefined,
  };
}

function buildChangesFromBeforeAfter(before: Record<string, any>, after: Record<string, any>): LogChange[] {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const changes: LogChange[] = [];
  keys.forEach((key) => {
    if (key === "updatedAt" || key === "createdAt") return;
    const bv = before[key];
    const av = after[key];
    if (Object.is(bv, av)) return;
    changes.push({
      field: key,
      before: normalizeValue(bv),
      after: normalizeValue(av),
    });
  });
  return changes.slice(0, 16);
}

function buildChangesFromPatch(patch: Record<string, any>): LogChange[] {
  return Object.keys(patch)
    .filter((key) => key !== "updatedAt" && key !== "createdAt")
    .map((key) => ({
      field: key,
      before: "—",
      after: normalizeValue(patch[key]),
    }))
    .slice(0, 16);
}

function resolveInlineChanges(r: LogRow): LogChange[] {
  if (Array.isArray(r.changesPreview) && r.changesPreview.length) {
    return r.changesPreview.map((c) => ({
      field: String((c as any)?.field || ""),
      before: normalizeValue((c as any)?.before),
      after: normalizeValue((c as any)?.after),
    }));
  }
  if (isObj(r.before) && isObj(r.after)) {
    return buildChangesFromBeforeAfter(r.before, r.after);
  }
  if (isObj(r.after)) {
    return buildChangesFromPatch(r.after);
  }
  if (isObj(r.meta?.patch)) {
    return buildChangesFromPatch(r.meta.patch);
  }
  return [];
}

function getRestoreKind(r: LogRow): "income" | "expense" | null {
  if (r.restore?.eligible && r.restore?.kind === "income") return "income";
  if (r.restore?.eligible && r.restore?.kind === "expense") return "expense";
  const actionKey = String(r.action || "").trim().toLowerCase();
  if (actionKey === "income_deleted") return "income";
  if (actionKey === "expense_deleted") return "expense";
  return null;
}

function normalizePaymentMethod(raw: unknown): PaymentMethod {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return "cash";
  if (s === "cash" || s.includes("كاش") || s.includes("نقد")) return "cash";
  if (
    s === "card" ||
    s === "pos_card" ||
    s === "mada_online" ||
    s.includes("شبكة") ||
    s.includes("مدى") ||
    s.includes("بطاق")
  ) {
    return "card";
  }
  if (s === "transfer" || s === "bank_transfer" || s.includes("تحويل")) return "transfer";
  if (s === "other") return "other";
  return "other";
}

function normalizeIsoDate(rawDate: unknown, fallbackMs: number): string {
  const direct = String(rawDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  const withPrefix = direct.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
  if (withPrefix?.[1]) return withPrefix[1];
  if (direct) {
    const parsed = Date.parse(direct);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return fallbackMs > 0 ? new Date(fallbackMs).toISOString().slice(0, 10) : "";
}

function buildIncomeFromBefore(before: Record<string, unknown>, row: LogRow): IncomeItem | null {
  const id = String(row.entityId || (before as any).id || "").trim();
  if (!id) return null;
  const createdAtMs = safeMs((before as any).createdAt) || safeMs((before as any).updatedAt) || row.atMs || Date.now();
  const date = normalizeIsoDate((before as any).date, createdAtMs);
  const source = String((before as any).source ?? "dashboard").trim() || "dashboard";
  return {
    id,
    date,
    amount: Number((before as any).amount ?? 0) || 0,
    method: normalizePaymentMethod((before as any).method ?? (before as any).paymentMethod),
    source,
    note: String((before as any).note ?? "").trim() || undefined,
    bookingId: String((before as any).bookingId ?? "").trim() || undefined,
    createdAt: createdAtMs || Date.now(),
  };
}

function buildExpenseFromBefore(before: Record<string, unknown>, row: LogRow): Expense | null {
  const id = String(row.entityId || (before as any).id || "").trim();
  const title = String((before as any).title ?? "").trim();
  if (!id || !title) return null;
  const createdAtMs = safeMs((before as any).createdAt) || safeMs((before as any).updatedAt) || row.atMs || Date.now();
  const date = normalizeIsoDate((before as any).date, createdAtMs);
  const category = String((before as any).category ?? "أخرى").trim() || "أخرى";
  const paymentMethodRaw = (before as any).paymentMethod ?? (before as any).method ?? "كاش";
  const paymentMethod = (String(paymentMethodRaw || "").trim() || "كاش") as unknown as PaymentMethod;
  return {
    id,
    title,
    category,
    amount: Number((before as any).amount ?? 0) || 0,
    date,
    paymentMethod,
    note: String((before as any).note ?? "").trim() || undefined,
    createdAt: createdAtMs || Date.now(),
  };
}

type LogCardProps = {
  row: LogRow;
  expanded: boolean;
  details?: LogDetails;
  canRestore: boolean;
  onToggleExpand: (row: LogRow) => void;
  onToggleSnapshot: (row: LogRow) => void;
  onRestore: (row: LogRow) => void;
};

const LogCard = memo(function LogCard({
  row,
  expanded,
  details,
  canRestore,
  onToggleExpand,
  onToggleSnapshot,
  onRestore,
}: LogCardProps) {
  const display = resolveDisplay(row);
  const severity = row.severity || actionSeverityFallback(row.action);
  const summary = resolveSummary(row);
  const actionLabel = asLabel(ACTION_LABELS, row.action, "عملية");
  const sourceLabel = asLabel(SOURCE_LABELS, row.source, "-");
  const entityLabel = asLabel(ENTITY_LABELS, row.entityType, "-");
  const actor = getDisplayUser(row);
  const actorRole = roleLabel(row.userRole);
  const showActorRole = actorRole && actorRole !== "-";
  const timeLabel = fmtDateTime(row.atMs);
  const relative = relativeTime(row.atMs);

  const bookingIdLabel =
    display?.bookingPublicId ||
    display?.bookingShortId ||
    String(row.entityId || "").slice(0, 6) ||
    "-";
  const clientNameLabel = display?.clientName || "-";

  return (
    <div className={`log-card log-card--${severity}`}>
      <div className="log-card-head">
        <div className="log-action">
          <span className="log-action-label">{actionLabel}</span>
          {severity === "critical" ? (
            <span className="log-alert-icon">
              <FontAwesomeIcon icon={faTriangleExclamation} />
            </span>
          ) : null}
        </div>
        <div className={`log-severity log-severity--${severity}`}>{severityLabel(severity)}</div>
      </div>

      <div className="log-card-body">
        <div className="log-main">
          <div className="log-client">{clientNameLabel}</div>
          <div className="log-id-chip">
            {entityLabel} • {bookingIdLabel}
          </div>
        </div>

        <div className="log-meta-grid">
          <div className="log-meta-item">
            <span>المنفذ</span>
            <strong>
              {actor} {showActorRole ? `(${actorRole})` : ""}
            </strong>
          </div>
          <div className="log-meta-item">
            <span>المصدر</span>
            <strong>{sourceLabel}</strong>
          </div>
          <div className="log-meta-item">
            <span>الوقت</span>
            <strong>
              {timeLabel} <span className="log-relative">• {relative}</span>
            </strong>
          </div>
          <div className="log-meta-item">
            <span>الملخص</span>
            <strong className="log-summary">{summary}</strong>
          </div>
        </div>
      </div>

      <div className="log-card-actions">
        <button className="log-action-btn" type="button" onClick={() => onToggleExpand(row)}>
          {expanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}
          <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} />
        </button>
        {canRestore ? (
          <button className="log-restore-btn" type="button" onClick={() => onRestore(row)}>
            <FontAwesomeIcon icon={faRotateRight} />
            استرجاع هذه الحالة
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="log-details">
          {details?.loading ? <div className="log-details-loading">جاري تحميل التفاصيل...</div> : null}
          {details?.error ? <div className="log-details-error">{details.error}</div> : null}
          {details?.changes && details.changes.length ? (
            <div className="log-diff">
              <div className="log-diff-head">
                <span>الحقل</span>
                <span>قبل</span>
                <span>بعد</span>
              </div>
              {details.changes.map((change, index) => (
                <div key={`${row.id}-change-${index}`} className="log-diff-row">
                  <div className="log-diff-field">{keyLabel(change.field)}</div>
                  <div className="log-diff-before">{change.before ?? "—"}</div>
                  <div className="log-diff-after">{change.after ?? "—"}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="log-details-empty">لا توجد تغييرات مسجلة لعرضها.</div>
          )}

          {details?.hasSnapshot ? (
            <div className="log-details-actions">
              <button className="log-secondary-btn" type="button" onClick={() => onToggleSnapshot(row)}>
                {details?.fullOpen ? "إخفاء snapshot الكامل" : "عرض snapshot الكامل"}
              </button>
            </div>
          ) : null}

          {details?.fullOpen && details?.snapshot ? (
            <div className="log-snapshot-grid">
              <div>
                <h4>قبل</h4>
                <pre>{JSON.stringify(details.snapshot.before ?? {}, null, 2)}</pre>
              </div>
              <div>
                <h4>بعد</h4>
                <pre>{JSON.stringify(details.snapshot.after ?? {}, null, 2)}</pre>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default function DashboardLogs() {
  const authUser = useMemo(() => getAuthUser(), []);
  const canManage = authUser?.role === "owner" || authUser?.role === "admin";

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [errMsg, setErrMsg] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, LogDetails>>({});
  const [lastDoc, setLastDoc] = useState<any | null>(null);
  const lastDocRef = useRef<any | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const [qText, setQText] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [onlySensitive, setOnlySensitive] = useState(false);
  const [showLoginEvents, setShowLoginEvents] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [restoringLogId, setRestoringLogId] = useState("");
  const [restoreMsg, setRestoreMsg] = useState("");
  const [restoreErr, setRestoreErr] = useState("");
  const [restoreTarget, setRestoreTarget] = useState<LogRow | null>(null);

  const parseRow = useCallback((d: any) => {
    const x: any = d.data();
    const atMs = safeMs(x?.createdAt) || safeMs(x?.at) || safeMs(x?.eventAtMs) || safeMs(x?.meta?.eventAtMs);
    const changesPreview = Array.isArray(x?.changesPreview) ? x.changesPreview : [];
    const displayRaw = x?.display || x?.meta?.display;
    const display =
      displayRaw && typeof displayRaw === "object"
        ? {
            clientName: String(displayRaw?.clientName || "").trim() || undefined,
            bookingPublicId: String(displayRaw?.bookingPublicId || "").trim() || undefined,
            bookingShortId: String(displayRaw?.bookingShortId || "").trim() || undefined,
            bookingId: String(displayRaw?.bookingId || "").trim() || undefined,
          }
        : undefined;

    return {
      id: d.id,
      logId: String(x?.logId || d.id),
      action: String(x?.action || x?.type || ""),
      entityType: String(x?.entityType || x?.entity || ""),
      entityId: String(x?.entityId || ""),
      description: String(x?.description || x?.note || ""),
      summary: String(x?.summary || ""),
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
      severity: (x?.severity as any) || undefined,
      display,
      changedFields: Array.isArray(x?.changedFields) ? x.changedFields : [],
      changesPreview: changesPreview.map((c: any) => ({
        field: String(c?.field || ""),
        before: String(c?.before ?? ""),
        after: String(c?.after ?? ""),
      })),
      hasSnapshot: Boolean(x?.hasSnapshot || x?.snapshotId),
      snapshotId: x?.snapshotId ? String(x.snapshotId) : x?.hasSnapshot ? String(x?.logId || d.id) : undefined,
      restore: x?.restore && typeof x?.restore === "object" ? x.restore : undefined,
      atMs,
    } as LogRow;
  }, []);

  const loadPage = useCallback(
    async (mode: "initial" | "more") => {
      if (!canManage) return;
      if (mode === "initial") {
        setLoading(true);
        setErrMsg("");
      } else {
        setLoadingMore(true);
      }

      try {
        const colRef = collection(db, "salons", SALON_ID, "logs");
        const constraints: any[] = [orderBy("createdAt", "desc"), limit(PAGE_SIZE)];
        const cursor = mode === "more" ? lastDocRef.current : null;
        if (cursor) constraints.splice(1, 0, startAfter(cursor));
        const q = query(colRef, ...constraints);
        const snap = await getDocs(q);

        const list = snap.docs.map(parseRow);
        const nextLast = snap.docs[snap.docs.length - 1] ?? null;

        setLastDoc(nextLast);
        lastDocRef.current = nextLast;
        setHasMore(snap.size === PAGE_SIZE);
        setRows((prev) => (mode === "initial" ? list : [...prev, ...list]));
      } catch (e: any) {
        console.warn("DashboardLogs load error:", e);
        const msg = String(e?.message || e);
        setErrMsg(
          msg.includes("Missing or insufficient permissions")
            ? "⚠️ الصلاحيات تمنع قراءة السجل. لازم Rules تسمح فقط للأونر/الأدمن بقراءة salons/main/logs."
            : "تعذر تحميل سجل العمليات:\n" + msg
        );
        if (mode === "initial") setRows([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [canManage, parseRow]
  );

  useEffect(() => {
    if (!canManage) return;
    setRows([]);
    setDetailsById({});
    setExpandedId(null);
    setLastDoc(null);
    lastDocRef.current = null;
    setHasMore(true);
    void loadPage("initial");
  }, [canManage, loadPage]);

  const actionOptions = useMemo(() => {
    const unique = new Set(rows.map((r) => String(r.action || "").trim()).filter(Boolean));
    return Array.from(unique);
  }, [rows]);

  const entityOptions = useMemo(() => {
    const unique = new Set(rows.map((r) => String(r.entityType || "").trim()).filter(Boolean));
    return Array.from(unique);
  }, [rows]);

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== "all" && String(r.action || "") !== actionFilter) return false;
      if (entityFilter !== "all" && String(r.entityType || "") !== entityFilter) return false;
      if (sourceFilter !== "all" && String(r.source || "") !== sourceFilter) return false;
      if (onlySensitive && !r.sensitive) return false;
      const actionKey = String(r.action || "").trim().toLowerCase();
      if (!showLoginEvents && (actionKey === "user_login" || actionKey === "user_logout")) return false;

      if (fromDate) {
        const fk = dayKey(r.atMs);
        if (fk && fk < fromDate) return false;
      }
      if (toDate) {
        const tk = dayKey(r.atMs);
        if (tk && tk > toDate) return false;
      }

      if (!t) return true;
      const hay = String(
        `${r.logId || ""} ${r.action || ""} ${r.entityType || ""} ${r.entityId || ""} ${getDisplayUser(
          r
        )} ${r.userEmail || ""} ${r.userUid || ""} ${r.userRole || ""} ${resolveSummary(r)} ${r.source || ""}`
      ).toLowerCase();
      return hay.includes(t);
    });
  }, [
    rows,
    qText,
    actionFilter,
    entityFilter,
    sourceFilter,
    onlySensitive,
    showLoginEvents,
    fromDate,
    toDate,
  ]);

  const latestMs = useMemo(() => {
    if (!rows.length) return 0;
    return rows.reduce((max, r) => Math.max(max, r.atMs || 0), 0);
  }, [rows]);

  const ensureDetails = useCallback(
    async (row: LogRow, forceSnapshot = false) => {
      const existing = detailsById[row.id];
      if (existing?.loading) return;
      if (existing?.changes && existing.changes.length && !forceSnapshot) return;

      const inlineChanges = resolveInlineChanges(row);
      const hasSnapshot = Boolean(row.hasSnapshot || row.snapshotId);

      if (inlineChanges.length && !forceSnapshot) {
        setDetailsById((prev) => ({
          ...prev,
          [row.id]: {
            loading: false,
            error: "",
            changes: inlineChanges,
            snapshot: prev[row.id]?.snapshot ?? null,
            fullOpen: prev[row.id]?.fullOpen ?? false,
            hasSnapshot,
          },
        }));
        return;
      }

      if (!hasSnapshot) {
        setDetailsById((prev) => ({
          ...prev,
          [row.id]: {
            loading: false,
            error: "",
            changes: inlineChanges,
            snapshot: null,
            fullOpen: false,
            hasSnapshot,
          },
        }));
        return;
      }

      setDetailsById((prev) => ({
        ...prev,
        [row.id]: {
          loading: true,
          error: "",
          changes: inlineChanges,
          snapshot: prev[row.id]?.snapshot ?? null,
          fullOpen: prev[row.id]?.fullOpen ?? false,
          hasSnapshot,
        },
      }));

      try {
        const snapshotId = row.snapshotId || row.logId || row.id;
        const snapRef = doc(db, "salons", SALON_ID, "log_snapshots", snapshotId);
        const snap = await getDoc(snapRef);
        if (!snap.exists()) {
          setDetailsById((prev) => ({
            ...prev,
            [row.id]: {
              loading: false,
              error: "لا توجد بيانات snapshot لهذا السجل.",
              changes: inlineChanges,
              snapshot: null,
              fullOpen: prev[row.id]?.fullOpen ?? false,
              hasSnapshot,
            },
          }));
          return;
        }
        const data = snap.data() as any;
        const before = data?.before;
        const after = data?.after;
        const changes =
          isObj(before) && isObj(after) ? buildChangesFromBeforeAfter(before, after) : inlineChanges;
        setDetailsById((prev) => ({
          ...prev,
          [row.id]: {
            loading: false,
            error: "",
            changes,
            snapshot: { before, after },
            fullOpen: prev[row.id]?.fullOpen ?? false,
            hasSnapshot,
          },
        }));
      } catch (error: any) {
        setDetailsById((prev) => ({
          ...prev,
          [row.id]: {
            loading: false,
            error: "تعذر تحميل تفاصيل السجل.",
            changes: inlineChanges,
            snapshot: null,
            fullOpen: prev[row.id]?.fullOpen ?? false,
            hasSnapshot,
          },
        }));
      }
    },
    [detailsById]
  );

  const toggleExpand = useCallback(
    (row: LogRow) => {
      setExpandedId((prev) => (prev === row.id ? null : row.id));
      if (expandedId !== row.id) {
        void ensureDetails(row);
      }
    },
    [ensureDetails, expandedId]
  );

  const toggleSnapshot = useCallback(
    (row: LogRow) => {
      setDetailsById((prev) => ({
        ...prev,
        [row.id]: {
          ...prev[row.id],
          fullOpen: !prev[row.id]?.fullOpen,
        },
      }));
      void ensureDetails(row, true);
    },
    [ensureDetails]
  );

  const canRestoreRow = useCallback(
    (row: LogRow) => {
      if (!canManage) return false;
      const kind = getRestoreKind(row);
      if (!kind) return false;
      if (isObj(row.before)) return true;
      if (detailsById[row.id]?.snapshot?.before) return true;
      if (row.hasSnapshot) return true;
      return false;
    },
    [canManage, detailsById]
  );

  const openRestoreConfirm = useCallback(
    (row: LogRow) => {
      if (!canRestoreRow(row)) return;
      setRestoreTarget(row);
    },
    [canRestoreRow]
  );

  const handleRestore = async () => {
    const row = restoreTarget;
    if (!row) return;
    const kind = getRestoreKind(row);
    if (!kind) return;

    setRestoreMsg("");
    setRestoreErr("");
    setRestoringLogId(row.id);

    try {
      let beforeData = row.before;
      if (!beforeData && row.hasSnapshot) {
        const snapshotId = row.snapshotId || row.logId || row.id;
        const snapRef = doc(db, "salons", SALON_ID, "log_snapshots", snapshotId);
        const snap = await getDoc(snapRef);
        if (snap.exists()) {
          const data = snap.data() as any;
          beforeData = data?.before;
          setDetailsById((prev) => ({
            ...prev,
            [row.id]: {
              loading: false,
              error: "",
              changes: prev[row.id]?.changes ?? [],
              snapshot: { before: data?.before, after: data?.after },
              fullOpen: prev[row.id]?.fullOpen ?? false,
              hasSnapshot: true,
            },
          }));
        }
      }

      if (!isObj(beforeData)) {
        setRestoreErr("لا يمكن الاسترجاع لأن بيانات snapshot غير مكتملة.");
        setRestoringLogId("");
        return;
      }

      if (kind === "income") {
        const payload = buildIncomeFromBefore(beforeData, row);
        if (!payload) throw new Error("RESTORE_INVALID");
        await upsertIncomeFS(payload as IncomeItem, SALON_ID);
      } else {
        const payload = buildExpenseFromBefore(beforeData, row);
        if (!payload) throw new Error("RESTORE_INVALID");
        await upsertExpenseFS(payload as Expense, SALON_ID);
      }

      await writeAuditLog({
        salonId: SALON_ID,
        action: kind === "income" ? "income_restored" : "expense_restored",
        entityType: kind,
        entityId: row.entityId,
        description: kind === "income" ? "تم استرجاع دخل" : "تم استرجاع مصروف",
        before: beforeData,
        after: beforeData,
        meta: {
          restoredFromLogId: row.logId || row.id,
          restoredFromAction: row.action || "",
        },
      });

      setRestoreMsg("تم الاسترجاع وتسجيل العملية بنجاح.");
      setRestoreTarget(null);
      setRows([]);
      setLastDoc(null);
      setHasMore(true);
      await loadPage("initial");
    } catch (e: any) {
      const msg = String(e?.message || "");
      setRestoreErr(msg ? `تعذر تنفيذ الاسترجاع: ${msg}` : "تعذر تنفيذ الاسترجاع.");
    } finally {
      setRestoringLogId("");
    }
  };

  if (!authUser) {
    return (
      <div className="dashboard-page logs-page">
        <div className="container">
          <div className="dash-card">
            <h3>غير مصرح</h3>
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
            <p>هذه الصفحة متاحة للأونر أو الأدمن فقط.</p>
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
            <h1>سجل العمليات</h1>
            <p>عرض احترافي للعمليات مع تفاصيل منظمة وأداء منخفض القراءة.</p>
          </div>
        </div>

        {errMsg && <div className="dash-alert">{errMsg}</div>}
        {restoreErr ? <div className="logs-restore-status logs-restore-status--error">{restoreErr}</div> : null}
        {restoreMsg ? <div className="logs-restore-status logs-restore-status--ok">{restoreMsg}</div> : null}

        <div className="dash-card logs-card">
          <div className="logs-head">
            <div>
              <h3>مركز مراجعة العمليات</h3>
              <p>تفاصيل قابلة للتوسع، مع تحميل ذكي لتقليل القراءة.</p>
            </div>
            <div className="logs-head-meta">
              آخر تحديث: <b>{fmtDateTime(latestMs)}</b>
              {latestMs ? <span> ({relativeTime(latestMs)})</span> : null}
            </div>
          </div>

          <div className="logs-filters">
            <div className="logs-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                className="dash-input"
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="بحث داخل السجل..."
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

            <div className="logs-meta">
              المعروض: <b>{filtered.length}</b> • الإجمالي: <b>{rows.length}</b>
              {loading ? <span className="logs-loading"> • تحميل...</span> : null}
            </div>
          </div>

          {filtered.length === 0 && !loading ? (
            <div className="logs-empty">لا توجد عمليات مسجلة ضمن الفلاتر الحالية.</div>
          ) : (
            <div className="logs-list">
              {filtered.map((r) => (
                <LogCard
                  key={r.id}
                  row={r}
                  expanded={expandedId === r.id}
                  details={detailsById[r.id]}
                  canRestore={canRestoreRow(r) && restoringLogId !== r.id}
                  onToggleExpand={toggleExpand}
                  onToggleSnapshot={toggleSnapshot}
                  onRestore={openRestoreConfirm}
                />
              ))}
            </div>
          )}

          {hasMore ? (
            <div className="logs-load-more">
              <button
                className="log-secondary-btn"
                type="button"
                onClick={() => loadPage("more")}
                disabled={loadingMore}
              >
                {loadingMore ? "جاري التحميل..." : "تحميل المزيد"}
              </button>
            </div>
          ) : null}
        </div>

        <ConfirmModal
          open={Boolean(restoreTarget)}
          title="تأكيد الاسترجاع"
          message="سيتم استرجاع الحالة السابقة لهذا السجل. هل أنت متأكد؟"
          variant="info"
          confirmText={restoringLogId ? "جاري الاسترجاع..." : "تأكيد الاسترجاع"}
          cancelText="إلغاء"
          showCancel
          onCancel={() => {
            if (restoringLogId) return;
            setRestoreTarget(null);
          }}
          onConfirm={() => {
            if (restoringLogId) return;
            void handleRestore();
          }}
        />
      </div>
    </div>
  );
}
