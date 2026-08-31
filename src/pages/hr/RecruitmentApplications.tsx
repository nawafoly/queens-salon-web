import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBriefcase,
  faCheck,
  faClock,
  faEnvelope,
  faMagnifyingGlass,
  faPhone,
  faPlus,
  faRotate,
  faUserCheck,
  faUserClock,
  faUserPlus,
  faUserTie,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import {
  createRecruitmentApplication,
  listRecruitmentApplications,
  updateRecruitmentApplication,
  type RecruitmentApplication,
} from "../../services/employeeHub";
import { cleanText, type HrSession } from "./shared";
import { usePermissions } from "../../security/PermissionContext";

type Props = {
  session: HrSession;
};

type ApplicationFilter = "all" | "new" | "reviewing" | "accepted" | "rejected" | "hired";

const STAFF_DRAFT_STORAGE_KEY = "queens.hr.createStaffDraft";

const ROLE_OPTIONS = [
  { value: "staff", label: "موظف" },
  { value: "reception", label: "الاستقبال" },
  { value: "hr", label: "الموارد البشرية" },
  { value: "admin", label: "الإدارة" },
] as const;

function statusLabel(status?: RecruitmentApplication["status"] | string | null) {
  const value = cleanText(status).toLowerCase();
  if (value === "new") return "جديد";
  if (value === "reviewing") return "قيد المراجعة";
  if (value === "interview") return "مقابلة";
  if (value === "accepted") return "مقبول";
  if (value === "rejected") return "مرفوض";
  if (value === "hired") return "تم التوظيف";
  return cleanText(status) || "غير محدد";
}

function statusTone(status?: RecruitmentApplication["status"] | string | null) {
  const value = cleanText(status || "new").toLowerCase();
  if (value === "accepted" || value === "hired") return "success";
  if (value === "rejected") return "danger";
  if (value === "new") return "warning";
  if (value === "reviewing" || value === "interview") return "active";
  return "neutral";
}

