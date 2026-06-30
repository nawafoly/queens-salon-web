import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faChartLine,
  faEnvelope,
  faFileLines,
  faHouse,
  faMagnifyingGlass,
  faPlus,
  faRightFromBracket,
  faUserShield,
  faUsers,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import { useEmployeeSession, cleanText } from "./hr/shared";
import { resolveDashboardLandingPath } from "../helpers/routePaths";
import { logoutFirebase } from "../services/authService";
import RecruitmentApplicationsPage from "./hr/RecruitmentApplications";
import CreateStaffAccountPage from "./hr/CreateStaffAccount";
import SettingsUsersPage from "./settings/SettingsUsers";
import EmployeeMessagesPage from "./hr/EmployeeMessages";
import EmployeeFilesPage from "./hr/EmployeeFiles";
import DashboardEmployees from "./DashboardEmployees";
import { listEmployeeDirectory } from "../services/employeeDirectory";
import {
  listRecruitmentApplications,
  type RecruitmentApplication,
} from "../services/employeeHub";
import "../styles/AdminHr.css";

type DirectoryEmployee = Record<string, any> & { id?: string };
type StatusTone = "success" | "warning" | "neutral" | "muted";

type HrOverviewProps = {
  roster: DirectoryEmployee[];
  applications: RecruitmentApplication[];
  loading: boolean;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  session: ReturnType<typeof useEmployeeSession>;
};

function normalizeText(value: unknown) {
  return cleanText(value).toLowerCase().trim();
}

function readableRole(role: unknown) {
  const value = normalizeText(role);
  if (value === "owner") return "المالك";
  if (value === "admin") return "الإدارة";
  if (value === "hr") return "الموارد البشرية";
  if (value === "reception") return "الاستقبال";
  if (value === "staff") return "الموظفين";
  return cleanText(role) || "غير محدد";
}

function formatLongDate(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "غير محدد";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(parsed));
  } catch {
    return raw;
  }
}

function getFirstText(item: DirectoryEmployee, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = cleanText(item?.[key]);
    if (value) return value;
  }
  return fallback;
}

function getEmployeeName(item: DirectoryEmployee) {
  return getFirstText(item, ["displayName", "name", "fullName", "employeeName", "title"], "موظف غير محدد");
}

function getEmployeeEmail(item: DirectoryEmployee) {
  return getFirstText(item, ["email", "workEmail", "userEmail", "accountEmail"], "غير محدد");
}

function getDepartment(item: DirectoryEmployee) {
  return getFirstText(item, ["department", "section", "team", "group", "unit"], "غير محدد");
}

function getJobTitle(item: DirectoryEmployee) {
  return getFirstText(item, ["jobTitle", "title", "position", "roleTitle", "designation"], "غير محدد");
}

function getStartDate(item: DirectoryEmployee) {
  return formatLongDate(
    item?.startDate || item?.hireDate || item?.employmentStartDate || item?.joinedAt || item?.createdAt
  );
}

function getFingerprint(item: DirectoryEmployee) {
  return getFirstText(item, ["fingerprintNo", "fingerprint", "badgeNo", "badgeNumber", "employeeNo"], "غير محدد");
}

function getPhone(item: DirectoryEmployee) {
  return getFirstText(item, ["phone", "mobile", "mobileNumber", "phoneNumber"], "غير محدد");
}

function getStatusMeta(item: DirectoryEmployee) {
  const rawStatus = normalizeText(
    item?.status || item?.employmentStatus || item?.workStatus || item?.state || item?.employeeStatus
  );
  const onLeave = !!item?.onLeave || rawStatus.includes("leave") || rawStatus.includes("vacation");
  const trial =
    rawStatus.includes("trial") ||
    rawStatus.includes("probation") ||
    rawStatus.includes("trainee") ||
    normalizeText(item?.employmentType).includes("trial");
  const active =
    item?.active !== false &&
    !rawStatus.includes("inactive") &&
    !rawStatus.includes("terminated") &&
    !rawStatus.includes("resign") &&
    !rawStatus.includes("left");

  let label = "على رأس العمل";
  let tone: StatusTone = "success";

  if (!active) {
    label = "غير نشط";
    tone = "muted";
  }
  if (trial) {
    label = "فترة تجربة";
    tone = "neutral";
  }
  if (onLeave) {
    label = "على إجازة";
    tone = "warning";
  }

  return { active, trial, onLeave, label, tone };
}

