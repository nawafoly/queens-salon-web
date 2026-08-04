import DashboardEmployeeWorkspaceV2 from "../components/dashboard-v2/employee-workspace";
import DashboardDesignSystemFoundationV2 from "./DashboardDesignSystemFoundationV2";

export default function DashboardDesignSystemV2() {
  return (
    <>
      <DashboardDesignSystemFoundationV2 />
      <DashboardEmployeeWorkspaceV2 />
    </>
  );
}
