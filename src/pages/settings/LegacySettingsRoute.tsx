import "../../styles/DashboardEnterpriseWorkspaces.css";

import SettingsAttendance from "./SettingsAttendance";

type LegacySettingsRouteKind = "attendance";

type LegacySettingsRouteProps = {
  kind: LegacySettingsRouteKind;
  hasAdminPower?: boolean;
};

export default function LegacySettingsRoute({
  kind: _kind,
  hasAdminPower = false,
}: LegacySettingsRouteProps) {
  return <SettingsAttendance hasAdminPower={hasAdminPower} />;
}
