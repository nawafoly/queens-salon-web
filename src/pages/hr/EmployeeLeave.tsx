import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faCalendarCheck,
  faCalendarDays,
  faCircleCheck,
  faCircleExclamation,
  faClock,
  faPaperPlane,
  faPlus,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
  createEmployeeNotification,
  createLeaveRequest,
  listEmployeeNotifications,
  listLeaveRequestsByEmployee,
  markEmployeeNotificationsRead,
  type EmployeeLeaveRequest,
} from "../../services/employeeHub";
import {
  calculateLeaveDaysCount,
  formatLeaveDateRange,
  getLeaveStatusMeta,
  getLeaveTypeLabel,
} from "../../helpers/hr/employeeLeave";
import { cleanText, type HrSession } from "./shared";

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

export default function EmployeeLeavePage({ session, onPortalChange }: Props) {
  const [requests, setRequests] = useState<EmployeeLeaveRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | EmployeeLeaveRequest["status"]>("all");
  const [form, setForm] = useState({
    type: "annual" as EmployeeLeaveRequest["type"],
    fromDate: todayKey(),
    toDate: todayKey(),
    note: "",
  });

  const profile = session.employeeDoc || session.staffDoc || session.userDoc || {};
  const employeeLabel = cleanText(profile.displayName || profile.name || session.displayName || session.email || "الموظفة");
  const leaveBalance = Number(profile.leaveBalanceDays ?? profile.leaveBalance ?? 0);

  const load = useCallback(async () => {
    if (!session.uid) return;
    setLoading(true);
    setMessage("");
    try {
      const rows = await listLeaveRequestsByEmployee(session.uid);
      setRequests(rows);
    } catch (error) {
      setMessage(cleanText((error as any)?.message || "تعذر تحميل طلبات الإجازة."));
    } finally {
      setLoading(false);
    }
  }, [session.uid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session.uid) return;
    void (async () => {
      try {
        const notifications = await listEmployeeNotifications({
          targetUid: session.uid,
          targetEmployeeId: session.employeeId,
          limitCount: 200,
        });
        const ids = notifications
          .filter((item) => !item.isRead && (item.route === "/employee/leave" || item.type === "leave"))
          .map((item) => item.id);
        if (!ids.length) return;
        await markEmployeeNotificationsRead({ notificationIds: ids, readerUid: session.uid });
        await Promise.resolve(onPortalChange?.());
      } catch {
        // no-op
      }
    })();
  }, [onPortalChange, session.employeeId, session.uid]);

  const stats = useMemo(() => {
    const pending = requests.filter((item) => item.status === "pending").length;
    const approved = requests.filter((item) => item.status === "approved").length;
    const rejected = requests.filter((item) => item.status === "rejected").length;
    return { pending, approved, rejected, total: requests.length };
  }, [requests]);

  const filtered = useMemo(() => {
    if (filter === "all") return requests;
    return requests.filter((item) => item.status === filter);
  }, [filter, requests]);

  const days = calculateLeaveDaysCount(form.fromDate, form.toDate) || 0;

  const submit = async () => {
    if (!session.uid) return;
    if (!form.fromDate || !form.toDate || days <= 0) {
      setMessage("اختر فترة إجازة صحيحة.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await createLeaveRequest({
        employeeUid: session.uid,
        employeeId: session.employeeId || session.uid,
        employeeName: employeeLabel,
        type: form.type,
        fromDate: form.fromDate,
        toDate: form.toDate,
        note: form.note,
        days,
        createdByUid: session.uid,
        createdByName: employeeLabel,
      });

      await createEmployeeNotification({
        targetUid: session.uid,
        targetEmployeeId: session.employeeId || session.uid,
        type: "leave",
        title: "تم إرسال طلب الإجازة",
        body: `من ${form.fromDate} إلى ${form.toDate}`,
        route: "/employee/leave",
      }).catch(() => {});

      setForm((current) => ({ ...current, note: "" }));
      setFormOpen(false);
      await load();
      await Promise.resolve(onPortalChange?.());
      setMessage("تم إرسال طلب الإجازة إلى الإدارة.");
    } catch (error) {
      setMessage(cleanText((error as any)?.message || "تعذر إرسال طلب الإجازة."));
    } finally {
      setSaving(false);
    }
  };

  if (!session.user) {
    return (
      <div className="employee-workspace employee-workspace--empty">
        <h2>الإجازات والطلبات</h2>
        <p>لم يتم العثور على جلسة موظف مسجلة.</p>
      </div>
    );
  }

  return (
    <div className="employee-workspace employee-leave-workspace" dir="rtl">
      <section className="employee-workspace-hero employee-workspace-hero--leave">
        <div className="employee-workspace-hero__copy">
          <span className="employee-workspace-kicker">الإجازات والطلبات</span>
          <h1>إدارة رصيدك وطلباتك</h1>
          <p>قدّم طلب إجازة جديدًا، تابع حالة الطلبات السابقة، وراجع رصيدك الحالي من مكان واحد.</p>
        </div>
        <button className="employee-primary-action" type="button" onClick={() => setFormOpen(true)}>
          <FontAwesomeIcon icon={faPlus} />
          طلب إجازة جديد
        </button>
      </section>

      {message ? <div className="employee-workspace-alert">{message}</div> : null}

      <section className="employee-kpi-grid employee-kpi-grid--four">
        <article className="employee-kpi-card is-accent">
          <span>الرصيد الحالي</span>
          <strong>{Number.isFinite(leaveBalance) ? `${leaveBalance} يوم` : "—"}</strong>
          <small>حسب آخر رصيد مسجل في ملفك</small>
          <FontAwesomeIcon icon={faCalendarDays} />
        </article>
        <article className="employee-kpi-card">
          <span>قيد المراجعة</span>
          <strong>{stats.pending}</strong>
          <small>طلبات تنتظر قرار الإدارة</small>
          <FontAwesomeIcon icon={faClock} />
        </article>
        <article className="employee-kpi-card is-success">
          <span>طلبات مقبولة</span>
          <strong>{stats.approved}</strong>
          <small>طلبات تمت الموافقة عليها</small>
          <FontAwesomeIcon icon={faCircleCheck} />
        </article>
        <article className="employee-kpi-card is-danger">
          <span>طلبات مرفوضة</span>
          <strong>{stats.rejected}</strong>
          <small>طلبات لم تتم الموافقة عليها</small>
          <FontAwesomeIcon icon={faCircleExclamation} />
        </article>
      </section>

      <section className="employee-workspace-panel">
        <div className="employee-workspace-panel__head">
          <div>
            <span className="employee-workspace-kicker">السجل</span>
            <h2>طلبات الإجازة</h2>
            <p>يعرض السجل جميع الطلبات المرسلة وحالتها الحالية.</p>
          </div>
          <div className="employee-workspace-toolbar">
            <div className="employee-filter-pills" role="tablist" aria-label="فلترة الطلبات">
              {([
                ["all", "الكل", stats.total],
                ["pending", "قيد المراجعة", stats.pending],
                ["approved", "مقبولة", stats.approved],
                ["rejected", "مرفوضة", stats.rejected],
              ] as const).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? "is-active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}<em>{count}</em>
                </button>
              ))}
            </div>
            <button className="employee-icon-action" type="button" onClick={() => void load()} disabled={loading} aria-label="تحديث">
              <FontAwesomeIcon icon={faArrowRotateRight} spin={loading} />
            </button>
          </div>
        </div>

        <div className="employee-request-list">
          {filtered.map((item) => {
            const statusMeta = getLeaveStatusMeta(item.status);
            return (
              <article key={item.id} className={`employee-request-card is-${item.status || "pending"}`}>
                <div className="employee-request-card__icon">
                  <FontAwesomeIcon icon={faCalendarCheck} />
                </div>
                <div className="employee-request-card__body">
                  <div className="employee-request-card__title">
                    <div>
                      <strong>{getLeaveTypeLabel(item.type)}</strong>
                      <span>{formatLeaveDateRange(item.fromDate, item.toDate)}</span>
                    </div>
                    <em>{statusMeta.label}</em>
                  </div>
                  <div className="employee-request-card__meta">
                    <span>{Number(item.days || calculateLeaveDaysCount(item.fromDate, item.toDate) || 0)} يوم</span>
                    {item.note ? <span>{item.note}</span> : <span>بدون ملاحظة</span>}
                  </div>
                </div>
              </article>
            );
          })}

          {!loading && !filtered.length ? (
            <div className="employee-empty-state">
              <FontAwesomeIcon icon={faCalendarDays} />
              <h3>لا توجد طلبات في هذه الحالة</h3>
              <p>يمكنك إنشاء طلب جديد وسيظهر هنا مباشرة.</p>
            </div>
          ) : null}
        </div>
      </section>

      {formOpen ? (
        <div className="employee-sheet-overlay" role="dialog" aria-modal="true" aria-labelledby="leave-form-title" onMouseDown={() => setFormOpen(false)}>
          <section className="employee-sheet-panel" onMouseDown={(event) => event.stopPropagation()}>
            <button className="employee-sheet-close" type="button" onClick={() => setFormOpen(false)} aria-label="إغلاق">
              <FontAwesomeIcon icon={faXmark} />
            </button>
            <div className="employee-sheet-head">
              <span><FontAwesomeIcon icon={faPaperPlane} /></span>
              <div>
                <small>طلب جديد</small>
                <h2 id="leave-form-title">طلب إجازة</h2>
                <p>أدخل الفترة والنوع ثم أرسل الطلب إلى الإدارة.</p>
              </div>
            </div>

            <div className="employee-sheet-form">
              <label>
                <span>نوع الإجازة</span>
                <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as EmployeeLeaveRequest["type"] }))}>
                  <option value="annual">سنوية</option>
                  <option value="sick">مرضية</option>
                  <option value="emergency">طارئة</option>
                  <option value="unpaid">بدون راتب</option>
                  <option value="other">أخرى</option>
                </select>
              </label>
              <label>
                <span>من تاريخ</span>
                <input type="date" value={form.fromDate} onChange={(event) => setForm((current) => ({ ...current, fromDate: event.target.value }))} />
              </label>
              <label>
                <span>إلى تاريخ</span>
                <input type="date" value={form.toDate} onChange={(event) => setForm((current) => ({ ...current, toDate: event.target.value }))} />
              </label>
              <label className="is-wide">
                <span>ملاحظة</span>
                <textarea rows={5} value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="اكتب سبب الطلب أو أي تفاصيل إضافية..." />
              </label>
            </div>

            <div className="employee-sheet-summary">
              <span>مدة الإجازة المطلوبة</span>
              <strong>{days > 0 ? `${days} يوم` : "—"}</strong>
            </div>

            <div className="employee-sheet-actions">
              <button type="button" className="employee-secondary-action" onClick={() => setFormOpen(false)}>إلغاء</button>
              <button type="button" className="employee-primary-action" onClick={() => void submit()} disabled={saving}>
                <FontAwesomeIcon icon={faPaperPlane} />
                {saving ? "جاري الإرسال..." : "إرسال الطلب"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
