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

import { CoreHrService } from "../../services/CoreHrService";
import { uploadFileToR2 } from "../../services/r2Upload";
import { cleanText, type HrSession } from "./shared";
import { useEmployeePortalLanguage, type EmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";
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
};

function roleLabel(value: unknown, language: EmployeePortalLanguage) {
  const role = cleanText(value).toLowerCase();
  if (role === "owner") return language === "en" ? "Owner" : "المالك";
  if (role === "admin") return language === "en" ? "Management" : "الإدارة";
  if (role === "hr") return language === "en" ? "Human Resources" : "الموارد البشرية";
  if (role === "reception") return language === "en" ? "Reception" : "الاستقبال";
  return language === "en" ? "Employee" : "موظفة";
}

export default function EmployeeProfilePage({ session, onPortalChange }: Props) {
  const { language } = useEmployeePortalLanguage();
  const tr = (ar: string, en: string) => language === "en" ? en : ar;
  const [profile, setProfile] = useState<ProfileState>({
    displayName: "",
    phone: "",
    department: "",
    title: "",
    avatarUrl: "",
    bio: "",
    employeeProfileEnabled: true,
    showOnAbout: true,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const base = session.employeeDoc || session.staffDoc || session.userDoc || {};
    setProfile({
      displayName: cleanText(base.displayName || base.name || session.displayName || ""),
      phone: cleanText(base.phone || base.phoneNormalized || session.userDoc?.phone || ""),
      department: cleanText(base.department || ""),
      title: cleanText(base.title || ""),
      avatarUrl: cleanText(base.avatarUrl || base.photoURL || base.photoUrl || ""),
      bio: cleanText(base.bio || ""),
      employeeProfileEnabled: base.employeeProfileEnabled !== false,
      showOnAbout: base.showOnAbout !== false,
    });
  }, [session.displayName, session.employeeDoc, session.staffDoc, session.userDoc]);

  const employeeLabel = useMemo(
    () => cleanText(profile.displayName || session.displayName || session.email || tr("الموظفة", "Employee")),
    [profile.displayName, session.displayName, session.email, language],
  );
  const role = roleLabel(session.role, language);
  const employeeId = cleanText(session.employeeId || session.uid || "—");

  const completion = useMemo(() => {
    const values = [profile.displayName, profile.phone, profile.department, profile.title, profile.avatarUrl, profile.bio];
    return Math.round((values.filter((value) => cleanText(value)).length / values.length) * 100);
  }, [profile]);

  const saveProfile = async (nextPatch?: Partial<ProfileState>) => {
    if (!session.uid) return;
    const next = { ...profile, ...(nextPatch || {}) };
    if (!cleanText(next.displayName)) {
      setMessage(tr("اسم الموظفة مطلوب.", "Employee name is required."));
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const saved = await CoreHrService.saveMyEmployeeProfile({
        name: next.displayName,
        phone: next.phone,
        avatarUrl: next.avatarUrl || null,
        bio: next.bio || null,
      });
      setProfile((current) => ({
        ...next,
        department: current.department,
        title: current.title,
        employeeProfileEnabled: current.employeeProfileEnabled,
        showOnAbout: current.showOnAbout,
        displayName: cleanText(saved.name || next.displayName),
        phone: cleanText(saved.phoneNormalized || next.phone),
        avatarUrl: cleanText(saved.avatarUrl || next.avatarUrl),
        bio: cleanText(saved.bio || next.bio),
      }));
      await Promise.resolve(onPortalChange?.());
      setMessage(tr("تم حفظ بيانات الملف الشخصي بنجاح.", "Profile saved successfully."));
    } catch (error) {
      setMessage(language === "en" ? "Could not save your profile." : cleanText((error as Error)?.message || "تعذر حفظ الملف الشخصي."));
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
      const saved = await CoreHrService.saveMyEmployeeProfile({
        name: next.displayName,
        phone: next.phone,
        avatarUrl: next.avatarUrl,
        bio: next.bio || null,
      });
      setProfile((current) => ({
        ...next,
        department: current.department,
        title: current.title,
        employeeProfileEnabled: current.employeeProfileEnabled,
        showOnAbout: current.showOnAbout,
        avatarUrl: cleanText(saved.avatarUrl || next.avatarUrl),
      }));
      await Promise.resolve(onPortalChange?.());
      setMessage(tr("تم تحديث الصورة الشخصية.", "Profile photo updated."));
    } catch (error) {
      setMessage(language === "en" ? "Could not upload the photo." : cleanText((error as Error)?.message || "تعذر رفع الصورة."));
    } finally {
      setSaving(false);
    }
  };

  if (!session.user) {
    return (
      <main className="dashboard-v2 employee-profile-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
        <section className="dsv2-card dsv2-card--padded employee-profile-v2-empty">
          <span className="dsv2-badge dsv2-badge--gold">{tr("الملف الشخصي", "Profile")}</span>
          <h2>{tr("تعذر فتح الملف الشخصي", "Could not open profile")}</h2>
          <p>{tr("لم يتم العثور على جلسة موظف مسجلة.", "No employee session found.")}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-v2 employee-profile-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <section className="dsv2-card employee-profile-v2-hero">
        <div className="employee-profile-v2-hero__identity">
          <button
            type="button"
            className="employee-profile-v2-avatar"
            onClick={() => avatarInputRef.current?.click()}
            disabled={saving}
            aria-label={tr("تغيير الصورة الشخصية", "Change profile photo")}
            title={tr("تغيير الصورة الشخصية", "Change profile photo")}
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
            <span className="dsv2-badge dsv2-badge--gold">{tr("الملف الشخصي", "Profile")}</span>
            <h1 className="dsv2-page-title">{employeeLabel}</h1>
            <p className="dsv2-page-subtitle">
              {profile.title || role} · {profile.department || tr("لم يحدد القسم", "No department assigned")}
            </p>
            <div className="employee-profile-v2-hero__badges">
              <span className="dsv2-badge">{role}</span>
              <span className={`dsv2-badge ${profile.employeeProfileEnabled ? "dsv2-badge--success" : ""}`}>
                {profile.employeeProfileEnabled ? tr("الملف مفعّل", "Profile active") : tr("الملف غير مفعّل", "Profile inactive")}
              </span>
            </div>
          </div>
        </div>

        <div className="employee-profile-v2-completion" aria-label={`${tr("اكتمال الملف", "Profile completion")} ${completion}%`}>
          <div className="employee-profile-v2-completion__head">
            <span>{tr("اكتمال الملف", "Profile completion")}</span>
            <strong>{completion}%</strong>
          </div>
          <progress value={completion} max={100} aria-label={tr("نسبة اكتمال الملف الشخصي", "Profile completion percentage")} />
          <small>{tr("أكمل البيانات والصورة والنبذة لرفع جودة الملف.", "Complete your details, photo and bio to improve your profile.")}</small>
        </div>
      </section>

      <section className="employee-profile-v2-metrics" aria-label={tr("ملخص الملف الشخصي", "Profile summary")}>
        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">{tr("البريد", "Email")}</p>
          <p className="dsv2-metric-card__value employee-profile-v2-metric-value--compact">{session.email || "—"}</p>
          <p className="dsv2-metric-card__meta">{tr("حساب تسجيل الدخول", "Sign-in account")}</p>
        </article>
        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">{tr("الرقم الوظيفي", "Employee ID")}</p>
          <p className="dsv2-metric-card__value employee-profile-v2-metric-value--compact">{employeeId}</p>
          <p className="dsv2-metric-card__meta">{tr("المعرّف المرتبط بالملف", "Linked profile ID")}</p>
        </article>
        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">{tr("الدور", "Role")}</p>
          <p className="dsv2-metric-card__value">{role}</p>
          <p className="dsv2-metric-card__meta">{tr("صلاحية الحساب الحالية", "Current account role")}</p>
        </article>
        <article className="dsv2-metric-card">
          <p className="dsv2-metric-card__label">{tr("حالة الملف", "Profile status")}</p>
          <p className="dsv2-metric-card__value">{profile.employeeProfileEnabled ? tr("مفعّل", "Active") : tr("متوقف", "Inactive")}</p>
          <p className="dsv2-metric-card__meta">{tr("استخدام الملف داخل النظام", "Profile availability in the system")}</p>
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
              <span className="employee-profile-v2-panel__eyebrow">{tr("البيانات الوظيفية", "Employment details")}</span>
              <h2>{tr("بيانات الملف", "Profile details")}</h2>
              <p>{tr("حدّث البيانات المسموح لك بتعديلها ثم احفظ التغييرات.", "Update the details you can edit, then save your changes.")}</p>
            </div>
            <span className="dsv2-badge">{completion}% {tr("مكتمل", "complete")}</span>
          </header>

          <div className="employee-profile-v2-form">
            <label className="dsv2-field">
              <span className="dsv2-label"><FontAwesomeIcon icon={faUser} /> {tr("الاسم", "Name")}</span>
              <input
                className="dsv2-input"
                value={profile.displayName}
                onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="dsv2-field">
              <span className="dsv2-label"><FontAwesomeIcon icon={faPhone} /> {tr("الهاتف", "Phone")}</span>
              <input
                className="dsv2-input"
                value={profile.phone}
                onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))}
                disabled={saving}
                inputMode="tel"
              />
            </label>

            <label className="dsv2-field">
              <span className="dsv2-label"><FontAwesomeIcon icon={faBuilding} /> {tr("القسم", "Department")}</span>
              <input
                className="dsv2-input"
                value={profile.department}
                disabled
                readOnly
              />
              <small className="employee-profile-v2-field__hint">{tr("القسم يُدار من الإدارة داخل ملف الموظفة في Core.", "Management updates the department in your employee record.")}</small>
            </label>

            <label className="dsv2-field">
              <span className="dsv2-label"><FontAwesomeIcon icon={faBriefcase} /> {tr("المسمى الوظيفي", "Job title")}</span>
              <input
                className="dsv2-input"
                value={profile.title}
                disabled
                readOnly
              />
              <small className="employee-profile-v2-field__hint">{tr("المسمى الوظيفي يُدار من الإدارة ولا يمكن تغييره من الحساب الشخصي.", "Management updates your job title; it cannot be changed here.")}</small>
            </label>

            <label className="dsv2-field employee-profile-v2-field--wide">
              <span className="dsv2-label"><FontAwesomeIcon icon={faCamera} /> {tr("رابط الصورة", "Photo URL")}</span>
              <input
                className="dsv2-input"
                value={profile.avatarUrl}
                onChange={(event) => setProfile((current) => ({ ...current, avatarUrl: event.target.value }))}
                placeholder={tr("ارفع صورة أو ألصق رابطًا مباشرًا", "Upload a photo or paste a direct URL")}
                disabled={saving}
              />
              <small className="employee-profile-v2-field__hint">{tr("يمكنك أيضًا الضغط على الصورة أعلى الصفحة لرفع صورة مباشرة إلى R2.", "You can also tap your photo above to upload a new one.")}</small>
            </label>

            <label className="dsv2-field employee-profile-v2-field--wide">
              <span className="dsv2-label">{tr("نبذة مختصرة", "Short bio")}</span>
              <textarea
                className="dsv2-input employee-profile-v2-textarea"
                rows={5}
                value={profile.bio}
                onChange={(event) => setProfile((current) => ({ ...current, bio: event.target.value }))}
                placeholder={tr("اكتب نبذة مهنية مختصرة...", "Write a short professional bio...")}
                disabled={saving}
              />
            </label>
          </div>
        </section>

        <aside className="dsv2-card dsv2-card--padded employee-profile-v2-panel employee-profile-v2-panel--visibility">
          <header className="employee-profile-v2-panel__head">
            <div>
              <span className="employee-profile-v2-panel__eyebrow">{tr("الظهور", "Visibility")}</span>
              <h2>{tr("إعدادات الملف", "Profile settings")}</h2>
              <p>{tr("هذه الإعدادات تشغيلية وتُدار من الإدارة لحماية صلاحيات الملف والظهور العام.", "Management controls these settings to manage access and public visibility.")}</p>
            </div>
            <FontAwesomeIcon className="employee-profile-v2-panel__icon" icon={faShieldHalved} />
          </header>

          <div className="employee-profile-v2-switches">
            <label className="employee-profile-v2-switch">
              <span className="employee-profile-v2-switch__copy">
                <strong>{tr("تفعيل الملف الشخصي", "Enable profile")}</strong>
                <small>{tr("السماح باستخدام ملف الموظفة داخل النظام.", "Allow this employee profile to be used in the system.")}</small>
              </span>
              <input
                type="checkbox"
                checked={profile.employeeProfileEnabled}
                disabled
              />
              <span className="employee-profile-v2-switch__control" aria-hidden="true" />
            </label>

            <label className="employee-profile-v2-switch">
              <span className="employee-profile-v2-switch__copy">
                <strong>{tr("الظهور في صفحة من نحن", "Show on About page")}</strong>
                <small>{tr("عرض بياناتك ضمن فريق العمل.", "Display your details as part of the team.")}</small>
              </span>
              <input
                type="checkbox"
                checked={profile.showOnAbout}
                disabled
              />
              <span className="employee-profile-v2-switch__control" aria-hidden="true" />
            </label>


          </div>

          <div className="employee-profile-v2-visibility-note">
            <FontAwesomeIcon icon={faCircleCheck} />
            <span>{tr("تعديل التفعيل أو الظهور يتم من لوحة الإدارة فقط.", "Only management can change activation or visibility.")}</span>
          </div>
        </aside>
      </div>

      <footer className="dsv2-card dsv2-card--padded employee-profile-v2-savebar">
        <div className="employee-profile-v2-savebar__copy">
          <strong>{tr("حفظ الملف الشخصي", "Save profile")}</strong>
          <p>{tr("سيتم حفظ الاسم والهاتف والصورة والنبذة في Malikat Core. البيانات الوظيفية وإعدادات الظهور تبقى للإدارة.", "Your name, phone, photo and bio will be saved. Management controls employment details and visibility settings.")}</p>
        </div>
        <button
          type="button"
          className="dsv2-btn dsv2-btn--primary"
          onClick={() => void saveProfile()}
          disabled={saving}
        >
          <FontAwesomeIcon icon={faFloppyDisk} />
          {saving ? tr("جاري الحفظ...", "Saving...") : tr("حفظ التغييرات", "Save changes")}
        </button>
      </footer>
    </main>
  );
}
