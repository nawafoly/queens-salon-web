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
  onQTextChange: (value: string) => void;
  onOnlyActiveChange: (value: "all" | "active" | "inactive") => void;
  onSpecialtyFilterChange: (value: string) => void;
  onCreateEmployee: () => void;
  onOpenEmployee: (staff: StaffPublicUi) => void;
};

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
  onQTextChange,
  onOnlyActiveChange,
  onSpecialtyFilterChange,
  onCreateEmployee,
  onOpenEmployee,
}: EmployeeListPanelProps) {
  return (
    <>
      <div className="dash-card">
        <div className="dash-row">
          <div className="dash-field">
            <label className="emp-label">بحث</label>
            <input
              className="dash-input"
              value={qText}
              onChange={(e) => onQTextChange(e.target.value)}
              placeholder="ابحث باسم الموظفة"
            />
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
              <option value="all">كل الخدمات</option>
              {Array.from(new Set(serviceOptions.map((x) => String(x.id || "").trim()).filter(Boolean))).map(
                (serviceId) => (
                  <option key={serviceId} value={serviceId}>
                    {serviceOptions.find((x) => String(x.id || "").trim() === serviceId)?.label || serviceId}
                  </option>
                )
              )}
            </select>
          </div>
          <div className="dash-actions">
            <button className="exp-btn primary" type="button" onClick={onCreateEmployee}>
              إضافة موظفة
            </button>
          </div>
        </div>
      </div>

      <div className="dash-card mt-3">
        <div className="emp-list-title">
          <b>الموظفات ({filtered.length})</b>
          <span>موظفاتي</span>
        </div>
        {loading ? (
          <div className="emp-field-note">جاري تحميل الموظفات...</div>
        ) : filtered.length ? (
          <div className="emp-staff-list">
            {filtered.map((staff) => {
              const specialtyIds = normalizeSpecialties(staff.specialties);
              const mainService = serviceOptions.find((option) => option.id === specialtyIds[0]);
              const sectionId = String(mainService?.sectionId || "").trim();
              const department = sectionId
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

              return (
                <button
                  key={staff.id}
                  type="button"
                  className={`emp-staff-row ${isSelected ? "is-selected" : ""}`}
                  onClick={() => onOpenEmployee(staff)}
                >
                  <div className="emp-staff-avatar">
                    {staff.avatarUrl ? (
                      <img src={staff.avatarUrl} alt={String(staff.name || "صورة الموظفة")} />
                    ) : (
                      getNameInitials(String(staff.name || ""))
                    )}
                  </div>

                  <div className="emp-staff-main">
                    <div className="emp-staff-headline">
                      <b>{staff.name || "—"}</b>
                      <span className={`staff-pill ${statusClass}`}>{statusLabel}</span>
                    </div>
                    <div className="emp-staff-dept">{department}</div>
                  </div>

                  <div className="emp-staff-kpi">
                    <span>الأداء</span>
                    <b>{kpiLabel}</b>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="emp-field-note">لا توجد موظفات مطابقة للفلاتر الحالية.</div>
        )}
      </div>
    </>
  );
}
