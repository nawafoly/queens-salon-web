import type { CSSProperties } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import EmployeeAvatar from "../../components/EmployeeAvatar";
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

function formatShortId(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";
  return raw.length > 12 ? `${raw.slice(0, 6)}…${raw.slice(-4)}` : raw;
}

function employeeDisplayName(staff: StaffPublicUi) {
  const name = cleanText(staff.name);
  if (name) return name;
  if (staff.source === "users" || staff.profileIncomplete) return "حساب يحتاج مراجعة";
  return "موظفة بدون اسم";
}

function resolveDepartment(
  staff: StaffPublicUi,
  serviceOptions: ServiceOption[],
  sectionOptions: Array<{ id: string; label: string }>
) {
  const specialtyIds = normalizeSpecialties(staff.specialties);
  const mainService = serviceOptions.find((option) => option.id === specialtyIds[0]);
  const sectionId = cleanText(mainService?.sectionId);
  const storedDepartment = cleanText(staff.department || staff.title);

  if (storedDepartment) return storedDepartment;
  if (!sectionId) return staff.employeeKind === "administrative" ? "إداري" : "قسم غير محدد";

  return toArabicSectionLabel(
    sectionId,
    sectionOptions.find((section) => section.id === sectionId)?.label || ""
  );
}

function statusOf(staff: StaffPublicUi) {
  const leaveUntil = normalizeLeaveUntil(staff.leaveUntil);
  const leaveExpired = !!leaveUntil && leaveUntil < todayIso();
  const onLeave = !!staff.onLeave && !leaveExpired;

  if (onLeave) return { label: "في إجازة", className: "warn" };
  if (staff.active) return { label: "نشطة", className: "on" };
  return { label: "غير نشطة", className: "off" };
}

function sourceLabelOf(staff: StaffPublicUi) {
  if (staff.source === "users") return "حساب غير مكتمل";
  if (staff.source === "employees") return "سجل إداري";
  if (staff.profileIncomplete) return "ملف يحتاج إكمال";
  return "ملف مكتمل";
}

