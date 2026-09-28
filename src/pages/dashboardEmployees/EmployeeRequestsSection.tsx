import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listEmployeeLeaveRequests,
  type EmployeeLeaveRequest,
} from "../../services/employeeHub";
import {
  decideCanonicalEmployeeLeaveRequest,
} from "../../services/canonicalEmployeeLeaveRequests";
import {
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import { useEmployeeLanguage } from "./employeeLanguage";

type EmployeeRequestsSectionProps = {
  isVisible: boolean;
  employeeId: string;
  employeeUid?: string;
  employeeName?: string;
  reviewerUid?: string;
  reviewerName?: string;
  canManage: boolean;
};

type RequestScope = "pending" | "accepted" | "rejected" | "cancelled" | "all";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object") {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") {
      const ms = maybe.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof maybe.seconds === "number") {
      return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1_000_000);
    }
  }
  return 0;
}

function formatDate(value: unknown, language: "ar" | "en" = "ar") {
  const raw = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-");
    return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
      year: "numeric",
      month: "long",
      day: "2-digit",
    }).format(new Date(Number(year), Number(month) - 1, Number(day)));
  }
  const ms = toMillis(value);
  if (!ms) return raw || "-";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  }).format(new Date(ms));
}

function formatDateTime(value: unknown, language: "ar" | "en" = "ar") {
  const ms = toMillis(value);
  if (!ms) return "لم يسجل بعد";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-nu-latn", {
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

function requestMatchesEmployee(request: EmployeeLeaveRequest, employeeId: string, employeeUid?: string) {
  const ids = new Set([cleanText(employeeId), cleanText(employeeUid)].filter(Boolean));
  return ids.has(cleanText(request.employeeId)) || ids.has(cleanText(request.employeeUid));
}

function typeLabel(type: EmployeeLeaveRequest["type"]) {
  if (type === "annual") return "إجازة";
  if (type === "sick") return "إجازة مرضية";
  if (type === "emergency") return "استئذان / اضطراري";
  if (type === "unpaid") return "إجازة بدون راتب";
  return "طلب إداري";
}

function statusLabel(status: EmployeeLeaveRequest["status"]) {
  if (status === "approved") return "مقبول";
  if (status === "rejected") return "مرفوض";
  if (status === "cancelled") return "ملغي";
  return "معلق";
}

function statusTone(status: EmployeeLeaveRequest["status"]): "default" | "gold" | "success" | "danger" {
  if (status === "approved") return "success";
  if (status === "rejected" || status === "cancelled") return "danger";
  if (status === "pending") return "gold";
  return "default";
}

function scopeForStatus(status: EmployeeLeaveRequest["status"]): RequestScope {
  if (status === "approved") return "accepted";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "cancelled";
  return "pending";
}

function formatRange(request: EmployeeLeaveRequest, language: "ar" | "en" = "ar") {
  const from = cleanText(request.fromDate) || "-";
  const to = cleanText(request.toDate) || from;
  const fromLabel = formatDate(from, language);
  const toLabel = formatDate(to, language);
  return from === to ? fromLabel : `${fromLabel} — ${toLabel}`;
}

function requestNumber(request: EmployeeLeaveRequest, index: number) {
  const canonical = cleanText(request.requestNumber);
  if (canonical) return canonical;
  const id = cleanText(request.id);
  if (/^req[-_]/i.test(id)) return id.toUpperCase();
  return `REQ-${String(1000 + index + 1).padStart(4, "0")}`;
}

function scopeTitle(scope: RequestScope) {
  if (scope === "accepted") return "الطلبات المقبولة";
  if (scope === "rejected") return "الطلبات المرفوضة";
  if (scope === "cancelled") return "الطلبات الملغية";
  if (scope === "all") return "كل الطلبات";
  return "الطلبات المعلقة";
}

export default function EmployeeRequestsSection({
  isVisible,
  employeeId,
  employeeUid,
  employeeName,
  reviewerUid,
  reviewerName,
  canManage,
}: EmployeeRequestsSectionProps) {
  const { language, t, tr } = useEmployeeLanguage();
  const [rows, setRows] = useState<EmployeeLeaveRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState<RequestScope>("pending");
  const [adminNote, setAdminNote] = useState("");

  const load = useCallback(async () => {
    if (!isVisible || !employeeId) return;
    setLoading(true);
    setError("");
    try {
      const all = await listEmployeeLeaveRequests(500);
      setRows(all.filter((request) => requestMatchesEmployee(request, employeeId, employeeUid)));
    } catch (err) {
      console.warn("employee requests load failed", err);
      setError("تعذر تحميل طلبات الموظفة.");
    } finally {
      setLoading(false);
    }
  }, [employeeId, employeeUid, isVisible]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => scope === "all" || scopeForStatus(row.status) === scope);
  }, [scope, rows]);

  const pendingCount = rows.filter((row) => row.status === "pending" || !row.status).length;

  const decide = async (request: EmployeeLeaveRequest, nextStatus: "approved" | "rejected" | "cancelled") => {
    if (!canManage) return;
    const uid = cleanText(reviewerUid);
    if (!uid) {
      setError("تعذر تحديد مستخدم الإدارة للمراجعة.");
      return;
    }

    const actionLabel = nextStatus === "approved" ? t("قبول") : nextStatus === "rejected" ? t("رفض") : t("إلغاء");
    const ok = confirm(tr(`تأكيد ${actionLabel} الطلب؟${adminNote ? `\nملاحظة الإدارة: ${adminNote}` : ""}`, `Confirm ${actionLabel} request?${adminNote ? `\nManagement note: ${adminNote}` : ""}`));
    if (!ok) return;

    setSavingId(request.id);
    setError("");
    setMessage("");
    try {
      await decideCanonicalEmployeeLeaveRequest(
        request,
        nextStatus,
        {
          reviewerUid: uid,
          reviewerName:
            reviewerName || t("الإدارة"),
          hrNote: adminNote,
        }
      );
      setMessage(nextStatus === "approved" ? t("تم قبول الطلب.") : nextStatus === "rejected" ? t("تم رفض الطلب.") : t("تم إلغاء الطلب."));
      await load();
    } catch (err) {
      console.warn("employee request decision failed", err);
      setError("تعذر تحديث حالة الطلب.");
    } finally {
      setSavingId("");
    }
  };

  if (!isVisible) return null;

  const state: "loading" | "error" | "empty" | "ready" = loading && !rows.length
    ? "loading"
    : error && !rows.length
      ? "error"
      : filteredRows.length
        ? "ready"
        : "empty";

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-requests-live">
      <WorkspaceTabHeaderV2
        title="الطلبات"
        description="مراجعة الطلبات والمرفقات والملاحظات الإدارية وسجل الإجراءات."
        badge={<WorkspaceStatusBadgeV2 tone={state === "error" ? "danger" : pendingCount ? "gold" : "success"}>{state === "loading" ? t("جاري التحميل") : state === "error" ? t("تعذر التحميل") : pendingCount ? tr(`${pendingCount} طلبات معلقة`, `${pendingCount} pending requests`) : t("جاهزة")}</WorkspaceStatusBadgeV2>}
      />

      {error && rows.length ? <WorkspaceNoticeV2 title="تعذر تحديث الطلبات" description={t("احتفظنا بالطلبات الحالية. أعد المحاولة بعد التحقق من الاتصال.")} tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()}>{t("إعادة المحاولة")}</button>} /> : null}
      {message ? <WorkspaceNoticeV2 title="تم تحديث الطلب" description={t(message)} tone="success" /> : null}

      <WorkspaceCardV2 title="تصفية الطلبات" description="اختيار حالة الطلب للعرض فقط، أما حالة البيانات فتظهر تلقائيًا.">
        <div className="dsv2-ew-form-grid">
          <DashboardFieldV2 id="dsv2-ew-request-scope-live" label={t("حالة الطلب")}>
            <DashboardSelectV2
              id="dsv2-ew-request-scope-live"
              value={scope}
              options={[
                { value: "pending", label: t("المعلقة") },
                { value: "accepted", label: t("المقبولة") },
                { value: "rejected", label: t("المرفوضة") },
                { value: "cancelled", label: t("الملغية") },
                { value: "all", label: t("كل الطلبات") },
              ]}
              onChange={(value) => setScope(value as RequestScope)}
            />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>

      {state === "loading" ? (
        <WorkspaceCardV2 title="جاري تحميل الطلبات" description="يتم جلب طلبات الموظفة الفعلية.">
          <article className="dsv2-ew-skeleton" aria-label={t("جاري تحميل طلبات الموظفة")}>
            <DashboardSkeletonV2 variant="title" width="46%" />
            <DashboardSkeletonV2 lines={3} />
            <DashboardSkeletonV2 variant="block" height={84} />
          </article>
        </WorkspaceCardV2>
      ) : state === "error" ? (
        <WorkspaceNoticeV2
          title="تعذر تحميل الطلبات"
          description={t("احتفظنا بالطلبات الحالية إن وجدت. أعد المحاولة بعد التحقق من الاتصال.")}
          tone="danger"
          action={<button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void load()}>{t("إعادة المحاولة")}</button>}
        />
      ) : state === "empty" ? (
        <WorkspaceCardV2 title={t(scopeTitle(scope))} description={t("لا توجد طلبات مطابقة للبيانات الحالية.")}>
          <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large">
            <strong>{tr("لا توجد طلبات", "No requests")}</strong>
            <span>{tr("ستظهر طلبات الموظفة هنا تلقائياً عند وصولها أو عند تغيير فلتر الحالة.", "Staff requests will appear here automatically when received or when the status filter changes.")}</span>
          </div>
        </WorkspaceCardV2>
      ) : (
        <WorkspaceCardV2 title={t(scopeTitle(scope))} description={tr(`${filteredRows.length} طلبات في الحالة المحددة.`, `${filteredRows.length} requests in the selected status.`)}>
          <WorkspaceTableV2
            headers={["الرقم", "النوع", "تاريخ التقديم", "الفترة المطلوبة", "السبب", "المرفقات", "الإجراءات"]}
            emptyText="لا توجد طلبات في هذه الحالة."
            rows={filteredRows.map((request, index) => [
              <strong>{requestNumber(request, index)}</strong>,
              t(typeLabel(request.type)),
              formatDate(request.createdAt || request.fromDate, language),
              formatRange(request, language),
              request.note || "-",
              t("بدون مرفقات"),
              <div className="dsv2-cluster">
                <WorkspaceStatusBadgeV2 tone={statusTone(request.status)}>{t(statusLabel(request.status))}</WorkspaceStatusBadgeV2>
                {request.status === "pending" || !request.status ? (
                  <>
                    <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "approved")}>{t("قبول")}</button>
                    <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "rejected")}>{t("رفض")}</button>
                  </>
                ) : request.status === "approved" ? (
                  <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "cancelled")}>{t("إلغاء")}</button>
                ) : null}
              </div>,
            ])}
          />
        </WorkspaceCardV2>
      )}

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="ملاحظات الإدارة" description="ملاحظة مرتبطة بآخر إجراء على الطلب.">
          <DashboardFieldV2 id="dsv2-ew-request-note-live" label={t("الملاحظة")}>
            <textarea
              id="dsv2-ew-request-note-live"
              className="dsv2-textarea"
              placeholder={t("اكتب سبب القبول أو الرفض أو أي توجيه للموظفة...")}
              value={adminNote}
              disabled={!canManage}
              onChange={(event) => setAdminNote(event.target.value)}
            />
          </DashboardFieldV2>
        </WorkspaceCardV2>
        <WorkspaceCardV2 title="سجل الإجراءات" description="تسلسل زمني لا يمكن تعديله.">
          <ol className="dsv2-ew-timeline">
            <li><span>{formatDateTime(rows[0]?.createdAt, language)}</span><strong>{tr("تم تقديم آخر طلب", "Latest request submitted")}</strong><small>{employeeName || t("بواسطة الموظفة")}</small></li>
            <li><span>{formatDateTime(rows[0]?.updatedAt, language)}</span><strong>{tr("تم تحديث السجل", "Record updated")}</strong><small>{tr("بواسطة الموارد البشرية", "By Human Resources")}</small></li>
            <li><span>{pendingCount ? t("بانتظار الإجراء") : t("مكتمل")}</span><strong>{tr("قرار الإدارة", "Management decision")}</strong><small>{pendingCount ? t("لم يُسجل بعد") : t("لا توجد طلبات معلقة")}</small></li>
          </ol>
        </WorkspaceCardV2>
      </div>
    </div>
  );
}
