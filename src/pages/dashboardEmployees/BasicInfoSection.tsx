import { EmployeeBasicTabLiveV2 } from "../../components/dashboard-v2/employee-workspace/live";

type BasicInfoSectionProps = {
  isVisible: boolean;
  name: string;
  active: boolean;
  showOnAbout: boolean;
  showOnBooking: boolean;
  weeklyOffLabel: string;
  onNameChange: (value: string) => void;
  onActiveChange: (value: boolean) => void;
  onShowOnAboutChange: (value: boolean) => void;
  onShowOnBookingChange: (value: boolean) => void;
};

export default function BasicInfoSection({
  isVisible,
  name,
  active,
  showOnAbout,
  showOnBooking,
  weeklyOffLabel,
  onNameChange,
  onActiveChange,
  onShowOnAboutChange,
  onShowOnBookingChange,
}: BasicInfoSectionProps) {
  if (!isVisible) return null;

  return (
    <EmployeeBasicTabLiveV2
      readOnly={false}
      name={name}
      active={active}
      showOnAbout={showOnAbout}
      showOnBooking={showOnBooking}
      weeklyOffLabel={weeklyOffLabel}
      onNameChange={onNameChange}
      onActiveChange={onActiveChange}
      onShowOnAboutChange={onShowOnAboutChange}
      onShowOnBookingChange={onShowOnBookingChange}
    />
  );
}
