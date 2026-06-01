import { useMemo } from "react";

import { toArabicSectionLabel, type ServiceOption } from "./shared";

type ServicesSectionProps = {
  isVisible: boolean;
  srvQ: string;
  srvSection: string;
  sectionOptions: Array<{ id: string; label: string }>;
  filteredServicesForPicks: ServiceOption[];
  specialties: string[];
  onSrvQChange: (value: string) => void;
  onSrvSectionChange: (value: string) => void;
  onToggleSpecialty: (serviceId: string) => void;
};

export default function ServicesSection({
  isVisible,
  srvQ,
  srvSection,
  sectionOptions,
  filteredServicesForPicks,
  specialties,
  onSrvQChange,
  onSrvSectionChange,
  onToggleSpecialty,
}: ServicesSectionProps) {
  const selectedCount = specialties.length;

  const groupedServices = useMemo(() => {
    if (srvSection !== "all") {
      return [{ id: srvSection, label: "", services: filteredServicesForPicks }];
    }

    const groups = new Map<string, ServiceOption[]>();
    for (const service of filteredServicesForPicks) {
      const sectionId = String(service.sectionId || "other").trim() || "other";
      const bucket = groups.get(sectionId) || [];
      bucket.push(service);
      groups.set(sectionId, bucket);
    }

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b, "ar"))
      .map(([id, services]) => ({
        id,
        label: toArabicSectionLabel(id, id),
        services,
      }));
  }, [filteredServicesForPicks, srvSection]);

  if (!isVisible) return null;

  return (
    <div className="emp-modal-section">
      <header className="emp-section-header">
        <div className="emp-section-header__main">
          <h3 className="emp-modal-section-title">الخدمات</h3>
          <p className="emp-section-lead">
            اختاري الخدمات التي تتقنها الموظفة. هذا يحدد ما يظهر لها في الحجز وبطاقة الملف.
          </p>
        </div>
        <div className="emp-section-header__aside">
          <span className="emp-badge accent">{selectedCount} خدمة محددة</span>
        </div>
      </header>

      <div className="emp-service-toolbar">
        <input
          className="dash-input"
          placeholder="بحث بالخدمات..."
          value={srvQ}
          onChange={(e) => onSrvQChange(e.target.value)}
        />
        <select className="dash-select" value={srvSection} onChange={(e) => onSrvSectionChange(e.target.value)}>
          <option value="all">كل الأقسام</option>
          {sectionOptions.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </div>

      <div className="staff-picks staff-picks--scroll">
        {filteredServicesForPicks.length === 0 ? (
          <div className="emp-service-empty">لا توجد خدمات مطابقة للبحث أو القسم المحدد.</div>
        ) : (
          groupedServices.map((group) => (
            <section key={group.id} className="emp-service-group">
              {srvSection === "all" && group.label ? (
                <h4 className="emp-service-group-title">{group.label}</h4>
              ) : null}
              <div className="emp-service-grid">
                {group.services.map((service) => {
                  const selected = specialties.includes(service.id);
                  return (
                    <label
                      key={service.id}
                      className={`emp-service-item ${selected ? "is-selected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleSpecialty(service.id)}
                      />
                      <span>{service.label}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
