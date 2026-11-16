import type { StaffPublicUi } from "./shared";

export type EmployeeWorkState = "working" | "leave" | "ended" | "inactive" | "unknown";

function day(value: unknown): string {
  const text = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

/** Three independent dimensions: employment, directory visibility, and account. */
export function employeeWorkState(staff: StaffPublicUi, today: string): EmployeeWorkState {
  const employment = String(staff.employmentStatus ?? "").trim().toLowerCase();
  const endedByStatus = ["terminated", "resigned", "ended", "offboarded"].includes(employment);
  // Core offboarding writes employment_status=inactive and a canonical end date.
  // Mere account deactivation or directory hiding must never imply offboarding.
  const endedByDate = employment === "inactive" &&
    Boolean(day(staff.employmentEndDate)) &&
    day(staff.employmentEndDate) <= today;
  if (endedByStatus || endedByDate) return "ended";
  if (!staff.active || employment === "inactive" || employment === "suspended" || employment === "disabled") return "inactive";
  // Leave permissions may hide Core employee_leaves, so absence of a returned
  // leave row is not proof of being at work unless the status was loaded.
  if (staff.leaveStatusKnown !== true) return "unknown";
  const leaveFrom = day(staff.leaveStartDate);
  const leaveUntil = day(staff.leaveUntil);
  if (staff.onLeave && (!leaveFrom || leaveFrom <= today) && (!leaveUntil || leaveUntil >= today)) {
    return "leave";
  }
  return "working";
}

export function employeeDirectoryVisibility(staff: StaffPublicUi): "visible" | "hidden" {
  return staff.includeInEmployeeManagement === false ? "hidden" : "visible";
}

export function employeeLoginState(staff: StaffPublicUi): "active" | "disabled" | "unlinked" {
  const accountStatus = String(staff.accountStatus ?? "").trim().toLowerCase();
  if (!accountStatus) return "unlinked";
  return accountStatus === "active" ? "active" : "disabled";
}
