

import React, { useMemo, useState } from "react";

const SERVER_URL = "http://localhost:5173"; // عدل إذا تغير

type StoredUser = {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  password?: string;
  role?: string;
};

type Step = 1 | 2 | 3 | 4;

const STORAGE_KEYS = ["clients", "users", "users_v1", "registeredUsers"];

function readUsers(): StoredUser[] {
  for (const key of STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as StoredUser[];
      if (parsed && Array.isArray(parsed.users)) return parsed.users as StoredUser[];
    } catch {
      // ignore
    }
  }
  return [];
}

function writeUsers(updated: StoredUser[]) {
  const existingKey = STORAGE_KEYS.find((k) => localStorage.getItem(k));
  const key = existingKey || "clients";
  localStorage.setItem(key, JSON.stringify(updated));
}

function normalize(v: string) {
  return (v || "").toLowerCase().trim();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

const ForgotPassword: React.FC = () => {
  const [step, setStep] = useState<Step>(1);

  const [identifier, setIdentifier] = useState(""); // email
  const [otp, setOtp] = useState(""); // returned (demo)
  const [enteredOtp, setEnteredOtp] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loading, setLoading] = useState(false);

  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);

  const allUsers = useMemo(() => readUsers(), []);

  const resetMessages = () => {
    setError("");
    setSuccess("");
  };

  const goToStep = (s: Step) => {
    resetMessages();
    setStep(s);
  };

  const ensureUserExists = (email: string) => {
    const idx = allUsers.findIndex((u) => normalize(u.email || "") === normalize(email));
    return idx !== -1;
  };

  // إرسال الكود من السيرفر
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    const email = identifier.trim();

    if (!email) return setError("اكتب البريد الإلكتروني.");
    if (!isValidEmail(email)) return setError("البريد الإلكتروني غير صحيح.");

    // تحقق محلي سريع: هل الحساب موجود؟
    if (!ensureUserExists(email)) {
      return setError("لم يتم العثور على حساب بهذا البريد.");
    }

    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/send-otp-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (data.success) {
        // للعرض المؤقت فقط (يفضل السيرفر ما يرجع otp نهائياً في الإنتاج)
        setOtp(String(data.otp || ""));
        setEnteredOtp("");
        setSuccess("تم إرسال كود التحقق إلى بريدك الإلكتروني.");
        setStep(2);
      } else {
        setError(data.error || "حدث خطأ أثناء الإرسال.");
      }
    } catch {
      setError("تعذر الاتصال بالسيرفر، تأكد أنه يعمل.");
    }
    setLoading(false);
  };

  // تحقق من الكود (محلياً)
  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    const input = enteredOtp.trim();

    if (!input) return setError("أدخل كود التحقق.");
    if (!/^\d{6}$/.test(input)) return setError("الكود لازم يكون 6 أرقام.");

    if (input === otp) {
      setStep(3);
    } else {
      setError("الكود غير صحيح.");
    }
  };

  // تعيين كلمة المرور الجديدة في localStorage
  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();

    const email = identifier.trim();

    if (!newPassword || !confirmPassword) return setError("أدخل كلمة المرور الجديدة وتأكيدها.");
    if (newPassword.length < 6) return setError("كلمة المرور لازم تكون 6 أحرف على الأقل.");
    if (newPassword !== confirmPassword) return setError("كلمة المرور غير متطابقة.");

    const users = readUsers();
    let updated = false;

    const next = users.map((u) => {
      if (normalize(u.email || "") === normalize(email)) {
        updated = true;
        return { ...u, password: newPassword };
      }
      return u;
    });

    if (!updated) return setError("لم يتم العثور على حساب بهذا البريد.");

    writeUsers(next);

    setSuccess("تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول بالكلمة الجديدة.");
    setStep(4);
  };

  return (
    <div className="fp-page madan-auth-shell">
      <div className="fp-card">
        <div className="madan-auth-kicker">QUEENS SALON · ACCOUNT RECOVERY</div>
        <h2 className="fp-title">
          {step === 1 && "نسيت كلمة المرور؟"}
          {step === 2 && "أدخل الكود المرسل"}
          {step === 3 && "تعيين كلمة مرور جديدة"}
          {step === 4 && "تم بنجاح ✅"}
        </h2>

        <p className="fp-subtitle">
          {step === 1 && "اكتبي بريدك المسجل لإرسال رمز التحقق"}
          {step === 2 && "اكتبي رمز التحقق المرسل إلى بريدك"}
          {step === 3 && "اكتبي كلمة مرور قوية ثم أكديها"}
          {step === 4 && "تم تحديث كلمة المرور بنجاح"}
        </p>

        {/* Alerts */}
        {error && <div className="fp-alert fp-error">{error}</div>}
        {success && <div className="fp-alert fp-success">{success}</div>}

        {/* Step 1 */}
        {step === 1 && (
          <form onSubmit={handleSendOtp} className="fp-form">
            <label className="fp-label">البريد الإلكتروني المسجل</label>
            <input
              type="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="name@email.com"
              className="fp-input"
              dir="ltr"
            />

            <button className="fp-btn" type="submit" disabled={loading}>
              {loading ? "جارٍ الإرسال..." : "إرسال الكود"}
            </button>
          </form>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <form onSubmit={handleVerifyOtp} className="fp-form">
            <label className="fp-label">رمز التحقق</label>
            <input
              type="text"
              value={enteredOtp}
              onChange={(e) => setEnteredOtp(e.target.value)}
              placeholder="6 أرقام"
              className="fp-input"
              dir="ltr"
              inputMode="numeric"
            />

            {otp && (
              <div className="fp-hint">
                للتجربة فقط: الكود هو <b>{otp}</b>
              </div>
            )}

            <button className="fp-btn" type="submit">
              تحقق
            </button>

            <div className="fp-row">
              <button type="button" className="fp-link" onClick={() => goToStep(1)}>
                تعديل البريد
              </button>

              <button
                type="button"
                className="fp-link"
                onClick={(e) => {
                  // إعادة إرسال بنفس البريد
                  handleSendOtp(e as any);
                }}
                disabled={loading}
              >
                إعادة إرسال الكود
              </button>
            </div>
          </form>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <form onSubmit={handleResetPassword} className="fp-form">
            <label className="fp-label">كلمة المرور الجديدة</label>
            <div className="fp-pass">
              <input
                type={showPass ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="********"
                className="fp-input"
                dir="ltr"
              />
              <button type="button" className="fp-eye" onClick={() => setShowPass((s) => !s)}>
                {showPass ? "إخفاء" : "إظهار"}
              </button>
            </div>

            <label className="fp-label">تأكيد كلمة المرور</label>
            <div className="fp-pass">
              <input
                type={showPass2 ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="********"
                className="fp-input"
                dir="ltr"
              />
              <button type="button" className="fp-eye" onClick={() => setShowPass2((s) => !s)}>
                {showPass2 ? "إخفاء" : "إظهار"}
              </button>
            </div>

            <button className="fp-btn" type="submit">
              تعيين كلمة المرور
            </button>

            <button type="button" className="fp-btn fp-secondary" onClick={() => goToStep(2)}>
              رجوع
            </button>
          </form>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <div className="fp-done">
            <a href="/login" className="fp-login">
              تسجيل الدخول الآن
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
