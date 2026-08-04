import type { CSSProperties } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import EmployeeAvatar from "../../components/EmployeeAvatar";
import {
  DashboardEmptyStateV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import {
  faArrowLeft,
  faEnvelope,
  faMagnifyingGlass,
  faPhone,
  faRotateLeft,
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

  if (onLeave) return { label: "في إجازة", tone: "gold" } as const;
  if (staff.active) return { label: "نشطة", tone: "success" } as const;
  return { label: "غير نشطة", tone: "danger" } as const;
}

function EmployeeCardSkeleton({ index }: { index: number }) {
  return (
    <article className="employees-v2-card employees-v2-card--skeleton" aria-hidden="true">
      <div className="employees-v2-card__identity">
        <DashboardSkeletonV2 variant="circle" width={48} height={48} />
        <div className="employees-v2-card__skeleton-copy">
          <DashboardSkeletonV2 variant="title" width={`${64 + (index % 3) * 8}%`} />
          <DashboardSkeletonV2 variant="text" width="48%" />
        </div>
      </div>
      <DashboardSkeletonV2 variant="block" height={72} />
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
    <section className="dsv2-card employees-v2-directory" aria-label="قائمة الموظفات">
      <header className="employees-v2-directory__head">
        <div>
          <h2 className="dsv2-section-title">دليل الموظفات</h2>
          <p className="dsv2-section-caption">بحث سريع وفتح ملف الموظفة من قائمة موحدة.</p>
        </div>
        <span className="dsv2-badge">{filtered.length} ملف</span>
      </header>

      <div className="employees-v2-filters">
        <label className="dsv2-field employees-v2-search">
          <span className="dsv2-field__label">البحث</span>
          <span className="employees-v2-search__control">
            <FontAwesomeIcon icon={faMagnifyingGlass} />
            <input
              className="dsv2-input"
              value={qText}
              onChange={(event) => onQTextChange(event.target.value)}
              placeholder="الاسم، الجوال، البريد أو الرقم الوظيفي"
              aria-label="بحث في الموظفات"
            />
          </span>
        </label>

        <label className="dsv2-field">
          <span className="dsv2-field__label">الحالة</span>
          <DashboardSelectV2
            value={onlyActive}
            options={[
              { value: "all", label: "كل الحالات" },
              { value: "active", label: "النشطات فقط" },
              { value: "inactive", label: "غير النشطات فقط" },
            ]}
            onChange={(value) => onOnlyActiveChange(value as "all" | "active" | "inactive")}
          />
        </label>

        <label className="dsv2-field">
          <span className="dsv2-field__label">الخدمة</span>
          <DashboardSelectV2
            value={specialtyFilter}
            options={[
              { value: "all", label: "كل الخدمات" },
              { value: "none", label: "بدون خدمات مسندة" },
              ...serviceFilterOptions.map((service) => ({
                value: service.id,
                label: service.label || service.id,
              })),
            ]}
            onChange={onSpecialtyFilterChange}
          />
        </label>

        <button
          className="dsv2-btn dsv2-btn--secondary employees-v2-reset"
          type="button"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
        >
          <FontAwesomeIcon icon={faRotateLeft} />
          إعادة ضبط
        </button>
      </div>

      {loading ? (
        <div className="employees-v2-grid" aria-label="جاري تحميل الموظفات">
          {Array.from({ length: 6 }, (_, index) => (
            <EmployeeCardSkeleton key={index} index={index} />
          ))}
        </div>
      ) : filtered.length ? (
        <div className="employees-v2-grid">
          {filtered.map((staff) => {
            const specialtyIds = normalizeSpecialties(staff.specialties);
            const status = statusOf(staff);
            const department = resolveDepartment(staff, serviceOptions, sectionOptions);
            const total = bookingStats[staff.id]?.total ?? 0;
            const confirmed = bookingStats[staff.id]?.byStatus.confirmed ?? 0;
            const kpi = total > 0 ? Math.round((confirmed / total) * 100) : 0;
            const kpiLabel = statsLoading ? "…" : `${kpi}%`;
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
                className={`employees-v2-card ${isSelected ? "is-selected" : ""}`}
                onClick={() => onOpenEmployee(staff)}
                aria-label={`فتح ملف ${name}`}
              >
                <div className="employees-v2-card__top">
                  <div className="employees-v2-card__identity">
                    <EmployeeAvatar
                      className="employees-v2-card__avatar"
                      src={staff.avatarUrl}
                      name={name}
                      alt={name}
                    />
                    <div>
                      <h3>{name}</h3>
                      <p>
                        {cleanText(staff.title) || department}
                        {shortEmployeeId ? <span> · #{shortEmployeeId}</span> : null}
                      </p>
                    </div>
                  </div>
                  <span className={`dsv2-badge dsv2-badge--${status.tone}`}>{status.label}</span>
                </div>

                <div className="employees-v2-card__contact">
                  <span title={email || "لا يوجد بريد"}>
                    <FontAwesomeIcon icon={faEnvelope} />
                    <b>{email || "لا يوجد بريد"}</b>
                  </span>
                  <span title={phone || "لا يوجد جوال"}>
                    <FontAwesomeIcon icon={faPhone} />
                    <b>{phone || "لا يوجد جوال"}</b>
                  </span>
                </div>

                <div className="employees-v2-card__stats">
                  <span>
                    <small>الخدمات</small>
                    <strong>{specialtyIds.length}</strong>
                  </span>
                  <span>
                    <small>حالة الملف</small>
                    <strong data-tone={needsCompletion ? "warning" : "success"}>
                      {needsCompletion ? "يحتاج إكمال" : "مكتمل"}
                    </strong>
                  </span>
                  <span>
                    <small>أداء الشهر</small>
                    <strong>{kpiLabel}</strong>
                    <i aria-hidden="true">
                      <b style={{ "--employees-v2-progress": `${kpi}%` } as CSSProperties} />
                    </i>
                  </span>
                </div>

                <div className="employees-v2-card__open" aria-hidden="true">
                  <span>فتح الملف</span>
                  <FontAwesomeIcon icon={faArrowLeft} />
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <DashboardEmptyStateV2
          title="لا توجد موظفات مطابقة"
          description="غيّري البحث أو أعيدي ضبط الفلاتر لعرض الملفات المتاحة."
          tone="gold"
          action={
            hasActiveFilters ? (
              <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={clearFilters}>
                إعادة ضبط الفلاتر
              </button>
            ) : canManage ? (
              <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={onCreateEmployee}>
                إضافة موظفة
              </button>
            ) : null
          }
        />
      )}
    </section>
  );
}
