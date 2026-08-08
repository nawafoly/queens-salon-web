// src/pages/settings/SettingsUsers.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import {
  DashboardConfirmV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardFieldV2,
  DashboardModalV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
import {
  APP_PERMISSION_GROUPS,
  VISIBLE_APP_PERMISSION_CATALOG,
  normalizeAppPermissions,
  type AppPermission,
  type UserRole,
} from "../../helpers/permissions";
import {
  CoreAccountService,
  type CoreAccount,
  type CorePermission,
  type CoreRole,
} from "../../services/CoreAccountService";
import { CoreApiError } from "../../services/coreApiClient";
import { usePermissions } from "../../security/PermissionContext";


type UiRole = UserRole;
type AccountStatusFilter = "all" | "active" | "disabled" | "pending" | "deleted";
type LinkFilter = "all" | "linked" | "unlinked";
type AccountTypeFilter = "all" | "administrative" | "operational";

type SettingsUsersProps = {
  initialRole?: UiRole | string;
  authReady?: boolean;
  allowAdminManageUsers?: boolean;
};

type CreateDraft = {
  firebaseUid: string;
  displayName: string;
  email: string;
  phone: string;
  role: UiRole;
  status: "active" | "pending";
};

type EditDraft = {
  id: string;
  firebaseUid: string;
  displayName: string;
  email: string;
  phone: string;
  role: UiRole;
  status: CoreAccount["status"];
  permissions: AppPermission[];
  employeeId: string;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "المالك",
  admin: "الإدارة",
  hr: "الموارد البشرية",
  accountant: "المحاسبة",
  reception: "الاستقبال",
  staff: "الموظفات",
  pending: "قيد المراجعة",
  client: "عميلة",
  guest: "ضيف",
};

const ROLE_TONES: Record<string, string> = {
  owner: "dsv2-badge--gold",
  admin: "dsv2-badge--gold",
  hr: "dsv2-badge--success",
  accountant: "",
  reception: "",
  staff: "",
  pending: "dsv2-badge--gold",
  client: "",
  guest: "",
};

const FALLBACK_ROLES: CoreRole[] = [
  { id: "owner", salon_id: "main", role_key: "owner", label: "Owner", rank: 100, protected: 1, assignable: 1 },
  { id: "admin", salon_id: "main", role_key: "admin", label: "Admin", rank: 80, protected: 0, assignable: 1 },
  { id: "hr", salon_id: "main", role_key: "hr", label: "HR", rank: 60, protected: 0, assignable: 1 },
  { id: "accountant", salon_id: "main", role_key: "accountant", label: "Accountant", rank: 55, protected: 0, assignable: 1 },
  { id: "reception", salon_id: "main", role_key: "reception", label: "Reception", rank: 40, protected: 0, assignable: 1 },
  { id: "staff", salon_id: "main", role_key: "staff", label: "Staff", rank: 30, protected: 0, assignable: 1 },
  { id: "pending", salon_id: "main", role_key: "pending", label: "Pending", rank: 10, protected: 0, assignable: 1 },
];

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeRole(value: unknown): UiRole {
  const role = cleanText(value).toLowerCase();
  if (role === "accounting" || role === "finance") return "accountant";
  if (role === "administrator" || role === "manager") return "admin";
  if (role === "employee") return "staff";
  if (role === "receptionist" || role === "frontdesk" || role === "desk") return "reception";
  if (["owner", "admin", "hr", "accountant", "reception", "staff", "pending", "client", "guest"].includes(role)) {
    return role as UiRole;
  }
  return "guest";
}

function getRoleLabel(role: unknown) {
  return ROLE_LABELS[cleanText(role).toLowerCase()] || ROLE_LABELS.guest;
}

function getRoleTone(role: unknown) {
  return ROLE_TONES[cleanText(role).toLowerCase()] || ROLE_TONES.guest;
}

function isAdministrativeRole(role: unknown) {
  return ["owner", "admin", "hr", "accountant"].includes(normalizeRole(role));
}

function isOperationalRole(role: unknown) {
  return ["reception", "staff", "pending"].includes(normalizeRole(role));
}

function statusLabel(status: unknown) {
  const value = cleanText(status).toLowerCase();
  if (value === "active") return "نشط";
  if (value === "pending") return "قيد المراجعة";
  if (value === "deleted") return "محذوف";
  return "معطل";
}

function formatDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return "-";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function permissionLabel(permission: string, remoteCatalog: CorePermission[]) {
  const local = VISIBLE_APP_PERMISSION_CATALOG.find((item) => item.key === permission);
  if (local) return local.label;
  const remote = remoteCatalog.find((item) => item.permission_key === permission);
  return remote?.label || permission;
}

function permissionHint(permission: string, remoteCatalog: CorePermission[]) {
  const local = VISIBLE_APP_PERMISSION_CATALOG.find((item) => item.key === permission);
  if (local) return local.hint;
  return remoteCatalog.find((item) => item.permission_key === permission)?.description || "";
}

function permissionGroup(permission: string, remoteCatalog: CorePermission[]) {
  const local = VISIBLE_APP_PERMISSION_CATALOG.find((item) => item.key === permission);
  if (local) return local.group;
  return remoteCatalog.find((item) => item.permission_key === permission)?.group_key || "system";
}

