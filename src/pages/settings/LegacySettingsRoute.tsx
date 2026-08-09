import "../../styles/DashboardEnterpriseWorkspaces.css";

import SettingsAttendance from "./SettingsAttendance";
import SettingsContact from "./SettingsContact";

type LegacySettingsRouteKind = "contact" | "attendance";

type LegacySettingsRouteProps = {
  kind: LegacySettingsRouteKind;
  hasAdminPower?: boolean;
};

export default function LegacySettingsRoute({
  kind,
  hasAdminPower = false,
}: LegacySettingsRouteProps) {
  if (kind === "contact") return <SettingsContact hasAdminPower={hasAdminPower} />;
  return <SettingsAttendance hasAdminPower={hasAdminPower} />;
}
