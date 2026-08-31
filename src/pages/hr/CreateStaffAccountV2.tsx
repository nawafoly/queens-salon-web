import { Navigate } from "react-router-dom";
import type { HrSession } from "./shared";

type Props = {
  session: HrSession;
};

export default function CreateStaffAccountV2(_props: Props) {
  return <Navigate to="/dashboard/employees" replace />;
}
