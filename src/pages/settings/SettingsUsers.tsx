// src/pages/settings/SettingsUsers.tsx
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";

import EmployeeAvatar from "../../components/EmployeeAvatar";
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
import { SettingsPageHeader, SettingsState } from "./SettingsFrame";

type UiRole = UserRole;
type AccountStatusFilter = "all" | "active" | "disabled" | "pending" | "deleted";
type LinkFilter = "all" | "linked" | "unlinked";

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
  owner: "gold",
  admin: "amber",
  hr: "mint",
  accountant: "blue",
  reception: "blue",
  staff: "slate",
  pending: "gray",
  client: "gray",
  guest: "gray",
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
  const isAdminShell = location.pathname.startsWith("/admin");
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
  const [permissionSearch, setPermissionSearch] = useState("");
  const [permissionsExpanded, setPermissionsExpanded] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
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
        CoreAccountService.list(true),
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
      if (statusFilter !== "all" && account.status !== statusFilter) return false;
      const linked = Boolean(account.employeeLink?.employeeId);
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
  }, [accounts, linkFilter, roleFilter, search, statusFilter]);

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
    })).filter((group) => group.permissions.length > 0);
  }, [permissionRows, remotePermissions]);

  const stats = useMemo(() => {
    const active = accounts.filter((account) => account.status === "active").length;
    const pending = accounts.filter((account) => account.status === "pending").length;
    const linked = accounts.filter((account) => account.employeeLink?.employeeId).length;
    return { active, pending, linked };
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
      if (action === "delete") {
        if (!window.confirm("سيتم حذف الحساب منطقياً من D1. هل تريد المتابعة؟")) return;
        await CoreAccountService.remove(account.id);
      }
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

  const renderPermissionChip = (permission: AppPermission, tone = "soft") => (
    <span key={permission} className={`accounts-permission-preview__chip accounts-chip--${tone}`}>
      {permissionLabel(permission, remotePermissions)}
    </span>
  );

  if (loading || authReady === false) {
    return (
      <div className="accounts-page accounts-page--settings">
        <div className="accounts-shell accounts-shell--loading">
          <SettingsState title="جاري تحميل الحسابات..." loading />
        </div>
      </div>
    );
  }

  if (!canReadAccounts) {
    return (
      <div className="accounts-page accounts-page--settings">
        <div className="accounts-shell">
          <SettingsState
            title="ليست لديك صلاحية عرض الحسابات"
            hint="تحتاج accounts.read أو admin_accounts.view من Core D1."
            className="accounts-state--blocked"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="accounts-page accounts-page--settings" dir="rtl">
      <div className="accounts-shell">
        <SettingsPageHeader
          eyebrow="Cloudflare D1"
          title={pageTitle}
          hint={pageHint}
          badges={
            <>
              <span className="accounts-chip accounts-chip--mint">نشطة: {stats.active}</span>
              <span className="accounts-chip accounts-chip--amber">مراجعة: {stats.pending}</span>
              <span className="accounts-chip accounts-chip--blue">مرتبطة: {stats.linked}</span>
            </>
          }
          actions={
            canCreateAccounts ? (
              <button type="button" className="accounts-btn accounts-btn--primary" onClick={() => setCreateOpen(true)}>
                إنشاء حساب D1
              </button>
            ) : null
          }
        />

        {(message || error) ? (
          <div className={`accounts-banner ${error ? "accounts-banner--danger" : ""}`}>
            {error || message}
          </div>
        ) : null}

        <section className="accounts-toolbar" aria-label="تصفية الحسابات">
          <div className="accounts-toolbar__row">
            <label className="accounts-search">
              <span>بحث</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اسم، بريد، UID، موظفة" />
            </label>
            <label className="accounts-filter">
              <span>الدور</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as UiRole | "all")}>
                <option value="all">كل الأدوار</option>
                {roleOptions.map((role) => (
                  <option key={role.role_key} value={role.role_key}>
                    {getRoleLabel(role.role_key)}
                  </option>
                ))}
              </select>
            </label>
            <label className="accounts-filter">
              <span>الحالة</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AccountStatusFilter)}>
                <option value="all">كل الحالات</option>
                <option value="active">نشط</option>
                <option value="pending">قيد المراجعة</option>
                <option value="disabled">معطل</option>
                <option value="deleted">محذوف</option>
              </select>
            </label>
            <label className="accounts-filter">
              <span>الربط</span>
              <select value={linkFilter} onChange={(event) => setLinkFilter(event.target.value as LinkFilter)}>
                <option value="all">الكل</option>
                <option value="linked">مرتبط</option>
                <option value="unlinked">غير مرتبط</option>
              </select>
            </label>
          </div>
        </section>

        <div className="accounts-workspace">
          <section className="accounts-panel accounts-panel--list">
            <div className="accounts-panel__head">
              <div>
                <span className="accounts-kicker">الحسابات</span>
                <h2>{filteredAccounts.length} حساب</h2>
              </div>
            </div>

            <div className="accounts-list accounts-directory">
              {filteredAccounts.map((account) => {
                const selectedRow = selected?.id === account.id;
                const role = normalizeRole(account.role || account.primaryRole);
                const permissionCount = normalizeAppPermissions(account.effectivePermissions || account.permissions || []).length;
                return (
                  <button
                    type="button"
                    key={account.id}
                    className={`accounts-card ${selectedRow ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelectedId(account.id);
                      setPermissionsExpanded(true);
                    }}
                  >
                    <span className="accounts-card__aside">
                      <EmployeeAvatar name={account.displayName || account.email} className="accounts-card__avatar" />
                    </span>
                    <span className="accounts-card__body">
                      <span className="accounts-card__top">
                        <strong>{account.displayName || account.email || "حساب بدون اسم"}</strong>
                        <span>{account.email || account.firebaseUid || "-"}</span>
                      </span>
                      <span className="accounts-card__badgeStack">
                        <span className={`accounts-chip accounts-chip--${getRoleTone(role)}`}>{getRoleLabel(role)}</span>
                        <span className={`accounts-chip accounts-chip--state accounts-chip--${account.status === "active" ? "active" : account.status}`}>
                          {statusLabel(account.status)}
                        </span>
                        <span className="accounts-chip accounts-chip--soft">{account.employeeLink?.employeeId ? "مرتبط" : "غير مرتبط"}</span>
                      </span>
                    </span>
                    <span className="accounts-card__metric">
                      <span>الصلاحيات</span>
                      <strong>{permissionCount}</strong>
                    </span>
                  </button>
                );
              })}
              {!filteredAccounts.length ? (
                <div className="accounts-empty-state">
                  <strong>لا توجد حسابات مطابقة.</strong>
                  <p>غيّر التصفية أو أنشئ سجل حساب D1 جديد.</p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="accounts-panel accounts-panel--detail">
            {selected ? (
              <>
                <div className="accounts-profile">
                  <EmployeeAvatar name={selected.displayName || selected.email} className="accounts-avatar" loading="eager" />
                  <div className="accounts-profile__copy">
                    <span className="accounts-kicker">{selected.firebaseUid || selected.uid || selected.id}</span>
                    <h2>{selected.displayName || selected.email || "حساب بدون اسم"}</h2>
                    <div className="accounts-inline-tags">
                      <span className={`accounts-chip accounts-chip--${getRoleTone(selected.role)}`}>{getRoleLabel(selected.role)}</span>
                      <span className={`accounts-chip accounts-chip--state accounts-chip--${selected.status === "active" ? "active" : selected.status}`}>
                        {statusLabel(selected.status)}
                      </span>
                      <button type="button" className="accounts-chip accounts-chip--soft" onClick={() => setPermissionsExpanded(true)}>
                        {effectivePermissions.length} صلاحية
                      </button>
                    </div>
                  </div>
                </div>

                <div className="accounts-meta-grid">
                  <div className="accounts-meta-card">
                    <span>البريد</span>
                    <strong>{selected.email || "-"}</strong>
                  </div>
                  <div className="accounts-meta-card">
                    <span>الجوال</span>
                    <strong>{selected.phone || "-"}</strong>
                  </div>
                  <div className="accounts-meta-card">
                    <span>آخر دخول</span>
                    <strong>{formatDate(selected.lastLoginAt)}</strong>
                  </div>
                  <div className="accounts-meta-card">
                    <span>ملف الموظفة</span>
                    <strong>{selected.employeeLink?.employee?.name || selected.employeeLink?.employeeId || "غير مرتبط"}</strong>
                  </div>
                </div>

                <section className="accounts-permissions">
                  <div className="accounts-permissions__head">
                    <div>
                      <span>الأدوار والصلاحيات</span>
                      <small>الدور الافتراضي + المسموح المباشر - الممنوع المباشر. المنع المباشر يسبق السماح.</small>
                    </div>
                    <div className="accounts-actions">
                      <button type="button" className="accounts-btn accounts-btn--ghost" onClick={() => setPermissionsExpanded((current) => !current)}>
                        {permissionsExpanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}
                      </button>
                      {canEditTarget(selected) ? (
                        <button type="button" className="accounts-btn accounts-btn--primary" onClick={() => openEdit(selected)}>
                          تعديل
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {permissionsExpanded ? (
                    <>
                      <div className="accounts-permission-preview">
                        <span>صلاحيات الدور</span>
                        <div className="accounts-permission-preview__chips">
                          {rolePermissions.slice(0, 18).map((permission) => renderPermissionChip(permission))}
                          {rolePermissions.length > 18 ? <span className="accounts-permission-preview__empty">+{rolePermissions.length - 18}</span> : null}
                        </div>
                      </div>
                      <div className="accounts-permission-preview">
                        <span>مسموح مباشر</span>
                        <div className="accounts-permission-preview__chips">
                          {allowedPermissions.length ? allowedPermissions.map((permission) => renderPermissionChip(permission, "mint")) : <span className="accounts-permission-preview__empty">لا يوجد</span>}
                        </div>
                      </div>
                      <div className="accounts-permission-preview">
                        <span>ممنوع مباشر</span>
                        <div className="accounts-permission-preview__chips">
                          {deniedPermissions.length ? deniedPermissions.map((permission) => renderPermissionChip(permission, "gray")) : <span className="accounts-permission-preview__empty">لا يوجد</span>}
                        </div>
                      </div>
                      <label className="accounts-search">
                        <span>بحث داخل الصلاحيات</span>
                        <input value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} placeholder="accounts.update أو الحجوزات" />
                      </label>
                      <div className="accounts-permissions__grid">
                        {permissionGroups.map((group) => (
                          <section key={group.key} className="accounts-permission-group">
                            <div className="accounts-permission-group__head">
                              <strong>{group.label}</strong>
                              <span>{group.permissions.length}</span>
                            </div>
                            <div className="accounts-permissions-editor__grid">
                              {group.permissions.map((permission) => {
                                const enabled = effectivePermissions.includes(permission);
                                const directAllow = allowedPermissions.includes(permission);
                                const directDeny = deniedPermissions.includes(permission);
                                return (
                                  <div
                                    key={permission}
                                    className={`accounts-permission-toggle ${enabled ? "is-active" : ""} ${directDeny ? "is-denied" : ""}`}
                                  >
                                    <span className="accounts-permission-toggle__dot" aria-hidden="true" />
                                    <span className="accounts-permission-toggle__copy">
                                      <strong>{permissionLabel(permission, remotePermissions)}</strong>
                                      <small>{permission}</small>
                                      <em>{directDeny ? "ممنوع مباشر" : directAllow ? "مسموح مباشر" : permissionHint(permission, remotePermissions)}</em>
                                    </span>
                                    <span className="accounts-permission-toggle__state">{enabled ? "مفعل" : "غير مفعل"}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </div>
                    </>
                  ) : null}
                </section>

                <div className="accounts-actions">
                  {canDisableAccounts && selected.status === "active" ? (
                    <button type="button" className="accounts-btn accounts-btn--danger" disabled={saving} onClick={() => void runAccountAction("disable", selected)}>
                      تعطيل
                    </button>
                  ) : null}
                  {canRestoreAccounts && ["disabled", "deleted"].includes(selected.status) ? (
                    <button type="button" className="accounts-btn accounts-btn--primary" disabled={saving} onClick={() => void runAccountAction("restore", selected)}>
                      استعادة
                    </button>
                  ) : null}
                  {canDeleteAccounts && selected.status !== "deleted" ? (
                    <button type="button" className="accounts-btn accounts-btn--danger" disabled={saving} onClick={() => void runAccountAction("delete", selected)}>
                      حذف منطقي
                    </button>
                  ) : null}
                  {canResetPassword ? (
                    <button type="button" className="accounts-btn accounts-btn--ghost" disabled={saving || !selected.email} onClick={() => void runAccountAction("reset", selected)}>
                      إرسال رابط كلمة المرور
                    </button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="accounts-panel--detail-empty">
                <strong>اختر حساباً من القائمة.</strong>
                <p>ستظهر تفاصيل الدور والصلاحيات والربط الوظيفي هنا.</p>
              </div>
            )}
          </section>
        </div>
      </div>

      {createOpen ? (
        <div className="accounts-modal" role="dialog" aria-modal="true">
          <div className="accounts-modal__backdrop" onClick={() => setCreateOpen(false)} />
          <div className="accounts-modal__card">
            <div className="accounts-modal__head">
              <div>
                <span className="accounts-eyebrow">D1 app_users</span>
                <h2>إنشاء سجل حساب</h2>
                <p>ينشئ هذا سجلاً تشغيلياً فقط. Firebase يبقى مسؤولاً عن تسجيل الدخول وإعادة كلمة المرور.</p>
              </div>
              <button type="button" className="accounts-modal__close" onClick={() => setCreateOpen(false)}>×</button>
            </div>
            <div className="accounts-form-grid">
              <label className="accounts-field">
                <span>Firebase UID</span>
                <input value={createDraft.firebaseUid} onChange={(event) => setCreateDraft((draft) => ({ ...draft, firebaseUid: event.target.value }))} />
              </label>
              <label className="accounts-field">
                <span>الاسم</span>
                <input value={createDraft.displayName} onChange={(event) => setCreateDraft((draft) => ({ ...draft, displayName: event.target.value }))} />
              </label>
              <label className="accounts-field">
                <span>البريد</span>
                <input type="email" value={createDraft.email} onChange={(event) => setCreateDraft((draft) => ({ ...draft, email: event.target.value }))} />
              </label>
              <label className="accounts-field">
                <span>الجوال</span>
                <input value={createDraft.phone} onChange={(event) => setCreateDraft((draft) => ({ ...draft, phone: event.target.value }))} />
              </label>
              <label className="accounts-field">
                <span>الدور</span>
                <select value={createDraft.role} onChange={(event) => setCreateDraft((draft) => ({ ...draft, role: normalizeRole(event.target.value) }))}>
                  {roleOptions.map((role) => (
                    <option key={role.role_key} value={role.role_key}>{getRoleLabel(role.role_key)}</option>
                  ))}
                </select>
              </label>
              <label className="accounts-field">
                <span>الحالة</span>
                <select value={createDraft.status} onChange={(event) => setCreateDraft((draft) => ({ ...draft, status: event.target.value as CreateDraft["status"] }))}>
                  <option value="active">نشط</option>
                  <option value="pending">قيد المراجعة</option>
                </select>
              </label>
            </div>
            <div className="accounts-modal__footer">
              <button type="button" className="accounts-btn accounts-btn--ghost" onClick={() => setCreateOpen(false)}>إلغاء</button>
              <button type="button" className="accounts-btn accounts-btn--primary" disabled={saving} onClick={() => void handleCreate()}>حفظ في D1</button>
            </div>
          </div>
        </div>
      ) : null}

      {editDraft ? (
        <div className="accounts-modal" role="dialog" aria-modal="true">
          <div className="accounts-modal__backdrop" onClick={() => setEditDraft(null)} />
          <div className="accounts-modal__card accounts-modal__card--edit">
            <div className="accounts-modal__head">
              <div>
                <span className="accounts-eyebrow">تعديل الحساب</span>
                <h2>{editDraft.displayName || editDraft.email}</h2>
              </div>
              <button type="button" className="accounts-modal__close" onClick={() => setEditDraft(null)}>×</button>
            </div>
            <div className="accounts-modal__body">
              <div className="accounts-modal__sidebar">
                <label className="accounts-field">
                  <span>الاسم</span>
                  <input value={editDraft.displayName} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, displayName: event.target.value } : draft)} />
                </label>
                <label className="accounts-field">
                  <span>البريد</span>
                  <input type="email" value={editDraft.email} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, email: event.target.value } : draft)} />
                </label>
                <label className="accounts-field">
                  <span>الجوال</span>
                  <input value={editDraft.phone} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, phone: event.target.value } : draft)} />
                </label>
                <label className="accounts-field">
                  <span>الدور</span>
                  <select value={editDraft.role} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, role: normalizeRole(event.target.value) } : draft)}>
                    {roleOptions.map((role) => (
                      <option key={role.role_key} value={role.role_key}>{getRoleLabel(role.role_key)}</option>
                    ))}
                  </select>
                </label>
                <label className="accounts-field">
                  <span>الحالة</span>
                  <select value={editDraft.status} onChange={(event) => setEditDraft((draft) => draft ? { ...draft, status: event.target.value as CoreAccount["status"] } : draft)}>
                    <option value="active">نشط</option>
                    <option value="pending">قيد المراجعة</option>
                    <option value="disabled">معطل</option>
                    <option value="deleted">محذوف</option>
                  </select>
                </label>
                <label className="accounts-field">
                  <span>معرف الموظفة المرتبطة</span>
                  <input
                    value={editDraft.employeeId}
                    disabled={!canManageLinks}
                    onChange={(event) => setEditDraft((draft) => draft ? { ...draft, employeeId: event.target.value } : draft)}
                  />
                </label>
              </div>

              <section className="accounts-permissions-editor">
                <div className="accounts-permissions-editor__head">
                  <div>
                    <h3>الصلاحيات الفعلية</h3>
                    <p>سيحوّل Worker هذه القائمة إلى allow/deny بالنسبة للدور المحدد.</p>
                  </div>
                  <div className="accounts-permissions-editor__stats">
                    <span>المحددة: {editDraft.permissions.length}</span>
                    <span>صلاحيات المنفذ: {actorPermissions.length}</span>
                  </div>
                </div>
                {!canManagePermissions ? (
                  <div className="accounts-permissions-editor__notice">يمكنك تعديل بيانات الحساب فقط. تعديل الصلاحيات يتطلب permissions.manage.</div>
                ) : null}
                <div className="accounts-permissions-editor__grid">
                  {VISIBLE_APP_PERMISSION_CATALOG.map((permission) => {
                    const enabled = editDraft.permissions.includes(permission.key);
                    const actorCanGrant = actorIsOwner || actorPermissions.includes(permission.key);
                    return (
                      <button
                        type="button"
                        key={permission.key}
                        className={`accounts-permission-toggle ${enabled ? "is-active" : ""} ${permission.sensitive ? "is-sensitive" : ""}`}
                        aria-pressed={enabled}
                        disabled={!canManagePermissions || (!actorCanGrant && !enabled)}
                        onClick={() => {
                          setEditDraft((draft) => {
                            if (!draft) return draft;
                            const set = new Set(draft.permissions);
                            if (set.has(permission.key)) set.delete(permission.key);
                            else set.add(permission.key);
                            return { ...draft, permissions: VISIBLE_APP_PERMISSION_CATALOG.map((item) => item.key).filter((key) => set.has(key)) };
                          });
                        }}
                      >
                        <span className="accounts-permission-toggle__dot" aria-hidden="true" />
                        <span className="accounts-permission-toggle__copy">
                          <strong>{permission.label}</strong>
                          <small>{permission.key}</small>
                          <em>{permission.hint}</em>
                        </span>
                        <span className="accounts-permission-toggle__state">{enabled ? "مفعل" : "غير مفعل"}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
            <div className="accounts-modal__footer">
              <button type="button" className="accounts-btn accounts-btn--ghost" onClick={() => setEditDraft(null)}>إلغاء</button>
              <button type="button" className="accounts-btn accounts-btn--primary" disabled={saving} onClick={() => void handleSaveEdit()}>حفظ التعديلات</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
