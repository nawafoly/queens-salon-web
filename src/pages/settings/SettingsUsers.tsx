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
  displayName: string;
  role: UiRole;
  active: boolean;
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

  function isMalikatEmail(email: string) {
    return cleanEmail(email).endsWith("@malikat.com");
  }

  const toastMsg = (msg: string, ms = 2200) => {
    setCreateMsg(msg);
    if (ms > 0) setTimeout(() => setCreateMsg(""), ms);
  };

  const loadUsers = async () => {
    if (!canManageUsers) return;

    setUsersLoading(true);
    try {
      const qy = query(
        collection(db, ...USERS_COLLECTION),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(qy);

      const listAll: UserRow[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          uid: d.id,
          email: String(x?.email || ""),
          displayName: String(x?.displayName || x?.name || ""),
          role: mapFirestoreRoleToUi(x?.role),
          active: x?.active !== false,
          createdAt: x?.createdAt,
        };
      });

      // ✅ عرض حسابات malikat.com فقط
      const listFiltered = listAll
        .filter((u) => isMalikatEmail(u.email))
        .map((u) => {
          // أي حساب malikat.com لو كان client/guest نخليه pending (عرض + إدارة)
          const fixedRole: UiRole =
            u.role === "client" || u.role === "guest" ? "pending" : u.role;
          return { ...u, role: fixedRole };
        });

      setUsers(listFiltered);
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
        await setDoc(
          doc(db, ...STAFF_PUBLIC_COLLECTION, uid),
          {
            uid,
            linkedUid: uid,
            email,
            name: displayName,
            role: "staff",
            active: true,
            showOnAbout: true,
            showOnBooking: false,
            specialties: [],
            bio: "",
            avatarUrl: "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await setDoc(
          doc(db, ...EMPLOYEES_COLLECTION, uid),
          {
            uid,
            linkedUid: uid,
            email,
            name: displayName,
            role: "staff",
            isActive: true,
            showOnAbout: true,
            specialties: [],
            bio: "",
            avatarUrl: "",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await signOut(secondary).catch(() => {});

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
      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        {
          role: toFirestoreRole(newRole),
          active: nextActive,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      const staffPublicRef = doc(db, ...STAFF_PUBLIC_COLLECTION, uid);
      const employeeRef = doc(db, ...EMPLOYEES_COLLECTION, uid);

      const row = users.find((x) => x.uid === uid);
      const name = row?.displayName || "موظفة";
      const email = row?.email || "";

      if (newRole === "staff") {
        await setDoc(
          staffPublicRef,
          {
            uid,
            linkedUid: uid,
            email,
            name,
            role: "staff",
            active: nextActive,
            showOnAbout: true,
            showOnBooking: false,
            specialties: [],
            bio: "",
            avatarUrl: "",
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await setDoc(
          employeeRef,
          {
            uid,
            linkedUid: uid,
            email,
            name,
            role: "staff",
            isActive: nextActive,
            showOnAbout: true,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await setDoc(
          staffPublicRef,
          {
            role: toFirestoreRole(newRole),
            active: nextActive,
            showOnAbout: false,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await setDoc(
          employeeRef,
          {
            role: toFirestoreRole(newRole),
            isActive: nextActive,
            showOnAbout: false,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, role: newRole, active: nextActive } : u))
      );

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
      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { active, updatedAt: serverTimestamp() },
        { merge: true }
      );

      // ✅ لو هو Staff خله يتزامن مع staff_public/employees
      const row = users.find((x) => x.uid === uid);
      if (row?.role === "staff") {
        await setDoc(
          doc(db, ...STAFF_PUBLIC_COLLECTION, uid),
          { active, updatedAt: serverTimestamp() },
          { merge: true }
        );
        await setDoc(
          doc(db, ...EMPLOYEES_COLLECTION, uid),
          { isActive: active, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, active } : u)));
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
      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { displayName: name, updatedAt: serverTimestamp() },
        { merge: true }
      );

      const row = users.find((x) => x.uid === uid);
      const roleNow = row?.role;

      if (roleNow === "staff") {
        await setDoc(
          doc(db, ...STAFF_PUBLIC_COLLECTION, uid),
          { name, updatedAt: serverTimestamp() },
          { merge: true }
        );
        await setDoc(
          doc(db, ...EMPLOYEES_COLLECTION, uid),
          { name, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, displayName: name } : u)));
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
              onClick={loadUsers}
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
