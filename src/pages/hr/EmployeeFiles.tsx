import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faDownload,
  faEye,
  faFileLines,
  faInbox,
  faRotate,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardEmptyStateV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import {
  downloadCoreEmployeeFile,
  listMyCoreEmployeeFiles,
  markCoreEmployeeFileRead,
  openCoreEmployeeFile,
  type CoreEmployeeFile,
} from "../../services/employeeFilesCore";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

function formatDate(value: unknown) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "—";
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

export default function EmployeeFilesPage({ session, onPortalChange }: Props) {
  const [items, setItems] = useState<CoreEmployeeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyFileId, setBusyFileId] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    if (!session.uid || !session.employeeId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      setItems(await listMyCoreEmployeeFiles(120));
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر تحميل الملفات الداخلية."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.uid, session.employeeId]);

  const stats = useMemo(() => ({
    total: items.length,
    unread: items.filter((item) => cleanText(item.status).toLowerCase() !== "read").length,
  }), [items]);

  const consume = async (item: CoreEmployeeFile, mode: "open" | "download") => {
    if (busyFileId) return;
    setBusyFileId(item.id);
    setNotice("");
    try {
      if (mode === "open") {
        await openCoreEmployeeFile(item.id, item.fileName || "attachment");
      } else {
        await downloadCoreEmployeeFile(item.id, item.fileName || "attachment");
      }
      if (cleanText(item.status).toLowerCase() !== "read") {
        const updated = await markCoreEmployeeFileRead(item.id);
        if (updated) {
          setItems((current) => current.map((row) => row.id === item.id ? updated : row));
          await onPortalChange?.();
        }
      }
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر فتح الملف."));
    } finally {
      setBusyFileId("");
    }
  };

  if (!session.user) {
    return (
      <main className="dashboard-v2 dsv2-page admin-files-v2-page" dir="rtl">
        <DashboardEmptyStateV2 title="لا توجد جلسة موظف نشطة" tone="gold" />
      </main>
    );
  }

  if (!session.employeeId) {
    return (
      <main className="dashboard-v2 dsv2-page admin-files-v2-page" dir="rtl">
        <DashboardEmptyStateV2
          title="الحساب غير مرتبط بملف موظفة"
          description="يجب ربط الحساب بملف الموظفة في Core قبل عرض الملفات الداخلية."
          tone="gold"
        />
      </main>
    );
  }

  return (
    <main className="dashboard-v2 dsv2-page admin-files-v2-page" dir="rtl">
      <section className="admin-files-v2-hero">
        <div className="admin-files-v2-hero__copy">
          <span>الملفات الداخلية</span>
          <h1>ملفاتي</h1>
          <p>المستندات المرسلة لك من الإدارة محفوظة في Core D1 وR2 وتُفتح عبر جلسة دخولك فقط.</p>
        </div>
        <div className="admin-files-v2-hero__actions">
          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => void load()} disabled={loading}>
            <FontAwesomeIcon icon={faRotate} />
            <span>تحديث</span>
          </button>
        </div>
      </section>

      <section className="admin-files-v2-stats" aria-label="ملخص الملفات">
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faFileLines} /></span>
          <p className="dsv2-metric-card__label">إجمالي الملفات</p>
          <strong className="dsv2-metric-card__value">{stats.total}</strong>
        </article>
        <article className={`dsv2-metric-card ${stats.unread ? "dsv2-metric-card--danger" : "dsv2-metric-card--gold"}`}>
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faInbox} /></span>
          <p className="dsv2-metric-card__label">غير مقروء</p>
          <strong className="dsv2-metric-card__value">{stats.unread}</strong>
        </article>
      </section>

      {notice ? <div className="admin-files-v2-alert" role="status">{notice}</div> : null}

      <section className="dsv2-card admin-files-v2-board">
        <header className="admin-files-v2-board__head">
          <div>
            <span>المستندات</span>
            <strong>{items.length} ملف</strong>
          </div>
        </header>

        <div className="admin-files-v2-list">
          {loading && !items.length ? (
            <div className="admin-files-v2-loading" role="status" aria-label="جارٍ تحميل الملفات">
              <DashboardSkeletonV2 variant="block" height={136} />
              <DashboardSkeletonV2 variant="block" height={136} />
            </div>
          ) : (
            items.map((item) => {
              const isRead = cleanText(item.status).toLowerCase() === "read";
              const isBusy = busyFileId === item.id;
              return (
                <article key={item.id} className={`admin-files-v2-file${!isRead ? " is-unread" : ""}`}>
                  <div className="admin-files-v2-file__type">{fileExtension(item.fileName)}</div>
                  <div className="admin-files-v2-file__body">
                    <div className="admin-files-v2-file__badges">
                      <span data-tone="outbound">مرسل من الإدارة</span>
                      <span data-tone={isRead ? "read" : "unread"}>{isRead ? "مقروء" : "جديد"}</span>
                    </div>
                    <h3>{item.title || "ملف بدون عنوان"}</h3>
                    <p>{item.notes || "لا توجد ملاحظات مرفقة."}</p>
                    <div className="admin-files-v2-file__meta">
                      <span><strong>التاريخ:</strong> {formatDate(item.createdAt)}</span>
                      <span><strong>اسم الملف:</strong> {item.fileName || "—"}</span>
                    </div>
                  </div>
                  <div className="admin-files-v2-file__actions">
                    <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" disabled={isBusy} onClick={() => void consume(item, "open")}>
                      <FontAwesomeIcon icon={faEye} /><span>{isBusy ? "جارٍ الفتح" : "فتح"}</span>
                    </button>
                    <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" disabled={isBusy} onClick={() => void consume(item, "download")}>
                      <FontAwesomeIcon icon={faDownload} /><span>تحميل</span>
                    </button>
                  </div>
                </article>
              );
            })
          )}

          {!loading && !items.length ? (
            <DashboardEmptyStateV2
              title="لا توجد ملفات داخلية"
              description="أي مستند ترسله الإدارة سيظهر هنا."
              icon={<FontAwesomeIcon icon={faFileLines} />}
              tone="gold"
              compact
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}
