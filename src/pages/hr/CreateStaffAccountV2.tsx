import { useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  updateProfile,
  type Auth,
} from "firebase/auth";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsRotate,
  faLink,
  faShieldHalved,
  faUserPlus,
} from "@fortawesome/free-solid-svg-icons";

import {
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSelectV2,
} from "../../components/dashboard-v2";
import { auth } from "../../services/firebase";
import {
  createEmployeeNotification,
  syncEmployeeRecordFromUser,
  type EmployeeRole,
} from "../../services/employeeHub";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
};

type CreateRole = "staff" | "reception" | "admin" | "hr";

const CREATE_ROLE_OPTIONS: Array<{ value: CreateRole; label: string }> = [
  { value: "staff", label: "موظفة" },
  { value: "hr", label: "الموارد البشرية" },
  { value: "reception", label: "الاستقبال" },
  { value: "admin", label: "مدير" },
];

const PROMOTE_ROLE_OPTIONS: Array<{ value: EmployeeRole; label: string }> = [
  { value: "staff", label: "موظفة" },
  { value: "hr", label: "الموارد البشرية" },
  { value: "reception", label: "الاستقبال" },
  { value: "admin", label: "مدير" },
  { value: "owner", label: "المالك" },
];

function makeTempPassword() {
  return `Hr${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 6)}!`;
}

function getSecondaryAuth() {
  const options = (auth as any)?.app?.options;
  if (!options) throw new Error("تعذر تجهيز Firebase Auth لإنشاء الحساب.");

  const name = "hr-secondary-auth-app";
  const app = getApps().find((item) => item.name === name) || initializeApp(options, name);
  return getAuth(app);
}

function hasArabicText(value: string) {
  return /[\u0600-\u06FF]/.test(value);
}

function getRoleLabel(role: unknown) {
  const value = cleanText(role).toLowerCase();
  if (value === "owner") return "المالك";
  if (value === "admin") return "مدير";
  if (value === "hr") return "الموارد البشرية";
  if (value === "reception") return "الاستقبال";
  if (value === "staff") return "موظفة";
  return cleanText(role) || "غير محدد";
}

function getFriendlyAuthError(error: unknown, fallback: string) {
  const code = cleanText((error as any)?.code).toLowerCase();
  const raw = cleanText((error as any)?.message)
    .replace(/^FirebaseError:\s*/i, "")
    .replace(/^FunctionsError:\s*/i, "");

  if (code.includes("email-already-in-use") || raw.includes("email-already-in-use")) {
    return "هذا البريد مستخدم مسبقًا.";
  }
  if (code.includes("weak-password") || raw.includes("weak-password")) {
    return "كلمة المرور ضعيفة. استخدم 6 أحرف على الأقل.";
  }
  if (code.includes("invalid-email") || raw.includes("invalid-email")) {
    return "صيغة البريد الإلكتروني غير صحيحة.";
  }
  if (code.includes("permission-denied") || raw.includes("permission-denied")) {
    return "لا توجد صلاحية كافية لإنشاء أو ربط الحساب.";
  }
  if (code.includes("unauthenticated") || raw.includes("unauthenticated")) {
    return "انتهت جلسة الدخول. سجل الدخول مرة أخرى ثم حاول إنشاء الحساب.";
  }
  if (code.includes("network-request-failed") || raw.includes("network-request-failed")) {
    return "تعذر الاتصال بـ Firebase. تحقق من الاتصال ثم حاول مرة أخرى.";
  }
  if (hasArabicText(raw)) return raw;
  return fallback;
}

