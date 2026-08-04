import { EmployeeServicesTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";
import type { ServiceOption } from "./shared";

type ServicesSectionProps = {
  isVisible: boolean;
  srvQ: string;
  srvSection: string;
  sectionOptions: Array<{ id: string; label: string }>;
  serviceOptions: ServiceOption[];
  filteredServicesForPicks: ServiceOption[];
  specialties: string[];
  onSrvQChange: (value: string) => void;
  onSrvSectionChange: (value: string) => void;
  onToggleSpecialty: (serviceId: string) => void;
  onSpecialtiesChange: (value: string[]) => void;
};

export default function ServicesSection({
  isVisible,
  srvQ,
  srvSection,
  sectionOptions,
  serviceOptions,
  filteredServicesForPicks,
  specialties,
  onSrvQChange,
  onSrvSectionChange,
  onToggleSpecialty,
  onSpecialtiesChange,
}: ServicesSectionProps) {
  if (!isVisible) return null;

  return (
    <EmployeeServicesTabLiveV2
      readOnly={false}
      search={srvQ}
      section={srvSection}
      sectionOptions={sectionOptions}
      serviceOptions={serviceOptions}
      filteredServices={filteredServicesForPicks}
      specialties={specialties}
      onSearchChange={onSrvQChange}
      onSectionChange={onSrvSectionChange}
      onToggleSpecialty={onToggleSpecialty}
      onSpecialtiesChange={onSpecialtiesChange}
    />
  );
}
