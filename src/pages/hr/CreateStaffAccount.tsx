import { useMemo, useState } from "react";

import { adminCreateStaffUser } from "../../services/adminStaffService";
import {
  createEmployeeNotification,
  syncEmployeeRecordFromUser,
  type EmployeeRole,
} from "../../services/employeeHub";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
};

function makeTempPassword() {
  return `Hr${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 6)}!`;
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
    role: "staff" as "staff" | "reception" | "admin" | "hr",
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

  const canCreate = useMemo(() => !!session.uid, [session.uid]);

  const handleCreate = async () => {
    const displayName = cleanText(createForm.displayName);
    const email = cleanText(createForm.email).toLowerCase();
    if (!displayName || !email || !email.includes("@")) {
      setMessage("Display name and valid email are required.");
      return;
    }
    if (!createForm.password || createForm.password.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const result = await adminCreateStaffUser({
        email,
        password: createForm.password,
        displayName,
        phone: createForm.phone,
        employeeId: cleanText(createForm.employeeId),
        department: cleanText(createForm.department),
        title: cleanText(createForm.title),
        avatarUrl: cleanText(createForm.avatarUrl),
        role: createForm.role,
        specialties: createForm.specialties
          ? createForm.specialties.split(",").map((x) => cleanText(x)).filter(Boolean)
          : [],
        bio: createForm.bio,
      });

      await createEmployeeNotification({
        targetUid: result.uid,
        targetEmployeeId: result.employeeId || result.uid,
        type: "system",
        title: "تم إنشاء حساب الموظف",
        body: "يمكنك الآن الدخول إلى بوابة الموظف ومتابعة التنبيهات الخاصة بك.",
        route: "/employee/overview",
      }).catch(() => {});

      const createdIdentity =
        result.employeeId && result.employeeId !== result.uid
          ? `${result.uid} / ${result.employeeId}`
          : result.uid;
      setMessage(`Created ${result.displayName} (${createdIdentity}) as ${result.role}.`);
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
      setMessage(cleanText((e as any)?.message || "Failed to create staff account."));
    } finally {
      setBusy(false);
    }
  };

  const handlePromote = async () => {
    const uid = cleanText(promoteForm.uid);
    const displayName = cleanText(promoteForm.displayName);
    const email = cleanText(promoteForm.email).toLowerCase();
    if (!uid || !displayName || !email || !email.includes("@")) {
      setMessage("UID, name, and email are required to promote an existing user.");
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
      setMessage(`Promoted ${displayName} (${promotedIdentity}) to ${promoteForm.role}.`);
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
      setMessage(cleanText((e as any)?.message || "Failed to promote existing user."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="hr-page">
      <section className="hr-card">
        <div className="hr-card-head">
          <div>
            <h2>Create Staff Account</h2>
            <p>Use the callable for brand new users or sync an existing user into the HR model.</p>
          </div>
        </div>

        {message ? <div className="hr-alert">{message}</div> : null}
        {!canCreate ? <div className="hr-muted">Waiting for signed-in HR session...</div> : null}

        <div className="hr-grid">
          <div className="hr-card hr-card--soft">
            <h3>New Account</h3>
            <div className="hr-form-grid">
              <label className="hr-field">
                <span>Display name</span>
                <input value={createForm.displayName} onChange={(e) => setCreateForm((p) => ({ ...p, displayName: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>Email</span>
                <input value={createForm.email} onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>Phone</span>
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
                <span>Role</span>
                <select value={createForm.role} onChange={(e) => setCreateForm((p) => ({ ...p, role: e.target.value as any }))}>
                  <option value="staff">Staff</option>
                  <option value="hr">HR</option>
                  <option value="reception">Reception</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label className="hr-field hr-field--wide">
                <span>Temporary password</span>
                <input value={createForm.password} onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))} />
              </label>
              <label className="hr-field hr-field--wide">
                <span>Specialties</span>
                <input
                  value={createForm.specialties}
                  onChange={(e) => setCreateForm((p) => ({ ...p, specialties: e.target.value }))}
                  placeholder="hair, color, nails"
                />
              </label>
              <label className="hr-field hr-field--wide">
                <span>Bio</span>
                <textarea
                  rows={4}
                  value={createForm.bio}
                  onChange={(e) => setCreateForm((p) => ({ ...p, bio: e.target.value }))}
                />
              </label>
            </div>

            <div className="hr-actions">
              <button className="hr-button hr-button--ghost" type="button" onClick={() => setCreateForm((p) => ({ ...p, password: makeTempPassword() }))} disabled={busy}>
                Generate password
              </button>
              <button className="hr-button hr-button--accent" type="button" onClick={() => void handleCreate()} disabled={busy}>
                Create account
              </button>
            </div>
          </div>

          <div className="hr-card hr-card--soft">
            <h3>Promote Existing User</h3>
            <div className="hr-form-grid">
              <label className="hr-field">
                <span>UID</span>
                <input value={promoteForm.uid} onChange={(e) => setPromoteForm((p) => ({ ...p, uid: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>Display name</span>
                <input value={promoteForm.displayName} onChange={(e) => setPromoteForm((p) => ({ ...p, displayName: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>Email</span>
                <input value={promoteForm.email} onChange={(e) => setPromoteForm((p) => ({ ...p, email: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>Phone</span>
                <input value={promoteForm.phone} onChange={(e) => setPromoteForm((p) => ({ ...p, phone: e.target.value }))} />
              </label>
              <label className="hr-field">
                <span>Employee ID</span>
                <input value={promoteForm.employeeId} onChange={(e) => setPromoteForm((p) => ({ ...p, employeeId: e.target.value }))} placeholder="defaults to UID" />
              </label>
              <label className="hr-field">
                <span>Department</span>
                <input value={promoteForm.department} onChange={(e) => setPromoteForm((p) => ({ ...p, department: e.target.value }))} placeholder="Salon / branch / team" />
              </label>
              <label className="hr-field">
                <span>Title</span>
                <input value={promoteForm.title} onChange={(e) => setPromoteForm((p) => ({ ...p, title: e.target.value }))} placeholder="Senior stylist" />
              </label>
              <label className="hr-field hr-field--wide">
                <span>Avatar URL</span>
                <input value={promoteForm.avatarUrl} onChange={(e) => setPromoteForm((p) => ({ ...p, avatarUrl: e.target.value }))} placeholder="https://..." />
              </label>
              <label className="hr-field">
                <span>Role</span>
                <select value={promoteForm.role} onChange={(e) => setPromoteForm((p) => ({ ...p, role: e.target.value as EmployeeRole }))}>
                  <option value="staff">Staff</option>
                  <option value="hr">HR</option>
                  <option value="reception">Reception</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
              </label>
              <label className="hr-field hr-field--wide">
                <span>Specialties</span>
                <input
                  value={promoteForm.specialties}
                  onChange={(e) => setPromoteForm((p) => ({ ...p, specialties: e.target.value }))}
                  placeholder="hair, color, nails"
                />
              </label>
              <label className="hr-field hr-field--wide">
                <span>Bio</span>
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
              Active
            </label>

            <div className="hr-actions">
              <button className="hr-button" type="button" onClick={() => void handlePromote()} disabled={busy}>
                Sync user
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
