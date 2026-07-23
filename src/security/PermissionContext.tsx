/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useMemo } from "react";

import {
  getEffectiveAppPermissions,
  getUserRole,
  type AppPermission,
  type UserRole,
} from "../helpers/permissions";

type PermissionSource = {
  role?: UserRole | string;
  permissions?: unknown;
  permissionOverrides?: unknown;
  permissionVersion?: unknown;
};

type PermissionContextValue = {
  role: UserRole;
  permissions: AppPermission[];
  hasPermission: (permission: AppPermission) => boolean;
  hasAnyPermission: (permissions: AppPermission[]) => boolean;
  hasAllPermissions: (permissions: AppPermission[]) => boolean;
};

const defaultValue: PermissionContextValue = {
  role: "guest",
  permissions: [],
  hasPermission: () => false,
  hasAnyPermission: (permissions) => permissions.length === 0,
  hasAllPermissions: (permissions) => permissions.length === 0,
};

const PermissionContext = createContext<PermissionContextValue>(defaultValue);

type PermissionProviderProps = PermissionSource & {
  children: React.ReactNode;
};

export function PermissionProvider({
  role,
  permissions,
  permissionOverrides,
  permissionVersion,
  children,
}: PermissionProviderProps) {
  const normalizedRole = getUserRole(role);
  const effectivePermissions = useMemo(
    () =>
      getEffectiveAppPermissions({
        role: normalizedRole,
        permissions,
        permissionOverrides,
        permissionVersion,
      }),
    [normalizedRole, permissions, permissionOverrides, permissionVersion]
  );

  const value = useMemo<PermissionContextValue>(() => {
    const permissionSet = new Set(effectivePermissions);
    return {
      role: normalizedRole,
      permissions: effectivePermissions,
      hasPermission: (permission) => permissionSet.has(permission),
      hasAnyPermission: (required) =>
        required.length === 0 || required.some((permission) => permissionSet.has(permission)),
      hasAllPermissions: (required) =>
        required.length === 0 || required.every((permission) => permissionSet.has(permission)),
    };
  }, [effectivePermissions, normalizedRole]);

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermissions() {
  return useContext(PermissionContext);
}
