import { EmployeeBasicTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";

type BasicInfoSectionProps = {
  isVisible: boolean;
  name: string;
  active: boolean;
  showOnAbout: boolean;
  showOnBooking: boolean;
  includeInEmployeeManagement: boolean;
  weeklyOffLabel: string;
  onNameChange: (value: string) => void;
  onActiveChange: (value: boolean) => void;
  onShowOnAboutChange: (value: boolean) => void;
  onShowOnBookingChange: (value: boolean) => void;
  onIncludeInEmployeeManagementChange: (value: boolean) => void;
};

export default function BasicInfoSection({
  isVisible,
  name,
  active,
  showOnAbout,
  showOnBooking,
  includeInEmployeeManagement,
  weeklyOffLabel,
  onNameChange,
  onActiveChange,
  onShowOnAboutChange,
  onShowOnBookingChange,
  onIncludeInEmployeeManagementChange,
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
      weeklyOffLabel={weeklyOffLabel}
      onNameChange={onNameChange}
      onActiveChange={onActiveChange}
      onShowOnAboutChange={onShowOnAboutChange}
      onShowOnBookingChange={onShowOnBookingChange}
      onIncludeInEmployeeManagementChange={onIncludeInEmployeeManagementChange}
    />
  );
}
