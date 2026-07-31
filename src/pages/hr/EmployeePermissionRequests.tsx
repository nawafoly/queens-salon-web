import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faCircleCheck,
  faCircleExclamation,
  faClock,
  faPaperPlane,
  faPlus,
  faRightFromBracket,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
  createPermissionRequest,
  listPermissionRequestsByEmployee,
  type EmployeePermissionRequest,
  type EmployeePermissionStatus,
} from "../../services/employeePermissionRequests";
import { cleanText, type HrSession } from "./shared";
import "../../styles/EmployeePermissionRequests.css";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeKey(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function addMinutesToTime(value: string, minutesToAdd: number) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const total =
    (Number(match[1]) * 60 + Number(match[2]) + minutesToAdd) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60
  ).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

function statusMeta(status: EmployeePermissionStatus) {
  const map: Record<
    EmployeePermissionStatus,
    { label: string; tone: string }
  > = {
    pending: { label: "قيد المراجعة", tone: "warning" },
    approved: { label: "تمت الموافقة", tone: "success" },
    rejected: { label: "مرفوض", tone: "danger" },
    out: { label: "خارج بإذن", tone: "active" },
    returned: { label: "تم اعتماد الاستئذان", tone: "neutral" },
    cancelled: { label: "ملغي", tone: "muted" },
  };
  return map[status] || map.pending;
}

