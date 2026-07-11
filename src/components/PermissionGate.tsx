import React from "react";

import type { AppPermission } from "../helpers/permissions";
import { usePermissions } from "../security/PermissionContext";

type PermissionGateProps = {
  permission?: AppPermission;
  anyOf?: AppPermission[];
  allOf?: AppPermission[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export default function PermissionGate({
  permission,
  anyOf = [],
  allOf = [],
  children,
  fallback = null,
}: PermissionGateProps) {
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();
  const allowed =
    (!permission || hasPermission(permission)) &&
    hasAnyPermission(anyOf) &&
    hasAllPermissions(allOf);

  return <>{allowed ? children : fallback}</>;
}
