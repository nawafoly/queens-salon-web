import { coreApiRequest } from "./coreApiClient";
import type { AppPermission, UserRole } from "../helpers/permissions";

export type AccountStatus = "active" | "disabled" | "pending" | "deleted";

export type CoreEmployeeLink = {
  id: string;
  userId: string;
  employeeId: string;
  status: "active" | "pending" | "unlinked";
  linkedAt?: string | null;
  updatedAt?: string | null;
  unlinkedAt?: string | null;
  employee?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  } | null;
} | null;

export type CoreAccount = {
  id: string;
  uid: string;
  firebaseUid: string;
  salonId: string;
  email: string;
  phone: string;
  displayName: string;
  primaryRole: UserRole | "accountant" | "client";
  role: UserRole | "accountant" | "client";
  status: AccountStatus;
  active: boolean;
  emailVerified: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
  legacySource?: string;
  legacyId?: string;
  rolePermissions?: AppPermission[];
  allowedPermissions?: AppPermission[];
  deniedPermissions?: AppPermission[];
  permissions?: AppPermission[];
  effectivePermissions?: AppPermission[];
  employeeLink?: CoreEmployeeLink;
};

export type CoreAuthMe = {
  user: CoreAccount;
  roles: string[];
  permissions: AppPermission[];
  employeeLink: CoreEmployeeLink;
};

export type CoreRole = {
  id: string;
  salon_id: string;
  role_key: string;
  label: string;
  rank: number;
  protected: number;
  assignable: number;
};

export type CorePermission = {
  permission_key: AppPermission;
  group_key: string;
  label: string;
  description?: string;
  sensitive?: number;
};

export type AccountCreateInput = {
  firebaseUid?: string;
  email?: string;
  phone?: string;
  displayName?: string;
  role?: string;
  status?: AccountStatus;
  emailVerified?: boolean;
};

export type AccountUpdateInput = Partial<AccountCreateInput> & {
  primaryRole?: string;
};

export const CoreAccountService = {
  me() {
    return coreApiRequest<CoreAuthMe>("/api/auth/me");
  },

  list(includeDeleted = false, scope: "all" | "internal" = "all") {
    return coreApiRequest<CoreAccount[]>("/api/admin/accounts", {
      query: {
        ...(includeDeleted ? { includeDeleted: true } : {}),
        ...(scope === "internal" ? { scope: "internal" } : {}),
      },
    });
  },

  get(id: string) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}`);
  },

  create(input: AccountCreateInput) {
    return coreApiRequest<CoreAccount>("/api/admin/accounts", {
      method: "POST",
      body: input as Record<string, unknown>,
    });
  },

  update(id: string, input: AccountUpdateInput) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input as Record<string, unknown>,
    });
  },

  disable(id: string) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}/disable`, {
      method: "POST",
    });
  },

  restore(id: string) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    });
  },

  remove(id: string) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  replacePermissions(id: string, permissions: AppPermission[]) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}/permissions`, {
      method: "PUT",
      body: { permissions },
    });
  },

  roles() {
    return coreApiRequest<CoreRole[]>("/api/admin/roles");
  },

  permissions() {
    return coreApiRequest<CorePermission[]>("/api/admin/permissions");
  },

  linkEmployee(id: string, employeeId: string) {
    return coreApiRequest<CoreEmployeeLink>(`/api/admin/accounts/${encodeURIComponent(id)}/employee-link`, {
      method: "PUT",
      body: { employeeId },
    });
  },

  unlinkEmployee(id: string) {
    return coreApiRequest<CoreEmployeeLink>(`/api/admin/accounts/${encodeURIComponent(id)}/employee-link`, {
      method: "DELETE",
    });
  },

  resetPassword(id: string) {
    return coreApiRequest<{ sent: boolean; email: string }>(
      `/api/admin/accounts/${encodeURIComponent(id)}/reset-password`,
      { method: "POST" }
    );
  },
};
