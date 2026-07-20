import { isInternalAuthRole, normalizeAuthRole } from "../services/authAccess";

export function resolveInternalPostLoginRoute(
  role: string | null | undefined
): string | null {
  const normalized = normalizeAuthRole(role);

  if (normalized === "staff") return "/employee/overview";
  if (normalized === "hr") return "/admin";
  if (normalized === "owner" || normalized === "admin" || normalized === "accountant" || normalized === "reception") {
    return "/dashboard";
  }
  if (normalized === "pending") return "/dashboard-pending";

  return null;
}

export function resolveClientPostLoginRoute(
  role: string | null | undefined,
  fallback = "/client"
): string | null {
  return normalizeAuthRole(role) === "client" ? fallback : null;
}

export function resolvePostLoginRoute(role: string | null | undefined): string {
  const internalRoute = resolveInternalPostLoginRoute(role);
  if (internalRoute) return internalRoute;

  const normalized = normalizeAuthRole(role);
  if (normalized === "client") return "/client";
  if (isInternalAuthRole(normalized)) return "/hr";

  return "/hr";
}

export function resolveDashboardLandingPath(role: string | null | undefined): string {
  return resolveInternalPostLoginRoute(role) || "/hr";
}
