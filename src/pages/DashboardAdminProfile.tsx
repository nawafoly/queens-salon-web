import React, { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";

import {
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSkeletonV2,
} from "../components/dashboard-v2";
import { auth, db } from "../services/firebase";
import { readStoredAuthSession } from "../services/localAuthSession";
import "../styles/dashboard-v2/dashboard-v2.css";

type UiRole = "owner" | "admin" | "hr" | "reception" | "staff" | "pending" | "client" | "guest";

type AdminProfileDoc = {
  displayName: string;
  phone: string;
  email: string;
  photoURL: string;
  role: UiRole;
};

const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;

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

const DashboardAdminProfile: React.FC = () => {
  const bootstrapSession = useMemo(() => {
    try {
      return readStoredAuthSession();
    } catch {
      return null;
    }
  }, []);

  const [authLoading, setAuthLoading] = useState(() => !bootstrapSession);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [uid, setUid] = useState(() => bootstrapSession?.uid || "");
  const [docExists, setDocExists] = useState(() => Boolean(bootstrapSession?.uid));

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
        const localSession = readStoredAuthSession();

        if (!user) {
          if (!alive || requestId !== authRequestRef.current) return;

          if (localSession?.uid && localSession?.role) {
            setUid(localSession.uid);
            setDocExists(true);
            setProfile({
              displayName: localSession.displayName || "",
              phone: localSession.phone || "",
              email: localSession.email || "",
              photoURL: "",
              role: localSession.role as UiRole,
            });
          } else {
            setUid("");
            setDocExists(false);
            setProfile({
              displayName: "",
              phone: "",
              email: "",
              photoURL: "",
              role: "guest",
            });
          }

          return;
        }

        if (!alive || requestId !== authRequestRef.current) return;
        setUid(user.uid);

        const ref = doc(db, ...USERS_COLLECTION, user.uid);
        const snap = await getDoc(ref);

        if (!alive || requestId !== authRequestRef.current) return;

        if (!snap.exists()) {
          setDocExists(false);
          setProfile({
            displayName: localSession?.displayName || user.displayName || "",
            phone: localSession?.phone || "",
            email: localSession?.email || user.email || "",
            photoURL: user.photoURL || "",
            role: normalizeRole(localSession?.role || "guest"),
          });
          setMsg("لم يتم العثور على ملف المستخدم الإداري في المسار المعتمد.");
          return;
        }

        const data = snap.data() as any;
        const role = normalizeRole(data?.role || localSession?.role);

        setDocExists(true);
        setProfile({
          displayName: String(data?.displayName || data?.name || localSession?.displayName || user.displayName || ""),
          phone: String(data?.phone || localSession?.phone || ""),
          email: String(data?.email || localSession?.email || user.email || ""),
          photoURL: String(data?.photoURL || user.photoURL || ""),
          role,
        });
      } catch (e) {
        if (!alive || requestId !== authRequestRef.current) return;

        console.error("Admin profile load error:", e);
        const localSession = readStoredAuthSession();
        setDocExists(Boolean(localSession?.uid || user?.uid));
        setProfile({
          displayName: localSession?.displayName || user?.displayName || "",
          phone: localSession?.phone || "",
          email: localSession?.email || user?.email || "",
          photoURL: user?.photoURL || "",
          role: normalizeRole(localSession?.role || "guest"),
        });
        setMsg("تعذر تحميل الملف الشخصي.");
      } finally {
        if (alive && requestId === authRequestRef.current) {
          setAuthLoading(false);
        }
      }
    });

    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const handleSave = async () => {
    if (!uid || !docExists || !hasAdminPower) return;

    const displayName = String(profile.displayName || "").trim();
    const phone = String(profile.phone || "").trim();
    const photoURL = String(profile.photoURL || "").trim();

    if (!displayName) {
      setMsg("الاسم مطلوب.");
      return;
    }

    try {
      setSaving(true);
      setMsg("");

      const ref = doc(db, ...USERS_COLLECTION, uid);
      await updateDoc(ref, {
        displayName,
        name: displayName,
        phone,
        photoURL,
        updatedAt: serverTimestamp(),
      });

      try {
        const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "null") || {};
        const merged = { ...cached, uid, name: displayName, displayName, phone, email: profile.email, photoURL };
        localStorage.setItem("user_profile_v1", JSON.stringify(merged));
        localStorage.setItem("userName", displayName);
        localStorage.setItem("userPhone", phone);

        const authUserCached = JSON.parse(localStorage.getItem("auth_user") || "null") || {};
        localStorage.setItem(
          "auth_user",
          JSON.stringify({
            ...authUserCached,
            uid,
            email: profile.email,
            role: profile.role,
            displayName,
          })
        );
        window.dispatchEvent(new Event("authChanged"));
      } catch {
      }

      setMsg("تم حفظ الملف الشخصي بنجاح.");
    } catch (e) {
      console.error("Admin profile save error:", e);
      setMsg("تعذر حفظ الملف الشخصي.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <main className="dsv2-page admin-profile-v2-page" dir="rtl">
        <section className="dsv2-card dsv2-card--padded admin-profile-v2-loading" aria-label="جاري تحميل الملف الشخصي">
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
      <main className="dsv2-page admin-profile-v2-page" dir="rtl">
        <DashboardEmptyStateV2
          tone="gold"
          title="غير مصرح"
          description="هذه الصفحة مخصصة لحسابات Owner / Admin فقط."
        />
      </main>
    );
  }

  const roleLabel = ROLE_LABELS[profile.role] || profile.role;
  const initials = profileInitials(profile.displayName, profile.email);
  const messageTone = msg.startsWith("تم ") ? "is-success" : "is-error";

  return (
    <main className="dsv2-page admin-profile-v2-page" dir="rtl">
      <section className="dsv2-card admin-profile-v2-hero">
        <div className="admin-profile-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">الملف الشخصي الإداري</span>
          <h1 className="dsv2-page-title">الملف الشخصي</h1>
          <p className="dsv2-page-subtitle">
            تحديث بيانات حساب الإدارة التي تظهر داخل لوحة التحكم مع إبقاء الهوية والدور محميين.
          </p>
          <div className="admin-profile-v2-hero__badges">
            <span className="dsv2-badge dsv2-badge--success">{roleLabel}</span>
            <span className={`dsv2-badge ${docExists ? "dsv2-badge--success" : "dsv2-badge--danger"}`}>
              {docExists ? "الملف مرتبط" : "المستند غير موجود"}
            </span>
          </div>
        </div>

        <div className="admin-profile-v2-identity" aria-label="هوية الحساب">
          <div className="admin-profile-v2-avatar" aria-hidden={!profile.photoURL}>
            {profile.photoURL ? (
              <img src={profile.photoURL} alt={profile.displayName || "صورة الحساب"} />
            ) : (
              <span>{initials}</span>
            )}
          </div>
          <div>
            <strong>{profile.displayName || "حساب الإدارة"}</strong>
            <span>{profile.email || "لا يوجد بريد مسجل"}</span>
          </div>
        </div>
      </section>

      <section className="admin-profile-v2-metrics" aria-label="ملخص الملف الشخصي">
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <p className="dsv2-metric-card__label">الدور</p>
          <p className="dsv2-metric-card__value">{roleLabel}</p>
          <p className="dsv2-metric-card__meta">صلاحية الحساب الحالية</p>
        </article>

        <article className={`dsv2-metric-card ${docExists ? "dsv2-metric-card--success" : "dsv2-metric-card--danger"}`}>
          <p className="dsv2-metric-card__label">مستند الحساب</p>
          <p className="dsv2-metric-card__value">{docExists ? "موجود" : "مفقود"}</p>
          <p className="dsv2-metric-card__meta">salons/{SALON_ID}/users</p>
        </article>

        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <p className="dsv2-metric-card__label">البريد الإلكتروني</p>
          <p className="dsv2-metric-card__value">{profile.email ? "مرتبط" : "غير مسجل"}</p>
          <p className="dsv2-metric-card__meta">يُعرض فقط ولا يُعدل هنا</p>
        </article>

        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">الصورة الشخصية</p>
          <p className="dsv2-metric-card__value">{profile.photoURL ? "مضافة" : "اختيارية"}</p>
          <p className="dsv2-metric-card__meta">رابط صورة الحساب</p>
        </article>
      </section>

      <section className="dsv2-card dsv2-card--padded admin-profile-v2-panel">
        <header className="admin-profile-v2-panel__head">
          <div>
            <span className="admin-profile-v2-panel__eyebrow">01</span>
            <h2>بيانات الحساب</h2>
            <p>يمكن تعديل الاسم والجوال والصورة فقط. البريد والدور يبقيان للعرض من مصدر الهوية الحالي.</p>
          </div>
          <span className={`dsv2-badge ${docExists ? "dsv2-badge--success" : "dsv2-badge--danger"}`}>
            {docExists ? "جاهز للحفظ" : "الحفظ متوقف"}
          </span>
        </header>

        <div className="admin-profile-v2-form">
          <DashboardFieldV2 id="admin-profile-name" label="الاسم">
            <input
              id="admin-profile-name"
              className="dsv2-input"
              value={profile.displayName}
              onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))}
              disabled={!docExists || saving}
              autoComplete="name"
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-profile-phone" label="رقم الجوال">
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

          <DashboardFieldV2 id="admin-profile-email" label="البريد الإلكتروني">
            <input
              id="admin-profile-email"
              className="dsv2-input"
              value={profile.email}
              disabled
              dir="ltr"
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-profile-role" label="الدور">
            <input
              id="admin-profile-role"
              className="dsv2-input"
              value={roleLabel}
              disabled
            />
          </DashboardFieldV2>

          <DashboardFieldV2 id="admin-profile-photo" label="رابط الصورة الشخصية">
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
          <span>مسار ملف الحساب</span>
          <code dir="ltr">salons/{SALON_ID}/users/{uid || "—"}</code>
        </div>

        {!docExists ? (
          <div className="admin-profile-v2-note" role="alert">
            لم يتم تفعيل الحفظ لأن مستند المستخدم غير موجود. هذه الصفحة تستخدم updateDoc فقط ولا تنشئ مستندًا جديدًا.
          </div>
        ) : null}
      </section>

      <section className="dsv2-card dsv2-card--padded admin-profile-v2-savebar">
        <div className="admin-profile-v2-savebar__copy">
          <strong>حفظ الملف الشخصي</strong>
          <p>يحفظ الاسم والجوال ورابط الصورة ثم يحدّث بيانات الجلسة المحلية المستخدمة في لوحة التحكم.</p>
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
          title={!docExists ? "المستند غير موجود" : "حفظ الملف الشخصي"}
        >
          {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
        </button>
      </section>
    </main>
  );
};

export default DashboardAdminProfile;
