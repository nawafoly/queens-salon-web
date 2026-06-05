// src/pages/Login.tsx
import React, { useEffect, useState } from "react";
import logoBelak from "../assets/images/ssunnamed2.png";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEye,
  faEyeSlash,
  faUser,
  faLock,
  faEnvelope,
  faMobile,
  faCity,
  faCalendarAlt,
} from "@fortawesome/free-solid-svg-icons";
import "../styles/Login.css";

// ✅ Firebase Auth
import { auth, db } from "../services/firebase";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";

// ✅ Firestore
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

// ✅ Firebase login (يدخل كل اللي عنده ايميل: إدارة + عميلات)
import { loginWithEmail } from "../services/authService";
import { writeAuditLog } from "../services/logService";

// ✅ User profile/roles (Firestore SoT) - للعميلات
import {
  createOrLoadUserProfile,
  updateUserProfile,
  canAccessDashboard,
  type UserProfile,
  type UiRole,
} from "../services/userProfile";
import { resolveDashboardLandingPath } from "../helpers/routePaths";
import {
  readStoredAuthSession,
  writeStoredAuthSession,
} from "../services/localAuthSession";

// بيانات التسجيل
interface RegisterFormData {
  name: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
  city?: string;
  birthdate?: string;
}

const SALON_ID = "main";
const USERS_COL = ["salons", SALON_ID, "users"] as const;
const STAFF_PUBLIC_COL = ["salons", SALON_ID, "staff_public"] as const;
const PUBLIC_DEV_BASE = "https://pub-6ee7ebda32364985aa26e0386b7fbe28.r2.dev";
const PUBLIC_DEV_BASE_CLEAN = PUBLIC_DEV_BASE.replace(/\/+$/, "");

type AdminRole = "owner" | "admin" | "reception" | "staff" | "pending";

/* =========================
   Helpers (Admin domain)
========================= */
function cleanEmail(v: string) {
  return String(v || "").trim().toLowerCase();
}

function sanitizeNextPath(raw: string) {
  const value = String(raw || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "";
  return value;
}

function isMalikatAdminEmail(email: string) {
  const e = cleanEmail(email);
  return e.endsWith("@malikat.com");
}

function normalizeAdminRole(raw: any): AdminRole {
  const r = String(raw || "").toLowerCase().trim();
  if (r === "owner") return "owner";
  if (r === "admin" || r === "administrator") return "admin";
  if (
    r === "reception" ||
    r === "receptionist" ||
    r === "frontdesk" ||
    r === "desk"
  )
    return "reception";
  if (r === "staff") return "staff";
  return "pending";
}

function resolveStableAvatarUrl(raw: unknown): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  if (input.startsWith(`${PUBLIC_DEV_BASE_CLEAN}/`)) return input;

  const lower = input.toLowerCase();
  const isPresigned =
    lower.includes("cloudflarestorage.com") || lower.includes("x-amz-");
  if (!isPresigned) return input;

  try {
    const u = new URL(input);
    const parts = u.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (!parts.length) return "";

    const miscIdx = parts.findIndex((p) => p === "misc");
    const key = miscIdx >= 0 ? parts.slice(miscIdx).join("/") : parts.join("/");
    return key ? `${PUBLIC_DEV_BASE_CLEAN}/${key}` : "";
  } catch {
    return "";
  }
}

function isClientPlaceholderName(raw: string) {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/ة/g, "ه");
  return (
    normalized === "عميله" ||
    normalized === "client" ||
    normalized === "user" ||
    normalized === "مستخدم"
  );
}

/**
 * ✅ الإداريين: الـ SoT = salons/main/users/{uid}
 * - لو موجود: نقرأ role + active
 * - لو غير موجود: ننشئه pending + active=false
 * - ونضمن staff_public موجود كـ ملف موظفة (لكن بدون ما نعطي صلاحيات)
 *
 * 🔥 FIX مهم:
 * staff_public rules عندك فيها hasOnly(keys)
 * لذلك ممنوع نكتب أي حقول إضافية غير المسموح بها.
 */
