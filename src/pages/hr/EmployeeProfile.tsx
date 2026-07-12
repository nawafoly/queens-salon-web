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
      <div className="employee-workspace employee-workspace--empty">
        <h2>الملف الشخصي</h2>
        <p>لم يتم العثور على جلسة موظف مسجلة.</p>
      </div>
    );
  }

  return (
    <div className="employee-workspace employee-profile-workspace" dir="rtl">
      <section className="employee-workspace-hero employee-workspace-hero--profile">
        <div className="employee-profile-identity">
          <button type="button" className="employee-profile-avatar" onClick={() => avatarInputRef.current?.click()} disabled={saving} aria-label="تغيير الصورة">
            <EmployeeAvatar src={profile.avatarUrl} name={employeeLabel} alt={employeeLabel} loading="eager" />
            <em><FontAwesomeIcon icon={faCamera} /></em>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={(event) => void handleAvatarPick(event.target.files?.[0])} />
          <div>
            <span className="employee-workspace-kicker">الملف الشخصي</span>
            <h1>{employeeLabel}</h1>
            <p>{profile.title || role} · {profile.department || "لم يحدد القسم"}</p>
          </div>
        </div>
        <div className="employee-profile-completion">
          <span>اكتمال الملف</span>
          <strong>{completion}%</strong>
          <div><i style={{ width: `${completion}%` }} /></div>
        </div>
      </section>

      {message ? <div className="employee-workspace-alert">{message}</div> : null}

      <section className="employee-profile-summary">
        <article><span><FontAwesomeIcon icon={faEnvelope} /></span><div><small>البريد</small><strong>{session.email || "—"}</strong></div></article>
        <article><span><FontAwesomeIcon icon={faIdBadge} /></span><div><small>الرقم الوظيفي</small><strong>{employeeId}</strong></div></article>
        <article><span><FontAwesomeIcon icon={faShieldHalved} /></span><div><small>الدور</small><strong>{role}</strong></div></article>
        <article><span><FontAwesomeIcon icon={faCircleCheck} /></span><div><small>حالة الملف</small><strong>{profile.employeeProfileEnabled ? "مفعّل" : "غير مفعّل"}</strong></div></article>
      </section>

      <div className="employee-profile-layout">
        <section className="employee-workspace-panel employee-profile-form-panel">
          <div className="employee-workspace-panel__head">
            <div>
              <span className="employee-workspace-kicker">البيانات</span>
              <h2>بياناتك الوظيفية</h2>
              <p>حدّث البيانات المسموح لك بتعديلها ثم احفظ التغييرات.</p>
            </div>
          </div>

          <div className="employee-modern-form">
            <label>
              <span><FontAwesomeIcon icon={faUser} /> الاسم</span>
              <input value={profile.displayName} onChange={(event) => setProfile((current) => ({ ...current, displayName: event.target.value }))} />
            </label>
            <label>
              <span><FontAwesomeIcon icon={faPhone} /> الهاتف</span>
              <input value={profile.phone} onChange={(event) => setProfile((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <label>
              <span><FontAwesomeIcon icon={faBuilding} /> القسم</span>
              <input value={profile.department} onChange={(event) => setProfile((current) => ({ ...current, department: event.target.value }))} />
            </label>
            <label>
              <span><FontAwesomeIcon icon={faBriefcase} /> المسمى الوظيفي</span>
              <input value={profile.title} onChange={(event) => setProfile((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label className="is-wide">
              <span><FontAwesomeIcon icon={faCamera} /> رابط الصورة</span>
              <input value={profile.avatarUrl} onChange={(event) => setProfile((current) => ({ ...current, avatarUrl: event.target.value }))} placeholder="ارفع صورة أو ألصق رابطًا مباشرًا" />
            </label>
            <label className="is-wide">
              <span>نبذة مختصرة</span>
              <textarea rows={5} value={profile.bio} onChange={(event) => setProfile((current) => ({ ...current, bio: event.target.value }))} placeholder="اكتب نبذة مهنية مختصرة..." />
            </label>
          </div>

          <div className="employee-form-savebar">
            <span>تأكد من صحة البيانات قبل الحفظ.</span>
            <button type="button" className="employee-primary-action" onClick={() => void saveProfile()} disabled={saving}>
              <FontAwesomeIcon icon={faFloppyDisk} />
              {saving ? "جاري الحفظ..." : "حفظ التغييرات"}
            </button>
          </div>
        </section>

        <aside className="employee-workspace-panel employee-profile-settings-panel">
          <div className="employee-workspace-panel__head">
            <div>
              <span className="employee-workspace-kicker">الظهور</span>
              <h2>إعدادات الملف</h2>
              <p>تحكم في ظهور حسابك داخل النظام والموقع.</p>
            </div>
          </div>

          <div className="employee-profile-switches">
            <label>
              <span><strong>تفعيل الملف الشخصي</strong><small>السماح باستخدام ملف الموظفة داخل النظام.</small></span>
              <input type="checkbox" checked={profile.employeeProfileEnabled} onChange={(event) => setProfile((current) => ({ ...current, employeeProfileEnabled: event.target.checked }))} />
              <i />
            </label>
            <label>
              <span><strong>الظهور في صفحة من نحن</strong><small>عرض بياناتك ضمن فريق العمل.</small></span>
              <input type="checkbox" checked={profile.showOnAbout} onChange={(event) => setProfile((current) => ({ ...current, showOnAbout: event.target.checked }))} />
              <i />
            </label>
            <label>
              <span><strong>الظهور في صفحة الحجز</strong><small>السماح للعميلات باختيارك أثناء الحجز.</small></span>
              <input type="checkbox" checked={profile.showOnBooking} onChange={(event) => setProfile((current) => ({ ...current, showOnBooking: event.target.checked }))} />
              <i />
            </label>
          </div>
        </aside>
      </div>
    </div>
  );
}

