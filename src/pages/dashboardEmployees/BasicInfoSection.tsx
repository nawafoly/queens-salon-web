import { EmployeeBasicTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";

type BasicInfoSectionProps = {
  isVisible: boolean;
  name: string;
  active: boolean;
  showOnAbout: boolean;
  showOnBooking: boolean;
  includeInEmployeeManagement: boolean;
  employmentStartDate: string;
  weeklyOffLabel: string;
  onNameChange: (value: string) => void;
  onActiveChange: (value: boolean) => void;
  onShowOnAboutChange: (value: boolean) => void;
  onShowOnBookingChange: (value: boolean) => void;
  onIncludeInEmployeeManagementChange: (value: boolean) => void;
  onEmploymentStartDateChange: (value: string) => void;
};

export default function BasicInfoSection({
  isVisible,
  name,
  active,
  showOnAbout,
  showOnBooking,
  includeInEmployeeManagement,
  employmentStartDate,
  weeklyOffLabel,
  onNameChange,
  onActiveChange,
  onShowOnAboutChange,
  onShowOnBookingChange,
  onIncludeInEmployeeManagementChange,
  onEmploymentStartDateChange,
}: BasicInfoSectionProps) {
  if (!isVisible) return null;

  return (
    <EmployeeBasicTabLiveV2
      readOnly={false}
      name={name}
      active={active}
      showOnAbout={showOnAbout}
      showOnBooking={showOnBooking}
      includeInEmployeeManagement={includeInEmployeeManagement}
      employmentStartDate={employmentStartDate}
      weeklyOffLabel={weeklyOffLabel}
      onNameChange={onNameChange}
      onActiveChange={onActiveChange}
      onShowOnAboutChange={onShowOnAboutChange}
      onShowOnBookingChange={onShowOnBookingChange}
      onIncludeInEmployeeManagementChange={onIncludeInEmployeeManagementChange}
      onEmploymentStartDateChange={onEmploymentStartDateChange}
    />
  );
}
