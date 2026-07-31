import { useCallback, useEffect, useMemo, useState } from "react";
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

import { listEmployeeDirectory } from "../../services/employeeDirectory";
import {
  createPermissionRequest,
  listEmployeePermissionRequests,
  reviewPermissionRequest,
  type EmployeePermissionFinancialEffect,
  type EmployeePermissionRequest,
  type EmployeePermissionStatus,
} from "../../services/employeePermissionRequests";
import { cleanText, type HrSession } from "./shared";
import "../../styles/EmployeePermissionRequests.css";

type Props = {
  session: HrSession;
};

type DirectoryEmployee = Record<string, any>;

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
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function employeeName(item: DirectoryEmployee) {
  return (
    cleanText(
      item.displayName ||
        item.name ||
        item.fullName ||
        item.employeeName ||
        item.title
    ) || "موظفة غير محددة"
  );
}

function employeeId(item: DirectoryEmployee) {
  return cleanText(
    item.employeeDocId ||
      item.linkedEmployeeDocId ||
      item.employeeId ||
      item.id ||
      item.employeeKey ||
      item.uid
  );
}

function employeeUid(item: DirectoryEmployee) {
  return cleanText(
    item.employeeUid ||
      item.linkedUid ||
      item.authUid ||
      item.uid ||
      item.userId ||
      item.linkedUserId ||
      employeeId(item)
  );
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

export default function AdminPermissionRequestsPage({ session }: Props) {
  const [roster, setRoster] = useState<DirectoryEmployee[]>([]);
  const [requests, setRequests] = useState<EmployeePermissionRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState<
    "all" | "pending" | "approved" | "out" | "returned"
  >("all");

  const nowTime = localTimeKey();
  const [form, setForm] = useState({
    employeeKey: "",
    date: localDateKey(),
    startTime: nowTime,
    expectedReturnTime: addMinutesToTime(nowTime, 60),
    reason: "",
    note: "",
    financialEffect: "none" as EmployeePermissionFinancialEffect,
  });

  const sortedRoster = useMemo(() => {
    const byId = new Map<string, DirectoryEmployee>();
    roster.forEach((item) => {
      const key = employeeId(item) || employeeUid(item);
      if (key && !byId.has(key)) byId.set(key, item);
    });
    return Array.from(byId.values()).sort((left, right) =>
      employeeName(left).localeCompare(employeeName(right), "ar")
    );
  }, [roster]);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const [employees, permissionRows] = await Promise.all([
        listEmployeeDirectory(),
        listEmployeePermissionRequests(300),
      ]);
      setRoster(Array.isArray(employees) ? employees : []);
      setRequests(Array.isArray(permissionRows) ? permissionRows : []);
    } catch (error) {
      setMessage(
        cleanText((error as any)?.message || "تعذر تحميل الاستئذانات.")
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (form.employeeKey || !sortedRoster[0]) return;
    setForm((current) => ({
      ...current,
      employeeKey: employeeId(sortedRoster[0]) || employeeUid(sortedRoster[0]),
    }));
  }, [form.employeeKey, sortedRoster]);

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

  const filteredRequests = useMemo(() => {
    if (filter === "all") return requests;
    return requests.filter((item) => item.status === filter);
  }, [filter, requests]);

  const actorName =
    cleanText(session.displayName || session.email) || "الإدارة";

  const submitDirect = async () => {
    if (saving) return;
    const selected = sortedRoster.find(
      (item) =>
        (employeeId(item) || employeeUid(item)) === cleanText(form.employeeKey)
    );
    if (!selected) {
      setMessage("اختر الموظفة أولًا.");
      return;
    }
    const start = timeToMinutes(form.startTime);
    const expected = timeToMinutes(form.expectedReturnTime);
    if (!form.date || start === null || expected === null) {
      setMessage("أدخل التاريخ ووقت الخروج والعودة.");
      return;
    }
    if (expected <= start) {
      setMessage("وقت العودة يجب أن يكون بعد وقت الخروج.");
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
        employeeUid: employeeUid(selected),
        employeeId: employeeId(selected),
        employeeName: employeeName(selected),
        date: form.date,
        startTime: form.startTime,
        expectedReturnTime: form.expectedReturnTime,
        reason: form.reason,
        note: form.note,
        financialEffect: form.financialEffect,
        source: "admin_direct",
        status: "out",
        createdByUid: session.uid,
        createdByName: actorName,
      });

      setForm((current) => ({
        ...current,
        startTime: localTimeKey(),
        expectedReturnTime: addMinutesToTime(localTimeKey(), 60),
        reason: "",
        note: "",
      }));
      setFormOpen(false);
      await load();
      setMessage("تم اعتماد استئذان الموظفة بالوقت المحدد.");
    } catch (error) {
      setMessage(
        cleanText((error as any)?.message || "تعذر تسجيل الاستئذان.")
      );
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (
    item: EmployeePermissionRequest,
    action: "approve" | "reject"
  ) => {
    if (workingId) return;
    setWorkingId(item.id);
    setMessage("");
    try {
      await reviewPermissionRequest({
        requestId: item.id,
        status: action === "approve" ? "approved" : "rejected",
        reviewerUid: session.uid,
        reviewerName: actorName,
      });
      await load();
      setMessage(
        action === "approve"
          ? "تمت الموافقة واعتماد وقت الخروج والعودة تلقائيًا."
          : "تم رفض طلب الاستئذان."
      );
    } catch (error) {
      setMessage(
        cleanText((error as any)?.message || "تعذر تحديث الاستئذان.")
      );
    } finally {
      setWorkingId("");
    }
  };

  return (
    <div className="permission-workspace permission-workspace--admin" dir="rtl">
      <section className="permission-hero">
        <div>
          <span>الحضور والاستئذان</span>
          <h1>إدارة الاستئذانات</h1>
          <p>
            راجع طلبات الموظفات أو سجّل استئذانًا مباشرًا؛ وقت الخروج والعودة
            المحدد في الطلب يُعتمد تلقائيًا.
          </p>
        </div>
        <button type="button" onClick={() => setFormOpen(true)}>
          <FontAwesomeIcon icon={faPlus} />
          تسجيل استئذان
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
            <span>المتابعة التشغيلية</span>
            <h2>سجل الاستئذانات</h2>
            <p>الموافقة تعتمد وقت الخروج والعودة المسجلين في الطلب مباشرة.</p>
          </div>
          <div className="permission-toolbar">
            <div className="permission-filters">
              {(
                [
                  ["all", "الكل", stats.total],
                  ["pending", "المعلقة", stats.pending],
                  ["approved", "المقبولة", stats.approved],
                  ["out", "خارج الآن", stats.out],
                  ["returned", "المعتمدة", stats.returned],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  className={filter === value ? "is-active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {label}
                  <em>{count}</em>
                </button>
              ))}
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
        </div>

        <div className="permission-list">
          {filteredRequests.map((item) => {
            const meta = statusMeta(item.status);
            const isWorking = workingId === item.id;
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
                      <strong>{item.employeeName || item.employeeId}</strong>
                      <span>
                        {item.date} • {item.reason || "استئذان"}
                      </span>
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
                    <span>
                      المصدر:{" "}
                      {item.source === "admin_direct"
                        ? "تسجيل مباشر من الإدارة"
                        : "طلب من الموظفة"}
                    </span>
                  </div>

                  {item.note ? (
                    <p>{item.note}</p>
                  ) : (
                    <p className="is-muted">بدون ملاحظة إضافية</p>
                  )}

                  <div className="permission-card__actions">
                    {item.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          className="is-approve"
                          onClick={() => void runAction(item, "approve")}
                          disabled={isWorking}
                        >
                          موافقة واعتماد الوقت
                        </button>
                        <button
                          type="button"
                          className="is-reject"
                          onClick={() => void runAction(item, "reject")}
                          disabled={isWorking}
                        >
                          رفض
                        </button>
                      </>
                    ) : null}


                    {isWorking ? <span>جاري الحفظ...</span> : null}
                  </div>
                </div>
              </article>
            );
          })}

          {!loading && !filteredRequests.length ? (
            <div className="permission-empty">
              <FontAwesomeIcon icon={faCircleExclamation} />
              <h3>لا توجد استئذانات في هذه الحالة</h3>
              <p>يمكن تسجيل استئذان مباشر أو انتظار طلب موظفة.</p>
            </div>
          ) : null}
        </div>
      </section>

      {formOpen ? (
        <div
          className="permission-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-permission-title"
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
                <small>تسجيل إداري مباشر</small>
                <h2 id="admin-permission-title">استئذان موظفة</h2>
                <p>يُعتمد وقت الخروج والعودة المحددان فورًا دون خطوات إضافية.</p>
              </div>
            </div>

            <div className="permission-form">
              <label className="is-wide">
                <span>الموظفة</span>
                <select
                  value={form.employeeKey}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      employeeKey: event.target.value,
                    }))
                  }
                >
                  {sortedRoster.map((item) => {
                    const key = employeeId(item) || employeeUid(item);
                    return (
                      <option key={key} value={key}>
                        {employeeName(item)}
                      </option>
                    );
                  })}
                </select>
              </label>
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
              <label>
                <span>الأثر المالي</span>
                <select
                  value={form.financialEffect}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      financialEffect: event.target.value as EmployeePermissionFinancialEffect,
                    }))
                  }
                >
                  <option value="none">بدون تأثير مالي</option>
                  <option value="paid">استئذان مدفوع</option>
                  <option value="unpaid">استئذان غير مدفوع</option>
                </select>
              </label>
              <label className="is-wide">
                <span>سبب الاستئذان</span>
                <input
                  type="text"
                  value={form.reason}
                  placeholder="سبب خروج الموظفة"
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
                  placeholder="ملاحظة الإدارة"
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
              onClick={() => void submitDirect()}
              disabled={saving || !sortedRoster.length}
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
              {saving ? "جاري الاعتماد..." : "اعتماد الاستئذان"}
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}
