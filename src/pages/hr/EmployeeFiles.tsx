import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowUpFromBracket,
  faCheck,
  faDownload,
  faEye,
  faFileArrowUp,
  faFileLines,
  faInbox,
  faMagnifyingGlass,
  faPaperPlane,
  faPlus,
  faRotate,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
  createEmployeeFileRecord,
  createEmployeeNotification,
  listEmployeeDirectory,
  listEmployeeFiles,
  listEmployeeFilesByEmployee,
  listEmployeeNotifications,
  markEmployeeFilesRead,
  markEmployeeNotificationsRead,
  type EmployeeDirectoryEntry,
  type EmployeeFile,
} from "../../services/employeeHub";
import {
  getEmployeeFileStatusLabel,
  getEmployeeFileTypeLabel,
} from "../../helpers/hr/employeeFiles";
import { uploadFileToR2 } from "../../services/r2Upload";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
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
  return new Intl.DateTimeFormat("ar-SA", {
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

export default function EmployeeFilesPage({ session, onPortalChange }: Props) {
  const [items, setItems] = useState<EmployeeFile[]>([]);
  const [directory, setDirectory] = useState<EmployeeDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [direction, setDirection] = useState<EmployeeFile["direction"]>("outbound");
  const [status, setStatus] = useState<EmployeeFile["status"]>("active");
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
    if (!session.uid) return;
    setLoading(true);
    setNotice("");
    try {
      const [files, roster] = await Promise.all([
        canManage
          ? listEmployeeFiles(240)
          : listEmployeeFilesByEmployee({
              employeeUid: session.uid,
              employeeId: session.employeeId,
              limitCount: 160,
            }),
        canManage ? listEmployeeDirectory() : Promise.resolve([]),
      ]);
      setItems(files);
      setDirectory(roster.filter((item) => item.active !== false));

      if (!canManage) {
        await markEmployeeFilesRead({
          employeeUid: session.uid,
          employeeId: session.employeeId,
          readerUid: session.uid,
        });

        const notifications = await listEmployeeNotifications({
          targetUid: session.uid,
          targetEmployeeId: session.employeeId,
          limitCount: 200,
        });
        const unreadIds = notifications
          .filter((item) => !item.isRead && (item.route === "/employee/files" || item.type === "file"))
          .map((item) => item.id);
        if (unreadIds.length) {
          await markEmployeeNotificationsRead({ notificationIds: unreadIds, readerUid: session.uid });
        }
        await Promise.resolve(onPortalChange?.());
      }
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر تحميل الملفات الداخلية."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uid]);

  const visibleFiles = useMemo(() => {
    const base = canManage
      ? items
      : items.filter((item) => item.employeeUid === session.uid || item.employeeId === session.employeeId);
    return [...base].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [canManage, items, session.employeeId, session.uid]);

  const stats = useMemo(() => {
    const unread = visibleFiles.filter((item) => !(item.readBy || []).map(cleanText).includes(session.uid)).length;
    return {
      total: visibleFiles.length,
      inbound: visibleFiles.filter((item) => item.direction === "inbound").length,
      outbound: visibleFiles.filter((item) => item.direction !== "inbound").length,
      unread,
    };
  }, [session.uid, visibleFiles]);

  const filteredFiles = useMemo(() => {
    const q = cleanText(search).toLowerCase();
    return visibleFiles.filter((item) => {
      const unread = !(item.readBy || []).map(cleanText).includes(session.uid);
      if (tab === "inbound" && item.direction !== "inbound") return false;
      if (tab === "outbound" && item.direction === "inbound") return false;
      if (tab === "unread" && !unread) return false;
      if (!q) return true;
      const employee = directoryByUid.get(item.employeeUid);
      return [item.title, item.fileName, item.notes, employee?.name, item.employeeId]
        .map((value) => cleanText(value).toLowerCase())
        .some((value) => value.includes(q));
    });
  }, [directoryByUid, search, session.uid, tab, visibleFiles]);

  const resetComposer = () => {
    setTitle("");
    setNotes("");
    setDirection("outbound");
    setStatus("active");
    setTargetEmployeeUid("");
    setPickedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!session.uid) return;
    if (!pickedFile) {
      setNotice("اختر ملفًا أولًا.");
      return;
    }
    if (!cleanText(title)) {
      setNotice("عنوان الملف مطلوب.");
      return;
    }

    const employeeUid = canManage ? cleanText(targetEmployeeUid) : session.uid;
    if (canManage && !employeeUid) {
      setNotice("اختر الموظف المستلم.");
      return;
    }
    const employee = directoryByUid.get(employeeUid);

    setBusy(true);
    setNotice("");
    try {
      const uploaded = await uploadFileToR2({
        file: pickedFile,
        keyPrefix: "employee-files",
        ownerId: employeeUid || session.uid,
      });

      await createEmployeeFileRecord({
        employeeUid,
        employeeId: employee?.employeeId || session.employeeId || employeeUid,
        direction,
        title,
        fileName: pickedFile.name,
        mimeType: pickedFile.type || "application/octet-stream",
        storageKey: uploaded.storageKey,
        storageUrl: uploaded.storageUrl,
        notes,
        status,
        createdByUid: session.uid,
        createdByName: session.displayName || session.email,
      });

      if (employeeUid !== session.uid || canManage) {
        await createEmployeeNotification({
          targetUid: employeeUid,
          targetEmployeeId: employee?.employeeId || employeeUid,
          type: "file",
          title: "ملف داخلي جديد",
          body: `${title}${pickedFile.name ? ` — ${pickedFile.name}` : ""}`,
          route: "/employee/files",
        }).catch(() => {});
      }

      resetComposer();
      setComposerOpen(false);
      await load();
      await Promise.resolve(onPortalChange?.());
      setNotice("تم رفع الملف وحفظه بنجاح.");
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر رفع الملف."));
    } finally {
      setBusy(false);
    }
  };

  if (!session.user) {
    return <div className="employee-card">لا توجد جلسة موظف نشطة.</div>;
  }

  return (
    <div className={`hr-ops-page hr-files-page ${canManage ? "is-admin-view" : "is-employee-view"}`} dir="rtl">
      <section className="hr-ops-hero">
        <div className="hr-ops-hero__icon"><FontAwesomeIcon icon={faFileLines} /></div>
        <div>
          <span>الملفات الداخلية</span>
          <h2>الملفات الواردة والمرسلة</h2>
          <p>إرسال العقود والمستندات والملفات الإدارية مع تتبع حالة القراءة.</p>
        </div>
        <div className="hr-ops-hero__actions">
          <button className="hr-ops-button hr-ops-button--ghost" type="button" onClick={() => void load()} disabled={loading || busy}>
            <FontAwesomeIcon icon={faRotate} /><span>{loading ? "جارٍ التحديث" : "تحديث"}</span>
          </button>
          <button className="hr-ops-button hr-ops-button--primary" type="button" onClick={() => setComposerOpen(true)}>
            <FontAwesomeIcon icon={faFileArrowUp} /><span>إرسال ملف</span>
          </button>
        </div>
      </section>

      <section className="hr-ops-stats" aria-label="إحصاءات الملفات">
        <article><span>إجمالي الملفات</span><strong>{stats.total}</strong><FontAwesomeIcon icon={faFileLines} /></article>
        <article><span>الملفات الواردة</span><strong>{stats.inbound}</strong><FontAwesomeIcon icon={faInbox} /></article>
        <article><span>الملفات المرسلة</span><strong>{stats.outbound}</strong><FontAwesomeIcon icon={faPaperPlane} /></article>
        <article className={stats.unread ? "is-warning" : "is-success"}><span>غير مقروءة</span><strong>{stats.unread}</strong><FontAwesomeIcon icon={faCheck} /></article>
      </section>

      {notice ? <div className="hr-ops-alert">{notice}</div> : null}

      <section className="hr-files-board">
        <div className="hr-files-board__head">
          <div>
            <span>سجل الملفات</span>
            <h3>الملفات الداخلية</h3>
            <p>اعرض الملفات حسب الاتجاه أو حالة القراءة وابحث بالعنوان أو اسم الموظف.</p>
          </div>
          <label className="hr-ops-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث في الملفات..." />
          </label>
        </div>

        <div className="hr-files-tabs">
          {([
            ["all", "كل الملفات", stats.total],
            ["inbound", "الواردة", stats.inbound],
            ["outbound", "المرسلة", stats.outbound],
            ["unread", "غير المقروءة", stats.unread],
          ] as Array<[FileTab, string, number]>).map(([value, label, count]) => (
            <button key={value} type="button" className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
              <span>{label}</span><em>{count}</em>
            </button>
          ))}
        </div>

        <div className="hr-files-list">
          {filteredFiles.map((item) => {
            const employee = directoryByUid.get(item.employeeUid);
            const unread = !(item.readBy || []).map(cleanText).includes(session.uid);
            const isInbound = item.direction === "inbound";
            return (
              <article key={item.id} className={`hr-file-card ${unread ? "is-unread" : ""}`}>
                <div className="hr-file-card__type">{fileExtension(item.fileName)}</div>
                <div className="hr-file-card__body">
                  <div className="hr-file-card__badges">
                    <span className={isInbound ? "is-inbound" : "is-outbound"}>{isInbound ? "وارد" : "مرسل"}</span>
                    <span>{getEmployeeFileStatusLabel(item.status, item.status !== "replaced")}</span>
                    {unread ? <span className="is-new">جديد</span> : <span className="is-read">مقروء</span>}
                  </div>
                  <h4>{item.title || "ملف بدون عنوان"}</h4>
                  <p>{item.notes || "لا توجد ملاحظات مرفقة."}</p>
                  <div className="hr-file-card__meta">
                    <span><strong>الموظف:</strong> {employee?.name || item.employeeId || item.employeeUid || "—"}</span>
                    <span><strong>نوع الملف:</strong> {getEmployeeFileTypeLabel(item.fileType)}</span>
                    <span><strong>التاريخ:</strong> {formatDate(item.createdAt)}</span>
                  </div>
                  <div className="hr-file-card__filename">{item.fileName || "اسم الملف غير متوفر"}</div>
                </div>
                <div className="hr-file-card__actions">
                  {item.storageUrl ? (
                    <>
                      <a href={item.storageUrl} target="_blank" rel="noreferrer"><FontAwesomeIcon icon={faEye} /><span>فتح الملف</span></a>
                      <a href={item.storageUrl} target="_blank" rel="noreferrer" download><FontAwesomeIcon icon={faDownload} /><span>تحميل</span></a>
                    </>
                  ) : <span className="hr-file-card__missing">لا يوجد رابط للملف</span>}
                </div>
              </article>
            );
          })}

          {!loading && !filteredFiles.length ? (
            <div className="hr-ops-empty hr-ops-empty--large">
              <FontAwesomeIcon icon={faFileLines} />
              <strong>لا توجد ملفات مطابقة</strong>
              <span>أرسل ملفًا جديدًا أو غيّر الفلتر الحالي.</span>
            </div>
          ) : null}
          {loading ? <div className="hr-ops-loading">جارٍ تحميل الملفات...</div> : null}
        </div>
      </section>

      {composerOpen ? (
        <div className="hr-ops-modal" role="dialog" aria-modal="true" aria-label="إرسال ملف داخلي">
          <button className="hr-ops-modal__backdrop" type="button" onClick={() => !busy && setComposerOpen(false)} aria-label="إغلاق" />
          <section className="hr-ops-modal__card">
            <header>
              <div><span>ملف داخلي جديد</span><h3>إرسال ملف</h3><p>ارفع الملف وحدد الموظف ونوع السجل.</p></div>
              <button type="button" onClick={() => !busy && setComposerOpen(false)} aria-label="إغلاق"><FontAwesomeIcon icon={faXmark} /></button>
            </header>

            <div className="hr-ops-form-grid">
              {canManage ? (
                <label className="hr-ops-field hr-ops-field--wide">
                  <span>الموظف المستلم</span>
                  <select value={targetEmployeeUid} onChange={(event) => setTargetEmployeeUid(event.target.value)}>
                    <option value="">اختر موظفًا</option>
                    {directory.map((item) => (
                      <option key={item.employeeId} value={item.employeeKey || item.linkedUid || item.employeeId}>
                        {item.name || item.email || item.employeeId}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="hr-ops-field hr-ops-field--wide">
                <span>عنوان الملف</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="مثال: عقد العمل أو خطاب إداري" />
              </label>
              <label className="hr-ops-field">
                <span>اتجاه الملف</span>
                <select value={direction} onChange={(event) => setDirection(event.target.value as EmployeeFile["direction"])}>
                  <option value="outbound">مرسل إلى الموظف</option>
                  <option value="inbound">وارد من الموظف</option>
                </select>
              </label>
              <label className="hr-ops-field">
                <span>الحالة</span>
                <select value={status} onChange={(event) => setStatus(event.target.value as EmployeeFile["status"])}>
                  <option value="active">نشط</option>
                  <option value="read">مقروء</option>
                  <option value="replaced">مستبدل</option>
                  <option value="archived">مؤرشف</option>
                </select>
              </label>
              <label className="hr-ops-field hr-ops-field--wide">
                <span>ملاحظات</span>
                <textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="وصف مختصر للملف أو الإجراء المطلوب..." />
              </label>
              <label className="hr-upload-drop hr-ops-field--wide">
                <input ref={fileInputRef} type="file" onChange={(event) => setPickedFile(event.target.files?.[0] || null)} />
                <FontAwesomeIcon icon={faArrowUpFromBracket} />
                <strong>{pickedFile?.name || "اختر ملفًا من الجهاز"}</strong>
                <span>{pickedFile ? `${Math.max(0.01, pickedFile.size / 1024 / 1024).toFixed(2)} MB` : "PDF، صور أو مستندات"}</span>
              </label>
            </div>

            <footer>
              <button className="hr-ops-button hr-ops-button--ghost" type="button" onClick={() => { resetComposer(); setComposerOpen(false); }} disabled={busy}>إلغاء</button>
              <button className="hr-ops-button hr-ops-button--primary" type="button" onClick={() => void handleSubmit()} disabled={busy || !pickedFile || !cleanText(title)}>
                <FontAwesomeIcon icon={faFileArrowUp} /><span>{busy ? "جارٍ الرفع" : "رفع وحفظ الملف"}</span>
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