async function ensureAdminSessionFromUsers(params: {
  uid: string;
  email: string;
  displayName?: string;
}) {
  const uid = params.uid;
  const email = cleanEmail(params.email);
  const displayName = String(params.displayName || "").trim();

  // 1) اقرأ users/{uid}
  const userRef = doc(db, ...USERS_COL, uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    const data: any = userSnap.data();

    // ✅ التفعيل لازم يكون صريح active=true فقط
    const active = data?.active === true;
    const role = active ? normalizeAdminRole(data?.role) : "pending";

    // ✅ ضمان وجود staff_public doc (اختياري لكنه مفيد للربط)
    // 🔥 نكتب فقط المفاتيح المسموحة في rules
    const spRef = doc(db, ...STAFF_PUBLIC_COL, uid);
    const spSnap = await getDoc(spRef);

    if (!spSnap.exists()) {
      const safeName = String(
        data?.displayName || data?.name || displayName || ""
      ).trim();

      try {
        await setDoc(
          spRef,
          {
            email,
            linkedUid: uid,
            role: role === "pending" ? "pending" : role,
            active: role === "pending" ? false : true,
            name:
              safeName ||
              (role === "pending"
                ? "حساب إداري (بانتظار التفعيل)"
                : "موظفة"),
            phone: String(data?.phone || "").trim(),
            showOnAbout: false,
            showOnBooking: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (e) {
        console.warn("ensureAdminSessionFromUsers staff_public create failed:", e);
      }
    }

    return {
      role,
      active,
      name: String(data?.displayName || data?.name || displayName || "").trim(),
      email: String(data?.email || email || "").trim(),
      phone: String(data?.phone || "").trim(),
      staffDocId: uid,
    };
  }

  // 2) غير موجود: ننشئ pending في users + staff_public
  const pendingUserPayload = {
    email,
    displayName: displayName || "حساب إداري (بانتظار التفعيل)",
    role: "pending",
    active: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: uid, // نفسه (لأنه سجل دخول بنفسه)
    createdByEmail: email,
  };

  await setDoc(userRef, pendingUserPayload, { merge: true });

  // 🔥 نكتب فقط المفاتيح المسموحة في rules
  const spRef = doc(db, ...STAFF_PUBLIC_COL, uid);
  try {
    await setDoc(
      spRef,
      {
        email,
        linkedUid: uid,
        role: "pending",
        active: false,
        name: displayName || "حساب إداري (بانتظار التفعيل)",
        phone: "",
        showOnAbout: false,
        showOnBooking: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (e) {
    console.warn("ensureAdminSessionFromUsers staff_public create failed:", e);
  }

  return {
    role: "pending" as const,
    active: false,
    name: displayName || "حساب إداري (بانتظار التفعيل)",
    email,
    phone: "",
    staffDocId: uid,
  };
}

const Login: React.FC = () => {
  const [isRegister, setIsRegister] = useState(false);

  // حقل واحد للدخول (جوال أو بريد)
  const [loginData, setLoginData] = useState<{
    identifier: string;
    password: string;
  }>({
    identifier: "",
    password: "",
  });

  const [registerData, setRegisterData] = useState<RegisterFormData>({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
    city: "",
    birthdate: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ✅ جديد: رسالة نجاح (عشان تعرف إن العملية تمت)
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const requestedNextPath = sanitizeNextPath(
    new URLSearchParams(location.search).get("next") || ""
  );
  const clientLandingPath = requestedNextPath || "/profile";

  useEffect(() => {
    const mode = String(new URLSearchParams(location.search).get("mode") || "")
      .trim()
      .toLowerCase();

    if (mode === "register") {
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsRegister(true);
      return;
    }

    if (mode === "login") {
      setErrorMsg(null);
      setSuccessMsg(null);
      setIsRegister(false);
    }
  }, [location.search]);

  // ✅ لو الجلسة موجودة بالفعل: وجّه حسب الدور من Auth + Firestore
  useEffect(() => {
    const currentSession = readStoredAuthSession();
    let alive = true;
    const redirectByRole = async (u: any) => {
      if (!u || !alive) return;
      const profile = await createOrLoadUserProfile(u);
      const stableAvatar = resolveStableAvatarUrl((profile as any)?.avatarUrl);
      if (stableAvatar) {
        localStorage.setItem("userAvatar", stableAvatar);
      } else {
        localStorage.removeItem("userAvatar");
      }
      const isMalikatAuth = isMalikatAdminEmail(String(u?.email || ""));
      let role = String(profile?.role || "").toLowerCase().trim() as UiRole;
      if (isMalikatAuth && (role === "client" || role === "guest")) {
        role = "pending";
      }

      if (role === "pending") {
        navigate("/dashboard-pending", { replace: true });
        return;
      }
      if (canAccessDashboard(role)) {
        navigate(resolveDashboardLandingPath(role), { replace: true });
        return;
      }
      if (role === "client") navigate(clientLandingPath, { replace: true });
    };

    redirectByRole(auth.currentUser).catch(() => {});
    const unsub = onAuthStateChanged(auth, (u) => {
      redirectByRole(u).catch(() => {});
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [navigate, clientLandingPath]);

  // مساعدة: التحقق من الجوال والإيميل
  const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const isPhone = (value: string) => /^05\d{8}$/.test(value);

  // تغيير بيانات الفورم (دخول)
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLoginData((prev) => ({ ...prev, [name]: value }));
  };

  // تغيير بيانات الفورم (تسجيل)
  const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRegisterData((prev) => ({ ...prev, [name]: value }));
  };

  // ✅ اسم افتراضي حسب الدور
  const defaultNameByRole = (role: string) => {
    if (role === "owner" || role === "admin") return "مدير الصالون";
    if (role === "reception" || role === "staff") return "موظفة";
    if (role === "client") return "عميلة";
    if (role === "pending") return "حساب إداري (بانتظار التفعيل)";
    return "مستخدم";
  };

  // ✅ تخزين جلسة Firebase (إدارة أو عميلة) بشكل موحد
  const storeFirebaseSession = (
    profile: UserProfile | (Omit<UserProfile, "role"> & { role: any })
  ) => {
    const uiRole = String((profile as any).role || "")
      .toLowerCase()
      .trim() as UiRole;

    // تنظيف أي جلسة local قديمة
    localStorage.removeItem("currentUser");

    // ✅ دايم نخزن الأساسيات (جلسة)
    const profileName = String((profile as any).name || "").trim();
    const finalName = profileName || defaultNameByRole(String(uiRole));
    const persistedSessionName = uiRole === "client" ? profileName : finalName;

    localStorage.setItem("authToken", "firebase");
    localStorage.setItem("userUid", String((profile as any).uid || ""));
    localStorage.setItem("userRole", String(uiRole));
    if (persistedSessionName) localStorage.setItem("userName", persistedSessionName);
    else localStorage.removeItem("userName");
    localStorage.setItem("showWelcome", "true");

    if ((profile as any).email)
      localStorage.setItem("userEmail", String((profile as any).email));
    if ((profile as any).phone)
      localStorage.setItem("userPhone", String((profile as any).phone));

    // ✅ auth_user للجميع (لأن الداشبورد يحتاجه)
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        uid: String((profile as any).uid || ""),
        email: String((profile as any).email || auth.currentUser?.email || ""),
        role: String(uiRole),
        displayName: finalName,
      })
    );

    // ✅ أهم نقطة: بروفايل العميلة (user_profile_v1) للـ client فقط
    if (uiRole === "client") {
      const stableAvatar = resolveStableAvatarUrl((profile as any)?.avatarUrl);
      localStorage.setItem(
        "user_profile_v1",
        JSON.stringify({
          ...(profile as any),
          name: profileName,
          avatarUrl: stableAvatar || (profile as any)?.avatarUrl || "",
        })
      );
      if (stableAvatar) {
        localStorage.setItem("userAvatar", stableAvatar);
      } else {
        localStorage.removeItem("userAvatar");
      }
    } else {
      // ❌ ممنوع أي كاش عميلة للحسابات الإدارية
      localStorage.removeItem("user_profile_v1");
      localStorage.removeItem("userAvatar");
    }

    window.dispatchEvent(new Event("authChanged"));
  };

  // ✅ تسجيل دخول عميلات قديم (Legacy) من localStorage بالجوال فقط
  const storeClientSessionLegacy = (user: RegisterFormData) => {
    localStorage.removeItem("userUid");
    localStorage.removeItem("user_profile_v1");
    localStorage.removeItem("userEmail");
    localStorage.setItem("authToken", "client-token-" + user.phone);
    localStorage.setItem("userRole", "client");
    localStorage.setItem("userName", user.name);
    localStorage.setItem("userPhone", user.phone);
    localStorage.setItem("userCity", user.city || "");
    localStorage.setItem("userBirthdate", user.birthdate || "");
    localStorage.setItem("currentUser", JSON.stringify(user));
    localStorage.setItem("showWelcome", "true");

    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        uid: "client:" + user.phone,
        email: user.email,
        role: "client",
        displayName: user.name,
      })
    );

    window.dispatchEvent(new Event("authChanged"));
  };

  // ✅ تسجيل الدخول
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const identifier = loginData.identifier.trim();
      const password = loginData.password;

      // 1) إذا بريد = Firebase (إدارة + عميلات)
      if (isEmail(identifier)) {
        await loginWithEmail(identifier, password);

        const authUser = auth.currentUser;
        if (!authUser) {
          setErrorMsg("تعذر قراءة بيانات المستخدم من Firebase. أعد المحاولة.");
          return;
        }

        const email = cleanEmail(authUser.email || identifier);

        // ✅ A) إذا إداري @malikat.com → SoT = users/{uid}
        if (isMalikatAdminEmail(email)) {
          let sp: {
            role: AdminRole;
            active: boolean;
            name: string;
            email: string;
            phone: string;
            staffDocId: string;
          };

          try {
            sp = await ensureAdminSessionFromUsers({
              uid: authUser.uid,
              email,
              displayName: authUser.displayName || "",
            });
          } catch (e) {
            console.warn("ensureAdminSessionFromUsers failed:", e);
            sp = {
              role: "pending",
              active: false,
              name: authUser.displayName || "",
              email,
              phone: "",
              staffDocId: authUser.uid,
            };
          }

          const role: AdminRole = sp.active ? (sp.role as any) : "pending";

          const profileForSession: any = {
            uid: authUser.uid,
            role,
            name: sp.name || defaultNameByRole(role),
            email: sp.email,
            phone: sp.phone,
            staffDocId: sp.staffDocId,
          };

          storeFirebaseSession(profileForSession);

          setSuccessMsg("تم تسجيل الدخول بنجاح ✅");
          void writeAuditLog({
            action: "user_login",
            entityType: "user",
            entityId: authUser.uid,
            description: "تم تسجيل الدخول كمستخدم إداري",
            source: "dashboard",
            after: { role, email },
          });

          // ✅ توجيه
          if (role === "pending") {
            navigate("/dashboard-pending", { replace: true });
          } else {
            navigate(resolveDashboardLandingPath(role), { replace: true });
          }
          return;

        }

        // ✅ B) غير الإداري: عميلة (source of truth userProfile)
        const profileRaw = await createOrLoadUserProfile(authUser);

        const rawProfileName = String(profileRaw.name || "").trim();
        const fixedName = rawProfileName || defaultNameByRole(profileRaw.role);

        if (!rawProfileName && profileRaw.role !== "client") {
          try {
            await updateUserProfile(profileRaw.uid, { name: fixedName } as any);
          } catch {
            // ignore
          }
        }

        const profile: UserProfile = {
          ...profileRaw,
          name: rawProfileName || (profileRaw.role === "client" ? "" : fixedName),
        };

        storeFirebaseSession(profile);

        setSuccessMsg("تم تسجيل الدخول بنجاح ✅");
        void writeAuditLog({
          action: "user_login",
          entityType: "client",
          entityId: authUser.uid,
          description: "تم تسجيل الدخول كعميلة",
          source: "client_app",
          after: { role: profile.role, email: profile.email },
        });

        // توجيه حسب الدور
        if (canAccessDashboard(profile.role)) {
          navigate(resolveDashboardLandingPath(profile.role), { replace: true });
        } else {
          navigate(clientLandingPath, { replace: true });
        }

        return;
      }

      // 2) إذا جوال = عميلات Legacy من localStorage
      if (isPhone(identifier)) {
        const savedUsers = JSON.parse(localStorage.getItem("clients") || "[]");
        const user = savedUsers.find(
          (u: RegisterFormData) =>
            (u.email === identifier || u.phone === identifier) &&
            u.password === password
        );

        if (user) {
          storeClientSessionLegacy(user);
          setSuccessMsg("تم تسجيل الدخول بنجاح ✅");
          void writeAuditLog({
            action: "user_login",
            entityType: "client",
            entityId: String(user.phone),
            description: "تم تسجيل الدخول (Legacy) عبر رقم الجوال",
            source: "client_app",
            after: { phone: user.phone, email: user.email },
          });
          navigate(clientLandingPath, { replace: true });
          return;
        }

        setErrorMsg(
          "الجوال أو كلمة المرور غير صحيحة. إذا كان حسابك جديدًا استخدمي البريد الإلكتروني للدخول."
        );
        return;
      }

      setErrorMsg("اكتب بريد إلكتروني صحيح أو رقم جوال يبدأ بـ 05.");
    } catch (err: any) {
      setErrorMsg(err?.message || "فشل تسجيل الدخول");
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ التسجيل (Firebase + إنشاء profile role=client تلقائيًا)
  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedName = String(registerData.name || "").trim();
    const normalizedPhone = String(registerData.phone || "").trim();
    const normalizedCity = String(registerData.city || "").trim();
    const normalizedBirthdate = String(registerData.birthdate || "").trim();
    const normalizedEmail = registerData.email.trim();

    if (!trimmedName) {
      setErrorMsg("الاسم الكامل مطلوب.");
      return;
    }
    if (isClientPlaceholderName(trimmedName)) {
      setErrorMsg("الرجاء كتابة اسمك الحقيقي بدل الاسم الافتراضي.");
      return;
    }
    if (!isPhone(registerData.phone)) {
      setErrorMsg("رقم الجوال يجب أن يبدأ بـ 05 ويكون مكون من 10 أرقام.");
      return;
    }
    if (!isEmail(registerData.email)) {
      setErrorMsg("صيغة البريد الإلكتروني غير صحيحة.");
      return;
    }
    if (registerData.password !== registerData.confirmPassword) {
      setErrorMsg("كلمة المرور وتأكيدها غير متطابقين.");
      return;
    }

    setIsLoading(true);

    try {
      // ✅ 1) إنشاء مستخدم في Firebase Auth
      const cred = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        registerData.password
      );

      try {
        await updateProfile(cred.user, { displayName: trimmedName });
      } catch (e) {
        console.warn("updateProfile displayName failed:", e);
      }

      // ✅ 2) لو اليميل إداري @malikat.com → أنشئه Pending من users + staff_public (مو عميلة)
      const email = cleanEmail(normalizedEmail);

      if (isMalikatAdminEmail(email)) {
        let sp: {
          role: AdminRole;
          active: boolean;
          name: string;
          email: string;
          phone: string;
          staffDocId: string;
        };

        try {
          sp = await ensureAdminSessionFromUsers({
            uid: cred.user.uid,
            email,
            displayName: trimmedName || "",
          });
        } catch (e) {
          console.warn("ensureAdminSessionFromUsers failed:", e);
          sp = {
            role: "pending",
            active: false,
            name: trimmedName || "",
            email,
            phone: normalizedPhone || "",
            staffDocId: cred.user.uid,
          };
        }

        const role: AdminRole = "pending";

        const profileForSession: any = {
          uid: cred.user.uid,
          role,
          name: sp.name || trimmedName || defaultNameByRole(role),
          email: sp.email || email,
          phone: sp.phone || normalizedPhone || "",
          staffDocId: sp.staffDocId,
        };

        storeFirebaseSession(profileForSession);

        // ✅ FORCE: ثبّت جلسة pending 100% قبل التحويل
        localStorage.setItem("authToken", "firebase");
        localStorage.setItem("userUid", cred.user.uid);
        localStorage.setItem("userRole", "pending");
        window.dispatchEvent(new Event("authChanged"));

        setSuccessMsg("تم إنشاء الحساب الإداري بنجاح ✅");
        void writeAuditLog({
          action: "user_created",
          entityType: "user",
          entityId: cred.user.uid,
          description: "تم إنشاء حساب إداري جديد",
          source: "dashboard",
          after: { role, email },
        });

        // ✅ توجيه الإداريات
        navigate("/dashboard-pending", { replace: true });
        return;
      }

      // ✅ 3) عميلة (غير إداري): إنشاء/تحميل بروفايل في Firestore (client)
      const profile = await createOrLoadUserProfile(cred.user);

      // ✅ 4) حدّث بيانات العميلة (بدون role)
      try {
        await updateUserProfile(profile.uid, {
          name: trimmedName,
          phone: normalizedPhone,
          city: normalizedCity,
          birthdate: normalizedBirthdate,
          email: normalizedEmail,
        } as any);
      } catch (e) {
        console.warn("updateUserProfile after register failed:", e);
      }

      // ✅ 5) أحدث نسخة
      const latest = await createOrLoadUserProfile(cred.user);

      // ✅ 6) خزّن الجلسة
      storeFirebaseSession(latest);
      void writeAuditLog({
        action: "client_created",
        entityType: "client",
        entityId: latest.uid,
        description: "تم إنشاء حساب عميلة جديد",
        source: "client_app",
        after: { name: latest.name, email: latest.email, phone: latest.phone },
      });

      setSuccessMsg("تم إنشاء الحساب بنجاح ✅");

      // ✅ 7) توجيه العميلة
      navigate(clientLandingPath, { replace: true });
    } catch (err: any) {
      console.error("❌ SIGNUP FAILED:", {
        code: err?.code,
        message: err?.message,
        name: err?.name,
        stack: err?.stack,
      });

      const code = String(err?.code || "");
      if (code.includes("auth/operation-not-allowed")) {
        setErrorMsg(
          "Email/Password غير مفعّل في Firebase. فعّله من Authentication → Sign-in method."
        );
      } else if (code.includes("auth/email-already-in-use")) {
        // ✅ لو الإيميل موجود، جرّب تسجيل دخول بنفس الباسورد ثم وده للملف الشخصي
        try {
          await loginWithEmail(registerData.email.trim(), registerData.password);

          const u = auth.currentUser;
          if (u) {
            const email = cleanEmail(u.email || registerData.email);

            // لو إداري @malikat.com
            if (isMalikatAdminEmail(email)) {
              const sp = await ensureAdminSessionFromUsers({
                uid: u.uid,
                email,
                displayName:
                  u.displayName || trimmedName || "",
              });

              const role: AdminRole = sp.active ? (sp.role as any) : "pending";

              storeFirebaseSession({
                uid: u.uid,
                role,
                name:
                  sp.name ||
                  trimmedName ||
                  defaultNameByRole(role),
                email: sp.email || email,
                phone: sp.phone || normalizedPhone || "",
                staffDocId: sp.staffDocId,
              } as any);

              navigate(
                role === "pending"
                  ? "/dashboard-pending"
                  : resolveDashboardLandingPath(role),
                { replace: true }
              );
              return;
            }

            // عميلة
            const profile = await createOrLoadUserProfile(u);
            storeFirebaseSession(profile);
            navigate(clientLandingPath, { replace: true });
            return;
          }

          setErrorMsg("هذا البريد مسجل مسبقًا. جرّب تسجيل الدخول.");
        } catch {
          setErrorMsg(
            "هذا البريد مسجل مسبقًا. كلمة المرور غير صحيحة أو جرّب (نسيت كلمة المرور)."
          );
        }
      } else if (code.includes("auth/weak-password")) {
        setErrorMsg("كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.");
      } else {
        setErrorMsg(err?.message || "فشل إنشاء الحساب");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <img
                src={logoBelak}
                alt="Body Salon Logo"
                className="login-logo-img"
              />
            </div>
            <h1 className="login-title">
              {isRegister ? "تسجيل حساب جديد" : "تسجيل الدخول"}
            </h1>
            <p className="login-subtitle">أهلاً بك في صالون ملكات للتجميل</p>
          </div>

          {!isRegister ? (
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faEnvelope} className="label-icon" />
                  الجوال أو البريد الإلكتروني
                </label>
                <input
                  type="text"
                  name="identifier"
                  className="form-control-login"
                  placeholder="05xxxxxxxx أو بريدك الإلكتروني"
                  value={loginData.identifier}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faLock} className="label-icon" />
                  كلمة المرور
                </label>
                <div className="password-input-container">
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    className="form-control-login"
                    placeholder="أدخلي كلمة المرور"
                    value={loginData.password}
                    onChange={handleChange}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword((prev) => !prev)}
                  >
                    <FontAwesomeIcon
                      icon={showPassword ? faEyeSlash : faEye}
                    />
                  </button>
                </div>
              </div>

              {errorMsg && (
                <div style={{ color: "red", marginBottom: 8 }}>{errorMsg}</div>
              )}
              {successMsg && (
                <div style={{ color: "green", marginBottom: 8 }}>
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                className={`login-btn ${isLoading ? "loading" : ""}`}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <i className="fas fa-spinner fa-spin me-2"></i>
                    جاري تسجيل الدخول...
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faUser} className="me-2" />
                    تسجيل الدخول
                  </>
                )}
              </button>

              <div style={{ marginTop: 10, textAlign: "center" }}>
                <Link to="/forgot-password">نسيت كلمة المرور؟</Link>
              </div>

            </form>
          ) : (
            <form className="login-form" onSubmit={handleRegister}>
              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faUser} className="label-icon" />
                  الاسم الكامل
                </label>
                <input
                  type="text"
                  name="name"
                  className="form-control-login"
                  placeholder="أدخلي اسمك الكامل"
                  value={registerData.name}
                  onChange={handleRegisterChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faMobile} className="label-icon" />
                  رقم الجوال
                </label>
                <input
                  type="tel"
                  name="phone"
                  className="form-control-login"
                  placeholder="05xxxxxxxx"
                  value={registerData.phone}
                  onChange={handleRegisterChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faEnvelope} className="label-icon" />
                  البريد الإلكتروني
                </label>
                <input
                  type="email"
                  name="email"
                  className="form-control-login"
                  placeholder="أدخلي بريدك الإلكتروني"
                  value={registerData.email}
                  onChange={handleRegisterChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faLock} className="label-icon" />
                  كلمة المرور
                </label>
                <div className="password-input-container">
                  <input
                    type={showRegisterPassword ? "text" : "password"}
                    name="password"
                    className="form-control-login"
                    placeholder="أدخلي كلمة المرور"
                    value={registerData.password}
                    onChange={handleRegisterChange}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowRegisterPassword((prev) => !prev)}
                  >
                    <FontAwesomeIcon
                      icon={showRegisterPassword ? faEyeSlash : faEye}
                    />
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faLock} className="label-icon" />
                  تأكيد كلمة المرور
                </label>
                <input
                  type="password"
                  name="confirmPassword"
                  className="form-control-login"
                  placeholder="أعيدي كتابة كلمة المرور"
                  value={registerData.confirmPassword}
                  onChange={handleRegisterChange}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faCity} className="label-icon" />
                  المدينة
                </label>
                <input
                  type="text"
                  name="city"
                  className="form-control-login"
                  placeholder="مدينتك (اختياري)"
                  value={registerData.city}
                  onChange={handleRegisterChange}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <FontAwesomeIcon icon={faCalendarAlt} className="label-icon" />
                  تاريخ الميلاد
                </label>
                <input
                  type="date"
                  name="birthdate"
                  className="form-control-login"
                  placeholder="تاريخ ميلادك (اختياري)"
                  value={registerData.birthdate}
                  onChange={handleRegisterChange}
                />
              </div>

              {errorMsg && (
                <div style={{ color: "red", marginBottom: 8 }}>{errorMsg}</div>
              )}
              {successMsg && (
                <div style={{ color: "green", marginBottom: 8 }}>
                  {successMsg}
                </div>
              )}

              <button
                type="submit"
                className={`login-btn ${isLoading ? "loading" : ""}`}
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <i className="fas fa-spinner fa-spin me-2"></i>
                    جاري إنشاء الحساب...
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faUser} className="me-2" />
                    تسجيل جديد
                  </>
                )}
              </button>
            </form>
          )}

          <div className="login-footer ">
            <p className="qs-wine">
              {!isRegister ? (
                <>
                  ليس لديك حساب؟
                  <button
                    className="register-link"
                    style={{
                      background: "none",
                      border: "none",
                      fontWeight: "bold",
                      marginRight: 5,
                    }}
                    onClick={() => {
                      setErrorMsg(null);
                      setSuccessMsg(null);
                      setIsRegister(true);
                    }}
                    type="button"
                  >
                    سجل الآن
                  </button>
                </>
              ) : (
                <>
                  لديك حساب؟
                  <button
                    className="register-link"
                    style={{
                      background: "none",
                      border: "none",
                      fontWeight: "bold",
                      marginRight: 5,
                    }}
                    onClick={() => {
                      setErrorMsg(null);
                      setSuccessMsg(null);
                      setIsRegister(false);
                    }}
                    type="button"
                  >
                    تسجيل دخول
                  </button>
                </>
              )}
            </p>

            <Link to="/" className="back-home-link">
              <i className="fas fa-arrow-right me-2"></i>
              العودة للصفحة الرئيسية
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
