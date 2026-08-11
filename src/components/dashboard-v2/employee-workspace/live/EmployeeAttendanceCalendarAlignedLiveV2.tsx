import type { ComponentProps } from "react";

import { EmployeeAttendanceTabLiveV2 as EmployeeAttendanceTabBaseLiveV2 } from "./EmployeeWorkspaceOperationalTabsLiveV2";
import "../../../../styles/dashboard-v2/pages/employee-attendance-calendar-alignment.css";

function monthStartWeekday(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || "").trim());
  if (!match) return 0;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return new Date(Date.UTC(year, monthIndex, 1, 12)).getUTCDay();
}

type EmployeeAttendanceTabBaseProps = ComponentProps<typeof EmployeeAttendanceTabBaseLiveV2>;

export function EmployeeAttendanceCalendarAlignedLiveV2(props: EmployeeAttendanceTabBaseProps) {
  const weekdayOffset = monthStartWeekday(props.monthKey);

  return (
    <div
      className={`dsv2-ew-attendance-calendar-alignment dsv2-ew-attendance-calendar-alignment--start-${weekdayOffset}`}
    >
      <EmployeeAttendanceTabBaseLiveV2 {...props} />
    </div>
  );
}
