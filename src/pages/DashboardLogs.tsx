import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronUp,
  faFilter,
  faMagnifyingGlass,
  faRotateRight,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardConfirmV2,
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { CoreAuditService } from "../services/CoreAuditService";
import { upsertExpenseCore } from "../services/CoreExpenseService";
import { upsertIncomeCore } from "../services/CoreIncomeService";
import { writeAuditLog } from "../services/logService";
import type { Expense, IncomeItem, PaymentMethod } from "../types/finance";
import "../styles/dashboard-v2/dashboard-v2.css";

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

function severityBadgeClass(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return "dsv2-badge--danger";
  if (severity === "warning") return "dsv2-badge--gold";
  return "dsv2-badge--success";
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
    <article className={`dsv2-card logs-v2-entry logs-v2-entry--${severity}`}>
      <header className="logs-v2-entry__head">
        <div className="logs-v2-entry__action">
          <span className="dsv2-badge">{actionLabel}</span>
          {severity === "critical" ? (
            <span className="logs-v2-entry__alert-icon" aria-label="عملية حرجة">
              <FontAwesomeIcon icon={faTriangleExclamation} />
            </span>
          ) : null}
        </div>
        <span className={`dsv2-badge ${severityBadgeClass(severity)}`}>{severityLabel(severity)}</span>
      </header>

      <div className="logs-v2-entry__body">
        <div className="logs-v2-entry__identity">
          <strong>{clientNameLabel}</strong>
          <span className="logs-v2-entry__entity">
            {entityLabel} • {bookingIdLabel}
          </span>
        </div>

        <dl className="logs-v2-entry__meta-grid">
          <div className="logs-v2-entry__meta-item">
            <dt>المنفذ</dt>
            <dd>
              {actor} {showActorRole ? `(${actorRole})` : ""}
            </dd>
          </div>
          <div className="logs-v2-entry__meta-item">
            <dt>المصدر</dt>
            <dd>{sourceLabel}</dd>
          </div>
          <div className="logs-v2-entry__meta-item">
            <dt>الوقت</dt>
            <dd>
              {timeLabel} <span className="logs-v2-entry__relative">• {relative}</span>
            </dd>
          </div>
          <div className="logs-v2-entry__meta-item">
            <dt>الملخص</dt>
            <dd className="logs-v2-entry__summary">{summary}</dd>
          </div>
        </dl>
      </div>

      <footer className="logs-v2-entry__actions">
        <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => onToggleExpand(row)}>
          {expanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}
          <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} />
        </button>
        {canRestore ? (
          <button className="dsv2-btn dsv2-btn--accent dsv2-btn--sm" type="button" onClick={() => onRestore(row)}>
            <FontAwesomeIcon icon={faRotateRight} />
            استرجاع هذه الحالة
          </button>
        ) : null}
      </footer>

      {expanded ? (
        <section className="logs-v2-details" aria-label={`تفاصيل ${actionLabel}`}>
          {details?.loading ? <div className="logs-v2-details__loading">جاري تحميل التفاصيل...</div> : null}
          {details?.error ? <div className="logs-v2-details__error">{details.error}</div> : null}
          {!details?.loading && details?.changes && details.changes.length ? (
            <div className="logs-v2-diff-scroll">
              <div className="logs-v2-diff">
                <div className="logs-v2-diff__head">
                  <span>الحقل</span>
                  <span>قبل</span>
                  <span>بعد</span>
                </div>
                {details.changes.map((change, index) => (
                  <div key={`${row.id}-change-${index}`} className="logs-v2-diff__row">
                    <div className="logs-v2-diff__field">{keyLabel(change.field)}</div>
                    <div className="logs-v2-diff__before">{change.before ?? "—"}</div>
                    <div className="logs-v2-diff__after">{change.after ?? "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : !details?.loading ? (
            <div className="logs-v2-details__empty">لا توجد تغييرات مسجلة لعرضها.</div>
          ) : null}

          {details?.hasSnapshot ? (
            <div className="logs-v2-details__actions">
              <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => onToggleSnapshot(row)}>
                {details?.fullOpen ? "إخفاء snapshot الكامل" : "عرض snapshot الكامل"}
              </button>
            </div>
          ) : null}

          {details?.fullOpen && details?.snapshot ? (
            <div className="logs-v2-snapshot-grid">
              <div className="logs-v2-snapshot">
                <h4>قبل</h4>
                <pre>{JSON.stringify(details.snapshot.before ?? {}, null, 2)}</pre>
              </div>
              <div className="logs-v2-snapshot">
                <h4>بعد</h4>
                <pre>{JSON.stringify(details.snapshot.after ?? {}, null, 2)}</pre>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </article>
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

  const parseRow = useCallback((x: any) => {
    const parseJson = (value: unknown) => {
      if (value && typeof value === "object") return value;
      try { return value ? JSON.parse(String(value)) : undefined; } catch { return undefined; }
    };
    const before = parseJson(x?.beforeJson ?? x?.before_json ?? x?.before);
    const after = parseJson(x?.afterJson ?? x?.after_json ?? x?.after);
    const meta = parseJson(x?.metaJson ?? x?.meta_json ?? x?.meta);
    const atMs = safeMs(x?.createdAt ?? x?.created_at ?? x?.at) || safeMs(meta?.eventAtMs);
    const changesPreview = isObj(before) && isObj(after) ? buildChangesFromBeforeAfter(before, after) : [];
    const displayRaw = meta?.display;
    const display = displayRaw && typeof displayRaw === "object" ? {
      clientName: String(displayRaw?.clientName || "").trim() || undefined,
      bookingPublicId: String(displayRaw?.bookingPublicId || "").trim() || undefined,
      bookingShortId: String(displayRaw?.bookingShortId || "").trim() || undefined,
      bookingId: String(displayRaw?.bookingId || "").trim() || undefined,
    } : undefined;
    const id = String(x?.id || "");
    return {
      id,
      logId: id,
      action: String(x?.action || ""),
      entityType: String(x?.entityType ?? x?.entity_type ?? ""),
      entityId: String(x?.entityId ?? x?.entity_id ?? ""),
      description: String(x?.description || ""),
      summary: String(meta?.summary || ""),
      userName: String(x?.actorName ?? x?.actor_name ?? ""),
      userUid: String(x?.actorUid ?? x?.actor_uid ?? ""),
      userRole: String(meta?.actorRole || ""),
      userEmail: String(x?.actorEmail ?? x?.actor_email ?? ""),
      source: String(x?.source || ""),
      createdAt: x?.createdAt ?? x?.created_at,
      before,
      after,
      meta,
      sensitive: Boolean(meta?.sensitive),
      severity: meta?.severity as any,
      display,
      changedFields: changesPreview.map((item: any) => item.field),
      changesPreview,
      hasSnapshot: Boolean(before || after),
      snapshotId: undefined,
      restore: meta?.restore && typeof meta.restore === "object" ? meta.restore : undefined,
      atMs,
    } as LogRow;
  }, []);

  const loadPage = useCallback(
    async (mode: "initial" | "more") => {
      if (!canManage) return;
      if (mode === "initial") { setLoading(true); setErrMsg(""); }
      else setLoadingMore(true);
      try {
        const requestedLimit = mode === "more" ? Math.min(1000, rows.length + PAGE_SIZE) : PAGE_SIZE;
        const auditRows = await CoreAuditService.list({ limit: requestedLimit });
        const list = auditRows.map(parseRow);
        setHasMore(auditRows.length === requestedLimit && requestedLimit < 1000);
        setRows(list);
      } catch (e: any) {
        console.warn("DashboardLogs Core audit load error:", e);
        setErrMsg("تعذر تحميل سجل العمليات من Core:\n" + String(e?.message || e));
        if (mode === "initial") setRows([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [canManage, parseRow, rows.length]
  );

  useEffect(() => {
    if (!canManage) return;
    setRows([]);
    setDetailsById({});
    setExpandedId(null);
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

  const criticalCount = useMemo(
    () => filtered.filter((row) => (row.severity || actionSeverityFallback(row.action)) === "critical").length,
    [filtered]
  );
  const warningCount = useMemo(
    () => filtered.filter((row) => (row.severity || actionSeverityFallback(row.action)) === "warning").length,
    [filtered]
  );
  const sensitiveCount = useMemo(
    () => filtered.filter((row) => Boolean(row.sensitive)).length,
    [filtered]
  );

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
        const before = row.before;
        const after = row.after;
        const changes = isObj(before) && isObj(after) ? buildChangesFromBeforeAfter(before, after) : inlineChanges;
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
        beforeData = detailsById[row.id]?.snapshot?.before || row.before;
      }

      if (!isObj(beforeData)) {
        setRestoreErr("لا يمكن الاسترجاع لأن بيانات snapshot غير مكتملة.");
        setRestoringLogId("");
        return;
      }

      if (kind === "income") {
        const payload = buildIncomeFromBefore(beforeData, row);
        if (!payload) throw new Error("RESTORE_INVALID");
        await upsertIncomeCore(payload as IncomeItem);
      } else {
        const payload = buildExpenseFromBefore(beforeData, row);
        if (!payload) throw new Error("RESTORE_INVALID");
        await upsertExpenseCore(payload as Expense);
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
      setHasMore(true);
      await loadPage("initial");
    } catch (e: any) {
      const msg = String(e?.message || "");
      setRestoreErr(msg ? `تعذر تنفيذ الاسترجاع: ${msg}` : "تعذر تنفيذ الاسترجاع.");
    } finally {
      setRestoringLogId("");
    }
  };

  const actionSelectOptions = [
    { value: "all", label: "كل العمليات" },
    ...actionOptions.map((value) => ({ value, label: asLabel(ACTION_LABELS, value) })),
  ];
  const entitySelectOptions = [
    { value: "all", label: "كل العناصر" },
    ...entityOptions.map((value) => ({ value, label: asLabel(ENTITY_LABELS, value) })),
  ];
  const sourceSelectOptions = [
    { value: "all", label: "كل المصادر" },
    { value: "dashboard", label: asLabel(SOURCE_LABELS, "dashboard") },
    { value: "internal_booking", label: asLabel(SOURCE_LABELS, "internal_booking") },
    { value: "client_app", label: asLabel(SOURCE_LABELS, "client_app") },
    { value: "system", label: asLabel(SOURCE_LABELS, "system") },
  ];

  if (!authUser) {
    return (
      <main className="dsv2-page logs-v2-page" dir="rtl">
        <DashboardErrorStateV2
          title="غير مصرح"
          description="يلزم تسجيل الدخول بحساب إداري للوصول إلى سجل العمليات."
        />
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="dsv2-page logs-v2-page" dir="rtl">
        <DashboardErrorStateV2
          title="صلاحيات غير كافية"
          description="هذه الصفحة متاحة للأونر أو الأدمن فقط."
        />
      </main>
    );
  }

  return (
    <main className="dsv2-page logs-v2-page" dir="rtl">
      <section className="dsv2-card logs-v2-hero">
        <div className="logs-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">التدقيق والامتثال</span>
          <h1 className="dsv2-page-title">سجل العمليات</h1>
          <p className="dsv2-page-subtitle">
            مراجعة العمليات والتغييرات الحساسة والاسترجاعات من سجل إداري موحد وواضح.
          </p>
        </div>

        <div className="logs-v2-hero__actions" aria-label="إجراءات سجل العمليات">
          <div className="logs-v2-last-update">
            <span>آخر تحديث</span>
            <strong>{fmtDateTime(latestMs)}</strong>
            <small>{latestMs ? relativeTime(latestMs) : "لا توجد عمليات محملة بعد"}</small>
          </div>
          <button
            className="dsv2-btn dsv2-btn--secondary"
            type="button"
            onClick={() => void loadPage("initial")}
            disabled={loading}
          >
            <FontAwesomeIcon icon={faRotateRight} />
            {loading ? "جاري التحديث..." : "تحديث السجل"}
          </button>
        </div>
      </section>

      {errMsg || restoreErr || restoreMsg ? (
        <section className="logs-v2-notices" aria-label="حالة سجل العمليات">
          {errMsg ? <div className="logs-v2-notice logs-v2-notice--error">{errMsg}</div> : null}
          {restoreErr ? <div className="logs-v2-notice logs-v2-notice--error">{restoreErr}</div> : null}
          {restoreMsg ? <div className="logs-v2-notice logs-v2-notice--success">{restoreMsg}</div> : null}
        </section>
      ) : null}

      <section className="logs-v2-metrics" aria-label="ملخص السجل الحالي">
        <article className="dsv2-metric-card dsv2-metric-card--success">
          <span className="dsv2-metric-card__icon" aria-hidden="true"><FontAwesomeIcon icon={faFilter} /></span>
          <p className="dsv2-metric-card__label">النتائج المعروضة</p>
          <p className="dsv2-metric-card__value">{filtered.length}</p>
          <p className="dsv2-metric-card__meta">من أصل {rows.length} عملية محملة</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--danger">
          <span className="dsv2-metric-card__icon" aria-hidden="true"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
          <p className="dsv2-metric-card__label">عمليات حرجة</p>
          <p className="dsv2-metric-card__value">{criticalCount}</p>
          <p className="dsv2-metric-card__meta">تحتاج مراجعة ذات أولوية</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon" aria-hidden="true"><FontAwesomeIcon icon={faRotateRight} /></span>
          <p className="dsv2-metric-card__label">تحتاج مراجعة</p>
          <p className="dsv2-metric-card__value">{warningCount}</p>
          <p className="dsv2-metric-card__meta">تنبيهات ضمن الفلاتر الحالية</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon" aria-hidden="true"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
          <p className="dsv2-metric-card__label">عمليات حساسة</p>
          <p className="dsv2-metric-card__value">{sensitiveCount}</p>
          <p className="dsv2-metric-card__meta">ضمن النتائج المعروضة الآن</p>
        </article>
      </section>

      <section className="dsv2-card dsv2-card--padded logs-v2-panel">
        <header className="logs-v2-panel__head">
          <div className="logs-v2-panel__head-copy">
            <h2>مركز مراجعة العمليات</h2>
            <p>فلترة السجل، فتح التغييرات، مراجعة snapshots، واسترجاع الحالات المؤهلة.</p>
          </div>
          <span className="dsv2-badge dsv2-badge--gold logs-v2-panel__count">
            {filtered.length} نتيجة
          </span>
        </header>

        <div className="logs-v2-filters" aria-label="فلاتر سجل العمليات">
          <label className="dsv2-field logs-v2-filter logs-v2-filter--search">
            <span className="dsv2-field__label">البحث</span>
            <span className="logs-v2-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                className="dsv2-input"
                value={qText}
                onChange={(event) => setQText(event.target.value)}
                placeholder="بحث بالعملية أو المنفذ أو المعرف..."
              />
            </span>
          </label>

          <label className="dsv2-field logs-v2-filter">
            <span className="dsv2-field__label">نوع العملية</span>
            <DashboardSelectV2
              value={actionFilter}
              options={actionSelectOptions}
              onChange={(value) => setActionFilter(value)}
            />
          </label>

          <label className="dsv2-field logs-v2-filter">
            <span className="dsv2-field__label">العنصر</span>
            <DashboardSelectV2
              value={entityFilter}
              options={entitySelectOptions}
              onChange={(value) => setEntityFilter(value)}
            />
          </label>

          <label className="dsv2-field logs-v2-filter">
            <span className="dsv2-field__label">المصدر</span>
            <DashboardSelectV2
              value={sourceFilter}
              options={sourceSelectOptions}
              onChange={(value) => setSourceFilter(value)}
            />
          </label>

          <label className="dsv2-field logs-v2-filter">
            <span className="dsv2-field__label">من تاريخ</span>
            <DashboardDatePickerV2
              value={fromDate}
              placeholder="من تاريخ"
              onChange={setFromDate}
            />
          </label>

          <label className="dsv2-field logs-v2-filter">
            <span className="dsv2-field__label">إلى تاريخ</span>
            <DashboardDatePickerV2
              value={toDate}
              placeholder="إلى تاريخ"
              onChange={setToDate}
            />
          </label>

          <div className="logs-v2-switches">
            <label className={`logs-v2-switch-card ${onlySensitive ? "is-checked" : ""}`}>
              <input
                className="logs-v2-switch-card__input"
                type="checkbox"
                checked={onlySensitive}
                onChange={(event) => setOnlySensitive(event.target.checked)}
              />
              <span className="logs-v2-switch-card__track" aria-hidden="true" />
              <span className="logs-v2-switch-card__copy">
                <strong>العمليات الحساسة فقط</strong>
                <small>عرض السجلات المصنفة حساسة وإخفاء بقية العمليات.</small>
              </span>
            </label>

            <label className={`logs-v2-switch-card ${showLoginEvents ? "is-checked" : ""}`}>
              <input
                className="logs-v2-switch-card__input"
                type="checkbox"
                checked={showLoginEvents}
                onChange={(event) => setShowLoginEvents(event.target.checked)}
              />
              <span className="logs-v2-switch-card__track" aria-hidden="true" />
              <span className="logs-v2-switch-card__copy">
                <strong>إظهار تسجيل الدخول</strong>
                <small>إدراج عمليات تسجيل الدخول والخروج ضمن النتائج الحالية.</small>
              </span>
            </label>
          </div>

          <div className="logs-v2-filter-summary">
            <span>المعروض: <strong>{filtered.length}</strong> • الإجمالي المحمل: <strong>{rows.length}</strong></span>
            {loading ? <span className="logs-v2-loading-inline">جاري تحميل أحدث السجلات...</span> : null}
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="logs-v2-loading-cards" role="status" aria-label="جاري تحميل سجل العمليات">
            {Array.from({ length: 3 }, (_, index) => (
              <article key={index} className="dsv2-card dsv2-card--padded logs-v2-loading-card">
                <DashboardSkeletonV2 variant="title" width="34%" />
                <DashboardSkeletonV2 lines={3} />
              </article>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <DashboardEmptyStateV2
            title="لا توجد عمليات ضمن الفلاتر الحالية"
            description="غيّر البحث أو الفلاتر أو الفترة لعرض سجلات أخرى."
            tone="gold"
            compact
          />
        ) : (
          <div className="logs-v2-list">
            {filtered.map((row) => (
              <LogCard
                key={row.id}
                row={row}
                expanded={expandedId === row.id}
                details={detailsById[row.id]}
                canRestore={canRestoreRow(row) && restoringLogId !== row.id}
                onToggleExpand={toggleExpand}
                onToggleSnapshot={toggleSnapshot}
                onRestore={openRestoreConfirm}
              />
            ))}
          </div>
        )}

        {hasMore ? (
          <div className="logs-v2-load-more">
            <button
              className="dsv2-btn dsv2-btn--secondary"
              type="button"
              onClick={() => void loadPage("more")}
              disabled={loadingMore}
            >
              {loadingMore ? "جاري التحميل..." : "تحميل المزيد"}
            </button>
          </div>
        ) : null}
      </section>

      <DashboardConfirmV2
        open={Boolean(restoreTarget)}
        title="تأكيد الاسترجاع"
        description="سيتم استرجاع الحالة السابقة لهذا السجل وتسجيل العملية في سجل التدقيق."
        tone="gold"
        confirmLabel="تأكيد الاسترجاع"
        pendingLabel="جاري الاسترجاع..."
        cancelLabel="إلغاء"
        onClose={() => {
          if (restoringLogId) return;
          setRestoreTarget(null);
        }}
        onConfirm={handleRestore}
      />
    </main>
  );
}