function formatDuration(minutes?: number) {
  if (!Number.isFinite(Number(minutes))) return "";
  const total = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} دقيقة`;
  if (!rest) return `${hours} ساعة`;
  return `${hours} ساعة و${rest} دقيقة`;
}

export default function EmployeePermissionRequestsPage({
  session,
  onPortalChange,
}: Props) {
  const location = useLocation();
  const [requests, setRequests] = useState<EmployeePermissionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const nowTime = localTimeKey();
  const [form, setForm] = useState({
    date: localDateKey(),
    startTime: nowTime,
    expectedReturnTime: addMinutesToTime(nowTime, 60),
    reason: "",
    note: "",
  });

  const profile = session.employeeDoc || session.staffDoc || session.userDoc || {};
  const employeeName =
    cleanText(
      profile.displayName ||
        profile.name ||
        session.displayName ||
        session.email
    ) || "الموظفة";

  const load = useCallback(async () => {
    if (!session.uid) return;
    setLoading(true);
    setMessage("");
    try {
      const rows = await listPermissionRequestsByEmployee(session.uid, 100);
      setRequests(rows);
    } catch (error) {
      setMessage(
        cleanText((error as any)?.message || "تعذر تحميل سجل الاستئذانات.")
      );
    } finally {
      setLoading(false);
    }
  }, [session.uid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("new") === "1") {
      setFormOpen(true);
    }
  }, [location.search]);

  const stats = useMemo(() => {
    return requests.reduce(
      (summary, item) => {
        summary.total += 1;
        if (item.status === "pending") summary.pending += 1;
        if (item.status === "approved") summary.approved += 1;
        if (item.status === "out") summary.out += 1;
        if (item.status === "returned") summary.returned += 1;
        return summary;
      },
      { total: 0, pending: 0, approved: 0, out: 0, returned: 0 }
    );
  }, [requests]);

  const submit = async () => {
    if (!session.uid || saving) return;

    const start = timeToMinutes(form.startTime);
    const expected = timeToMinutes(form.expectedReturnTime);
    if (!form.date || start === null || expected === null) {
      setMessage("أدخل تاريخ ووقت خروج وعودة صحيح.");
      return;
    }
    if (expected <= start) {
      setMessage("وقت العودة المتوقع يجب أن يكون بعد وقت الخروج.");
      return;
    }
    if (!cleanText(form.reason)) {
      setMessage("اكتب سبب الاستئذان.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await createPermissionRequest({
        employeeUid: session.uid,
        employeeId: session.employeeId || session.uid,
        employeeName,
        date: form.date,
        startTime: form.startTime,
        expectedReturnTime: form.expectedReturnTime,
        reason: form.reason,
        note: form.note,
        source: "employee_request",
        status: "pending",
        createdByUid: session.uid,
        createdByName: employeeName,
      });

      setForm((current) => ({
        ...current,
        reason: "",
        note: "",
      }));
      setFormOpen(false);
      await load();
      await Promise.resolve(onPortalChange?.());
      setMessage("تم إرسال طلب الاستئذان إلى الإدارة.");
    } catch (error) {
      setMessage(
        cleanText((error as any)?.message || "تعذر إرسال طلب الاستئذان.")
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="permission-workspace permission-workspace--employee" dir="rtl">
      <section className="permission-hero">
        <div>
          <span>الاستئذانات</span>
          <h1>الخروج المؤقت والعودة</h1>
          <p>
            أرسل طلب استئذان؛ وعند الموافقة يُعتمد وقت الخروج والعودة الذي حددته تلقائيًا.
          </p>
        </div>
        <button type="button" onClick={() => setFormOpen(true)}>
          <FontAwesomeIcon icon={faPlus} />
          طلب استئذان
        </button>
      </section>

      {message ? <div className="permission-alert">{message}</div> : null}

      <section className="permission-stats">
        <article>
          <span>قيد المراجعة</span>
          <strong>{stats.pending}</strong>
          <FontAwesomeIcon icon={faClock} />
        </article>
        <article>
          <span>تمت الموافقة</span>
          <strong>{stats.approved}</strong>
          <FontAwesomeIcon icon={faCircleCheck} />
        </article>
        <article>
          <span>خارج بإذن</span>
          <strong>{stats.out}</strong>
          <FontAwesomeIcon icon={faRightFromBracket} />
        </article>
        <article>
          <span>تم الاعتماد</span>
          <strong>{stats.returned}</strong>
          <FontAwesomeIcon icon={faArrowRotateRight} />
        </article>
      </section>

      <section className="permission-panel">
        <div className="permission-panel__head">
          <div>
            <span>السجل</span>
            <h2>طلبات الاستئذان</h2>
            <p>جميع الطلبات مع الحالة ووقت الخروج والعودة.</p>
          </div>
          <button
            type="button"
            className="permission-refresh"
            onClick={() => void load()}
            disabled={loading}
            aria-label="تحديث"
          >
            <FontAwesomeIcon icon={faArrowRotateRight} spin={loading} />
          </button>
        </div>

        <div className="permission-list">
          {requests.map((item) => {
            const meta = statusMeta(item.status);
            return (
              <article
                key={item.id}
                className={`permission-card is-${meta.tone}`}
              >
                <div className="permission-card__icon">
                  <FontAwesomeIcon icon={faRightFromBracket} />
                </div>
                <div className="permission-card__body">
                  <div className="permission-card__title">
                    <div>
                      <strong>{item.reason || "استئذان"}</strong>
                      <span>{item.date}</span>
                    </div>
                    <em>{meta.label}</em>
                  </div>
                  <div className="permission-card__times">
                    <span>الخروج: {item.actualExitTime || item.startTime || "—"}</span>
                    <span>
                      العودة المحددة: {item.expectedReturnTime || "غير محددة"}
                    </span>
                    {item.actualReturnTime ? (
                      <span>العودة المعتمدة: {item.actualReturnTime}</span>
                    ) : null}
                    {item.durationMinutes !== undefined ? (
                      <span>المدة: {formatDuration(item.durationMinutes)}</span>
                    ) : null}
                    <span>
                      الأثر المالي:{" "}
                      {item.financialEffect === "unpaid"
                        ? "غير مدفوع"
                        : item.financialEffect === "paid"
                          ? "مدفوع"
                          : "بدون تأثير مالي"}
                    </span>
                  </div>
                  {item.note ? (
                    <p>{item.note}</p>
                  ) : (
                    <p className="is-muted">بدون ملاحظة إضافية</p>
                  )}
                </div>
              </article>
            );
          })}

          {!loading && !requests.length ? (
            <div className="permission-empty">
              <FontAwesomeIcon icon={faCircleExclamation} />
              <h3>لا توجد استئذانات مسجلة</h3>
              <p>أنشئ أول طلب وسيظهر هنا مباشرة.</p>
            </div>
          ) : null}
        </div>
      </section>

      {formOpen ? (
        <div
          className="permission-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="permission-request-title"
          onMouseDown={() => setFormOpen(false)}
        >
          <section
            className="permission-modal__panel"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="permission-modal__close"
              onClick={() => setFormOpen(false)}
              aria-label="إغلاق"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>

            <div className="permission-modal__head">
              <span>
                <FontAwesomeIcon icon={faPaperPlane} />
              </span>
              <div>
                <small>طلب جديد</small>
                <h2 id="permission-request-title">طلب استئذان</h2>
                <p>حدد وقت الخروج والعودة المتوقع ثم اكتب السبب.</p>
              </div>
            </div>

            <div className="permission-form">
              <label>
                <span>التاريخ</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>وقت الخروج</span>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      startTime: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>العودة المتوقعة</span>
                <input
                  type="time"
                  value={form.expectedReturnTime}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      expectedReturnTime: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="is-wide">
                <span>سبب الاستئذان</span>
                <input
                  type="text"
                  value={form.reason}
                  placeholder="مثال: موعد طبي أو ظرف عائلي"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="is-wide">
                <span>ملاحظة اختيارية</span>
                <textarea
                  value={form.note}
                  placeholder="أي تفاصيل تحتاج الإدارة إلى معرفتها"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <button
              type="button"
              className="permission-submit"
              onClick={() => void submit()}
              disabled={saving}
            >
              <FontAwesomeIcon icon={faPaperPlane} />
              {saving ? "جاري الإرسال..." : "إرسال طلب الاستئذان"}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
