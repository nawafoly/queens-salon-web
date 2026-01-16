import React, { useState } from "react";
import "../styles/ForgotPassword.css";

import { getAuth, sendPasswordResetEmail } from "firebase/auth";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const resetMessages = () => {
    setError("");
    setSuccess("");
  };

  // ✅ إرسال رابط إعادة تعيين كلمة المرور عبر Firebase (إرسال فقط)
  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    const v = email.trim();
    if (!v) return setError("اكتب البريد الإلكتروني.");
    if (!isValidEmail(v)) return setError("البريد الإلكتروني غير صحيح.");

    setLoading(true);
    try {
      const auth = getAuth();

      // ✅ نخلي الرابط يفتح صفحتنا /reset-password
      await sendPasswordResetEmail(auth, v, {
        url: "https://queens-salon-web-xmt9.vercel.app/reset-password",
        handleCodeInApp: false,
      });

      setSuccess("تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني ✅");
    } catch (err: any) {
      const code = err?.code || "";

      if (code === "auth/user-not-found") {
        setError("لا يوجد حساب مسجل بهذا البريد.");
      } else if (code === "auth/invalid-email") {
        setError("البريد الإلكتروني غير صحيح.");
      } else if (code === "auth/too-many-requests") {
        setError("محاولات كثيرة، حاول لاحقًا.");
      } else {
        setError("حدث خطأ أثناء الإرسال، حاول مرة أخرى.");
      }
    }
    setLoading(false);
  };

  return (
    <div className="fp-page">
      <div className="fp-card">
        <h2 className="fp-title">نسيت كلمة المرور؟</h2>

        <p className="fp-subtitle">
          أدخل بريدك الإلكتروني المسجل، وسنرسل لك رابط إعادة تعيين كلمة المرور.
        </p>

        {error && <div className="fp-alert fp-error">{error}</div>}
        {success && <div className="fp-alert fp-success">{success}</div>}

        <form onSubmit={handleSendReset} className="fp-form">
          <label className="fp-label">البريد الإلكتروني</label>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@email.com"
            className="fp-input"
            dir="ltr"
            autoComplete="email"
          />

          <button className="fp-btn" type="submit" disabled={loading}>
            {loading ? "جارٍ الإرسال..." : "إرسال رابط الاستعادة"}
          </button>

          <div className="fp-row" style={{ marginTop: 12 }}>
            <a href="/login" className="fp-link">
              رجوع لتسجيل الدخول
            </a>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ForgotPassword;
