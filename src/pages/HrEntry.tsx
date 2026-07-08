import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faLock } from "@fortawesome/free-solid-svg-icons";

import { auth } from "../services/firebase";
import { useEmployeeSession, cleanText } from "./hr/shared";
import { logoutFirebase } from "../services/authService";
import { resolveInternalPostLoginRoute } from "../helpers/routePaths";
import {
  isInternalAuthRole,
  readVerifiedUserAccess,
  type VerifiedUserAccess,
} from "../services/authAccess";
import { writeStoredAuthSession } from "../services/localAuthSession";

function writeInternalSession(access: VerifiedUserAccess, fallbackEmail = "") {
  const profile = access.profile || {};

  writeStoredAuthSession({
    uid: access.uid,
    email: access.email || fallbackEmail,
    role: access.role,
    displayName: access.displayName || access.email || fallbackEmail,
    phone: access.phone,
    active: access.active,
    showWelcome: true,
    permissions: Array.isArray(profile?.permissions) ? profile.permissions : undefined,
    permissionOverrides:
      profile?.permissionOverrides && typeof profile.permissionOverrides === "object"
        ? (profile.permissionOverrides as Record<string, unknown>)
        : undefined,
    permissionVersion: Number(profile?.permissionVersion || 0) || undefined,
    profile,
  });
}

function getLoginErrorMessage(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code || "");

  if (code.includes("auth/invalid-credential")) {
    return "بيانات الدخول غير صحيحة. تأكد من البريد وكلمة المرور.";
  }

  if (code.includes("auth/user-not-found")) {
    return "لا يوجد حساب بهذا البريد.";
  }

  if (code.includes("auth/wrong-password")) {
    return "كلمة المرور غير صحيحة.";
  }

  if (code.includes("auth/too-many-requests")) {
    return "تم إيقاف المحاولة مؤقتًا بسبب كثرة المحاولات. حاول لاحقًا.";
  }

  if (code.includes("auth/invalid-email")) {
    return "صيغة البريد الإلكتروني غير صحيحة.";
  }

  return "تعذر تسجيل الدخول. راجع البيانات وحاول مرة أخرى.";
}

export default function HrEntry() {
  const session = useEmployeeSession();
  const navigate = useNavigate();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(false);

  useEffect(() => {
    let alive = true;

    async function redirectVerifiedInternalUser() {
      if (session.loading) return;

      const uid = cleanText(session.user?.uid || "");
      if (!uid) {
        setCheckingAccess(false);
        return;
      }

      setCheckingAccess(true);

      try {
        const access = await readVerifiedUserAccess(uid);
        if (!alive) return;

        if (!access.exists || !isInternalAuthRole(access.role)) {
          await logoutFirebase();
          if (!alive) return;
          setLoginError("هذا الحساب غير مصرح له بالدخول إلى بوابة الإدارة والموظفين.");
          setCheckingAccess(false);
          return;
        }

        const route = resolveInternalPostLoginRoute(access.role);
        if (!route) {
          await logoutFirebase();
          if (!alive) return;
          setLoginError("تعذر تحديد وجهة هذا الحساب داخل المنصة.");
          setCheckingAccess(false);
          return;
        }

        writeInternalSession(access, session.user?.email || "");
        navigate(route, { replace: true });
      } catch (error) {
        console.warn("[HrEntry] failed to verify live HR authorization", error);
        await logoutFirebase().catch(() => undefined);
        if (!alive) return;
        setLoginError("تعذر التحقق من صلاحية الحساب. حاول تسجيل الدخول مرة أخرى.");
        setCheckingAccess(false);
      }
    }

    void redirectVerifiedInternalUser();

    return () => {
      alive = false;
    };
  }, [navigate, session.loading, session.user?.email, session.user?.uid]);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loginLoading) return;

    const email = cleanText(loginEmail);
    const password = String(loginPassword || "");

    if (!email || !password) {
      setLoginError("اكتب البريد الإلكتروني وكلمة المرور.");
      return;
    }

    setLoginLoading(true);
    setLoginError("");

    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const access = await readVerifiedUserAccess(credential.user.uid);

      if (!access.exists || !isInternalAuthRole(access.role)) {
        await logoutFirebase();
        setLoginError("هذا الحساب غير مصرح له بالدخول إلى بوابة الإدارة والموظفين.");
        return;
      }

      const route = resolveInternalPostLoginRoute(access.role);
      if (!route) {
        await logoutFirebase();
        setLoginError("تعذر تحديد وجهة هذا الحساب داخل المنصة.");
        return;
      }

      writeInternalSession(access, credential.user.email || email);
      navigate(route, { replace: true });
    } catch (error) {
      await logoutFirebase().catch(() => undefined);
      setLoginError(getLoginErrorMessage(error));
    } finally {
      setLoginLoading(false);
    }
  };

  if (session.loading || checkingAccess) {
    return (
      <main className="hr-entry madan-hr-entry" dir="rtl">
        <div className="hr-entry-loading">جاري التحقق من الصلاحية...</div>
      </main>
    );
  }

  return (
    <main className="hr-entry madan-hr-entry hr-entry--login-only" dir="rtl">
      <div className="hr-entry-shell hr-entry-shell--login-only">
        <section className="hr-entry-menu-panel hr-entry-login-panel" aria-label="تسجيل الدخول">
          <div className="hr-entry-login-card">
            <span className="hr-entry-login-chip">دخول الموظفين</span>

            <div className="hr-entry-menu-head">
              <h1>تسجيل الدخول للمنصة الداخلية</h1>
              <p>استخدم بريدك الإداري أو حساب الإدارة المخصص لك.</p>
            </div>

            <form className="hr-entry-login-form" onSubmit={handleLogin}>
              <label>
                <span>اسم المستخدم أو البريد الإلكتروني</span>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="example@malikat.com"
                  disabled={loginLoading}
                />
              </label>

              <label>
                <span>كلمة المرور</span>
                <div className="hr-entry-password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    disabled={loginLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  >
                    <FontAwesomeIcon icon={faEye} />
                  </button>
                </div>
              </label>

              {loginError ? <div className="hr-entry-login-error">{loginError}</div> : null}

              <button
                type="submit"
                className="hr-entry-login-submit"
                disabled={loginLoading}
              >
                <FontAwesomeIcon icon={faLock} />
                {loginLoading ? "جاري الدخول..." : "دخول المنصة"}
              </button>
            </form>

            <div className="hr-entry-login-footer">
              <Link to="/forgot-password">نسيت كلمة المرور؟</Link>
              <span>الدخول مخصص لحسابات الموظفين والإدارة فقط.</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