function errorMessage(error: unknown) {
  if (error instanceof CoreApiError) {
    if (error.code === "ACCOUNT_OWNER_PROTECTED") return "لا يمكن تعديل حساب المالك من دور أقل.";
    if (error.code === "ACCOUNT_LAST_OWNER_PROTECTED") return "لا يمكن تعطيل أو حذف آخر مالك نشط.";
    if (error.code === "ACCOUNT_PERMISSION_GRANT_FORBIDDEN") return "لا يمكنك منح صلاحية لا تملكها.";
    if (error.code === "ACCOUNT_SELF_PERMISSION_CHANGE_FORBIDDEN") return "لا يمكن تعديل صلاحيات حسابك نفسه.";
    if (error.code === "ACCOUNT_FIREBASE_UID_REQUIRED") return "الحساب النشط يحتاج Firebase UID صحيح.";
    if (error.code === "ACCOUNT_UID_CONFLICT") return "Firebase UID مرتبط بحساب آخر.";
    return error.message;
  }
  return error instanceof Error ? error.message : "تعذر تنفيذ العملية.";
}

export default function SettingsUsers({
  initialRole,
  authReady,
  allowAdminManageUsers: _allowAdminManageUsers,
}: SettingsUsersProps = {}) {
  const location = useLocation();
  const { permissions: actorPermissions, role: permissionRole, hasPermission, hasAnyPermission } = usePermissions();
  const isAdminShell = location.pathname.startsWith("/dashboard") || location.pathname.startsWith("/admin");
  const pageTitle = isAdminShell ? "إدارة الحسابات الإدارية" : "إدارة الحسابات";
  const pageHint = "مصدر الحسابات والأدوار والصلاحيات والربط الوظيفي هو Cloudflare D1.";

  const [me, setMe] = useState<CoreAccount | null>(null);
  const [accounts, setAccounts] = useState<CoreAccount[]>([]);
  const [roles, setRoles] = useState<CoreRole[]>([]);
  const [remotePermissions, setRemotePermissions] = useState<CorePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UiRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountTypeFilter>("all");
  const [permissionSearch, setPermissionSearch] = useState("");
  const [permissionGroupFilter, setPermissionGroupFilter] = useState<"all" | (typeof APP_PERMISSION_GROUPS)[number]["key"]>("workspace");
  const [permissionsExpanded, setPermissionsExpanded] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [pendingDeleteAccount, setPendingDeleteAccount] = useState<CoreAccount | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>({
    firebaseUid: "",
    displayName: "",
    email: "",
    phone: "",
    role: "staff",
    status: "active",
  });

  const actorRole = normalizeRole(me?.role || permissionRole || initialRole);
  const actorIsOwner = actorRole === "owner";
  const canReadAccounts = hasAnyPermission(["accounts.read", "admin_accounts.view"]);
  const canCreateAccounts = hasAnyPermission(["accounts.create", "admin_accounts.manage"]);
  const canUpdateAccounts = hasAnyPermission(["accounts.update", "admin_accounts.manage"]);
  const canDisableAccounts = hasPermission("accounts.disable") || hasPermission("admin_accounts.manage");
  const canRestoreAccounts = hasPermission("accounts.restore") || hasPermission("admin_accounts.manage");
  const canDeleteAccounts = hasPermission("accounts.delete");
  const canManagePermissions = hasPermission("permissions.manage");
  const canReadPermissions = hasAnyPermission(["permissions.read", "permissions.manage"]);
  const canManageLinks = hasPermission("employee_links.manage");
  const canResetPassword = hasPermission("accounts.reset_password") || hasPermission("admin_accounts.manage");

  async function loadAccounts() {
    if (!canReadAccounts && authReady === false) return;
    setLoading(true);
    setError("");
    try {
      const [mePayload, accountRows, roleRows, permissionRows] = await Promise.all([
        CoreAccountService.me(),
        CoreAccountService.list(true, "internal"),
        CoreAccountService.roles().catch(() => FALLBACK_ROLES),
        CoreAccountService.permissions().catch(() => []),
      ]);
      setMe(mePayload.user);
      setAccounts(accountRows);
      setRoles(roleRows.length ? roleRows : FALLBACK_ROLES);
      setRemotePermissions(permissionRows);
      setSelectedId((current) => current || accountRows[0]?.id || "");
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccounts();
    // PermissionContext changes after /api/auth/me; reload when it does.
  }, [authReady, canReadAccounts]);

  const roleOptions = useMemo(() => {
    const source = roles.length ? roles : FALLBACK_ROLES;
    return source
      .filter((role) => role.assignable !== 0 && !["guest", "client"].includes(role.role_key))
      .sort((a, b) => Number(b.rank || 0) - Number(a.rank || 0));
  }, [roles]);

  const filteredAccounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return accounts.filter((account) => {
      const role = normalizeRole(account.role || account.primaryRole);
      if (roleFilter !== "all" && role !== roleFilter) return false;
      if (accountTypeFilter === "administrative" && !isAdministrativeRole(role)) return false;
      if (accountTypeFilter === "operational" && !isOperationalRole(role)) return false;
      if (statusFilter === "all" && account.status === "deleted") return false;
      if (statusFilter === "all" && account.status === "deleted") return false;
if (statusFilter === "all" && account.status === "deleted") return false;
if (statusFilter !== "all" && account.status !== statusFilter) return false; const linked = Boolean(account.employeeLink?.employeeId);
      if (linkFilter === "linked" && !linked) return false;
      if (linkFilter === "unlinked" && linked) return false;
      if (!needle) return true;
      return [
        account.displayName,
        account.email,
        account.phone,
        account.firebaseUid,
        account.uid,
        account.employeeLink?.employeeId || "",
        account.employeeLink?.employee?.name || "",
      ].some((value) => cleanText(value).toLowerCase().includes(needle));
    });
  }, [accountTypeFilter, accounts, linkFilter, roleFilter, search, statusFilter]);

  useEffect(() => {
    if (!filteredAccounts.length) {
      setSelectedId("");
      return;
    }
    if (!filteredAccounts.some((account) => account.id === selectedId)) {
      setSelectedId(filteredAccounts[0]?.id || "");
    }
  }, [filteredAccounts, selectedId]);

  const selected = accounts.find((account) => account.id === selectedId) || filteredAccounts[0] || null;
  const effectivePermissions = normalizeAppPermissions(selected?.effectivePermissions || selected?.permissions || []);
  const allowedPermissions = normalizeAppPermissions(selected?.allowedPermissions || []);
  const deniedPermissions = normalizeAppPermissions(selected?.deniedPermissions || []);
  const rolePermissions = normalizeAppPermissions(selected?.rolePermissions || []);

  const permissionRows = useMemo(() => {
    const visibleKeys = new Set(VISIBLE_APP_PERMISSION_CATALOG.map((item) => item.key));
    const extraKeys = [
      ...effectivePermissions,
      ...allowedPermissions,
      ...deniedPermissions,
      ...rolePermissions,
    ].filter((permission) => !visibleKeys.has(permission));
    const uniqueExtra = Array.from(new Set(extraKeys));
    return [
      ...VISIBLE_APP_PERMISSION_CATALOG.map((item) => item.key),
      ...uniqueExtra,
    ].filter((permission) => {
      const needle = permissionSearch.trim().toLowerCase();
      if (!needle) return true;
      return [
        permission,
        permissionLabel(permission, remotePermissions),
        permissionHint(permission, remotePermissions),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [allowedPermissions, deniedPermissions, effectivePermissions, permissionSearch, remotePermissions, rolePermissions]);

  const permissionGroups = useMemo(() => {
    return APP_PERMISSION_GROUPS.map((group) => ({
      ...group,
      permissions: permissionRows.filter((permission) => permissionGroup(permission, remotePermissions) === group.key),
    })).filter((group) => {
      if (!permissionSearch.trim() && permissionGroupFilter !== "all" && group.key !== permissionGroupFilter) return false;
      return group.permissions.length > 0;
    });
  }, [permissionGroupFilter, permissionRows, permissionSearch, remotePermissions]);

  const stats = useMemo(() => {
    const total = accounts.length;
    const active = accounts.filter((account) => account.status === "active").length;
    const pending = accounts.filter((account) => account.status === "pending").length;
    const disabled = accounts.filter((account) => account.status === "disabled").length;
    const deleted = accounts.filter((account) => account.status === "deleted").length;
    const linked = accounts.filter((account) => account.employeeLink?.employeeId).length;
    const unlinked = accounts.filter((account) => !account.employeeLink?.employeeId).length;
    const administrative = accounts.filter((account) => isAdministrativeRole(account.role || account.primaryRole)).length;
    const operational = accounts.filter((account) => isOperationalRole(account.role || account.primaryRole)).length;
    return { total, active, pending, disabled, deleted, linked, unlinked, administrative, operational };
  }, [accounts]);

  function canEditTarget(account: CoreAccount | null) {
    if (!account || !canUpdateAccounts) return false;
    if (normalizeRole(account.role || account.primaryRole) === "owner" && !actorIsOwner) return false;
    return true;
  }

  function openEdit(account: CoreAccount) {
    setError("");
    setMessage("");
    setEditDraft({
      id: account.id,
      firebaseUid: account.firebaseUid || account.uid || "",
      displayName: account.displayName || "",
      email: account.email || "",
      phone: account.phone || "",
      role: normalizeRole(account.role || account.primaryRole),
      status: account.status,
      permissions: normalizeAppPermissions(account.effectivePermissions || account.permissions || []),
      employeeId: account.employeeLink?.employeeId || "",
    });
  }

  async function refreshSelected(id: string) {
    const updated = await CoreAccountService.get(id);
    setAccounts((current) => current.map((account) => (account.id === id ? updated : account)));
    setSelectedId(id);
    return updated;
  }

  async function handleCreate() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (createDraft.status === "active" && !createDraft.firebaseUid.trim()) {
        throw new Error("الحساب النشط يحتاج Firebase UID صحيح.");
      }
      const created = await CoreAccountService.create({
        firebaseUid: createDraft.firebaseUid,
        displayName: createDraft.displayName,
        email: createDraft.email,
        phone: createDraft.phone,
        role: createDraft.role,
        status: createDraft.status,
      });
      setAccounts((current) => [created, ...current]);
      setSelectedId(created.id);
      setCreateOpen(false);
      setCreateDraft({ firebaseUid: "", displayName: "", email: "", phone: "", role: "staff", status: "active" });
      setMessage("تم إنشاء سجل الحساب في D1.");
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit() {
    if (!editDraft) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await CoreAccountService.update(editDraft.id, {
        firebaseUid: editDraft.firebaseUid,
        displayName: editDraft.displayName,
        email: editDraft.email,
        phone: editDraft.phone,
        role: editDraft.role,
        status: editDraft.status,
      });
      if (canManagePermissions) {
        await CoreAccountService.replacePermissions(editDraft.id, editDraft.permissions);
      }
      if (canManageLinks) {
        const before = accounts.find((account) => account.id === editDraft.id)?.employeeLink?.employeeId || "";
        const after = editDraft.employeeId.trim();
        if (after && after !== before) await CoreAccountService.linkEmployee(editDraft.id, after);
        if (!after && before) await CoreAccountService.unlinkEmployee(editDraft.id);
      }
      await refreshSelected(editDraft.id);
      setEditDraft(null);
      setMessage("تم حفظ الحساب والصلاحيات في D1.");
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function runAccountAction(action: "disable" | "restore" | "delete" | "reset", account: CoreAccount) {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (action === "disable") await CoreAccountService.disable(account.id);
      if (action === "restore") await CoreAccountService.restore(account.id);
      if (action === "delete") await CoreAccountService.remove(account.id);
      if (action === "reset") await CoreAccountService.resetPassword(account.id);
      const updated = action === "delete" ? await CoreAccountService.get(account.id) : await refreshSelected(account.id);
      if (action === "delete") setAccounts((current) => current.map((item) => (item.id === account.id ? updated : item)));
      setMessage(
        action === "reset"
          ? "تم إرسال رابط إعادة كلمة المرور عبر Firebase بعد تحقق D1."
          : "تم تنفيذ العملية وتسجيلها في D1."
      );
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setSaving(false);
    }
  }

  const renderPermissionChip = (permission: AppPermission, tone = "soft") => {
    const toneClass =
      tone === "mint"
        ? "dsv2-badge--success"
        : tone === "gray"
          ? "dsv2-badge--danger"
          : "";

    return (
      <span key={permission} className={`dsv2-badge ${toneClass}`}>
        {permissionLabel(permission, remotePermissions)}
      </span>
    );
  };

  if (loading || authReady === false) {
    return (
      <main className="dsv2-page dsv2-stack dsv2-stack--lg">
        <section className="dsv2-card dsv2-card--padded">
          <div className="dsv2-stack">
            <DashboardSkeletonV2 variant="title" width="34%" />
            <DashboardSkeletonV2 lines={3} width="100%" />
          </div>
        </section>

        <div className="dsv2-grid--metrics">
          <DashboardSkeletonV2 variant="block" height={132} />
          <DashboardSkeletonV2 variant="block" height={132} />
          <DashboardSkeletonV2 variant="block" height={132} />
          <DashboardSkeletonV2 variant="block" height={132} />
        </div>
      </main>
    );
  }

  if (!canReadAccounts) {
    return (
      <main className="dsv2-page">
        <DashboardEmptyStateV2
          title="ليست لديك صلاحية عرض الحسابات"
          description="تحتاج accounts.read أو admin_accounts.view من Core D1."
          tone="gold"
        />
      </main>
    );
  }

  return (
    <main className="dsv2-page dsv2-stack dsv2-stack--lg" dir="rtl">
      <section className="dsv2-page-head">
        <div>
          <h1 className="dsv2-page-title">{pageTitle}</h1>
          <p className="dsv2-page-subtitle">{pageHint}</p>
        </div>

        <div className="dsv2-cluster">
          <span className="dsv2-badge">Cloudflare D1</span>
          <span className="dsv2-badge dsv2-badge--success">{stats.active} نشط</span>
          <span className="dsv2-badge dsv2-badge--gold">{stats.pending} مراجعة</span>

          {canCreateAccounts ? (
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              onClick={() => setCreateOpen(true)}
            >
              إنشاء حساب D1
            </button>
          ) : null}
        </div>
      </section>

      <section className="dsv2-grid--metrics" aria-label="ملخص الحسابات">
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z" />
            </svg>
          </span>
          <p className="dsv2-metric-card__label">إجمالي الحسابات</p>
          <p className="dsv2-metric-card__value">{stats.total}</p>
          <p className="dsv2-metric-card__meta">جميع الحسابات التشغيلية في D1</p>
        </article>

        <article className="dsv2-metric-card dsv2-metric-card--success">
          <span className="dsv2-metric-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="m5 12 4 4L19 6" />
            </svg>
          </span>
          <p className="dsv2-metric-card__label">الحسابات النشطة</p>
          <p className="dsv2-metric-card__value">{stats.active}</p>
          <p className="dsv2-metric-card__meta">جاهزة للاستخدام حسب الصلاحيات</p>
        </article>

        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
            </svg>
          </span>
          <p className="dsv2-metric-card__label">قيد المراجعة</p>
          <p className="dsv2-metric-card__value">{stats.pending}</p>
          <p className="dsv2-metric-card__meta">تنتظر استكمال حالة الحساب</p>
        </article>

        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M10 13a5 5 0 0 0 7.07.07l2-2A5 5 0 0 0 12 4l-1.15 1.15M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 12 20l1.15-1.15" />
            </svg>
          </span>
          <p className="dsv2-metric-card__label">مرتبطة بموظفة</p>
          <p className="dsv2-metric-card__value">{stats.linked}</p>
          <p className="dsv2-metric-card__meta">غير مرتبطة: {stats.unlinked}</p>
        </article>
      </section>

      {error ? (
        <DashboardErrorStateV2
          title="تعذر تنفيذ العملية"
          description={error}
          compact
        />
      ) : null}

      {message ? (
        <section className="dsv2-card dsv2-card--padded">
          <div className="dsv2-cluster">
            <span className="dsv2-badge dsv2-badge--success">تم</span>
            <p className="dsv2-section-caption">{message}</p>
          </div>
        </section>
      ) : null}

      <section className="dsv2-filter-bar" aria-label="تصفية الحسابات">
        <DashboardFieldV2 id="accounts-search" label="بحث">
          <input
            id="accounts-search"
            className="dsv2-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="اسم، بريد، UID، موظفة"
          />
        </DashboardFieldV2>

        <DashboardFieldV2 id="accounts-role-filter" label="الدور">
          <DashboardSelectV2
            id="accounts-role-filter"
            value={roleFilter}
            options={[
              { value: "all", label: "كل الأدوار" },
              ...roleOptions.map((role) => ({
                value: role.role_key,
                label: getRoleLabel(role.role_key),
              })),
            ]}
            onChange={(value) => setRoleFilter(value as UiRole | "all")}
          />
        </DashboardFieldV2>

        <DashboardFieldV2 id="accounts-status-filter" label="الحالة">
          <DashboardSelectV2
            id="accounts-status-filter"
            value={statusFilter}
            options={[
              { value: "all", label: "كل الحالات" },
              { value: "active", label: "نشط" },
              { value: "pending", label: "قيد المراجعة" },
              { value: "disabled", label: "معطل" },
              { value: "deleted", label: "محذوف" },
            ]}
            onChange={(value) => setStatusFilter(value as AccountStatusFilter)}
          />
        </DashboardFieldV2>

        <DashboardFieldV2 id="accounts-type-filter" label="نوع الحساب">
          <DashboardSelectV2
            id="accounts-type-filter"
            value={accountTypeFilter}
            options={[
              { value: "all", label: "الكل" },
              { value: "administrative", label: "إداري" },
              { value: "operational", label: "تشغيلي / موظفات" },
            ]}
            onChange={(value) => setAccountTypeFilter(value as AccountTypeFilter)}
          />
        </DashboardFieldV2>

        <DashboardFieldV2 id="accounts-link-filter" label="الربط">
          <DashboardSelectV2
            id="accounts-link-filter"
            value={linkFilter}
            options={[
              { value: "all", label: "الكل" },
              { value: "linked", label: "مرتبط" },
              { value: "unlinked", label: "غير مرتبط" },
            ]}
            onChange={(value) => setLinkFilter(value as LinkFilter)}
          />
        </DashboardFieldV2>
      </section>

      <section className="dsv2-card dsv2-card--padded">
        <div className="dsv2-section-head">
          <div>
            <h2 className="dsv2-section-title">الحسابات</h2>
            <p className="dsv2-section-caption">
              {filteredAccounts.length} حساب مطابق للتصفية الحالية
            </p>
          </div>
          <span className="dsv2-badge">الإجمالي {stats.total}</span>
        </div>

        {filteredAccounts.length ? (
          <div className="dsv2-table-card">
            <div className="dsv2-table-scroll">
              <table className="dsv2-table">
                <thead>
                  <tr>
                    <th>الحساب</th>
                    <th>الدور</th>
                    <th>الحالة</th>
                    <th>الربط الوظيفي</th>
                    <th>الصلاحيات</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredAccounts.map((account) => {
                    const role = normalizeRole(account.role || account.primaryRole);
                    const permissionCount =
                      account.status === "active"
                        ? normalizeAppPermissions(
                          account.effectivePermissions || account.permissions || []
                        ).length
                        : 0;
                    const statusTone =
                      account.status === "active"
                        ? "dsv2-badge--success"
                        : account.status === "pending"
                          ? "dsv2-badge--gold"
                          : account.status === "deleted"
                            ? "dsv2-badge--danger"
                            : "";

                    return (
                      <tr key={account.id}>
                        <td>
                          <strong className="dsv2-table__primary">
                            {account.displayName || account.email || "حساب بدون اسم"}
                          </strong>
                          <span className="dsv2-table__secondary">
                            {account.email || account.firebaseUid || "-"}
                          </span>
                        </td>

                        <td>
                          <span className={`dsv2-badge ${getRoleTone(role)}`}>
                            {getRoleLabel(role)}
                          </span>
                        </td>

                        <td>
                          <span className={`dsv2-badge ${statusTone}`}>
                            {statusLabel(account.status)}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`dsv2-badge ${account.employeeLink?.employeeId ? "dsv2-badge--success" : ""
                              }`}
                          >
                            {account.employeeLink?.employee?.name ||
                              account.employeeLink?.employeeId ||
                              "غير مرتبط"}
                          </span>
                        </td>

                        <td><strong>{permissionCount}</strong></td>

                        <td>
                          <button
                            type="button"
                            className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm"
                            onClick={() => {
                              setSelectedId(account.id);
                              setPermissionsExpanded(true);
                              setPermissionSearch("");
                              setPermissionGroupFilter("workspace");
                              setDetailsOpen(true);
                            }}
                          >
                            عرض التفاصيل
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <DashboardEmptyStateV2
            title="لا توجد حسابات مطابقة"
            description="غيّر التصفية أو أنشئ حساب D1 جديد."
            tone="gold"
            compact
          />
        )}
      </section>

      <DashboardModalV2
        open={detailsOpen && Boolean(selected)}
        onClose={() => setDetailsOpen(false)}
        eyebrow="تفاصيل الحساب"
        title={selected?.displayName || selected?.email || "تفاصيل الحساب"}
        description={
          selected?.email ||
          selected?.firebaseUid ||
          selected?.uid ||
          selected?.id ||
          undefined
        }
        size="lg"
        tone="default"
      >
        {selected ? (
          <div className="dsv2-stack dsv2-stack--lg">
            <div className="dsv2-section-head">
              <div>
                <div className="dsv2-cluster">
                  <span className={`dsv2-badge ${getRoleTone(selected.role || selected.primaryRole)}`}>
                    {getRoleLabel(selected.role || selected.primaryRole)}
                  </span>

                  <span
                    className={`dsv2-badge ${selected.status === "active"
                        ? "dsv2-badge--success"
                        : selected.status === "pending"
                          ? "dsv2-badge--gold"
                          : selected.status === "deleted"
                            ? "dsv2-badge--danger"
                            : ""
                      }`}
                  >
                    {statusLabel(selected.status)}
                  </span>

                  <span className="dsv2-badge">{selected?.status === "active" ? effectivePermissions.length : 0} صلاحية</span>
                </div>

                <h2 className="dsv2-section-title">
                  {selected.displayName || selected.email || "حساب بدون اسم"}
                </h2>
                <p className="dsv2-section-caption">
                  {selected.firebaseUid || selected.uid || selected.id}
                </p>
              </div>

              <div className="dsv2-cluster">
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary"
                  onClick={() => setPermissionsExpanded((current) => !current)}
                >
                  {permissionsExpanded ? "إخفاء الصلاحيات" : "عرض الصلاحيات"}
                </button>

                {canEditTarget(selected) ? (
                  <button
                    type="button"
                    className="dsv2-btn dsv2-btn--primary"
                    onClick={() => {
                      setDetailsOpen(false);
                      openEdit(selected);
                    }}
                  >
                    تعديل الحساب
                  </button>
                ) : null}
              </div>
            </div>

            <div className="dsv2-grid--2">
              <div className="dsv2-stat-row">
                <span>البريد</span>
                <strong>{selected.email || "-"}</strong>
              </div>
              <div className="dsv2-stat-row">
                <span>الجوال</span>
                <strong>{selected.phone || "-"}</strong>
              </div>
              <div className="dsv2-stat-row">
                <span>آخر دخول</span>
                <strong>{formatDate(selected.lastLoginAt)}</strong>
              </div>
              <div className="dsv2-stat-row">
                <span>ملف الموظفة</span>
                <strong>
                  {selected.employeeLink?.employee?.name ||
                    selected.employeeLink?.employeeId ||
                    "غير مرتبط"}
                </strong>
              </div>
            </div>

            {canReadPermissions && permissionsExpanded ? (
              <div className="dsv2-stack dsv2-stack--lg">
                <div className="dsv2-grid--3">
                  <article className="dsv2-card dsv2-card--padded dsv2-card--soft">
                    <h3 className="dsv2-section-title">صلاحيات الدور</h3>
                    <p className="dsv2-section-caption">الصلاحيات الموروثة من الدور الأساسي.</p>
                    <div className="dsv2-cluster">
                      {rolePermissions.slice(0, 18).map((permission) => renderPermissionChip(permission))}
                      {rolePermissions.length > 18 ? (
                        <span className="dsv2-badge">+{rolePermissions.length - 18}</span>
                      ) : null}
                    </div>
                  </article>

                  <article className="dsv2-card dsv2-card--padded dsv2-card--soft">
                    <h3 className="dsv2-section-title">مسموح مباشر</h3>
                    <p className="dsv2-section-caption">صلاحيات مضافة مباشرة إلى الحساب.</p>
                    <div className="dsv2-cluster">
                      {allowedPermissions.length
                        ? allowedPermissions.map((permission) => renderPermissionChip(permission, "mint"))
                        : <span className="dsv2-badge">لا يوجد</span>}
                    </div>
                  </article>

                  <article className="dsv2-card dsv2-card--padded dsv2-card--soft">
                    <h3 className="dsv2-section-title">ممنوع مباشر</h3>
                    <p className="dsv2-section-caption">المنع المباشر يسبق السماح.</p>
                    <div className="dsv2-cluster">
                      {deniedPermissions.length
                        ? deniedPermissions.map((permission) => renderPermissionChip(permission, "gray"))
                        : <span className="dsv2-badge">لا يوجد</span>}
                    </div>
                  </article>
                </div>

                <section className="dsv2-filter-bar">
                  <DashboardFieldV2 id="permission-search" label="بحث داخل الصلاحيات">
                    <input
                      id="permission-search"
                      className="dsv2-input"
                      value={permissionSearch}
                      onChange={(event) => setPermissionSearch(event.target.value)}
                      placeholder="accounts.update أو الحجوزات"
                    />
                  </DashboardFieldV2>

                  <DashboardFieldV2 id="permission-group-filter" label="قسم الصلاحيات">
                    <DashboardSelectV2
                      id="permission-group-filter"
                      value={permissionGroupFilter}
                      options={[
                        ...APP_PERMISSION_GROUPS.map((group) => ({
                          value: group.key,
                          label: group.label,
                        })),
                      ]}
                      onChange={(value) =>
                        setPermissionGroupFilter(value as typeof permissionGroupFilter)
                      }
                    />
                  </DashboardFieldV2>
                </section>

                <div className="dsv2-stack">
                  {permissionGroups.map((group) => (
                    <article key={group.key} className="dsv2-card dsv2-card--padded">
                      <div className="dsv2-section-head">
                        <div>
                          <h3 className="dsv2-section-title">{group.label}</h3>
                          <p className="dsv2-section-caption">{group.permissions.length} صلاحية</p>
                        </div>
                      </div>

                      <div className="dsv2-grid--2">
                        {group.permissions.map((permission) => {
                          const enabled = effectivePermissions.includes(permission);
                          const directAllow = allowedPermissions.includes(permission);
                          const directDeny = deniedPermissions.includes(permission);

                          return (
                            <div key={permission} className="dsv2-stat-row">
                              <div className="dsv2-stack dsv2-stack--sm">
                                <strong>{permissionLabel(permission, remotePermissions)}</strong>
                              </div>

                              <span
                                className={`dsv2-badge ${enabled
                                    ? "dsv2-badge--success"
                                    : "dsv2-badge--danger"
                                  }`}
                              >
                                {enabled ? "مفعل" : "غير مفعل"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="dsv2-cluster">
              {canDisableAccounts && selected.status === "active" ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger"
                  disabled={saving}
                  onClick={() => void runAccountAction("disable", selected)}
                >
                  تعطيل
                </button>
              ) : null}

              {canRestoreAccounts && ["disabled", "deleted"].includes(selected.status) ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--success"
                  disabled={saving}
                  onClick={() => void runAccountAction("restore", selected)}
                >
                  استعادة
                </button>
              ) : null}

              {canDeleteAccounts && selected.status !== "deleted" ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger"
                  disabled={saving}
                  onClick={() => setPendingDeleteAccount(selected)}
                >
                  حذف منطقي
                </button>
              ) : null}

              {canResetPassword ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--secondary"
                  disabled={saving || !selected.email}
                  onClick={() => void runAccountAction("reset", selected)}
                >
                  إرسال رابط كلمة المرور
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <></>
        )}
      </DashboardModalV2>
      <DashboardModalV2
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        eyebrow="D1 app_users"
        title="إنشاء سجل حساب"
        description="ينشئ سجلاً تشغيلياً في D1. Firebase يبقى مسؤولاً عن تسجيل الدخول وكلمة المرور."
        size="lg"
        tone="gold"
        footer={
          <>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--primary"
              disabled={saving}
              onClick={() => void handleCreate()}
            >
              حفظ في D1
            </button>
            <button
              type="button"
              className="dsv2-btn dsv2-btn--secondary"
              disabled={saving}
              onClick={() => setCreateOpen(false)}
            >
              إلغاء
            </button>
          </>
        }
      >
        <div className="dsv2-grid--2">
          <DashboardFieldV2 id="create-firebase-uid" label="Firebase UID">
            <input
              id="create-firebase-uid"
              className="dsv2-input"
              value={createDraft.firebaseUid}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, firebaseUid: event.target.value }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="create-name" label="الاسم">
            <input
              id="create-name"
              className="dsv2-input"
              value={createDraft.displayName}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, displayName: event.target.value }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="create-email" label="البريد">
            <input
              id="create-email"
              type="email"
              className="dsv2-input"
              value={createDraft.email}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, email: event.target.value }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="create-phone" label="الجوال">
            <input
              id="create-phone"
              className="dsv2-input"
              value={createDraft.phone}
              onChange={(event) =>
                setCreateDraft((draft) => ({ ...draft, phone: event.target.value }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="create-role" label="الدور">
            <DashboardSelectV2
              id="create-role"
              value={createDraft.role}
              options={roleOptions.map((role) => ({
                value: role.role_key,
                label: getRoleLabel(role.role_key),
              }))}
              onChange={(value) =>
                setCreateDraft((draft) => ({ ...draft, role: normalizeRole(value) }))
              }
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="create-status" label="الحالة">
            <DashboardSelectV2
              id="create-status"
              value={createDraft.status}
              options={[
                { value: "active", label: "نشط" },
                { value: "pending", label: "قيد المراجعة" },
              ]}
              onChange={(value) =>
                setCreateDraft((draft) => ({
                  ...draft,
                  status: value as CreateDraft["status"],
                }))
              }
            />
          </DashboardFieldV2>
        </div>
      </DashboardModalV2>

      <DashboardModalV2
        open={Boolean(editDraft)}
        onClose={() => setEditDraft(null)}
        eyebrow="تعديل الحساب"
        title={editDraft?.displayName || editDraft?.email || "تعديل الحساب"}
        description="تعديل البيانات والدور والربط والصلاحيات الفعلية."
        size="xl"
        tone="default"
        footer={
          editDraft ? (
            <>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--primary"
                disabled={saving}
                onClick={() => void handleSaveEdit()}
              >
                حفظ التعديلات
              </button>
              <button
                type="button"
                className="dsv2-btn dsv2-btn--secondary"
                disabled={saving}
                onClick={() => setEditDraft(null)}
              >
                إلغاء
              </button>
            </>
          ) : null
        }
      >
        {editDraft ? (
          <div className="dsv2-stack dsv2-stack--lg">
            <div className="dsv2-grid--2">
              <DashboardFieldV2 id="edit-firebase-uid" label="Firebase UID">
                <input
                  id="edit-firebase-uid"
                  className="dsv2-input"
                  value={editDraft.firebaseUid}
                  onChange={(event) =>
                    setEditDraft((draft) =>
                      draft ? { ...draft, firebaseUid: event.target.value } : draft
                    )
                  }
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="edit-name" label="الاسم">
                <input
                  id="edit-name"
                  className="dsv2-input"
                  value={editDraft.displayName}
                  onChange={(event) =>
                    setEditDraft((draft) =>
                      draft ? { ...draft, displayName: event.target.value } : draft
                    )
                  }
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="edit-email" label="البريد">
                <input
                  id="edit-email"
                  type="email"
                  className="dsv2-input"
                  value={editDraft.email}
                  onChange={(event) =>
                    setEditDraft((draft) =>
                      draft ? { ...draft, email: event.target.value } : draft
                    )
                  }
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="edit-phone" label="الجوال">
                <input
                  id="edit-phone"
                  className="dsv2-input"
                  value={editDraft.phone}
                  onChange={(event) =>
                    setEditDraft((draft) =>
                      draft ? { ...draft, phone: event.target.value } : draft
                    )
                  }
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="edit-role" label="الدور">
                <DashboardSelectV2
                  id="edit-role"
                  value={editDraft.role}
                  options={roleOptions.map((role) => ({
                    value: role.role_key,
                    label: getRoleLabel(role.role_key),
                  }))}
                  onChange={(value) =>
                    setEditDraft((draft) =>
                      draft ? { ...draft, role: normalizeRole(value) } : draft
                    )
                  }
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="edit-status" label="الحالة">
                <DashboardSelectV2
                  id="edit-status"
                  value={editDraft.status}
                  options={[
                    { value: "active", label: "نشط" },
                    { value: "pending", label: "قيد المراجعة" },
                    { value: "disabled", label: "معطل" },
                    { value: "deleted", label: "محذوف" },
                  ]}
                  onChange={(value) =>
                    setEditDraft((draft) =>
                      draft
                        ? { ...draft, status: value as CoreAccount["status"] }
                        : draft
                    )
                  }
                />
              </DashboardFieldV2>

              <DashboardFieldV2 id="edit-employee-link" label="معرف الموظفة المرتبطة">
                <input
                  id="edit-employee-link"
                  className="dsv2-input"
                  value={editDraft.employeeId}
                  disabled={!canManageLinks}
                  onChange={(event) =>
                    setEditDraft((draft) =>
                      draft ? { ...draft, employeeId: event.target.value } : draft
                    )
                  }
                />
              </DashboardFieldV2>
            </div>

            <section>
              <div className="dsv2-section-head">
                <div>
                  <h3 className="dsv2-section-title">الصلاحيات الفعلية</h3>
                  <p className="dsv2-section-caption">
                    Worker يحول القائمة إلى allow/deny حسب الدور المحدد.
                  </p>
                </div>

                <div className="dsv2-cluster">
                  <span className="dsv2-badge">المحددة {editDraft.permissions.length}</span>
                  <span className="dsv2-badge">صلاحيات المنفذ {actorPermissions.length}</span>
                </div>
              </div>

              {!canManagePermissions ? (
                <DashboardEmptyStateV2
                  title="تعديل الصلاحيات غير متاح"
                  description="تعديل الصلاحيات يتطلب permissions.manage."
                  compact
                />
              ) : null}

              <div className="dsv2-grid--2">
                {VISIBLE_APP_PERMISSION_CATALOG.map((permission) => {
                  const enabled = editDraft.permissions.includes(permission.key);
                  const actorCanGrant =
                    actorIsOwner || actorPermissions.includes(permission.key);

                  return (
                    <article key={permission.key} className="dsv2-card dsv2-card--padded">
                      <div className="dsv2-section-head">
                        <div>
                          <h4 className="dsv2-section-title">{permission.label}</h4>
                          <p className="dsv2-section-caption">{permission.key}</p>
                        </div>

                        {permission.sensitive ? (
                          <span className="dsv2-badge dsv2-badge--danger">حساسة</span>
                        ) : null}
                      </div>

                      <p className="dsv2-section-caption">{permission.hint}</p>

                      <button
                        type="button"
                        className={
                          enabled
                            ? "dsv2-btn dsv2-btn--success dsv2-btn--block"
                            : "dsv2-btn dsv2-btn--secondary dsv2-btn--block"
                        }
                        aria-pressed={enabled}
                        disabled={!canManagePermissions || (!actorCanGrant && !enabled)}
                        onClick={() => {
                          setEditDraft((draft) => {
                            if (!draft) return draft;

                            const set = new Set(draft.permissions);
                            if (set.has(permission.key)) set.delete(permission.key);
                            else set.add(permission.key);

                            return {
                              ...draft,
                              permissions: VISIBLE_APP_PERMISSION_CATALOG
                                .map((item) => item.key)
                                .filter((key) => set.has(key)),
                            };
                          });
                        }}
                      >
                        {enabled ? "مفعل" : "غير مفعل"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          <></>
        )}
      </DashboardModalV2>

      <DashboardConfirmV2
        open={Boolean(pendingDeleteAccount)}
        onClose={() => setPendingDeleteAccount(null)}
        title="حذف الحساب منطقياً"
        description="سيتم تغيير حالة الحساب في D1 بدون حذف سجل الهوية من Firebase."
        tone="danger"
        confirmLabel="حذف منطقي"
        cancelLabel="تراجع"
        onConfirm={async () => {
          const account = pendingDeleteAccount;
          if (!account) return;

          await runAccountAction("delete", account);
          setPendingDeleteAccount(null);
        }}
      >
        {pendingDeleteAccount ? (
          <span>
            {pendingDeleteAccount.displayName ||
              pendingDeleteAccount.email ||
              pendingDeleteAccount.id}
          </span>
        ) : null}
      </DashboardConfirmV2>
    </main>
  );
}



