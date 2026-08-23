import { useMemo, useState } from "react";
import { initializeApp, getApps } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut,
  updateProfile,
  type Auth,
  type User,
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
import { CoreAccountService, type CoreAccount } from "../../services/CoreAccountService";
import { CoreHrService } from "../../services/CoreHrService";
import { CoreWorkforceService } from "../../services/CoreWorkforceService";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
};

type CreateRole = "staff" | "reception" | "admin" | "hr";
type EmployeeRole = CreateRole | "owner";

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

async function findCoreAccount(firebaseUid: string, email: string): Promise<CoreAccount | null> {
  const uid = cleanText(firebaseUid);
  const normalizedEmail = cleanText(email).toLowerCase();
  const rows = await CoreAccountService.list(false, "internal");
  return rows.find((row) =>
    (uid && (cleanText(row.firebaseUid) === uid || cleanText(row.uid) === uid)) ||
    (normalizedEmail && cleanText(row.email).toLowerCase() === normalizedEmail)
  ) || null;
}

async function persistCoreStaffIdentity(input: {
  firebaseUid: string;
  employeeId: string;
  email: string;
  displayName: string;
  phone?: string;
  department?: string;
  title?: string;
  avatarUrl?: string;
  bio?: string;
  role: EmployeeRole;
  active: boolean;
}) {
  const employeeId = cleanText(input.employeeId || input.firebaseUid);
  const accountInput = {
    firebaseUid: cleanText(input.firebaseUid),
    email: cleanText(input.email).toLowerCase(),
    phone: cleanText(input.phone || "") || undefined,
    displayName: cleanText(input.displayName),
    role: input.role,
    status: input.active ? "active" as const : "disabled" as const,
  };

  const existingAccount = await findCoreAccount(accountInput.firebaseUid, accountInput.email);
  const existingEmployee = await CoreHrService.getEmployee(employeeId).catch(() => null);
  const account = existingAccount
    ? await CoreAccountService.update(existingAccount.id, accountInput)
    : await CoreAccountService.create(accountInput);
  let employeeSaved = false;

  try {
    const employee = await CoreHrService.saveEmployee({
      id: employeeId,
      firebaseUid: accountInput.firebaseUid,
      name: accountInput.displayName,
      email: accountInput.email,
      phone: cleanText(input.phone || "") || null,
      department: cleanText(input.department || "") || null,
      title: cleanText(input.title || "") || null,
      avatarUrl: cleanText(input.avatarUrl || "") || null,
      bio: cleanText(input.bio || "") || null,
      showOnAbout: input.role === "staff",
      includeInEmployeeManagement: true,
      status: input.active ? "active" : "inactive",
      employmentStatus: input.active ? "active" : "inactive",
      employmentSource: "salon",
    });
    employeeSaved = true;

    await CoreAccountService.linkEmployee(account.id, cleanText(employee.id) || employeeId);
    return { account, employeeId: cleanText(employee.id) || employeeId };
  } catch (error) {
    if (!existingAccount) {
      await CoreAccountService.remove(account.id).catch(() => {});
    }
    if (!existingEmployee && employeeSaved) {
      await CoreHrService.saveEmployee({
        id: employeeId,
        name: accountInput.displayName,
        status: "inactive",
        employmentStatus: "inactive",
        adminNotes: "Account provisioning rollback: Core account/employee link did not complete.",
      }).catch(() => {});
    }
    throw error;
  }
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
    let createdUser: User | null = null;
    try {
      secondary = getSecondaryAuth();
      const cred = await createUserWithEmailAndPassword(secondary, email, password);
      createdUser = cred.user;
      await updateProfile(cred.user, { displayName }).catch(() => {});

      const uid = cred.user.uid;
      const employeeId = cleanText(createForm.employeeId) || uid;
      const role = createForm.role;

      const persisted = await persistCoreStaffIdentity({
        firebaseUid: uid,
        employeeId,
        email,
        displayName,
        phone: createForm.phone,
        department: createForm.department,
        title: createForm.title,
        avatarUrl: createForm.avatarUrl,
        bio: createForm.bio,
        role,
        active: true,
      });

      await CoreWorkforceService.createNotification({
        targetUid: uid,
        targetEmployeeId: persisted.employeeId,
        type: "system",
        title: "تم إنشاء حساب الموظف",
        body: "يمكنك الآن الدخول إلى بوابة الموظف ومتابعة التنبيهات الخاصة بك.",
        route: "/employee/overview",
      }).catch(() => {});

      const createdIdentity = persisted.employeeId !== uid ? `${uid} / ${persisted.employeeId}` : uid;
      setMessage(`تم إنشاء حساب الموظفة وربطه بـ Core: ${displayName} (${createdIdentity}) بدور ${getRoleLabel(role)}.`);
      createdUser = null;
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
            bio: "",
      });
    } catch (error) {
      if (createdUser) {
        await deleteUser(createdUser).catch(() => {});
      }
      setMessage(getFriendlyAuthError(error, "تعذر إنشاء وربط حساب الموظفة في Core. لم يتم استخدام Firestore fallback."));
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
      setMessage("معرّف Firebase والاسم والبريد الإلكتروني مطلوبة لربط مستخدم موجود.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const persisted = await persistCoreStaffIdentity({
        firebaseUid: uid,
        employeeId: cleanText(promoteForm.employeeId) || uid,
        email,
        displayName,
        phone: promoteForm.phone,
        department: promoteForm.department,
        title: promoteForm.title,
        avatarUrl: promoteForm.avatarUrl,
        bio: promoteForm.bio,
        role: promoteForm.role,
        active: promoteForm.active,
      });

      await CoreWorkforceService.createNotification({
        targetUid: uid,
        targetEmployeeId: persisted.employeeId,
        type: "system",
        title: "تم تفعيل ملفك الوظيفي",
        body: "تم ربط حسابك ببوابة الموظف من خلال Core. راجع التنبيهات والملفات والطلبات من هناك.",
        route: "/employee/overview",
      }).catch(() => {});

      const promotedIdentity = persisted.employeeId !== uid ? `${uid} / ${persisted.employeeId}` : uid;
      setMessage(`تم ربط المستخدم في Core: ${displayName} (${promotedIdentity}) بدور ${getRoleLabel(promoteForm.role)}.`);
      setPromoteForm({
        uid: "",
        displayName: "",
        email: "",
        phone: "",
        employeeId: "",
        department: "",
        title: "",
        avatarUrl: "",
            bio: "",
        role: "staff",
        active: true,
      });
    } catch (error) {
      setMessage(getFriendlyAuthError(error, "تعذر ربط المستخدم الموجود في Core. لم يتم استخدام Firestore fallback."));
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
          <p>أنشئ حساب Firebase جديدًا بدون التأثير على جلسة الإدارة، أو اربط مستخدم Firebase موجودًا بحساب وملف موظفة Canonical داخل Core D1.</p>
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
              <p>ينشئ مستخدم Firebase للمصادقة فقط، ثم ينشئ الحساب التشغيلي وربط الموظفة داخل Core D1 دون تغيير جلسة الإدارة الحالية. الخدمات والتخصصات تُدار لاحقًا من ملف الموظفة ولا تُخزن ضمن حساب الدخول.</p>
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
