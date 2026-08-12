import CreateStaffAccountV2 from "./CreateStaffAccountV2";
import CreateStaffAccountLegacy from "./CreateStaffAccountLegacy";
import type { HrSession } from "./shared";

type Props = {
  session: HrSession;
};

function isDashboardCreateStaffRoute() {
  if (typeof window === "undefined") return false;
  return /^\/dashboard(?:\/|$)/.test(window.location.pathname);
}

export default function CreateStaffAccountPage(props: Props) {
  if (isDashboardCreateStaffRoute()) {
    return <CreateStaffAccountV2 session={props.session} />;
  }

  return <CreateStaffAccountLegacy {...props} />;
}
