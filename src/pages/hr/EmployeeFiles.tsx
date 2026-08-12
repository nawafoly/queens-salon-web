import AdminFilesV2 from "./AdminFilesV2";
import EmployeeFilesLegacy from "./EmployeeFilesLegacy";
import type { HrSession } from "./shared";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

function isDashboardFilesRoute() {
  if (typeof window === "undefined") return false;
  return /^\/dashboard(?:\/|$)/.test(window.location.pathname);
}

export default function EmployeeFilesPage(props: Props) {
  if (isDashboardFilesRoute()) {
    return <AdminFilesV2 session={props.session} />;
  }

  return <EmployeeFilesLegacy {...props} />;
}