function EmployeeCardSkeleton({ index }: { index: number }) {
  return (
    <article className="employees-card employees-card--skeleton" aria-hidden="true">
      <span className="employees-skeleton-avatar" />
      <div className="employees-skeleton-lines">
        <span style={{ width: `${72 - (index % 3) * 8}%` }} />
        <span style={{ width: `${54 + (index % 2) * 12}%` }} />
      </div>
      <div className="employees-skeleton-chips">
        <span />
        <span />
      </div>
    </article>
  );
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
  const assignedCount = filtered.filter(
    (staff) => normalizeSpecialties(staff.specialties).length > 0
  ).length;
  const incompleteCount = filtered.filter(
    (staff) => staff.profileIncomplete || staff.source !== "staff_public"
  ).length;
  const serviceFilterOptions = serviceOptions.filter((option, index, all) => {
    const id = cleanText(option.id);
    return !!id && all.findIndex((item) => cleanText(item.id) === id) === index;
  });

  const clearFilters = () => {
    onQTextChange("");
    onOnlyActiveChange("all");
    onSpecialtyFilterChange("all");
  };

  return (
    <section className="employees-directory-panel" aria-label="قائمة الموظفات">
      <div className="employees-directory-panel__head">
        <div>
          <span className="employees-eyebrow">دليل الموظفات</span>
          <h2>قائمة تشغيلية واضحة للفريق</h2>
          <p>بحث وفلاتر وفتح سريع للملفات بدون تغيير الصلاحيات أو مصادر البيانات الحالية.</p>
        </div>

        <div className="employees-directory-panel__actions">
          <span className="employees-result-count">{filtered.length} نتيجة</span>
          {canManage ? (
            <button className="employees-action employees-action--primary" type="button" onClick={onCreateEmployee}>
              <FontAwesomeIcon icon={faPlus} />
              إضافة موظفة
            </button>
          ) : (
            <span className="employees-readonly-chip">عرض فقط</span>
          )}
        </div>
      </div>

      <div className="employees-filter-panel">
        <label className="employees-search-field">
          <span>بحث</span>
          <div className="employees-search-control">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input
              value={qText}
              onChange={(event) => onQTextChange(event.target.value)}
              placeholder="الاسم، الجوال، البريد أو الرقم الوظيفي"
              aria-label="بحث في الموظفات"
            />
            {qText ? (
              <button type="button" onClick={() => onQTextChange("")} aria-label="مسح البحث">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            ) : null}
          </div>
        </label>

        <label className="employees-select-field">
          <span>الحالة</span>
          <select
            value={onlyActive}
            onChange={(event) => onOnlyActiveChange(event.target.value as "all" | "active" | "inactive")}
          >
            <option value="all">كل الحالات</option>
            <option value="active">النشطات فقط</option>
            <option value="inactive">غير النشطات فقط</option>
          </select>
        </label>

        <label className="employees-select-field">
          <span>الخدمة</span>
          <select value={specialtyFilter} onChange={(event) => onSpecialtyFilterChange(event.target.value)}>
            <option value="all">كل الخدمات</option>
            <option value="none">بدون خدمات مسندة</option>
            {serviceFilterOptions.map((service) => (
              <option key={service.id} value={service.id}>
                {service.label || service.id}
              </option>
            ))}
          </select>
        </label>

        <button
          className="employees-action employees-action--ghost"
          type="button"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
        >
          إعادة ضبط
        </button>
      </div>

      <div className="employees-mini-stats" aria-label="ملخص نتائج البحث">
        <div>
          <FontAwesomeIcon icon={faUsers} />
          <span>المعروض</span>
          <strong>{filtered.length}</strong>
        </div>
        <div>
          <FontAwesomeIcon icon={faUserCheck} />
          <span>نشطات</span>
          <strong>{activeCount}</strong>
        </div>
        <div>
          <FontAwesomeIcon icon={faScissors} />
          <span>لديهن خدمات</span>
          <strong>{assignedCount}</strong>
        </div>
        <div>
          <FontAwesomeIcon icon={faUserClock} />
          <span>تحتاج متابعة</span>
          <strong>{inactiveCount + incompleteCount}</strong>
        </div>
      </div>

      {loading ? (
        <div className="employees-grid employees-grid--loading" aria-label="جاري تحميل الموظفات">
          {Array.from({ length: 8 }, (_, index) => (
            <EmployeeCardSkeleton key={index} index={index} />
          ))}
        </div>
      ) : filtered.length ? (
        <div className="employees-grid">
          {filtered.map((staff) => {
            const specialtyIds = normalizeSpecialties(staff.specialties);
            const status = statusOf(staff);
            const department = resolveDepartment(staff, serviceOptions, sectionOptions);
            const total = bookingStats[staff.id]?.total ?? 0;
            const confirmed = bookingStats[staff.id]?.byStatus.confirmed ?? 0;
            const kpi = total > 0 ? Math.round((confirmed / total) * 100) : 0;
            const kpiLabel = statsLoading ? "..." : `${kpi}%`;
            const isSelected = selectedEmployeeId === staff.id;
            const needsCompletion = staff.profileIncomplete || staff.source !== "staff_public";
            const name = employeeDisplayName(staff);
            const email = cleanText(staff.email);
            const phone = cleanText(staff.phone);
            const shortEmployeeId = formatShortId(staff.employeeId || staff.id);

            return (
              <button
                key={`${staff.source || "staff"}:${staff.id}`}
                type="button"
                className={`employees-card ${isSelected ? "is-selected" : ""} ${
                  needsCompletion ? "needs-review" : ""
                }`}
                onClick={() => onOpenEmployee(staff)}
                aria-label={`فتح ملف ${name}`}
              >
                <div className="employees-card__top">
                  <EmployeeAvatar
                    className="employees-card__avatar"
                    src={staff.avatarUrl}
                    name={name}
                    alt={name}
                  />
                  <span className={`employees-status employees-status--${status.className}`}>
                    {status.label}
                  </span>
                </div>

                <div className="employees-card__body">
                  <h3>{name}</h3>
                  <p>{cleanText(staff.title) || department}</p>
                  <div className="employees-card__contact">
                    <span>{email || "لا يوجد بريد"}</span>
                    <span>{phone || "لا يوجد جوال"}</span>
                  </div>
                </div>

                <div className="employees-card__chips">
                  <span className={specialtyIds.length ? "is-ready" : "is-empty"}>
                    {specialtyIds.length ? `${specialtyIds.length} خدمة` : "بدون خدمات"}
                  </span>
                  <span className={needsCompletion ? "is-warning" : "is-ready"}>
                    {sourceLabelOf(staff)}
                  </span>
                  {staff.employmentSource === "partner" ? (
                    <span className="is-partner">
                      شريك{staff.partnerName ? ` · ${staff.partnerName}` : ""}
                    </span>
                  ) : null}
                </div>

                <div className="employees-card__footer">
                  <div
                    className="employees-card__kpi"
                    style={{ "--employees-card-kpi": `${kpi}%` } as CSSProperties}
                  >
                    <b>{kpiLabel}</b>
                    <span>أداء الشهر</span>
                  </div>
                  <div className="employees-card__open">
                    <span>{shortEmployeeId || "ملف الموظفة"}</span>
                    <i>
                      <FontAwesomeIcon icon={faArrowLeft} />
                    </i>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="employees-empty-state">
          <strong>لا توجد موظفات مطابقة</strong>
          <span>غيّري البحث أو أعيدي ضبط الفلاتر لعرض كل الملفات المتاحة لك.</span>
          <button className="employees-action employees-action--ghost" type="button" onClick={clearFilters}>
            إعادة ضبط الفلاتر
          </button>
        </div>
      )}
    </section>
  );
}
