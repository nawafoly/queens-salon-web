import { DashboardTimeInputV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRotateRight,
  faCircleCheck,
  faClock,
  faPlus,
  faRightFromBracket,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
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

type Props = {
  session: HrSession;
};

type DirectoryEmployee = Record<string, any>;

type PermissionFilter = "all" | "pending" | "approved" | "out" | "returned";

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
  const [filter, setFilter] = useState<PermissionFilter>("all");

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

  const employeeOptions = useMemo(
    () =>
      sortedRoster.map((item) => ({
        value: employeeId(item) || employeeUid(item),
        label: employeeName(item),
      })),
    [sortedRoster]
  );

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

  const filterItems = [
    ["all", "الكل", stats.total],
    ["pending", "المعلقة", stats.pending],
    ["approved", "المقبولة", stats.approved],
    ["out", "خارج الآن", stats.out],
    ["returned", "المعتمدة", stats.returned],
  ] as const;

  return (
    <main className="dashboard-v2 dsv2-page admin-permission-v2-page" dir="rtl">
      <section className="admin-permission-v2-hero">
        <div className="admin-permission-v2-hero__copy">
          <span className="dsv2-badge">الحضور والاستئذان</span>
          <h1>إدارة الاستئذانات</h1>
          <p>
            راجع طلبات الموظفات أو سجّل استئذانًا مباشرًا؛ وقت الخروج والعودة
            المحدد في الطلب يُعتمد تلقائيًا.
          </p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary"
          onClick={() => setFormOpen(true)}
        >
          <FontAwesomeIcon icon={faPlus} />
          تسجيل استئذان
        </button>
      </section>

      {message ? (
        <div className="admin-permission-v2-alert" role="status">
          {message}
        </div>
      ) : null}

      <section className="admin-permission-v2-stats" aria-label="ملخص الاستئذانات">
        <article className="dsv2-metric-card admin-permission-v2-stat is-warning">
          <div>
            <span>قيد المراجعة</span>
            <strong>{stats.pending}</strong>
          </div>
          <FontAwesomeIcon icon={faClock} />
        </article>
        <article className="dsv2-metric-card admin-permission-v2-stat is-success">
          <div>
            <span>تمت الموافقة</span>
            <strong>{stats.approved}</strong>
          </div>
          <FontAwesomeIcon icon={faCircleCheck} />
        </article>
        <article className="dsv2-metric-card admin-permission-v2-stat is-active">
          <div>
            <span>خارج بإذن</span>
            <strong>{stats.out}</strong>
          </div>
          <FontAwesomeIcon icon={faRightFromBracket} />
        </article>
        <article className="dsv2-metric-card admin-permission-v2-stat is-neutral">
          <div>
            <span>تم الاعتماد</span>
            <strong>{stats.returned}</strong>
          </div>
          <FontAwesomeIcon icon={faArrowRotateRight} />
        </article>
      </section>

      <section className="dsv2-card admin-permission-v2-panel">
        <header className="admin-permission-v2-panel__head">
          <div>
            <span className="dsv2-badge">المتابعة التشغيلية</span>
            <h2>سجل الاستئذانات</h2>
            <p>الموافقة تعتمد وقت الخروج والعودة المسجلين في الطلب مباشرة.</p>
          </div>
          <button
            type="button"
            className="dsv2-btn dsv2-btn--secondary admin-permission-v2-refresh"
            onClick={() => void load()}
            disabled={loading}
            aria-label="تحديث الاستئذانات"
          >
            <FontAwesomeIcon icon={faArrowRotateRight} spin={loading} />
            <span>تحديث</span>
          </button>
        </header>

        <div className="admin-permission-v2-filters" aria-label="تصفية الاستئذانات">
          {filterItems.map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "is-active" : ""}
              onClick={() => setFilter(value)}
            >
              <span>{label}</span>
              <em>{count}</em>
            </button>
          ))}
        </div>

        {loading && requests.length === 0 ? (
          <div className="admin-permission-v2-loading" aria-label="جاري تحميل الاستئذانات">
            <DashboardSkeletonV2 variant="card" />
            <DashboardSkeletonV2 variant="card" />
            <DashboardSkeletonV2 variant="card" />
          </div>
        ) : (
          <div className="admin-permission-v2-list">
            {filteredRequests.map((item) => {
              const meta = statusMeta(item.status);
              const isWorking = workingId === item.id;
              return (
                <article
                  key={item.id}
                  className={`dsv2-card admin-permission-v2-card is-${meta.tone}`}
                >
                  <div className="admin-permission-v2-card__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faRightFromBracket} />
                  </div>
                  <div className="admin-permission-v2-card__body">
                    <header className="admin-permission-v2-card__title">
                      <div>
                        <strong>{item.employeeName || item.employeeId}</strong>
                        <span>
                          {item.date} • {item.reason || "استئذان"}
                        </span>
                      </div>
                      <em className={`admin-permission-v2-status is-${meta.tone}`}>
                        {meta.label}
                      </em>
                    </header>

                    <div className="admin-permission-v2-card__times">
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

                    <p className={item.note ? "" : "is-muted"}>
                      {item.note || "بدون ملاحظة إضافية"}
                    </p>

                    <div className="admin-permission-v2-card__actions">
                      {item.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            className="dsv2-btn dsv2-btn--secondary is-approve"
                            onClick={() => void runAction(item, "approve")}
                            disabled={isWorking}
                          >
                            موافقة واعتماد الوقت
                          </button>
                          <button
                            type="button"
                            className="dsv2-btn dsv2-btn--secondary is-reject"
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
              <DashboardEmptyStateV2
                title="لا توجد استئذانات في هذه الحالة"
                description="يمكن تسجيل استئذان مباشر أو انتظار طلب موظفة."
                tone="neutral"
              />
            ) : null}
          </div>
        )}
      </section>

      <DashboardModalV2
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="استئذان موظفة"
        eyebrow="تسجيل إداري مباشر"
        description="يُعتمد وقت الخروج والعودة المحددان فورًا دون خطوات إضافية."
        size="md"
        tone="gold"
        className="admin-permission-v2-modal"
        footer={
          <div className="admin-permission-v2-modal__actions">
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              onClick={() => setFormOpen(false)}
              disabled={saving}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={() => void submitDirect()}
              disabled={saving || !sortedRoster.length}
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
              {saving ? "جاري الاعتماد..." : "اعتماد الاستئذان"}
            </button>
          </div>
        }
      >
        <div className="admin-permission-v2-form">
          <DashboardFieldV2
            id="admin-permission-employee"
            label="الموظفة"
            className="is-wide"
            required
          >
            <DashboardSelectV2
              id="admin-permission-employee"
              value={form.employeeKey}
              options={employeeOptions}
              placeholder="اختر الموظفة"
              disabled={!employeeOptions.length || saving}
              onChange={(value) =>
                setForm((current) => ({ ...current, employeeKey: value }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-permission-date" label="التاريخ" required>
            <DashboardDatePickerV2
              id="admin-permission-date"
              value={form.date}
              onChange={(value) =>
                setForm((current) => ({ ...current, date: value }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-permission-start-time" label="وقت الخروج" required>
            <DashboardTimeInputV2 id="admin-permission-start-time" className="dsv2-input" value={form.startTime} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value, })) } />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="admin-permission-return-time"
            label="العودة المتوقعة"
            required
          >
            <DashboardTimeInputV2 id="admin-permission-return-time" className="dsv2-input" value={form.expectedReturnTime} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, expectedReturnTime: event.target.value, })) } />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-permission-financial" label="الأثر المالي">
            <DashboardSelectV2
              id="admin-permission-financial"
              value={form.financialEffect}
              options={[
                { value: "none", label: "بدون تأثير مالي" },
                { value: "paid", label: "استئذان مدفوع" },
                { value: "unpaid", label: "استئذان غير مدفوع" },
              ]}
              disabled={saving}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  financialEffect: value as EmployeePermissionFinancialEffect,
                }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="admin-permission-reason"
            label="سبب الاستئذان"
            className="is-wide"
            required
          >
            <input
              id="admin-permission-reason"
              className="dsv2-input"
              type="text"
              value={form.reason}
              placeholder="سبب خروج الموظفة"
              disabled={saving}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2
            id="admin-permission-note"
            label="ملاحظة اختيارية"
            className="is-wide"
          >
            <textarea
              id="admin-permission-note"
              className="dsv2-textarea"
              value={form.note}
              placeholder="ملاحظة الإدارة"
              disabled={saving}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  note: event.target.value,
                }))
              }
            />
          </DashboardFieldV2>
        </div>
      </DashboardModalV2>
    </main>
  );
}
