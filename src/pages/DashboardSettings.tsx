// src/pages/DashboardSettings.tsx
import React, { useEffect, useMemo, useState } from "react";

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
  addDoc,
} from "firebase/firestore";

import { auth, db } from "../services/firebase";

import { AppSettingsService } from "../services/AppSettingsService";
import type { AppSettings, SectionKey } from "../services/AppSettingsService";

import "../styles/DashboardModals.css";
import "../styles/DashboardSettings.css";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

function mapFirestoreRoleToUi(roleRaw: string): UiRole {
  const role = String(roleRaw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "client") return "client";
  return "guest";
}

function toFirestoreRole(role: UiRole) {
  const r = String(role || "guest").toLowerCase().trim();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  if (r === "reception") return "reception";
  if (r === "staff") return "staff";
  if (r === "client") return "client";
  return "guest";
}

function getSecondaryAuth() {
  const options = (auth as any)?.app?.options;
  if (!options) throw new Error("Missing Firebase app options from auth.app.options");

  const name = "secondary-auth-app";
  const app = getApps().find((a) => a.name === name) || initializeApp(options, name);
  return getAuth(app);
}

type UserRow = {
  uid: string;
  email: string;
  displayName: string;
  role: UiRole;
  active: boolean;
  createdAt?: any;
};

const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;

const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;
const EMPLOYEES_COLLECTION = ["salons", SALON_ID, "employees"] as const;

// ✅ الأقسام (شعر/أظافر/مكياج...)
const SERVICE_SECTIONS_COLLECTION = ["salons", SALON_ID, "service_sections"] as const;

// ✅ الخدمات (استشوار قصير/وسط/طويل...)
const SERVICES_COLLECTION = ["salons", SALON_ID, "services"] as const;

const BOOTSTRAP_ADMIN_EMAIL = "nawafaaa0@gmail.com".toLowerCase();

/* =========================
   ✅ Types
========================= */
type ServiceSectionRow = {
  id: string;
  name: string;
  active: boolean;
  order: number;
  updatedAt?: any;
  createdAt?: any;
};

type ServiceRow = {
  id: string;
  sectionId: string; // ✅ مهم: ربط الخدمة بالقسم
  name: string;
  durationMin: number;
  price: number;
  active: boolean;
  updatedAt?: any;
  createdAt?: any;
};