export default function CreateStaffAccountV2({ session }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const [createForm, setCreateForm] = useState({
    displayName: "",
    email: "",
    phone: "",
    employeeId: "",
    department: "",
    title: "",
    avatarUrl: "",
    password: makeTempPassword(),
    role: "staff" as CreateRole,
    specialties: "",
    bio: "",
  });

  const [promoteForm, setPromoteForm] = useState({
    uid: "",
    displayName: "",
    email: "",
    phone: "",
    employeeId: "",
    department: "",
    title: "",
    avatarUrl: "",
    specialties: "",
    bio: "",
    role: "staff" as EmployeeRole,
    active: true,
  });

  const sessionRole = cleanText(session.role).toLowerCase();
  const hasFirebaseAuth = !!auth.currentUser;
  const canManageAccounts = useMemo(
    () => ["owner", "admin", "hr"].includes(sessionRole),
    [sessionRole],
  );
  const canCreate = useMemo(
    () => !!session.uid && hasFirebaseAuth && canManageAccounts,
    [canManageAccounts, hasFirebaseAuth, session.uid],
  );

  const disabledReason = !hasFirebaseAuth
    ? "جاري التحقق من جلسة Firebase. إذا استمرت الرسالة، سجل الخروج ثم ادخل من جديد."
    : !canManageAccounts
      ? "إنشاء حسابات الموظفات متاح للمالك أو المدير أو الموارد البشرية فقط."
      : "";

  const ensureCanManageAccounts = () => {
    if (!auth.currentUser) {
      setMessage("انتهت جلسة الدخول. سجل الدخول مرة أخرى ثم حاول إنشاء الحساب.");
      return false;
    }
    if (!canManageAccounts) {
      setMessage("لا توجد صلاحية كافية لإنشاء أو ربط حسابات الموظفات.");
      return false;
    }
    return true;
  };

  const handleCreate = async () => {
    if (!ensureCanManageAccounts()) return;

    const displayName = cleanText(createForm.displayName);
    const email = cleanText(createForm.email).toLowerCase();
    const password = cleanText(createForm.password);
    if (!displayName || !email || !email.includes("@")) {
      setMessage("الاسم والبريد الإلكتروني الصحيح مطلوبان.");
      return;
    }
    if (!password || password.length < 6) {
      setMessage("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
      return;
    }

    setBusy(true);
    setMessage("");
    let secondary: Auth | null = null;
    try {
      secondary = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secondary, email, password);
      await updateProfile(cred.user, { displayName }).catch(() => {});

      const uid = cred.user.uid;
      const employeeId = cleanText(createForm.employeeId) || uid;
      const role = createForm.role;

      await syncEmployeeRecordFromUser({
        uid,
        email,
        displayName,
        phone: createForm.phone,
        employeeId,
        department: cleanText(createForm.department),
        title: cleanText(createForm.title),
        avatarUrl: cleanText(createForm.avatarUrl),
        role,
        active: true,
        linkedEmployeeDocId: employeeId,
        specialties: createForm.specialties
          ? createForm.specialties.split(",").map((x) => cleanText(x)).filter(Boolean)
          : [],
        bio: createForm.bio,
        employeeProfileEnabled: true,
        showOnAbout: role === "staff",
        showOnBooking: role === "staff",
      });

      await createEmployeeNotification({
        targetUid: uid,
        targetEmployeeId: employeeId,
        type: "system",
        title: "تم إنشاء حساب الموظف",
        body: "يمكنك الآن الدخول إلى بوابة الموظف ومتابعة التنبيهات الخاصة بك.",
        route: "/employee/overview",
      }).catch(() => {});

      const createdIdentity = employeeId && employeeId !== uid ? `${uid} / ${employeeId}` : uid;
      setMessage(`تم إنشاء حساب الموظفة: ${displayName} (${createdIdentity}) بدور ${getRoleLabel(role)}.`);
      setCreateForm({
        displayName: "",
        email: "",
        phone: "",
        employeeId: "",
        department: "",
        title: "",
        avatarUrl: "",
        password: makeTempPassword(),
        role: "staff",
        specialties: "",
        bio: "",
      });
    } catch (error) {
      setMessage(getFriendlyAuthError(error, "تعذر إنشاء حساب الموظفة. تأكد من الصلاحيات والبيانات ثم حاول مرة أخرى."));
    } finally {
      if (secondary) await signOut(secondary).catch(() => {});
      setBusy(false);
    }
  };

  const handlePromote = async () => {
    if (!ensureCanManageAccounts()) return;

    const uid = cleanText(promoteForm.uid);
    const displayName = cleanText(promoteForm.displayName);
    const email = cleanText(promoteForm.email).toLowerCase();
    if (!uid || !displayName || !email || !email.includes("@")) {
      setMessage("معرّف المستخدم والاسم والبريد الإلكتروني مطلوبة لربط مستخدم موجود.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      await syncEmployeeRecordFromUser({
        uid,
        email,
        displayName,
        phone: promoteForm.phone,
        employeeId: promoteForm.employeeId || uid,
        department: promoteForm.department,
        title: promoteForm.title,
        avatarUrl: promoteForm.avatarUrl,
        role: promoteForm.role,
        active: promoteForm.active,
        linkedEmployeeDocId: promoteForm.employeeId || uid,
        specialties: promoteForm.specialties
          ? promoteForm.specialties.split(",").map((x) => cleanText(x)).filter(Boolean)
          : [],
        bio: promoteForm.bio,
        employeeProfileEnabled: true,
        showOnAbout: promoteForm.role === "staff",
        showOnBooking: promoteForm.role === "staff",
      });

      await createEmployeeNotification({
        targetUid: uid,
        targetEmployeeId: uid,
        type: "system",
        title: "تم تفعيل ملفك الوظيفي",
        body: "تم ربط حسابك ببوابة الموظف. راجع التنبيهات والملفات والإجازات من هناك.",
        route: "/employee/overview",
      }).catch(() => {});

      const promotedIdentity =
        promoteForm.employeeId && promoteForm.employeeId !== uid
          ? `${uid} / ${promoteForm.employeeId}`
          : uid;
      setMessage(`تم ربط المستخدم: ${displayName} (${promotedIdentity}) بدور ${getRoleLabel(promoteForm.role)}.`);
      setPromoteForm({
        uid: "",
        displayName: "",
        email: "",
        phone: "",
        employeeId: "",
        department: "",
        title: "",
        avatarUrl: "",
        specialties: "",
        bio: "",
        role: "staff",
        active: true,
      });
    } catch (error) {
      setMessage(getFriendlyAuthError(error, "تعذر ربط المستخدم الموجود. تأكد من الصلاحيات والبيانات ثم حاول مرة أخرى."));
    } finally {
      setBusy(false);
    }
  };

  if (!session.user) {
    return (
      <main className="dashboard-v2 dsv2-page admin-create-staff-v2-page" dir="rtl">
        <DashboardEmptyStateV2 title="لا توجد جلسة موظف نشطة" tone="gold" />
      </main>
    );
  }

  return (
    <main className="dashboard-v2 dsv2-page admin-create-staff-v2-page" dir="rtl">
      <section className="admin-create-staff-v2-hero">
        <div className="admin-create-staff-v2-hero__copy">
          <span className="dsv2-badge">إدارة الحسابات</span>
          <h1>إنشاء وربط حساب موظفة</h1>
          <p>أنشئ حساب Firebase جديدًا بدون التأثير على جلسة الإدارة، أو اربط مستخدمًا موجودًا بملف الموارد البشرية.</p>
        </div>
        <div className="admin-create-staff-v2-status">
          <span><FontAwesomeIcon icon={faShieldHalved} /> صلاحية الإدارة</span>
          <strong>{canManageAccounts ? "مفعلة" : "غير متاحة"}</strong>
          <small>{hasFirebaseAuth ? "جلسة Firebase نشطة" : "جلسة Firebase غير متاحة"}</small>
        </div>
      </section>

      {message ? <div className="admin-create-staff-v2-alert" role="status">{message}</div> : null}
      {disabledReason ? <div className="admin-create-staff-v2-notice">{disabledReason}</div> : null}

      <section className="admin-create-staff-v2-grid">
        <article className="dsv2-card admin-create-staff-v2-card">
          <header className="admin-create-staff-v2-card__head">
            <span className="admin-create-staff-v2-card__icon"><FontAwesomeIcon icon={faUserPlus} /></span>
            <div>
              <span>حساب جديد</span>
              <h2>إنشاء موظفة جديدة</h2>
              <p>ينشئ مستخدم Firebase ثانويًا ثم يربطه بسجل الموظفة دون تغيير جلسة الإدارة الحالية.</p>
            </div>
          </header>

          <div className="admin-create-staff-v2-form">
            <DashboardFieldV2 id="create-staff-name" label="الاسم الظاهر" required>
              <input id="create-staff-name" className="dsv2-input" value={createForm.displayName} onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-email" label="البريد الإلكتروني" required>
              <input id="create-staff-email" className="dsv2-input" type="email" value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-phone" label="رقم الجوال">
              <input id="create-staff-phone" className="dsv2-input" value={createForm.phone} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-employee-id" label="الرقم الوظيفي" hint="يُترك فارغًا لاستخدام UID">
              <input id="create-staff-employee-id" className="dsv2-input" value={createForm.employeeId} onChange={(e) => setCreateForm((p) => ({ ...p, employeeId: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-department" label="القسم">
              <input id="create-staff-department" className="dsv2-input" value={createForm.department} onChange={(e) => setCreateForm((p) => ({ ...p, department: e.target.value }))} placeholder="إدارة / فرع / فريق" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-title" label="المسمى الوظيفي">
              <input id="create-staff-title" className="dsv2-input" value={createForm.title} onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))} placeholder="مثال: أخصائية شعر" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-avatar" label="رابط الصورة" className="admin-create-staff-v2-field--wide">
              <input id="create-staff-avatar" className="dsv2-input" value={createForm.avatarUrl} onChange={(e) => setCreateForm((p) => ({ ...p, avatarUrl: e.target.value }))} placeholder="https://..." />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-role" label="الدور" required>
              <DashboardSelectV2
                id="create-staff-role"
                value={createForm.role}
                options={CREATE_ROLE_OPTIONS}
                onChange={(value) => setCreateForm((p) => ({ ...p, role: value as CreateRole }))}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-password" label="كلمة مرور مؤقتة" required className="admin-create-staff-v2-field--wide">
              <div className="admin-create-staff-v2-password-row">
                <input id="create-staff-password" className="dsv2-input" value={createForm.password} onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))} />
                <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => setCreateForm((p) => ({ ...p, password: makeTempPassword() }))} disabled={busy}>
                  <FontAwesomeIcon icon={faArrowsRotate} />
                  <span>توليد</span>
                </button>
              </div>
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-specialties" label="التخصصات" className="admin-create-staff-v2-field--wide">
              <input id="create-staff-specialties" className="dsv2-input" value={createForm.specialties} onChange={(e) => setCreateForm((p) => ({ ...p, specialties: e.target.value }))} placeholder="شعر، صبغات، أظافر" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="create-staff-bio" label="نبذة" className="admin-create-staff-v2-field--wide">
              <textarea id="create-staff-bio" className="dsv2-textarea" rows={4} value={createForm.bio} onChange={(e) => setCreateForm((p) => ({ ...p, bio: e.target.value }))} />
            </DashboardFieldV2>
          </div>

          <footer className="admin-create-staff-v2-card__actions">
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => void handleCreate()} disabled={busy || !canCreate}>
              <FontAwesomeIcon icon={faUserPlus} />
              <span>{busy ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب"}</span>
            </button>
          </footer>
        </article>

        <article className="dsv2-card admin-create-staff-v2-card">
          <header className="admin-create-staff-v2-card__head">
            <span className="admin-create-staff-v2-card__icon"><FontAwesomeIcon icon={faLink} /></span>
            <div>
              <span>مستخدم موجود</span>
              <h2>ربط حساب بملف موظفة</h2>
              <p>استخدم UID لمستخدم موجود ثم أنشئ أو حدّث الربط الوظيفي والأذونات الأساسية.</p>
            </div>
          </header>

          <div className="admin-create-staff-v2-form">
            <DashboardFieldV2 id="promote-staff-uid" label="معرّف المستخدم UID" required>
              <input id="promote-staff-uid" className="dsv2-input" value={promoteForm.uid} onChange={(e) => setPromoteForm((p) => ({ ...p, uid: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-name" label="الاسم الظاهر" required>
              <input id="promote-staff-name" className="dsv2-input" value={promoteForm.displayName} onChange={(e) => setPromoteForm((p) => ({ ...p, displayName: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-email" label="البريد الإلكتروني" required>
              <input id="promote-staff-email" className="dsv2-input" type="email" value={promoteForm.email} onChange={(e) => setPromoteForm((p) => ({ ...p, email: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-phone" label="رقم الجوال">
              <input id="promote-staff-phone" className="dsv2-input" value={promoteForm.phone} onChange={(e) => setPromoteForm((p) => ({ ...p, phone: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-employee-id" label="الرقم الوظيفي" hint="يُترك فارغًا لاستخدام UID">
              <input id="promote-staff-employee-id" className="dsv2-input" value={promoteForm.employeeId} onChange={(e) => setPromoteForm((p) => ({ ...p, employeeId: e.target.value }))} />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-department" label="القسم">
              <input id="promote-staff-department" className="dsv2-input" value={promoteForm.department} onChange={(e) => setPromoteForm((p) => ({ ...p, department: e.target.value }))} placeholder="إدارة / فرع / فريق" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-title" label="المسمى الوظيفي">
              <input id="promote-staff-title" className="dsv2-input" value={promoteForm.title} onChange={(e) => setPromoteForm((p) => ({ ...p, title: e.target.value }))} placeholder="مثال: أخصائية شعر" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-avatar" label="رابط الصورة" className="admin-create-staff-v2-field--wide">
              <input id="promote-staff-avatar" className="dsv2-input" value={promoteForm.avatarUrl} onChange={(e) => setPromoteForm((p) => ({ ...p, avatarUrl: e.target.value }))} placeholder="https://..." />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-role" label="الدور" required>
              <DashboardSelectV2
                id="promote-staff-role"
                value={promoteForm.role}
                options={PROMOTE_ROLE_OPTIONS}
                onChange={(value) => setPromoteForm((p) => ({ ...p, role: value as EmployeeRole }))}
              />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-specialties" label="التخصصات" className="admin-create-staff-v2-field--wide">
              <input id="promote-staff-specialties" className="dsv2-input" value={promoteForm.specialties} onChange={(e) => setPromoteForm((p) => ({ ...p, specialties: e.target.value }))} placeholder="شعر، صبغات، أظافر" />
            </DashboardFieldV2>
            <DashboardFieldV2 id="promote-staff-bio" label="نبذة" className="admin-create-staff-v2-field--wide">
              <textarea id="promote-staff-bio" className="dsv2-textarea" rows={4} value={promoteForm.bio} onChange={(e) => setPromoteForm((p) => ({ ...p, bio: e.target.value }))} />
            </DashboardFieldV2>
            <label className="admin-create-staff-v2-check admin-create-staff-v2-field--wide">
              <input type="checkbox" checked={promoteForm.active} onChange={(e) => setPromoteForm((p) => ({ ...p, active: e.target.checked }))} />
              <span>الحساب الوظيفي نشط</span>
            </label>
          </div>

          <footer className="admin-create-staff-v2-card__actions">
            <button className="dsv2-btn dsv2-btn--primary" type="button" onClick={() => void handlePromote()} disabled={busy || !canCreate}>
              <FontAwesomeIcon icon={faLink} />
              <span>{busy ? "جارٍ المزامنة..." : "مزامنة المستخدم"}</span>
            </button>
          </footer>
        </article>
      </section>
    </main>
  );
}
