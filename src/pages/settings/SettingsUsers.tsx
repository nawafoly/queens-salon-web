// src/pages/settings/SettingsUsers.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import {
  getIdTokenResult,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  updateProfile,
} from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { auth, db } from "../../services/firebase";
import { writeAuditLog } from "../../services/logService";
import {
  APP_PERMISSION_CATALOG,
  buildPermissionOverrides,
  getEffectiveAppPermissions,
  getRoleAppPermissions,
  normalizePermissionOverrides,
  type AppPermission,
  type PermissionOverrides,
} from "../../helpers/permissions";
import {
  findStaffMatchesForUser,
  listStaffLinkRows,
  repairLegacyStaffUserLinks,
  softDeleteLinkedStaffByUser,
  type AccountUserLinkRow,
} from "../../services/staffAccountLinkService";
import { SettingsPageHeader, SettingsState } from "./SettingsFrame";

import "../../styles/DashboardModals.css";
import "../../styles/stylesSettings/SettingsCatalog.css";
import "../../styles/stylesSettings/DashboardSettings.css";
import "../../styles/stylesSettings/SettingsUsers.css";

/* =========================
   Roles helpers
========================= */
type UiRole =
  | "owner"
  | "admin"
  | "hr"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";

function mapFirestoreRoleToUi(roleRaw: string): UiRole {
  const role = String(roleRaw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "hr") return "hr";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "pending") return "pending";
  if (role === "client") return "client";
  return "guest";
}

function toFirestoreRole(role: UiRole) {
  const r = String(role || "guest").toLowerCase().trim();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  if (r === "hr") return "hr";
  if (r === "reception") return "reception";
  if (r === "staff") return "staff";
  if (r === "pending") return "pending";
  if (r === "client") return "client";
  return "guest";
}

/* =========================
   Secondary Auth (create user)
========================= */
function getSecondaryAuth() {
  const options = (auth as any)?.app?.options;
  if (!options) throw new Error("Missing Firebase app options from auth.app.options");

  const name = "secondary-auth-app";
  const app = getApps().find((a) => a.name === name) || initializeApp(options, name);
  return getAuth(app);
}

/* =========================
   Collections
========================= */
const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;
const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;
const EMPLOYEES_COLLECTION = ["salons", SALON_ID, "employees"] as const;

/* =========================
   Types
========================= */
type UserRow = {
  uid: string;
  email: string;
  phone?: string;
  displayName: string;
  role: UiRole;
  active: boolean;
  notes?: string;
  linkedEmployeeDocId?: string;
  employeeId?: string;
  permissions?: AppPermission[];
  permissionOverrides?: PermissionOverrides;
  deletedAt?: any;
  createdAt?: any;
  updatedAt?: any;
};

type EditUserDraft = {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  role: UiRole;
  active: boolean;
  notes: string;
  permissions: AppPermission[];
};

type InviteRow = {
  id: string;
  email: string;
  role: UiRole;
  active: boolean;
  notes?: string;
  createdAt?: any;
  used?: boolean;
  usedAt?: any;
  usedByUid?: string;
  createdByUid?: string;
  createdByEmail?: string;
};

type InviteDraft = {
  email: string;
  role: UiRole;
  notes: string;
};

const PERMISSION_META = APP_PERMISSION_CATALOG;

const ROLE_LABELS: Record<UiRole, string> = {
  owner: "المالك",
  admin: "الإدارة",
  hr: "الموارد البشرية",
  reception: "الاستقبال",
  staff: "الموظفات",
  pending: "قيد المراجعة",
  client: "عميلة",
  guest: "ضيف",
};

const ROLE_TONES: Record<UiRole, string> = {
  owner: "gold",
  admin: "amber",
  hr: "mint",
  reception: "blue",
  staff: "slate",
  pending: "gray",
  client: "gray",
  guest: "gray",
};

type SettingsUsersProps = {
  initialRole?: UiRole | string;
  authReady?: boolean;
  allowAdminManageUsers?: boolean;
};

