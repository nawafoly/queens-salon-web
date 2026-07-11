import React from "react";

import type { AppPermission } from "../helpers/permissions";
import { usePermissions } from "../security/PermissionContext";
import AccessDenied from "./AccessDenied";

type PermissionRouteProps = {
  permission?: AppPermission;
  anyOf?: AppPermission[];
  allOf?: AppPermission[];
  children: React.ReactElement;
  fallback?: React.ReactElement;
  compact?: boolean;
};

export default function PermissionRoute({
  permission,
  anyOf = [],
  allOf = [],
  children,
  fallback,
  compact,
}: PermissionRouteProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();

  const allowed =
    (!permission || hasPermission(permission)) &&
    hasAnyPermission(anyOf) &&
    hasAllPermissions(allOf);

  if (allowed) return children;
  if (fallback) return fallback;

  return (
    <AccessDenied
      requiredPermission={permission || (allOf.length === 1 ? allOf[0] : undefined)}
      compact={compact}
    />
  );
}