function roleLabel(role?: string | null) {
  const value = cleanText(role).toLowerCase();
  if (value === "hr") return "الموارد البشرية";
  if (value === "admin") return "الإدارة";
  if (value === "reception") return "الاستقبال";
  return "موظف";
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

function initials(value: unknown) {
  const parts = cleanText(value).split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || "؟"}${parts[1]?.[0] || ""}`;
}

export default function RecruitmentApplicationsPage({ session }: Props) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission("recruitment.manage");
  const [items, setItems] = useState<RecruitmentApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ApplicationFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [newApp, setNewApp] = useState({
    fullName: "",
    email: "",
    phone: "",
    roleApplied: "staff",
    notes: "",
    message: "",
  });

  const reload = async (preserveSelection = true) => {
    setLoading(true);
    setNotice("");
    try {
      const rows = await listRecruitmentApplications(240);
      setItems(rows);
      setSelectedId((current) => {
        if (preserveSelection && current && rows.some((item) => item.id === current)) return current;
        return rows[0]?.id || "";
      });
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر تحميل طلبات التوظيف."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId]
  );

  const stats = useMemo(() => ({
    total: items.length,
    new: items.filter((item) => cleanText(item.status || "new") === "new").length,
    reviewing: items.filter((item) => ["reviewing", "interview"].includes(cleanText(item.status))).length,
    accepted: items.filter((item) => cleanText(item.status) === "accepted").length,
    hired: items.filter((item) => cleanText(item.status) === "hired").length,
    rejected: items.filter((item) => cleanText(item.status) === "rejected").length,
  }), [items]);

  const filteredItems = useMemo(() => {
    const q = cleanText(search).toLowerCase();
    return items.filter((item) => {
      const status = cleanText(item.status || "new").toLowerCase();
      if (filter === "reviewing" && !["reviewing", "interview"].includes(status)) return false;
      if (filter !== "all" && filter !== "reviewing" && status !== filter) return false;
      if (!q) return true;
      return [item.fullName, item.email, item.phone, roleLabel(item.roleApplied), item.notes, item.message]
        .map((value) => cleanText(value).toLowerCase())
        .some((value) => value.includes(q));
    });
  }, [filter, items, search]);

  useEffect(() => {
    if (selectedId && filteredItems.some((item) => item.id === selectedId)) return;
    setSelectedId(filteredItems[0]?.id || "");
  }, [filteredItems, selectedId]);

  const handleCreateApplication = async () => {
    const fullName = cleanText(newApp.fullName);
    const email = cleanText(newApp.email).toLowerCase();
    if (!fullName || !email || !email.includes("@")) {
      setNotice("الاسم والبريد الإلكتروني الصحيح مطلوبان.");
      return;
    }

    setSaving(true);
    setNotice("");
    try {
      const created = await createRecruitmentApplication({
        fullName,
        email,
        phone: newApp.phone,
        roleApplied: newApp.roleApplied,
        notes: newApp.notes,
        message: newApp.message,
        status: "new",
        source: "manual",
      });
      setNewApp({ fullName: "", email: "", phone: "", roleApplied: "staff", notes: "", message: "" });
      setCreateOpen(false);
      await reload(false);
      setSelectedId(created.id);
      setNotice("تم حفظ طلب التوظيف بنجاح.");
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر حفظ الطلب."));
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (status: RecruitmentApplication["status"]) => {
    if (!selected) return;
    setSaving(true);
    setNotice("");
    try {
      await updateRecruitmentApplication(selected.id, {
        status,
        reviewedByUid: session.uid,
        reviewedAt: new Date().toISOString(),
      });
      await reload();
      setNotice(`تم تحديث حالة الطلب إلى «${statusLabel(status)}».`);
    } catch (error) {
      setNotice(cleanText((error as any)?.message || "تعذر تحديث حالة الطلب."));
    } finally {
      setSaving(false);
    }
  };

  const openCreateAccount = () => {
    if (!selected) return;
    const role = ["hr", "admin", "reception"].includes(cleanText(selected.roleApplied).toLowerCase())
      ? cleanText(selected.roleApplied).toLowerCase()
      : "staff";
    const draft = {
      applicationId: selected.id,
      displayName: selected.fullName,
      email: selected.email,
      phone: selected.phone || "",
      role,
      bio: selected.notes || selected.message || "",
      source: "recruitment",
    };
    try {
      window.sessionStorage.setItem(STAFF_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Navigation still works; the query id is retained as a fallback.
    }
    navigate(`/dashboard/create-staff?applicationId=${encodeURIComponent(selected.id)}`);
  };

  const filterItems = [
    ["all", "الكل", stats.total],
    ["new", "جديد", stats.new],
    ["reviewing", "مراجعة", stats.reviewing],
    ["accepted", "مقبول", stats.accepted],
    ["hired", "موظف", stats.hired],
    ["rejected", "مرفوض", stats.rejected],
  ] as const;

  const closeCreate = () => {
    if (!saving) setCreateOpen(false);
  };

  return (
    <main className="dashboard-v2 dsv2-page recruitment-applications-v2-page" dir="rtl">
      <section className="recruitment-v2-hero">
        <div className="recruitment-v2-hero__copy">
          <span className="dsv2-badge">دورة التوظيف</span>
          <h1>طلبات التوظيف</h1>
          <p>استقبال الطلبات، مراجعتها، ثم تحويل المرشح المقبول إلى حساب موظف مترابط مع النظام.</p>
        </div>
        <div className="recruitment-v2-hero__actions">
          <button
            className="dsv2-btn dsv2-btn--secondary"
            type="button"
            onClick={() => void reload()}
            disabled={loading || saving}
          >
            <FontAwesomeIcon icon={faRotate} spin={loading} />
            <span>{loading ? "جارٍ التحديث" : "تحديث"}</span>
          </button>
          {canManage ? (
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => setCreateOpen(true)}>
              <FontAwesomeIcon icon={faPlus} />
              <span>طلب جديد</span>
            </button>
          ) : null}
        </div>
      </section>

      <section className="recruitment-v2-stats" aria-label="إحصاءات التوظيف">
        <article className="dsv2-metric-card recruitment-v2-stat">
          <span>إجمالي الطلبات</span>
          <strong>{stats.total}</strong>
          <FontAwesomeIcon icon={faBriefcase} />
        </article>
        <article className={`dsv2-metric-card recruitment-v2-stat${stats.new ? " is-warning" : ""}`}>
          <span>طلبات جديدة</span>
          <strong>{stats.new}</strong>
          <FontAwesomeIcon icon={faUserClock} />
        </article>
        <article className="dsv2-metric-card recruitment-v2-stat is-active">
          <span>قيد المراجعة</span>
          <strong>{stats.reviewing}</strong>
          <FontAwesomeIcon icon={faClock} />
        </article>
        <article className="dsv2-metric-card recruitment-v2-stat is-success">
          <span>تم التوظيف</span>
          <strong>{stats.hired}</strong>
          <FontAwesomeIcon icon={faUserCheck} />
        </article>
      </section>

      {notice ? <div className="recruitment-v2-alert" role="status">{notice}</div> : null}

      <section className="recruitment-v2-workspace">
        <aside className="dsv2-card recruitment-v2-list-panel">
          <header className="recruitment-v2-list-panel__head">
            <div className="recruitment-v2-section-title">
              <span>قائمة المرشحين</span>
              <strong>{filteredItems.length} طلب</strong>
            </div>
            <DashboardFieldV2 id="recruitment-search" label="البحث" className="recruitment-v2-search-field">
              <div className="recruitment-v2-search-control">
                <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                <input
                  id="recruitment-search"
                  className="dsv2-input"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ابحث بالاسم أو البريد..."
                />
              </div>
            </DashboardFieldV2>
          </header>

          <div className="recruitment-v2-filters" aria-label="تصفية طلبات التوظيف">
            {filterItems.map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "is-active" : ""}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
              >
                <span>{label}</span>
                <em>{count}</em>
              </button>
            ))}
          </div>

          <div className="recruitment-v2-list">
            {loading && items.length === 0 ? (
              <div className="recruitment-v2-loading" role="status" aria-label="جارٍ تحميل طلبات التوظيف">
                <DashboardSkeletonV2 variant="block" height={86} />
                <DashboardSkeletonV2 variant="block" height={86} />
                <DashboardSkeletonV2 variant="block" height={86} />
              </div>
            ) : (
              filteredItems.map((item) => {
                const tone = statusTone(item.status);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`recruitment-v2-candidate${selectedId === item.id ? " is-active" : ""}`}
                    onClick={() => setSelectedId(item.id)}
                    aria-pressed={selectedId === item.id}
                  >
                    <span className="recruitment-v2-avatar" aria-hidden="true">{initials(item.fullName)}</span>
                    <span className="recruitment-v2-candidate__copy">
                      <strong>{item.fullName || "مرشح بدون اسم"}</strong>
                      <small>{roleLabel(item.roleApplied)}</small>
                      <span>{item.email || item.phone || "لا توجد بيانات تواصل"}</span>
                    </span>
                    <span className={`recruitment-v2-status is-${tone}`}>{statusLabel(item.status)}</span>
                  </button>
                );
              })
            )}

            {!loading && !filteredItems.length ? (
              <DashboardEmptyStateV2
                title="لا توجد طلبات مطابقة"
                description="غيّر البحث أو أضف طلبًا جديدًا."
                icon={<FontAwesomeIcon icon={faUserTie} />}
                tone="gold"
                compact
              />
            ) : null}
          </div>
        </aside>

        <section className="dsv2-card recruitment-v2-detail" aria-label="تفاصيل طلب التوظيف">
          {selected ? (
            <>
              <header className="recruitment-v2-detail__head">
                <span className="recruitment-v2-avatar recruitment-v2-avatar--large" aria-hidden="true">
                  {initials(selected.fullName)}
                </span>
                <div className="recruitment-v2-detail__identity">
                  <span>طلب توظيف</span>
                  <h2>{selected.fullName}</h2>
                  <p>{roleLabel(selected.roleApplied)} · {formatDate(selected.createdAt)}</p>
                </div>
                <span className={`recruitment-v2-status is-${statusTone(selected.status)}`}>
                  {statusLabel(selected.status)}
                </span>
              </header>

              <div className="recruitment-v2-contact-grid">
                <a href={`mailto:${selected.email}`}>
                  <FontAwesomeIcon icon={faEnvelope} />
                  <span><small>البريد الإلكتروني</small><strong>{selected.email || "—"}</strong></span>
                </a>
                <a href={selected.phone ? `tel:${selected.phone}` : undefined}>
                  <FontAwesomeIcon icon={faPhone} />
                  <span><small>رقم الجوال</small><strong>{selected.phone || "—"}</strong></span>
                </a>
                <div>
                  <FontAwesomeIcon icon={faBriefcase} />
                  <span><small>الوظيفة</small><strong>{roleLabel(selected.roleApplied)}</strong></span>
                </div>
              </div>

              <section className="recruitment-v2-copy-grid">
                <article>
                  <span>رسالة المرشح</span>
                  <p>{selected.message || "لم يرفق المرشح رسالة إضافية."}</p>
                </article>
                <article>
                  <span>ملاحظات الموارد البشرية</span>
                  <p>{selected.notes || "لا توجد ملاحظات مسجلة."}</p>
                </article>
              </section>

              {selected.status === "hired" ? (
                <div className="recruitment-v2-hired-state">
                  <FontAwesomeIcon icon={faUserCheck} />
                  <div>
                    <strong>تم تحويل الطلب إلى موظف</strong>
                    <span>معرّف الموظف: {selected.hiredEmployeeId || selected.hiredUid || "محفوظ في حساب الموظف"}</span>
                  </div>
                </div>
              ) : null}

              {canManage ? (
                <footer className="recruitment-v2-actions">
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary"
                  onClick={() => void handleStatus("reviewing")}
                  disabled={saving || selected.status === "hired"}
                >
                  <FontAwesomeIcon icon={faClock} />
                  <span>قيد المراجعة</span>
                </button>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--success"
                  onClick={() => void handleStatus("accepted")}
                  disabled={saving || selected.status === "hired"}
                >
                  <FontAwesomeIcon icon={faCheck} />
                  <span>قبول مبدئي</span>
                </button>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger"
                  onClick={() => void handleStatus("rejected")}
                  disabled={saving || selected.status === "hired"}
                >
                  <FontAwesomeIcon icon={faXmark} />
                  <span>رفض الطلب</span>
                </button>
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--primary"
                  onClick={openCreateAccount}
                  disabled={saving || selected.status === "hired"}
                >
                  <FontAwesomeIcon icon={faUserPlus} />
                  <span>تحويل إلى حساب موظف</span>
                </button>
                </footer>
              ) : null}
            </>
          ) : (
            <DashboardEmptyStateV2
              title="اختر طلب توظيف"
              description="حدد مرشحًا من القائمة لعرض التفاصيل والإجراءات."
              icon={<FontAwesomeIcon icon={faUserTie} />}
              tone="gold"
            />
          )}
        </section>
      </section>

      <DashboardModalV2
        open={canManage && createOpen}
        onClose={closeCreate}
        title="طلب توظيف جديد"
        description="أدخل بيانات التواصل والوظيفة المطلوبة."
        eyebrow="إضافة مرشح"
        size="lg"
        tone="gold"
        closeOnBackdrop={!saving}
        closeOnEscape={!saving}
        className="recruitment-v2-create-modal"
        footer={
          <>
            <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={closeCreate} disabled={saving}>
              إلغاء
            </button>
            <button
              className="dsv2-btn dsv2-btn--primary"
              type="button"
              onClick={() => void handleCreateApplication()}
              disabled={saving}
            >
              <FontAwesomeIcon icon={faUserPlus} />
              <span>{saving ? "جارٍ الحفظ" : "حفظ الطلب"}</span>
            </button>
          </>
        }
      >
        <div className="recruitment-v2-form-grid">
          <DashboardFieldV2 id="recruitment-full-name" label="الاسم الكامل" required>
            <input
              id="recruitment-full-name"
              className="dsv2-input"
              value={newApp.fullName}
              onChange={(event) => setNewApp((current) => ({ ...current, fullName: event.target.value }))}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="recruitment-email" label="البريد الإلكتروني" required>
            <input
              id="recruitment-email"
              className="dsv2-input"
              type="email"
              value={newApp.email}
              onChange={(event) => setNewApp((current) => ({ ...current, email: event.target.value }))}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="recruitment-phone" label="رقم الجوال">
            <input
              id="recruitment-phone"
              className="dsv2-input"
              value={newApp.phone}
              onChange={(event) => setNewApp((current) => ({ ...current, phone: event.target.value }))}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="recruitment-role" label="الوظيفة المتقدم لها">
            <DashboardSelectV2
              id="recruitment-role"
              value={newApp.roleApplied}
              options={ROLE_OPTIONS}
              onChange={(value) => setNewApp((current) => ({ ...current, roleApplied: value }))}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="recruitment-message" label="رسالة المرشح" className="recruitment-v2-field--wide">
            <textarea
              id="recruitment-message"
              className="dsv2-textarea"
              rows={4}
              value={newApp.message}
              onChange={(event) => setNewApp((current) => ({ ...current, message: event.target.value }))}
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="recruitment-notes" label="ملاحظات داخلية" className="recruitment-v2-field--wide">
            <textarea
              id="recruitment-notes"
              className="dsv2-textarea"
              rows={4}
              value={newApp.notes}
              onChange={(event) => setNewApp((current) => ({ ...current, notes: event.target.value }))}
            />
          </DashboardFieldV2>
        </div>
      </DashboardModalV2>
    </main>
  );
}