export default function SettingsUsers({
  initialRole,
  authReady,
  allowAdminManageUsers: allowAdminManageUsersOverride,
}: SettingsUsersProps = {}) {
  const location = useLocation();
  const isAdminShell = location.pathname.startsWith("/admin");
  const pageTitle = isAdminShell ? "إدارة الحسابات الإدارية" : "إدارة الحسابات";
  const pageHint = isAdminShell
    ? "مراجعة الحسابات الإدارية وصلاحياتها من لوحة الموارد البشرية."
    : "إنشاء حسابات الموظفات ومراجعة الصلاحيات من تبويب الإعدادات.";

  const [uiRole, setUiRole] = useState<UiRole>(mapFirestoreRoleToUi(initialRole ?? "guest"));
  const [authLoading, setAuthLoading] = useState(() => (typeof authReady === "boolean" ? !authReady : true));
  const authRequestIdRef = useRef(0);
  const authResolvedRef = useRef(false);

  useEffect(() => {
    if (typeof initialRole === "string") {
      setUiRole(mapFirestoreRoleToUi(initialRole));
    }
  }, [initialRole]);

  useEffect(() => {
    if (typeof authReady === "boolean") {
      setAuthLoading(!authReady);
    }
  }, [authReady]);

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";
  const isHr = uiRole === "hr";

  // ✅ نقرأ allowAdminManageUsers من localStorage لكن “يتحدّث” مع settingsChanged
  const [allowAdminManageUsersState, setAllowAdminManageUsersState] = useState(false);

  const readAllowAdminManageUsers = () => {
    try {
      const raw = localStorage.getItem("dashboard_settings_v1");
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.policies?.allowAdminManageUsers);
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (typeof allowAdminManageUsersOverride === "boolean") {
      setAllowAdminManageUsersState(allowAdminManageUsersOverride);
      return;
    }

    // init
    setAllowAdminManageUsersState(readAllowAdminManageUsers());

    // live updates (Dashboard يرسل settingsChanged)
    const onSettingsChanged = () => {
      setAllowAdminManageUsersState(readAllowAdminManageUsers());
    };
    window.addEventListener("settingsChanged", onSettingsChanged);
    return () => window.removeEventListener("settingsChanged", onSettingsChanged);
  }, [allowAdminManageUsersOverride]);

  const allowAdminManageUsers =
    typeof allowAdminManageUsersOverride === "boolean"
      ? allowAdminManageUsersOverride
      : allowAdminManageUsersState;

  const canManageUsers = useMemo(() => {
    return isOwner || isHr || (isAdmin && allowAdminManageUsers);
  }, [isOwner, isHr, isAdmin, allowAdminManageUsers]);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UiRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "pending">("all");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<EditUserDraft | null>(null);

  const [createForm, setCreateForm] = useState({
    displayName: "",
    email: "",
    password: "",
    phone: "",
    notes: "",
    role: "staff" as UiRole,
  });

  const [createLoading, setCreateLoading] = useState(false);
  const [createMsg, setCreateMsg] = useState<string>("");
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<InviteDraft>({
    email: "",
    role: "staff",
    notes: "",
  });

  /* =========================
     Helpers
  ========================= */
  function cleanEmail(v: string) {
    return String(v || "").trim().toLowerCase();
  }

  function cleanText(v: unknown) {
    return String(v || "").trim();
  }

  function isMalikatEmail(email: string) {
    return cleanEmail(email).endsWith("@malikat.com");
  }

  function isEmployeeRole(role: UiRole) {
    return ["owner", "admin", "hr", "reception", "staff"].includes(role);
  }

  const toastMsg = (msg: string, ms = 2200) => {
    setCreateMsg(msg);
    if (ms > 0) setTimeout(() => setCreateMsg(""), ms);
  };

  function getUserState(row: UserRow) {
    if (row.role === "pending") return "pending" as const;
    return row.active !== false ? "active" as const : "inactive" as const;
  }

  function getRoleLabel(role: UiRole) {
    return ROLE_LABELS[role] || ROLE_LABELS.guest;
  }

  function getRoleTone(role: UiRole) {
    return ROLE_TONES[role] || ROLE_TONES.guest;
  }

  function getUserPermissions(row: Pick<UserRow, "role" | "permissions" | "permissionOverrides">) {
    return getEffectiveAppPermissions({
      role: row.role as any,
      permissions: row.permissions,
      permissionOverrides: row.permissionOverrides,
    });
  }

  function formatDate(value: any) {
    if (!value) return "-";
    try {
      const date =
        typeof value?.toDate === "function"
          ? value.toDate()
          : value?.seconds
            ? new Date(value.seconds * 1000)
            : new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return new Intl.DateTimeFormat("ar-SA", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch {
      return "-";
    }
  }

  function toMillis(value: any) {
    if (!value) return 0;
    try {
      const date =
        typeof value?.toDate === "function"
          ? value.toDate()
          : value?.seconds
            ? new Date(value.seconds * 1000)
            : new Date(value);
      const time = date.getTime();
      return Number.isNaN(time) ? 0 : time;
    } catch {
      return 0;
    }
  }

  function canEditTargetUser(row?: UserRow | null) {
    if (!row) return false;
    return row.role !== "owner" || isOwner;
  }

  function toAccountUserLinkRow(row: Partial<UserRow> & { uid: string }): AccountUserLinkRow {
    return {
      uid: cleanText(row.uid),
      email: cleanEmail(row.email || ""),
      phone: cleanText(row.phone || ""),
      displayName: cleanText(row.displayName || ""),
      role: cleanText(row.role || ""),
      active: row.active !== false,
      linkedEmployeeDocId: cleanText(row.linkedEmployeeDocId || ""),
      employeeId: cleanText(row.employeeId || ""),
      deletedAt: row.deletedAt,
    };
  }

  const syncLinkedStaffFromUser = async (args: {
    user: Partial<UserRow> & { uid: string };
    role: UiRole;
    active: boolean;
    displayName: string;
    permissions?: AppPermission[];
    permissionOverrides?: PermissionOverrides;
    createIfMissing?: boolean;
  }) => {
    const userRow = toAccountUserLinkRow(args.user);
    const staffRows = await listStaffLinkRows();
    const matches = findStaffMatchesForUser(userRow, staffRows);
    const existing = matches[0] as any;
    const fallbackDocId =
      cleanText(userRow.linkedEmployeeDocId) || cleanText(userRow.employeeId) || cleanText(userRow.uid);
    const staffId = cleanText(existing?.id || (args.createIfMissing ? fallbackDocId : ""));
    if (!staffId) return null;

    const email = cleanEmail(userRow.email || "");
    const displayName = cleanText(args.displayName) || cleanText(existing?.name) || "موظفة";
    const nextRole = toFirestoreRole(args.role);
    const isEmployeeRole = ["owner", "admin", "hr", "reception", "staff"].includes(args.role);
    const isPublicStaffRole = args.role === "staff";
    const effectivePermissions = getEffectiveAppPermissions({
      role: args.role as any,
      permissions: args.permissions,
      permissionOverrides: args.permissionOverrides,
    });
    const permissionPayload = {
      permissions: effectivePermissions,
      permissionOverrides: args.permissionOverrides || buildPermissionOverrides(args.role, effectivePermissions),
      permissionVersion: 2,
    };

    await setDoc(
      doc(db, ...STAFF_PUBLIC_COLLECTION, staffId),
      {
        uid: userRow.uid,
        linkedUid: userRow.uid,
        linkedUserId: userRow.uid,
        ...(email ? { userEmail: email } : {}),
        ...(!cleanText(existing?.email) && email ? { email } : {}),
        name: displayName,
        role: nextRole,
        active: isEmployeeRole ? args.active : false,
        showOnAbout: isPublicStaffRole ? existing?.showOnAbout !== false : false,
        showOnBooking: isPublicStaffRole ? existing?.showOnBooking === true : false,
        removedFromStaff: false,
        employmentStatus: isEmployeeRole ? (args.active ? "active" : "inactive") : "inactive",
        deletedAt: null,
        deletedBy: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await setDoc(
      doc(db, ...EMPLOYEES_COLLECTION, staffId),
      {
        uid: userRow.uid,
        linkedUid: userRow.uid,
        linkedUserId: userRow.uid,
        ...(email ? { userEmail: email, email } : {}),
        name: displayName,
        role: nextRole,
        ...permissionPayload,
        isActive: isEmployeeRole ? args.active : false,
        active: isEmployeeRole ? args.active : false,
        showOnAbout: isPublicStaffRole ? existing?.showOnAbout !== false : false,
        removedFromStaff: false,
        employmentStatus: isEmployeeRole ? (args.active ? "active" : "inactive") : "inactive",
        deletedAt: null,
        deletedBy: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (isEmployeeRole) {
      await setDoc(
        doc(db, "salons", SALON_ID, "admin_users", userRow.uid),
        {
          uid: userRow.uid,
          email,
          displayName,
          phone: cleanText(userRow.phone || ""),
          role: nextRole,
          ...permissionPayload,
          active: args.active,
          employeeId: staffId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    await setDoc(
      doc(db, ...USERS_COLLECTION, userRow.uid),
      {
        linkedEmployeeDocId: staffId,
        employeeId: staffId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return staffId;
  };

  const loadUsers = async (options?: { runRepair?: boolean }) => {
    if (!canManageUsers) return;

    setUsersLoading(true);
    try {
      let repairResult:
        | {
            linkedPairs: number;
            patchedUsers: number;
            patchedStaff: number;
          }
        | null = null;

      if (options?.runRepair) {
        repairResult = await repairLegacyStaffUserLinks();
      }

      const qy = query(
        collection(db, ...USERS_COLLECTION),
        orderBy("createdAt", "desc")
      );
      const [snap, staffRows] = await Promise.all([getDocs(qy), listStaffLinkRows()]);

      const listAll: UserRow[] = snap.docs.map((d) => {
        const x = d.data() as any;
        const role = mapFirestoreRoleToUi(x?.role);
        const permissionOverrides = normalizePermissionOverrides(x?.permissionOverrides);
        const permissions = getEffectiveAppPermissions({
          role: role as any,
          permissions: x?.permissions,
          permissionOverrides,
        });
        const baseRow: UserRow = {
          uid: d.id,
          email: String(x?.email || ""),
          phone: String(x?.phone || ""),
          displayName: String(x?.displayName || x?.name || ""),
          role,
          active: x?.active !== false,
          notes: String(x?.notes || x?.memo || ""),
          linkedEmployeeDocId: String(x?.linkedEmployeeDocId || ""),
          employeeId: String(x?.employeeId || ""),
          permissions,
          permissionOverrides,
          deletedAt: x?.deletedAt,
          createdAt: x?.createdAt,
          updatedAt: x?.updatedAt,
        };
        const linkedStaff = findStaffMatchesForUser(toAccountUserLinkRow(baseRow), staffRows)[0] as any;
        return {
          ...baseRow,
          linkedEmployeeDocId: cleanText(baseRow.linkedEmployeeDocId) || cleanText(linkedStaff?.id),
          employeeId: cleanText(baseRow.employeeId) || cleanText(linkedStaff?.id),
        };
      });

      // ✅ عرض حسابات malikat.com فقط
      const listFiltered = listAll
        .filter((u) => !u.deletedAt)
        .filter((u) => isMalikatEmail(u.email))
        .map((u) => {
          // أي حساب malikat.com لو كان client/guest نخليه pending (عرض + إدارة)
          const fixedRole: UiRole =
            u.role === "client" || u.role === "guest" ? "pending" : u.role;
          return {
            ...u,
            role: fixedRole,
            permissions:
              fixedRole === u.role
                ? u.permissions
                : getEffectiveAppPermissions({
                    role: fixedRole as any,
                    permissions: u.permissions,
                    permissionOverrides: u.permissionOverrides,
                  }),
          };
        });

      setUsers(listFiltered);
      if (repairResult) {
        toastMsg(
          `✅ تم فحص الربط: ${repairResult.linkedPairs} ربط، ${repairResult.patchedStaff} موظفة، ${repairResult.patchedUsers} حساب`,
          3200
        );
      }
    } catch (e) {
      console.error("loadUsers error:", e);
      setUsers([]);
      toastMsg("❌ تعذر تحميل الحسابات (Rules?)", 2600);
    } finally {
      setUsersLoading(false);
    }
  };

  const loadInvites = async () => {
    if (!canManageUsers) return;

    setInvitesLoading(true);
    try {
      const snap = await getDocs(collection(db, "salons", SALON_ID, "user_invites"));

      const list: InviteRow[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            email: String(x?.email || ""),
            role: mapFirestoreRoleToUi(x?.role),
            active: x?.active !== false,
            notes: String(x?.notes || x?.memo || ""),
            createdAt: x?.createdAt,
            used: x?.used === true,
            usedAt: x?.usedAt,
            usedByUid: String(x?.usedByUid || ""),
            createdByUid: String(x?.createdByUid || ""),
            createdByEmail: String(x?.createdByEmail || ""),
          };
        })
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

      setInvites(list);
    } catch (e) {
      console.error("loadInvites error:", e);
      setInvites([]);
      toastMsg("تعذر تحميل الدعوات", 2400);
    } finally {
      setInvitesLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!canManageUsers) return;

    const displayName = createForm.displayName.trim();
    const email = createForm.email.trim().toLowerCase();
    const password = createForm.password.trim();
    const phone = createForm.phone.trim();
    const notes = createForm.notes.trim();
    const role = createForm.role;

    setCreateMsg("");

    if (!displayName || !email || !password) {
      toastMsg("❌ أكمل البيانات (الاسم/الإيميل/كلمة المرور)");
      return;
    }

    // ✅ منع إنشاء أي إيميل غير malikat.com
    if (!isMalikatEmail(email)) {
      toastMsg("❌ مسموح فقط بإيميلات @malikat.com لإنشاء حسابات الموظفات");
      return;
    }

    if (!isOwner && role === "owner") {
      toastMsg("❌ فقط Owner يقدر ينشئ Owner");
      return;
    }

    try {
      setCreateLoading(true);
      const secondary = getSecondaryAuth();
      const permissions = getRoleAppPermissions(role as any);
      const permissionOverrides = buildPermissionOverrides(role as any, permissions);

      const cred = await createUserWithEmailAndPassword(secondary, email, password);
      await updateProfile(cred.user, { displayName }).catch(() => {});

      const uid = cred.user.uid;

      // ✅ users/{uid} هو Source of Truth
      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        {
          email,
          displayName,
          phone,
          notes,
          role: toFirestoreRole(role),
          permissions,
          permissionOverrides,
          permissionVersion: 2,
          active: true,
          createdAt: serverTimestamp(),
          createdByUid: (auth as any)?.currentUser?.uid || "",
          createdByEmail: (auth as any)?.currentUser?.email || "",
        },
        { merge: true }
      );

      // ✅ لو Staff: جهّز staff_public + employees
      if (isEmployeeRole(role)) {
        await syncLinkedStaffFromUser({
          user: {
            uid,
            email,
            displayName,
            phone,
            role,
            active: true,
            permissions,
            permissionOverrides,
            linkedEmployeeDocId: uid,
            employeeId: uid,
          },
          role,
          active: true,
          displayName,
          permissions,
          permissionOverrides,
          createIfMissing: true,
        });
      }

      await signOut(secondary).catch(() => {});

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_created",
        entityType: "user",
        entityId: uid,
        description: "تم إنشاء حساب مستخدم جديد",
        source: "dashboard",
        after: {
          uid,
          email,
          displayName,
          role: toFirestoreRole(role),
          permissions,
          active: true,
        },
        meta: {
          role: toFirestoreRole(role),
          createdFrom: "settings_users",
        },
      });

      toastMsg("✅ تم إنشاء الحساب بنجاح", 1800);
      setCreateForm({ displayName: "", email: "", password: "", phone: "", notes: "", role: "staff" });
      setCreateOpen(false);
      setSelectedUserId(uid);

      await loadUsers();
    } catch (e: any) {
      console.error("create user error:", e);
      const m = String(e?.message || "");
      if (m.includes("email-already-in-use")) toastMsg("❌ هذا الإيميل مستخدم مسبقًا");
      else if (m.includes("weak-password")) toastMsg("❌ كلمة المرور ضعيفة (جرّب 6 أحرف أو أكثر)");
      else toastMsg("❌ تعذر إنشاء الحساب. تأكد من الصلاحيات/Rules");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!canManageUsers) return;

    const email = cleanEmail(inviteDraft.email);
    const role = inviteDraft.role;
    const notes = inviteDraft.notes.trim();

    setCreateMsg("");

    if (!email) {
      toastMsg("❌ أدخل البريد الإلكتروني أولًا");
      return;
    }

    if (!isMalikatEmail(email)) {
      toastMsg("❌ الدعوات هنا مخصصة فقط لبريد @malikat.com");
      return;
    }

    if (!role || role === "guest" || role === "client") {
      toastMsg("❌ اختر دورًا إداريًا مناسبًا للدعوة");
      return;
    }

    if (!isOwner && role === "owner") {
      toastMsg("❌ فقط المالك يستطيع إرسال دعوة Owner");
      return;
    }

    const duplicateInvite = invites.find(
      (invite) => cleanEmail(invite.email) === email && invite.used !== true
    );
    if (duplicateInvite) {
      toastMsg("❌ توجد دعوة نشطة لهذا البريد بالفعل");
      return;
    }

    try {
      setInviteSaving(true);
      const permissions = getRoleAppPermissions(role as any);
      const permissionOverrides = buildPermissionOverrides(role as any, permissions);

      const inviteRef = doc(collection(db, "salons", SALON_ID, "user_invites"));
      await setDoc(
        inviteRef,
        {
          email,
          role: toFirestoreRole(role),
          permissions,
          permissionOverrides,
          permissionVersion: 2,
          active: true,
          notes,
          createdAt: serverTimestamp(),
          createdByUid: (auth as any)?.currentUser?.uid || "",
          createdByEmail: (auth as any)?.currentUser?.email || "",
        },
        { merge: true }
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "invite_created",
        entityType: "invite",
        entityId: inviteRef.id,
        description: "تم إنشاء دعوة وصول إدارية",
        source: "dashboard",
        after: {
          email,
          role: toFirestoreRole(role),
          permissions,
          active: true,
        },
        meta: {
          section: "settings_users",
        },
      });

      toastMsg("✅ تم حفظ الدعوة بنجاح", 1800);
      setInviteDraft({ email: "", role: "staff", notes: "" });
      await loadInvites();
    } catch (e) {
      console.error("handleCreateInvite error:", e);
      toastMsg("❌ تعذر حفظ الدعوة. تأكد من الصلاحيات والقواعد", 2600);
    } finally {
      setInviteSaving(false);
    }
  };

  const updateUserRole = async (uid: string, newRole: UiRole) => {
    if (!canManageUsers) return;
    if (!isOwner && newRole === "owner") return;

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن تعديل دور حسابك من هنا", 2400);
      return;
    }

    const row = users.find((x) => x.uid === uid);
    if (!canEditTargetUser(row)) {
      toastMsg("❌ تعديل حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    // ✅ pending => active false / غير pending => active true
    const nextActive = newRole !== "pending";

    try {
      const oldRole = String(row?.role || "").trim();
      const oldActive = row?.active !== false;
      const permissions = getRoleAppPermissions(newRole as any);
      const permissionOverrides = buildPermissionOverrides(newRole as any, permissions);

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        {
          role: toFirestoreRole(newRole),
          permissions,
          permissionOverrides,
          permissionVersion: 2,
          active: nextActive,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );


      const name = row?.displayName || "موظفة";
      await syncLinkedStaffFromUser({
        user: {
          uid,
          email: row?.email || "",
          displayName: name,
          role: newRole,
          active: nextActive,
          permissions,
          permissionOverrides,
          linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
          employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
        },
        role: newRole,
        active: nextActive,
        displayName: name,
        permissions,
        permissionOverrides,
        createIfMissing: isEmployeeRole(newRole),
      });

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid
            ? { ...u, role: newRole, active: nextActive, permissions, permissionOverrides }
            : u
        )
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "role_changed",
        entityType: "user",
        entityId: uid,
        description: "تم تعديل صلاحية المستخدم",
        source: "dashboard",
        before: {
          role: oldRole || null,
          active: oldActive,
        },
        after: {
          role: newRole,
          active: nextActive,
          permissions,
        },
        meta: {
          oldRole: oldRole || null,
          newRole,
        },
      });

      toastMsg("✅ تم تحديث الدور", 1400);
    } catch (e) {
      console.error("updateUserRole error:", e);
      toastMsg("❌ تعذر تحديث الدور (Rules?)", 2600);
    }
  };

  const toggleUserActive = async (uid: string, active: boolean) => {
    if (!canManageUsers) return;

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن إيقاف حسابك من هنا", 2400);
      return;
    }

    const row = users.find((x) => x.uid === uid);
    if (!canEditTargetUser(row)) {
      toastMsg("❌ تعديل حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    try {
      const oldActive = row?.active !== false;

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { active, updatedAt: serverTimestamp() },
        { merge: true }
      );

      // ✅ لو هو Staff خله يتزامن مع staff_public/employees
      if (row?.role && isEmployeeRole(row.role as UiRole)) {
        await syncLinkedStaffFromUser({
          user: {
            uid,
            email: row?.email || "",
            displayName: row?.displayName || "",
            role: row?.role || "staff",
            active,
            permissions: row.permissions,
            permissionOverrides: row.permissionOverrides,
            linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
            employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
          },
          role: row?.role || "staff",
          active,
          displayName: row?.displayName || "",
          permissions: row.permissions,
          permissionOverrides: row.permissionOverrides,
          createIfMissing: false,
        });
      }

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, active } : u)));

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_updated",
        entityType: "user",
        entityId: uid,
        description: active ? "تم تفعيل الحساب" : "تم تعطيل الحساب",
        source: "dashboard",
        before: { active: oldActive },
        after: { active },
        meta: { field: "active" },
      });

      toastMsg("✅ تم تحديث حالة الحساب", 1200);
    } catch (e) {
      console.error("toggleUserActive error:", e);
      toastMsg("❌ تعذر تحديث حالة الحساب (Rules?)", 2600);
    }
  };

  const updateUserDisplayName = async (uid: string, newName: string) => {
    if (!canManageUsers) return;

    const name = String(newName || "").trim();
    if (!name) {
      toastMsg("❌ الاسم لا يمكن أن يكون فارغ", 2000);
      return;
    }

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن تعديل اسم حسابك من هنا", 2400);
      return;
    }

    const row = users.find((x) => x.uid === uid);
    if (!canEditTargetUser(row)) {
      toastMsg("❌ تعديل حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    try {
      const oldName = String(row?.displayName || "").trim();

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { displayName: name, updatedAt: serverTimestamp() },
        { merge: true }
      );

      const roleNow = row?.role;

      if (roleNow && isEmployeeRole(roleNow as UiRole)) {
        await syncLinkedStaffFromUser({
          user: {
            uid,
            email: row?.email || "",
            displayName: name,
            role: roleNow,
            active: row?.active !== false,
            permissions: row.permissions,
            permissionOverrides: row.permissionOverrides,
            linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
            employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
          },
          role: roleNow,
          active: row?.active !== false,
          displayName: name,
          permissions: row.permissions,
          permissionOverrides: row.permissionOverrides,
          createIfMissing: false,
        });
      }

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, displayName: name } : u)));

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_updated",
        entityType: "user",
        entityId: uid,
        description: "تم تعديل اسم المستخدم",
        source: "dashboard",
        before: { displayName: oldName || null },
        after: { displayName: name },
        meta: { field: "displayName" },
      });

      toastMsg("✅ تم تحديث الاسم", 1200);
    } catch (e) {
      console.error("updateUserDisplayName error:", e);
      toastMsg("❌ تعذر تحديث الاسم (Rules?)", 2600);
    }
  };

  const saveEditedUser = async () => {
    if (!canManageUsers || !editDraft) return;

    const row = users.find((x) => x.uid === editDraft.uid);
    if (!row) return;

    if (!canEditTargetUser(row)) {
      toastMsg("❌ تعديل حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    if ((auth as any)?.currentUser?.uid === editDraft.uid) {
      toastMsg("❌ لا يمكن تعديل حسابك من هنا", 2400);
      return;
    }

    const displayName = editDraft.displayName.trim();
    const phone = editDraft.phone.trim();
    const notes = editDraft.notes.trim();
    const role = editDraft.role;
    const active = role === "pending" ? false : editDraft.active !== false;
    const permissions = PERMISSION_META
      .map((item) => item.key)
      .filter((permission) => editDraft.permissions.includes(permission));
    const permissionOverrides = buildPermissionOverrides(role as any, permissions);

    if (!displayName) {
      toastMsg("❌ الاسم لا يمكن أن يكون فارغًا", 2000);
      return;
    }

    if (role === "owner" && !isOwner) {
      toastMsg("❌ فقط المالك يقدر يمنح Owner", 2200);
      return;
    }

    try {
      setUsersLoading(true);

      const nextRole = toFirestoreRole(role);
      const staffId = await syncLinkedStaffFromUser({
        user: {
          uid: row.uid,
          email: row.email || editDraft.email,
          phone,
          displayName,
          role,
          active,
          permissions,
          permissionOverrides,
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || "",
          employeeId: row.employeeId || row.linkedEmployeeDocId || "",
        },
        role,
        active,
        displayName,
        permissions,
        permissionOverrides,
        createIfMissing: isEmployeeRole(role),
      });

      await setDoc(
        doc(db, ...USERS_COLLECTION, row.uid),
        {
          displayName,
          phone,
          notes,
          role: nextRole,
          permissions,
          permissionOverrides,
          permissionVersion: 2,
          active,
          linkedEmployeeDocId: staffId || row.linkedEmployeeDocId || row.employeeId || "",
          employeeId: staffId || row.employeeId || row.linkedEmployeeDocId || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === row.uid
            ? {
                ...u,
                displayName,
                phone,
                notes,
                role,
                permissions,
                permissionOverrides,
                active,
                linkedEmployeeDocId: staffId || u.linkedEmployeeDocId,
                employeeId: staffId || u.employeeId,
              }
            : u
        )
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_updated",
        entityType: "user",
        entityId: row.uid,
        description: "تم حفظ تعديلات الحساب",
        source: "dashboard",
        before: {
          displayName: row.displayName || null,
          phone: row.phone || null,
          role: row.role,
          active: row.active,
          notes: row.notes || null,
          permissions: row.permissions || [],
        },
        after: {
          displayName,
          phone,
          role,
          active,
          notes: notes || null,
          permissions,
        },
        meta: {
          field: "profile",
        },
      });

      toastMsg("✅ تم حفظ التعديلات", 1600);
      setEditDraft(null);
    } catch (e) {
      console.error("saveEditedUser error:", e);
      toastMsg("❌ تعذر حفظ التعديلات (Rules?)", 2600);
    } finally {
      setUsersLoading(false);
    }
  };

  const openEditUser = (row: UserRow) => {
    setCreateMsg("");
    setEditDraft({
      uid: row.uid,
      displayName: row.displayName || "",
      email: row.email || "",
      phone: row.phone || "",
      role: row.role,
      active: row.active !== false,
      notes: row.notes || "",
      permissions: getEffectiveAppPermissions({
        role: row.role as any,
        permissions: row.permissions,
        permissionOverrides: row.permissionOverrides,
      }),
    });
  };

  /* =========================
     Auth + Role
  ========================= */
  useEffect(() => {
    if (typeof initialRole === "string" && typeof authReady === "boolean") {
      authResolvedRef.current = true;
      return;
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      const requestId = ++authRequestIdRef.current;
      if (!authResolvedRef.current) setAuthLoading(true);
      try {
        if (!user) {
          setUiRole("guest");
          return;
        }

        const [tokenResult, userSnap, adminSnap] = await Promise.all([
          getIdTokenResult(user).catch((error) => {
            console.error("SettingsUsers token load error:", error);
            return null;
          }),
          getDoc(doc(db, ...USERS_COLLECTION, user.uid)).catch((error) => {
            console.error("SettingsUsers user load error:", error);
            return null;
          }),
          getDoc(doc(db, "salons", SALON_ID, "admin_users", user.uid)).catch((error) => {
            console.error("SettingsUsers admin load error:", error);
            return null;
          }),
        ]);

        const tokenRole = mapFirestoreRoleToUi((tokenResult as any)?.claims?.role || "");
        const userRole =
          userSnap && "exists" in userSnap && userSnap.exists()
            ? mapFirestoreRoleToUi((userSnap.data() as any)?.role)
            : "guest";
        const adminRole =
          adminSnap && "exists" in adminSnap && adminSnap.exists()
            ? mapFirestoreRoleToUi((adminSnap.data() as any)?.role)
            : "guest";

        const rolePriority: UiRole[] = [
          userRole,
          adminRole,
          tokenRole,
          "owner",
          "admin",
          "hr",
          "reception",
          "staff",
          "pending",
        ];
        const resolvedRole =
          rolePriority.find((r) => r === "owner") ||
          rolePriority.find((r) => r === "admin") ||
          rolePriority.find((r) => r === "hr") ||
          rolePriority.find((r) => r === "reception") ||
          rolePriority.find((r) => r === "staff") ||
          rolePriority.find((r) => r === "pending") ||
          "guest";

        setUiRole(resolvedRole);
      } catch (e) {
        console.error("SettingsUsers role load error:", e);
        setUiRole("guest");
      } finally {
        if (authRequestIdRef.current === requestId) {
          authResolvedRef.current = true;
          setAuthLoading(false);
        }
      }
    });

    return () => unsub();
  }, [initialRole, authReady]);

  useEffect(() => {
    if (!canManageUsers) return;
    loadUsers();
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageUsers]);

  const deleteUserAccount = async (uid: string) => {
    if (!canManageUsers) return;

    const row = users.find((x) => x.uid === uid);
    if (!row) return;

    if (!canEditTargetUser(row)) {
      toastMsg("❌ حذف حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن حذف حسابك من هنا", 2400);
      return;
    }

    const ok = confirm(
      `سيتم تعطيل الحساب وإخفاء الموظفة المرتبطة من الإدارة والحجز.\n\nالحساب: ${row.email || uid}\n\nمتابعة؟`
    );
    if (!ok) return;

    try {
      setUsersLoading(true);
      const actorUid = String((auth as any)?.currentUser?.uid || "").trim();

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        {
          active: false,
          role: "pending",
          deletedAt: serverTimestamp(),
          deletedBy: actorUid || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "users", uid),
        {
          active: false,
          deletedAt: serverTimestamp(),
          deletedBy: actorUid || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});

      const deleteResult = await softDeleteLinkedStaffByUser({
        user: toAccountUserLinkRow(row),
        actorUid,
      });

      setUsers((prev) => prev.filter((u) => u.uid !== uid));

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_deleted",
        entityType: "user",
        entityId: uid,
        description: "تم حذف الحساب تعطيلًا وربط حذف الموظفة soft delete",
        source: "dashboard",
        before: {
          role: row.role,
          active: row.active,
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || null,
        },
        after: {
          role: "pending",
          active: false,
          deletedAt: true,
          linkedStaffCount: deleteResult.matchedStaffIds.length,
        },
      });

      toastMsg("✅ تم حذف الحساب وتعطيل الموظفة المرتبطة", 2400);
    } catch (e) {
      console.error("deleteUserAccount error:", e);
      toastMsg("❌ تعذر حذف الحساب أو تعطيل الموظفة المرتبطة", 2800);
    } finally {
      setUsersLoading(false);
    }
  };

  const visibleUsers = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    return [...users]
      .filter((user) => {
        if (roleFilter !== "all" && user.role !== roleFilter) return false;

        const userState = getUserState(user);
        if (statusFilter !== "all" && userState !== statusFilter) return false;

        if (!search) return true;

        const haystack = [
          user.displayName,
          user.email,
          user.phone,
          user.uid,
          user.notes,
          user.role,
          user.linkedEmployeeDocId,
          user.employeeId,
        ]
          .map((part) => cleanText(part).toLowerCase())
          .join(" | ");

        return haystack.includes(search);
      })
      ;
  }, [users, roleFilter, searchQuery, statusFilter]);

  const selectedUser = useMemo(() => {
    if (!selectedUserId) return visibleUsers[0] || null;
    return visibleUsers.find((user) => user.uid === selectedUserId) || visibleUsers[0] || null;
  }, [selectedUserId, visibleUsers]);

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => getUserState(user) === "active").length;
    const inactive = users.filter((user) => getUserState(user) === "inactive").length;
    const pending = users.filter((user) => getUserState(user) === "pending").length;
    const editors = users.filter((user) => ["owner", "hr", "admin"].includes(user.role)).length;

    return { total, active, inactive, pending, editors };
  }, [users]);

  const inviteStats = useMemo(() => {
    const total = invites.length;
    const active = invites.filter((invite) => invite.active !== false && invite.used !== true).length;
    const used = invites.filter((invite) => invite.used === true).length;
    const pending = invites.filter((invite) => invite.active === false && invite.used !== true).length;

    return { total, active, used, pending };
  }, [invites]);

  const averagePermissions = useMemo(() => {
    if (!users.length) return 0;
    const totalPermissions = users.reduce(
      (sum, user) => sum + getUserPermissions(user).length,
      0
    );
    return Math.round((totalPermissions / users.length) * 10) / 10;
  }, [users]);

  const exceptionCount = useMemo(() => {
    return users.filter(
      (user) => user.role === "pending" || user.active === false || Boolean(cleanText(user.notes))
    ).length;
  }, [users]);

  useEffect(() => {
    if (!visibleUsers.length) {
      if (selectedUserId) setSelectedUserId("");
      return;
    }

    const hasSelection = visibleUsers.some((user) => user.uid === selectedUserId);
    if (!selectedUserId || !hasSelection) {
      setSelectedUserId(visibleUsers[0].uid);
    }
  }, [selectedUserId, visibleUsers]);

  useEffect(() => {
    if (!editDraft) return;
    if (!users.some((user) => user.uid === editDraft.uid)) {
      setEditDraft(null);
    }
  }, [editDraft, users]);

  const selectedState = selectedUser ? getUserState(selectedUser) : "inactive";
  const selectedStateLabel =
    selectedState === "active"
      ? "نشطة"
      : selectedState === "pending"
        ? "قيد المراجعة"
        : "غير نشطة";
  const selectedRoleLabel = selectedUser ? getRoleLabel(selectedUser.role) : "-";
  const selectedRoleTone = selectedUser ? getRoleTone(selectedUser.role) : "gray";
  const createPermissionCount = getRoleAppPermissions(createForm.role as any).length;
  const invitePreviewPermissions = PERMISSION_META.filter((item) =>
    getRoleAppPermissions(inviteDraft.role as any).includes(item.key)
  );
  const currentUid = String((auth as any)?.currentUser?.uid || "");
  const selectedIsSelf = Boolean(selectedUser && selectedUser.uid === currentUid);
  const selectedCanMutate = Boolean(selectedUser && !selectedIsSelf && canEditTargetUser(selectedUser));
  const editRoleDefaultPermissions = editDraft ? getRoleAppPermissions(editDraft.role as any) : [];
  const editPermissionSet = new Set<AppPermission>(editDraft?.permissions || []);
  const editAddedPermissions = editDraft
    ? editDraft.permissions.filter((permission) => !editRoleDefaultPermissions.includes(permission)).length
    : 0;
  const editDisabledDefaults = editDraft
    ? editRoleDefaultPermissions.filter((permission) => !editPermissionSet.has(permission)).length
    : 0;
  const bannerTone = createMsg.startsWith("❌")
    ? "danger"
    : createMsg.startsWith("✅")
      ? "success"
      : "info";
  const heroHighlights = [
    {
      label: "الحسابات المباشرة",
      value: stats.total,
      hint: "حسابات الإدارة الظاهرة حاليًا.",
    },
    {
      label: "الحسابات النشطة",
      value: stats.active,
      hint: "حسابات قيد التشغيل الآن.",
    },
    {
      label: "الدعوات الفعالة",
      value: inviteStats.active,
      hint: "دعوات لم تُستخدم بعد.",
    },
  ];
  const overviewMetrics = [
    {
      label: "الإجمالي",
      value: stats.total,
      hint: "كل الحسابات الإدارية.",
    },
    {
      label: "النشطة",
      value: stats.active,
      hint: "الحسابات المفعلة.",
    },
    {
      label: "متوسط الصلاحيات",
      value: averagePermissions,
      hint: "مستوى التغطية الفعلية.",
    },
    {
      label: "الاستثناءات",
      value: exceptionCount,
      hint: "حسابات تحتاج مراجعة.",
    },
  ];

  /* =========================
     Render
  ========================= */
  if (authLoading) {
    return (
      <div className="accounts-page accounts-page--settings" dir="rtl">
        <div className="accounts-shell accounts-shell--loading">
          <SettingsState
            title="جاري تحميل الحسابات…"
            hint="نقرأ الجلسة والصلاحيات ثم نحمّل القائمة المرتبطة بالحساب الحالي."
            loading
          />
        </div>
      </div>
    );
  }

  if (!canManageUsers) {
    return (
      <div className="accounts-page accounts-page--settings" dir="rtl">
        <div className="accounts-shell">
          <SettingsState
            title="غير مصرح"
            hint={
              <>
                هذه الصفحة مخصصة للمالك وHR، أو للأدمن إذا كان خيار إدارة الحسابات مفعّلًا من إعدادات
                النظام.
                <br />
                تأكد من دور الحساب داخل <code>salons/main/users/{`{uid}`}</code> أو انتقل من لوحة الموارد
                البشرية إذا كنت HR.
              </>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="accounts-page accounts-page--settings" dir="rtl">
      <div className="accounts-shell">
        <SettingsPageHeader
          eyebrow="الوحدة 03"
          title={pageTitle}
          hint={pageHint}
          badges={
            <>
              <span className="settings-shell__pill settings-shell__pill--outline">المصدر: salons/main/users</span>
              <span className={`accounts-chip accounts-chip--${selectedRoleTone}`}>{getRoleLabel(uiRole)}</span>
            </>
          }
          actions={
            <>
              <button
                type="button"
                className="accounts-btn accounts-btn--primary"
                onClick={() => {
                  setCreateMsg("");
                  setCreateOpen(true);
                }}
              >
                حساب إداري جديد <span aria-hidden="true">+</span>
              </button>
              <button
                type="button"
                className="accounts-btn"
                disabled={usersLoading}
                onClick={() => void loadUsers({ runRepair: true })}
              >
                {usersLoading ? "جارِ التحديث..." : "تحديث القائمة"}
              </button>
            </>
          }
          compact
        />

        <section className="accounts-hero">
          <article className="accounts-hero__summary accounts-hero__summary--dark">
            <span className="accounts-eyebrow">حسابات الإدارة</span>
            <h1>إدارة الوصول</h1>
            <p>لوحة طولية منظمة لمتابعة الحسابات الإدارية، الدعوات، وربط الأدوار من واجهة واحدة واضحة وسريعة القراءة.</p>
            <div className="accounts-hero__summary-list">
              {heroHighlights.map((item) => (
                <div key={item.label} className="accounts-hero__summary-item">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.hint}</small>
                </div>
              ))}
            </div>
          </article>

          <div className="accounts-hero__copy">
            <span className="accounts-hero__badge">وصول الإدارة</span>
            <h2>حسابات الإدارة</h2>
            <p>إدارة الحسابات والدعوات والصلاحيات من تبويب واحد، مع عرض واضح للحالة الحالية والروابط الفعلية بين الحسابات والموظفين.</p>
            <div className="accounts-hero__chips">
              <span className="accounts-chip accounts-chip--gold">إجمالي: {stats.total}</span>
              <span className="accounts-chip accounts-chip--mint">نشطة: {stats.active}</span>
              <span className="accounts-chip accounts-chip--blue">دعوات: {inviteStats.active}</span>
              <span className="accounts-chip accounts-chip--slate">استثناءات: {exceptionCount}</span>
            </div>
          </div>
        </section>

        <section className="accounts-section accounts-invites">
          <div className="accounts-section__head">
            <div>
              <span className="accounts-section__eyebrow">دعوات الأدوار</span>
              <h2>دعوات الأدوار</h2>
              <p>اربط دورًا ببريد إلكتروني ليُطبّق تلقائيًا عند تسجيل الدخول أو إنشاء الحساب.</p>
            </div>
            <div className="accounts-section__chips">
              <span className="accounts-chip accounts-chip--gold">فعالة: {inviteStats.active}</span>
              <span className="accounts-chip accounts-chip--soft">مستخدمة: {inviteStats.used}</span>
            </div>
          </div>

          <div className="accounts-invites__grid">
            <article className="accounts-panel accounts-panel--invite">
              <div className="accounts-panel__head">
                <div>
                  <span className="accounts-kicker">دعوة جديدة</span>
                  <h3>حفظ دعوة دور</h3>
                  <p>تستخدم نفس collection والدخول التلقائي الموجودين أصلًا في التطبيق دون تغيير المنطق.</p>
                </div>
                <div className="accounts-panel__metric">
                  <span>ROLE</span>
                  <strong>{inviteDraft.role.toUpperCase()}</strong>
                </div>
              </div>

              <div className="accounts-form-grid">
                <label className="accounts-field">
                  <span>البريد</span>
                  <input
                    value={inviteDraft.email}
                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="name@malikat.com"
                  />
                </label>

                <label className="accounts-field">
                  <span>الدور</span>
                  <select
                    value={inviteDraft.role}
                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, role: e.target.value as UiRole }))}
                  >
                    {isOwner ? <option value="owner">Owner</option> : null}
                    <option value="admin">Admin</option>
                    <option value="hr">HR</option>
                    <option value="reception">Reception</option>
                    <option value="staff">Staff</option>
                  </select>
                </label>

                <label className="accounts-field accounts-field--wide">
                  <span>ملاحظات اختيارية</span>
                  <textarea
                    value={inviteDraft.notes}
                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="ملاحظات داخلية أو تعليمات خاصة..."
                  />
                </label>
              </div>

              <div className="accounts-permission-preview">
                <span>الصلاحيات المتوقعة لهذا الدور</span>
                <div className="accounts-permission-preview__chips">
                  {invitePreviewPermissions.slice(0, 4).map((permission) => (
                    <span key={permission.key} className="accounts-permission-preview__chip">
                      {permission.label}
                    </span>
                  ))}
                  {invitePreviewPermissions.length > 4 ? (
                    <span className="accounts-permission-preview__chip accounts-permission-preview__chip--more">
                      +{invitePreviewPermissions.length - 4}
                    </span>
                  ) : null}
                  {!invitePreviewPermissions.length ? (
                    <span className="accounts-permission-preview__empty">لا توجد صلاحيات</span>
                  ) : null}
                </div>
              </div>

              <div className="accounts-modal__footer accounts-modal__footer--inline">
                <button
                  type="button"
                  className="accounts-btn"
                  disabled={inviteSaving || invitesLoading}
                  onClick={() => setInviteDraft({ email: "", role: "staff", notes: "" })}
                >
                  إعادة ضبط
                </button>
                <button
                  type="button"
                  className="accounts-btn accounts-btn--primary"
                  disabled={inviteSaving}
                  onClick={handleCreateInvite}
                >
                  {inviteSaving ? "جاري الحفظ..." : "حفظ الدعوة"}
                </button>
              </div>
            </article>

            <article className="accounts-panel accounts-panel--invite-list">
              <div className="accounts-panel__head">
                <div>
                  <span className="accounts-kicker">الدعوات الحالية</span>
                  <h3>الدعوات الحالية</h3>
                  <p>تظهر هنا الدعوات غير المستخدمة أو المستخدمة مع حالة كل دعوة.</p>
                </div>
                <div className="accounts-panel__metric">
                  <span>OPEN</span>
                  <strong>{inviteStats.active}</strong>
                </div>
              </div>

              {invitesLoading ? (
                <div className="accounts-inline-note">تحميل الدعوات…</div>
              ) : invites.length ? (
                <div className="accounts-invite-list">
                  {invites.map((invite) => {
                    const inviteTone = invite.used ? "gray" : invite.active !== false ? "mint" : "amber";
                    const inviteState = invite.used ? "مستخدمة" : invite.active !== false ? "فعالة" : "متوقفة";

                    return (
                      <article key={invite.id} className="accounts-invite-card">
                        <div className="accounts-invite-card__head">
                          <div>
                            <strong>{invite.email}</strong>
                            <span>{formatDate(invite.createdAt)}</span>
                          </div>
                          <div className="accounts-card__badgeStack">
                            <span className={`accounts-chip accounts-chip--${getRoleTone(invite.role)}`}>
                              {getRoleLabel(invite.role)}
                            </span>
                            <span className={`accounts-chip accounts-chip--state accounts-chip--${inviteTone}`}>
                              {inviteState}
                            </span>
                          </div>
                        </div>

                        <p>{invite.notes || "لا توجد ملاحظات مرتبطة بهذه الدعوة."}</p>

                        <div className="accounts-invite-card__footer">
                          <span className="accounts-chip accounts-chip--soft">ID: {invite.id}</span>
                          <span className="accounts-chip accounts-chip--soft">
                            {invite.used ? "تم التطبيق" : "تنتظر التسجيل"}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="accounts-empty-state">
                  <strong>لا توجد دعوات محفوظة حتى الآن</strong>
                  <p>أنشئ دعوة جديدة من البطاقة المجاورة، ثم ستظهر هنا بمجرد حفظها.</p>
                </div>
              )}
            </article>
          </div>
        </section>

        <section className="accounts-section accounts-guide">
          <div className="accounts-section__head">
            <div>
              <span className="accounts-section__eyebrow">دليل الحسابات الإدارية</span>
              <h2>دليل الحسابات الإدارية</h2>
              <p>مراجعة سريعة للحالة الحالية، متوسط الصلاحيات، والاستثناءات التي تحتاج انتباهًا.</p>
            </div>
            <button
              type="button"
              className="accounts-btn accounts-btn--primary"
              onClick={() => {
                setCreateMsg("");
                setCreateOpen(true);
              }}
            >
              حساب إداري جديد <span aria-hidden="true">+</span>
            </button>
          </div>

          <div className="accounts-guide__grid">
            <article className="accounts-guide-card">
              <span>الإجمالي</span>
              <strong>{stats.total}</strong>
              <small>كل الحسابات الإدارية الظاهرة في المصدر الحالي.</small>
            </article>
            <article className="accounts-guide-card">
              <span>النشطة</span>
              <strong>{stats.active}</strong>
              <small>الحسابات المفعلة والمسموح لها بالعمل الآن.</small>
            </article>
            <article className="accounts-guide-card">
              <span>متوسط الصلاحيات</span>
              <strong>{averagePermissions}</strong>
              <small>مؤشر سريع لمدى اتساع الأدوار الفعلية داخل الحسابات.</small>
            </article>
            <article className="accounts-guide-card">
              <span>الاستثناءات</span>
              <strong>{exceptionCount}</strong>
              <small>حسابات عليها ملاحظات أو بانتظار مراجعة إدارية.</small>
            </article>
          </div>
        </section>

        {createMsg ? <div className={`accounts-banner accounts-banner--${bannerTone}`}>{createMsg}</div> : null}

        <section className="accounts-directory">
          <div className="accounts-toolbar">
            <label className="accounts-search">
              <span>بحث</span>
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث باسم الموظفة أو البريد"
              />
            </label>

            <div className="accounts-toolbar__row">
              <label className="accounts-filter">
                <span>الدور</span>
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as UiRole | "all")}>
                  <option value="all">الكل</option>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="hr">HR</option>
                  <option value="reception">Reception</option>
                  <option value="staff">Staff</option>
                  <option value="pending">Pending</option>
                </select>
              </label>

              <label className="accounts-filter">
                <span>الحالة</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | "active" | "inactive" | "pending")}
                >
                  <option value="all">الكل</option>
                  <option value="active">نشطة</option>
                  <option value="pending">قيد المراجعة</option>
                  <option value="inactive">غير نشطة</option>
                </select>
              </label>
            </div>

            <button
              type="button"
              className="accounts-btn accounts-btn--ghost"
              onClick={() => {
                setSearchQuery("");
                setRoleFilter("all");
                setStatusFilter("all");
              }}
            >
              إعادة ضبط الفلاتر
            </button>
          </div>

          <div className="accounts-list">
            {usersLoading ? <div className="accounts-inline-note">تحميل الحسابات…</div> : null}

            {!usersLoading && !visibleUsers.length ? (
              <div className="accounts-empty-state">
                <strong>لا توجد نتائج</strong>
                <p>جرّب تغيير الفلاتر أو تحديث القائمة من الأعلى.</p>
              </div>
            ) : null}

            {visibleUsers.map((row) => {
              const state = getUserState(row);
              const rowPermissions = getUserPermissions(row);
              const effectiveCount = rowPermissions.length;
              const rowCanMutate = canEditTargetUser(row) && row.uid !== currentUid;
              const rowBlockedMessage =
                row.uid === currentUid
                  ? "لا يمكن تعديل الحساب المستخدم حاليًا من هذه البطاقة."
                  : "لا تملك صلاحية تعديل هذا الحساب.";
              const rowInitial = cleanText(row.displayName || row.email || row.uid).slice(0, 1) || "?";

              return (
                <article
                  key={row.uid}
                  className="accounts-card"
                >
                  <div className="accounts-card__aside">
                    <div className="accounts-card__avatar">{rowInitial}</div>
                    <div className="accounts-card__metric">
                      <span>EFFECTIVE</span>
                      <strong>{effectiveCount}</strong>
                    </div>
                  </div>

                  <div className="accounts-card__body">
                    <div className="accounts-card__top">
                      <div>
                        <strong>{row.displayName || "بدون اسم"}</strong>
                        <span>{row.email || "لا يوجد بريد"}</span>
                      </div>

                      <div className="accounts-card__badgeStack">
                        <span className={`accounts-chip accounts-chip--${getRoleTone(row.role)}`}>{getRoleLabel(row.role)}</span>
                        <span className={`accounts-chip accounts-chip--state accounts-chip--${state}`}>
                          {state === "active" ? "نشطة" : state === "pending" ? "قيد المراجعة" : "غير نشطة"}
                        </span>
                      </div>
                    </div>

                    <div className="accounts-card__miniGrid">
                      <div className="accounts-card__mini">
                        <span>الحالة</span>
                        <strong>{state === "active" ? "مفعلة" : state === "pending" ? "مراجعة" : "معطلة"}</strong>
                      </div>
                      <div className="accounts-card__mini">
                        <span>الدور</span>
                        <strong>{getRoleLabel(row.role)}</strong>
                      </div>
                      <div className="accounts-card__mini">
                        <span>استثناءات</span>
                        <strong>{row.notes ? "ملاحظة" : "لا توجد"}</strong>
                      </div>
                    </div>

                    <p>{row.notes || "لا توجد ملاحظات مرتبطة بهذا الحساب."}</p>

                    <div className="accounts-card__perms">
                      {PERMISSION_META.filter((permission) => rowPermissions.includes(permission.key)).slice(0, 4).map((permission) => (
                        <span key={permission.key} className="accounts-permission-preview__chip">
                          {permission.label}
                        </span>
                      ))}
                      {rowPermissions.length > 4 ? (
                        <span className="accounts-permission-preview__chip accounts-permission-preview__chip--more">
                          +{rowPermissions.length - 4}
                        </span>
                      ) : null}
                    </div>

                    <div className="accounts-card__footer">
                      <span className="accounts-chip accounts-chip--soft">ID: {row.uid}</span>
                      <span className="accounts-chip accounts-chip--soft">{row.phone || "بدون هاتف"}</span>
                    </div>
                  </div>

                  <div className="accounts-card__actions">
                    <button
                      type="button"
                      className="accounts-btn accounts-btn--primary"
                      aria-disabled={!rowCanMutate}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!rowCanMutate) {
                          toastMsg(rowBlockedMessage, 2200);
                          return;
                        }
                        setSelectedUserId(row.uid);
                        openEditUser(row);
                      }}
                    >
                      تعديل
                    </button>
                    <button
                      type="button"
                      className="accounts-btn"
                      aria-disabled={!rowCanMutate}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!rowCanMutate) {
                          toastMsg(rowBlockedMessage, 2200);
                          return;
                        }
                        toggleUserActive(row.uid, !(row.active !== false));
                      }}
                    >
                      {row.active !== false ? "تعطيل" : "تفعيل"}
                    </button>
                    <button
                      type="button"
                      className="accounts-btn accounts-btn--danger"
                      disabled={usersLoading}
                      aria-disabled={!rowCanMutate || usersLoading}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!rowCanMutate) {
                          toastMsg(rowBlockedMessage, 2200);
                          return;
                        }
                        deleteUserAccount(row.uid);
                      }}
                    >
                      حذف
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      {createOpen ? (
        <div className="accounts-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="accounts-modal__backdrop"
            aria-label="إغلاق"
            onClick={() => setCreateOpen(false)}
          />

          <div className="accounts-modal__card accounts-modal__card--split">
            <div className="accounts-modal__head">
              <div>
                <span className="accounts-eyebrow">حساب جديد</span>
                <h2>إنشاء حساب إداري جديد</h2>
                <p>أضف حسابًا إداريًا جديدًا وحدد الدور والبيانات الأساسية من شاشة منظمة وواسعة.</p>
              </div>

              <button type="button" className="accounts-modal__close" onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </div>

            <div className="accounts-modal__body">
              <aside className="accounts-modal__sidebar">
                <article className="accounts-modal__sidebar-card accounts-modal__sidebar-card--dark">
                  <span className="accounts-kicker">ملخص الإنشاء</span>
                  <h3>حساب إداري جديد</h3>
                  <p>سيُنشأ حساب Firebase Auth أولًا ثم يُحفظ الملف داخل `salons/main/users`، مع ربط الموظف تلقائيًا إذا كان الدور ضمن الطاقم.</p>
                  <div className="accounts-modal__summary-list">
                    <div className="accounts-modal__summary-item">
                      <span>الدور الحالي</span>
                      <strong>{createForm.role.toUpperCase()}</strong>
                    </div>
                    <div className="accounts-modal__summary-item">
                      <span>الصلاحيات</span>
                      <strong>{createPermissionCount}</strong>
                    </div>
                    <div className="accounts-modal__summary-item">
                      <span>المصدر</span>
                      <strong>salons/main/users</strong>
                    </div>
                  </div>
                </article>

                <article className="accounts-modal__sidebar-card">
                  <span className="accounts-kicker">ملاحظات</span>
                  <p>البريد يجب أن ينتهي بـ @malikat.com، والدور Owner يبقى متاحًا فقط للمالك.</p>
                </article>
              </aside>

              <div className="accounts-modal__main">
                <div className="accounts-form-grid">
                  <label className="accounts-field">
                    <span>الاسم</span>
                    <input
                      value={createForm.displayName}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, displayName: e.target.value }))}
                      placeholder="مثال: أ. نور"
                    />
                  </label>

                  <label className="accounts-field">
                    <span>البريد</span>
                    <input
                      value={createForm.email}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder="name@malikat.com"
                    />
                  </label>

                  <label className="accounts-field">
                    <span>كلمة المرور</span>
                    <input
                      type="password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder="******"
                    />
                  </label>

                  <label className="accounts-field">
                    <span>الهاتف</span>
                    <input
                      value={createForm.phone}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="05xxxxxxxx"
                    />
                  </label>

                  <label className="accounts-field">
                    <span>الدور</span>
                    <select
                      value={createForm.role}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, role: e.target.value as UiRole }))}
                    >
                      {isOwner ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="hr">HR</option>
                      <option value="reception">Reception</option>
                      <option value="staff">Staff</option>
                    </select>
                  </label>

                  <label className="accounts-field accounts-field--wide">
                    <span>ملاحظات</span>
                    <textarea
                      value={createForm.notes}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="ملاحظات تشغيلية أو تعليمات خاصة..."
                    />
                  </label>
                </div>

                <div className="accounts-permission-preview">
                  <span>الصلاحيات المتوقعة لهذا الدور</span>
                  <div className="accounts-permission-preview__chips">
                    {PERMISSION_META.filter((item) => getRoleAppPermissions(createForm.role as any).includes(item.key)).map((permission) => (
                      <span key={permission.key} className="accounts-permission-preview__chip">
                        {permission.label}
                      </span>
                    ))}
                    {!createPermissionCount ? (
                      <span className="accounts-permission-preview__empty">لا توجد صلاحيات</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="accounts-modal__footer">
              <button
                type="button"
                className="accounts-btn"
                onClick={() => {
                  setCreateOpen(false);
                  setCreateForm({ displayName: "", email: "", password: "", phone: "", notes: "", role: "staff" });
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="accounts-btn accounts-btn--primary"
                disabled={createLoading}
                onClick={handleCreateUser}
              >
                {createLoading ? "جاري الإنشاء..." : "حفظ الحساب"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editDraft ? (
        <div className="accounts-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="accounts-modal__backdrop"
            aria-label="إغلاق"
            onClick={() => setEditDraft(null)}
          />

          <div className="accounts-modal__card accounts-modal__card--split accounts-modal__card--edit">
            <div className="accounts-modal__head">
              <div>
                <span className="accounts-eyebrow">تعديل حساب</span>
                <h2>تعديل {editDraft.displayName || editDraft.email || "الحساب"}</h2>
                <p>يمكن تعديل الاسم، الهاتف، الدور، الحالة، والملاحظات من شاشة مرتبة وواسعة.</p>
              </div>

              <button type="button" className="accounts-modal__close" onClick={() => setEditDraft(null)}>
                ×
              </button>
            </div>

            <div className="accounts-modal__body">
              <aside className="accounts-modal__sidebar">
                <article className="accounts-modal__sidebar-card accounts-modal__sidebar-card--dark">
                  <span className="accounts-kicker">ملخص الحساب</span>
                  <div className="accounts-profile accounts-profile--modal">
                    <div className="accounts-avatar">
                      {cleanText(selectedUser?.displayName || selectedUser?.email || selectedUser?.uid).slice(0, 1) ||
                        "?"}
                    </div>

                    <div className="accounts-profile__copy">
                      <div className="accounts-inline-tags">
                        <span className={`accounts-chip accounts-chip--${selectedRoleTone}`}>{selectedRoleLabel}</span>
                        <span className={`accounts-chip accounts-chip--state accounts-chip--${selectedState}`}>
                          {selectedStateLabel}
                        </span>
                        <span className="accounts-chip accounts-chip--soft">ID: {editDraft.uid}</span>
                      </div>

                      <div className="accounts-modal__summary-list">
                        <div className="accounts-modal__summary-item">
                          <span>البريد</span>
                          <strong>{editDraft.email || "—"}</strong>
                        </div>
                        <div className="accounts-modal__summary-item">
                          <span>الصلاحيات</span>
                          <strong>{editDraft.permissions.length}</strong>
                        </div>
                        <div className="accounts-modal__summary-item">
                          <span>الحالة</span>
                          <strong>{editDraft.active ? "نشط" : "غير نشط"}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>

                <article className="accounts-modal__sidebar-card">
                  <span className="accounts-kicker">ملاحظات التعديل</span>
                  <p>البريد مرتبط بحساب Firebase Auth لذلك يظهر للقراءة فقط، بينما بقية الحقول قابلة للتعديل.</p>
                </article>
              </aside>

              <div className="accounts-modal__main">
                <div className="accounts-form-grid">
                  <label className="accounts-field">
                    <span>الاسم</span>
                    <input
                      value={editDraft.displayName}
                      onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, displayName: e.target.value } : prev))}
                    />
                  </label>

                  <label className="accounts-field">
                    <span>البريد</span>
                    <input value={editDraft.email} readOnly />
                  </label>

                  <label className="accounts-field">
                    <span>الهاتف</span>
                    <input
                      value={editDraft.phone}
                      onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, phone: e.target.value } : prev))}
                    />
                  </label>

                  <label className="accounts-field">
                    <span>الدور</span>
                    <select
                      value={editDraft.role}
                      onChange={(e) =>
                        setEditDraft((prev) => {
                          if (!prev) return prev;
                          const role = e.target.value as UiRole;
                          return {
                            ...prev,
                            role,
                            active: role === "pending" ? false : prev.active,
                            permissions: getRoleAppPermissions(role as any),
                          };
                        })
                      }
                      disabled={!canEditTargetUser(selectedUser)}
                    >
                      {isOwner ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="hr">HR</option>
                      <option value="reception">Reception</option>
                      <option value="staff">Staff</option>
                      <option value="pending">Pending</option>
                    </select>
                  </label>

                  <label className="accounts-field accounts-field--switch">
                    <span>الحالة</span>
                    <div className="accounts-switch">
                      <input
                        type="checkbox"
                        checked={editDraft.active}
                        onChange={(e) =>
                          setEditDraft((prev) => (prev ? { ...prev, active: e.target.checked } : prev))
                        }
                        disabled={!canEditTargetUser(selectedUser)}
                      />
                      <span>{editDraft.active ? "نشط" : "غير نشط"}</span>
                    </div>
                  </label>

                  <label className="accounts-field accounts-field--wide">
                    <span>ملاحظات</span>
                    <textarea
                      value={editDraft.notes}
                      onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                    />
                  </label>
                </div>

                <section className="accounts-permissions-editor">
                  <div className="accounts-permissions-editor__head">
                    <div>
                      <span className="accounts-kicker">الصلاحيات الفعلية</span>
                      <h3>مفاتيح الوصول الجديدة</h3>
                      <p>اضغط على أي صلاحية لإضافتها أو إيقافها كاستثناء على الدور الأساسي.</p>
                    </div>
                    <div className="accounts-permissions-editor__stats">
                      <span>الدور: {editRoleDefaultPermissions.length}</span>
                      <span>الفعلية: {editDraft.permissions.length}</span>
                      <span>الاستثناءات: {editAddedPermissions + editDisabledDefaults}</span>
                    </div>
                  </div>

                  <div className="accounts-permissions-editor__grid">
                    {PERMISSION_META.map((permission) => {
                      const isEnabled = editPermissionSet.has(permission.key);
                      const isDefault = editRoleDefaultPermissions.includes(permission.key);
                      const isAdded = isEnabled && !isDefault;
                      const isDisabledDefault = !isEnabled && isDefault;

                      return (
                        <button
                          key={permission.key}
                          type="button"
                          className={[
                            "accounts-permission-toggle",
                            isEnabled ? "is-on" : "is-off",
                            isDefault ? "is-default" : "",
                            isAdded ? "is-added" : "",
                            isDisabledDefault ? "is-disabled-default" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          disabled={!canEditTargetUser(selectedUser)}
                          onClick={() =>
                            setEditDraft((prev) => {
                              if (!prev) return prev;
                              const current = new Set(prev.permissions);
                              if (current.has(permission.key)) current.delete(permission.key);
                              else current.add(permission.key);
                              const permissions = PERMISSION_META
                                .map((item) => item.key)
                                .filter((key) => current.has(key));
                              return { ...prev, permissions };
                            })
                          }
                        >
                          <span className="accounts-permission-toggle__dot" aria-hidden="true" />
                          <span className="accounts-permission-toggle__copy">
                            <strong>{permission.label}</strong>
                            <small>{permission.key}</small>
                            <em>{permission.hint}</em>
                          </span>
                          <span className="accounts-permission-toggle__state">
                            {isAdded ? "استثناء مضاف" : isDisabledDefault ? "متوقف" : isDefault ? "ضمن الدور" : isEnabled ? "مفعلة" : "غير مفعلة"}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="accounts-permissions-editor__actions">
                    <button
                      type="button"
                      className="accounts-btn"
                      disabled={!canEditTargetUser(selectedUser)}
                      onClick={() =>
                        setEditDraft((prev) =>
                          prev ? { ...prev, permissions: getRoleAppPermissions(prev.role as any) } : prev
                        )
                      }
                    >
                      استعادة صلاحيات الدور
                    </button>
                  </div>
                </section>
              </div>
            </div>

            <div className="accounts-modal__footer">
              <button type="button" className="accounts-btn" onClick={() => setEditDraft(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="accounts-btn accounts-btn--primary"
                disabled={usersLoading}
                onClick={() => void saveEditedUser()}
              >
                {usersLoading ? "جاري الحفظ..." : "حفظ التعديلات"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </div>
  );
}
