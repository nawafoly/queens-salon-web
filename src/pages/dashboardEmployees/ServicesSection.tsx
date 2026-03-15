import type { ServiceOption } from "./shared";

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
  if (!isVisible) return null;

  return (
    <div className="emp-modal-section">
      <b className="emp-modal-section-title">الخدمات التي تقدمها الموظفة</b>
      <div className="emp-picks-toolbar">
        <input
          className="dash-input"
          placeholder="بحث بالخدمات..."
          value={srvQ}
          onChange={(e) => onSrvQChange(e.target.value)}
        />
        <select
          className="dash-select"
          value={srvSection}
          onChange={(e) => onSrvSectionChange(e.target.value)}
        >
          <option value="all">كل الأقسام</option>
          {sectionOptions.map((section) => (
            <option key={section.id} value={section.id}>
              {section.label}
            </option>
          ))}
        </select>
      </div>

      <div className="staff-picks staff-picks--scroll">
        {filteredServicesForPicks.map((service) => (
          <button
            key={service.id}
            type="button"
            className={`pick ${specialties.includes(service.id) ? "on" : ""}`}
            onClick={() => onToggleSpecialty(service.id)}
          >
            {service.label}
          </button>
        ))}
      </div>
    </div>
  );
}
