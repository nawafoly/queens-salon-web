import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBuilding,
  faEye,
  faEyeSlash,
  faLock,
  faShieldHalved,
} from "@fortawesome/free-solid-svg-icons";

import { auth } from "../services/firebase";
import { PartnerPortalService } from "../services/partnerPortalService";
import "../styles/PartnerPortal.css";

function translateLoginError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("auth/invalid-credential") || message.includes("auth/wrong-password")) {
    return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  }
  if (message.includes("auth/user-not-found")) return "لا يوجد حساب بهذا البريد.";
  if (message.includes("auth/too-many-requests")) {
    return "تم إيقاف المحاولات مؤقتًا. انتظر قليلًا ثم حاول مجددًا.";
  }
  if (message.includes("partner_auth:partner_access_required")) {
    return "هذا الحساب غير مرتبط بأي شريكة داخل نظام ملكات.";
  }
  if (message.includes("partner_auth:partner_inactive")) {
    return "حساب الشريكة موقوف حاليًا. تواصلي مع إدارة ملكات.";
  }
  if (message.includes("Failed to fetch")) {
    return "تعذر الاتصال بخدمة الشريكات. تأكدي أن الخدمة تعمل ثم أعيدي المحاولة.";
  }
  return "تعذر تسجيل الدخول إلى بوابة الشريكات.";
}

export default function PartnerLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!alive) return;
      if (!user) {
        setChecking(false);
        return;
      }

      try {
        const session = await PartnerPortalService.getSession();
        if (!alive) return;
        navigate(session.kind === "admin" ? "/dashboard/partners" : "/partner", {
          replace: true,
        });
      } catch {
        await signOut(auth).catch(() => undefined);
        if (alive) setChecking(false);
      }
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const session = await PartnerPortalService.getSession();
      navigate(session.kind === "admin" ? "/dashboard/partners" : "/partner", {
        replace: true,
      });
    } catch (loginError) {
      await signOut(auth).catch(() => undefined);
      setError(translateLoginError(loginError));
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <main className="partner-login-page" dir="rtl">
        <div className="partner-login-loading">جاري التحقق من حساب الشريكة...</div>
      </main>
    );
  }

  return (
    <main className="partner-login-page" dir="rtl">
      <section className="partner-login-shell">
        <aside className="partner-login-brand">
          <span className="partner-login-brand__mark">
            <FontAwesomeIcon icon={faBuilding} />
          </span>
          <div>
            <small>MALIKAT PARTNERS</small>
            <h1>بوابة الشريكات</h1>
            <p>
              مساحة موحدة لإدارة العقد، المساحات، الفريق، والمستحقات التشغيلية داخل
              صالون ملكات.
            </p>
          </div>
          <ul>
            <li><FontAwesomeIcon icon={faShieldHalved} /> وصول محمي لكل شريكة</li>
            <li><FontAwesomeIcon icon={faLock} /> بيانات منفصلة عن بقية الشريكات</li>
          </ul>
        </aside>

        <div className="partner-login-card">
          <div className="partner-login-card__head">
            <span>PARTNER ACCESS</span>
            <h2>تسجيل دخول الشريكة</h2>
            <p>استخدمي البريد وكلمة المرور اللذين أنشأتهما لك إدارة ملكات.</p>
          </div>

          <form onSubmit={handleSubmit}>
            <label>
              <span>البريد الإلكتروني</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="partner@example.com"
                required
                disabled={loading}
              />
            </label>

            <label>
              <span>كلمة المرور</span>
              <div className="partner-login-password">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                >
                  <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
                </button>
              </div>
            </label>

            {error ? <div className="partner-login-error">{error}</div> : null}

            <button type="submit" className="partner-login-submit" disabled={loading}>
              <span>{loading ? "جاري التحقق..." : "دخول بوابة الشريكات"}</span>
              <FontAwesomeIcon icon={faArrowLeft} />
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
