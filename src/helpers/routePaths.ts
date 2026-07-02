function normalizePostLoginRole(role: string | null | undefined) {
  const normalized = String(role || "").toLowerCase().trim();
  if (normalized === "employee") return "staff";
  if (normalized === "administrator") return "admin";
  if (normalized === "human resources" || normalized === "humanresources") return "hr";
  if (normalized === "receptionist" || normalized === "frontdesk" || normalized === "desk") {
    return "reception";
  }
  return normalized;
}

export function resolvePostLoginRoute(role: string | null | undefined): string {
  const normalized = normalizePostLoginRole(role);

  if (normalized === "staff") return "/employee/overview";
  if (normalized === "hr") return "/admin";
  if (normalized === "owner" || normalized === "admin" || normalized === "reception") {
    return "/dashboard";
  }
  if (normalized === "accountant") return "/dashboard";
  if (normalized === "client") return "/client";
  if (normalized === "pending") return "/dashboard-pending";

  return "/employee/overview";
}

export function resolveDashboardLandingPath(role: string | null | undefined): string {
  return resolvePostLoginRoute(role);
}
