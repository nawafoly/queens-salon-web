// src/pages/Login.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import "../styles/AuthMobile.css";
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
  faStore,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

// ✅ Firebase Auth
import { auth } from "../services/firebase";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import {
  loginWithEmail,
  registerClientWithEmail,
} from "../services/authService";
import { writeAuditLog } from "../services/logService";

// ✅ User profile/roles (Firestore SoT) - للعميلات
import {
  clearStoredAuthSession,
  writeStoredAuthSession,
} from "../services/localAuthSession";
import {
  isInternalAuthRole,
  readVerifiedUserAccess,
  type VerifiedUserAccess,
} from "../services/authAccess";

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

const PUBLIC_DEV_BASE = "https://pub-6ee7ebda32364985aa26e0386b7fbe28.r2.dev";
const PUBLIC_DEV_BASE_CLEAN = PUBLIC_DEV_BASE.replace(/\/+$/, "");

function cleanEmail(v: string) {
  return String(v || "").trim().toLowerCase();
}

function sanitizeClientNextPath(raw: string) {
  const value = String(raw || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return "";

  const internalPrefixes = [
    "/hr",
    "/admin",
    "/dashboard",
    "/dashboard-pending",
    "/employee",
  ];
  if (internalPrefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))) {
    return "";
  }

  return value;
}

