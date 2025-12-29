// src/pages/DashboardSettings.tsx
import { useEffect, useMemo, useState } from "react";

import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
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

import { auth } from "../services/firebase";

// ✅ App settings (Firestore: settings/app + cache localStorage)
import { AppSettingsService } from "../services/AppSettingsService";
import type { AppSettings, SectionKey } from "../services/AppSettingsService";

import "../styles/DashboardModals.css";
import "../styles/DashboardSettings.css";

/** ✅ نفس Roles اللي عندك في Dashboard */
type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

/**
 * ✅ مهم: نقبل أي قيمة قديمة (ADMIN/Owner/..)
 * ونحوّلها فورًا لصيغة UI role (lowercase)
 */
function mapFirestoreRoleToUi(roleRaw: string): UiRole {
  const role = String(roleRaw || "")
    .toLowerCase()
    .trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "client") return "client";
  return "guest";
}

/** ✅ أهم قرار: نخزن role في Firestore lowercase دائمًا */
function toFirestoreRole(role: UiRole) {
  const r = String(role || "guest")
    .toLowerCase()
    .trim();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  if (r === "reception") return "reception";
  if (r === "staff") return "staff";
  if (r === "client") return "client";
  return "guest";
}

/** ✅ Secondary Auth: إنشاء مستخدم بدون ما يطلعك من حساب الإدارة */
function getSecondaryAuth() {
  const options = (auth as any)?.app?.options;
  if (!options)
    throw new Error("Missing Firebase app options from auth.app.options");

  const name = "secondary-auth-app";
  const app =
    getApps().find((a) => a.name === name) || initializeApp(options, name);
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

  // ✅ أولاً: نعرض الكاش مباشرة (سريع)
  const [settings, setSettings] = useState<AppSettings>(() =>
    AppSettingsService.getCached()
  );
  const [savedMsg, setSavedMsg] = useState<string>("");

  // ✅ Modal: Advanced Settings (داخل صفحة الإعدادات)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // ✅ داخل المودال: شاشة رئيسية أو إدارة حسابات
  const [advancedView, setAdvancedView] = useState<"main" | "users">("main");

  // ====== Users Manager state (داخل Advanced Modal)
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);

  const [createForm, setCreateForm] = useState({
    displayName: "",
    email: "",
    password: "",
    role: "staff" as UiRole, // staff/reception/admin
  });

  const [createLoading, setCreateLoading] = useState(false);
  const [createMsg, setCreateMsg] = useState<string>("");

  const allowAdminManageUsers = Boolean(
    (settings as any)?.policies?.allowAdminManageUsers
  );

  const canManageUsers = useMemo(() => {
    if (isOwner) return true;
    if (isAdmin) return allowAdminManageUsers;
    return false;
  }, [isOwner, isAdmin, allowAdminManageUsers]);

  // ✅ المصدر الحقيقي للدور: Firestore users/{uid}.role
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthLoading(true);

      try {
        if (!user) {
          setUiRole("guest");
          return;
        }

        const userRef = doc(db, "users", user.uid);
        const snap = await getDoc(userRef);

        // ✅ لو ما فيه وثيقة، ننشئها بـ role lowercase
        if (!snap.exists()) {
          await setDoc(
            userRef,
            {
              role: "staff", // ✅ كان "STAFF"
              displayName: user.displayName || "مستخدم",
              email: (user.email || "").toLowerCase(),
              createdAt: new Date().toISOString(),
              active: true,
            },
            { merge: true }
          );
        }

        const snap2 = await getDoc(userRef);
        const data = snap2.exists() ? (snap2.data() as any) : {};

        // ✅ إذا كان الدور قديم Uppercase نحوله ونثبت نسخة lowercase مرة واحدة
        const mapped = mapFirestoreRoleToUi(data?.role);
        setUiRole(mapped);

        const displayName = data?.displayName || user.displayName || "مستخدم";

        // ✅ تثبيت role بصيغة lowercase داخل Firestore (مرة واحدة فقط إذا كان مختلف)
        const fixedRole = toFirestoreRole(mapped);
        if (String(data?.role || "").trim() !== fixedRole) {
          await setDoc(userRef, { role: fixedRole }, { merge: true });
        }

        // ✅ تحديث localStorage فقط (بدون authChanged لتجنب loop)
        localStorage.setItem("userRole", mapped);
        localStorage.setItem("userName", displayName);
        localStorage.setItem("authToken", "firebase");
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            uid: user.uid,
            email: (user.email || "").toLowerCase(),
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

  // ✅ Firestore Settings (settings/app): fetch + realtime subscribe
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

  // ✅ نخليها string عشان ما تتعطل لو type ما تحدّث في AppSettingsService
  const togglePolicy = (key: string) => {
    if (!hasAdminPower) return;
    setSettings((prev: any) => ({
      ...prev,
      policies: { ...(prev.policies || {}), [key]: !prev.policies?.[key] },
    }));
  };

  // ====== Users Manager (داخل Advanced Modal)
  const loadUsers = async () => {
    if (!canManageUsers) return;

    setUsersLoading(true);
    try {
      const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);

      const list: UserRow[] = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          uid: d.id,
          email: String(x?.email || ""),
          displayName: String(x?.displayName || ""),
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

    // ✅ حماية: admin لا ينشئ owner
    if (!isOwner && role === "owner") {
      setCreateMsg("❌ فقط Owner يقدر ينشئ Owner");
      return;
    }

    try {
      setCreateLoading(true);

      const secondary = getSecondaryAuth();

      // ✅ إنشاء user في Auth (بدون ما يطلعك من حساب الإدارة لأننا نستخدم secondary)
      const cred = await createUserWithEmailAndPassword(
        secondary,
        email,
        password
      );
      const uid = cred.user.uid;

      // ✅ إنشاء وثيقة users/{uid} (role lowercase)
      await setDoc(
        doc(db, "users", uid),
        {
          email,
          displayName,
          role: toFirestoreRole(role), // ✅ كان ADMIN/STAFF .. صار admin/staff
          active: true,
          createdAt: serverTimestamp(),
          createdByUid: (auth as any)?.currentUser?.uid || "",
          createdByEmail: (auth as any)?.currentUser?.email || "",
        },
        { merge: true }
      );

      // ✅ اختياري قوي: نفصل جلسة الـ secondary حتى ما تعلق
      await signOut(secondary).catch(() => {});

      setCreateMsg("✅ تم إنشاء الحساب بنجاح");
      setCreateForm({
        displayName: "",
        email: "",
        password: "",
        role: "staff",
      });

      await loadUsers();
    } catch (e: any) {
      console.error("create user error:", e);
      const m = String(e?.message || "");
      if (m.includes("email-already-in-use"))
        setCreateMsg("❌ هذا الإيميل مستخدم مسبقًا");
      else if (m.includes("weak-password"))
        setCreateMsg("❌ كلمة المرور ضعيفة (جرّب 6 أحرف أو أكثر)");
      else setCreateMsg("❌ تعذر إنشاء الحساب. تأكد من الصلاحيات/Rules");
    } finally {
      setCreateLoading(false);
      setTimeout(() => setCreateMsg(""), 3500);
    }
  };

  // ✅ Loading guard
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

            {/* ✅ Advanced Modal trigger */}
            <button
              className="exp-btn"
              onClick={() => {
                setIsAdvancedOpen(true);
                setAdvancedView("main");
                setCreateMsg("");
              }}
              type="button"
              title="إعدادات متقدمة"
            >
              إعدادات متقدمة
            </button>

            <button
              className={`exp-btn primary ${
                !hasAdminPower ? "is-disabled" : ""
              }`}
              onClick={handleSave}
              disabled={!hasAdminPower}
              type="button"
              title={
                !hasAdminPower ? "تحتاج صلاحية Owner/Admin" : "حفظ الإعدادات"
              }
            >
              حفظ
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="settings-tabs">
          <button
            className={`dash-btn ${tab === "salon" ? "primary" : ""}`}
            onClick={() => setTab("salon")}
            type="button"
          >
            بيانات الصالون
          </button>

          <button
            className={`dash-btn ${tab === "sections" ? "primary" : ""}`}
            onClick={() => setTab("sections")}
            type="button"
          >
            الأقسام
          </button>

          <button
            className={`dash-btn ${tab === "policies" ? "primary" : ""}`}
            onClick={() => setTab("policies")}
            type="button"
          >
            صلاحيات النظام
          </button>
        </div>

        {/* Content */}
        {tab === "salon" && (
          <div className="settings-card">
            <h3 className="settings-title">بيانات الصالون</h3>

            <div className="settings-grid">
              <div className="settings-field">
                <label>اسم الصالون</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.salonName || ""}
                  onChange={(e) =>
                    hasAdminPower &&
                    setSettings({
                      ...(settings as any),
                      salonName: e.target.value,
                    })
                  }
                  disabled={!hasAdminPower}
                />
              </div>

              <div className="settings-field">
                <label>الجوال</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.phone || ""}
                  onChange={(e) =>
                    hasAdminPower &&
                    setSettings({ ...(settings as any), phone: e.target.value })
                  }
                  disabled={!hasAdminPower}
                />
              </div>

              <div className="settings-field">
                <label>المدينة</label>
                <input
                  className="settings-input"
                  value={(settings as any)?.city || ""}
                  onChange={(e) =>
                    hasAdminPower &&
                    setSettings({ ...(settings as any), city: e.target.value })
                  }
                  disabled={!hasAdminPower}
                />
              </div>
            </div>

            {!hasAdminPower && (
              <div className="settings-note">
                * للتعديل تحتاج صلاحية Owner/Admin.
              </div>
            )}
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
              <br />* صفحة الإعدادات لا يمكن إخفاؤها (مقصودة).
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
                  checked={
                    !!(settings as any)?.policies?.allowStaffChangeStatus
                  }
                  onChange={() => togglePolicy("allowStaffChangeStatus")}
                  disabled={!hasAdminPower}
                />
              </label>

              <label className="settings-row">
                <span>السماح للاستقبال بتغيير حالة الحجز</span>
                <input
                  className="settings-check"
                  type="checkbox"
                  checked={
                    !!(settings as any)?.policies?.allowReceptionChangeStatus
                  }
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
              * هذا الخيار يتحكم إذا الـ Admin يقدر ينشئ/يدير حسابات من
              الإعدادات المتقدمة.
            </div>
          </div>
        )}

        {/* ✅ Advanced Settings Modal */}
        {isAdvancedOpen && (
          <div
            className="modal-overlay"
            onClick={() => setIsAdvancedOpen(false)}
          >
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <div className="modal-title-wrap">
                  <div className="modal-icon">⚙️</div>
                  <h3 className="modal-title">
                    {advancedView === "main"
                      ? "إعدادات متقدمة"
                      : "إدارة الحسابات"}
                  </h3>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {advancedView === "users" && (
                    <button
                      className="dash-btn"
                      type="button"
                      onClick={() => setAdvancedView("main")}
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
                      هنا نضيف كل إعدادات النظام بدون ما نرجع نلعب في كود
                      الصفحات.
                    </p>

                    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                      <button
                        className={`exp-btn primary ${
                          !hasAdminPower ? "is-disabled" : ""
                        }`}
                        disabled={!hasAdminPower}
                        type="button"
                        onClick={() =>
                          alert("قريبًا: إدارة الأدوار والصلاحيات")
                        }
                      >
                        إدارة الأدوار والصلاحيات
                      </button>

                      <button
                        className={`exp-btn ${
                          !hasAdminPower ? "is-disabled" : ""
                        }`}
                        disabled={!hasAdminPower}
                        type="button"
                        onClick={() => alert("قريبًا: إعدادات الحجوزات")}
                      >
                        إعدادات الحجوزات
                      </button>

                      <button
                        className={`exp-btn ${
                          !hasAdminPower ? "is-disabled" : ""
                        }`}
                        disabled={!hasAdminPower}
                        type="button"
                        onClick={() => alert("قريبًا: إعدادات الداشبورد")}
                      >
                        إعدادات واجهة الداشبورد
                      </button>

                      <button
                        className={`exp-btn primary ${
                          !canManageUsers ? "is-disabled" : ""
                        }`}
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
                        * Admin: فعّل “السماح للـ Admin بإدارة حسابات
                        المستخدمين” من تبويب صلاحيات النظام.
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {!canManageUsers ? (
                      <div className="settings-note">
                        غير مصرح. هذه الميزة للـ Owner، أو Admin إذا تم تفعيل
                        allowAdminManageUsers.
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
                                onChange={(e) =>
                                  setCreateForm((p) => ({
                                    ...p,
                                    displayName: e.target.value,
                                  }))
                                }
                                placeholder="مثال: سارة"
                                disabled={createLoading}
                              />
                            </div>

                            <div className="settings-field">
                              <label>الإيميل</label>
                              <input
                                className="settings-input"
                                value={createForm.email}
                                onChange={(e) =>
                                  setCreateForm((p) => ({
                                    ...p,
                                    email: e.target.value,
                                  }))
                                }
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
                                onChange={(e) =>
                                  setCreateForm((p) => ({
                                    ...p,
                                    password: e.target.value,
                                  }))
                                }
                                placeholder="6 أحرف أو أكثر"
                                disabled={createLoading}
                              />
                            </div>

                            <div className="settings-field">
                              <label>الدور</label>
                              <select
                                className="settings-input"
                                value={createForm.role}
                                onChange={(e) =>
                                  setCreateForm((p) => ({
                                    ...p,
                                    role: e.target.value as UiRole,
                                  }))
                                }
                                disabled={createLoading}
                              >
                                <option value="staff">موظفة</option>
                                <option value="reception">استقبال</option>
                                <option value="admin">Admin</option>
                              </select>
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              marginTop: 12,
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              className={`exp-btn primary ${
                                createLoading ? "is-disabled" : ""
                              }`}
                              type="button"
                              disabled={createLoading}
                              onClick={handleCreateUser}
                            >
                              {createLoading
                                ? "جاري الإنشاء..."
                                : "إنشاء الحساب"}
                            </button>

                            <button
                              className={`exp-btn ${
                                usersLoading ? "is-disabled" : ""
                              }`}
                              type="button"
                              disabled={usersLoading}
                              onClick={loadUsers}
                            >
                              تحديث القائمة
                            </button>

                            {createMsg && (
                              <span
                                className="settings-alert success"
                                style={{ marginInlineStart: 6 }}
                              >
                                {createMsg}
                              </span>
                            )}
                          </div>

                          <div
                            className="settings-footnote"
                            style={{ marginTop: 10 }}
                          >
                            * يتم إنشاء الحساب في Firebase Auth + حفظ الدور داخل
                            Firestore في users/{`{uid}`}.
                            <br />* لا يتم تسجيل خروجك لأننا نستخدم Secondary
                            Auth.
                          </div>
                        </div>

                        <div className="settings-card">
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <h3
                              className="settings-title"
                              style={{ margin: 0 }}
                            >
                              قائمة الحسابات
                            </h3>
                            <span style={{ opacity: 0.7, fontSize: 12 }}>
                              {usersLoading
                                ? "جاري التحميل..."
                                : `${users.length} حساب`}
                            </span>
                          </div>

                          {usersLoading ? (
                            <p style={{ margin: "10px 0 0", opacity: 0.75 }}>
                              تحميل…
                            </p>
                          ) : users.length === 0 ? (
                            <p style={{ margin: "10px 0 0", opacity: 0.75 }}>
                              لا توجد حسابات لعرضها.
                            </p>
                          ) : (
                            <div
                              className="table-responsive"
                              style={{ marginTop: 10 }}
                            >
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
                                      <td>{u.displayName || "-"}</td>
                                      <td>{u.email || "-"}</td>
                                      <td>{u.role}</td>
                                      <td>{u.active ? "نشط" : "موقوف"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          <div
                            className="settings-footnote"
                            style={{ marginTop: 10 }}
                          >
                            * المرحلة الحالية: إنشاء الحسابات + عرضها.
                            <br />* المرحلة القادمة: تعديل الدور/تعطيل
                            الحساب/إعادة تعيين كلمة المرور.
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
