export function resolveDashboardLandingPath(role: string | null | undefined): string {
  const normalized = String(role || "").toLowerCase().trim();
  if (normalized === "hr") return "/admin";
  return normalized === "staff" ? "/dashboard/staff" : "/dashboard";
}
