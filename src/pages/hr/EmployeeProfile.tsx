import { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import EmployeeAvatar from "../../components/EmployeeAvatar";
import {
  faBriefcase,
  faBuilding,
  faCamera,
  faCircleCheck,
  faEnvelope,
  faFloppyDisk,
  faIdBadge,
  faPhone,
  faShieldHalved,
  faUser,
} from "@fortawesome/free-solid-svg-icons";

import { syncEmployeeRecordFromUser } from "../../services/employeeHub";
import { uploadFileToR2 } from "../../services/r2Upload";
import { cleanText, type HrSession } from "./shared";
import "../../styles/dashboard-v2/dashboard-v2.css";

type Props = {
  session: HrSession;
  onPortalChange?: () => void | Promise<void>;
};

type ProfileState = {
  displayName: string;
  phone: string;
  department: string;
  title: string;
  avatarUrl: string;
  bio: string;
  employeeProfileEnabled: boolean;
  showOnAbout: boolean;
  showOnBooking: boolean;
};

function roleLabel(value: unknown) {
  const role = cleanText(value).toLowerCase();
  if (role === "owner") return "المالك";
  if (role === "admin") return "الإدارة";
  if (role === "hr") return "الموارد البشرية";
  if (role === "reception") return "الاستقبال";
  return "موظفة";
}

export default function EmployeeProfilePage({ session, onPortalChange }: Props) {
  const [profile, setProfile] = useState<ProfileState>({
    displayName: "",
    phone: "",
    department: "",
    title: "",
    avatarUrl: "",
    bio: "",
    employeeProfileEnabled: true,
    showOnAbout: true,
    showOnBooking: true,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const base = session.employeeDoc || session.staffDoc || session.userDoc || {};
    setProfile({
      displayName: cleanText(base.displayName || base.name || session.displayName || ""),
      phone: cleanText(base.phone || session.userDoc?.phone || ""),
      department: cleanText(base.department || ""),
      title: cleanText(base.title || ""),
      avatarUrl: cleanText(base.avatarUrl || base.photoURL || base.photoUrl || ""),
      bio: cleanText(base.bio || ""),
      employeeProfileEnabled: base.employeeProfileEnabled !== false,
      showOnAbout: base.showOnAbout !== false,
      showOnBooking: base.showOnBooking !== false,
    });
  }, [session.displayName, session.employeeDoc, session.staffDoc, session.userDoc]);

  const employeeLabel = useMemo(
    () => cleanText(profile.displayName || session.displayName || session.email || "الموظفة"),
    [profile.displayName, session.displayName, session.email],
  );
  const role = roleLabel(session.role);
  const employeeId = cleanText(session.employeeId || session.uid || "—");

  const completion = useMemo(() => {
    const values = [profile.displayName, profile.phone, profile.department, profile.title, profile.avatarUrl, profile.bio];
    return Math.round((values.filter((value) => cleanText(value)).length / values.length) * 100);
  }, [profile]);

  const saveProfile = async (nextPatch?: Partial<ProfileState>) => {
    if (!session.uid) return;
    const next = { ...profile, ...(nextPatch || {}) };
    if (!cleanText(next.displayName)) {
      setMessage("اسم الموظفة مطلوب.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await syncEmployeeRecordFromUser({
        uid: session.uid,
        email: session.email,
        displayName: next.displayName,
        phone: next.phone,
        role: session.role as any,
        active: true,
        employeeId: session.employeeId || session.uid,
        linkedEmployeeDocId: session.employeeId || session.uid,
        employeeProfileEnabled: next.employeeProfileEnabled,
        showOnAbout: next.showOnAbout,
        showOnBooking: next.showOnBooking,
        department: next.department,
        title: next.title,
        avatarUrl: next.avatarUrl,
        bio: next.bio,
      });
      setProfile(next);
      await Promise.resolve(onPortalChange?.());
      setMessage("تم حفظ بيانات الملف الشخصي بنجاح.");
    } catch (error) {
      setMessage(cleanText((error as any)?.message || "تعذر حفظ الملف الشخصي."));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarPick = async (file: File | null | undefined) => {
    if (!file || !session.uid) return;
    setSaving(true);
    setMessage("");
    try {
      const uploaded = await uploadFileToR2({
        file,
        keyPrefix: "employee-assets/avatars",
        ownerId: session.employeeId || session.uid,
      });
      const next = { ...profile, avatarUrl: uploaded.storageUrl };
      await syncEmployeeRecordFromUser({
        uid: session.uid,
        email: session.email,
        displayName: next.displayName,
        phone: next.phone,
        role: session.role as any,
        active: true,
        employeeId: session.employeeId || session.uid,
        linkedEmployeeDocId: session.employeeId || session.uid,
        employeeProfileEnabled: next.employeeProfileEnabled,
        showOnAbout: next.showOnAbout,
        showOnBooking: next.showOnBooking,
        department: next.department,
        title: next.title,
        avatarUrl: next.avatarUrl,
        bio: next.bio,
      });
      setProfile(next);
      await Promise.resolve(onPortalChange?.());
      setMessage("تم تحديث الصورة الشخصية.");
    } catch (error) {
      setMessage(cleanText((error as any)?.message || "تعذر رفع الصورة."));
    } finally {
      setSaving(false);
    }
  };

  if (!session.user) {
    return (
      <main className="dashboard-v2 employee-profile-v2-page" dir="rtl">
        <section className="dsv2-card dsv2-card--padded employee-profile-v2-empty">
          <span className="dsv2-badge dsv2-badge--gold">الملف الشخصي</span>
          <h2>تعذر فتح الملف الشخصي</h2>
          <p>لم يتم العثور على جلسة موظف مسجلة.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-v2 employee-profile-v2-page" dir="rtl">
      <section className="dsv2-card employee-profile-v2-hero">
        <div className="employee-profile-v2-hero__identity">
          <button
            type="button"
            className="employee-profile-v2-avatar"
            onClick={() => avatarInputRef.current?.click()}
            disabled={saving}
            aria-label="تغيير الصورة الشخصية"
            title="تغيير الصورة الشخصية"
          >
            <EmployeeAvatar
              src={profile.avatarUrl}
              name={employeeLabel}
              alt={employeeLabel}
              loading="eager"
            />
            <span className="employee-profile-v2-avatar__action" aria-hidden="true">
              <FontAwesomeIcon icon={faCamera} />
            </span>
          </button>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => void handleAvatarPick(event.target.files?.[0])}
          />

          <div className="employee-profile-v2-hero__copy">
            <span className="dsv2-badge dsv2-badge--gold">الملف الشخصي</span>
            <h1 className="dsv2-page-title">{employeeLabel}</h1>
            <p className="dsv2-page-subtitle">
              {profile.title || role} · {profile.department || "لم يحدد القسم"}
            </p>
            <div className="employee-profile-v2-hero__badges">
              <span className="dsv2-badge">{role}</span>
              <span className={`dsv2-badge ${profile.employeeProfileEnabled ? "dsv2-badge--success" : ""}`}>
                {profile.employeeProfileEnabled ? "الملف مفعّل" : "الملف غير مفعّل"}
              </span>
            </div>
          </div>
        </div>

        <div className="employee-profile-v2-completion" aria-label={`اكتمال الملف ${completion}%`}>
          <div className="employee-profile-v2-completion__head">
            <span>اكتمال الملف</span>
            <strong>{completion}%</strong>
          </div>
          <progress value={completion} max={100} aria-label="نسبة اكتمال الملف الشخصي" />
          <small>أكمل البيانات والصورة والنبذة لرفع جودة الملف.</small>
        </div>
      </section>

      <section className="employee-profile-v2-metrics" aria-label="ملخص الملف الشخصي">
        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">البريد</p>
          <p className="dsv2-metric-card__value employee-profile-v2-metric-value--compact">{session.email || "—"}</p>
          <p className="dsv2-metric-card__meta">حساب تسجيل الدخول</p>
        </article>
        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">الرقم الوظيفي</p>
          <p className="dsv2-metric-card__value employee-profile-v2-metric-value--compact">{employeeId}</p>
          <p className="dsv2-metric-card__meta">المعرّف المرتبط بالملف</p>
        </article>
        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">الدور</p>
          <p className="dsv2-metric-card__value">{role}</p>
          <p className="dsv2-metric-card__meta">صلاحية الحساب الحالية</p>
        </article>
        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">حالة الملف</p>
          <p className="dsv2-metric-card__value">{profile.employeeProfileEnabled ? "مفعّل" : "متوقف"}</p>
          <p className="dsv2-metric-card__meta">استخدام الملف داخل النظام</p>
        </article>
      </section>

      {message ? (
        <div className="employee-profile-v2-message" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}

      <div className="employee-profile-v2-layout">
        <section className="dsv2-card dsv2-card--padded employee-profile-v2-panel employee-profile-v2-panel--form">
          <header className="employee-profile-v2-panel__head">
            <div>
              <span className="employee-profile-v2-panel__eyebrow">البيانات الوظيفية</span>
              <h2>بيانات الملف</h2>
              <p>حدّث البيانات المسموح لك بتعديلها ثم احفظ التغييرات.</p>
            </div>
            <span className="dsv2-badge">{completion}% مكتمل</span>
          </header>

          <div className="employee-profile-v2-form">
            <label className="dsv2-field">
              <span className="dsv2-label"><FontAwesomeIcon icon={faUser} /> الاسم</span>
              <input
                className="dsv2-input"
                value={profile.displayName}
                onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="dsv2-field">
              <span className="dsv2-label"><FontAwesomeIcon icon={faPhone} /> الهاتف</span>
              <input
                className="dsv2-input"
                value={profile.phone}
                onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))}
                disabled={saving}
                inputMode="tel"
              />
            </label>

            <label className="dsv2-field">
              <span className="dsv2-label"><FontAwesomeIcon icon={faBuilding} /> القسم</span>
              <input
                className="dsv2-input"
                value={profile.department}
                onChange={(event) => setProfile((current) => ({ ...current, department: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="dsv2-field">
              <span className="dsv2-label"><FontAwesomeIcon icon={faBriefcase} /> المسمى الوظيفي</span>
              <input
                className="dsv2-input"
                value={profile.title}
                onChange={(event) => setProfile((current) => ({ ...current, title: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="dsv2-field employee-profile-v2-field--wide">
              <span className="dsv2-label"><FontAwesomeIcon icon={faCamera} /> رابط الصورة</span>
              <input
                className="dsv2-input"
                value={profile.avatarUrl}
                onChange={(event) => setProfile((current) => ({ ...current, avatarUrl: event.target.value }))}
                placeholder="ارفع صورة أو ألصق رابطًا مباشرًا"
                disabled={saving}
              />
              <small className="employee-profile-v2-field__hint">يمكنك أيضًا الضغط على الصورة أعلى الصفحة لرفع صورة مباشرة إلى R2.</small>
            </label>

            <label className="dsv2-field employee-profile-v2-field--wide">
              <span className="dsv2-label">نبذة مختصرة</span>
              <textarea
                className="dsv2-input employee-profile-v2-textarea"
                rows={5}
                value={profile.bio}
                onChange={(event) => setProfile((current) => ({ ...current, bio: event.target.value }))}
                placeholder="اكتب نبذة مهنية مختصرة..."
                disabled={saving}
              />
            </label>
          </div>
        </section>

        <aside className="dsv2-card dsv2-card--padded employee-profile-v2-panel employee-profile-v2-panel--visibility">
          <header className="employee-profile-v2-panel__head">
            <div>
              <span className="employee-profile-v2-panel__eyebrow">الظهور</span>
              <h2>إعدادات الملف</h2>
              <p>تحكم في ظهور حسابك داخل النظام والموقع.</p>
            </div>
            <FontAwesomeIcon className="employee-profile-v2-panel__icon" icon={faShieldHalved} />
          </header>

          <div className="employee-profile-v2-switches">
            <label className="employee-profile-v2-switch">
              <span className="employee-profile-v2-switch__copy">
                <strong>تفعيل الملف الشخصي</strong>
                <small>السماح باستخدام ملف الموظفة داخل النظام.</small>
              </span>
              <input
                type="checkbox"
                checked={profile.employeeProfileEnabled}
                onChange={(event) => setProfile((current) => ({ ...current, employeeProfileEnabled: event.target.checked }))}
                disabled={saving}
              />
              <span className="employee-profile-v2-switch__control" aria-hidden="true" />
            </label>

            <label className="employee-profile-v2-switch">
              <span className="employee-profile-v2-switch__copy">
                <strong>الظهور في صفحة من نحن</strong>
                <small>عرض بياناتك ضمن فريق العمل.</small>
              </span>
              <input
                type="checkbox"
                checked={profile.showOnAbout}
                onChange={(event) => setProfile((current) => ({ ...current, showOnAbout: event.target.checked }))}
                disabled={saving}
              />
              <span className="employee-profile-v2-switch__control" aria-hidden="true" />
            </label>

            <label className="employee-profile-v2-switch">
              <span className="employee-profile-v2-switch__copy">
                <strong>الظهور في صفحة الحجز</strong>
                <small>السماح للعميلات باختيارك أثناء الحجز.</small>
              </span>
              <input
                type="checkbox"
                checked={profile.showOnBooking}
                onChange={(event) => setProfile((current) => ({ ...current, showOnBooking: event.target.checked }))}
                disabled={saving}
              />
              <span className="employee-profile-v2-switch__control" aria-hidden="true" />
            </label>
          </div>

          <div className="employee-profile-v2-visibility-note">
            <FontAwesomeIcon icon={faCircleCheck} />
            <span>تغييرات الظهور لا تُطبق حتى تضغط حفظ التغييرات.</span>
          </div>
        </aside>
      </div>

      <footer className="dsv2-card dsv2-card--padded employee-profile-v2-savebar">
        <div className="employee-profile-v2-savebar__copy">
          <strong>حفظ الملف الشخصي</strong>
          <p>راجع البيانات وإعدادات الظهور قبل تثبيت التغييرات.</p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary"
          onClick={() => void saveProfile()}
          disabled={saving}
        >
          <FontAwesomeIcon icon={faFloppyDisk} />
          {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
        </button>
      </footer>
    </main>
  );
}
