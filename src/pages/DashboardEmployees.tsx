// src/pages/DashboardEmployees.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
} from "firebase/firestore";

// ✅ use unified instances
import { db } from "../services/firebase";

import "../styles/DashboardEmployees.css";
import "../styles/DashboardModals.css";

// ✅ Bookings service (matches salons/main/bookings)
import {
  listAllBookings,
  type BookingDocWithId,
} from "../services/firestoreBookings";

// ✅ Use shared UiRole definition
import type { UiRole } from "../services/userProfile";

type StaffRole = "staff" | "reception" | "admin";

type EmployeeDoc = {
  id: string; // uid
  name: string;
  email?: string;
  phone?: string;

  role?: StaffRole;
  department?: string;
  isActive?: boolean;

  specialties?: string[];
  bio?: string;

  showOnAbout?: boolean;
  updatedAt?: any;
};

type BookingRow = {
  id: string;
  clientName?: string;
  clientPhone?: string;
  serviceName?: string;
  date?: string;
  time?: string;
  status?: string;
};

type RoleFilter = "all" | StaffRole;
type StatusFilter = "all" | "active" | "inactive";
type DepartmentFilter = "all" | string;

const DEPARTMENTS = [
  "قسم الشعر",
  "قسم الصبغات والمعالجات",
  "قسم المكياج",
  "قسم البديكير والمناكير",
  "قسم الخدمات (الشمع وإزالة الشعر)",
];

// ✅ New scoped collections
const SALON_ID = "main";
const EMPLOYEES_COLLECTION = ["salons", SALON_ID, "employees"] as const;
const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;

/* =========================
   ✅ Arabic Labels (Specialties + Status)
========================= */
const SPECIALTY_LABELS: Record<string, string> = {
  hair: "قسم الشعر",
  coloring: "الصبغات والمعالجات",
  makeup: "المكياج",
  nails: "البديكير والمناكير",
  waxing: "الشمع وإزالة الشعر",
  skincare: "العناية بالبشرة",
};

const SPECIALTY_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(SPECIALTY_LABELS).map(([k, v]) => [v, k])
);

function toArabicSpecialty(key: string) {
  const k = String(key || "").trim();
  return SPECIALTY_LABELS[k] ?? k;
}

function normalizeSpecialtyKey(input: string) {
  const x = String(input || "").trim();
  if (!x) return "";
  if (SPECIALTY_REVERSE[x]) return SPECIALTY_REVERSE[x];
  return x.toLowerCase();
}

const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: "قيد الانتظار",
  confirmed: "مؤكد",
  cancelled: "ملغي",
  canceled: "ملغي",
  completed: "مكتمل",
  no_show: "لم يحضر",
};

function toArabicBookingStatus(s?: string) {
  const key = String(s || "pending").toLowerCase().trim();
  return BOOKING_STATUS_LABELS[key] ?? key;
}

function readAuthRole(): UiRole {
  try {
    const raw = JSON.parse(localStorage.getItem("auth_user") || "{}");
    const r = String(raw?.role || "").toLowerCase().trim();

    if (r === "owner") return "owner";
    if (r === "admin") return "admin";
    if (r === "reception") return "reception";
    if (r === "staff") return "staff";
    if (r === "client") return "client";
    return "guest";
  } catch {
    return "guest";
  }
}

/** ✅ Bootstrap Admin UI check (حسب منهجك: ايميل واحد فقط) */
function isBootstrapAdminUI(): boolean {
  try {
    const raw = JSON.parse(localStorage.getItem("auth_user") || "{}");
    const email = String(raw?.email || "").toLowerCase().trim();
    return email === "nawafaaa0@gmail.com";
  } catch {
    return false;
  }
}

function roleLabel(role?: string) {
  const r = String(role || "").toLowerCase();
  if (r === "admin") return "مديرة";
  if (r === "reception") return "استقبال";
  if (r === "staff") return "موظفة";
  return "—";
}

function statusLabel(active?: boolean) {
  return active === false ? "موقوفة" : "نشطة";
}

function statusPillClass(active?: boolean) {
  return active === false ? "off" : "ok";
}

function toStaffRole(x: any): StaffRole {
  const r = String(x || "staff").toLowerCase().trim();
  if (r === "admin") return "admin";
  if (r === "reception") return "reception";
  return "staff";
}

