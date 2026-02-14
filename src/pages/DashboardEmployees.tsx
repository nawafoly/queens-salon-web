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
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faPen,
  faTrash,
  faRotateRight,
  faUserTie,
  faXmark,
  faToggleOn,
  faToggleOff,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import "../styles/DashboardEmployees.css";
import Modal from "../components/Modal";

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

  // ✅ جديد: هل تظهر في صفحة About؟
  showOnAbout: boolean;
  // ✅ جديد: هل تظهر في الحجز؟
  showOnBooking: boolean;

  specialties: string[];
  bio?: string;
  avatarUrl?: string;
  cvUrl?: string;
  createdAt?: any;
  updatedAt?: any;
};

type StaffPublicUi = StaffPublicDoc & { id: string };

type ServiceOption = {
  id: string; // serviceId
  label: string; // service name
  sectionId?: string;
  categoryId?: string;
  active?: boolean;
};

/* =========================
   Const
========================= */
const SALON_ID = "main";

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

function servicesCol() {
  return collection(db, "salons", SALON_ID, "services");
}

function normalizeSpecialties(v: any): string[] {
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function safeKey(s: string) {
  return String(s || "")
    .trim()
    .replaceAll("/", "-")
    .replace(/\s+/g, "_");
}

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

  const [statsLoading, setStatsLoading] = useState(false);
  const [bookingStats, setBookingStats] =
    useState<Record<string, StaffBookingStats>>({});

  const [qText, setQText] = useState("");
  const [onlyActive, setOnlyActive] =
    useState<"all" | "active" | "inactive">("all");

  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cvUrl, setCvUrl] = useState("");

  const [active, setActive] = useState(true);

  // ✅ جديد
  const [showOnAbout, setShowOnAbout] = useState(true);
  const [showOnBooking, setShowOnBooking] = useState(true);

  const [specialties, setSpecialties] = useState<string[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);

  const [srvQ, setSrvQ] = useState("");
  const [srvSection, setSrvSection] = useState<string>("all");

  const resetForm = () => {
    setEditId(null);
    setName("");
    setBio("");
    setAvatarUrl("");
    setCvUrl("");
    setActive(true);

    // ✅ جديد
    setShowOnAbout(true);
    setShowOnBooking(true);

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
    setCvUrl((x as any).cvUrl ?? "");
    setActive(!!x.active);
    setShowOnBooking((x as any).showOnBooking !== false);

    // ✅ جديد
    setShowOnAbout((x as any).showOnAbout !== false);

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
      const snap = await getDocs(staffPublicCol());
      const rows = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data?.name ?? "",
          active: !!data?.active,

          // ✅ جديد (افتراضي: تظهر إذا ما كان الحقل موجود)
          showOnAbout: data?.showOnAbout !== false,
          showOnBooking: data?.showOnBooking !== false,

          specialties: normalizeSpecialties(data?.specialties),
          bio: data?.bio ?? "",
          avatarUrl: data?.avatarUrl ?? "",
          cvUrl: data?.cvUrl ?? "",
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        } as StaffPublicUi;
      });
      rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
      setList(rows);
    } catch {
      setErrorMsg("تعذر تحميل الموظفات");
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  const loadServiceOptions = async () => {
    try {
      const qSrv = query(servicesCol(), orderBy("name", "asc"));
      const snap = await getDocs(qSrv);

      const opts: ServiceOption[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            label: String(x?.name || d.id),
            sectionId: String(x?.sectionId || ""),
            categoryId: String(x?.categoryId || ""),
            active: x?.active !== false,
          };
        })
        .filter((s) => s.label.trim())
        .filter((s) => s.active !== false);

      setServiceOptions(opts);
    } catch (e) {
      console.warn("loadServiceOptions error:", e);
      setServiceOptions([]);
    }
  };

  // ✅ Original logic for fixing bookings
  const fixBookingsEmployeeUid = async () => {
    if (!canManage) return;
    const ok = confirm(
      "سيتم إصلاح الحجوزات القديمة بإضافة employeeUid/employeeKey. هل تريد المتابعة؟"
    );
    if (!ok) return;
    setLoading(true);
    try {
      const staffSnap = await getDocs(staffPublicCol());
      const uidByEmployeeId = new Map<string, string>();
      staffSnap.docs.forEach((d) => {
        const data: any = d.data();
        const linkedUid = String(data?.linkedUid || "").trim();
        if (linkedUid) uidByEmployeeId.set(d.id, linkedUid);
      });
      const bookingsRef = collection(db, "salons", SALON_ID, "bookings");
      const bSnap = await getDocs(bookingsRef);
      let batch = writeBatch(db);
      let batchCount = 0;
      for (const d of bSnap.docs) {
        const b: any = d.data();
        const employeeUid = String(b?.employeeUid || "").trim();
        const employeeId = String(b?.employeeId || "").trim();
        if (employeeUid || !employeeId) continue;
        const linkedUid = uidByEmployeeId.get(employeeId) || "";
        if (!linkedUid) continue;
        batch.update(doc(db, "salons", SALON_ID, "bookings", d.id), {
          employeeUid: linkedUid,
          employeeKey: linkedUid,
          updatedAt: serverTimestamp(),
        });
        batchCount++;
        if (batchCount >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
      await batch.commit();
      alert("✅ تم إصلاح الحجوزات");
    } catch (e) {
      console.warn(e);
      setErrorMsg("خطأ في الإصلاح");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Toggle Active (نشط/غير نشط)
  const toggleActiveQuick = async (x: StaffPublicUi) => {
    if (!canManage) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const next = !x.active;
      await updateDoc(staffPublicDoc(x.id), {
        active: next,
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) => prev.map((r) => (r.id === x.id ? { ...r, active: next } : r)));
    } catch (e) {
      console.warn("toggleActiveQuick error:", e);
      setErrorMsg("تعذر تغيير حالة الموظفة");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Toggle ShowOnAbout (يظهر في About أو لا)
  const toggleShowOnAboutQuick = async (x: StaffPublicUi) => {
    if (!canManage) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const cur = (x as any).showOnAbout !== false;
      const next = !cur;
      await updateDoc(staffPublicDoc(x.id), {
        showOnAbout: next,
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) =>
        prev.map((r) => (r.id === x.id ? { ...r, showOnAbout: next } : r))
      );
    } catch (e) {
      console.warn("toggleShowOnAboutQuick error:", e);
      setErrorMsg("تعذر تغيير ظهور الموظفة في صفحة من نحن");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadServiceOptions();
  }, []);

  useEffect(() => {
    let alive = true;
    const compute = async () => {
      if (authUser?.role !== "owner" || !list.length) {
        setBookingStats({});
        return;
      }
      setStatsLoading(true);
      try {
        const initStats = (): StaffBookingStats => ({
          total: 0,
          byStatus: { pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
        });
        const staffById = new Set(list.map((s) => s.id));
        const staffByKey = new Map<string, string>();
        const staffByName = new Map<string, string>();

        for (const s of list) {
          const sid = String(s.id || "").trim();
          if (sid) staffByKey.set(sid, sid);
          const nKey = normalizeArabicName(s.name);
          if (nKey) staffByName.set(nKey, sid);
          const nk2 = safeKey(String(s.name || "").trim());
          if (nk2) staffByKey.set(nk2, sid);
        }

        const rows: BookingDocWithId[] = await listAllBookings();
        const m: Record<string, StaffBookingStats> = {};

        for (const b of rows) {
          const eid = String((b as any).employeeId || "").trim();
          const euid = String((b as any).employeeUid || "").trim();
          const ekey = String((b as any).employeeKey || "").trim();
          const ename = String((b as any).employeeName || "").trim();

          let staffId: string | null = null;
          if (ekey && staffByKey.has(ekey)) staffId = staffByKey.get(ekey) || null;
          if (!staffId && euid && staffByKey.has(euid))
            staffId = staffByKey.get(euid) || null;
          if (!staffId && eid && staffById.has(eid)) staffId = eid;
          if (!staffId && ename) {
            const k = normalizeArabicName(ename);
            staffId = staffByName.get(k) || null;
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

  const sectionOptions = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    for (const s of serviceOptions) {
      const sid = String(s.sectionId || "").trim();
      if (!sid) continue;
      if (!m.has(sid)) m.set(sid, { id: sid, label: sid });
    }
    return Array.from(m.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "ar")
    );
  }, [serviceOptions]);

  const filteredServicesForPicks = useMemo(() => {
    let rows = [...serviceOptions];
    if (srvSection !== "all") {
      rows = rows.filter((s) => String(s.sectionId || "").trim() === srvSection);
    }
    const q = srvQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) => String(s.label || "").toLowerCase().includes(q));
    }
    rows.sort((a, b) => String(a.label).localeCompare(String(b.label), "ar"));
    return rows;
  }, [serviceOptions, srvSection, srvQ]);

  const toggleSpecialty = (serviceId: string) => {
    setSpecialties((prev) =>
      prev.includes(serviceId) ? prev.filter((x) => x !== serviceId) : [...prev, serviceId]
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
    // ✅ منع "النسيان": موظفة نشطة لكن مخفية من الحجز
    if (active && !showOnBooking) {
      const ok = confirm(
        "⚠️ تنبيه: الموظفة (نشطة) لكن (مخفية من الحجز).\nهل تريد الحفظ بهذا الشكل؟"
      );
      if (!ok) return;
    }


    setLoading(true);
    setErrorMsg("");

    const payload: StaffPublicDoc = {
      name: cleanName,
      active: !!active,
      showOnAbout: !!showOnAbout,
      showOnBooking: !!showOnBooking,
      

      specialties,
      bio: bio.trim(),
      avatarUrl: avatarUrl.trim(),
      cvUrl: cvUrl.trim(),
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
      rows = rows.filter((x) => normalizeSpecialties(x.specialties).includes(specialtyFilter));
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

  if (!authUser) {
    return (
      <div className="emp-page-wrapper">
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
      <div className="emp-page-wrapper">
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
    <div className="emp-page-wrapper">
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
            {authUser?.role === "owner" && (
              <button
                className="exp-btn ghost"
                onClick={fixBookingsEmployeeUid}
                title="إصلاح الحجوزات"
              >
                🔧 إصلاح
              </button>
            )}
            <button
              className="exp-btn"
              onClick={async () => {
                await loadServiceOptions();
                await load();
              }}
              disabled={loading}
              type="button"
            >
              <FontAwesomeIcon icon={faRotateRight} /> تحديث
            </button>
            <button className="exp-btn primary" onClick={openCreate} type="button">
              <FontAwesomeIcon icon={faPlus} /> إضافة موظفة
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="alert alert-danger mt-3" style={{ borderRadius: 14 }}>
            {errorMsg}
          </div>
        )}

        <div className="dash-card mt-3">
          <div className="dash-row">
            <div className="dash-field">
              <label className="emp-label">بحث بالاسم أو النبذة</label>
              <input
                className="dash-input"
                placeholder="ابحث هنا..."
                value={qText}
                onChange={(e) => setQText(e.target.value)}
              />
            </div>

            <div className="dash-field">
              <label className="emp-label">تصفية بالخدمة</label>
              <select
                className="dash-select"
                value={specialtyFilter}
                onChange={(e) => setSpecialtyFilter(e.target.value)}
              >
                <option value="all">كل الخدمات</option>
                {serviceOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="dash-field">
              <label className="emp-label">الحالة</label>
              <select
                className="dash-select"
                value={onlyActive}
                onChange={(e) => setOnlyActive(e.target.value as any)}
              >
                <option value="all">الكل</option>
                <option value="active">نشطة فقط</option>
                <option value="inactive">غير نشطة</option>
              </select>
            </div>
          </div>
        </div>

        <div className="dash-grid">
          {filtered.map((x) => (
            <div key={x.id} className="staff-card">
              <div className="staff-top">
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: "rgba(64, 1, 13, 0.05)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                      color: "#40010D",
                    }}
                  >
                    <FontAwesomeIcon icon={faUserTie} />
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontWeight: 900 }}>{x.name}</h4>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                      <span className={`staff-pill ${x.active ? "on" : "off"}`}>
                        {x.active ? "نشطة" : "غير نشطة"}
                      </span>

                      <span className={`staff-pill ${x.showOnAbout ? "on" : "off"}`}>
                        {x.showOnAbout ? "تظهر في من نحن" : "مخفية من من نحن"}
                      </span>

                      <span className={`staff-pill ${x.showOnBooking ? "on" : "off"}`}>
                        {x.showOnBooking ? "تظهر في الحجز" : "مخفية من الحجز"}
                      </span>

                      {/* ✅ تحذير إضافي إذا نشطة ومخفية */}
                      {(x.active && !x.showOnBooking) && (
                        <span className="staff-pill off" title="لن تظهر للعميلات في صفحة الحجز">
                          ⚠️ نشطة لكنها مخفية
                        </span>
                      )}

                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {/* ✅ تبديل سريع: نشط/غير نشط */}
                  <button
                    className="exp-btn ghost sm"
                    title={x.active ? "تعطيل الموظفة" : "تفعيل الموظفة"}
                    onClick={() => toggleActiveQuick(x)}
                    disabled={loading}
                    type="button"
                  >
                    <FontAwesomeIcon icon={x.active ? faToggleOn : faToggleOff} />
                  </button>

                  {/* ✅ تبديل سريع: يظهر في About أو لا */}
                  <button
                    className="exp-btn ghost sm"
                    title={x.showOnAbout ? "إخفاء من صفحة من نحن" : "إظهار في صفحة من نحن"}
                    onClick={() => toggleShowOnAboutQuick(x)}
                    disabled={loading}
                    type="button"
                  >
                    <FontAwesomeIcon icon={x.showOnAbout ? faToggleOn : faToggleOff} />
                  </button>

                  <button className="exp-btn ghost sm" onClick={() => openEdit(x)} type="button">
                    <FontAwesomeIcon icon={faPen} />
                  </button>

                  <button
                    className="exp-btn ghost sm text-danger"
                    onClick={() => remove(x.id)}
                    type="button"
                  >
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              </div>

              {x.bio ? <div className="staff-bio">{x.bio}</div> : <div className="staff-bio muted">بدون نبذة</div>}

              <div className="staff-chips">
                {normalizeSpecialties(x.specialties).map((sid) => {
                  const label = serviceOptions.find((o) => o.id === sid)?.label ?? sid;
                  return (
                    <span className="staff-chip" key={sid}>
                      {label}
                    </span>
                  );
                })}
              </div>

              {authUser?.role === "owner" && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span className="staff-pill stat total">
                      الحجوزات: <b>{statsLoading ? "..." : bookingStats[x.id]?.total ?? 0}</b>
                    </span>
                    <span className="staff-pill stat confirmed">
                      مؤكد: <b>{statsLoading ? "..." : bookingStats[x.id]?.byStatus.confirmed ?? 0}</b>
                    </span>
                    <span className="staff-pill stat pending">
                      انتظار: <b>{statsLoading ? "..." : bookingStats[x.id]?.byStatus.pending ?? 0}</b>
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {isOpen && (
          <Modal
            open={isOpen}
            onClose={closeModal}
            ariaLabel={editId ? "تعديل موظفة" : "إضافة موظفة"}
            panelClassName="emp-modal"
            size="lg"
          >
            <div className="modal-head">
              <b style={{ fontSize: "1.2rem" }}>{editId ? "تعديل موظفة" : "إضافة موظفة"}</b>
              <button className="exp-btn ghost" onClick={closeModal} type="button">
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="modal-body emp-modal-grid">
              <div className="emp-modal-section">
                <b className="emp-modal-section-title">المعلومات الأساسية</b>

                <div className="emp-modal-fields two-cols">
  <div className="dash-field">
    <label className="emp-label">اسم الموظفة</label>
    <input
      className="dash-input"
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="مثال: حنان"
    />
  </div>

  <div className="dash-field">
    <label className="emp-label">الحالة</label>
    <select
      className="dash-select"
      value={active ? "1" : "0"}
      onChange={(e) => setActive(e.target.value === "1")}
    >
      <option value="1">نشطة</option>
      <option value="0">غير نشطة</option>
    </select>
  </div>

  {/* ✅ يظهر في صفحة "من نحن" */}
  <div className="dash-field">
    <label className="emp-label">يظهر في صفحة "من نحن"؟</label>
    <select
      className="dash-select"
      value={showOnAbout ? "1" : "0"}
      onChange={(e) => setShowOnAbout(e.target.value === "1")}
    >
      <option value="1">نعم (يظهر)</option>
      <option value="0">لا (مخفي)</option>
    </select>
  </div>

  {/* ✅ يظهر في صفحة "الحجز" */}
  <div className="dash-field">
    <label className="emp-label">تظهر في صفحة "الحجز"؟</label>
    <select
      className="dash-select"
      value={showOnBooking ? "1" : "0"}
      onChange={(e) => setShowOnBooking(e.target.value === "1")}
    >
      <option value="1">نعم (تظهر)</option>
      <option value="0">لا (مخفية)</option>
    </select>
  </div>
</div>
              </div>

              <div className="emp-modal-section">
                <b className="emp-modal-section-title">ملف الموظفة</b>
                <div className="emp-modal-fields">
                  <div className="dash-field">
                    <label className="emp-label">نبذة تعريفية</label>
                    <textarea
                      className="dash-textarea"
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="مثال: خبيرة شعر وصبغات بخبرة 8 سنوات..."
                    />
                  </div>

                  <div className="dash-field">
                    <label className="emp-label">رابط السيرة الذاتية PDF (اختياري)</label>
                    <input
                      className="dash-input"
                      value={cvUrl}
                      onChange={(e) => setCvUrl(e.target.value)}
                      placeholder="https://.../cv.pdf"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              <div className="emp-modal-section">
                <b className="emp-modal-section-title">الخدمات التي تقدمها الموظفة</b>
                <div className="emp-picks-toolbar">
                  <input
                    className="dash-input"
                    placeholder="بحث بالخدمات..."
                    value={srvQ}
                    onChange={(e) => setSrvQ(e.target.value)}
                  />
                  <select
                    className="dash-select"
                    value={srvSection}
                    onChange={(e) => setSrvSection(e.target.value)}
                  >
                    <option value="all">كل الأقسام</option>
                    {sectionOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="staff-picks staff-picks--scroll">
                  {filteredServicesForPicks.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`pick ${specialties.includes(o.id) ? "on" : ""}`}
                      onClick={() => toggleSpecialty(o.id)}
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
                {loading ? "جاري الحفظ..." : "حفظ التغييرات"}
              </button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
