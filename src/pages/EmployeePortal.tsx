// ✅ src/pages/DashboardEmployees.tsx
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faPen,
  faTrash,
  faRotateRight,
  faToggleOn,
  faToggleOff,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import "../styles/EmployeePortal.css";
import "../styles/DashboardModals.css";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

type AuthUser = {
  uid: string;
  email: string;
  role: UiRole;
  displayName?: string;
};

type StaffPublicDoc = {
  name: string;
  active: boolean;
  specialties: string[]; // مثال: ["hair","coloring"]
  bio?: string;          // نبذة تظهر للزبائن
  avatarUrl?: string;    // صورة (اختياري)
  createdAt?: any;
  updatedAt?: any;
};

type StaffPublicUi = StaffPublicDoc & { id: string };

const SALON_ID = "main";

const SPECIALTY_OPTIONS: { key: string; label: string }[] = [
  { key: "hair", label: "الشعر" },
  { key: "coloring", label: "الصبغات" },
  { key: "makeup", label: "المكياج" },
  { key: "nails", label: "الأظافر" },
  { key: "waxing", label: "الشمع" },
];

function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function staffPublicCol() {
  return collection(db, "salons", SALON_ID, "staff_public");
}

function staffPublicDoc(id: string) {
  return doc(db, "salons", SALON_ID, "staff_public", id);
}

function normalizeSpecialties(v: any): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