function normalizeSpecialties(x: any): string[] {
  if (Array.isArray(x)) return x.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof x === "string") return [x.trim()].filter(Boolean);
  return [];
}

const DashboardEmployees = () => {
  const uiRole = useMemo(() => readAuthRole(), []);
  const canManage = uiRole === "owner" || uiRole === "admin"; // ✅ reception عرض فقط
  const isBootstrap = useMemo(() => isBootstrapAdminUI(), []);

  // data
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<EmployeeDoc[]>([]);
  const [err, setErr] = useState("");

  // filters
  const [qText, setQText] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<DepartmentFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // bookings counts (best-effort)
  const [counts, setCounts] = useState<Record<string, number>>({});

  // modals (edit)
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState("");
  const [selected, setSelected] = useState<EmployeeDoc | null>(null);

  // modals (bookings)
  const [bookingsOpen, setBookingsOpen] = useState(false);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [lastBookings, setLastBookings] = useState<BookingRow[]>([]);

  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    department: DEPARTMENTS[0],
    role: "staff" as StaffRole,
    isActive: true,
    specialties: [] as string[],
    bio: "",
    showOnAbout: true,
  });

  // =========================
  // ✅ Load employees (NOW from employees collection)
  // =========================
  const loadEmployees = useCallback(async () => {
    try {
      setLoading(true);
      setErr("");

      const colRef = collection(db, ...EMPLOYEES_COLLECTION);
      const snap = await getDocs(query(colRef, orderBy("name", "asc")));

      const list: EmployeeDoc[] = snap.docs
        .map((d) => {
          const x: any = d.data();
          const name = String(x?.name || x?.displayName || "").trim();
          const role = toStaffRole(x?.role);
          const isActive = x?.isActive !== false && x?.active !== false;

          // ✅ showOnAbout only meaningful for staff
          const showOnAbout =
            role === "staff" ? x?.showOnAbout !== false : false;

          return {
            id: d.id,
            name,
            email: String(x?.email || "").trim() || undefined,
            phone: String(x?.phone || "").trim() || undefined,
            department: String(x?.department || "").trim() || undefined,
            role,
            isActive,
            specialties: normalizeSpecialties(x?.specialties),
            bio: String(x?.bio || "").trim() || "",
            showOnAbout,
            updatedAt: x?.updatedAt,
          };
        })
        .filter((e) => e.name);

      setEmployees(list);

      if (list.length === 0) {
        setErr("لا توجد بيانات في employees حالياً. تأكد من Firestore.");
      }
    } catch (e: any) {
      console.error("load employees error:", e);
      setErr(e?.message || "تعذر تحميل الموظفات");
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  // =========================
  // ✅ Load bookings counts (best-effort)
  // =========================
  const loadCounts = useCallback(async () => {
    try {
      if (uiRole === "staff" || uiRole === "guest" || uiRole === "client") {
        setCounts({});
        return;
      }

      const all = await listAllBookings();
      const map: Record<string, number> = {};

      all.forEach((b: BookingDocWithId) => {
        const st = String(b.status || "pending").toLowerCase();
        if (st === "cancelled" || st === "canceled") return;

        const empKey =
          (b.employeeId || "").trim() || (b.employeeName || "").trim();
        if (!empKey) return;

        map[empKey] = (map[empKey] || 0) + 1;
      });

      setCounts(map);
    } catch {
      setCounts({});
    }
  }, [uiRole]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // =========================
  // ✅ Sync employees from users (Bootstrap only)
  // =========================
  const syncFromUsers = useCallback(async () => {
    if (!canManage) return;

    if (!isBootstrap) {
      alert("❌ المزامنة تتطلب دخول Bootstrap Admin حسب الصلاحيات الحالية.");
      return;
    }

    try {
      const qy = query(
        collection(db, ...USERS_COLLECTION),
        where("role", "in", ["staff", "reception", "admin"]),
        limit(200)
      );
      const snap = await getDocs(qy);

      const ops = snap.docs.map(async (d) => {
        const x: any = d.data();
        const uid = d.id;

        const name = String(x?.displayName || x?.name || "").trim() || "موظفة";
        const email = String(x?.email || "").trim() || undefined;
        const role = toStaffRole(x?.role);
        const active = x?.active !== false;
        const department = String(x?.department || "").trim() || undefined;

        // ✅ About projection rule
        const showOnAbout = role === "staff";

        const baseData = {
          name,
          email,
          role,
          isActive: active,
          department,
          showOnAbout,
          updatedAt: new Date().toISOString(),
        };

        await setDoc(doc(db, ...EMPLOYEES_COLLECTION, uid), baseData, { merge: true });
        await setDoc(doc(db, ...STAFF_PUBLIC_COLLECTION, uid), baseData, { merge: true });
      });

      await Promise.all(ops);
      await loadEmployees();
      await loadCounts();
      alert("✅ تمّت المزامنة من users إلى employees + staff_public");
    } catch (e: any) {
      console.error("syncFromUsers error:", e);
      alert("❌ تعذر عمل المزامنة (تحقق من Rules / Index)");
    }
  }, [canManage, isBootstrap, loadEmployees, loadCounts]);

  // =========================
  // ✅ Filtering
  // =========================
  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();

    return employees.filter((e) => {
      if (departmentFilter !== "all" && (e.department || "") !== departmentFilter)
        return false;

      if (roleFilter !== "all" && String(e.role || "staff") !== roleFilter)
        return false;

      const active = e.isActive !== false;
      if (statusFilter === "active" && !active) return false;
      if (statusFilter === "inactive" && active) return false;

      if (!q) return true;

      const hay = [
        e.name,
        e.email || "",
        e.phone || "",
        e.department || "",
        e.bio || "",
        (e.specialties || []).join(" "),
        e.showOnAbout ? "about" : "",
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }, [employees, qText, departmentFilter, roleFilter, statusFilter]);

  // =========================
  // ✅ Stats
  // =========================
  const stats = useMemo(() => {
    const total = filtered.length;
    const active = filtered.filter((e) => e.isActive !== false).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [filtered]);

  // =========================
  // ✅ Open Edit Modal
  // =========================
  const openEdit = useCallback((emp: EmployeeDoc) => {
    setSelected(emp);
    setEditMsg("");
    setEditForm({
      name: emp.name || "",
      phone: emp.phone || "",
      department: emp.department || DEPARTMENTS[0],
      role: (emp.role || "staff") as StaffRole,
      isActive: emp.isActive !== false,
      specialties: emp.specialties || [],
      bio: emp.bio || "",
      showOnAbout: emp.role === "staff" ? emp.showOnAbout !== false : false,
    });
    setEditOpen(true);
  }, []);

  // =========================
  // ✅ Save Edit (updates employees + staff_public)
  // =========================
  const handleSaveEdit = useCallback(async () => {
    if (!canManage || !selected) return;

    const name = editForm.name.trim();
    const phone = editForm.phone.trim();
    const department = editForm.department.trim();
    const role = editForm.role;
    const isActive = !!editForm.isActive;

    const specialties = (editForm.specialties || [])
      .map((x) => normalizeSpecialtyKey(String(x)))
      .filter(Boolean);

    const bio = String(editForm.bio || "").trim();

    // ✅ showOnAbout rule: only staff can show
    const showOnAbout = role === "staff" ? !!editForm.showOnAbout : false;

    setEditMsg("");

    if (!name) return setEditMsg("❌ الاسم مطلوب");
    if (!department) return setEditMsg("❌ القسم مطلوب");

    try {
      setEditSaving(true);

      const payload = {
        name,
        phone,
        department,
        role,
        isActive,
        specialties,
        bio,
        showOnAbout,
        updatedAt: new Date().toISOString(),
      };

      await setDoc(doc(db, ...EMPLOYEES_COLLECTION, selected.id), payload, { merge: true });
      await setDoc(doc(db, ...STAFF_PUBLIC_COLLECTION, selected.id), payload, { merge: true });

      setEmployees((prev) =>
        prev.map((x) => (x.id === selected.id ? { ...x, ...payload } : x))
      );

      setEditMsg("✅ تم الحفظ");
      setTimeout(() => setEditOpen(false), 450);
    } catch (e) {
      console.error("save employee error:", e);
      setEditMsg("❌ تعذر الحفظ (تحقق من الصلاحيات/Rules)");
    } finally {
      setEditSaving(false);
      setTimeout(() => setEditMsg(""), 2500);
    }
  }, [canManage, selected, editForm]);

  // =========================
  // ✅ Load last 5 bookings for employee
  // =========================
  const openBookings = useCallback(async (emp: EmployeeDoc) => {
    setSelected(emp);
    setBookingsOpen(true);
    setBookingsLoading(true);
    setLastBookings([]);

    try {
      const all = await listAllBookings();

      const empKey = emp.id;
      const empName = (emp.name || "").trim();

      const rows = all
        .filter((b) => {
          const byId = String(b.employeeId || "").trim();
          const byName = String(b.employeeName || "").trim();
          return (byId && byId === empKey) || (!byId && empName && byName === empName);
        })
        .sort((a, b) => {
          const da = String(a.date || "");
          const dbb = String(b.date || "");
          if (da !== dbb) return dbb.localeCompare(da);
          return String(b.time || "").localeCompare(String(a.time || ""));
        })
        .slice(0, 5)
        .map((b) => ({
          id: b.id,
          clientName: b.clientName,
          clientPhone: b.clientPhone,
          serviceName: b.serviceName,
          date: b.date,
          time: b.time,
          status: b.status,
        }));

      setLastBookings(rows);
    } catch {
      setLastBookings([]);
    } finally {
      setBookingsLoading(false);
    }
  }, []);

  return (
    <div className="dashboard-skin">
      <div className="employees-page">
        <div className="dashboard-card">
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900 }}>
                إدارة الموظفات
              </h1>
              <p style={{ marginTop: 8, opacity: 0.85 }}>
                عرض الموظفات من Firestore (Collection:{" "}
                <b>salons/main/employees</b>) — (About من <b>staff_public</b>)
              </p>
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <button className="dash-btn" type="button" onClick={loadEmployees}>
                تحديث
              </button>

              {canManage ? (
                <button
                  className="dash-btn primary"
                  type="button"
                  onClick={syncFromUsers}
                  title={
                    !isBootstrap
                      ? "يتطلب دخول Bootstrap Admin حسب الصلاحيات"
                      : "مزامنة من الحسابات"
                  }
                >
                  مزامنة من الحسابات
                </button>
              ) : (
                <button
                  className="dash-btn"
                  type="button"
                  disabled
                  title="reception عرض فقط"
                >
                  مزامنة من الحسابات
                </button>
              )}
            </div>
          </div>

          {/* Stats */}
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 900 }}>المعروض: {stats.total}</div>
            <div style={{ fontWeight: 900 }}>النشطة: {stats.active}</div>
            <div style={{ fontWeight: 900 }}>الموقوفة: {stats.inactive}</div>
          </div>

          {/* Filters */}
          <div className="emp-filters">
            <input
              className="dashboard-input emp-input"
              placeholder="بحث بالاسم / القسم / الإيميل / الجوال / النبذة…"
              value={qText}
              onChange={(e) => setQText(e.target.value)}
            />

            <select
              className="dashboard-input emp-input"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="all">كل الأقسام</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              className="dashboard-input emp-input"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            >
              <option value="all">كل الأدوار</option>
              <option value="staff">موظفة</option>
              <option value="reception">استقبال</option>
              <option value="admin">مديرة</option>
            </select>

            <select
              className="dashboard-input emp-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">كل الحالات</option>
              <option value="active">نشطة</option>
              <option value="inactive">موقوفة</option>
            </select>
          </div>

          {/* Table */}
          <div style={{ marginTop: 14 }}>
            {loading ? (
              <p style={{ opacity: 0.75 }}>جاري التحميل…</p>
            ) : err ? (
              <p style={{ color: "#991b1b", fontWeight: 900 }}>❌ {err}</p>
            ) : filtered.length === 0 ? (
              <p style={{ opacity: 0.75 }}>لا توجد موظفات حالياً.</p>
            ) : (
              <div className="table-responsive">
                <table className="ov-table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th className="emp-center">القسم</th>
                      <th className="emp-center">الدور</th>
                      <th className="emp-center">الجوال</th>
                      <th className="emp-center">الحالة</th>
                      <th className="emp-center">الحجوزات</th>
                      <th className="emp-center">إجراءات</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filtered.map((e) => {
                      const empKey = e.id || e.name;
                      const c = counts[empKey] || counts[e.name] || 0;
                      const hasBookings = c > 0;

                      return (
                        <tr key={e.id} className={hasBookings ? "emp-row-linked" : ""}>
                          <td className="emp-name">
                            {e.name}
                            {e.role === "staff" && e.showOnAbout ? (
                              <span
                                style={{
                                  marginInlineStart: 10,
                                  fontSize: 12,
                                  fontWeight: 900,
                                  opacity: 0.85,
                                }}
                                title="تظهر في صفحة About"
                              >
                                • About ✅
                              </span>
                            ) : null}
                          </td>

                          <td className="emp-center">{e.department || "—"}</td>
                          <td className="emp-center">{roleLabel(e.role)}</td>

                          <td className="emp-center" dir="ltr">
                            {e.phone || "—"}
                          </td>

                          <td className="emp-center">
                            <span className={`emp-pill ${statusPillClass(e.isActive)}`}>
                              {statusLabel(e.isActive)}
                            </span>
                          </td>

                          <td className="emp-center">
                            <span className={`emp-chip ${hasBookings ? "" : "warn"}`}>
                              {c}
                            </span>
                          </td>

                          <td className="emp-center">
                            <div className="emp-actions">
                              <button className="dash-btn" type="button" onClick={() => openBookings(e)}>
                                آخر 5 حجوزات
                              </button>

                              {canManage ? (
                                <button className="dash-btn primary" type="button" onClick={() => openEdit(e)}>
                                  تعديل
                                </button>
                              ) : (
                                <button className="dash-btn" type="button" disabled title="reception عرض فقط">
                                  تعديل
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="emp-footnote">
                  ملاحظة: الاستقبال (reception) عرض فقط. التعديل والمزامنة للـ Owner/Admin.
                  المزامنة من users تتطلب Bootstrap Admin.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* =========================
            ✅ Edit Modal
        ========================= */}
        {editOpen && selected && (
          <div className="modal-overlay" onClick={() => setEditOpen(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <div className="modal-title-wrap">
                  <div className="modal-icon">👩‍💼</div>
                  <h3 className="modal-title">تعديل الموظفة</h3>
                </div>

                <button className="modal-close" type="button" onClick={() => setEditOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="modal-body">
                <div className="emp-modal-grid">
                  <div>
                    <label className="emp-label">الاسم</label>
                    <input
                      className="dashboard-input emp-input"
                      value={editForm.name}
                      onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))}
                      disabled={!canManage || editSaving}
                    />
                  </div>

                  <div className="emp-two">
                    <div>
                      <label className="emp-label">القسم</label>
                      <select
                        className="dashboard-input emp-input"
                        value={editForm.department}
                        onChange={(e) => setEditForm((p) => ({ ...p, department: e.target.value }))}
                        disabled={!canManage || editSaving}
                      >
                        {DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="emp-label">الجوال</label>
                      <input
                        className="dashboard-input emp-input"
                        value={editForm.phone}
                        onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))}
                        disabled={!canManage || editSaving}
                        placeholder="05xxxxxxxx"
                      />
                    </div>
                  </div>

                  <div className="emp-two">
                    <div>
                      <label className="emp-label">الدور</label>
                      <select
                        className="dashboard-input emp-input"
                        value={editForm.role}
                        onChange={(e) =>
                          setEditForm((p) => ({
                            ...p,
                            role: e.target.value as StaffRole,
                            // ✅ لو تغير للدور غير staff نخفي About مباشرة
                            showOnAbout: e.target.value === "staff" ? p.showOnAbout : false,
                          }))
                        }
                        disabled={!canManage || editSaving}
                      >
                        <option value="staff">موظفة</option>
                        <option value="reception">استقبال</option>
                        <option value="admin">مديرة</option>
                      </select>
                    </div>

                    <div>
                      <label className="emp-label">الحالة</label>
                      <select
                        className="dashboard-input emp-input"
                        value={editForm.isActive ? "on" : "off"}
                        onChange={(e) => setEditForm((p) => ({ ...p, isActive: e.target.value === "on" }))}
                        disabled={!canManage || editSaving}
                      >
                        <option value="on">نشطة</option>
                        <option value="off">موقوفة</option>
                      </select>
                    </div>
                  </div>

                  {/* ✅ showOnAbout (staff only) */}
                  <div className="emp-two">
                    <div>
                      <label className="emp-label">الظهور في About</label>
                      <select
                        className="dashboard-input emp-input"
                        value={editForm.role === "staff" && editForm.showOnAbout ? "yes" : "no"}
                        onChange={(e) =>
                          setEditForm((p) => ({
                            ...p,
                            showOnAbout: p.role === "staff" ? e.target.value === "yes" : false,
                          }))
                        }
                        disabled={!canManage || editSaving || editForm.role !== "staff"}
                        title={editForm.role !== "staff" ? "فقط الموظفة (staff) تظهر في About" : ""}
                      >
                        <option value="yes">تظهر ✅</option>
                        <option value="no">مخفية</option>
                      </select>
                    </div>

                    <div />
                  </div>

                  <div>
                    <label className="emp-label">التخصصات (تكتب key أو عربي)</label>
                    <input
                      className="dashboard-input emp-input"
                      value={(editForm.specialties || []).join(", ")}
                      onChange={(e) =>
                        setEditForm((p) => ({
                          ...p,
                          specialties: e.target.value
                            .split(",")
                            .map((x) => normalizeSpecialtyKey(x))
                            .filter(Boolean),
                        }))
                      }
                      disabled={!canManage || editSaving}
                      placeholder="hair, nails (أو: قسم الشعر, الأظافر)"
                      dir="ltr"
                    />
                    <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
                      عرض بالعربي:{" "}
                      <b>
                        {(editForm.specialties || []).map(toArabicSpecialty).join("، ") || "—"}
                      </b>
                    </div>
                  </div>

                  <div>
                    <label className="emp-label">نبذة عن الموظفة (تظهر بالـ About إذا كانت staff ومفعلة)</label>
                    <textarea
                      className="dashboard-input emp-input"
                      value={editForm.bio}
                      onChange={(e) => setEditForm((p) => ({ ...p, bio: e.target.value }))}
                      disabled={!canManage || editSaving}
                      placeholder="مثال: خبيرة في الصبغات والعناية بالشعر…"
                      style={{ minHeight: 110, resize: "vertical" }}
                    />
                  </div>

                  {editMsg && <div className="emp-modal-hint">{editMsg}</div>}

                  <div className="emp-modal-actions">
                    <button
                      className={`dash-btn primary ${editSaving ? "is-disabled" : ""}`}
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={!canManage || editSaving}
                    >
                      {editSaving ? "جاري الحفظ…" : "حفظ"}
                    </button>

                    <button className="dash-btn" type="button" onClick={() => setEditOpen(false)}>
                      إغلاق
                    </button>
                  </div>

                  <div className="emp-modal-hint">
                    * يتم حفظ التعديل في <b>salons/main/employees</b> + <b>salons/main/staff_public</b>
                    <br />
                    * About: تظهر فقط لو الدور <b>staff</b> و <b>showOnAbout = true</b>.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================
            ✅ Bookings Modal (Last 5)
        ========================= */}
        {bookingsOpen && selected && (
          <div className="modal-overlay" onClick={() => setBookingsOpen(false)}>
            <div className="modal-box emp-bookings-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <div className="modal-title-wrap">
                  <div className="modal-icon">📅</div>
                  <div>
                    <h3 className="modal-title">آخر 5 حجوزات</h3>
                    <div className="emp-bookings-sub">
                      للموظفة: <b>{selected.name}</b>
                    </div>
                  </div>
                </div>

                <button className="modal-close" type="button" onClick={() => setBookingsOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="modal-body">
                <div className="emp-bookings-wrap">
                  {bookingsLoading ? (
                    <p style={{ opacity: 0.75 }}>جاري التحميل…</p>
                  ) : lastBookings.length === 0 ? (
                    <p style={{ opacity: 0.75 }}>لا توجد حجوزات.</p>
                  ) : (
                    <table className="emp-bookings-table">
                      <thead>
                        <tr>
                          <th>العميلة</th>
                          <th className="emp-center">التاريخ</th>
                          <th className="emp-center">الوقت</th>
                          <th>الخدمة</th>
                          <th className="emp-center">الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastBookings.map((b) => (
                          <tr key={b.id}>
                            <td>{b.clientName || "—"}</td>
                            <td className="emp-center">{b.date || "—"}</td>
                            <td className="emp-center">{b.time || "—"}</td>
                            <td>{b.serviceName || "—"}</td>
                            <td className="emp-center">
                              <span className="emp-bk-pill">{toArabicBookingStatus(b.status)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  <div className="emp-modal-hint">
                    * هذه نافذة “عرض فقط”. تعديل الحجوزات يتم من صفحة الحجوزات.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardEmployees;
