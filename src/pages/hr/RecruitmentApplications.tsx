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
  createRecruitmentApplication,
  listRecruitmentApplications,
  updateRecruitmentApplication,
  type RecruitmentApplication,
} from "../../services/employeeHub";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
};

type ApplicationFilter = "all" | "new" | "reviewing" | "accepted" | "rejected" | "hired";

const STAFF_DRAFT_STORAGE_KEY = "queens.hr.createStaffDraft";

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
  return new Intl.DateTimeFormat("ar-SA", {
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

  return (
    <div className="hr-ops-page hr-recruitment-page" dir="rtl">
      <section className="hr-ops-hero">
        <div className="hr-ops-hero__icon"><FontAwesomeIcon icon={faUserTie} /></div>
        <div>
          <span>دورة التوظيف</span>
          <h2>طلبات التوظيف</h2>
          <p>استقبال الطلبات، مراجعتها، ثم تحويل المرشح المقبول إلى حساب موظف مترابط مع النظام.</p>
        </div>
        <div className="hr-ops-hero__actions">
          <button className="hr-ops-button hr-ops-button--ghost" type="button" onClick={() => void reload()} disabled={loading || saving}>
            <FontAwesomeIcon icon={faRotate} /><span>{loading ? "جارٍ التحديث" : "تحديث"}</span>
          </button>
          <button className="hr-ops-button hr-ops-button--primary" type="button" onClick={() => setCreateOpen(true)}>
            <FontAwesomeIcon icon={faPlus} /><span>طلب جديد</span>
          </button>
        </div>
      </section>

      <section className="hr-ops-stats" aria-label="إحصاءات التوظيف">
        <article><span>إجمالي الطلبات</span><strong>{stats.total}</strong><FontAwesomeIcon icon={faBriefcase} /></article>
        <article className={stats.new ? "is-warning" : ""}><span>طلبات جديدة</span><strong>{stats.new}</strong><FontAwesomeIcon icon={faUserClock} /></article>
        <article><span>قيد المراجعة</span><strong>{stats.reviewing}</strong><FontAwesomeIcon icon={faClock} /></article>
        <article className="is-success"><span>تم التوظيف</span><strong>{stats.hired}</strong><FontAwesomeIcon icon={faUserCheck} /></article>
      </section>

      {notice ? <div className="hr-ops-alert">{notice}</div> : null}

      <section className="hr-recruitment-shell">
        <aside className="hr-recruitment-list-panel">
          <div className="hr-recruitment-list-panel__head">
            <div><span>قائمة المرشحين</span><strong>{filteredItems.length} طلب</strong></div>
            <label className="hr-ops-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو البريد..." />
            </label>
          </div>

          <div className="hr-recruitment-filters">
            {([
              ["all", "الكل", stats.total],
              ["new", "جديد", stats.new],
              ["reviewing", "مراجعة", stats.reviewing],
              ["accepted", "مقبول", stats.accepted],
              ["hired", "موظف", stats.hired],
              ["rejected", "مرفوض", stats.rejected],
            ] as Array<[ApplicationFilter, string, number]>).map(([value, label, count]) => (
              <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>
                <span>{label}</span><em>{count}</em>
              </button>
            ))}
          </div>

          <div className="hr-recruitment-list">
            {filteredItems.map((item) => (
              <button key={item.id} type="button" className={selectedId === item.id ? "is-active" : ""} onClick={() => setSelectedId(item.id)}>
                <span className="hr-recruitment-avatar">{initials(item.fullName)}</span>
                <span className="hr-recruitment-list__copy">
                  <strong>{item.fullName || "مرشح بدون اسم"}</strong>
                  <small>{roleLabel(item.roleApplied)}</small>
                  <p>{item.email || item.phone || "لا توجد بيانات تواصل"}</p>
                </span>
                <span className={`hr-status-pill is-${cleanText(item.status || "new")}`}>{statusLabel(item.status)}</span>
              </button>
            ))}
            {!loading && !filteredItems.length ? (
              <div className="hr-ops-empty"><FontAwesomeIcon icon={faUserTie} /><strong>لا توجد طلبات مطابقة</strong><span>غيّر البحث أو أضف طلبًا جديدًا.</span></div>
            ) : null}
            {loading ? <div className="hr-ops-loading">جارٍ تحميل طلبات التوظيف...</div> : null}
          </div>
        </aside>

        <main className="hr-recruitment-detail">
          {selected ? (
            <>
              <header className="hr-recruitment-detail__head">
                <span className="hr-recruitment-avatar hr-recruitment-avatar--large">{initials(selected.fullName)}</span>
                <div>
                  <span>طلب توظيف</span>
                  <h3>{selected.fullName}</h3>
                  <p>{roleLabel(selected.roleApplied)} · {formatDate(selected.createdAt)}</p>
                </div>
                <span className={`hr-status-pill is-${cleanText(selected.status || "new")}`}>{statusLabel(selected.status)}</span>
              </header>

              <div className="hr-recruitment-contact-grid">
                <a href={`mailto:${selected.email}`}><FontAwesomeIcon icon={faEnvelope} /><span><small>البريد الإلكتروني</small><strong>{selected.email || "—"}</strong></span></a>
                <a href={selected.phone ? `tel:${selected.phone}` : undefined}><FontAwesomeIcon icon={faPhone} /><span><small>رقم الجوال</small><strong>{selected.phone || "—"}</strong></span></a>
                <div><FontAwesomeIcon icon={faBriefcase} /><span><small>الوظيفة</small><strong>{roleLabel(selected.roleApplied)}</strong></span></div>
              </div>

              <section className="hr-recruitment-copy">
                <div><span>رسالة المرشح</span><p>{selected.message || "لم يرفق المرشح رسالة إضافية."}</p></div>
                <div><span>ملاحظات الموارد البشرية</span><p>{selected.notes || "لا توجد ملاحظات مسجلة."}</p></div>
              </section>

              {selected.status === "hired" ? (
                <div className="hr-recruitment-hired">
                  <FontAwesomeIcon icon={faUserCheck} />
                  <div><strong>تم تحويل الطلب إلى موظف</strong><span>معرّف الموظف: {selected.hiredEmployeeId || selected.hiredUid || "محفوظ في حساب الموظف"}</span></div>
                </div>
              ) : null}

              <footer className="hr-recruitment-actions">
                <button type="button" className="hr-ops-button hr-ops-button--ghost" onClick={() => void handleStatus("reviewing")} disabled={saving || selected.status === "hired"}>
                  <FontAwesomeIcon icon={faClock} /><span>قيد المراجعة</span>
                </button>
                <button type="button" className="hr-ops-button hr-ops-button--soft-success" onClick={() => void handleStatus("accepted")} disabled={saving || selected.status === "hired"}>
                  <FontAwesomeIcon icon={faCheck} /><span>قبول مبدئي</span>
                </button>
                <button type="button" className="hr-ops-button hr-ops-button--danger" onClick={() => void handleStatus("rejected")} disabled={saving || selected.status === "hired"}>
                  <FontAwesomeIcon icon={faXmark} /><span>رفض الطلب</span>
                </button>
                <button type="button" className="hr-ops-button hr-ops-button--primary" onClick={openCreateAccount} disabled={saving || selected.status === "hired"}>
                  <FontAwesomeIcon icon={faUserPlus} /><span>تحويل إلى حساب موظف</span>
                </button>
              </footer>
            </>
          ) : (
            <div className="hr-ops-empty hr-ops-empty--large"><FontAwesomeIcon icon={faUserTie} /><strong>اختر طلب توظيف</strong><span>حدد مرشحًا من القائمة لعرض التفاصيل والإجراءات.</span></div>
          )}
        </main>
      </section>

      {createOpen ? (
        <div className="hr-ops-modal" role="dialog" aria-modal="true" aria-label="إضافة طلب توظيف">
          <button className="hr-ops-modal__backdrop" type="button" onClick={() => !saving && setCreateOpen(false)} aria-label="إغلاق" />
          <section className="hr-ops-modal__card">
            <header>
              <div><span>إضافة مرشح</span><h3>طلب توظيف جديد</h3><p>أدخل بيانات التواصل والوظيفة المطلوبة.</p></div>
              <button type="button" onClick={() => !saving && setCreateOpen(false)} aria-label="إغلاق"><FontAwesomeIcon icon={faXmark} /></button>
            </header>
            <div className="hr-ops-form-grid">
              <label className="hr-ops-field"><span>الاسم الكامل</span><input value={newApp.fullName} onChange={(event) => setNewApp((current) => ({ ...current, fullName: event.target.value }))} /></label>
              <label className="hr-ops-field"><span>البريد الإلكتروني</span><input type="email" value={newApp.email} onChange={(event) => setNewApp((current) => ({ ...current, email: event.target.value }))} /></label>
              <label className="hr-ops-field"><span>رقم الجوال</span><input value={newApp.phone} onChange={(event) => setNewApp((current) => ({ ...current, phone: event.target.value }))} /></label>
              <label className="hr-ops-field"><span>الوظيفة المتقدم لها</span><select value={newApp.roleApplied} onChange={(event) => setNewApp((current) => ({ ...current, roleApplied: event.target.value }))}><option value="staff">موظف</option><option value="reception">الاستقبال</option><option value="hr">الموارد البشرية</option><option value="admin">الإدارة</option></select></label>
              <label className="hr-ops-field hr-ops-field--wide"><span>رسالة المرشح</span><textarea rows={4} value={newApp.message} onChange={(event) => setNewApp((current) => ({ ...current, message: event.target.value }))} /></label>
              <label className="hr-ops-field hr-ops-field--wide"><span>ملاحظات داخلية</span><textarea rows={4} value={newApp.notes} onChange={(event) => setNewApp((current) => ({ ...current, notes: event.target.value }))} /></label>
            </div>
            <footer><button className="hr-ops-button hr-ops-button--ghost" type="button" onClick={() => setCreateOpen(false)} disabled={saving}>إلغاء</button><button className="hr-ops-button hr-ops-button--primary" type="button" onClick={() => void handleCreateApplication()} disabled={saving}><FontAwesomeIcon icon={faUserPlus} /><span>{saving ? "جارٍ الحفظ" : "حفظ الطلب"}</span></button></footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