function matchesSearch(item: DirectoryEmployee, search: string) {
  const haystack = [
    getEmployeeName(item),
    getEmployeeEmail(item),
    getDepartment(item),
    getJobTitle(item),
    normalizeText(item?.role),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.toLowerCase().trim());
}

function HrMetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="hr-metric-card">
      <span className="hr-metric-card__label">{label}</span>
      <strong className="hr-metric-card__value">{value}</strong>
      <p className="hr-metric-card__hint">{hint}</p>
    </article>
  );
}

function HrOverview({
  roster,
  applications,
  loading,
  onNavigate,
  onRefresh,
  session,
}: HrOverviewProps) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const rosterSorted = useMemo(() => {
    return [...roster].sort((a, b) => {
      const aStatus = getStatusMeta(a);
      const bStatus = getStatusMeta(b);
      if (aStatus.active !== bStatus.active) return Number(bStatus.active) - Number(aStatus.active);
      return getEmployeeName(a).localeCompare(getEmployeeName(b), "ar");
    });
  }, [roster]);

  const filteredRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rosterSorted;
    return rosterSorted.filter((item) => matchesSearch(item, q));
  }, [rosterSorted, search]);

  useEffect(() => {
    if (!selectedId && rosterSorted[0]?.id) {
      setSelectedId(cleanText(rosterSorted[0].id));
    }
  }, [rosterSorted, selectedId]);

  const selected = useMemo(() => {
    if (selectedId) {
      const exact = rosterSorted.find((item) => cleanText(item.id) === cleanText(selectedId));
      if (exact) return exact;
    }
    return rosterSorted[0] || null;
  }, [rosterSorted, selectedId]);

  const activeCount = useMemo(
    () => rosterSorted.filter((item) => getStatusMeta(item).active).length,
    [rosterSorted]
  );
  const leaveCount = useMemo(
    () => rosterSorted.filter((item) => getStatusMeta(item).onLeave).length,
    [rosterSorted]
  );
  const trialCount = useMemo(
    () => rosterSorted.filter((item) => getStatusMeta(item).trial).length,
    [rosterSorted]
  );
  const pendingApplications = useMemo(
    () =>
      applications.filter((application) => {
        const status = normalizeText(application?.status);
        return status === "new" || status === "reviewing" || status === "pending";
      }).length,
    [applications]
  );

  const selectedStatus = selected ? getStatusMeta(selected) : null;
  const selectedName = selected ? getEmployeeName(selected) : "اختر موظفًا";
  const selectedEmail = selected ? getEmployeeEmail(selected) : "غير محدد";
  const selectedDepartment = selected ? getDepartment(selected) : "غير محدد";
  const selectedTitle = selected ? getJobTitle(selected) : "غير محدد";
  const selectedPhone = selected ? getPhone(selected) : "غير محدد";
  const selectedFingerprint = selected ? getFingerprint(selected) : "غير محدد";
  const selectedStartDate = selected ? getStartDate(selected) : "غير محدد";

  return (
    <div className="hr-overview">
      <section className="hr-hero">
        <div className="hr-hero__copy">
          <span className="hr-hero__eyebrow">لوحة الموارد البشرية</span>
          <h2>إدارة الموظفين</h2>
          <p>
            صفحة مخصصة لإدارة البيانات الوظيفية للموظفين من جهة الإدارة والموارد البشرية، مع فصل
            واضح بين ما يشاهده الموظف في بروفايله وما يتم تعديله من داخل اللوحة.
          </p>

          <div className="hr-hero__actions">
            <button className="hr-button hr-button--primary" type="button" onClick={() => onNavigate("/admin/employees")}>
              <FontAwesomeIcon icon={faUsers} />
              إدارة الموظفين
            </button>
            <button className="hr-button hr-button--ghost" type="button" onClick={() => onNavigate("/admin/recruitment-applications")}>
              <FontAwesomeIcon icon={faUserTie} />
              طلبات التوظيف
            </button>
          </div>
        </div>

        <div className="hr-hero__aside">
          <span className="hr-chip">الحساب الحالي</span>
          <strong>{session.displayName || "HR User"}</strong>
          <span>{session.email || "غير محدد"}</span>
          <div className="hr-hero__badges">
            <span className="hr-badge hr-badge--soft">{readableRole(session.role)}</span>
            <span className="hr-badge hr-badge--outline">HR</span>
          </div>
        </div>
      </section>

      <section className="hr-metric-grid" aria-label="HR summary">
        <HrMetricCard
          label="الموظفون"
          value={String(rosterSorted.length)}
          hint="إجمالي السجلات الظاهرة ضمن صفحة إدارة الموظفين."
        />
        <HrMetricCard
          label="على رأس العمل"
          value={String(activeCount)}
          hint="موظفون بحالة وظيفية نشطة حاليًا."
        />
        <HrMetricCard
          label="متابعة الحالة"
          value={`إجازة: ${leaveCount} | تجربة: ${trialCount}`}
          hint="قراءة سريعة لحالات الموظفين التشغيلية."
        />
      </section>

      <section className="hr-workspace">
        <div className="hr-workspace__main">
          <article className="hr-card hr-card--intro">
            <div className="hr-card-head hr-card-head--stack">
              <div>
                <p className="hr-card-kicker">بيانات الموظف الوظيفية</p>
                <h3>{selected ? `${selectedName}` : "اختر موظفًا لعرض ملفه الوظيفي"}</h3>
                <p className="hr-card-subtitle">
                  هذا القسم مخصص للإدارة والموارد البشرية فقط. الموظف يرى هذه البيانات في بروفايله بشكل
                  للعرض فقط ولا يحررها بنفسه.
                </p>
              </div>

              <button
                className="hr-button hr-button--ghost"
                type="button"
                onClick={onRefresh}
                disabled={loading}
              >
                <FontAwesomeIcon icon={faArrowRight} />
                {loading ? "جارٍ التحديث..." : "تحديث البيانات"}
              </button>
            </div>

            <div className="hr-inline-tabs" aria-label="Employee sections">
              <span className="hr-inline-tab is-active">بيانات الموظف</span>
              <button className="hr-inline-tab" type="button" onClick={() => onNavigate("/admin/employees")}>
                الرواتب
              </button>
              <button className="hr-inline-tab" type="button" onClick={() => onNavigate("/admin/employees")}>
                الإجازات
              </button>
              <button className="hr-inline-tab" type="button" onClick={() => onNavigate("/admin/messages")}>
                الرسائل
              </button>
              <button className="hr-inline-tab" type="button" onClick={() => onNavigate("/admin/files")}>
                الملفات
              </button>
            </div>

            {selected ? (
              <>
                <div className="hr-selected-hero">
                  <div className="hr-selected-hero__nameBlock">
                    <p className="hr-selected-hero__eyebrow">ملخص الموظف</p>
                    <h4>{selectedName}</h4>
                    <p>{selectedTitle}</p>
                    <div className="hr-badge-row">
                      <span className="hr-badge hr-badge--soft">{selectedDepartment}</span>
                      <span className={`hr-badge hr-badge--${selectedStatus?.tone || "neutral"}`}>
                        {selectedStatus?.label || "غير محدد"}
                      </span>
                    </div>
                  </div>

                  <div className="hr-selected-hero__meta">
                    <div>
                      <span>البريد</span>
                      <strong>{selectedEmail}</strong>
                    </div>
                    <div>
                      <span>الجوال</span>
                      <strong>{selectedPhone}</strong>
                    </div>
                    <div>
                      <span>رقم البصمة</span>
                      <strong>{selectedFingerprint}</strong>
                    </div>
                    <div>
                      <span>بداية العمل</span>
                      <strong>{selectedStartDate}</strong>
                    </div>
                  </div>
                </div>

                <div className="hr-note-banner">
                  <strong>بيانات الموظف الوظيفية</strong>
                  <p>
                    يمكن للموارد البشرية تعديل بيانات الموظف من هنا بشكل مباشر، مع إبقاء السجل المرئي
                    داخل الملف الشخصي للموظف للعرض فقط.
                  </p>
                </div>

                <div className="hr-detail-grid">
                  <div className="hr-detail-card">
                    <span>اسم الموظف</span>
                    <strong>{selectedName}</strong>
                  </div>
                  <div className="hr-detail-card">
                    <span>القسم</span>
                    <strong>{selectedDepartment}</strong>
                  </div>
                  <div className="hr-detail-card">
                    <span>المسمى</span>
                    <strong>{selectedTitle}</strong>
                  </div>
                  <div className="hr-detail-card">
                    <span>بداية العمل</span>
                    <strong>{selectedStartDate}</strong>
                  </div>
                </div>

                <div className="hr-actions hr-actions--wrap">
                  <button className="hr-button hr-button--primary" type="button" onClick={() => onNavigate("/admin/employees")}>
                    <FontAwesomeIcon icon={faUsers} />
                    فتح ملف الموظفين
                  </button>
                  <button className="hr-button hr-button--ghost" type="button" onClick={() => onNavigate("/admin/create-staff")}>
                    <FontAwesomeIcon icon={faPlus} />
                    إنشاء حساب جديد
                  </button>
                  <button className="hr-button hr-button--ghost" type="button" onClick={() => onNavigate("/admin/messages")}>
                    <FontAwesomeIcon icon={faEnvelope} />
                    الرسائل الداخلية
                  </button>
                </div>
              </>
            ) : (
              <div className="hr-empty-state">
                <p>لا توجد بطاقة موظف محددة حتى الآن.</p>
                <small>اختر موظفًا من القائمة الجانبية لعرض ملفه الوظيفي.</small>
              </div>
            )}
          </article>

          <div className="hr-grid-2">
            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">إجراءات سريعة</p>
                  <h3>تصفّح لوحات الإدارة</h3>
                </div>
              </div>

              <div className="hr-quick-actions">
                <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/recruitment-applications")}>
                  <FontAwesomeIcon icon={faUserTie} />
                  <strong>طلبات التوظيف</strong>
                  <span>مراجعة المرشحين وتحويلهم إلى حسابات داخلية.</span>
                </button>
                <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/users")}>
                  <FontAwesomeIcon icon={faUserShield} />
                  <strong>إدارة الحسابات</strong>
                  <span>إنشاء الحسابات ومراجعة الصلاحيات والتعديل السريع.</span>
                </button>
                <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/messages")}>
                  <FontAwesomeIcon icon={faEnvelope} />
                  <strong>الرسائل</strong>
                  <span>مراسلات HR مع الموظفين والتنبيهات الداخلية.</span>
                </button>
                <button className="hr-action-card" type="button" onClick={() => onNavigate("/admin/files")}>
                  <FontAwesomeIcon icon={faFileLines} />
                  <strong>الملفات</strong>
                  <span>رفع ومتابعة ملفات الموظفين الداخلية.</span>
                </button>
              </div>
            </article>

            <article className="hr-card">
              <div className="hr-card-head">
                <div>
                  <p className="hr-card-kicker">طلبات التوظيف</p>
                  <h3>مؤشر سريع</h3>
                </div>
              </div>

              <div className="hr-mini-stats">
                <div>
                  <span>إجمالي الطلبات</span>
                  <strong>{applications.length}</strong>
                </div>
                <div>
                  <span>بانتظار المراجعة</span>
                  <strong>{pendingApplications}</strong>
                </div>
              </div>

              <div className="hr-copy-block">
                <p>
                  راجع الطلبات الجديدة ثم حوّل المناسب منها إلى حسابات موظفين مباشرة من داخل لوحة الموارد
                  البشرية.
                </p>
              </div>

              <div className="hr-actions">
                <button className="hr-button hr-button--primary" type="button" onClick={() => onNavigate("/admin/recruitment-applications")}>
                  <FontAwesomeIcon icon={faChartLine} />
                  فتح الطلبات
                </button>
              </div>
            </article>
          </div>
        </div>

        <aside className="hr-workspace__side">
          <article className="hr-card hr-card--sticky">
            <div className="hr-card-head hr-card-head--stack">
              <div>
                <p className="hr-card-kicker">قائمة الموظفين</p>
                <h3>اختر موظفًا لعرض بياناته أو إدارة ملفه من نفس الصفحة.</h3>
                <p className="hr-card-subtitle">اختر موظفًا لعرض ملفه الوظيفي وإدارة بياناته من نفس الصفحة.</p>
              </div>
            </div>

            <label className="hr-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ابحث بالاسم أو البريد أو القسم"
              />
            </label>

            <div className="hr-roster-list">
              {filteredRoster.map((item) => {
                const id = cleanText(item.id || item.uid || item.employeeId || getEmployeeEmail(item) || getEmployeeName(item));
                const status = getStatusMeta(item);
                const isSelected = cleanText(selectedId || selected?.id || "") === id;
                return (
                  <button
                    key={id || getEmployeeEmail(item)}
                    type="button"
                    className={`hr-roster-card ${isSelected ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(id)}
                  >
                    <div className="hr-roster-card__head">
                      <div>
                        <strong>{getEmployeeName(item)}</strong>
                        <span>{getEmployeeEmail(item)}</span>
                      </div>
                      <span className={`hr-badge hr-badge--${status.tone}`}>{status.label}</span>
                    </div>

                    <div className="hr-roster-card__meta">
                      <div>
                        <span>المسمى</span>
                        <strong>{getJobTitle(item)}</strong>
                      </div>
                      <div>
                        <span>القسم</span>
                        <strong>{getDepartment(item)}</strong>
                      </div>
                      <div>
                        <span>بداية العمل</span>
                        <strong>{getStartDate(item)}</strong>
                      </div>
                    </div>
                  </button>
                );
              })}

              {!filteredRoster.length ? (
                <div className="hr-empty-state hr-empty-state--side">
                  <p>لا توجد نتائج مطابقة لهذا البحث.</p>
                  <small>جرّب كلمة أخرى أو ألغِ التصفية الحالية.</small>
                </div>
              ) : null}
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

export default function AdminHrDashboard() {
  const session = useEmployeeSession();
  const navigate = useNavigate();
  const dashboardPath = resolveDashboardLandingPath(session.role);
  const dashboardLabel = session.role === "hr" ? "لوحة HR" : "لوحة التحكم";
  const [loggingOut, setLoggingOut] = useState(false);
  const [roster, setRoster] = useState<DirectoryEmployee[]>([]);
  const [applications, setApplications] = useState<RecruitmentApplication[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState("");
  const loadRequestRef = useRef(0);

  const loadData = async () => {
    const requestId = ++loadRequestRef.current;
    setLoadingData(true);
    setError("");
    try {
      const [rosterRows, applicationRows] = await Promise.all([
        listEmployeeDirectory(),
        listRecruitmentApplications(),
      ]);
      if (requestId !== loadRequestRef.current) return;
      setRoster(Array.isArray(rosterRows) ? rosterRows : []);
      setApplications(Array.isArray(applicationRows) ? applicationRows : []);
    } catch (e) {
      if (requestId !== loadRequestRef.current) return;
      setError(cleanText((e as any)?.message || "تعذر تحميل لوحة الموارد البشرية."));
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingData(false);
      }
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutFirebase();
    } finally {
      navigate("/login", { replace: true });
      setLoggingOut(false);
    }
  };

  if (session.loading) {
    return (
      <div className="hr-shell" dir="rtl">
        <aside className="hr-shell-sidebar hr-shell-sidebar--loading">
          <div className="hr-brand">
            <span className="hr-brand__mark">HR</span>
            <div>
              <strong>الموارد البشرية</strong>
              <small>جاري التحقق من الجلسة...</small>
            </div>
          </div>
        </aside>

        <main className="hr-shell-main">
          <div className="hr-shell-header">
            <div>
              <p className="hr-shell-kicker">Human Resources</p>
              <h1>جاري تحميل لوحة الموارد البشرية...</h1>
              <p className="hr-shell-subtitle">نجهز بيانات الموظفين والطلبات قبل عرض اللوحة.</p>
            </div>
          </div>

          <div className="hr-loading-panel">
            <div className="hr-loading-card" />
            <div className="hr-loading-card" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="hr-shell" dir="rtl">
      <aside className="hr-shell-sidebar">
        <div className="hr-brand">
          <span className="hr-brand__mark">HR</span>
          <div>
            <strong>الموارد البشرية</strong>
            <small>لوحة إدارة الموظفين</small>
          </div>
        </div>

        <div className="hr-shell-switcher" aria-label="تنقل سريع">
          <Link to="/" className="hr-shell-link hr-shell-link--soft">
            <FontAwesomeIcon icon={faHouse} />
            <span>الموقع الرئيسي</span>
          </Link>
          <Link to="/employee/overview" className="hr-shell-link hr-shell-link--soft">
            <FontAwesomeIcon icon={faUserTie} />
            <span>بوابة الموظف</span>
          </Link>
          <NavLink
            to={dashboardPath}
            className={({ isActive }) => `hr-shell-link hr-shell-link--accent ${isActive ? "is-active" : ""}`}
          >
            <FontAwesomeIcon icon={faChartLine} />
            <span>{dashboardLabel}</span>
          </NavLink>
          <button
            type="button"
            className="hr-shell-link hr-shell-link--danger"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>{loggingOut ? "جارِ الخروج..." : "تسجيل الخروج"}</span>
          </button>
        </div>

        <nav className="hr-shell-nav" aria-label="HR navigation">
          <NavLink to="/admin/overview" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faHouse} />
            <span>نظرة عامة</span>
          </NavLink>
          <NavLink to="/admin/employees" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faUsers} />
            <span>إدارة الموظفين</span>
          </NavLink>
          <NavLink to="/admin/recruitment-applications" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faUserTie} />
            <span>طلبات التوظيف</span>
          </NavLink>
          <NavLink to="/admin/messages" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faEnvelope} />
            <span>الرسائل الداخلية</span>
          </NavLink>
          <NavLink to="/admin/files" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faFileLines} />
            <span>الملفات الداخلية</span>
          </NavLink>
          <NavLink to="/admin/create-staff" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faUserShield} />
            <span>إنشاء حساب موظف</span>
          </NavLink>
          <NavLink to="/admin/users" className={({ isActive }) => `hr-shell-link ${isActive ? "is-active" : ""}`}>
            <FontAwesomeIcon icon={faUsers} />
            <span>إدارة الحسابات</span>
          </NavLink>
        </nav>

        <div className="hr-shell-note">
          <span>{session.displayName || "Signed in"}</span>
          <span>{session.email || ""}</span>
          <small>{readableRole(session.role)}</small>
        </div>
      </aside>

      <main className="hr-shell-main">
        <header className="hr-shell-header">
          <div>
            <p className="hr-shell-kicker">Human Resources</p>
            <h1>إدارة الموارد البشرية</h1>
            <p className="hr-shell-subtitle">
              مساحة موحدة لإدارة التوظيف والموظفين والملفات الإدارية مع فصل واضح بين العرض والتعديل.
            </p>
          </div>

          <div className="hr-shell-user">
            <strong>{session.displayName || "HR User"}</strong>
            <span>{readableRole(session.role)}</span>
            <button className="hr-refresh" type="button" onClick={() => void loadData()} disabled={loadingData}>
              {loadingData ? "جارٍ التحديث..." : "تحديث البيانات"}
            </button>
          </div>
        </header>

        {error ? <div className="hr-alert">{error}</div> : null}

        <section className="hr-stage">
          <Routes>
            <Route
              index
              element={<Navigate to="overview" replace />}
            />
            <Route
              path="overview"
              element={
                <HrOverview
                  roster={roster}
                  applications={applications}
                  loading={loadingData}
                  onNavigate={(path) => navigate(path)}
                  onRefresh={() => void loadData()}
                  session={session}
                />
              }
            />
            <Route path="recruitment-applications" element={<RecruitmentApplicationsPage session={session} />} />
            <Route path="employees" element={<DashboardEmployees />} />
            <Route path="messages" element={<EmployeeMessagesPage session={session} />} />
            <Route path="files" element={<EmployeeFilesPage session={session} />} />
            <Route
              path="users"
              element={
                <SettingsUsersPage
                  initialRole={session.role}
                  authReady={true}
                  allowAdminManageUsers={false}
                />
              }
            />
            <Route path="create-staff" element={<CreateStaffAccountPage session={session} />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </section>
      </main>
    </div>
  );
}