function isReservedInternalEmail(email: string) {
  return cleanEmail(email).endsWith("@malikat.com");
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
  const requestedNextPath = sanitizeClientNextPath(
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

  const loginFlowRef = useRef(false);

  const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const isPhone = (value: string) => /^05\d{8}$/.test(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setLoginData((prev) => ({ ...prev, [name]: value }));
  };

  const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setRegisterData((prev) => ({ ...prev, [name]: value }));
  };

  const clearRejectedFirebaseSession = useCallback(async () => {
    try {
      await signOut(auth);
    } catch {
      // تنظيف الكاش مطلوب حتى لو تعذر signOut.
    } finally {
      clearStoredAuthSession();
      window.dispatchEvent(new Event("authChanged"));
    }
  }, []);

  const storeVerifiedClientSession = useCallback((access: VerifiedUserAccess, user: User) => {
    const sourceProfile = access.profile || {};
    const stableAvatar = resolveStableAvatarUrl(sourceProfile?.avatarUrl);
    const displayName =
      access.displayName || String(user.displayName || "").trim() || "";

    writeStoredAuthSession({
      uid: user.uid,
      email: access.email || String(user.email || "").trim(),
      role: "client",
      displayName,
      phone: access.phone,
      active: access.active,
      showWelcome: true,
      permissions: Array.isArray(sourceProfile?.permissions)
        ? sourceProfile.permissions
        : undefined,
      permissionOverrides:
        sourceProfile?.permissionOverrides &&
        typeof sourceProfile.permissionOverrides === "object"
          ? (sourceProfile.permissionOverrides as Record<string, unknown>)
          : undefined,
      permissionVersion:
        Number(sourceProfile?.permissionVersion || 0) || undefined,
      profile: {
        ...sourceProfile,
        uid: user.uid,
        role: "client",
        active: access.active,
        name: displayName,
        displayName,
        avatarUrl: stableAvatar || sourceProfile?.avatarUrl || "",
      },
    });

    if (stableAvatar) localStorage.setItem("userAvatar", stableAvatar);
  }, []);

  const verifyClientAccount = useCallback(async (user: User) => {
    const access = await readVerifiedUserAccess(user.uid);

    if (access.exists && access.role === "client" && access.active !== false) {
      return access;
    }

    const message = isInternalAuthRole(access.role)
      ? "هذا الحساب مخصص لبوابة الإدارة والموظفين."
      : "هذا الحساب غير مهيأ كحساب عميل.";

    await clearRejectedFirebaseSession();
    throw new Error(message);
  }, [clearRejectedFirebaseSession]);

  // /login لا يعيد توجيه الحسابات الداخلية؛ بل ينهي جلستها في بوابة العملاء.
  useEffect(() => {
    let alive = true;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user || loginFlowRef.current) return;

      void (async () => {
        try {
          const access = await verifyClientAccount(user);
          if (!alive) return;
          storeVerifiedClientSession(access, user);
          navigate(clientLandingPath, { replace: true });
        } catch (error) {
          if (!alive) return;
          setErrorMsg(
            error instanceof Error
              ? error.message
              : "تعذر التحقق من حساب العميل."
          );
        }
      })();
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [clientLandingPath, navigate, storeVerifiedClientSession, verifyClientAccount]);

  // تسجيل دخول العميلات القديم عبر رقم الجوال يبقى مستقلًا عن Firebase.
  const storeClientSessionLegacy = (user: RegisterFormData) => {
    clearStoredAuthSession();
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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const identifier = loginData.identifier.trim();
      const password = loginData.password;

      if (isEmail(identifier)) {
        loginFlowRef.current = true;
        const user = await loginWithEmail(identifier, password);
        const access = await verifyClientAccount(user);

        storeVerifiedClientSession(access, user);
        setSuccessMsg("تم تسجيل الدخول بنجاح ✅");
        void writeAuditLog({
          action: "user_login",
          entityType: "client",
          entityId: user.uid,
          description: "تم تسجيل الدخول كعميلة",
          source: "client_app",
          after: { role: access.role, email: access.email || user.email || "" },
        });
        navigate(clientLandingPath, { replace: true });
        return;
      }

      if (isPhone(identifier)) {
        const savedUsers = JSON.parse(localStorage.getItem("clients") || "[]");
        const user = savedUsers.find(
          (item: RegisterFormData) =>
            item.phone === identifier && item.password === password
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
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : "فشل تسجيل الدخول");
    } finally {
      loginFlowRef.current = false;
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedName = String(registerData.name || "").trim();
    const normalizedPhone = String(registerData.phone || "").trim();
    const normalizedCity = String(registerData.city || "").trim();
    const normalizedBirthdate = String(registerData.birthdate || "").trim();
    const normalizedEmail = cleanEmail(registerData.email);

    if (!trimmedName) {
      setErrorMsg("الاسم الكامل مطلوب.");
      return;
    }
    if (isClientPlaceholderName(trimmedName)) {
      setErrorMsg("الرجاء كتابة اسمك الحقيقي بدل الاسم الافتراضي.");
      return;
    }
    if (!isPhone(normalizedPhone)) {
      setErrorMsg("رقم الجوال يجب أن يبدأ بـ 05 ويكون مكون من 10 أرقام.");
      return;
    }
    if (!isEmail(normalizedEmail)) {
      setErrorMsg("صيغة البريد الإلكتروني غير صحيحة.");
      return;
    }
    if (isReservedInternalEmail(normalizedEmail)) {
      setErrorMsg("هذا البريد مخصص للحسابات الداخلية.");
      return;
    }
    if (registerData.password !== registerData.confirmPassword) {
      setErrorMsg("كلمة المرور وتأكيدها غير متطابقين.");
      return;
    }

    setIsLoading(true);
    loginFlowRef.current = true;

    try {
      const user = await registerClientWithEmail({
        name: trimmedName,
        email: normalizedEmail,
        password: registerData.password,
        phone: normalizedPhone,
        city: normalizedCity,
        birthdate: normalizedBirthdate,
      });
      const access = await verifyClientAccount(user);

      storeVerifiedClientSession(access, user);
      setSuccessMsg("تم إنشاء الحساب بنجاح ✅");
      void writeAuditLog({
        action: "client_created",
        entityType: "client",
        entityId: user.uid,
        description: "تم إنشاء حساب عميلة جديد",
        source: "client_app",
        after: {
          name: access.displayName || trimmedName,
          email: access.email || normalizedEmail,
          phone: access.phone || normalizedPhone,
        },
      });
      navigate(clientLandingPath, { replace: true });
    } catch (error: unknown) {
      const code = String((error as { code?: unknown } | null)?.code || "");

      if (code.includes("auth/email-already-in-use")) {
        try {
          const user = await loginWithEmail(normalizedEmail, registerData.password);
          const access = await verifyClientAccount(user);
          storeVerifiedClientSession(access, user);
          navigate(clientLandingPath, { replace: true });
          return;
        } catch (loginError) {
          setErrorMsg(
            loginError instanceof Error
              ? loginError.message
              : "هذا البريد مسجل مسبقًا. جرّب تسجيل الدخول."
          );
        }
      } else if (code.includes("auth/operation-not-allowed")) {
        setErrorMsg(
          "Email/Password غير مفعّل في Firebase. فعّله من Authentication → Sign-in method."
        );
      } else if (code.includes("auth/weak-password")) {
        setErrorMsg("كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.");
      } else {
        setErrorMsg(error instanceof Error ? error.message : "فشل إنشاء الحساب");
      }
    } finally {
      loginFlowRef.current = false;
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page madan-auth-shell">
      <div className="login-container">
        <div className={`login-card ${isRegister ? "is-register" : "is-login"}`}>
          <div className="login-header">
            <div className="login-logo">
              <img
                src={logoBelak}
                alt="Body Salon Logo"
                className="login-logo-img"
              />
            </div>
            <div className="madan-auth-kicker">QUEENS SALON · SECURE ACCESS</div>
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
                <div className="madan-auth-alert is-error">{errorMsg}</div>
              )}
              {successMsg && (
                <div className="madan-auth-alert is-success">{successMsg}</div>
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

              <div className="madan-auth-link-row">
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
                <div className="madan-auth-alert is-error">{errorMsg}</div>
              )}
              {successMsg && (
                <div className="madan-auth-alert is-success">{successMsg}</div>
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
                    className="register-link madan-auth-switch"
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
                    className="register-link madan-auth-switch"
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

            {!isRegister ? (
              <div className="portal-access-links" aria-label="بوابات تسجيل الدخول">
                <Link to="/hr" className="portal-access-link portal-access-link--staff">
                  <FontAwesomeIcon icon={faUserTie} />
                  <span>دخول الموظفين والإدارة</span>
                </Link>
                <Link to="/partner/login" className="portal-access-link portal-access-link--partner">
                  <FontAwesomeIcon icon={faStore} />
                  <span>دخول الشركاء Partner</span>
                </Link>
              </div>
            ) : null}

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
