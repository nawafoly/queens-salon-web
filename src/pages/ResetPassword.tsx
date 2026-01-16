import React, { useEffect, useMemo, useState } from "react";
import "../styles/ForgotPassword.css";

import {
    getAuth,
    verifyPasswordResetCode,
    confirmPasswordReset,
} from "firebase/auth";

function getParam(name: string) {
    const u = new URL(window.location.href);
    return u.searchParams.get(name) || "";
}

const ResetPassword: React.FC = () => {
    const auth = useMemo(() => getAuth(), []);

    const oobCode = useMemo(() => getParam("oobCode"), []);

    const [emailFromCode, setEmailFromCode] = useState<string>("");
    const [checking, setChecking] = useState(true);

    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [showPass, setShowPass] = useState(false);
    const [showPass2, setShowPass2] = useState(false);

    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [loading, setLoading] = useState(false);

    const resetMessages = () => {
        setError("");
        setSuccess("");
    };

    useEffect(() => {
        const run = async () => {
            resetMessages();

            if (!oobCode) {
                setError("الرابط ناقص أو غير صالح (oobCode).");
                setChecking(false);
                return;
            }

            try {
                const email = await verifyPasswordResetCode(auth, oobCode);
                setEmailFromCode(email);
            } catch (err: any) {
                const code = err?.code || "";
                if (code === "auth/expired-action-code") {
                    setError("انتهت صلاحية الرابط. أرسل رابط جديد.");
                } else if (code === "auth/invalid-action-code") {
                    setError("الرابط غير صالح أو تم استخدامه من قبل.");
                } else if (code === "auth/user-disabled") {
                    setError("تم تعطيل هذا الحساب.");
                } else {
                    setError("تعذر التحقق من الرابط. حاول مرة أخرى.");
                }
            } finally {
                setChecking(false);
            }
        };

        run();
    }, []);


    // ✅ تعيين كلمة مرور جديدة
    const handleConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        resetMessages();

        if (!oobCode) return setError("الرابط غير صالح.");
        if (!newPassword || !confirmPassword)
            return setError("أدخل كلمة المرور الجديدة وتأكيدها.");
        if (newPassword.length < 6)
            return setError("كلمة المرور لازم تكون 6 أحرف على الأقل.");
        if (newPassword !== confirmPassword)
            return setError("كلمة المرور غير متطابقة.");

        setLoading(true);
        try {
            await confirmPasswordReset(auth, oobCode, newPassword);
            setSuccess("تم تغيير كلمة المرور بنجاح ✅ يمكنك تسجيل الدخول الآن.");
        } catch (err: any) {
            const code = err?.code || "";
            if (code === "auth/expired-action-code") {
                setError("انتهت صلاحية الرابط. أرسل رابط جديد.");
            } else if (code === "auth/invalid-action-code") {
                setError("الرابط غير صالح أو تم استخدامه من قبل.");
            } else if (code === "auth/weak-password") {
                setError("كلمة المرور ضعيفة، اختر كلمة أقوى.");
            } else {
                setError("حدث خطأ أثناء تغيير كلمة المرور، حاول مرة أخرى.");
            }
        }
        setLoading(false);
    };

    return (
        <div className="fp-page">
            <div className="fp-card">
                <h2 className="fp-title">تعيين كلمة مرور جديدة</h2>

                <p className="fp-subtitle">
                    {checking
                        ? "جارٍ التحقق من الرابط..."
                        : emailFromCode
                            ? `للحساب: ${emailFromCode}`
                            : "تحقق من الرابط ثم قم بتعيين كلمة المرور."}
                </p>

                {error && <div className="fp-alert fp-error">{error}</div>}
                {success && <div className="fp-alert fp-success">{success}</div>}

                {checking ? (
                    <div style={{ textAlign: "center", padding: "10px 0" }}>
                        جاري التحميل...
                    </div>
                ) : !emailFromCode ? (
                    <div
                        className="fp-row"
                        style={{ justifyContent: "center", marginTop: 12 }}
                    >
                        <a href="/forgot-password" className="fp-link">
                            إرسال رابط جديد
                        </a>
                    </div>
                ) : (
                    <form onSubmit={handleConfirm} className="fp-form">
                        <label className="fp-label">كلمة المرور الجديدة</label>
                        <div className="fp-pass">
                            <input
                                type={showPass ? "text" : "password"}
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="********"
                                className="fp-input"
                                dir="ltr"
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                className="fp-eye"
                                onClick={() => setShowPass((s) => !s)}
                            >
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
                                autoComplete="new-password"
                            />
                            <button
                                type="button"
                                className="fp-eye"
                                onClick={() => setShowPass2((s) => !s)}
                            >
                                {showPass2 ? "إخفاء" : "إظهار"}
                            </button>
                        </div>

                        <button className="fp-btn" type="submit" disabled={loading}>
                            {loading ? "جارٍ الحفظ..." : "تأكيد تغيير كلمة المرور"}
                        </button>

                        <div className="fp-row" style={{ marginTop: 12 }}>
                            <a href="/login" className="fp-link">
                                رجوع لتسجيل الدخول
                            </a>

                            <a href="/forgot-password" className="fp-link">
                                إرسال رابط جديد
                            </a>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default ResetPassword;
