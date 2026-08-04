import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listEmployeeLeaveRequests,
  approveEmployeeLeaveRequest,
  reviewLeaveRequest,
  type EmployeeLeaveRequest,
} from "../../services/employeeHub";
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

function formatDate(value: unknown) {
  const raw = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-");
    return new Intl.DateTimeFormat("ar-SA", {
      year: "numeric",
      month: "long",
      day: "2-digit",
    }).format(new Date(Number(year), Number(month) - 1, Number(day)));
  }
  const ms = toMillis(value);
  if (!ms) return raw || "-";
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  }).format(new Date(ms));
}

function formatDateTime(value: unknown) {
  const ms = toMillis(value);
  if (!ms) return "لم يسجل بعد";
  return new Intl.DateTimeFormat("ar-SA", {
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

function formatRange(request: EmployeeLeaveRequest) {
  const from = cleanText(request.fromDate) || "-";
  const to = cleanText(request.toDate) || from;
  const fromLabel = formatDate(from);
  const toLabel = formatDate(to);
  return from === to ? fromLabel : `${fromLabel} — ${toLabel}`;
}

function requestNumber(request: EmployeeLeaveRequest, index: number) {
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

    const actionLabel = nextStatus === "approved" ? "قبول" : nextStatus === "rejected" ? "رفض" : "إلغاء";
    const ok = confirm(`تأكيد ${actionLabel} الطلب؟${adminNote ? `\nملاحظة الإدارة: ${adminNote}` : ""}`);
    if (!ok) return;

    setSavingId(request.id);
    setError("");
    setMessage("");
    try {
      if (nextStatus === "approved") {
        await approveEmployeeLeaveRequest({
          requestId: request.id,
          reviewerUid: uid,
          reviewerName: reviewerName || "الإدارة",
        });
      } else {
        await reviewLeaveRequest({
          requestId: request.id,
          status: nextStatus,
          reviewerUid: uid,
          reviewerName: reviewerName || "الإدارة",
        });
      }
      setMessage(nextStatus === "approved" ? "تم قبول الطلب." : nextStatus === "rejected" ? "تم رفض الطلب." : "تم إلغاء الطلب.");
      await load();
    } catch (err) {
      console.warn("employee request decision failed", err);
      setError("تعذر تحديث حالة الطلب.");
    } finally {
      setSavingId("");
    }
  };

  if (!isVisible) return null;

  const state: "loading" | "error" | "ready" = loading && !rows.length ? "loading" : error && !rows.length ? "error" : "ready";

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-requests-live">
      <WorkspaceTabHeaderV2
        title="الطلبات"
        description="مراجعة الطلبات والمرفقات والملاحظات الإدارية وسجل الإجراءات."
        badge={<WorkspaceStatusBadgeV2 tone={state === "error" ? "danger" : pendingCount ? "gold" : "success"}>{state === "loading" ? "جاري التحميل" : state === "error" ? "تعذر التحميل" : pendingCount ? `${pendingCount} طلبات معلقة` : "جاهزة"}</WorkspaceStatusBadgeV2>}
      />

      {error && rows.length ? <WorkspaceNoticeV2 title="تعذر تحديث الطلبات" description="احتفظنا بالطلبات الحالية. أعد المحاولة بعد التحقق من الاتصال." tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>} /> : null}
      {message ? <WorkspaceNoticeV2 title="تم تحديث الطلب" description={message} tone="success" /> : null}

      <WorkspaceCardV2 title="تصفية الطلبات" description="اختيار حالة الطلب للعرض فقط، أما حالة البيانات فتظهر تلقائيًا.">
        <div className="dsv2-ew-form-grid">
          <DashboardFieldV2 id="dsv2-ew-request-scope-live" label="حالة الطلب">
            <DashboardSelectV2
              id="dsv2-ew-request-scope-live"
              value={scope}
              options={[
                { value: "pending", label: "المعلقة" },
                { value: "accepted", label: "المقبولة" },
                { value: "rejected", label: "المرفوضة" },
                { value: "cancelled", label: "الملغية" },
                { value: "all", label: "كل الطلبات" },
              ]}
              onChange={(value) => setScope(value as RequestScope)}
            />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>

      {state === "loading" ? (
        <WorkspaceCardV2 title="جاري تحميل الطلبات" description="يتم جلب طلبات الموظفة الفعلية.">
          <article className="dsv2-ew-skeleton" aria-label="جاري تحميل طلبات الموظفة">
            <DashboardSkeletonV2 variant="title" width="46%" />
            <DashboardSkeletonV2 lines={3} />
            <DashboardSkeletonV2 variant="block" height={84} />
          </article>
        </WorkspaceCardV2>
      ) : state === "error" ? (
        <WorkspaceNoticeV2
          title="تعذر تحميل الطلبات"
          description="احتفظنا بالطلبات الحالية إن وجدت. أعد المحاولة بعد التحقق من الاتصال."
          tone="danger"
          action={<button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>}
        />
      ) : (
        <WorkspaceCardV2 title={scopeTitle(scope)} description={`${filteredRows.length} طلبات في الحالة المحددة.`}>
          <WorkspaceTableV2
            headers={["الرقم", "النوع", "تاريخ التقديم", "الفترة المطلوبة", "السبب", "المرفقات", "الإجراءات"]}
            emptyText="لا توجد طلبات في هذه الحالة."
            rows={filteredRows.map((request, index) => [
              <strong>{requestNumber(request, index)}</strong>,
              typeLabel(request.type),
              formatDate(request.createdAt || request.fromDate),
              formatRange(request),
              request.note || "-",
              "بدون مرفقات",
              <div className="dsv2-cluster">
                <WorkspaceStatusBadgeV2 tone={statusTone(request.status)}>{statusLabel(request.status)}</WorkspaceStatusBadgeV2>
                {request.status === "pending" || !request.status ? (
                  <>
                    <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "approved")}>قبول</button>
                    <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "rejected")}>رفض</button>
                  </>
                ) : request.status === "approved" ? (
                  <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "cancelled")}>إلغاء</button>
                ) : null}
              </div>,
            ])}
          />
        </WorkspaceCardV2>
      )}

      <div className="dsv2-ew-grid dsv2-ew-grid--2">
        <WorkspaceCardV2 title="ملاحظات الإدارة" description="ملاحظة مرتبطة بآخر إجراء على الطلب.">
          <DashboardFieldV2 id="dsv2-ew-request-note-live" label="الملاحظة">
            <textarea
              id="dsv2-ew-request-note-live"
              className="dsv2-textarea"
              placeholder="اكتب سبب القبول أو الرفض أو أي توجيه للموظفة..."
              value={adminNote}
              disabled={!canManage}
              onChange={(event) => setAdminNote(event.target.value)}
            />
          </DashboardFieldV2>
        </WorkspaceCardV2>
        <WorkspaceCardV2 title="سجل الإجراءات" description="تسلسل زمني لا يمكن تعديله.">
          <ol className="dsv2-ew-timeline">
            <li><span>{formatDateTime(rows[0]?.createdAt)}</span><strong>تم تقديم آخر طلب</strong><small>{employeeName || "بواسطة الموظفة"}</small></li>
            <li><span>{formatDateTime(rows[0]?.updatedAt)}</span><strong>تم تحديث السجل</strong><small>بواسطة الموارد البشرية</small></li>
            <li><span>{pendingCount ? "بانتظار الإجراء" : "مكتمل"}</span><strong>قرار الإدارة</strong><small>{pendingCount ? "لم يُسجل بعد" : "لا توجد طلبات معلقة"}</small></li>
          </ol>
        </WorkspaceCardV2>
      </div>
    </div>
  );
}
