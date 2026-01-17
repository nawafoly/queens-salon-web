// src/pages/DashboardEmployees.tsx
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
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import "../styles/DashboardEmployees.css";

// ✅ Bookings stats (Owner only)
import {
  listAllBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";

/* =========================
   Types
========================= */
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
  specialties: string[];
  bio?: string;
  avatarUrl?: string;

  // ✅ NEW: link staff_public -> real Firebase Auth uid (for Staff Portal + strict rules)
  linkedUid?: string;

  createdAt?: any;
  updatedAt?: any;
};

type StaffPublicUi = StaffPublicDoc & { id: string };

/* =========================
   Const
========================= */
const SALON_ID = "main";

const SPECIALTY_OPTIONS: { key: string; label: string }[] = [
  { key: "hair", label: "الشعر" },
  { key: "coloring", label: "الصبغات" },
  { key: "makeup", label: "المكياج" },
  { key: "nails", label: "الأظافر" },
  { key: "waxing", label: "الشمع" },
];

/* =========================
   Helpers
========================= */
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
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

// ✅ Normalize Arabic names for strict matching (fallback)
function normalizeArabicName(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

type StaffBookingStats = {
  total: number;
  byStatus: Record<BookingStatus, number>;
};

/* =========================
   Component
========================= */
export default function DashboardEmployees() {
  const authUser = useMemo(() => getAuthUser(), []);
  const canManage =
    authUser?.role === "owner" ||
    authUser?.role === "admin" ||
    authUser?.role === "reception";

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<StaffPublicUi[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // ✅ Owner-only booking stats per staff_public doc
  const [statsLoading, setStatsLoading] = useState(false);
  const [bookingStats, setBookingStats] = useState<Record<string, StaffBookingStats>>(
    {}
  );

  // Filters
  const [qText, setQText] = useState("");
  const [onlyActive, setOnlyActive] = useState<"all" | "active" | "inactive">("all");
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  // Modal
  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Form
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [active, setActive] = useState(true);
  const [specialties, setSpecialties] = useState<string[]>([]);

  // ✅ NEW
  const [linkedUid, setLinkedUid] = useState("");

  const resetForm = () => {
    setEditId(null);
    setName("");
    setBio("");
    setAvatarUrl("");
    setActive(true);
    setSpecialties([]);
    setLinkedUid(""); // ✅ NEW
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

    // ✅ NEW
    setLinkedUid(String((x as any)?.linkedUid ?? "").trim());

    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    resetForm();
  };

  /* =========================
     CRUD
  ========================= */
  const load = async () => {
    setLoading(true);
    setErrorMsg("");

    try {
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

          // ✅ NEW
          linkedUid: String(data?.linkedUid ?? "").trim(),

          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        };
      });

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

  // ✅ Owner-only: compute booking counts per staff_public doc
  useEffect(() => {
    let alive = true;

    const compute = async () => {
      // ✅ حسب الاتفاق: الإحصائيات للـ Owner فقط
      if (authUser?.role !== "owner") {
        setBookingStats({});
        return;
      }

      if (!list.length) {
        setBookingStats({});
        return;
      }

      setStatsLoading(true);

      try {
        const staffById = new Set(list.map((s) => s.id));

        const staffIdByName = new Map<string, string>();
        for (const s of list) {
          const k = normalizeArabicName(s.name);
          if (k) staffIdByName.set(k, s.id);
        }

        const rows: BookingDocWithId[] = await listAllBookings();

        const initStats = (): StaffBookingStats => ({
          total: 0,
          byStatus: { pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
        });

        const m: Record<string, StaffBookingStats> = {};

        for (const b of rows) {
          const eid = String((b as any).employeeId || "").trim();
          const ename = String((b as any).employeeName || "").trim();

          // 1) match by employeeId (staff_public.id)
          let staffId: string | null = null;
          if (eid && staffById.has(eid)) staffId = eid;

          // 2) fallback strict name match after normalization
          if (!staffId && ename) {
            const k = normalizeArabicName(ename);
            staffId = staffIdByName.get(k) || null;
          }

          if (!staffId) continue;

          if (!m[staffId]) m[staffId] = initStats();

          const st = (b.status || "pending") as BookingStatus;
          m[staffId].total += 1;
          m[staffId].byStatus[st] = (m[staffId].byStatus[st] || 0) + 1;
        }

        if (alive) setBookingStats(m);
      } catch (e) {
        console.warn("booking stats error:", e);
        if (alive) setBookingStats({});
      } finally {
        if (alive) setStatsLoading(false);
      }
    };

    compute();

    return () => {
      alive = false;
    };
  }, [authUser?.role, list]);

  const toggleSpecialty = (key: string) => {
    setSpecialties((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
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
      specialties,
      bio: bio.trim(),
      avatarUrl: avatarUrl.trim(),

      // ✅ NEW
      linkedUid: linkedUid.trim() || undefined,

      updatedAt: serverTimestamp(),
    };

    try {
      if (!editId) {
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
    if (!confirm("متأكد حذف الموظفة؟")) return;

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

    if (onlyActive === "active") rows = rows.filter((x) => x.active);
    if (onlyActive === "inactive") rows = rows.filter((x) => !x.active);

    if (specialtyFilter !== "all") {
      rows = rows.filter((x) =>
        normalizeSpecialties(x.specialties).includes(specialtyFilter)
      );
    }

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

  /* =========================
     Guards
  ========================= */
  if (!authUser) {
    return (
      <div className="dashboard-page employees-page">
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
      <div className="dashboard-page employees-page">
        <div className="container">
          <div className="dash-card">
            <h3>صلاحيات غير كافية</h3>
            <p>هذه الصفحة للإدارة فقط.</p>
          </div>
        </div>
      </div>
    );
  }

  /* =========================
     Render
  ========================= */
  return (
    <div className="dashboard-page employees-page">
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

            <button
              className="exp-btn primary"
              onClick={openCreate}
              disabled={loading}
              type="button"
            >
              <FontAwesomeIcon icon={faPlus} /> إضافة موظفة
            </button>
          </div>
        </div>

        {errorMsg && <div className="dash-alert">{errorMsg}</div>}

        {/* Filters */}
        <div className="dash-card">
          <div className="dash-row emp-filters">
            <input
              className="dash-input emp-input"
              placeholder="بحث بالاسم أو النبذة..."
              value={qText}
              onChange={(e) => setQText(e.target.value)}
            />

            <select
              className="dash-select emp-input"
              value={onlyActive}
              onChange={(e) => setOnlyActive(e.target.value as any)}
            >
              <option value="all">كل الحالات</option>
              <option value="active">نشطة</option>
              <option value="inactive">غير نشطة</option>
            </select>

            <select
              className="dash-select emp-input"
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
            {authUser.role === "owner" && (
              <>
                {" "}
                • إحصائيات الحجوزات: <b>{statsLoading ? "..." : "جاهزة"}</b>
              </>
            )}
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
                    <button
                      className="exp-btn ghost"
                      onClick={() => openEdit(x)}
                      type="button"
                    >
                      <FontAwesomeIcon icon={faPen} /> تعديل
                    </button>
                    <button
                      className="exp-btn danger"
                      onClick={() => remove(x.id)}
                      type="button"
                    >
                      <FontAwesomeIcon icon={faTrash} /> حذف
                    </button>
                  </div>
                </div>

                {x.avatarUrl ? (
                  <div className="staff-avatar">
                    <img
                      src={x.avatarUrl}
                      alt={x.name}
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                ) : null}

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

                {/* ✅ NEW: show link status */}
                <div className="emp-stats" style={{ marginTop: 10 }}>
                  <div className="emp-stats-row">
                    <span className="staff-pill" style={{ background: "rgba(0,0,0,0.04)" }}>
                      UID مربوط:
                      <b style={{ marginInlineStart: 6 }} dir="ltr">
                        {String((x as any)?.linkedUid || "").trim() ? "نعم" : "لا"}
                      </b>
                    </span>
                  </div>
                  <div className="emp-stats-hint">
                    * ربط UID ضروري لظهور حجوزات الموظفة في لوحة الموظفة (Staff Portal).
                  </div>
                </div>

                {/* ✅ Owner-only booking stats */}
                {authUser?.role === "owner" && (
                  <div className="emp-stats">
                    <div className="emp-stats-row">
                      <span className="staff-pill" style={{ background: "rgba(0,0,0,0.04)" }}>
                        الحجوزات:
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.total ?? 0)}
                        </b>
                      </span>

                      <span className="staff-pill" style={{ background: "rgba(16, 185, 129, 0.10)" }}>
                        مؤكد:
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.byStatus.confirmed ?? 0)}
                        </b>
                      </span>

                      <span className="staff-pill" style={{ background: "rgba(245, 158, 11, 0.12)" }}>
                        انتظار:
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.byStatus.pending ?? 0)}
                        </b>
                      </span>

                      <span className="staff-pill" style={{ background: "rgba(99, 102, 241, 0.10)" }}>
                        مكتمل:
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.byStatus.completed ?? 0)}
                        </b>
                      </span>

                      <span className="staff-pill" style={{ background: "rgba(239, 68, 68, 0.10)" }}>
                        ملغي:
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.byStatus.cancelled ?? 0)}
                        </b>
                      </span>
                    </div>

                    <div className="emp-stats-hint">
                      * تُحسب الإحصائيات عبر (employeeId) إن تطابق، وإلا مطابقة الاسم بعد التطبيع.
                    </div>
                  </div>
                )}

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
                  <FontAwesomeIcon icon={faXmark} /> إغلاق
                </button>
              </div>

              <div className="modal-body">
                <div className="dash-row">
                  <div className="dash-field">
                    <label>اسم الموظفة</label>
                    <input
                      className="dash-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="مثال: حنان"
                    />
                  </div>

                  <div className="dash-field">
                    <label>الحالة</label>
                    <select
                      className="dash-select"
                      value={active ? "1" : "0"}
                      onChange={(e) => setActive(e.target.value === "1")}
                    >
                      <option value="1">نشطة</option>
                      <option value="0">غير نشطة</option>
                    </select>
                  </div>
                </div>

                <div className="dash-field">
                  <label>نبذة تظهر للزبائن</label>
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
                    dir="ltr"
                  />
                </div>

                {/* ✅ NEW: linkedUid field */}
                <div className="dash-field">
                  <label>UID حساب الموظفة (للربط مع لوحة الموظفة)</label>
                  <input
                    className="dash-input"
                    value={linkedUid}
                    onChange={(e) => setLinkedUid(e.target.value)}
                    placeholder="مثال: vzshxghsaHb5GI7cWgDTfZ5b6g13"
                    dir="ltr"
                  />
                  <div style={{ marginTop: 6, color: "#666", fontSize: 12 }}>
                    هذا لازم يكون UID الحقيقي من Firebase Auth، وليس ID الخاص بـ staff_public.
                  </div>
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
