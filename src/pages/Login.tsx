// src/pages/Login.tsx
import React, { useState } from "react";
import logoBelak from "../assets/images/ssunnamed.png";
import { Link, useNavigate } from "react-router-dom";
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
import { auth } from "../services/firebase";
import { createUserWithEmailAndPassword } from "firebase/auth";

// ✅ Firebase login (يدخل كل اللي عنده ايميل: إدارة + عميلات)
import { loginWithEmail } from "../services/authService";

// ✅ User profile/roles (Firestore SoT)
import {
  createOrLoadUserProfile,
  updateUserProfile,
  canAccessDashboard,
  type UserProfile,
  type UiRole,
} from "../services/userProfile";

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

  const navigate = useNavigate();

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
  const defaultNameByRole = (role: UiRole) => {
    if (role === "owner" || role === "admin") return "مدير الصالون";
    if (role === "reception" || role === "staff") return "موظفة";
    if (role === "client") return "عميلة";
    return "مستخدم";
  };

  // ✅ تخزين جلسة Firebase (إدارة أو عميلة) بشكل موحد
  const storeFirebaseSession = (profile: UserProfile) => {
    const uiRole: UiRole = profile.role;

    // تنظيف أي جلسة local قديمة
    localStorage.removeItem("currentUser");

    const finalName = (profile.name || "").trim() || defaultNameByRole(uiRole);

    localStorage.setItem("authToken", "firebase");
    localStorage.setItem("userUid", profile.uid);
    localStorage.setItem("userRole", uiRole);
    localStorage.setItem("userName", finalName);
    localStorage.setItem("showWelcome", "true");

    if (profile.email) localStorage.setItem("userEmail", profile.email);
    if (profile.phone) localStorage.setItem("userPhone", profile.phone);

    localStorage.setItem(
      "user_profile_v1",
      JSON.stringify({
        ...profile,
        name: finalName,
      })
    );

    // ✅ مفتاح موحد تعتمد عليه صفحات الداشبورد/البورتال
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        uid: profile.uid,
        email: profile.email || auth.currentUser?.email || "",
        role: uiRole,
        displayName: finalName,
      })
    );

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
  // المكان: داخل handleSubmit
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg(null);

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

        // ✅ ينشئ/يحمل البروفايل من Firestore (Source of Truth)
        const profileRaw = await createOrLoadUserProfile(authUser);

        // ✅ إصلاح الاسم لو فاضي
        const fixedName =
          (profileRaw.name || "").trim() || defaultNameByRole(profileRaw.role);

        // ✅ نكتب البيانات الناقصة مرة وحدة (بدون role)
        if (!(profileRaw.name || "").trim()) {
          try {
            await updateUserProfile(profileRaw.uid, { name: fixedName } as any);
          } catch {
            // ignore
          }
        }

        const profile: UserProfile = { ...profileRaw, name: fixedName };

        // ✅ خزّن جلسة موحدة
        storeFirebaseSession(profile);

        // ✅ توجيه حسب الدور
        if (canAccessDashboard(profile.role)) {
          navigate("/dashboard/overview", { replace: true });
        } else {
          // client / guest
          navigate("/profile", { replace: true });
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
          navigate("/profile", { replace: true });
          return;
        }

        setErrorMsg("الجوال أو كلمة المرور غير صحيحة.");
        return;
      }

      setErrorMsg("اكتب بريد إلكتروني صحيح أو رقم جوال يبدأ بـ 05.");
    } catch (err: any) {
      setErrorMsg(err?.message || "فشل تسجيل الدخول");
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ التسجيل (الآن Firebase + إنشاء profile role=client تلقائيًا)
  // المكان: داخل handleRegister
  const handleRegister = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);

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
        registerData.email.trim(),
        registerData.password
      );

      // ✅ 2) إنشاء/تحميل بروفايل في Firestore
      // (إذا doc غير موجود: role=client تلقائيًا حسب userProfile.ts)
      const profile = await createOrLoadUserProfile(cred.user);

      // ✅ 3) حدّث بيانات العميلة (بدون role)
      try {
        await updateUserProfile(profile.uid, {
          name: registerData.name.trim(),
          phone: registerData.phone.trim(),
          city: (registerData.city || "").trim(),
          birthdate: (registerData.birthdate || "").trim(),
          email: registerData.email.trim(),
        } as any);
      } catch (e) {
        // حتى لو فشل التحديث، البروفايل الأساسي موجود
        console.warn("updateUserProfile after register failed:", e);
      }

      // ✅ 4) إعادة تحميل أحدث نسخة من البروفايل (اختياري لكن يعطيك بيانات أحدث)
      const latest = await createOrLoadUserProfile(cred.user);

      // ✅ 5) خزّن الجلسة
      storeFirebaseSession(latest);

      // ✅ 6) توجيه العميلة
      navigate("/profile", { replace: true });
    } catch (err: any) {
      console.error("❌ SIGNUP FAILED:", err?.code, err?.message, err);

      const code = String(err?.code || "");
      if (code.includes("auth/operation-not-allowed")) {
        setErrorMsg("Email/Password غير مفعّل في Firebase. فعّله من Authentication → Sign-in method.");
      } else if (code.includes("auth/email-already-in-use")) {
        setErrorMsg("هذا البريد مسجل مسبقًا. جرّب تسجيل الدخول بدل التسجيل.");
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

          <div className="login-footer">
            <p>
              {!isRegister ? (
                <>
                  ليس لديك حساب؟
                  <button
                    className="register-link"
                    style={{
                      background: "none",
                      border: "none",
                      color: "#e8b4a2",
                      fontWeight: "bold",
                      marginRight: 5,
                    }}
                    onClick={() => setIsRegister(true)}
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
                      color: "#e8b4a2",
                      fontWeight: "bold",
                      marginRight: 5,
                    }}
                    onClick={() => setIsRegister(false)}
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