export default function DashboardEmployees() {
  const authUser = useMemo(() => getAuthUser(), []);
  const canManage =
    authUser?.role === "owner" || authUser?.role === "admin" || authUser?.role === "reception";

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<StaffPublicUi[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // Filters
  const [qText, setQText] = useState("");
  const [onlyActive, setOnlyActive] = useState<"all" | "active" | "inactive">("all");
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  // Modal state
  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [active, setActive] = useState(true);
  const [specialties, setSpecialties] = useState<string[]>([]);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setBio("");
    setAvatarUrl("");
    setActive(true);
    setSpecialties([]);
  };

  const openCreate = () => {
    resetForm();
    setIsOpen(true);
  };

  const openEdit = (x: StaffPublicUi) => {
    setEditId(x.id);
    setName(x.name ?? "");
    setBio(x.bio ?? "");
    setAvatarUrl(x.avatarUrl ?? "");
    setActive(!!x.active);
    setSpecialties(normalizeSpecialties(x.specialties));
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    resetForm();
  };

  const load = async () => {
    setLoading(true);
    setErrorMsg("");

    try {
      // ✅ بدون where+orderBy لتفادي مشكلة index
      const snap = await getDocs(staffPublicCol());

      const rows: StaffPublicUi[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data?.name ?? "",
          active: !!data?.active,
          specialties: normalizeSpecialties(data?.specialties),
          bio: data?.bio ?? "",
          avatarUrl: data?.avatarUrl ?? "",
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        };
      });

      // ✅ ترتيب محلي بالاسم
      rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));

      setList(rows);
    } catch (e) {
      console.warn("load staff_public error:", e);
      setErrorMsg("تعذر تحميل الموظفات");
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSpecialty = (key: string) => {
    setSpecialties((prev) => {
      if (prev.includes(key)) return prev.filter((x) => x !== key);
      return [...prev, key];
    });
  };

  const save = async () => {
    if (!canManage) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setErrorMsg("اكتب اسم الموظفة");
      return;
    }
    if (specialties.length === 0) {
      setErrorMsg("اختَر خدمة واحدة على الأقل");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    const payload: StaffPublicDoc = {
      name: cleanName,
      active: !!active,
      specialties: specialties,
      bio: bio.trim(),
      avatarUrl: avatarUrl.trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      if (!editId) {
        // ✅ إنشاء: نجعل الـ id تلقائي (أو تقدر تسميه بنفسك)
        const id = cleanName
          .replace(/\s+/g, "_")
          .replace(/[^\w\u0600-\u06FF_]/g, "")
          .slice(0, 40);

        await setDoc(staffPublicDoc(id || crypto.randomUUID()), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(staffPublicDoc(editId), payload as any);
      }

      closeModal();
      await load();
    } catch (e) {
      console.warn("save staff_public error:", e);
      setErrorMsg("تعذر حفظ الموظفة");
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!canManage) return;
    const ok = confirm("متأكد حذف الموظفة؟");
    if (!ok) return;

    setLoading(true);
    setErrorMsg("");

    try {
      await deleteDoc(staffPublicDoc(id));
      await load();
    } catch (e) {
      console.warn("delete staff_public error:", e);
      setErrorMsg("تعذر حذف الموظفة");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    let rows = [...list];

    // active filter
    if (onlyActive === "active") rows = rows.filter((x) => x.active);
    if (onlyActive === "inactive") rows = rows.filter((x) => !x.active);

    // specialty filter
    if (specialtyFilter !== "all") {
      rows = rows.filter((x) => normalizeSpecialties(x.specialties).includes(specialtyFilter));
    }

    // search
    const t = qText.trim().toLowerCase();
    if (t) {
      rows = rows.filter((x) => {
        const n = (x.name || "").toLowerCase();
        const b = (x.bio || "").toLowerCase();
        return n.includes(t) || b.includes(t);
      });
    }

    return rows;
  }, [list, onlyActive, specialtyFilter, qText]);

  // ✅ حماية بسيطة
  if (!authUser) {
    return (
      <div className="dashboard-page">
        <div className="container">
          <div className="dash-card">
            <h3>غير مصرح</h3>
            <p>سجّل دخول ثم جرّب.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="dashboard-page">
        <div className="container">
          <div className="dash-card">
            <h3>صلاحيات غير كافية</h3>
            <p>هذه الصفحة للإدارة فقط.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="container">
        <div className="dash-topbar dash-topbar--sticky">
          <div className="dash-topbar-title">
            <h2>
              <FontAwesomeIcon icon={faUserTie} /> إدارة الموظفات
            </h2>
            <p className="dash-sub">
              المصدر: <b>salons/main/staff_public</b>
            </p>
          </div>

          <div className="dash-topbar-actions">
            <button className="exp-btn" onClick={load} disabled={loading} type="button">
              <FontAwesomeIcon icon={faRotateRight} /> تحديث
            </button>

            <button className="exp-btn primary" onClick={openCreate} disabled={loading} type="button">
              <FontAwesomeIcon icon={faPlus} /> إضافة موظفة
            </button>
          </div>
        </div>

        {errorMsg && <div className="dash-alert">{errorMsg}</div>}

        {/* Filters */}
        <div className="dash-card">
          <div className="dash-row">
            <input
              className="dash-input"
              placeholder="بحث بالاسم أو النبذة..."
              value={qText}
              onChange={(e) => setQText(e.target.value)}
            />

            <select
              className="dash-select"
              value={onlyActive}
              onChange={(e) => setOnlyActive(e.target.value as any)}
            >
              <option value="all">كل الحالات</option>
              <option value="active">نشطة</option>
              <option value="inactive">غير نشطة</option>
            </select>

            <select
              className="dash-select"
              value={specialtyFilter}
              onChange={(e) => setSpecialtyFilter(e.target.value)}
            >
              <option value="all">كل الخدمات</option>
              {SPECIALTY_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="dash-meta">
            المعروض: <b>{filtered.length}</b> • الإجمالي: <b>{list.length}</b>
          </div>
        </div>

        {/* List */}
        <div className="dash-grid">
          {loading && <div className="dash-card">جاري التحميل…</div>}

          {!loading && filtered.length === 0 && (
            <div className="dash-card">لا توجد موظفات حسب الفلاتر الحالية.</div>
          )}

          {!loading &&
            filtered.map((x) => (
              <div className="dash-card staff-card" key={x.id}>
                <div className="staff-top">
                  <div className="staff-name">
                    <b>{x.name}</b>
                    <span className={`staff-pill ${x.active ? "on" : "off"}`}>
                      <FontAwesomeIcon icon={x.active ? faToggleOn : faToggleOff} />{" "}
                      {x.active ? "نشطة" : "غير نشطة"}
                    </span>
                  </div>

                  <div className="staff-actions">
                    <button className="exp-btn ghost" onClick={() => openEdit(x)} type="button">
                      <FontAwesomeIcon icon={faPen} /> تعديل
                    </button>
                    <button className="exp-btn danger" onClick={() => remove(x.id)} type="button">
                      <FontAwesomeIcon icon={faTrash} /> حذف
                    </button>
                  </div>
                </div>

                {x.bio ? <div className="staff-bio">{x.bio}</div> : <div className="staff-bio muted">بدون نبذة</div>}

                <div className="staff-chips">
                  {normalizeSpecialties(x.specialties).map((s) => {
                    const label = SPECIALTY_OPTIONS.find((o) => o.key === s)?.label ?? s;
                    return (
                      <span className="staff-chip" key={s}>
                        {label}
                      </span>
                    );
                  })}
                </div>

                <div className="staff-id">ID: {x.id}</div>
              </div>
            ))}
        </div>

        {/* Modal */}
        {isOpen && (
          <div className="modal-overlay" onClick={closeModal}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <b>{editId ? "تعديل موظفة" : "إضافة موظفة"}</b>
                <button className="exp-btn ghost" onClick={closeModal} type="button">
                  إغلاق
                </button>
              </div>

              <div className="modal-body">
                <div className="dash-row">
                  <div className="dash-field">
                    <label>اسم الموظفة</label>
                    <input className="dash-input" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>

                  <div className="dash-field">
                    <label>الحالة</label>
                    <select className="dash-select" value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
                      <option value="1">نشطة</option>
                      <option value="0">غير نشطة</option>
                    </select>
                  </div>
                </div>

                <div className="dash-field">
                  <label>نبذة تظهر للزبائن (About/Booking)</label>
                  <textarea
                    className="dash-textarea"
                    rows={3}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="مثال: خبيرة شعر وصبغات بخبرة 8 سنوات..."
                  />
                </div>

                <div className="dash-field">
                  <label>رابط الصورة (اختياري)</label>
                  <input
                    className="dash-input"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://..."
                  />
                </div>

                <div className="dash-field">
                  <label>الخدمات (اختيار متعدد)</label>
                  <div className="staff-picks">
                    {SPECIALTY_OPTIONS.map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        className={`pick ${specialties.includes(o.key) ? "on" : ""}`}
                        onClick={() => toggleSpecialty(o.key)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-foot">
                <button className="exp-btn" onClick={closeModal} type="button">
                  إلغاء
                </button>
                <button className="exp-btn primary" onClick={save} disabled={loading} type="button">
                  حفظ
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
