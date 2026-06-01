import { useEffect, useMemo, useState } from "react";

import { adminCreateStaffUser, type StaffCreateRole } from "../../services/adminStaffService";
import {
  createRecruitmentApplication,
  listRecruitmentApplications,
  updateRecruitmentApplication,
  type RecruitmentApplication,
} from "../../services/employeeHub";
import { cleanText, type HrSession } from "./shared";

type Props = {
  session: HrSession;
};

function makeTempPassword() {
  return `Hr${Math.random().toString(36).slice(2, 6)}${Math.random().toString(36).slice(2, 6)}!`;
}

function statusLabel(status?: RecruitmentApplication["status"] | string | null) {
  const value = cleanText(status).toLowerCase();
  if (value === "new") return "جديد";
  if (value === "reviewing") return "قيد المراجعة";
  if (value === "accepted") return "مقبول";
  if (value === "rejected") return "مرفوض";
  if (value === "hired") return "تم التوظيف";
  return status || "غير محدد";
}

function roleLabel(role?: string | null) {
  const value = cleanText(role).toLowerCase();
  if (value === "hr") return "الموارد البشرية";
  if (value === "admin") return "الإدارة";
  if (value === "reception") return "الاستقبال";
  return "موظف";
}

export default function RecruitmentApplicationsPage({ session }: Props) {
  const [items, setItems] = useState<RecruitmentApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [hirePassword, setHirePassword] = useState(makeTempPassword());
  const [hireRole, setHireRole] = useState<StaffCreateRole>("staff");
  const [hireEmployeeId, setHireEmployeeId] = useState("");
  const [hireDepartment, setHireDepartment] = useState("");
  const [hireTitle, setHireTitle] = useState("");
  const [hireAvatarUrl, setHireAvatarUrl] = useState("");
  const [hireSpecialties, setHireSpecialties] = useState("");

  const [newApp, setNewApp] = useState({
    fullName: "",
    email: "",
    phone: "",
    roleApplied: "staff",
    notes: "",
    message: "",
  });

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || items[0] || null,
    [items, selectedId]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);

    listRecruitmentApplications()
      .then((rows) => {
        if (!alive) return;
        setItems(rows);
        setSelectedId((current) => current || rows[0]?.id || "");
      })
      .catch((e) => {
        if (!alive) return;
        setMessage(cleanText((e as any)?.message || "تعذر تحميل الطلبات."));
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setHirePassword((current) => current || makeTempPassword());
    setHireEmployeeId("");
    setHireDepartment("");
    setHireTitle("");
    setHireAvatarUrl("");
    setHireSpecialties("");
    const normalizedRole: StaffCreateRole =
      selected.roleApplied === "hr" ||
      selected.roleApplied === "admin" ||
      selected.roleApplied === "reception"
        ? selected.roleApplied
        : "staff";
    setHireRole(normalizedRole);
  }, [selected]);

  const reload = async () => {
    setLoading(true);
    try {
      const rows = await listRecruitmentApplications();
      setItems(rows);
      if (!selectedId && rows[0]?.id) setSelectedId(rows[0].id);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateApplication = async () => {
    const fullName = cleanText(newApp.fullName);
    const email = cleanText(newApp.email).toLowerCase();
    if (!fullName || !email || !email.includes("@")) {
      setMessage("الاسم والبريد الإلكتروني مطلوبان.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await createRecruitmentApplication({
        fullName,
        email,
        phone: newApp.phone,
        roleApplied: newApp.roleApplied,
        notes: newApp.notes,
        message: newApp.message,
        status: "new",
        source: "manual",
      });
      setNewApp({ fullName: "", email: "", phone: "", roleApplied: "staff", notes: "", message: "" });
      await reload();
      setMessage("تم حفظ الطلب بنجاح.");
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "تعذر حفظ الطلب."));
    } finally {
      setSaving(false);
    }
  };

  const handleStatus = async (status: RecruitmentApplication["status"]) => {
    if (!selected) return;
    setSaving(true);
    setMessage("");
    try {
      await updateRecruitmentApplication(selected.id, {
        status,
        reviewedByUid: session.uid,
        reviewedAt: new Date().toISOString(),
      });
      await reload();
      setMessage(`تم تحديث حالة الطلب إلى ${statusLabel(status)}.`);
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "تعذر تحديث الطلب."));
    } finally {
      setSaving(false);
    }
  };

  const handleHire = async () => {
    if (!selected) return;
    if (!selected.email) {
      setMessage("الطلب المحدد لا يحتوي على بريد إلكتروني.");
      return;
    }

    if (!hirePassword || hirePassword.length < 6) {
      setMessage("كلمة المرور يجب أن تكون 6 أحرف على الأقل.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const result = await adminCreateStaffUser({
        email: selected.email,
        password: hirePassword,
        displayName: selected.fullName || selected.email,
        phone: selected.phone || "",
        role: hireRole,
        employeeId: cleanText(hireEmployeeId),
        department: cleanText(hireDepartment),
        title: cleanText(hireTitle),
        avatarUrl: cleanText(hireAvatarUrl),
        specialties: hireSpecialties
          ? hireSpecialties.split(",").map((x) => cleanText(x)).filter(Boolean)
          : [],
        bio: selected.notes || selected.message || "",
      });

      await updateRecruitmentApplication(selected.id, {
        status: "accepted",
        reviewedByUid: session.uid,
        reviewedAt: new Date().toISOString(),
      });

      await reload();
      const createdIdentity =
        result.employeeId && result.employeeId !== result.uid
          ? `${result.uid} / ${result.employeeId}`
          : result.uid;
      setMessage(`تم إنشاء حساب الموظف: ${result.displayName} (${createdIdentity}).`);
      setHirePassword(makeTempPassword());
      setHireEmployeeId("");
      setHireDepartment("");
      setHireTitle("");
      setHireAvatarUrl("");
      setHireSpecialties("");
    } catch (e) {
      setMessage(cleanText((e as any)?.message || "تعذر إنشاء حساب الموظف."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hr-page">
      <section className="hr-card">
        <div className="hr-card-head">
          <div>
            <h2>طلبات التوظيف</h2>
            <p>راجع المرشحين الجدد ثم حوّل المناسب منهم إلى حسابات موظفين داخلية.</p>
          </div>
          <button className="hr-button hr-button--ghost" type="button" onClick={() => void reload()} disabled={loading || saving}>
            {loading ? "جارٍ التحديث..." : "تحديث"}
          </button>
        </div>

        {message ? <div className="hr-alert">{message}</div> : null}
        {loading ? <div className="hr-muted">جارٍ تحميل الطلبات...</div> : null}

        <div className="hr-form-grid">
          <label className="hr-field">
            <span>الاسم الكامل</span>
            <input
              value={newApp.fullName}
              onChange={(e) => setNewApp((p) => ({ ...p, fullName: e.target.value }))}
              placeholder="اسم المرشح"
            />
          </label>
          <label className="hr-field">
            <span>البريد الإلكتروني</span>
            <input
              value={newApp.email}
              onChange={(e) => setNewApp((p) => ({ ...p, email: e.target.value }))}
              placeholder="name@example.com"
            />
          </label>
          <label className="hr-field">
            <span>رقم الجوال</span>
            <input
              value={newApp.phone}
              onChange={(e) => setNewApp((p) => ({ ...p, phone: e.target.value }))}
              placeholder="+966..."
            />
          </label>
          <label className="hr-field">
            <span>الوظيفة المتقدم لها</span>
            <select
              value={newApp.roleApplied}
              onChange={(e) => setNewApp((p) => ({ ...p, roleApplied: e.target.value }))}
            >
              <option value="staff">موظف</option>
              <option value="hr">الموارد البشرية</option>
              <option value="reception">الاستقبال</option>
              <option value="admin">الإدارة</option>
            </select>
          </label>
          <label className="hr-field hr-field--wide">
            <span>ملاحظات</span>
            <textarea
              rows={3}
              value={newApp.notes}
              onChange={(e) => setNewApp((p) => ({ ...p, notes: e.target.value }))}
              placeholder="ملاحظات المقابلة"
            />
          </label>
          <label className="hr-field hr-field--wide">
            <span>رسالة المرشح</span>
            <textarea
              rows={3}
              value={newApp.message}
              onChange={(e) => setNewApp((p) => ({ ...p, message: e.target.value }))}
              placeholder="رسالة المتقدم"
            />
          </label>
        </div>

        <div className="hr-actions">
          <button className="hr-button hr-button--accent" type="button" onClick={() => void handleCreateApplication()} disabled={saving}>
            حفظ الطلب
          </button>
        </div>
      </section>

      <div className="hr-grid">
        <section className="hr-card">
          <div className="hr-card-head">
            <div>
              <h3>الطلبات</h3>
              <p>{items.length} سجل</p>
            </div>
          </div>

          <div className="hr-list">
            {items.map((app) => (
              <button
                key={app.id}
                type="button"
                className={`hr-list-item ${selected?.id === app.id ? "is-active" : ""}`}
                onClick={() => setSelectedId(app.id)}
              >
                <strong>{app.fullName}</strong>
                <span>{app.email}</span>
                <small>
                  {statusLabel(app.status)} | {roleLabel(app.roleApplied)}
                </small>
              </button>
            ))}
            {!items.length ? <div className="hr-muted">لا توجد طلبات بعد.</div> : null}
          </div>
        </section>

        <section className="hr-card">
          {selected ? (
            <>
              <div className="hr-card-head">
                <div>
                  <h3>الطلب المحدد</h3>
                  <p>{selected.fullName}</p>
                </div>
              </div>

              <div className="hr-detail-grid">
                <div className="hr-detail-card">
                  <span>البريد</span>
                  <strong>{selected.email}</strong>
                </div>
                <div className="hr-detail-card">
                  <span>الجوال</span>
                  <strong>{selected.phone || "—"}</strong>
                </div>
                <div className="hr-detail-card">
                  <span>الوظيفة</span>
                  <strong>{roleLabel(selected.roleApplied || "staff")}</strong>
                </div>
                <div className="hr-detail-card">
                  <span>الحالة</span>
                  <strong>{statusLabel(selected.status)}</strong>
                </div>
              </div>

              <div className="hr-copy">{selected.notes || selected.message || "لا توجد ملاحظات إضافية."}</div>

              <div className="hr-form-grid">
                <label className="hr-field">
                  <span>رقم الموظف</span>
                  <input
                    value={hireEmployeeId}
                    onChange={(e) => setHireEmployeeId(e.target.value)}
                    placeholder="يُترك فارغًا ليستخدم UID"
                  />
                </label>
                <label className="hr-field">
                  <span>القسم</span>
                  <input
                    value={hireDepartment}
                    onChange={(e) => setHireDepartment(e.target.value)}
                    placeholder="مثال: الفرع الرئيسي"
                  />
                </label>
                <label className="hr-field">
                  <span>المسمى الوظيفي</span>
                  <input
                    value={hireTitle}
                    onChange={(e) => setHireTitle(e.target.value)}
                    placeholder="مثال: أخصائية شعر"
                  />
                </label>
                <label className="hr-field hr-field--wide">
                  <span>رابط الصورة</span>
                  <input
                    value={hireAvatarUrl}
                    onChange={(e) => setHireAvatarUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </label>
                <label className="hr-field hr-field--wide">
                  <span>كلمة المرور المؤقتة</span>
                  <input value={hirePassword} onChange={(e) => setHirePassword(e.target.value)} />
                </label>
                <label className="hr-field">
                  <span>دور التعيين</span>
                  <select value={hireRole} onChange={(e) => setHireRole(e.target.value as StaffCreateRole)} id="hire-role">
                    <option value="staff">موظف</option>
                    <option value="hr">الموارد البشرية</option>
                    <option value="reception">الاستقبال</option>
                    <option value="admin">الإدارة</option>
                  </select>
                </label>
                <label className="hr-field hr-field--wide">
                  <span>التخصصات</span>
                  <input
                    value={hireSpecialties}
                    onChange={(e) => setHireSpecialties(e.target.value)}
                    placeholder="hair, color, nails"
                  />
                </label>
              </div>

              <div className="hr-actions">
                <button className="hr-button hr-button--ghost" type="button" onClick={() => void handleStatus("reviewing")} disabled={saving}>
                  قيد المراجعة
                </button>
                <button className="hr-button hr-button--ghost" type="button" onClick={() => void handleStatus("rejected")} disabled={saving}>
                  رفض الطلب
                </button>
                <button className="hr-button hr-button--accent" type="button" onClick={() => void handleHire()} disabled={saving}>
                  إنشاء حساب موظف
                </button>
              </div>
            </>
          ) : (
            <div className="hr-muted">اختر طلبًا لعرض التفاصيل.</div>
          )}
        </section>
      </div>
    </div>
  );
}
