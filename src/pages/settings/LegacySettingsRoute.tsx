import "../../styles/DashboardEnterpriseWorkspaces.css";

import SettingsAttendance from "./SettingsAttendance";
import SettingsCatalog from "./SettingsCatalog";
import SettingsContact from "./SettingsContact";

type LegacySettingsRouteKind = "catalog" | "contact" | "attendance";

type LegacySettingsRouteProps = {
  kind: LegacySettingsRouteKind;
  hasAdminPower?: boolean;
};

export default function LegacySettingsRoute({
  kind,
  hasAdminPower = false,
}: LegacySettingsRouteProps) {
  if (kind === "catalog") return <SettingsCatalog hasAdminPower={hasAdminPower} />;
  if (kind === "contact") return <SettingsContact hasAdminPower={hasAdminPower} />;
  return <SettingsAttendance hasAdminPower={hasAdminPower} />;
}
