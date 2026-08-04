import { useCallback, useEffect, useMemo, useState } from "react";
import { serverTimestamp, updateDoc } from "firebase/firestore";
import {
  createEmployeeFileRecord,
  listEmployeeFilesByEmployee,
  markEmployeeFileRead,
  markEmployeeFilesRead,
  type EmployeeFile,
} from "../../services/employeeHub";
import { hrDoc } from "../../services/hrCollections";
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

function categoryOf(file: EmployeeFile): FileCategory {
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

function statusMeta(file: EmployeeFile): { label: string; tone: "default" | "gold" | "success" | "danger"; note: string } {
  const status = cleanText(file.status || "active").toLowerCase();
  const expiry = cleanText((file as any).expiresAt || (file as any).expiryDate || (file as any).expiresOn || "");
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (status === "archived" || status === "replaced") {
    return { label: status === "archived" ? "محذوف" : "مستبدل", tone: "danger", note: "-" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    const expiresAt = new Date(`${expiry}T00:00:00`);
    const diffDays = Math.ceil((expiresAt.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) return { label: "منتهي", tone: "danger", note: "-" };
    if (diffDays <= 45) return { label: "قريب الانتهاء", tone: "gold", note: `يحتاج تجديد خلال ${diffDays} يومًا` };
  }
  return { label: "ساري", tone: "success", note: "-" };
}

function fileUrl(file: EmployeeFile) {
  return cleanText(file.storageUrl || (file as any).fileUrl || (file as any).viewUrl || "");
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
  const [category, setCategory] = useState<FileCategory>("all");
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [storageUrl, setStorageUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [notes, setNotes] = useState("");
  const [documentType, setDocumentType] = useState<FileCategory>("certificate");
  const [expiryDate, setExpiryDate] = useState("");

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

  const createFile = async () => {
    if (!canManage || saving) return;
    if (!cleanText(title)) {
      setError("اكتب اسم المستند قبل الحفظ.");
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
      const categoryName = categoryLabel(documentType);
      const noteParts = [notes, expiryDate ? `تاريخ الانتهاء: ${expiryDate}` : "", `تصنيف: ${categoryName}`].filter(Boolean);
      await createEmployeeFileRecord({
        employeeUid: targetEmployeeUid || targetEmployeeId,
        employeeId: targetEmployeeId || undefined,
        direction: "outbound",
        title,
        fileName,
        storageUrl,
        notes: noteParts.join(" | "),
        status: "active",
        createdByUid: viewerUid,
        createdByName: viewerName || "الإدارة",
      });
      setTitle("");
      setStorageUrl("");
      setFileName("");
      setNotes("");
      setExpiryDate("");
      setDocumentType("certificate");
      setMessage("تم رفع بيانات المستند للموظفة.");
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

  const archiveFile = async (file: EmployeeFile) => {
    if (!canManage || saving) return;
    const ok = confirm(`حذف ${file.title}؟\nسيتم أرشفته من قائمة مستندات الموظفة مع بقاء السجل محفوظًا.`);
    if (!ok) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await updateDoc(hrDoc("employeeFiles", file.id), {
        status: "archived",
        updatedAt: serverTimestamp(),
      } as any);
      setMessage("تم حذف المستند من القائمة النشطة.");
      await load();
    } catch (err) {
      console.warn("employee file archive failed", err);
      setError("تعذر حذف المستند.");
    } finally {
      setSaving(false);
    }
  };

  const prefillReplacement = (file: EmployeeFile) => {
    setTitle(file.title ? `${file.title} - نسخة محدثة` : "نسخة مستند محدثة");
    setFileName(file.fileName || "");
    setStorageUrl("");
    setNotes(`استبدال للمستند: ${file.title}`);
    setDocumentType(categoryOf(file));
    setExpiryDate("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!isVisible) return null;

  return (
    <div className="dsv2-ew-tab-panel dsv2-ew-files-live">
      <WorkspaceTabHeaderV2
        title="الملفات"
        description="تصنيف ورفع وسحب وإفلات ومعاينة وتنزيل واستبدال وحذف، مع حالات الصلاحية والفراغ والخطأ."
        badge={<WorkspaceStatusBadgeV2 tone={counts.expiring ? "gold" : "success"}>{counts.expiring ? "ملف قريب الانتهاء" : "جاهزة"}</WorkspaceStatusBadgeV2>}
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

        <WorkspaceCardV2 title="رفع ملف" description="السحب والإفلات أو اختيار ملف من الجهاز." className="dsv2-ew-file-uploader">
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
              setMessage("تم استقبال السحب. أدخل رابط التخزين أو اسم الملف ثم احفظ السجل.");
            }}
            onDragOver={(event) => event.preventDefault()}
            onClick={() => setMessage("أدخل بيانات المستند في النموذج بالأسفل ثم اضغط حفظ التغييرات.")}
          >
            <span className="dsv2-ew-dropzone__icon">↑</span>
            <strong>{dragging ? "أفلِت الملف هنا" : "اسحب الملف وأفلته هنا"}</strong>
            <small>أو اضغط لاختيار ملف — حتى 10 ميجابايت</small>
          </button>
          <button type="button" className="dsv2-btn dsv2-btn--accent" disabled={!canManage || saving} onClick={() => void createFile()}>رفع مستند جديد</button>
        </WorkspaceCardV2>
      </div>

      <WorkspaceCardV2
        title="قائمة المستندات"
        description="حقول انتهاء وملاحظات وإجراءات كاملة لكل مستند."
        actions={<div className="dsv2-cluster"><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void load()} disabled={loading}>تحديث</button><button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => void markAllRead()} disabled={!viewerUid || saving || !rows.length}>تعليم الكل كمقروء</button></div>}
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
              const url = fileUrl(file);
              return [
                <strong>{file.title || file.fileName || file.id}</strong>,
                categoryLabel(categoryOf(file)),
                formatDate(file.createdAt),
                formatDate((file as any).expiresAt || (file as any).expiryDate || (file as any).expiresOn),
                meta.note !== "-" ? meta.note : file.notes || "-",
                <WorkspaceStatusBadgeV2 tone={meta.tone}>{meta.label}</WorkspaceStatusBadgeV2>,
                <div className="dsv2-ew-file-actions">
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!url} onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}>معاينة</button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!url} onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}>تنزيل</button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!canManage || saving} onClick={() => prefillReplacement(file)}>استبدال</button>
                  <button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" disabled={!canManage || saving} onClick={() => void archiveFile(file)}>حذف</button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" disabled={!viewerUid || saving} onClick={() => void markOneRead(file)}>مقروء</button>
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
            description="تعذر الوصول إلى مساحة التخزين. أعد المحاولة دون تغيير الملفات الحالية."
            tone="danger"
            action={<button type="button" className="dsv2-btn dsv2-btn--danger dsv2-btn--sm" onClick={() => void load()}>إعادة المحاولة</button>}
          />
        )}
      </WorkspaceCardV2>

      <WorkspaceCardV2
        title="بيانات مستند"
        description="حقول الاسم والنوع والانتهاء والملاحظات باستخدام مكونات V2."
        actions={<button type="button" className="dsv2-btn dsv2-btn--primary dsv2-btn--sm" onClick={() => void createFile()} disabled={!canManage || saving}>حفظ التغييرات</button>}
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
          <DashboardFieldV2 id="dsv2-ew-document-url-live" label="رابط الملف">
            <input id="dsv2-ew-document-url-live" className="dsv2-input" value={storageUrl} disabled={!canManage || saving} onChange={(event) => setStorageUrl(event.target.value)} placeholder="https://..." dir="ltr" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-file-name-live" label="اسم الملف">
            <input id="dsv2-ew-document-file-name-live" className="dsv2-input" value={fileName} disabled={!canManage || saving} onChange={(event) => setFileName(event.target.value)} placeholder="document.pdf" dir="ltr" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="dsv2-ew-document-note-live" label="الملاحظات">
            <input id="dsv2-ew-document-note-live" className="dsv2-input" value={notes} disabled={!canManage || saving} onChange={(event) => setNotes(event.target.value)} placeholder="يلزم التجديد قبل انتهاء الصلاحية" />
          </DashboardFieldV2>
        </div>
      </WorkspaceCardV2>
    </div>
  );
}
