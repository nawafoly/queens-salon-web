// ✅ src/pages/settings/SettingsUsers.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
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
  findStaffMatchesForUser,
  listStaffLinkRows,
  repairLegacyStaffUserLinks,
  softDeleteLinkedStaffByUser,
  type AccountUserLinkRow,
} from "../../services/staffAccountLinkService";

import "../../styles/DashboardModals.css";
import "../../styles/stylesSettings/SettingsCatalog.css"; // ✅ NEW CSS
import "../../styles/stylesSettings/DashboardSettings.css";

/* =========================
   Roles helpers
========================= */
type UiRole =
  | "owner"
  | "admin"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";

function mapFirestoreRoleToUi(roleRaw: string): UiRole {
  const role = String(roleRaw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
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
  linkedEmployeeDocId?: string;
  employeeId?: string;
  deletedAt?: any;
  createdAt?: any;
};

export default function SettingsUsers() {
  const navigate = useNavigate();

  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [authLoading, setAuthLoading] = useState(true);

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";

  // ✅ نقرأ allowAdminManageUsers من localStorage لكن “يتحدّث” مع settingsChanged
  const [allowAdminManageUsers, setAllowAdminManageUsers] = useState(false);

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
    // init
    setAllowAdminManageUsers(readAllowAdminManageUsers());

    // live updates (Dashboard يرسل settingsChanged)
    const onSettingsChanged = () => {
      setAllowAdminManageUsers(readAllowAdminManageUsers());
    };
    window.addEventListener("settingsChanged", onSettingsChanged);
    return () => window.removeEventListener("settingsChanged", onSettingsChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canManageUsers = useMemo(() => {
    return isOwner || (isAdmin && allowAdminManageUsers);
  }, [isOwner, isAdmin, allowAdminManageUsers]);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const [createForm, setCreateForm] = useState({
    displayName: "",
    email: "",
    password: "",
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

  const toastMsg = (msg: string, ms = 2200) => {
    setCreateMsg(msg);
    if (ms > 0) setTimeout(() => setCreateMsg(""), ms);
  };

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
    const isStaffRole = args.role === "staff";

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
        active: isStaffRole ? args.active : false,
        showOnAbout: isStaffRole ? existing?.showOnAbout !== false : false,
        showOnBooking: isStaffRole ? existing?.showOnBooking === true : false,
        removedFromStaff: false,
        employmentStatus: isStaffRole ? (args.active ? "active" : "inactive") : "inactive",
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
        isActive: isStaffRole ? args.active : false,
        active: isStaffRole ? args.active : false,
        showOnAbout: isStaffRole ? existing?.showOnAbout !== false : false,
        removedFromStaff: false,
        employmentStatus: isStaffRole ? (args.active ? "active" : "inactive") : "inactive",
        deletedAt: null,
        deletedBy: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

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
          linkedEmployeeDocId: String(x?.linkedEmployeeDocId || ""),
          employeeId: String(x?.employeeId || ""),
          deletedAt: x?.deletedAt,
          createdAt: x?.createdAt,
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
          role: toFirestoreRole(role),
          active: true,
          createdAt: serverTimestamp(),
          createdByUid: (auth as any)?.currentUser?.uid || "",
          createdByEmail: (auth as any)?.currentUser?.email || "",
        },
        { merge: true }
      );

      // ✅ لو Staff: جهّز staff_public + employees
      if (role === "staff") {
        await syncLinkedStaffFromUser({
          user: {
            uid,
            email,
            displayName,
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
      setCreateForm({ displayName: "", email: "", password: "", role: "staff" });

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

    // ✅ pending => active false / غير pending => active true
    const nextActive = newRole !== "pending";

    try {
      const row = users.find((x) => x.uid === uid);
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
        createIfMissing: newRole === "staff",
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

    try {
      const row = users.find((x) => x.uid === uid);
      const oldActive = row?.active !== false;

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { active, updatedAt: serverTimestamp() },
        { merge: true }
      );

      // ✅ لو هو Staff خله يتزامن مع staff_public/employees
      if (row?.role === "staff") {
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

    try {
      const row = users.find((x) => x.uid === uid);
      const oldName = String(row?.displayName || "").trim();

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { displayName: name, updatedAt: serverTimestamp() },
        { merge: true }
      );

      const roleNow = row?.role;

      if (roleNow === "staff") {
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

  /* =========================
     Auth + Role
  ========================= */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);
      try {
        if (!user) {
          setUiRole("guest");
          return;
        }

        const snap = await getDoc(doc(db, ...USERS_COLLECTION, user.uid));
        if (!snap.exists()) {
          setUiRole("guest");
          return;
        }

        setUiRole(mapFirestoreRoleToUi((snap.data() as any)?.role));
      } catch (e) {
        console.error("SettingsUsers role load error:", e);
        setUiRole("guest");
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!canManageUsers) return;
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageUsers]);

  const deleteUserAccount = async (uid: string) => {
    if (!canManageUsers) return;

    const row = users.find((x) => x.uid === uid);
    if (!row) return;

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

  /* =========================
     Render
  ========================= */
  if (authLoading) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <div className="settings-card">
            <h3 className="settings-title">جاري التحميل…</h3>
          </div>
        </div>
      </div>
    );
  }

  if (!canManageUsers) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <h3>غير مصرح</h3>
          <p>هذه الصفحة مخصصة للإدارة. (Owner أو Admin مع تفعيل السماح لإدارة الحسابات)</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-section settings-page">
      <div className="settings-wrap">
        <div className="settings-header">
          <div>
            <h1>إدارة الحسابات</h1>
            <p className="settings-hint">إنشاء حسابات الموظفات + تعديل الأدوار (عرض حسابات @malikat.com فقط)</p>
          </div>

          <div className="settings-save">
            <button className="dash-btn" type="button" onClick={() => navigate("/dashboard/settings/advanced")}>
              رجوع
            </button>

            <button
              type="button"
              className={`exp-btn ${usersLoading ? "is-disabled" : ""}`}
              disabled={usersLoading}
              onClick={() => void loadUsers({ runRepair: true })}
            >
              تحديث القائمة
            </button>
          </div>
        </div>

        {createMsg && (
          <div className="settings-note" style={{ marginBottom: 10 }}>
            {createMsg}
          </div>
        )}

        <div className="settings-card" style={{ marginTop: 0 }}>
          <h3 className="settings-title">إنشاء حساب جديد</h3>

          <div className="settings-grid" style={{ marginTop: 10 }}>
            <div className="settings-field">
              <label>الاسم</label>
              <input
                className="settings-input"
                value={createForm.displayName}
                onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
                placeholder="مثال: أمل"
                disabled={createLoading}
              />
            </div>

            <div className="settings-field">
              <label>الإيميل</label>
              <input
                className="settings-input"
                value={createForm.email}
                onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                placeholder="name@malikat.com"
                disabled={createLoading}
              />
            </div>

            <div className="settings-field">
              <label>كلمة المرور</label>
              <input
                className="settings-input"
                type="password"
                value={createForm.password}
                onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
                placeholder="******"
                disabled={createLoading}
              />
            </div>

            <div className="settings-field">
              <label>الدور</label>
              <select
                className="settings-input"
                value={createForm.role}
                onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value as UiRole }))}
                disabled={createLoading}
              >
                {isOwner && <option value="owner">Owner</option>}
                <option value="admin">Admin</option>
                <option value="reception">Reception</option>
                <option value="staff">Staff</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className={`exp-btn primary ${createLoading ? "is-disabled" : ""}`}
              disabled={createLoading}
              onClick={handleCreateUser}
            >
              {createLoading ? "جاري الإنشاء..." : "إنشاء الحساب"}
            </button>
          </div>

          <div className="settings-footnote">
            * مسموح فقط إنشاء حسابات بإيميلات <b>@malikat.com</b>
          </div>
        </div>

        <div className="settings-card">
          <h3 className="settings-title">الحسابات الحالية</h3>

          <div className="settings-list" style={{ marginTop: 12 }}>
            {usersLoading ? (
              <div className="settings-note">تحميل الحسابات…</div>
            ) : users.length === 0 ? (
              <div className="settings-note">لا توجد حسابات (أو لا تملك صلاحية القراءة).</div>
            ) : (
              users.map((u) => {
                const isSelf = (auth as any)?.currentUser?.uid === u.uid;

                return (
                  <div key={u.uid} className="settings-row" style={{ alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 220, display: "grid" }}>
                      <span style={{ fontWeight: 900 }}>{u.email || "بدون إيميل"}</span>
                      <span style={{ opacity: 0.75, fontSize: 12 }}>{u.uid}</span>
                    </div>

                    <input
                      className="settings-input"
                      style={{ minWidth: 200 }}
                      value={u.displayName}
                      disabled={isSelf}
                      onChange={(e) => {
                        const v = e.target.value;
                        setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, displayName: v } : x)));
                      }}
                      title={isSelf ? "لا يمكن تعديل اسم حسابك من هنا" : "اسم العرض"}
                    />

                    <button
                      type="button"
                      className={`exp-btn ${isSelf ? "is-disabled" : ""}`}
                      disabled={isSelf}
                      onClick={() => updateUserDisplayName(u.uid, u.displayName)}
                    >
                      حفظ الاسم
                    </button>

                    <select
                      className="settings-input"
                      style={{ width: 160 }}
                      value={u.role}
                      disabled={isSelf && u.role === "owner"}
                      onChange={(e) => updateUserRole(u.uid, e.target.value as UiRole)}
                      title={isSelf ? "لا يمكن تعديل دور حسابك من هنا" : "الدور"}
                    >
                      {isOwner && <option value="owner">Owner</option>}
                      <option value="admin">Admin</option>
                      <option value="reception">Reception</option>
                      <option value="staff">Staff</option>
                      <option value="pending">Pending</option>
                    </select>

                    <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                      <input
                        className="settings-check"
                        type="checkbox"
                        checked={u.active !== false}
                        disabled={isSelf}
                        onChange={() => toggleUserActive(u.uid, !(u.active !== false))}
                        title={isSelf ? "لا يمكن تعطيل حسابك من هنا" : "تفعيل/تعطيل"}
                      />
                      نشط
                    </label>

                    <button
                      type="button"
                      className={`exp-btn danger ${isSelf ? "is-disabled" : ""}`}
                      disabled={isSelf || usersLoading}
                      onClick={() => deleteUserAccount(u.uid)}
                      title={isSelf ? "لا يمكن حذف حسابك من هنا" : "حذف الحساب وتعطيل الموظفة المرتبطة"}
                    >
                      حذف
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="settings-footnote">
            * يتم الحفظ في: <b>salons/main/users</b>
            <br />
            * إذا اخترت Staff يتم إنشاء/تحديث <b>staff_public</b> و <b>employees</b> تلقائيًا.
            <br />
            * القائمة هنا تعرض فقط حسابات <b>@malikat.com</b>.
          </div>
        </div>
      </div>
    </div>
  );
}
