import { useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  updateProfile,
  type Auth,
} from "firebase/auth";

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
  { value: "staff", label: "موظف" },
  { value: "hr", label: "الموارد البشرية" },
  { value: "reception", label: "الاستقبال" },
  { value: "admin", label: "مدير" },
];

const PROMOTE_ROLE_OPTIONS: Array<{ value: EmployeeRole; label: string }> = [
  { value: "staff", label: "موظف" },
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
  if (value === "staff") return "موظف";
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

export default function CreateStaffAccountPage({ session }: Props) {
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
    [sessionRole]
  );
  const canCreate = useMemo(
    () => !!session.uid && hasFirebaseAuth && canManageAccounts,
    [canManageAccounts, hasFirebaseAuth, session.uid]
  );

  const disabledReason = !hasFirebaseAuth
    ? "جاري التحقق من جلسة Firebase. إذا استمرت الرسالة، سجل الخروج ثم ادخل من جديد."
    : !canManageAccounts
      ? "إنشاء حسابات الموظفين متاح للمالك أو المدير أو الموارد البشرية فقط."
      : "";

  const ensureCanManageAccounts = () => {
    if (!auth.currentUser) {
      setMessage("انتهت جلسة الدخول. سجل الدخول مرة أخرى ثم حاول إنشاء الحساب.");
      return false;
    }
    if (!canManageAccounts) {
      setMessage("لا توجد صلاحية كافية لإنشاء أو ربط حسابات الموظفين.");
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

      const createdIdentity =
        employeeId && employeeId !== uid
          ? `${uid} / ${employeeId}`
          : uid;
      setMessage(`تم إنشاء حساب الموظف: ${displayName} (${createdIdentity}) بدور ${getRoleLabel(role)}.`);
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
    } catch (e) {
      setMessage(getFriendlyAuthError(e, "تعذر إنشاء حساب الموظف. تأكد من الصلاحيات والبيانات ثم حاول مرة أخرى."));
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
    } catch (e) {
      setMessage(getFriendlyAuthError(e, "تعذر ربط المستخدم الموجود. تأكد من الصلاحيات والبيانات ثم حاول مرة أخرى."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hr-page">
      <section className="hr-card">
        <div className="hr-card-head">
          <div>
            <h2>إنشاء حساب موظف</h2>
            <p>أنشئ حساب Firebase جديدًا للموظف أو اربط مستخدمًا موجودًا بملف الموارد البشرية.</p>
          </div>
        </div>

        {message ? <div className="hr-alert">{message}</div> : null}
        {disabledReason ? <div className="hr-muted">{disabledReason}</div> : null}

        <div className="hr-grid">
          <div className="hr-card hr-card--soft">
            <h3>حساب جديد</h3>
            <div className="hr-form-grid">
              <label className="hr-field">
                <span>الاسم الظاهر</span>
                <input value={createForm.displayName} onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>البريد الإلكتروني</span>
                <input value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>رقم الجوال</span>
                <input value={createForm.phone} onChange={(e) => setCreateForm((p) => ({ ...p, phone: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>الرقم الوظيفي</span>
                <input
                  value={createForm.employeeId}
                  onChange={(e) => setCreateForm((p) => ({ ...p, employeeId: e.target.value }))}
                  placeholder="يُترك فارغًا ليستخدم UID"
                />
              </label>
              <label className="hr-field">
                <span>القسم</span>
                <input
                  value={createForm.department}
                  onChange={(e) => setCreateForm((p) => ({ ...p, department: e.target.value }))}
                  placeholder="إدارة / فرع / فريق"
                />
              </label>
              <label className="hr-field">
                <span>المسمى الوظيفي</span>
                <input
                  value={createForm.title}
                  onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="مثال: أخصائية شعر"
                />
              </label>
              <label className="hr-field hr-field--wide">
                <span>رابط الصورة</span>
                <input
                  value={createForm.avatarUrl}
                  onChange={(e) => setCreateForm((p) => ({ ...p, avatarUrl: e.target.value }))}
                  placeholder="https://..."
                />
              </label>
              <label className="hr-field">
                <span>الدور</span>
                <select value={createForm.role} onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value as any }))}>
                  {CREATE_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="hr-field hr-field--wide">
                <span>كلمة مرور مؤقتة</span>
                <input value={createForm.password} onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))} />
              </label>
              <label className="hr-field hr-field--wide">
                <span>التخصصات</span>
                <input
                  value={createForm.specialties}
                  onChange={(e) => setCreateForm((p) => ({ ...p, specialties: e.target.value }))}
                  placeholder="شعر، صبغات، أظافر"
                />
              </label>
              <label className="hr-field hr-field--wide">
                <span>نبذة</span>
                <textarea
                  rows={4}
                  value={createForm.bio}
                  onChange={(e) => setCreateForm((p) => ({ ...p, bio: e.target.value }))}
                />
              </label>
            </div>

            <div className="hr-actions">
              <button className="hr-button hr-button--ghost" type="button" onClick={() => setCreateForm((p) => ({ ...p, password: makeTempPassword() }))} disabled={busy}>
                توليد كلمة مرور
              </button>
              <button className="hr-button hr-button--accent" type="button" onClick={() => void handleCreate()} disabled={busy || !canCreate}>
                {busy ? "جارٍ إنشاء الحساب..." : "إنشاء الحساب"}
              </button>
            </div>
          </div>

          <div className="hr-card hr-card--soft">
            <h3>ربط مستخدم موجود</h3>
            <div className="hr-form-grid">
              <label className="hr-field">
                <span>معرّف المستخدم UID</span>
                <input value={promoteForm.uid} onChange={(e) => setPromoteForm((p) => ({ ...p, uid: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>الاسم الظاهر</span>
                <input value={promoteForm.displayName} onChange={(e) => setPromoteForm((p) => ({ ...p, displayName: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>البريد الإلكتروني</span>
                <input value={promoteForm.email} onChange={(e) => setPromoteForm((p) => ({ ...p, email: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>رقم الجوال</span>
                <input value={promoteForm.phone} onChange={(e) => setPromoteForm((p) => ({ ...p, phone: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>الرقم الوظيفي</span>
                <input value={promoteForm.employeeId} onChange={(e) => setPromoteForm((p) => ({ ...p, employeeId: e.target.value }))} placeholder="يُترك فارغًا ليستخدم UID" />
              </label>
              <label className="hr-field">
                <span>القسم</span>
                <input value={promoteForm.department} onChange={(e) => setPromoteForm((p) => ({ ...p, department: e.target.value }))} placeholder="إدارة / فرع / فريق" />
              </label>
              <label className="hr-field">
                <span>المسمى الوظيفي</span>
                <input value={promoteForm.title} onChange={(e) => setPromoteForm((p) => ({ ...p, title: e.target.value }))} placeholder="مثال: أخصائية شعر" />
              </label>
              <label className="hr-field hr-field--wide">
                <span>رابط الصورة</span>
                <input value={promoteForm.avatarUrl} onChange={(e) => setPromoteForm((p) => ({ ...p, avatarUrl: e.target.value }))} placeholder="https://..." />
              </label>
              <label className="hr-field">
                <span>الدور</span>
                <select value={promoteForm.role} onChange={(e) => setPromoteForm((p) => ({ ...p, role: e.target.value as EmployeeRole }))}>
                  {PROMOTE_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="hr-field hr-field--wide">
                <span>التخصصات</span>
                <input
                  value={promoteForm.specialties}
                  onChange={(e) => setPromoteForm((p) => ({ ...p, specialties: e.target.value }))}
                  placeholder="شعر، صبغات، أظافر"
                />
              </label>
              <label className="hr-field hr-field--wide">
                <span>نبذة</span>
                <textarea
                  rows={4}
                  value={promoteForm.bio}
                  onChange={(e) => setPromoteForm((p) => ({ ...p, bio: e.target.value }))}
                />
              </label>
            </div>

            <label className="hr-check">
              <input
                type="checkbox"
                checked={promoteForm.active}
                onChange={(e) => setPromoteForm((p) => ({ ...p, active: e.target.checked }))}
              />
              نشط
            </label>

            <div className="hr-actions">
              <button className="hr-button" type="button" onClick={() => void handlePromote()} disabled={busy || !canCreate}>
                {busy ? "جارٍ المزامنة..." : "مزامنة المستخدم"}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
