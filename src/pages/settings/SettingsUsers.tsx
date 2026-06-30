// ✅ src/pages/settings/SettingsUsers.tsx
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
import { can, type Permission } from "../../helpers/permissions";
import {
  findStaffMatchesForUser,
  listStaffLinkRows,
  repairLegacyStaffUserLinks,
  softDeleteLinkedStaffByUser,
  type AccountUserLinkRow,
} from "../../services/staffAccountLinkService";
import { SettingsPageHeader, SettingsState, SettingsStats } from "./SettingsFrame";

import "../../styles/DashboardModals.css";
import "../../styles/stylesSettings/SettingsCatalog.css"; // ✅ NEW CSS
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
};

const PERMISSION_META: Array<{ key: Permission; label: string; hint: string }> = [
  { key: "BOOKINGS_VIEW", label: "عرض لوحة الحجوزات", hint: "الدخول على قائمة الحجوزات ومتابعة الحالات." },
  { key: "BOOKINGS_UPDATE_STATUS", label: "تحديث حالة الحجز", hint: "تغيير الحالة وإدارة مرحلة التنفيذ." },
  { key: "BOOKINGS_ADD_NOTES", label: "إضافة ملاحظات", hint: "تسجيل ملاحظات تشغيلية داخل الحجز." },
  { key: "EMPLOYEES_MANAGE", label: "إدارة الموظفات", hint: "عرض وتعديل ملفات الموظفات وبياناتهن." },
  { key: "SERVICES_MANAGE", label: "إدارة الخدمات", hint: "تعديل الأقسام والخدمات والكتالوج." },
  { key: "OFFERS_MANAGE", label: "إدارة العروض", hint: "إنشاء وتحديث العروض الترويجية." },
  { key: "REPORTS_VIEW", label: "عرض التقارير", hint: "الوصول إلى ملخصات الأداء والتقارير." },
  { key: "SETTINGS_MANAGE", label: "إدارة الإعدادات", hint: "ضبط إعدادات المنصة والتشغيل." },
  { key: "USERS_MANAGE", label: "إدارة الحسابات", hint: "إنشاء الحسابات وتعديل صلاحياتها." },
];

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

  function formatDate(value: any) {
    if (!value) return "—";
    try {
      const date =
        typeof value?.toDate === "function"
          ? value.toDate()
          : value?.seconds
            ? new Date(value.seconds * 1000)
            : new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return new Intl.DateTimeFormat("ar-SA", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch {
      return "—";
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
        const baseRow: UserRow = {
          uid: d.id,
          email: String(x?.email || ""),
          phone: String(x?.phone || ""),
          displayName: String(x?.displayName || x?.name || ""),
          role: mapFirestoreRoleToUi(x?.role),
          active: x?.active !== false,
          notes: String(x?.notes || x?.memo || ""),
          linkedEmployeeDocId: String(x?.linkedEmployeeDocId || ""),
          employeeId: String(x?.employeeId || ""),
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
          return { ...u, role: fixedRole };
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
            linkedEmployeeDocId: uid,
            employeeId: uid,
          },
          role,
          active: true,
          displayName,
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

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        {
          role: toFirestoreRole(newRole),
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
          linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
          employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
        },
        role: newRole,
        active: nextActive,
        displayName: name,
        createIfMissing: isEmployeeRole(newRole),
      });

      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, role: newRole, active: nextActive } : u))
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
            linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
            employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
          },
          role: row?.role || "staff",
          active,
          displayName: row?.displayName || "",
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
            linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
            employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
          },
          role: roleNow,
          active: row?.active !== false,
          displayName: name,
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
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || "",
          employeeId: row.employeeId || row.linkedEmployeeDocId || "",
        },
        role,
        active,
        displayName,
        createIfMissing: isEmployeeRole(role),
      });

      await setDoc(
        doc(db, ...USERS_COLLECTION, row.uid),
        {
          displayName,
          phone,
          notes,
          role: nextRole,
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
        },
        after: {
          displayName,
          phone,
          role,
          active,
          notes: notes || null,
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

  const selectedPermissions = useMemo(() => {
    if (!selectedUser) return [];
    return PERMISSION_META.filter((item) => can(item.key, selectedUser.role as any));
  }, [selectedUser]);

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => getUserState(user) === "active").length;
    const inactive = users.filter((user) => getUserState(user) === "inactive").length;
    const pending = users.filter((user) => getUserState(user) === "pending").length;
    const editors = users.filter((user) => ["owner", "hr", "admin"].includes(user.role)).length;

    return { total, active, inactive, pending, editors };
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
  const selectedRoleLabel = selectedUser ? getRoleLabel(selectedUser.role) : "—";
  const selectedRoleTone = selectedUser ? getRoleTone(selectedUser.role) : "gray";
  const selectedPermissionCount = selectedPermissions.length;
  const createPermissionCount = PERMISSION_META.filter((item) => can(item.key, createForm.role as any)).length;
  const currentUid = String((auth as any)?.currentUser?.uid || "");
  const selectedIsSelf = Boolean(selectedUser && selectedUser.uid === currentUid);
  const selectedCanMutate = Boolean(selectedUser && !selectedIsSelf && canEditTargetUser(selectedUser));

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

        <SettingsStats
          items={[
            {
              label: "إجمالي الحسابات",
              value: stats.total,
              hint: "كل الحسابات الظاهرة من مصدر البيانات.",
            },
            {
              label: "نشطة",
              value: stats.active,
              hint: "الحسابات المفعلة حاليًا.",
            },
            {
              label: "قيد المراجعة",
              value: stats.pending,
              hint: "الحسابات التي ما زالت Pending.",
            },
            {
              label: "غير نشطة",
              value: stats.inactive,
              hint: "الحسابات المعطلة أو المؤرشفة.",
            },
          ]}
        />

        {createMsg ? <div className="accounts-banner">{createMsg}</div> : null}

        <div className="accounts-workspace settings-master-detail settings-master-detail--accounts">
          <div className="settings-card settings-master-detail__detail accounts-detail-card">
          {selectedUser ? (
            <>
              <div className="accounts-panel__head">
                <div>
                  <span className="accounts-kicker">ملف الحساب</span>
                  <h2>{selectedUser.displayName || "بدون اسم"}</h2>
                  <p>{selectedUser.email || "لا يوجد بريد مرتبط"}</p>
                </div>

                <div className="accounts-panel__metric">
                  <span>EFFECTIVE</span>
                  <strong>{selectedPermissionCount}</strong>
                </div>
              </div>

              <div className="accounts-profile">
                <div className="accounts-avatar">
                  {cleanText(selectedUser.displayName || selectedUser.email || selectedUser.uid).slice(0, 1) || "?"}
                </div>

                <div className="accounts-profile__copy">
                  <div className="accounts-inline-tags">
                    <span className={`accounts-chip accounts-chip--${selectedRoleTone}`}>{selectedRoleLabel}</span>
                    <span className={`accounts-chip accounts-chip--state accounts-chip--${selectedState}`}>
                      {selectedStateLabel}
                    </span>
                    <span className="accounts-chip accounts-chip--soft">ID: {selectedUser.uid}</span>
                  </div>

                  <div className="accounts-meta-grid">
                    <div className="accounts-meta-card">
                      <span>البريد</span>
                      <strong>{selectedUser.email || "—"}</strong>
                    </div>
                    <div className="accounts-meta-card">
                      <span>الهاتف</span>
                      <strong>{selectedUser.phone || "—"}</strong>
                    </div>
                    <div className="accounts-meta-card">
                      <span>الربط الموظفي</span>
                      <strong>{selectedUser.linkedEmployeeDocId || selectedUser.employeeId || "—"}</strong>
                    </div>
                    <div className="accounts-meta-card">
                      <span>آخر تحديث</span>
                      <strong>{formatDate(selectedUser.updatedAt || selectedUser.createdAt)}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="accounts-notes">
                <div className="accounts-notes__head">
                  <span>الملاحظات</span>
                </div>
                <p>{selectedUser.notes || "لا توجد ملاحظات مرتبطة بهذا الحساب."}</p>
              </div>

              <div className="accounts-permissions">
                <div className="accounts-permissions__head">
                  <span>الصلاحيات الفعلية</span>
                  <small>
                    {selectedPermissionCount} صلاحية مفعلة من أصل {PERMISSION_META.length}
                  </small>
                </div>

                <div className="accounts-permissions__grid">
                  {selectedPermissions.map((permission) => (
                    <div key={permission.key} className="accounts-permission">
                      <strong>{permission.label}</strong>
                      <small>{permission.hint}</small>
                    </div>
                  ))}
                  {!selectedPermissions.length ? (
                    <div className="accounts-permissions__empty">
                      هذه الحساب لا يملك صلاحيات تشغيلية مفعلة.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="accounts-actions">
                <button
                  type="button"
                  className="accounts-btn accounts-btn--primary"
                  disabled={!selectedCanMutate}
                  onClick={() => selectedUser && openEditUser(selectedUser)}
                  title={!selectedCanMutate ? "تعديل حسابات المالك محجوز للمالك نفسه" : "تعديل الحساب"}
                >
                  تعديل
                </button>
                <button
                  type="button"
                  className="accounts-btn"
                  disabled={!selectedCanMutate}
                  onClick={() => selectedUser && toggleUserActive(selectedUser.uid, !(selectedUser.active !== false))}
                  title={!selectedCanMutate ? "تعديل حسابات المالك محجوز للمالك نفسه" : "تفعيل/تعطيل"}
                >
                  {selectedUser.active !== false ? "تعطيل" : "تفعيل"}
                </button>
                <button
                  type="button"
                  className="accounts-btn accounts-btn--danger"
                  disabled={!selectedCanMutate || usersLoading}
                  onClick={() => selectedUser && deleteUserAccount(selectedUser.uid)}
                  title={!selectedCanMutate ? "تعديل حسابات المالك محجوز للمالك نفسه" : "حذف الحساب"}
                >
                  حذف
                </button>
              </div>
            </>
          ) : (
            <div className="accounts-panel--detail-empty">
              <strong>اختر حسابًا من القائمة</strong>
              <p>سيظهر هنا ملخص الحساب وصلاحياته وحالته مع أزرار التعديل والحذف.</p>
            </div>
          )}
          </div>

          <div className="settings-card accounts-sidebar-card settings-master-detail__list">
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
              const effectiveCount = PERMISSION_META.filter((permission) => can(permission.key, row.role as any)).length;
              const isSelected = row.uid === selectedUserId;

              return (
                <button
                  type="button"
                  key={row.uid}
                  className={`accounts-card ${isSelected ? "is-selected" : ""}`}
                  onClick={() => setSelectedUserId(row.uid)}
                >
                  <div className="accounts-card__metric">
                    <span>EFFECTIVE</span>
                    <strong>{effectiveCount}</strong>
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

                    <p>{row.notes || "لا توجد ملاحظات مرتبطة بهذا الحساب."}</p>

                    <div className="accounts-card__footer">
                      <span className="accounts-chip accounts-chip--soft">ID: {row.uid}</span>
                      <span className="accounts-chip accounts-chip--soft">{row.phone || "بدون هاتف"}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {createOpen ? (
        <div className="accounts-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="accounts-modal__backdrop"
            aria-label="إغلاق"
            onClick={() => setCreateOpen(false)}
          />

          <div className="accounts-modal__card">
            <div className="accounts-modal__head">
              <div>
                <span className="accounts-eyebrow">حساب جديد</span>
                <h2>إنشاء حساب إداري جديد</h2>
                <p>سيتم إنشاء حساب Firebase Auth ثم حفظ البيانات داخل `salons/main/users`.</p>
              </div>

              <button type="button" className="accounts-modal__close" onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </div>

            <div className="accounts-form-grid">
              <label className="accounts-field">
                <span>الاسم</span>
                <input
                  value={createForm.displayName}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, displayName: e.target.value }))}
                  placeholder="مثال: أ. نوف"
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
                {PERMISSION_META.filter((item) => can(item.key, createForm.role as any)).map((permission) => (
                  <span key={permission.key} className="accounts-permission-preview__chip">
                    {permission.label}
                  </span>
                ))}
                {!createPermissionCount ? <span className="accounts-permission-preview__empty">لا توجد صلاحيات</span> : null}
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

          <div className="accounts-modal__card accounts-modal__card--edit">
            <div className="accounts-modal__head">
              <div>
                <span className="accounts-eyebrow">تعديل حساب</span>
                <h2>تعديل {editDraft.displayName || editDraft.email || "الحساب"}</h2>
                <p>يمكن تعديل الاسم، الهاتف، الدور، الحالة، والملاحظات. البريد ظاهر فقط لأنه مرتبط بحساب Firebase Auth.</p>
              </div>

              <button type="button" className="accounts-modal__close" onClick={() => setEditDraft(null)}>
                ×
              </button>
            </div>

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
                    setEditDraft((prev) => (prev ? { ...prev, role: e.target.value as UiRole } : prev))
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

            <div className="accounts-permission-preview">
              <span>الصلاحيات الفعلية حسب الدور الحالي</span>
              <div className="accounts-permission-preview__chips">
                {PERMISSION_META.filter((item) => can(item.key, editDraft.role as any)).map((permission) => (
                  <span key={permission.key} className="accounts-permission-preview__chip">
                    {permission.label}
                  </span>
                ))}
                {!PERMISSION_META.filter((item) => can(item.key, editDraft.role as any)).length ? (
                  <span className="accounts-permission-preview__empty">لا توجد صلاحيات</span>
                ) : null}
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
