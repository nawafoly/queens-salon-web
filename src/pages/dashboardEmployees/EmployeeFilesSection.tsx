import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createEmployeeFileRecord,
  listEmployeeFilesByEmployee,
  markEmployeeFileRead,
  markEmployeeFilesRead,
  type EmployeeFile,
} from "../../services/employeeHub";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";
import { DashboardFieldV2 } from "../../components/dashboard-v2";

type EmployeeFilesSectionProps = {
  isVisible: boolean;
  employeeId: string;
  employeeUid?: string;
  employeeName?: string;
  viewerUid?: string;
  viewerName?: string;
  canManage: boolean;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function fileStatusLabel(status: EmployeeFile["status"]) {
  if (status === "read") return "مقروء";
  if (status === "archived") return "مؤرشف";
  if (status === "replaced") return "مستبدل";
  return "نشط";
}

function fileStatusTone(status: EmployeeFile["status"]): "default" | "gold" | "success" | "danger" {
  if (status === "read") return "success";
  if (status === "archived" || status === "replaced") return "danger";
  if (status === "active") return "gold";
  return "default";
}

function directionLabel(direction: EmployeeFile["direction"]) {
  return direction === "inbound" ? "وارد من الموظفة" : "صادر للموظفة";
}

function formatBytes(value: unknown) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
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
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1_000_000);
  }
  return 0;
}

