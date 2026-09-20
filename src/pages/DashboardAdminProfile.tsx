import React, { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import {
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { auth } from "../services/firebase";
import { CoreAccountService } from "../services/CoreAccountService";
import { readStoredAuthSession } from "../services/localAuthSession";
import "../styles/dashboard-v2/dashboard-v2.css";
import { adminProfileText, type DashboardLanguage } from "../helpers/dashboardAdminProfileLanguage";

type UiRole = "owner" | "admin" | "hr" | "reception" | "staff" | "pending" | "client" | "guest";

type AdminProfileDoc = {
  displayName: string;
  phone: string;
  email: string;
  photoURL: string;
  role: UiRole;
};

const ROLE_LABELS: Record<UiRole, string> = {
  owner: "المالك",
  admin: "الإدارة",
  hr: "الموارد البشرية",
  reception: "الاستقبال",
  staff: "الموظفات",
  pending: "قيد المراجعة",
  client: "عميلة",
  guest: "ضيف",
};

function normalizeRole(raw: unknown): UiRole {
  const role = String(raw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "hr") return "hr";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "pending") return "pending";
  if (role === "client") return "client";
  return "guest";
}

function profileInitials(name: string, email: string) {
  const cleanName = String(name || "").trim();
  if (cleanName) {
    return cleanName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase();
  }
  return String(email || "A").trim().charAt(0).toUpperCase() || "A";
}

const DashboardAdminProfile: React.FC<{ language?: DashboardLanguage }> = ({ language = "ar" }) => {
  const t = (arabic: string) => adminProfileText(language, arabic);
  const bootstrapSession = useMemo(() => {
    try {
      return readStoredAuthSession();
    } catch {
      return null;
    }
  }, [language]);

  const [authLoading, setAuthLoading] = useState(() => !bootstrapSession);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [uid, setUid] = useState(() => bootstrapSession?.uid || "");
  const [accountId, setAccountId] = useState("");
  const [docExists, setDocExists] = useState(false);

  const [profile, setProfile] = useState<AdminProfileDoc>(() =>
    bootstrapSession
      ? {
          displayName: bootstrapSession.displayName || "",
          phone: bootstrapSession.phone || "",
          email: bootstrapSession.email || "",
          photoURL: "",
          role: normalizeRole(bootstrapSession.role),
        }
      : {
          displayName: "",
          phone: "",
          email: "",
          photoURL: "",
          role: "guest",
        }
  );
  const authRequestRef = useRef(0);

  const hasAdminPower = useMemo(() => {
    return profile.role === "owner" || profile.role === "admin";
  }, [profile.role]);

  useEffect(() => {
    let alive = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const requestId = ++authRequestRef.current;
      setMsg("");
      try {
        if (!user) {
          if (!alive || requestId !== authRequestRef.current) return;
          setUid("");
          setAccountId("");
          setDocExists(false);
          setProfile({ displayName: "", phone: "", email: "", photoURL: "", role: "guest" });
          return;
        }
        setUid(user.uid);
        const result = await CoreAccountService.me();
        if (!alive || requestId !== authRequestRef.current) return;
        const account = result.user;
        setAccountId(account.id);
        setDocExists(Boolean(account.id));
        setProfile({
          displayName: String(account.displayName || user.displayName || ""),
          phone: String(account.phone || ""),
          email: String(account.email || user.email || ""),
          photoURL: String(account.photoUrl || user.photoURL || ""),
          role: normalizeRole(account.role || account.primaryRole),
        });
      } catch (e) {
        if (!alive || requestId !== authRequestRef.current) return;
        console.error("Core admin profile load error:", e);
        setAccountId("");
        setDocExists(false);
        setMsg(t("تعذر تحميل الملف الشخصي من Core."));
      } finally {
        if (alive && requestId === authRequestRef.current) setAuthLoading(false);
      }
    });
    return () => { alive = false; unsub(); };
  }, []);

  const handleSave = async () => {
    if (!uid || !accountId || !docExists || !hasAdminPower) return;
    const displayName = String(profile.displayName || "").trim();
    const phone = String(profile.phone || "").trim();
    const photoURL = String(profile.photoURL || "").trim();
    if (!displayName) { setMsg(t("الاسم مطلوب.")); return; }
    try {
      setSaving(true);
      setMsg("");
      const updated = await CoreAccountService.update(accountId, {
        displayName,
        phone,
        photoUrl: photoURL || null,
      });
      setProfile((current) => ({
        ...current,
        displayName: updated.displayName || displayName,
        phone: updated.phone || phone,
        photoURL: updated.photoUrl || photoURL,
      }));
      try {
        const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "null") || {};
        localStorage.setItem("user_profile_v1", JSON.stringify({ ...cached, uid, name: displayName, displayName, phone, email: profile.email, photoURL }));
        localStorage.setItem("userName", displayName);
        localStorage.setItem("userPhone", phone);
        const authUserCached = JSON.parse(localStorage.getItem("auth_user") || "null") || {};
        localStorage.setItem("auth_user", JSON.stringify({ ...authUserCached, uid, email: profile.email, role: profile.role, displayName }));
        window.dispatchEvent(new Event("authChanged"));
      } catch {}
      setMsg(t("تم حفظ الملف الشخصي بنجاح."));
    } catch (e) {
      console.error("Core admin profile save error:", e);
      setMsg(t("تعذر حفظ الملف الشخصي في Core."));
    } finally { setSaving(false); }
  };

  if (authLoading) {
    return (
      <main className="dsv2-page admin-profile-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <section className="dsv2-card dsv2-card--padded admin-profile-v2-loading" aria-label={t("جاري تحميل الملف الشخصي")}>
          <DashboardSkeletonV2 variant="title" width="34%" />
          <DashboardSkeletonV2 lines={3} width="100%" />
        </section>
        <section className="admin-profile-v2-metrics">
          <DashboardSkeletonV2 variant="block" height={124} />
          <DashboardSkeletonV2 variant="block" height={124} />
          <DashboardSkeletonV2 variant="block" height={124} />
          <DashboardSkeletonV2 variant="block" height={124} />
        </section>
      </main>
    );
  }

  if (!hasAdminPower) {
    return (
      <main className="dsv2-page admin-profile-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <DashboardEmptyStateV2
          tone="gold"
          title={t("غير مصرح")}
          description={t("هذه الصفحة مخصصة لحسابات Owner / Admin فقط.")}
        />
      </main>
    );
  }

  const roleLabel = t(ROLE_LABELS[profile.role] || profile.role);
  const initials = profileInitials(profile.displayName, profile.email);
  const messageTone = msg === t("تم حفظ الملف الشخصي بنجاح.") ? "is-success" : "is-error";

  return (
    <main className="dsv2-page admin-profile-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <section className="dsv2-card admin-profile-v2-hero">
        <div className="admin-profile-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">{t("الملف الشخصي الإداري")}</span>
          <h1 className="dsv2-page-title">{t("الملف الشخصي")}</h1>
          <p className="dsv2-page-subtitle">
            {t("تحديث بيانات حساب الإدارة التي تظهر داخل لوحة التحكم مع إبقاء الهوية والدور محميين.")}
          </p>
          <div className="admin-profile-v2-hero__badges">
            <span className="dsv2-badge dsv2-badge--success">{roleLabel}</span>
            <span className={`dsv2-badge ${docExists ? "dsv2-badge--success" : "dsv2-badge--danger"}`}>
              {docExists ? t("الملف مرتبط") : t("حساب Core غير موجود")}
            </span>
          </div>
        </div>

        <div className="admin-profile-v2-identity" aria-label={t("هوية الحساب")}>
          <div className="admin-profile-v2-avatar" aria-hidden={!profile.photoURL}>
            {profile.photoURL ? (
              <img src={profile.photoURL} alt={profile.displayName || t("صورة الحساب")} />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div>
            <strong>{profile.displayName || t("حساب الإدارة")}</strong>
            <span>{profile.email || t("لا يوجد بريد مسجل")}</span>
          </div>
        </div>
      </section>

      <section className="admin-profile-v2-metrics" aria-label={t("ملخص الملف الشخصي")}>
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <p className="dsv2-metric-card__label">{t("الدور")}</p>
          <p className="dsv2-metric-card__value">{roleLabel}</p>
          <p className="dsv2-metric-card__meta">{t("صلاحية الحساب الحالية")}</p>
        </article>

        <article className={`dsv2-metric-card ${docExists ? "dsv2-metric-card--success" : "dsv2-metric-card--danger"}`}>
          <p className="dsv2-metric-card__label">{t("مستند الحساب")}</p>
          <p className="dsv2-metric-card__value">{docExists ? t("موجود") : t("مفقود")}</p>
          <p className="dsv2-metric-card__meta">Core D1 · app_users</p>
        </article>

        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <p className="dsv2-metric-card__label">{t("البريد الإلكتروني")}</p>
          <p className="dsv2-metric-card__value">{profile.email ? t("مرتبط") : t("غير مسجل")}</p>
          <p className="dsv2-metric-card__meta">{t("يُعرض فقط ولا يُعدل هنا")}</p>
        </article>

        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">{t("الصورة الشخصية")}</p>
          <p className="dsv2-metric-card__value">{profile.photoURL ? t("مضافة") : t("اختيارية")}</p>
          <p className="dsv2-metric-card__meta">{t("رابط صورة الحساب")}</p>
        </article>
      </section>

      <section className="dsv2-card dsv2-card--padded admin-profile-v2-panel">
        <header className="admin-profile-v2-panel__head">
          <div>
            <span className="admin-profile-v2-panel__eyebrow">01</span>
            <h2>{t("بيانات الحساب")}</h2>
            <p>{t("يمكن تعديل الاسم والجوال والصورة فقط. البريد والدور يبقيان للعرض من مصدر الهوية الحالي.")}</p>
          </div>
          <span className={`dsv2-badge ${docExists ? "dsv2-badge--success" : "dsv2-badge--danger"}`}>
            {docExists ? t("جاهز للحفظ") : t("الحفظ متوقف")}
          </span>
        </header>

        <div className="admin-profile-v2-form">
          <DashboardFieldV2 id="admin-profile-name" label={t("الاسم")}>
            <input
              id="admin-profile-name"
              className="dsv2-input"
              value={profile.displayName}
              onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))}
              disabled={!docExists || saving}
              autoComplete="name"
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-profile-phone" label={t("رقم الجوال")}>
            <input
              id="admin-profile-phone"
              className="dsv2-input"
              value={profile.phone}
              onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))}
              disabled={!docExists || saving}
              inputMode="tel"
              autoComplete="tel"
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-profile-email" label={t("البريد الإلكتروني")}>
            <input
              id="admin-profile-email"
              className="dsv2-input"
              value={profile.email}
              disabled
              dir="ltr"
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-profile-role" label={t("الدور")}>
            <input
              id="admin-profile-role"
              className="dsv2-input"
              value={roleLabel}
              disabled
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-profile-photo" label={t("رابط الصورة الشخصية")}>
            <input
              id="admin-profile-photo"
              className="dsv2-input"
              value={profile.photoURL}
              onChange={(event) => setProfile((current) => ({ ...current, photoURL: event.target.value }))}
              disabled={!docExists || saving}
              placeholder="https://..."
              dir="ltr"
            />
          </DashboardFieldV2>
        </div>

        <div className="admin-profile-v2-source">
          <span>{t("مسار ملف الحساب")}</span>
          <code dir="ltr">Core D1 · app_users/{accountId || "—"}</code>
        </div>

        {!docExists ? (
          <div className="admin-profile-v2-note" role="alert">
            {t("لم يتم تفعيل الحفظ لأن حساب المستخدم غير موجود في Core D1.")}
          </div>
        ) : null}
      </section>

      <section className="dsv2-card dsv2-card--padded admin-profile-v2-savebar">
        <div className="admin-profile-v2-savebar__copy">
          <strong>{t("حفظ الملف الشخصي")}</strong>
          <p>{t("يحفظ الاسم والجوال ورابط الصورة ثم يحدّث بيانات الجلسة المحلية المستخدمة في لوحة التحكم.")}</p>
          {msg ? (
            <span className={`admin-profile-v2-message ${messageTone}`} role={messageTone === "is-error" ? "alert" : "status"}>
              {msg}
            </span>
          ) : null}
        </div>

        <button
          className="dsv2-btn dsv2-btn--primary"
          type="button"
          onClick={handleSave}
          disabled={saving || !docExists}
          title={!docExists ? t("حساب Core غير موجود") : t("حفظ الملف الشخصي")}
        >
          {saving ? t("جاري الحفظ...") : t("حفظ التغييرات")}
        </button>
      </section>
    </main>
  );
};

export default DashboardAdminProfile;
