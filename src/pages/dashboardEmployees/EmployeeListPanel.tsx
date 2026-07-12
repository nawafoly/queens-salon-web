import type { CSSProperties, WheelEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faMagnifyingGlass,
  faPlus,
  faXmark,
  faUsers,
  faUserCheck,
  faUserClock,
  faScissors,
} from "@fortawesome/free-solid-svg-icons";
import {
  getNameInitials,
  normalizeLeaveUntil,
  normalizeSpecialties,
  toArabicSectionLabel,
  todayIso,
  type ServiceOption,
  type StaffBookingStats,
  type StaffPublicUi,
} from "./shared";

type EmployeeListPanelProps = {
  qText: string;
  onlyActive: "all" | "active" | "inactive";
  specialtyFilter: string;
  serviceOptions: ServiceOption[];
  sectionOptions: Array<{ id: string; label: string }>;
  filtered: StaffPublicUi[];
  loading: boolean;
  statsLoading: boolean;
  bookingStats: Record<string, StaffBookingStats>;
  selectedEmployeeId: string | null;
  canManage: boolean;
  onQTextChange: (value: string) => void;
  onOnlyActiveChange: (value: "all" | "active" | "inactive") => void;
  onSpecialtyFilterChange: (value: string) => void;
  onCreateEmployee: () => void;
  onOpenEmployee: (staff: StaffPublicUi) => void;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function findEmployeePageScrollTarget(source: HTMLElement): Element {
  let current = source.parentElement;

  while (current && current !== document.body && current !== document.documentElement) {
    if (
      current.classList.contains("emp-staff-list") ||
      current.classList.contains("emp-list-card") ||
      current.classList.contains("emp-directory-v2") ||
      current.classList.contains("emp-directory-shell")
    ) {
      current = current.parentElement;
      continue;
    }

    const style = window.getComputedStyle(current);
    const canScrollY =
      /(auto|scroll|overlay)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight + 1;

    if (canScrollY) return current;
    current = current.parentElement;
  }

  return document.scrollingElement || document.documentElement;
}

function handleEmployeeWheel(event: WheelEvent<HTMLElement>) {
  if (event.ctrlKey) return;

  const multiplier =
    event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  const top = event.deltaY * multiplier;
  const left = event.deltaX * multiplier;

  if (Math.abs(top) < 0.01 && Math.abs(left) < 0.01) return;

  event.preventDefault();
  event.stopPropagation();
  findEmployeePageScrollTarget(event.currentTarget).scrollBy({
    top,
    left,
    behavior: "auto",
  });
}

export default function EmployeeListPanel({
  qText,
  onlyActive,
  specialtyFilter,
  serviceOptions,
  sectionOptions,
  filtered,
  loading,
  statsLoading,
  bookingStats,
  selectedEmployeeId,
  canManage,
  onQTextChange,
  onOnlyActiveChange,
  onSpecialtyFilterChange,
  onCreateEmployee,
  onOpenEmployee,
}: EmployeeListPanelProps) {
  const hasActiveFilters =
    qText.trim().length > 0 || onlyActive !== "all" || specialtyFilter !== "all";

  const activeCount = filtered.filter((staff) => staff.active).length;
  const inactiveCount = filtered.length - activeCount;
  const assignedCount = filtered.filter((staff) => normalizeSpecialties(staff.specialties).length > 0).length;

  const clearFilters = () => {
    onQTextChange("");
    onOnlyActiveChange("all");
    onSpecialtyFilterChange("all");
  };

  return (
    <>
      <div className="dash-card emp-list-filter-card">
        <div className="emp-filter-header">
          <div>
            <span className="emp-filter-kicker">تصفية سريعة</span>
            <h3>ابحثي عن الموظفة مباشرة</h3>
            <p>فلترة خفيفة بالاسم أو الحالة أو الخدمة بدون مغادرة القائمة.</p>
          </div>
          <span className="emp-filter-count">{filtered.length}</span>
        </div>

        <div className="dash-row emp-list-filter-grid">
          <div className="dash-field emp-list-search-field">
            <label className="emp-label">بحث</label>
            <div className="emp-search-control">
              <FontAwesomeIcon className="emp-search-icon" icon={faMagnifyingGlass} />
              <input
                className="dash-input"
                value={qText}
                onChange={(e) => onQTextChange(e.target.value)}
                placeholder="الاسم، الجوال، البريد أو الرقم الوظيفي"
                aria-label="بحث في الموظفات"
              />
              {qText ? (
                <button
                  className="emp-search-clear"
                  type="button"
                  onClick={() => onQTextChange("")}
                  aria-label="مسح البحث"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="dash-field">
            <label className="emp-label">الحالة</label>
            <select
              className="dash-select"
              value={onlyActive}
              onChange={(e) => onOnlyActiveChange(e.target.value as "all" | "active" | "inactive")}
            >
              <option value="all">الكل</option>
              <option value="active">نشطة فقط</option>
              <option value="inactive">غير نشطة فقط</option>
            </select>
          </div>
          <div className="dash-field">
            <label className="emp-label">تصفية بالخدمة</label>
            <select
              className="dash-select"
              value={specialtyFilter}
              onChange={(e) => onSpecialtyFilterChange(e.target.value)}
            >
              <option value="all">كل الموظفات</option>
              <option value="none">بدون خدمات مسندة</option>
              {Array.from(new Set(serviceOptions.map((x) => cleanText(x.id)).filter(Boolean))).map(
                (serviceId) => (
                  <option key={serviceId} value={serviceId}>
                    {serviceOptions.find((x) => cleanText(x.id) === serviceId)?.label || serviceId}
                  </option>
                )
              )}
            </select>
          </div>
          <div className="dash-actions emp-list-filter-actions">
            {canManage ? (
              <button className="exp-btn primary" type="button" onClick={onCreateEmployee}>
                <FontAwesomeIcon icon={faPlus} />
                إضافة موظفة
              </button>
            ) : (
              <span className="emp-meta-chip">عرض فقط</span>
            )}
          </div>
        </div>
        {hasActiveFilters ? (
          <button className="emp-clear-filters" type="button" onClick={clearFilters}>
            مسح التصفية
          </button>
        ) : null}
      </div>

      <div className="dash-card mt-3 emp-list-card emp-directory-v2">
        <div className="emp-directory-hero">
          <div className="emp-directory-heading">
            <span className="emp-list-kicker">فريق العمل</span>
            <h2>دليل الموظفات</h2>
            <p>نظرة موحدة على حالة الفريق، الخدمات المسندة، وأداء الحجوزات الشهري.</p>
          </div>

          <div className="emp-directory-summary" aria-label="ملخص الموظفات">
            <div className="emp-directory-stat">
              <span className="emp-directory-stat-icon"><FontAwesomeIcon icon={faUsers} /></span>
              <div><b>{filtered.length}</b><small>إجمالي الملفات</small></div>
            </div>
            <div className="emp-directory-stat">
              <span className="emp-directory-stat-icon"><FontAwesomeIcon icon={faUserCheck} /></span>
              <div><b>{activeCount}</b><small>موظفات نشطات</small></div>
            </div>
            <div className="emp-directory-stat">
              <span className="emp-directory-stat-icon"><FontAwesomeIcon icon={faScissors} /></span>
              <div><b>{assignedCount}</b><small>لديهن خدمات</small></div>
            </div>
            <div className="emp-directory-stat">
              <span className="emp-directory-stat-icon"><FontAwesomeIcon icon={faUserClock} /></span>
              <div><b>{inactiveCount}</b><small>غير نشطات</small></div>
            </div>
          </div>
        </div>
        {loading ? (
          <div className="emp-list-state">
            <span className="emp-list-loader" aria-hidden="true" />
            <b>جاري تحميل ملفات الموظفات...</b>
          </div>
        ) : filtered.length ? (
          <div className="emp-staff-list" onWheel={handleEmployeeWheel}>
            {filtered.map((staff) => {
              const specialtyIds = normalizeSpecialties(staff.specialties);
              const mainService = serviceOptions.find((option) => option.id === specialtyIds[0]);
              const sectionId = cleanText(mainService?.sectionId);
              const storedDepartment = cleanText(staff.department || staff.title);
              const department = storedDepartment
                ? storedDepartment
                : sectionId
                  ? toArabicSectionLabel(
                      sectionId,
                      sectionOptions.find((section) => section.id === sectionId)?.label || ""
                    )
                  : "قسم غير محدد";
              const leaveUntil = normalizeLeaveUntil((staff as any).leaveUntil);
              const leaveExpired = !!leaveUntil && leaveUntil < todayIso();
              const onLeave = !!(staff as any).onLeave && !leaveExpired;
              const statusLabel = onLeave ? "في إجازة" : staff.active ? "نشطة" : "غير نشطة";
              const statusClass = onLeave ? "warn" : staff.active ? "on" : "off";
              const total = bookingStats[staff.id]?.total ?? 0;
              const confirmed = bookingStats[staff.id]?.byStatus.confirmed ?? 0;
              const kpi = total > 0 ? Math.round((confirmed / total) * 100) : 0;
              const kpiLabel = statsLoading ? "..." : `${kpi}%`;
              const isSelected = selectedEmployeeId === staff.id;
              const hasServices = specialtyIds.length > 0;
              const needsCompletion = staff.profileIncomplete || staff.source !== "staff_public";

              return (
                <button
                  key={`${staff.source || "staff"}:${staff.id}`}
                  type="button"
                  className={`emp-staff-row ${isSelected ? "is-selected" : ""} ${
                    hasServices ? "" : "has-no-services"
                  }`}
                  onClick={() => onOpenEmployee(staff)}
                  onWheel={handleEmployeeWheel}
                >
                  <div className="emp-staff-avatar">
                    {staff.avatarUrl ? (
                      <img src={staff.avatarUrl} alt={cleanText(staff.name) || "صورة الموظفة"} />
                    ) : (
                      getNameInitials(cleanText(staff.name))
                    )}
                  </div>

                  <div className="emp-staff-main">
                    <div className="emp-staff-headline">
                      <b>{cleanText(staff.name) || "موظفة بدون اسم"}</b>
                      <span className={`staff-pill ${statusClass}`}>{statusLabel}</span>
                    </div>
                    <div className="emp-staff-dept">{department}</div>
                    <div className="emp-staff-meta-row">
                      <span className={`emp-staff-service-chip ${hasServices ? "is-ready" : "is-empty"}`}>
                        {hasServices ? `${specialtyIds.length} خدمة` : "بدون خدمات"}
                      </span>
                      {needsCompletion ? (
                        <span className="emp-staff-source-chip">ملف يحتاج إكمال</span>
                      ) : null}
                      {staff.employmentSource === "partner" ? (
                        <span className="emp-staff-source-chip emp-staff-source-chip--partner">
                          موظف شريك{staff.partnerName ? ` · ${staff.partnerName}` : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="emp-staff-footer">
                    <div className="emp-staff-kpi" style={{ "--employee-kpi": `${kpi}%` } as CSSProperties}>
                      <div className="emp-staff-kpi-ring"><b>{kpiLabel}</b></div>
                      <span>أداء الشهر</span>
                    </div>
                    <span className="emp-staff-open">
                      <span>عرض الملف</span>
                      <i><FontAwesomeIcon icon={faArrowLeft} /></i>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="emp-list-state emp-list-state--empty">
            <b>لا توجد موظفات مطابقة للفلاتر الحالية.</b>
            <span>جرّبي اختيار «كل الموظفات» أو مسح عبارة البحث.</span>
          </div>
        )}
      </div>
    </>
  );
}
