import AdminMessagesV2 from "./AdminMessagesV2";
import EmployeeMessagesLegacy from "./EmployeeMessagesLegacy";
import type { HrSession } from "./shared";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

function isDashboardMessagesRoute() {
  if (typeof window === "undefined") return false;
  return /^\/dashboard(?:\/|$)/.test(window.location.pathname);
}

export default function EmployeeMessagesPage(props: Props) {
  if (isDashboardMessagesRoute()) {
    return <AdminMessagesV2 session={props.session} />;
  }

  return <EmployeeMessagesLegacy {...props} />;
}