const DashboardSettings: React.FC = () => {
  const [uiRole, setUiRole] = useState<UiRole>("guest");
  const [authLoading, setAuthLoading] = useState(true);

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";
  const isReception = uiRole === "reception";
  const isStaff = uiRole === "staff";

  const hasAdminPower = isOwner || isAdmin;
  const canView = hasAdminPower || isReception || isStaff;

  const [tab, setTab] = useState<"salon" | "sections" | "policies">("salon");

  const [settings, setSettings] = useState<AppSettings>(() => AppSettingsService.getCached());
  const [savedMsg, setSavedMsg] = useState<string>("");

  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  // ✅ أضفنا view جديد اسمه catalog لإدارة (الأقسام + الخدمات)
  const [advancedView, setAdvancedView] = useState<"main" | "users" | "bookings" | "catalog">("main");

  // ====== Users Manager state
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

  const allowAdminManageUsers = Boolean((settings as any)?.policies?.allowAdminManageUsers);

  const canManageUsers = useMemo(() => {
    if (isOwner) return true;
    if (isAdmin) return allowAdminManageUsers;
    return false;
  }, [isOwner, isAdmin, allowAdminManageUsers]);

  /* =========================
     ✅ Catalog manager state (Sections + Services)
     - أقسام: شعر/أظافر/مكياج...
     - خدمات تحت القسم: استشوار قصير/وسط/طويل...
  ========================= */
  const [catalogMsg, setCatalogMsg] = useState<string>("");

  const [secLoading, setSecLoading] = useState(false);
  const [sectionsCatalog, setSectionsCatalog] = useState<ServiceSectionRow[]>([]);
  const [newSectionName, setNewSectionName] = useState("");

  const [srvLoading, setSrvLoading] = useState(false);
  const [servicesCatalog, setServicesCatalog] = useState<ServiceRow[]>([]);
  const [selectedSectionIdForServices, setSelectedSectionIdForServices] = useState<string>("");
  const [newServiceName, setNewServiceName] = useState("");

  const showMsg = (msg: string, ms = 1800) => {
    setCatalogMsg(msg);
    if (ms > 0) setTimeout(() => setCatalogMsg(""), ms);
  };

  const loadCatalog = async () => {
    setCatalogMsg("");
    try {
      setSecLoading(true);
      setSrvLoading(true);

      // ✅ الأقسام: نجيبها ونرتّبها
      const qSec = query(collection(db, ...SERVICE_SECTIONS_COLLECTION), orderBy("order", "asc"));
      const secSnap = await getDocs(qSec);

      const secList: ServiceSectionRow[] = secSnap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            name: String(x?.name || ""),
            active: x?.active !== false,
            order: Number(x?.order ?? 0),
            updatedAt: x?.updatedAt,
            createdAt: x?.createdAt,
          };
        })
        .filter((s) => s.name.trim());

      setSectionsCatalog(secList);

      // ✅ لو ما فيه قسم مختار، خله أول قسم
      if (!selectedSectionIdForServices) {
        setSelectedSectionIdForServices(secList[0]?.id || "");
      }

      // ✅ الخدمات: نجيبها كلها (بدون where) عشان ما نحتاج index
      const qSrv = query(collection(db, ...SERVICES_COLLECTION), orderBy("name", "asc"));
      const srvSnap = await getDocs(qSrv);

      const srvList: ServiceRow[] = srvSnap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            sectionId: String(x?.sectionId || ""),
            name: String(x?.name || ""),
            durationMin: Number(x?.durationMin ?? 60),
            price: Number(x?.price ?? 0),
            active: x?.active !== false,
            updatedAt: x?.updatedAt,
            createdAt: x?.createdAt,
          };
        })
        .filter((s) => s.name.trim());

      setServicesCatalog(srvList);
    } catch (e) {
      console.error("loadCatalog error:", e);
      setSectionsCatalog([]);
      setServicesCatalog([]);
      showMsg("❌ تعذر تحميل الأقسام/الخدمات (تحقق من Rules أو المسار)", 3000);
    } finally {
      setSecLoading(false);
      setSrvLoading(false);
    }
  };

  const createSection = async () => {
    if (!hasAdminPower) return;

    const name = String(newSectionName || "").trim();
    if (!name) return;

    try {
      setSecLoading(true);

      const nextOrder =
        sectionsCatalog.length > 0 ? Math.max(...sectionsCatalog.map((s) => Number(s.order || 0))) + 1 : 1;

      const ref = await addDoc(collection(db, ...SERVICE_SECTIONS_COLLECTION), {
        name,
        active: true,
        order: nextOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewSectionName("");
      showMsg("✅ تم إنشاء القسم");
      await loadCatalog();

      // ✅ اختاره مباشرة لسهولة إضافة الخدمات تحته
      setSelectedSectionIdForServices(ref.id);
    } catch (e) {
      console.error("createSection error:", e);
      showMsg("❌ تعذر إنشاء القسم", 2500);
    } finally {
      setSecLoading(false);
    }
  };

  const saveSectionRow = async (row: ServiceSectionRow) => {
    if (!hasAdminPower) return;

    const name = String(row.name || "").trim();
    if (!name) {
      showMsg("❌ اسم القسم لا يمكن يكون فارغ", 2000);
      return;
    }

    const orderNum = Number.isFinite(Number(row.order)) ? Number(row.order) : 0;

    try {
      await setDoc(
        doc(db, ...SERVICE_SECTIONS_COLLECTION, row.id),
        {
          name,
          active: row.active !== false,
          order: orderNum,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showMsg("✅ تم حفظ القسم");
    } catch (e) {
      console.error("saveSectionRow error:", e);
      showMsg("❌ تعذر حفظ القسم", 2500);
    }
  };

  const createServiceUnderSection = async () => {
    if (!hasAdminPower) return;

    const sectionId = String(selectedSectionIdForServices || "").trim();
    const name = String(newServiceName || "").trim();

    if (!sectionId) {
      showMsg("❌ اختر قسم أولاً قبل إضافة خدمة", 2200);
      return;
    }
    if (!name) return;

    try {
      setSrvLoading(true);

      await addDoc(collection(db, ...SERVICES_COLLECTION), {
        sectionId,
        name,
        durationMin: 60,
        price: 0,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewServiceName("");
      showMsg("✅ تم إضافة الخدمة");
      await loadCatalog();
    } catch (e) {
      console.error("createServiceUnderSection error:", e);
      showMsg("❌ تعذر إضافة الخدمة", 2500);
    } finally {
      setSrvLoading(false);
    }
  };

  const saveServiceRow = async (row: ServiceRow) => {
    if (!hasAdminPower) return;

    const name = String(row.name || "").trim();
    if (!name) {
      showMsg("❌ اسم الخدمة لا يمكن يكون فارغ", 2000);
      return;
    }

    const durationMin = Math.max(5, Number(row.durationMin || 0));
    const price = Math.max(0, Number(row.price || 0));
    const sectionId = String(row.sectionId || "").trim();

    if (!sectionId) {
      showMsg("❌ الخدمة لازم تكون مرتبطة بقسم", 2000);
      return;
    }

    try {
      await setDoc(
        doc(db, ...SERVICES_COLLECTION, row.id),
        {
          sectionId,
          name,
          durationMin,
          price,
          active: row.active !== false,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showMsg("✅ تم حفظ الخدمة");
    } catch (e) {
      console.error("saveServiceRow error:", e);
      showMsg("❌ تعذر حفظ الخدمة", 2500);
    }
  };

  const servicesInSelectedSection = useMemo(() => {
    const sid = String(selectedSectionIdForServices || "").trim();
    if (!sid) return [];
    return servicesCatalog.filter((s) => String(s.sectionId || "").trim() === sid);
  }, [servicesCatalog, selectedSectionIdForServices]);

  // ✅ Auth role source of truth: salons/main/users/{uid}.role
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);

      try {
        if (!user) {
          setUiRole("guest");
          return;
        }

        const emailLower = String(user.email || "").toLowerCase();
        const userRef = doc(db, ...USERS_COLLECTION, user.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          const initialRole: UiRole = emailLower === BOOTSTRAP_ADMIN_EMAIL ? "owner" : "client";

          await setDoc(
            userRef,
            {
              role: toFirestoreRole(initialRole),
              displayName: user.displayName || "مستخدم",
              email: emailLower,
              createdAt: serverTimestamp(),
              active: true,
            },
            { merge: true }
          );
        }

        const snap2 = await getDoc(userRef);
        const data = snap2.exists() ? (snap2.data() as any) : {};

        let mapped = mapFirestoreRoleToUi(data?.role);
        if (emailLower === BOOTSTRAP_ADMIN_EMAIL) mapped = "owner";

        setUiRole(mapped);

        const displayName = data?.displayName || user.displayName || "مستخدم";

        const fixedRole = toFirestoreRole(mapped);
        if (String(data?.role || "").trim() !== fixedRole) {
          await setDoc(userRef, { role: fixedRole }, { merge: true });
        }

        localStorage.setItem("userRole", mapped);
        localStorage.setItem("userName", displayName);
        localStorage.setItem("authToken", "firebase");
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            uid: user.uid,
            email: emailLower,
            role: mapped,
            displayName,
          })
        );
      } catch (e) {
        console.error("Settings role load error:", e);
        setUiRole("guest");
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsub();
  }, []);

  // ✅ Firestore settings (settings/app)
  useEffect(() => {
    AppSettingsService.fetchRemote()
      .then((remote) => setSettings(remote))
      .catch((e) => console.error("fetchRemote settings error:", e));

    const unsub = AppSettingsService.subscribe((remote) => {
      setSettings(remote);
    });

    return () => unsub();
  }, []);

  const hint = useMemo(() => {
    if (hasAdminPower) return "تقدر تعدّل وتحفظ مباشرة.";
    if (isReception) return "عرض فقط لموظفة الاستقبال (لا يمكن التعديل).";
    if (isStaff) return "عرض فقط للموظفة (لا يمكن التعديل).";
    return "غير مصرح.";
  }, [hasAdminPower, isReception, isStaff]);

  const handleSave = async () => {
    if (!hasAdminPower) return;

    try {
      await AppSettingsService.saveRemote(settings);
      setSavedMsg("✅ تم حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 2000);
    } catch (e) {
      console.error("save settings error:", e);
      setSavedMsg("❌ تعذر حفظ الإعدادات");
      setTimeout(() => setSavedMsg(""), 2500);
    }
  };

  const toggleSection = (key: SectionKey) => {
    if (!hasAdminPower) return;
    setSettings((prev: any) => ({
      ...prev,
      sections: { ...prev.sections, [key]: !prev.sections?.[key] },
    }));
  };

  const togglePolicy = (key: string) => {
    if (!hasAdminPower) return;
    setSettings((prev: any) => ({
      ...prev,
      policies: { ...(prev.policies || {}), [key]: !prev.policies?.[key] },
    }));
  };

  // ====== Users manager
  const loadUsers = async () => {
    if (!canManageUsers) return;

    setUsersLoading(true);
    try {
      const q = query(collection(db, ...USERS_COLLECTION), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);

      const list: UserRow[] = snap.docs.map((d) => {
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

      setUsers(list);
    } catch (e) {
      console.error("loadUsers error:", e);
      setUsers([]);
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
      setCreateMsg("❌ أكمل البيانات (الاسم/الإيميل/كلمة المرور)");
      return;
    }

    if (!isOwner && role === "owner") {
      setCreateMsg("❌ فقط Owner يقدر ينشئ Owner");
      return;
    }

    try {
      setCreateLoading(true);
      const secondary = getSecondaryAuth();

      const cred = await createUserWithEmailAndPassword(secondary, email, password);
      await updateProfile(cred.user, { displayName }).catch(() => {});

      const uid = cred.user.uid;

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

      if (role === "staff") {
        await setDoc(
          doc(db, ...STAFF_PUBLIC_COLLECTION, uid),
          {
            uid,
            name: displayName,
            role: "staff",
            active: true,
            showOnAbout: true,
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
            name: displayName,
            email,
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

      setCreateMsg("✅ تم إنشاء الحساب بنجاح");
      setCreateForm({ displayName: "", email: "", password: "", role: "staff" });

      await loadUsers();
    } catch (e: any) {
      console.error("create user error:", e);
      const m = String(e?.message || "");
      if (m.includes("email-already-in-use")) setCreateMsg("❌ هذا الإيميل مستخدم مسبقًا");
      else if (m.includes("weak-password")) setCreateMsg("❌ كلمة المرور ضعيفة (جرّب 6 أحرف أو أكثر)");
      else setCreateMsg("❌ تعذر إنشاء الحساب. تأكد من الصلاحيات/Rules");
    } finally {
      setCreateLoading(false);
      setTimeout(() => setCreateMsg(""), 3500);
    }
  };

  const updateUserRole = async (uid: string, newRole: UiRole) => {
    if (!canManageUsers) return;
    if (!isOwner && newRole === "owner") return;

    if ((auth as any)?.currentUser?.uid === uid) {
      setCreateMsg("❌ لا يمكن تعديل دور حسابك من هنا");
      setTimeout(() => setCreateMsg(""), 2500);
      return;
    }

    try {
      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { role: toFirestoreRole(newRole), updatedAt: serverTimestamp() },
        { merge: true }
      );

      const staffPublicRef = doc(db, ...STAFF_PUBLIC_COLLECTION, uid);
      const employeeRef = doc(db, ...EMPLOYEES_COLLECTION, uid);

      if (newRole === "staff") {
        const row = users.find((x) => x.uid === uid);

        await setDoc(
          staffPublicRef,
          {
            uid,
            name: row?.displayName || "موظفة",
            role: "staff",
            active: true,
            showOnAbout: true,
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
            name: row?.displayName || "موظفة",
            email: row?.email || "",
            role: "staff",
            isActive: true,
            showOnAbout: true,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        await setDoc(staffPublicRef, { showOnAbout: false, updatedAt: serverTimestamp() }, { merge: true });
        await setDoc(employeeRef, { showOnAbout: false, updatedAt: serverTimestamp() }, { merge: true });
      }

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, role: newRole } : u)));
      setCreateMsg("✅ تم تحديث الدور");
      setTimeout(() => setCreateMsg(""), 1200);
    } catch (e) {
      console.error("updateUserRole error:", e);
      setCreateMsg("❌ تعذر تحديث الدور (Rules?)");
      setTimeout(() => setCreateMsg(""), 2500);
    }
  };

  const toggleUserActive = async (uid: string, active: boolean) => {
    if (!canManageUsers) return;

    if ((auth as any)?.currentUser?.uid === uid) {
      setCreateMsg("❌ لا يمكن إيقاف حسابك من هنا");
      setTimeout(() => setCreateMsg(""), 2500);
      return;
    }

    try {
      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { active, updatedAt: serverTimestamp() },
        { merge: true }
      );

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, active } : u)));
      setCreateMsg("✅ تم تحديث حالة الحساب");
      setTimeout(() => setCreateMsg(""), 1200);
    } catch (e) {
      console.error("toggleUserActive error:", e);
      setCreateMsg("❌ تعذر تحديث حالة الحساب (Rules?)");
      setTimeout(() => setCreateMsg(""), 2500);
    }
  };

  const updateUserDisplayName = async (uid: string, newName: string) => {
    if (!canManageUsers) return;

    const name = String(newName || "").trim();
    if (!name) {
      setCreateMsg("❌ الاسم لا يمكن أن يكون فارغ");
      setTimeout(() => setCreateMsg(""), 2000);
      return;
    }

    if ((auth as any)?.currentUser?.uid === uid) {
      setCreateMsg("❌ لا يمكن تعديل اسم حسابك من هنا");
      setTimeout(() => setCreateMsg(""), 2500);
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
        await setDoc(doc(db, ...STAFF_PUBLIC_COLLECTION, uid), { name, updatedAt: serverTimestamp() }, { merge: true });
        await setDoc(doc(db, ...EMPLOYEES_COLLECTION, uid), { name, updatedAt: serverTimestamp() }, { merge: true });
      }

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, displayName: name } : u)));
      setCreateMsg("✅ تم تحديث الاسم");
      setTimeout(() => setCreateMsg(""), 1200);
    } catch (e) {
      console.error("updateUserDisplayName error:", e);
      setCreateMsg("❌ تعذر تحديث الاسم (Rules?)");
      setTimeout(() => setCreateMsg(""), 2500);
    }
  };

  if (authLoading) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <div className="settings-card">
            <h3 className="settings-title">جاري التحميل…</h3>
            <p style={{ margin: 0, opacity: 0.75 }}>لحظات…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="dashboard-section settings-page">
        <div className="settings-wrap">
          <h3>غير مصرح</h3>
          <p>هذه الصفحة مخصصة للإدارة وموظفات الاستقبال/الموظفات فقط.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-section settings-page">
      <div className="settings-wrap">
        <div className="settings-header">
          <div>
            <h1>الإعدادات</h1>
            <p className="settings-hint">{hint}</p>
          </div>

          <div className="settings-save">
            {savedMsg && <span className="settings-saved">{savedMsg}</span>}

            <button
              className="exp-btn"
              onClick={() => {
                setIsAdvancedOpen(true);
                setAdvancedView("main");
                setCreateMsg("");
                setCatalogMsg("");
              }}
              type="button"
              title="إعدادات متقدمة"
            >
              إعدادات متقدمة
            </button>

            <button
              className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
              onClick={handleSave}
              disabled={!hasAdminPower}
              type="button"
              title={!hasAdminPower ? "تحتاج صلاحية Owner/Admin" : "حفظ الإعدادات"}
            >
              حفظ
            </button>
          </div>
        </div>

        <div className="settings-tabs">
          <button className={`dash-btn ${tab === "salon" ? "primary" : ""}`} onClick={() => setTab("salon")} type="button">
            بيانات الصالون
          </button>

          <button className={`dash-btn ${tab === "sections" ? "primary" : ""}`} onClick={() => setTab("sections")} type="button">
            الأقسام
          </button>

          <button className={`dash-btn ${tab === "policies" ? "primary" : ""}`} onClick={() => setTab("policies")} type="button">
            صلاحيات النظام
          </button>
        </div>

        {tab === "salon" && (
          <div className="settings-card">
            <h3 className="settings-title">بيانات الصالون</h3>

            <div className="settings-grid">
              <div className="settings-field">
                <label>اسم الصالون</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.salonName || ""}
                  onChange={(e) => hasAdminPower && setSettings({ ...(settings as any), salonName: e.target.value })}
                  disabled={!hasAdminPower}
                />
              </div>

              <div className="settings-field">
                <label>الجوال</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.phone || ""}
                  onChange={(e) => hasAdminPower && setSettings({ ...(settings as any), phone: e.target.value })}
                  disabled={!hasAdminPower}
                />
              </div>

              <div className="settings-field">
                <label>المدينة</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.city || ""}
                  onChange={(e) => hasAdminPower && setSettings({ ...(settings as any), city: e.target.value })}
                  disabled={!hasAdminPower}
                />
              </div>
            </div>

            {!hasAdminPower && <div className="settings-note">* للتعديل تحتاج صلاحية Owner/Admin.</div>}
          </div>
        )}

        {tab === "sections" && (
          <div className="settings-card">
            <h3 className="settings-title">تفعيل/إخفاء الأقسام</h3>

            <div className="settings-list">
              {(
                [
                  ["overview", "نظرة عامة"],
                  ["bookings", "الحجوزات"],
                  ["clients", "العميلات"],
                  ["employees", "الموظفات"],
                  ["offers", "العروض والكوبونات"],
                  ["reports", "التقارير"],
                  ["income", "الإيرادات"],
                  ["expenses", "المصروفات"],
                ] as Array<[SectionKey, string]>
              ).map(([key, label]) => (
                <label key={key} className="settings-row">
                  <span>{label}</span>
                  <input
                    className="settings-check"
                    type="checkbox"
                    checked={!!(settings as any)?.sections?.[key]}
                    onChange={() => toggleSection(key)}
                    disabled={!hasAdminPower}
                  />
                </label>
              ))}
            </div>

            <div className="settings-footnote">
              * هذه مربوطة فعليًا بالـ Dashboard (الروابط + الراوتس).
              <br />
              * صفحة الإعدادات لا يمكن إخفاؤها (مقصودة).
            </div>
          </div>
        )}

        {tab === "policies" && (
          <div className="settings-card">
            <h3 className="settings-title">صلاحيات النظام</h3>

            <div className="settings-list">
              <label className="settings-row">
                <span>السماح للموظفات بتغيير حالة الحجز</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={!!(settings as any)?.policies?.allowStaffChangeStatus}
                  onChange={() => togglePolicy("allowStaffChangeStatus")}
                  disabled={!hasAdminPower}
                />
              </label>

              <label className="settings-row">
                <span>السماح للاستقبال بتغيير حالة الحجز</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={!!(settings as any)?.policies?.allowReceptionChangeStatus}
                  onChange={() => togglePolicy("allowReceptionChangeStatus")}
                  disabled={!hasAdminPower}
                />
              </label>

              <label className="settings-row">
                <span>السماح للموظفات بمشاهدة العميلات</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={!!(settings as any)?.policies?.allowStaffViewClients}
                  onChange={() => togglePolicy("allowStaffViewClients")}
                  disabled={!hasAdminPower}
                />
              </label>

              <label className="settings-row">
                <span>السماح للـ Admin بإدارة حسابات المستخدمين</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={!!(settings as any)?.policies?.allowAdminManageUsers}
                  onChange={() => togglePolicy("allowAdminManageUsers")}
                  disabled={!hasAdminPower}
                />
              </label>
            </div>

            <div className="settings-footnote">
              * هذا الخيار يتحكم إذا الـ Admin يقدر ينشئ/يدير حسابات من الإعدادات المتقدمة.
            </div>
          </div>
        )}

        {/* ✅ Advanced Settings Modal */}
        {isAdvancedOpen && (
          <div className="modal-overlay" onClick={() => setIsAdvancedOpen(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <div className="modal-title-wrap">
                  <div className="modal-icon">⚙️</div>
                  <h3 className="modal-title">
                    {advancedView === "main"
                      ? "إعدادات متقدمة"
                      : advancedView === "users"
                        ? "إدارة الحسابات"
                        : advancedView === "bookings"
                          ? "إعدادات الحجوزات"
                          : "إدارة الأقسام والخدمات"}
                  </h3>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {advancedView !== "main" && (
                    <button
                      className="dash-btn"
                      type="button"
                      onClick={() => {
                        setAdvancedView("main");
                        setCreateMsg("");
                        setCatalogMsg("");
                      }}
                    >
                      رجوع
                    </button>
                  )}

                  <button
                    className="modal-close"
                    onClick={() => setIsAdvancedOpen(false)}
                    type="button"
                    aria-label="إغلاق"
                    title="إغلاق"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="modal-body">
                {advancedView === "main" ? (
                  <>
                    <p style={{ margin: 0, opacity: 0.85 }}>
                      هنا نضيف إعدادات النظام بدون ما نرجع نلعب في كود الصفحات.
                    </p>

                    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                      <button
                        className={`exp-btn ${!hasAdminPower ? "is-disabled" : ""}`}
                        disabled={!hasAdminPower}
                        type="button"
                        onClick={() => setAdvancedView("bookings")}
                      >
                        إعدادات الحجوزات (الدوام/الإجازات/الإغلاق)
                      </button>

                      <button
                        className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
                        disabled={!hasAdminPower}
                        type="button"
                        onClick={async () => {
                          setAdvancedView("catalog");
                          await loadCatalog();
                        }}
                      >
                        إدارة الأقسام والخدمات (بالترتيب الصح)
                      </button>

                      <button
                        className={`exp-btn primary ${!canManageUsers ? "is-disabled" : ""}`}
                        disabled={!canManageUsers}
                        type="button"
                        onClick={async () => {
                          setAdvancedView("users");
                          await loadUsers();
                        }}
                      >
                        إدارة الحسابات (إنشاء حسابات الموظفات)
                      </button>
                    </div>

                    {!hasAdminPower && (
                      <div className="settings-note" style={{ marginTop: 10 }}>
                        * تحتاج صلاحية Owner/Admin لاستخدام الإعدادات المتقدمة.
                      </div>
                    )}

                    {hasAdminPower && !canManageUsers && isAdmin && (
                      <div className="settings-note" style={{ marginTop: 10 }}>
                        * Admin: فعّل “السماح للـ Admin بإدارة حسابات المستخدمين” من تبويب صلاحيات النظام.
                      </div>
                    )}
                  </>
                ) : advancedView === "bookings" ? (
                  <>
                    {/* ✅ نفس كود الحجوزات عندك بدون تغيير */}
                    <div className="settings-card" style={{ marginTop: 0 }}>
                      <h3 className="settings-title">أوقات العمل</h3>

                      <div className="settings-grid">
                        <div className="settings-field">
                          <label>تقسيم المواعيد (دقيقة)</label>
                          <input
                            className="settings-input"
                            type="number"
                            min={5}
                            step={5}
                            value={(settings as any)?.booking?.slotStepMin ?? 30}
                            onChange={(e) =>
                              hasAdminPower &&
                              setSettings((prev: any) => ({
                                ...prev,
                                booking: { ...(prev.booking || {}), slotStepMin: Number(e.target.value || 30) },
                              }))
                            }
                            disabled={!hasAdminPower}
                          />
                        </div>

                        <div className="settings-field">
                          <label>فاصل بين العملاء (دقيقة)</label>
                          <input
                            className="settings-input"
                            type="number"
                            min={0}
                            step={5}
                            value={(settings as any)?.booking?.bufferMin ?? 0}
                            onChange={(e) =>
                              hasAdminPower &&
                              setSettings((prev: any) => ({
                                ...prev,
                                booking: { ...(prev.booking || {}), bufferMin: Number(e.target.value || 0) },
                              }))
                            }
                            disabled={!hasAdminPower}
                          />
                        </div>
                      </div>

                      <div className="settings-list" style={{ marginTop: 12 }}>
                        {(
                          [
                            ["sat", "السبت"],
                            ["sun", "الأحد"],
                            ["mon", "الإثنين"],
                            ["tue", "الثلاثاء"],
                            ["wed", "الأربعاء"],
                            ["thu", "الخميس"],
                            ["fri", "الجمعة"],
                          ] as const
                        ).map(([key, label]) => {
                          const day =
                            (settings as any)?.booking?.businessHours?.[key] ||
                            ({
                              enabled: false,
                              start: "12:00",
                              end: "22:00",
                            } as any);

                          return (
                            <div key={key} className="settings-row" style={{ alignItems: "flex-start" }}>
                              <div style={{ display: "grid", gap: 6 }}>
                                <span style={{ fontWeight: 900 }}>{label}</span>

                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}>
                                    <input
                                      className="settings-check"
                                      type="checkbox"
                                      checked={!!day.enabled}
                                      disabled={!hasAdminPower}
                                      onChange={() =>
                                        hasAdminPower &&
                                        setSettings((prev: any) => ({
                                          ...prev,
                                          booking: {
                                            ...(prev.booking || {}),
                                            businessHours: {
                                              ...(prev.booking?.businessHours || {}),
                                              [key]: { ...day, enabled: !day.enabled },
                                            },
                                          },
                                        }))
                                      }
                                    />
                                    مفتوح
                                  </label>

                                  <input
                                    className="settings-input"
                                    style={{ width: 140 }}
                                    type="time"
                                    value={day.start}
                                    disabled={!hasAdminPower || !day.enabled}
                                    onChange={(e) =>
                                      hasAdminPower &&
                                      setSettings((prev: any) => ({
                                        ...prev,
                                        booking: {
                                          ...(prev.booking || {}),
                                          businessHours: {
                                            ...(prev.booking?.businessHours || {}),
                                            [key]: { ...day, start: e.target.value },
                                          },
                                        },
                                      }))
                                    }
                                  />

                                  <input
                                    className="settings-input"
                                    style={{ width: 140 }}
                                    type="time"
                                    value={day.end}
                                    disabled={!hasAdminPower || !day.enabled}
                                    onChange={(e) =>
                                      hasAdminPower &&
                                      setSettings((prev: any) => ({
                                        ...prev,
                                        booking: {
                                          ...(prev.booking || {}),
                                          businessHours: {
                                            ...(prev.booking?.businessHours || {}),
                                            [key]: { ...day, end: e.target.value },
                                          },
                                        },
                                      }))
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="settings-footnote">
                        * هذا يحدد “من كم إلى كم” لكل يوم.
                        <br />* الإجازات/الإغلاق تحت ممكن يتغلب على الدوام لو فيه تعارض.
                      </div>
                    </div>

                    <div className="settings-card">
                      <h3 className="settings-title">الإجازات / الإغلاق + رسالة للزبائن</h3>

                      <div className="settings-grid">
                        <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                          <label>رسالة عامة عند الإغلاق (اختياري)</label>
                          <input
                            className="settings-input"
                            value={(settings as any)?.booking?.publicClosedMessage || ""}
                            onChange={(e) =>
                              hasAdminPower &&
                              setSettings((prev: any) => ({
                                ...prev,
                                booking: { ...(prev.booking || {}), publicClosedMessage: e.target.value },
                              }))
                            }
                            disabled={!hasAdminPower}
                            placeholder="مثال: الصالون مغلق للصيانة حتى إشعار آخر."
                          />
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                        <input
                          className="settings-input"
                          style={{ width: 200 }}
                          type="date"
                          disabled={!hasAdminPower}
                          onChange={(e) => {
                            const date = e.target.value;
                            if (!date) return;
                            if (!hasAdminPower) return;

                            setSettings((prev: any) => {
                              const list = Array.isArray(prev?.booking?.holidays) ? prev.booking.holidays : [];
                              if (list.some((h: any) => h.date === date)) return prev;
                              return {
                                ...prev,
                                booking: {
                                  ...(prev.booking || {}),
                                  holidays: [{ date, reason: "" }, ...list],
                                },
                              };
                            });

                            e.currentTarget.value = "";
                          }}
                        />
                        <span style={{ opacity: 0.75, fontWeight: 800, alignSelf: "center" }}>
                          اختر تاريخ لإضافته كإجازة
                        </span>
                      </div>

                      <div className="settings-list">
                        {(((settings as any)?.booking?.holidays || []) as any[]).length === 0 ? (
                          <div className="settings-note">لا توجد إجازات مضافة.</div>
                        ) : (
                          ((settings as any)?.booking?.holidays || []).map((h: any, idx: number) => (
                            <div key={`${h.date}-${idx}`} className="settings-row" style={{ alignItems: "center" }}>
                              <span style={{ minWidth: 140 }}>{h.date}</span>

                              <input
                                className="settings-input"
                                style={{ flex: 1 }}
                                value={h.reason || ""}
                                disabled={!hasAdminPower}
                                placeholder="سبب (صيانة/إجازة...)"
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSettings((prev: any) => {
                                    const list = [...(prev?.booking?.holidays || [])];
                                    list[idx] = { ...list[idx], reason: v };
                                    return { ...prev, booking: { ...(prev.booking || {}), holidays: list } };
                                  });
                                }}
                              />

                              <button
                                className="exp-btn"
                                type="button"
                                disabled={!hasAdminPower}
                                onClick={() => {
                                  setSettings((prev: any) => {
                                    const list = [...(prev?.booking?.holidays || [])].filter((_: any, i: number) => i !== idx);
                                    return { ...prev, booking: { ...(prev.booking || {}), holidays: list } };
                                  });
                                }}
                              >
                                حذف
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="settings-footnote">* الإجازة هنا “إغلاق يوم كامل” على تاريخ محدد.</div>
                    </div>
                  </>
                ) : advancedView === "catalog" ? (
                  <>
                    <div className="settings-card" style={{ marginTop: 0 }}>
                      <h3 className="settings-title">١) الأقسام (شعر / أظافر / مكياج...)</h3>

                      <div className="settings-grid">
                        <div className="settings-field" style={{ gridColumn: "1 / -1" }}>
                          <label>إضافة قسم جديد</label>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <input
                              className="settings-input"
                              style={{ flex: 1, minWidth: 220 }}
                              value={newSectionName}
                              onChange={(e) => setNewSectionName(e.target.value)}
                              placeholder="مثال: شعر"
                              disabled={!hasAdminPower || secLoading}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") createSection();
                              }}
                            />
                            <button
                              type="button"
                              className={`exp-btn primary ${!hasAdminPower || secLoading ? "is-disabled" : ""}`}
                              disabled={!hasAdminPower || secLoading}
                              onClick={createSection}
                            >
                              إنشاء القسم
                            </button>
                          </div>
                          <div className="settings-footnote">
                            * الأقسام تُحفظ في: <b>salons/main/service_sections</b>
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                        <button
                          type="button"
                          className={`exp-btn ${secLoading || srvLoading ? "is-disabled" : ""}`}
                          disabled={secLoading || srvLoading}
                          onClick={loadCatalog}
                        >
                          تحديث القائمة
                        </button>

                        {catalogMsg && (
                          <span className="settings-alert success" style={{ marginInlineStart: 6 }}>
                            {catalogMsg}
                          </span>
                        )}
                      </div>

                      <div className="settings-list" style={{ marginTop: 10 }}>
                        {secLoading ? (
                          <div className="settings-note">تحميل الأقسام…</div>
                        ) : sectionsCatalog.length === 0 ? (
                          <div className="settings-note">لا توجد أقسام بعد. أنشئ قسم ثم أضف الخدمات تحته.</div>
                        ) : (
                          sectionsCatalog.map((s) => (
                            <div key={s.id} className="settings-row" style={{ alignItems: "center", gap: 10 }}>
                              <input
                                className="settings-input"
                                style={{ minWidth: 220 }}
                                value={s.name}
                                disabled={!hasAdminPower}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setSectionsCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: v } : x)));
                                }}
                                title="اسم القسم"
                              />

                              <input
                                className="settings-input"
                                style={{ width: 110 }}
                                type="number"
                                min={0}
                                step={1}
                                disabled={!hasAdminPower}
                                value={Number(s.order || 0)}
                                onChange={(e) => {
                                  const v = Number(e.target.value || 0);
                                  setSectionsCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, order: v } : x)));
                                }}
                                title="ترتيب القسم"
                              />

                              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                                <input
                                  className="settings-check"
                                  type="checkbox"
                                  checked={s.active !== false}
                                  disabled={!hasAdminPower}
                                  onChange={() => {
                                    setSectionsCatalog((prev) =>
                                      prev.map((x) => (x.id === s.id ? { ...x, active: !(x.active !== false) } : x))
                                    );
                                  }}
                                />
                                مفعل
                              </label>

                              <button
                                type="button"
                                className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
                                disabled={!hasAdminPower}
                                onClick={() => saveSectionRow(s)}
                                title="حفظ القسم"
                              >
                                حفظ
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="settings-footnote">
                        * القاعدة الصح: <b>تنشئ القسم أولاً</b> ثم تضيف الخدمات تحته ✅
                      </div>
                    </div>

                    <div className="settings-card">
                      <h3 className="settings-title">٢) الخدمات (تحت القسم المختار)</h3>

                      <div className="settings-grid">
                        <div className="settings-field">
                          <label>اختر القسم</label>
                          <select
                            className="settings-input"
                            value={selectedSectionIdForServices}
                            disabled={secLoading || sectionsCatalog.length === 0}
                            onChange={(e) => setSelectedSectionIdForServices(e.target.value)}
                          >
                            <option value="">— اختر القسم —</option>
                            {sectionsCatalog.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="settings-field">
                          <label>إضافة خدمة جديدة تحت هذا القسم</label>
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <input
                              className="settings-input"
                              style={{ flex: 1, minWidth: 220 }}
                              value={newServiceName}
                              onChange={(e) => setNewServiceName(e.target.value)}
                              placeholder="مثال: استشوار شعر قصير"
                              disabled={!hasAdminPower || srvLoading}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") createServiceUnderSection();
                              }}
                            />
                            <button
                              type="button"
                              className={`exp-btn primary ${!hasAdminPower || srvLoading ? "is-disabled" : ""}`}
                              disabled={!hasAdminPower || srvLoading}
                              onClick={createServiceUnderSection}
                            >
                              إضافة الخدمة
                            </button>
                          </div>
                          <div className="settings-footnote">
                            * الخدمات تُحفظ في: <b>salons/main/services</b> مع <b>sectionId</b>
                          </div>
                        </div>
                      </div>

                      <div className="settings-list" style={{ marginTop: 10 }}>
                        {srvLoading ? (
                          <div className="settings-note">تحميل الخدمات…</div>
                        ) : !selectedSectionIdForServices ? (
                          <div className="settings-note">اختر قسم أولاً لعرض خدماته.</div>
                        ) : servicesInSelectedSection.length === 0 ? (
                          <div className="settings-note">لا توجد خدمات تحت هذا القسم.</div>
                        ) : (
                          servicesInSelectedSection.map((s) => (
                            <div key={s.id} className="settings-row" style={{ alignItems: "center", gap: 10 }}>
                              <input
                                className="settings-input"
                                style={{ minWidth: 240 }}
                                value={s.name}
                                disabled={!hasAdminPower}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: v } : x)));
                                }}
                                title="اسم الخدمة"
                              />

                              <input
                                className="settings-input"
                                style={{ width: 130 }}
                                type="number"
                                min={5}
                                step={5}
                                disabled={!hasAdminPower}
                                value={Number(s.durationMin || 0)}
                                onChange={(e) => {
                                  const v = Number(e.target.value || 0);
                                  setServicesCatalog((prev) =>
                                    prev.map((x) => (x.id === s.id ? { ...x, durationMin: v } : x))
                                  );
                                }}
                                title="مدة الخدمة بالدقائق"
                              />

                              <input
                                className="settings-input"
                                style={{ width: 130 }}
                                type="number"
                                min={0}
                                step={1}
                                disabled={!hasAdminPower}
                                value={Number(s.price || 0)}
                                onChange={(e) => {
                                  const v = Number(e.target.value || 0);
                                  setServicesCatalog((prev) => prev.map((x) => (x.id === s.id ? { ...x, price: v } : x)));
                                }}
                                title="سعر الخدمة"
                              />

                              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 900 }}>
                                <input
                                  className="settings-check"
                                  type="checkbox"
                                  checked={s.active !== false}
                                  disabled={!hasAdminPower}
                                  onChange={() => {
                                    setServicesCatalog((prev) =>
                                      prev.map((x) => (x.id === s.id ? { ...x, active: !(x.active !== false) } : x))
                                    );
                                  }}
                                />
                                مفعلة
                              </label>

                              <button
                                type="button"
                                className={`exp-btn primary ${!hasAdminPower ? "is-disabled" : ""}`}
                                disabled={!hasAdminPower}
                                onClick={() => saveServiceRow(s)}
                                title="حفظ الخدمة"
                              >
                                حفظ
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      <div className="settings-footnote">
                        * الآن ضبط الأسعار/المدد يكون من هنا ✅
                        <br />
                        * الخطوة 2 لاحقًا: نخلي صفحة الحجز تسحب الأقسام والخدمات من Firestore بدل Pricing.tsx.
                      </div>
                    </div>
                  </>
                ) : (
                  // users view (نفس كودك)
                  <>
                    {!canManageUsers ? (
                      <div className="settings-note">
                        غير مصرح. هذه الميزة للـ Owner، أو Admin إذا تم تفعيل allowAdminManageUsers.
                      </div>
                    ) : (
                      <>
                        <div className="settings-card" style={{ marginTop: 0 }}>
                          <h3 className="settings-title">إنشاء حساب جديد</h3>

                          <div className="settings-grid">
                            <div className="settings-field">
                              <label>اسم الموظفة</label>
                              <input
                                className="settings-input"
                                value={createForm.displayName}
                                onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))}
                                placeholder="مثال: سارة"
                                disabled={createLoading}
                              />
                            </div>

                            <div className="settings-field">
                              <label>الإيميل</label>
                              <input
                                className="settings-input"
                                value={createForm.email}
                                onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                                placeholder="name@example.com"
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
                                placeholder="6 أحرف أو أكثر"
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
                                <option value="staff">موظفة</option>
                                <option value="reception">استقبال</option>
                                <option value="admin">Admin</option>
                              </select>
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                            <button
                              className={`exp-btn primary ${createLoading ? "is-disabled" : ""}`}
                              type="button"
                              disabled={createLoading}
                              onClick={handleCreateUser}
                            >
                              {createLoading ? "جاري الإنشاء..." : "إنشاء الحساب"}
                            </button>

                            <button
                              className={`exp-btn ${usersLoading ? "is-disabled" : ""}`}
                              type="button"
                              disabled={usersLoading}
                              onClick={loadUsers}
                            >
                              تحديث القائمة
                            </button>

                            {createMsg && (
                              <span className="settings-alert success" style={{ marginInlineStart: 6 }}>
                                {createMsg}
                              </span>
                            )}
                          </div>

                          <div className="settings-footnote" style={{ marginTop: 10 }}>
                            * يتم إنشاء الحساب في Firebase Auth + حفظ الدور داخل Firestore في{" "}
                            <b>salons/main/users/{`{uid}`}</b>.
                            <br />
                            * لا يتم تسجيل خروجك لأننا نستخدم Secondary Auth.
                          </div>
                        </div>

                        <div className="settings-card">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h3 className="settings-title" style={{ margin: 0 }}>
                              قائمة الحسابات
                            </h3>
                            <span style={{ opacity: 0.7, fontSize: 12 }}>
                              {usersLoading ? "جاري التحميل..." : `${users.length} حساب`}
                            </span>
                          </div>

                          {usersLoading ? (
                            <p style={{ margin: "10px 0 0", opacity: 0.75 }}>تحميل…</p>
                          ) : users.length === 0 ? (
                            <p style={{ margin: "10px 0 0", opacity: 0.75 }}>لا توجد حسابات لعرضها.</p>
                          ) : (
                            <div className="table-responsive" style={{ marginTop: 10 }}>
                              <table className="ov-table">
                                <thead>
                                  <tr>
                                    <th>الاسم</th>
                                    <th>الإيميل</th>
                                    <th>الدور</th>
                                    <th>الحالة</th>
                                  </tr>
                                </thead>

                                <tbody>
                                  {users.map((u) => (
                                    <tr key={u.uid}>
                                      <td>
                                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                          <input
                                            className="settings-input"
                                            style={{ minWidth: 180 }}
                                            value={u.displayName || ""}
                                            disabled={!canManageUsers || usersLoading}
                                            onChange={(e) => {
                                              const v = e.target.value;
                                              setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, displayName: v } : x)));
                                            }}
                                            placeholder="اسم الموظفة"
                                            title="تعديل الاسم"
                                          />

                                          <button
                                            type="button"
                                            className="exp-btn primary"
                                            disabled={!canManageUsers || usersLoading}
                                            onClick={() => updateUserDisplayName(u.uid, u.displayName)}
                                            title="حفظ الاسم"
                                          >
                                            حفظ
                                          </button>
                                        </div>
                                      </td>

                                      <td>{u.email || "-"}</td>

                                      <td>
                                        <select
                                          className="settings-input"
                                          style={{ minWidth: 120 }}
                                          value={u.role}
                                          disabled={!canManageUsers || usersLoading}
                                          onChange={(e) => updateUserRole(u.uid, e.target.value as UiRole)}
                                          title="تعديل الدور"
                                        >
                                          <option value="staff">staff</option>
                                          <option value="reception">reception</option>
                                          <option value="admin">admin</option>
                                        </select>
                                      </td>

                                      <td>
                                        <button
                                          type="button"
                                          className={`exp-btn ${u.active ? "" : "primary"}`}
                                          disabled={!canManageUsers || usersLoading}
                                          onClick={() => toggleUserActive(u.uid, !u.active)}
                                          title={u.active ? "إيقاف الحساب" : "تفعيل الحساب"}
                                        >
                                          {u.active ? "نشط ✅" : "موقوف ⛔"}
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          <div className="settings-footnote" style={{ marginTop: 10 }}>
                            * المرحلة الحالية: إنشاء الحسابات + عرضها + تعديل الاسم + تعديل الدور + تفعيل/إيقاف.
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardSettings;
