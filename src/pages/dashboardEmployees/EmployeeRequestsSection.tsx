import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listEmployeeLeaveRequests,
  approveEmployeeLeaveRequest,
  reviewLeaveRequest,
  type EmployeeLeaveRequest,
} from "../../services/employeeHub";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
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

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function requestMatchesEmployee(request: EmployeeLeaveRequest, employeeId: string, employeeUid?: string) {
  const ids = new Set([cleanText(employeeId), cleanText(employeeUid)].filter(Boolean));
  return ids.has(cleanText(request.employeeId)) || ids.has(cleanText(request.employeeUid));
}

function typeLabel(type: EmployeeLeaveRequest["type"]) {
  if (type === "annual") return "إجازة سنوية";
  if (type === "sick") return "إجازة مرضية";
  if (type === "emergency") return "إجازة اضطرارية";
  if (type === "unpaid") return "إجازة بدون راتب";
  return "طلب آخر";
}

function statusLabel(status: EmployeeLeaveRequest["status"]) {
  if (status === "approved") return "معتمد";
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

function formatRange(request: EmployeeLeaveRequest) {
  const from = cleanText(request.fromDate) || "-";
  const to = cleanText(request.toDate) || from;
  return from === to ? from : `${from} → ${to}`;
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
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected" | "cancelled">("all");

  const load = useCallback(async () => {
    if (!isVisible || !employeeId) return;
    setLoading(true);
    setError("");
    try {
      const all = await listEmployeeLeaveRequests(500);
      setRows(all.filter((request) => requestMatchesEmployee(request, employeeId, employeeUid)));
    } catch (err) {
      console.warn("employee requests load failed", err);
      setRows([]);
      setError("تعذر تحميل طلبات الموظفة.");
    } finally {
      setLoading(false);
    }
  }, [employeeId, employeeUid, isVisible]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => filter === "all" || cleanText(row.status) === filter);
  }, [filter, rows]);

  const pendingCount = rows.filter((row) => row.status === "pending").length;
  const approvedCount = rows.filter((row) => row.status === "approved").length;
  const rejectedCount = rows.filter((row) => row.status === "rejected").length;

  const decide = async (request: EmployeeLeaveRequest, nextStatus: "approved" | "rejected" | "cancelled") => {
    if (!canManage) return;
    const uid = cleanText(reviewerUid);
    if (!uid) {
      setError("تعذر تحديد مستخدم الإدارة للمراجعة.");
      return;
    }
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

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-requests-live">
      <WorkspaceTabHeaderV2
        title="طلبات الموظفة"
        description="عرض طلبات الإجازة الخاصة بالموظفة ومراجعتها من نفس ملف الموظفة."
        badge={<WorkspaceStatusBadgeV2 tone={pendingCount ? "gold" : "success"}>{pendingCount ? `${pendingCount} معلقة` : "جاهزة"}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-grid dsv2-grid--metrics">
        <WorkspaceMetricV2 label="كل الطلبات" value={rows.length} note={employeeName || employeeId} tone="dark" />
        <WorkspaceMetricV2 label="المعلقة" value={pendingCount} note="تحتاج إجراء" tone={pendingCount ? "gold" : "neutral"} />
        <WorkspaceMetricV2 label="المعتمدة" value={approvedCount} note="مقبولة" tone="success" />
        <WorkspaceMetricV2 label="المرفوضة" value={rejectedCount} note="مغلقة" tone={rejectedCount ? "danger" : "neutral"} />
      </div>

      {error ? <WorkspaceNoticeV2 title="تعذر تحميل الطلبات" description={error} tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>} /> : null}
      {message ? <WorkspaceNoticeV2 title="تم تحديث الطلب" description={message} tone="success" /> : null}

      <WorkspaceCardV2
        title="تصفية الطلبات"
        description="اختيار الحالة ثم مراجعة الطلبات الخاصة بهذه الموظفة فقط."
        actions={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()} disabled={loading}>تحديث</button>}
      >
        <div className="dsv2-ew-pills" role="group">
          {[
            ["all", "كل الطلبات"],
            ["pending", "المعلقة"],
            ["approved", "المعتمدة"],
            ["rejected", "المرفوضة"],
            ["cancelled", "الملغية"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="dsv2-ew-pill"
              data-active={filter === value ? "true" : "false"}
              onClick={() => setFilter(value as typeof filter)}
            >
              {label}
            </button>
          ))}
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="قائمة الطلبات"
        description={loading ? "جاري التحميل..." : `${filteredRows.length} طلبات في الحالة المحددة.`}
      >
        <WorkspaceTableV2
          headers={["النوع", "الفترة", "الأيام", "الحالة", "ملاحظة الموظفة", "الإجراء"]}
          emptyText={loading ? "جاري تحميل الطلبات..." : "لا توجد طلبات لهذه الموظفة."
          }
          rows={filteredRows.map((request) => [
            typeLabel(request.type),
            formatRange(request),
            request.days ?? "-",
            <WorkspaceStatusBadgeV2 tone={statusTone(request.status)}>{statusLabel(request.status)}</WorkspaceStatusBadgeV2>,
            request.note || "-",
            request.status === "pending" ? (
              <div className="dsv2-cluster">
                <button type="button" className="dsv2-btn dsv2-btn--success dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "approved")}>قبول</button>
                <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "rejected")}>رفض</button>
              </div>
            ) : request.status === "approved" ? (
              <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!canManage || savingId === request.id} onClick={() => void decide(request, "cancelled")}>إلغاء</button>
            ) : "-",
          ])}
        />
      </WorkspaceCardV2>
    </div>
  );
}
