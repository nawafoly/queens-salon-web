export function resolveDashboardLandingPath(role: string | null | undefined): string {
  const normalized = String(role || "").toLowerCase().trim();
  return normalized === "staff" ? "/dashboard/staff" : "/dashboard";
}
