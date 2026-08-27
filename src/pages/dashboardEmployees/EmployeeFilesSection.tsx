import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createCoreEmployeeFile,
  downloadCoreEmployeeFile,
  listCoreEmployeeFiles,
  markCoreEmployeeFileRead,
  openCoreEmployeeFile,
  updateCoreEmployeeFileStatus,
  type CoreEmployeeFile,
} from "../../services/employeeFilesCore";
import {
  DashboardDatePickerV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import {
  WorkspaceCardV2,
  WorkspaceMetricV2,
  WorkspaceNoticeV2,
  WorkspaceStatusBadgeV2,
  WorkspaceTableV2,
  WorkspaceTabHeaderV2,
} from "../../components/dashboard-v2/employee-workspace/EmployeeWorkspacePrimitivesV2";

type EmployeeFilesSectionProps = {
  isVisible: boolean;
  employeeId: string;
  employeeUid?: string;
  employeeName?: string;
  viewerUid?: string;
  viewerName?: string;
  canManage: boolean;
};

type FileCategory = "all" | "identity" | "contract" | "certificate" | "other";
type ViewState = "ready" | "loading" | "empty" | "error";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

function categoryOf(file: CoreEmployeeFile): FileCategory {
  const text = `${cleanText(file.fileType)} ${cleanText(file.title)} ${cleanText(file.fileName)} ${cleanText(file.notes)}`.toLowerCase();
  if (/identity|id|هوية|اقامة|إقامة|بطاقة/.test(text)) return "identity";
  if (/contract|عقد|اتفاق/.test(text)) return "contract";
  if (/certificate|cert|شهادة|صحية|مهنية/.test(text)) return "certificate";
  return "other";
}

function categoryLabel(category: FileCategory) {
  if (category === "identity") return "هوية";
  if (category === "contract") return "عقود";
  if (category === "certificate") return "شهادات";
  if (category === "other") return "أخرى";
  return "كل المستندات";
}

function statusMeta(file: CoreEmployeeFile): { label: string; tone: "default" | "gold" | "success" | "danger"; note: string } {
  const status = cleanText(file.status || "active").toLowerCase();
  const expiryMatch = cleanText(file.notes).match(/تاريخ الانتهاء:\s*(\d{4}-\d{2}-\d{2})/);
  const expiry = expiryMatch?.[1] || "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (status === "archived" || status === "replaced") {
    return { label: status === "archived" ? "محذوف" : "مستبدل", tone: "danger", note: "-" };
  }
  if (expiry) {
    const expiresAt = new Date(`${expiry}T00:00:00`);
    const diffDays = Math.ceil((expiresAt.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) return { label: "منتهي", tone: "danger", note: "-" };
    if (diffDays <= 45) return { label: "قريب الانتهاء", tone: "gold", note: `يحتاج تجديد خلال ${diffDays} يومًا` };
  }
  if (status === "read") return { label: "مقروء", tone: "success", note: "-" };
  return { label: "ساري", tone: "success", note: "-" };
}

function expiryOf(file: CoreEmployeeFile) {
  return cleanText(file.notes).match(/تاريخ الانتهاء:\s*(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

export default function EmployeeFilesSection({
  isVisible,
  employeeId,
  employeeName,
  canManage,
}: EmployeeFilesSectionProps) {
  const [rows, setRows] = useState<CoreEmployeeFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FileCategory>("all");
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [documentType, setDocumentType] = useState<FileCategory>("certificate");
  const [expiryDate, setExpiryDate] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const targetEmployeeId = cleanText(employeeId);

  const load = useCallback(async () => {
    if (!isVisible || !targetEmployeeId) return;
    setLoading(true);
    setError("");
    try {
      const files = await listCoreEmployeeFiles(500);
      setRows(files.filter((file) => cleanText(file.employeeId) === targetEmployeeId));
    } catch (err) {
      console.warn("employee core files load failed", err);
      setRows([]);
      setError("تعذر تحميل ملفات الموظفة من Core.");
    } finally {
      setLoading(false);
    }
  }, [isVisible, targetEmployeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const activeRows = rows.filter((row) => !["archived", "replaced"].includes(cleanText(row.status).toLowerCase()));
    return {
      all: activeRows.length,
      identity: activeRows.filter((file) => categoryOf(file) === "identity").length,
      contract: activeRows.filter((file) => categoryOf(file) === "contract").length,
      certificate: activeRows.filter((file) => categoryOf(file) === "certificate").length,
      other: activeRows.filter((file) => categoryOf(file) === "other").length,
      valid: activeRows.filter((file) => statusMeta(file).tone === "success").length,
      expiring: activeRows.filter((file) => statusMeta(file).tone === "gold").length,
      expired: activeRows.filter((file) => statusMeta(file).tone === "danger").length,
    };
  }, [rows]);

  const filteredRows = rows.filter((row) => {
    if (["archived", "replaced"].includes(cleanText(row.status).toLowerCase())) return false;
    return category === "all" || categoryOf(row) === category;
  });

  const visibleState: ViewState = loading && !rows.length
    ? "loading"
    : error && !rows.length
      ? "error"
      : filteredRows.length
        ? "ready"
        : "empty";

  const acceptFile = (file?: File | null) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("حجم الملف أكبر من 10 ميجابايت.");
      return;
    }
    setError("");
    setSelectedFile(file);
    if (!cleanText(title)) setTitle(file.name.replace(/\.[^.]+$/, ""));
    setMessage(`تم اختيار الملف: ${file.name}`);
  };

  const resetForm = () => {
    setTitle("");
    setNotes("");
    setExpiryDate("");
    setDocumentType("certificate");
    setSelectedFile(null);
    setReplacementId("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const createFile = async () => {
    if (!canManage || saving) return;
    if (!cleanText(title)) {
      setError("اكتب اسم المستند قبل الحفظ.");
      return;
    }
    if (!targetEmployeeId) {
      setError("تعذر تحديد الموظفة لإضافة الملف.");
      return;
    }
    if (!selectedFile) {
      setError("اختر الملف من الجهاز قبل الحفظ.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const categoryName = categoryLabel(documentType);
      const noteParts = [notes, expiryDate ? `تاريخ الانتهاء: ${expiryDate}` : "", `تصنيف: ${categoryName}`].filter(Boolean);
      await createCoreEmployeeFile({
        employeeId: targetEmployeeId,
        direction: "outbound",
        title: cleanText(title),
        notes: noteParts.join(" | "),
        status: "active",
        file: selectedFile,
        replacesFileId: cleanText(replacementId) || undefined,
      });
      resetForm();
      setMessage(replacementId ? "تم رفع النسخة الجديدة وربطها بالمستند السابق." : "تم رفع المستند إلى Core D1 / R2.");
      await load();
    } catch (err) {
      console.warn("employee core file create failed", err);
      setError("تعذر رفع الملف إلى Core/R2.");
    } finally {
      setSaving(false);
    }
  };

  const markOneRead = async (file: CoreEmployeeFile) => {
    setSaving(true);
    setError("");
    try {
      await markCoreEmployeeFileRead(file.id);
      setMessage("تم تسجيل حالة الملف كمقروءة في Core.");
      await load();
    } catch (err) {
      console.warn("employee core file read failed", err);
      setError("تعذر تسجيل حالة القراءة.");
    } finally {
      setSaving(false);
    }
  };

  const markAllRead = async () => {
    const activeRows = rows.filter((row) => !["archived", "replaced", "read"].includes(cleanText(row.status).toLowerCase()));
    if (!activeRows.length) return;
    setSaving(true);
    setError("");
    try {
      await Promise.all(activeRows.map((file) => markCoreEmployeeFileRead(file.id)));
      setMessage("تم تسجيل الملفات النشطة كمقروءة في Core.");
      await load();
    } catch (err) {
      console.warn("employee core files mark all read failed", err);
      setError("تعذر تحديث حالات قراءة الملفات.");
    } finally {
      setSaving(false);
    }
  };

  const archiveFile = async (file: CoreEmployeeFile) => {
    if (!canManage || saving) return;
    const ok = confirm(`حذف ${file.title}؟\nسيتم أرشفته من القائمة النشطة مع بقاء السجل في Core.`);
    if (!ok) return;
    setSaving(true);
    setError("");
    try {
      await updateCoreEmployeeFileStatus(file.id, "archived");
      setMessage("تم أرشفة المستند في Core.");
      await load();
    } catch (err) {
      console.warn("employee core file archive failed", err);
      setError("تعذر أرشفة المستند.");
    } finally {
      setSaving(false);
    }
  };

  const prefillReplacement = (file: CoreEmployeeFile) => {
    setTitle(file.title ? `${file.title} - نسخة محدثة` : "نسخة مستند محدثة");
    setNotes(`استبدال للمستند: ${file.title}`);
    setDocumentType(categoryOf(file));
    setExpiryDate("");
    setSelectedFile(null);
    setReplacementId(file.id);
    if (fileInputRef.current) fileInputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!isVisible) return null;

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-files-live">
      <WorkspaceTabHeaderV2
        title="الملفات"
        description="مستندات الموظفة محفوظة ببياناتها في Core D1 ومحتواها الثنائي في R2 مع تنزيل ومعاينة مصادق عليهما."
        badge={<WorkspaceStatusBadgeV2 tone={counts.expiring ? "gold" : "success"}>{counts.expiring ? "ملف قريب الانتهاء" : "Core / R2"}</WorkspaceStatusBadgeV2>}
      />

      <div className="dsv2-ew-metrics">
        <WorkspaceMetricV2 label="إجمالي الملفات" value={counts.all} note={employeeName || employeeId} />
        <WorkspaceMetricV2 label="السارية" value={counts.valid} tone="success" />
        <WorkspaceMetricV2 label="قريب الانتهاء" value={counts.expiring} tone="gold" />
        <WorkspaceMetricV2 label="المنتهية" value={counts.expired} tone="danger" />
      </div>

      {error ? <WorkspaceNoticeV2 title="تعذر تنفيذ العملية" description={error} tone="danger" action={<button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>} /> : null}
      {message ? <WorkspaceNoticeV2 title="تم تحديث الملفات" description={message} tone="success" /> : null}

      <div className="dsv2-ew-files-layout">
        <WorkspaceCardV2 title="تصنيفات المستندات" description="تصفية القائمة حسب النوع." className="dsv2-ew-file-categories">
          <nav className="dsv2-ew-category-list" aria-label="تصنيفات الملفات">
            {[
              ["all", "كل المستندات", counts.all],
              ["identity", "الهوية", counts.identity],
              ["contract", "العقود", counts.contract],
              ["certificate", "الشهادات", counts.certificate],
              ["other", "أخرى", counts.other],
            ].map(([value, label, count]) => (
              <button key={String(value)} type="button" data-active={category === value ? "true" : "false"} onClick={() => setCategory(value as FileCategory)}>
                <span>{label}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </nav>
        </WorkspaceCardV2>

        <WorkspaceCardV2 title="رفع ملف" description="السحب والإفلات أو اختيار ملف من الجهاز — حتى 10 ميجابايت." className="dsv2-ew-file-uploader">
          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(event) => acceptFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className="dsv2-ew-dropzone"
            data-dragging={dragging ? "true" : "false"}
            disabled={!canManage || saving}
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              acceptFile(event.dataTransfer.files?.[0]);
            }}
            onDragOver={(event) => event.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="dsv2-ew-dropzone__icon">↑</span>
            <strong>{selectedFile ? selectedFile.name : dragging ? "أفلِت الملف هنا" : "اسحب الملف وأفلته هنا"}</strong>
            <small>{selectedFile ? `${Math.ceil(selectedFile.size / 1024)} KB` : "أو اضغط لاختيار ملف"}</small>
          </button>
          <button type="button" className="dsv2-btn dsv2-btn--accent" disabled={!canManage || saving || !selectedFile} onClick={() => void createFile()}>{replacementId ? "رفع النسخة البديلة" : "رفع مستند جديد"}</button>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2
        title="قائمة المستندات"
        description="الفتح والتنزيل يمران عبر Core Files API بمصادقة كاملة ولا يتم استخدام روابط تخزين مباشرة."
        actions={<div className="dsv2-cluster"><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()} disabled={loading}>تحديث</button><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void markAllRead()} disabled={saving || !rows.length}>تعليم الكل كمقروء</button></div>}
      >
        <div className="dsv2-ew-form-grid">
          <DashboardFieldV2 id="dsv2-ew-file-category-live" label="التصنيف">
            <DashboardSelectV2
              id="dsv2-ew-file-category-live"
              value={category}
              options={[
                { value: "all", label: "كل المستندات" },
                { value: "identity", label: "الهوية" },
                { value: "contract", label: "العقود" },
                { value: "certificate", label: "الشهادات" },
                { value: "other", label: "أخرى" },
              ]}
              onChange={(value) => setCategory(value as FileCategory)}
            />
          </DashboardFieldV2>
        </div>

        {visibleState === "ready" ? (
          <WorkspaceTableV2
            headers={["اسم المستند", "النوع", "تاريخ الرفع", "تاريخ الانتهاء", "الملاحظات", "الحالة", "الإجراءات"]}
            emptyText="لا توجد مستندات في هذا التصنيف."
            rows={filteredRows.map((file) => {
              const meta = statusMeta(file);
              return [
                <strong>{file.title || file.fileName || file.id}</strong>,
                categoryLabel(categoryOf(file)),
                formatDate(file.createdAt),
                formatDate(expiryOf(file)),
                meta.note !== "-" ? meta.note : file.notes || "-",
                <WorkspaceStatusBadgeV2 tone={meta.tone}>{meta.label}</WorkspaceStatusBadgeV2>,
                <div className="dsv2-ew-file-actions">
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void openCoreEmployeeFile(file.id, file.fileName || file.title)}>معاينة</button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void downloadCoreEmployeeFile(file.id, file.fileName || file.title)}>تنزيل</button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!canManage || saving} onClick={() => prefillReplacement(file)}>استبدال</button>
                  <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!canManage || saving} onClick={() => void archiveFile(file)}>حذف</button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={saving || file.status === "read"} onClick={() => void markOneRead(file)}>مقروء</button>
                </div>,
              ];
            })}
          />
        ) : visibleState === "loading" ? (
          <article className="dsv2-ew-skeleton" aria-label="جاري تحميل ملفات الموظفة">
            <DashboardSkeletonV2 variant="title" width="48%" />
            <DashboardSkeletonV2 lines={3} />
            <DashboardSkeletonV2 variant="block" height={84} />
          </article>
        ) : visibleState === "empty" ? (
          <div className="dsv2-ew-inline-empty dsv2-ew-inline-empty--large">
            <strong>لا توجد ملفات</strong>
            <span>ارفع أول مستند للموظفة ليظهر هنا.</span>
          </div>
        ) : (
          <WorkspaceNoticeV2
            title="تعذر تحميل الملفات"
            description="تعذر الوصول إلى Core/R2. لم يتم استخدام أي Firestore fallback."
            tone="danger"
            action={<button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>}
          />
        )}
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title={replacementId ? "بيانات النسخة البديلة" : "بيانات مستند"}
        description="بيانات المستند تحفظ في D1 والملف نفسه يرفع إلى R2."
        actions={<button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => void createFile()} disabled={!canManage || saving || !selectedFile}>حفظ ورفع</button>}
      >
        <div className="dsv2-ew-form-grid dsv2-ew-form-grid--2">
          <DashboardFieldV2 id="dsv2-ew-document-name-live" label="اسم المستند">
            <input id="dsv2-ew-document-name-live" className="dsv2-input" value={title} disabled={!canManage || saving} onChange={(event) => setTitle(event.target.value)} placeholder="شهادة صحية" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-type-live" label="النوع">
            <DashboardSelectV2
              id="dsv2-ew-document-type-live"
              value={documentType}
              disabled={!canManage || saving}
              options={[
                { value: "identity", label: "هوية" },
                { value: "contract", label: "عقد" },
                { value: "certificate", label: "شهادة" },
                { value: "other", label: "أخرى" },
              ]}
              onChange={(value) => setDocumentType(value as FileCategory)}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-expiry-live" label="تاريخ الانتهاء">
            <DashboardDatePickerV2 id="dsv2-ew-document-expiry-live" value={expiryDate} disabled={!canManage || saving} onChange={setExpiryDate} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-file-name-live" label="الملف المختار">
            <input id="dsv2-ew-document-file-name-live" className="dsv2-input" value={selectedFile?.name || ""} readOnly placeholder="اختر ملفًا من منطقة الرفع" dir="ltr" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-note-live" label="الملاحظات">
            <input id="dsv2-ew-document-note-live" className="dsv2-input" value={notes} disabled={!canManage || saving} onChange={(event) => setNotes(event.target.value)} placeholder="يلزم التجديد قبل انتهاء الصلاحية" />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>
    </div>
  );
}