function formatDate(value: unknown) {
  const ms = toMillis(value);
  if (!ms) return "-";
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export default function EmployeeFilesSection({
  isVisible,
  employeeId,
  employeeUid,
  employeeName,
  viewerUid,
  viewerName,
  canManage,
}: EmployeeFilesSectionProps) {
  const [rows, setRows] = useState<EmployeeFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "unread" | "inbound" | "outbound">("all");
  const [title, setTitle] = useState("");
  const [storageUrl, setStorageUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [mimeType, setMimeType] = useState("");
  const [notes, setNotes] = useState("");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");

  const targetEmployeeUid = cleanText(employeeUid || employeeId);
  const targetEmployeeId = cleanText(employeeId || employeeUid);

  const load = useCallback(async () => {
    if (!isVisible || !targetEmployeeId) return;
    setLoading(true);
    setError("");
    try {
      const files = await listEmployeeFilesByEmployee({
        employeeUid: targetEmployeeUid,
        employeeId: targetEmployeeId,
        limitCount: 120,
      });
      setRows(files);
    } catch (err) {
      console.warn("employee files load failed", err);
      setRows([]);
      setError("تعذر تحميل ملفات الموظفة.");
    } finally {
      setLoading(false);
    }
  }, [isVisible, targetEmployeeId, targetEmployeeUid]);

  useEffect(() => {
    void load();
  }, [load]);

  const unreadCount = useMemo(() => {
    const viewer = cleanText(viewerUid);
    if (!viewer) return 0;
    return rows.filter((row) => !Array.isArray(row.readBy) || !row.readBy.includes(viewer)).length;
  }, [rows, viewerUid]);

  const outboundCount = rows.filter((row) => row.direction !== "inbound").length;
  const inboundCount = rows.filter((row) => row.direction === "inbound").length;

  const filteredRows = rows.filter((row) => {
    if (filter === "active") return row.status !== "archived" && row.status !== "replaced";
    if (filter === "unread") return !!viewerUid && (!Array.isArray(row.readBy) || !row.readBy.includes(viewerUid));
    if (filter === "inbound") return row.direction === "inbound";
    if (filter === "outbound") return row.direction !== "inbound";
    return true;
  });

  const createFile = async () => {
    if (!canManage || saving) return;
    if (!cleanText(title)) {
      setError("اكتب عنوان الملف قبل الحفظ.");
      return;
    }
    if (!targetEmployeeUid && !targetEmployeeId) {
      setError("تعذر تحديد الموظفة لإضافة الملف.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await createEmployeeFileRecord({
        employeeUid: targetEmployeeUid || targetEmployeeId,
        employeeId: targetEmployeeId || undefined,
        direction,
        title,
        fileName,
        mimeType,
        storageUrl,
        notes,
        status: "active",
        createdByUid: viewerUid,
        createdByName: viewerName || "الإدارة",
      });
      setTitle("");
      setStorageUrl("");
      setFileName("");
      setMimeType("");
      setNotes("");
      setDirection("outbound");
      setMessage("تم إضافة سجل الملف للموظفة.");
      await load();
    } catch (err) {
      console.warn("employee file create failed", err);
      setError("تعذر إضافة الملف.");
    } finally {
      setSaving(false);
    }
  };

  const markOneRead = async (file: EmployeeFile) => {
    const reader = cleanText(viewerUid);
    if (!reader) {
      setError("تعذر تحديد المستخدم لتسجيل القراءة.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await markEmployeeFileRead({ fileId: file.id, readerUid: reader });
      setMessage("تم تسجيل الملف كمقروء.");
      await load();
    } catch (err) {
      console.warn("employee file read failed", err);
      setError("تعذر تسجيل قراءة الملف.");
    } finally {
      setSaving(false);
    }
  };

  const markAllRead = async () => {
    const reader = cleanText(viewerUid);
    if (!reader) {
      setError("تعذر تحديد المستخدم لتسجيل القراءة.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await markEmployeeFilesRead({
        employeeUid: targetEmployeeUid,
        employeeId: targetEmployeeId,
        readerUid: reader,
      });
      setMessage("تم تسجيل كل ملفات الموظفة كمقروءة.");
      await load();
    } catch (err) {
      console.warn("employee files mark all read failed", err);
      setError("تعذر تحديث قراءة الملفات.");
    } finally {
      setSaving(false);
    }
  };

  if (!isVisible) return null;

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-files-live">
      <WorkspaceTabHeaderV2
        title="ملفات الموظفة"
        description="عرض مستندات الموظفة وسجل الملفات المرتبطة بها من نفس ملف الموظفة."
        badge={<WorkspaceStatusBadgeV2 tone={unreadCount ? "gold" : "success"}>{unreadCount ? `${unreadCount} غير مقروء` : "جاهزة"}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-grid dsv2-grid--metrics">
        <WorkspaceMetricV2 label="كل الملفات" value={rows.length} note={employeeName || employeeId} tone="dark" />
        <WorkspaceMetricV2 label="غير مقروء" value={unreadCount} note="تحتاج متابعة" tone={unreadCount ? "gold" : "neutral"} />
        <WorkspaceMetricV2 label="صادرة للموظفة" value={outboundCount} note="من الإدارة" tone="success" />
        <WorkspaceMetricV2 label="واردة من الموظفة" value={inboundCount} note="من الموظفة" tone={inboundCount ? "gold" : "neutral"} />
      </div>

      {error ? <WorkspaceNoticeV2 title="تعذر تنفيذ العملية" description={error} tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>} /> : null}
      {message ? <WorkspaceNoticeV2 title="تم تحديث الملفات" description={message} tone="success" /> : null}

      <WorkspaceCardV2
        title="إضافة ملف للموظفة"
        description="إضافة سجل ملف أو رابط مستند مرتبط بهذه الموظفة."
        actions={<button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => void createFile()} disabled={!canManage || saving}>حفظ الملف</button>}
      >
        <div className="dsv2-ew-form-grid">
          <DashboardFieldV2 id="employee-file-title" label="عنوان الملف" required>
            <input className="dsv2-input" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canManage || saving} placeholder="مثال: عقد الموظفة" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-file-url" label="رابط الملف">
            <input className="dsv2-input" value={storageUrl} onChange={(event) => setStorageUrl(event.target.value)} disabled={!canManage || saving} placeholder="https://..." dir="ltr" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-file-name" label="اسم الملف">
            <input className="dsv2-input" value={fileName} onChange={(event) => setFileName(event.target.value)} disabled={!canManage || saving} placeholder="contract.pdf" dir="ltr" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-file-type" label="نوع الملف">
            <input className="dsv2-input" value={mimeType} onChange={(event) => setMimeType(event.target.value)} disabled={!canManage || saving} placeholder="application/pdf" dir="ltr" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-file-direction" label="الاتجاه">
            <select className="dsv2-select" value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)} disabled={!canManage || saving}>
              <option value="outbound">صادر للموظفة</option>
              <option value="inbound">وارد من الموظفة</option>
            </select>
          </DashboardFieldV2>
          <DashboardFieldV2 id="employee-file-notes" label="ملاحظات">
            <input className="dsv2-input" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canManage || saving} placeholder="ملاحظة داخلية قصيرة" />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="تصفية الملفات"
        description="عرض الملفات حسب اتجاهها أو حالة القراءة."
        actions={<div className="dsv2-cluster"><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()} disabled={loading}>تحديث</button><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void markAllRead()} disabled={!viewerUid || saving || !rows.length}>تعليم الكل كمقروء</button></div>}
      >
        <div className="dsv2-ew-pills" role="group">
          {[
            ["all", "كل الملفات"],
            ["active", "النشطة"],
            ["unread", "غير المقروءة"],
            ["outbound", "الصادرة"],
            ["inbound", "الواردة"],
          ].map(([value, label]) => (
            <button key={value} type="button" className="dsv2-ew-pill" data-active={filter === value ? "true" : "false"} onClick={() => setFilter(value as typeof filter)}>
              {label}
            </button>
          ))}
        </div>
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="قائمة الملفات"
        description={loading ? "جاري التحميل..." : `${filteredRows.length} ملف في الفلتر المحدد.`}
      >
        <WorkspaceTableV2
          headers={["العنوان", "الاتجاه", "الحالة", "الحجم", "آخر تحديث", "ملاحظات", "الإجراء"]}
          emptyText={loading ? "جاري تحميل الملفات..." : "لا توجد ملفات لهذه الموظفة."}
          rows={filteredRows.map((file) => [
            <div className="dsv2-stack dsv2-stack--xs"><strong>{file.title || file.fileName || file.id}</strong><small>{file.fileName || file.mimeType || "-"}</small></div>,
            directionLabel(file.direction),
            <WorkspaceStatusBadgeV2 tone={fileStatusTone(file.status)}>{fileStatusLabel(file.status)}</WorkspaceStatusBadgeV2>,
            formatBytes((file as unknown as { sizeBytes?: unknown }).sizeBytes),
            formatDate(file.updatedAt || file.createdAt),
            file.notes || "-",
            <div className="dsv2-cluster">
              {file.storageUrl ? <a className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" href={file.storageUrl} target="_blank" rel="noreferrer">فتح</a> : null}
              <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!viewerUid || saving} onClick={() => void markOneRead(file)}>مقروء</button>
            </div>,
          ])}
        />
      </WorkspaceCardV2>
    </div>
  );
}
