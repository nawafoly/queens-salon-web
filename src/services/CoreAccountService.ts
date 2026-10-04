import { coreApiRequest } from "./coreApiClient";
import type { AppPermission, UserRole } from "../helpers/permissions";
import { normalizeEmployeeIdentityId } from "../helpers/employeeIdentityId";

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
  photoUrl?: string | null;
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
  photoUrl?: string | null;
  role?: string;
  status?: AccountStatus;
  emailVerified?: boolean;
};

export type AccountUpdateInput = Partial<AccountCreateInput> & {
  primaryRole?: string;
};

function normalizeEmployeeLink(link: CoreEmployeeLink): CoreEmployeeLink {
  if (!link) return null;

  const employeeId = normalizeEmployeeIdentityId(link.employeeId);
  return {
    ...link,
    employeeId,
    employee: link.employee
      ? {
          ...link.employee,
          id: normalizeEmployeeIdentityId(link.employee.id || employeeId),
        }
      : link.employee,
  };
}

function normalizeAccount(account: CoreAccount): CoreAccount {
  return {
    ...account,
    ...(Object.prototype.hasOwnProperty.call(account, "employeeLink")
      ? { employeeLink: normalizeEmployeeLink(account.employeeLink || null) }
      : {}),
  };
}

export const CoreAccountService = {
  me() {
    return coreApiRequest<CoreAuthMe>("/api/auth/me").then((payload) => ({
      ...payload,
      user: normalizeAccount(payload.user),
      employeeLink: normalizeEmployeeLink(payload.employeeLink),
    }));
  },

  list(includeDeleted = false, scope: "all" | "internal" = "all") {
    return coreApiRequest<CoreAccount[]>("/api/admin/accounts", {
      query: {
        ...(includeDeleted ? { includeDeleted: true } : {}),
        ...(scope === "internal" ? { scope: "internal" } : {}),
      },
    }).then((rows) => rows.map(normalizeAccount));
  },

  get(id: string) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}`).then(normalizeAccount);
  },

  create(input: AccountCreateInput) {
    return coreApiRequest<CoreAccount>("/api/admin/accounts", {
      method: "POST",
      body: input as Record<string, unknown>,
    }).then(normalizeAccount);
  },

  update(id: string, input: AccountUpdateInput) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: input as Record<string, unknown>,
    }).then(normalizeAccount);
  },

  disable(id: string) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}/disable`, {
      method: "POST",
    }).then(normalizeAccount);
  },

  restore(id: string) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}/restore`, {
      method: "POST",
    }).then(normalizeAccount);
  },

  remove(id: string) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).then(normalizeAccount);
  },

  replacePermissions(id: string, permissions: AppPermission[]) {
    return coreApiRequest<CoreAccount>(`/api/admin/accounts/${encodeURIComponent(id)}/permissions`, {
      method: "PUT",
      body: { permissions },
    }).then(normalizeAccount);
  },

  roles() {
    return coreApiRequest<CoreRole[]>("/api/admin/roles");
  },

  permissions() {
    return coreApiRequest<CorePermission[]>("/api/admin/permissions");
  },

  linkEmployee(id: string, employeeId: string) {
    const canonicalEmployeeId = normalizeEmployeeIdentityId(employeeId);
    return coreApiRequest<CoreEmployeeLink>(`/api/admin/accounts/${encodeURIComponent(id)}/employee-link`, {
      method: "PUT",
      body: { employeeId: canonicalEmployeeId },
    }).then(normalizeEmployeeLink);
  },

  unlinkEmployee(id: string) {
    return coreApiRequest<CoreEmployeeLink>(`/api/admin/accounts/${encodeURIComponent(id)}/employee-link`, {
      method: "DELETE",
    }).then(normalizeEmployeeLink);
  },

  resetPassword(id: string) {
    return coreApiRequest<{ sent: boolean; email: string }>(
      `/api/admin/accounts/${encodeURIComponent(id)}/reset-password`,
      { method: "POST" }
    );
  },
};
