import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpFromBracket,
  faCheckDouble,
  faDownload,
  faEye,
  faFileArrowUp,
  faFileLines,
  faInbox,
  faMagnifyingGlass,
  faPaperPlane,
  faRotate,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import type { EmployeeDirectoryEntry } from "../../services/employeeHub";
import { listEmployeeDirectory } from "../../services/employeeDirectory";
import {
  createCoreEmployeeFile,
  downloadCoreEmployeeFile,
  listCoreEmployeeFiles,
  openCoreEmployeeFile,
  type CoreEmployeeFile,
} from "../../services/employeeFilesCore";
import {
  getEmployeeFileStatusLabel,
  getEmployeeFileTypeLabel,
} from "../../helpers/hr/employeeFiles";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
};

type FileTab = "all" | "inbound" | "outbound" | "unread";

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
    if (typeof maybe.seconds === "number") {
      return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1_000_000);
    }
  }
  return 0;
}

function formatDate(value: unknown) {
  const ms = toMillis(value);
  if (!ms) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function fileExtension(name: unknown) {
  const value = cleanText(name);
  const extension = value.includes(".") ? value.split(".").pop() : "";
  return cleanText(extension).toUpperCase() || "ملف";
}

function isManagementRole(value: unknown) {
  return ["owner", "admin", "hr"].includes(cleanText(value).toLowerCase());
}

export default function AdminFilesV2({ session }: Props) {
  const [items, setItems] = useState<CoreEmployeeFile[]>([]);
  const [directory, setDirectory] = useState<EmployeeDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [direction, setDirection] = useState<CoreEmployeeFile["direction"]>("outbound");
  const [status, setStatus] = useState<CoreEmployeeFile["status"]>("active");
  const [targetEmployeeUid, setTargetEmployeeUid] = useState("");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [tab, setTab] = useState<FileTab>("all");
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canManage = isManagementRole(session.role);

  const directoryByUid = useMemo(() => {
    const map = new Map<string, EmployeeDirectoryEntry>();
    directory.forEach((item) => {
      [item.employeeKey, item.linkedUid, item.employeeId].forEach((key) => {
        const normalized = cleanText(key);
        if (normalized) map.set(normalized, item);
      });
    });
    return map;
  }, [directory]);

  const load = async () => {
    if (!session.uid || !canManage) return;
    setLoading(true);
    setNotice("");
    try {
      const [files, roster] = await Promise.all([
        listCoreEmployeeFiles(240),
        listEmployeeDirectory(),
      ]);
      setItems(files);
      setDirectory(roster.filter((item) => item.active !== false));
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر تحميل الملفات الداخلية."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uid, canManage]);

  const visibleFiles = useMemo(
    () => [...items].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    [items],
  );

  const targetEmployeeForFile = (item: CoreEmployeeFile) =>
    directoryByUid.get(cleanText(item.employeeUid)) ||
    directoryByUid.get(cleanText(item.employeeId));

  const employeeHasRead = (item: CoreEmployeeFile) =>
    item.direction === "inbound" || cleanText(item.status).toLowerCase() === "read";

  const stats = useMemo(() => {
    const unread = visibleFiles.filter((item) => item.direction !== "inbound" && !employeeHasRead(item)).length;
    return {
      total: visibleFiles.length,
      inbound: visibleFiles.filter((item) => item.direction === "inbound").length,
      outbound: visibleFiles.filter((item) => item.direction !== "inbound").length,
      unread,
    };
    // directory aliases intentionally affect read-state resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryByUid, visibleFiles]);

  const filteredFiles = useMemo(() => {
    const q = cleanText(search).toLowerCase();
    return visibleFiles.filter((item) => {
      const unread = item.direction !== "inbound" && !employeeHasRead(item);
      if (tab === "inbound" && item.direction !== "inbound") return false;
      if (tab === "outbound" && item.direction === "inbound") return false;
      if (tab === "unread" && !unread) return false;
      if (!q) return true;
      const employee = targetEmployeeForFile(item);
      return [item.title, item.fileName, item.notes, employee?.name, item.employeeId]
        .map((value) => cleanText(value).toLowerCase())
        .some((value) => value.includes(q));
    });
    // directory aliases intentionally affect search and read-state resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directoryByUid, search, tab, visibleFiles]);

  const recipientOptions = useMemo(
    () => [
      { value: "", label: "اختر موظفة", disabled: true },
      ...directory
        .map((item) => ({
          value: cleanText(item.employeeId),
          label: cleanText(item.name || item.email || item.employeeId),
        }))
        .filter((item) => item.value),
    ],
    [directory],
  );

  const resetComposer = () => {
    setTitle("");
    setNotes("");
    setDirection("outbound");
    setStatus("active");
    setTargetEmployeeUid("");
    setPickedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeComposer = () => {
    if (busy) return;
    resetComposer();
    setComposerOpen(false);
  };

  const handleSubmit = async () => {
    if (!session.uid || !canManage) return;
    if (!pickedFile) {
      setNotice("اختر ملفًا أولًا.");
      return;
    }
    if (!cleanText(title)) {
      setNotice("عنوان الملف مطلوب.");
      return;
    }

    const employeeUid = cleanText(targetEmployeeUid);
    if (!employeeUid) {
      setNotice("اختر الموظفة المستلمة.");
      return;
    }
    const employee = directoryByUid.get(employeeUid);

    setBusy(true);
    setNotice("");
    try {
      await createCoreEmployeeFile({
        employeeId: employee?.employeeId || employeeUid,
        direction,
        title,
        notes,
        status,
        file: pickedFile,
      });

      resetComposer();
      setComposerOpen(false);
      await load();
      setNotice("تم رفع الملف وحفظه بنجاح.");
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر رفع الملف."));
    } finally {
      setBusy(false);
    }
  };

  const tabItems = [
    ["all", "كل الملفات", stats.total],
    ["inbound", "الواردة", stats.inbound],
    ["outbound", "المرسلة", stats.outbound],
    ["unread", "لم تقرأها الموظفة", stats.unread],
  ] as const;

  if (!session.user) {
    return (
      <main className="dashboard-v2 dsv2-page admin-files-v2-page" dir="rtl">
        <DashboardEmptyStateV2 title="لا توجد جلسة موظف نشطة" tone="gold" />
      </main>
    );
  }

  if (!canManage) {
    return (
      <main className="dashboard-v2 dsv2-page admin-files-v2-page" dir="rtl">
        <DashboardEmptyStateV2
          title="لا توجد صلاحية لإدارة ملفات الموظفات"
          description="هذه المساحة متاحة للإدارة والموارد البشرية فقط."
          tone="gold"
        />
      </main>
    );
  }

  return (
    <main className="dashboard-v2 dsv2-page admin-files-v2-page" dir="rtl">
      <section className="admin-files-v2-hero">
        <div className="admin-files-v2-hero__copy">
          <span className="dsv2-badge">الملفات الداخلية</span>
          <h1>ملفات الموظفات</h1>
          <p>إرسال العقود والمستندات والملفات الإدارية ومتابعة وصولها وقراءتها من مكان واحد.</p>
        </div>
        <div className="admin-files-v2-hero__actions">
          <button
            className="dsv2-btn dsv2-btn--secondary"
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
          >
            <FontAwesomeIcon icon={faRotate} spin={loading} />
            <span>{loading ? "جارٍ التحديث" : "تحديث"}</span>
          </button>
          <button
            className="dsv2-btn dsv2-btn--primary"
            type="button"
            onClick={() => setComposerOpen(true)}
            disabled={busy}
          >
            <FontAwesomeIcon icon={faFileArrowUp} />
            <span>إرسال ملف</span>
          </button>
        </div>
      </section>

      <section className="admin-files-v2-stats" aria-label="إحصاءات الملفات">
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faFileLines} /></span>
          <p className="dsv2-metric-card__label">إجمالي الملفات</p>
          <strong className="dsv2-metric-card__value">{stats.total}</strong>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faInbox} /></span>
          <p className="dsv2-metric-card__label">الملفات الواردة</p>
          <strong className="dsv2-metric-card__value">{stats.inbound}</strong>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faPaperPlane} /></span>
          <p className="dsv2-metric-card__label">الملفات المرسلة</p>
          <strong className="dsv2-metric-card__value">{stats.outbound}</strong>
        </article>
        <article className={`dsv2-metric-card ${stats.unread ? "dsv2-metric-card--danger" : "dsv2-metric-card--gold"}`}>
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faCheckDouble} /></span>
          <p className="dsv2-metric-card__label">لم تقرأها الموظفة</p>
          <strong className="dsv2-metric-card__value">{stats.unread}</strong>
        </article>
      </section>

      {notice ? <div className="admin-files-v2-alert" role="status">{notice}</div> : null}

      <section className="dsv2-card admin-files-v2-board">
        <header className="admin-files-v2-board__head">
          <div>
            <span>سجل الملفات</span>
            <strong>{filteredFiles.length} ملف</strong>
          </div>
          <DashboardFieldV2 id="admin-files-search" label="البحث">
            <div className="admin-files-v2-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
              <input
                id="admin-files-search"
                className="dsv2-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث بالعنوان أو اسم الموظفة..."
              />
            </div>
          </DashboardFieldV2>
        </header>

        <div className="admin-files-v2-tabs" aria-label="تصفية الملفات">
          {tabItems.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={tab === value ? "is-active" : ""}
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
            >
              <span>{label}</span>
              <em>{count}</em>
            </button>
          ))}
        </div>

        <div className="admin-files-v2-list">
          {loading && !items.length ? (
            <div className="admin-files-v2-loading" role="status" aria-label="جارٍ تحميل الملفات">
              <DashboardSkeletonV2 variant="block" height={136} />
              <DashboardSkeletonV2 variant="block" height={136} />
              <DashboardSkeletonV2 variant="block" height={136} />
            </div>
          ) : (
            filteredFiles.map((item) => {
              const employee = targetEmployeeForFile(item);
              const isInbound = item.direction === "inbound";
              const hasRead = isInbound ? true : employeeHasRead(item);
              return (
                <article key={item.id} className={`admin-files-v2-file${!hasRead ? " is-unread" : ""}`}>
                  <div className="admin-files-v2-file__type">{fileExtension(item.fileName)}</div>
                  <div className="admin-files-v2-file__body">
                    <div className="admin-files-v2-file__badges">
                      <span data-tone={isInbound ? "inbound" : "outbound"}>{isInbound ? "وارد" : "مرسل"}</span>
                      <span>{getEmployeeFileStatusLabel(item.status, item.status !== "replaced")}</span>
                      {!isInbound ? (
                        <span data-tone={hasRead ? "read" : "unread"}>{hasRead ? "قرأته الموظفة" : "بانتظار القراءة"}</span>
                      ) : null}
                    </div>
                    <h3>{item.title || "ملف بدون عنوان"}</h3>
                    <p>{item.notes || "لا توجد ملاحظات مرفقة."}</p>
                    <div className="admin-files-v2-file__meta">
                      <span><strong>الموظفة:</strong> {employee?.name || item.employeeId || item.employeeUid || "—"}</span>
                      <span><strong>نوع الملف:</strong> {getEmployeeFileTypeLabel(item.fileType)}</span>
                      <span><strong>التاريخ:</strong> {formatDate(item.createdAt)}</span>
                    </div>
                    <div className="admin-files-v2-file__name">{item.fileName || "اسم الملف غير متوفر"}</div>
                  </div>
                  <div className="admin-files-v2-file__actions">
                    <button
                      className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                      type="button"
                      onClick={() => void openCoreEmployeeFile(item.id, item.fileName || "attachment").catch((error) => setNotice(cleanText((error as any)?.message || "تعذر فتح الملف.")))}
                    >
                      <FontAwesomeIcon icon={faEye} /><span>فتح</span>
                    </button>
                    <button
                      className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                      type="button"
                      onClick={() => void downloadCoreEmployeeFile(item.id, item.fileName || "attachment").catch((error) => setNotice(cleanText((error as any)?.message || "تعذر تحميل الملف.")))}
                    >
                      <FontAwesomeIcon icon={faDownload} /><span>تحميل</span>
                    </button>
                  </div>
                </article>
              );
            })
          )}

          {!loading && !filteredFiles.length ? (
            <DashboardEmptyStateV2
              title="لا توجد ملفات مطابقة"
              description="أرسل ملفًا جديدًا أو غيّر الفلتر الحالي."
              icon={<FontAwesomeIcon icon={faFileLines} />}
              tone="gold"
              compact
            />
          ) : null}
        </div>
      </section>

      {composerOpen ? (
        <div className="admin-files-v2-modal" role="dialog" aria-modal="true" aria-labelledby="admin-files-v2-modal-title">
          <button className="admin-files-v2-modal__backdrop" type="button" onClick={closeComposer} aria-label="إغلاق" />
          <section className="admin-files-v2-modal__card">
            <header className="admin-files-v2-modal__head">
              <div>
                <span>ملف داخلي جديد</span>
                <h2 id="admin-files-v2-modal-title">إرسال ملف</h2>
                <p>ارفع الملف وحدد الموظفة ونوع السجل.</p>
              </div>
              <button className="admin-files-v2-modal__close" type="button" onClick={closeComposer} disabled={busy} aria-label="إغلاق">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </header>

            <div className="admin-files-v2-form">
              <DashboardFieldV2 id="admin-file-recipient" label="الموظفة المستلمة" required className="admin-files-v2-field--wide">
                <DashboardSelectV2
                  id="admin-file-recipient"
                  value={targetEmployeeUid}
                  options={recipientOptions}
                  placeholder="اختر موظفة"
                  onChange={setTargetEmployeeUid}
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="admin-file-title" label="عنوان الملف" required className="admin-files-v2-field--wide">
                <input
                  id="admin-file-title"
                  className="dsv2-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="مثال: عقد العمل أو خطاب إداري"
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="admin-file-direction" label="اتجاه الملف">
                <DashboardSelectV2
                  id="admin-file-direction"
                  value={direction || "outbound"}
                  options={[
                    { value: "outbound", label: "مرسل إلى الموظفة" },
                    { value: "inbound", label: "وارد من الموظفة" },
                  ]}
                  onChange={(value) => setDirection(value as CoreEmployeeFile["direction"])}
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="admin-file-status" label="الحالة">
                <DashboardSelectV2
                  id="admin-file-status"
                  value={status || "active"}
                  options={[
                    { value: "active", label: "نشط" },
                    { value: "replaced", label: "مستبدل" },
                    { value: "archived", label: "مؤرشف" },
                  ]}
                  onChange={(value) => setStatus(value as CoreEmployeeFile["status"])}
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="admin-file-notes" label="ملاحظات" className="admin-files-v2-field--wide">
                <textarea
                  id="admin-file-notes"
                  className="dsv2-textarea"
                  rows={4}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="وصف مختصر للملف أو الإجراء المطلوب..."
                />
              </DashboardFieldV2>

              <label className="admin-files-v2-upload admin-files-v2-field--wide">
                <input ref={fileInputRef} type="file" onChange={(event) => setPickedFile(event.target.files?.[0] || null)} />
                <FontAwesomeIcon icon={faArrowUpFromBracket} />
                <strong>{pickedFile?.name || "اختر ملفًا من الجهاز"}</strong>
                <span>{pickedFile ? `${Math.max(0.01, pickedFile.size / 1024 / 1024).toFixed(2)} MB` : "PDF، صور أو مستندات"}</span>
              </label>
            </div>

            <footer className="admin-files-v2-modal__actions">
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={closeComposer} disabled={busy}>إلغاء</button>
              <button
                className="dsv2-btn dsv2-btn--primary"
                type="button"
                onClick={() => void handleSubmit()}
                disabled={busy || !pickedFile || !cleanText(title) || !targetEmployeeUid}
              >
                <FontAwesomeIcon icon={faFileArrowUp} />
                <span>{busy ? "جارٍ الرفع" : "رفع وحفظ الملف"}</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
