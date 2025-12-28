// src/pages/DashboardEmployees.tsx
import React, { useEffect, useMemo, useState } from "react";
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
import { db } from "../services/firebase";

import "../styles/DashboardEmployees.css";
import "../styles/DashboardModals.css";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";
type StaffRole = "staff" | "reception" | "admin";

type EmployeeDoc = {
  id: string; // uid
  name: string;
  email?: string;
  phone?: string;
  role?: StaffRole;
  department?: string;
  isActive?: boolean;
};

type BookingDoc = {
  id: string;
  name?: string;
  phone?: string;
  service?: string;
  date?: string;
  time?: string;
  status?: string;
  createdAt?: any;
};

const DEPARTMENTS = [
  "قسم الشعر",
  "قسم الصبغات والمعالجات",
  "قسم المكياج",
  "قسم البديكير والمناكير",
  "قسم الخدمات (الشمع وإزالة الشعر)",
];

// ✅ Collections
const EMPLOYEES_COLLECTION = "employees";
const STAFF_PUBLIC_COLLECTION = "staff_public"; // ✅ للعرض فقط (للـ reception/staff)

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

function isPermissionError(e: any) {
  const msg = String(e?.message || "").toLowerCase();
  const code = String(e?.code || "").toLowerCase();
  return (
    code.includes("permission-denied") ||
    msg.includes("missing or insufficient permissions") ||
    msg.includes("permission")
  );
}

const DashboardEmployees: React.FC = () => {
  const uiRole = useMemo(() => readAuthRole(), []);
  const canManage = uiRole === "owner" || uiRole === "admin"; // ✅ reception عرض فقط

  // data
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<EmployeeDoc[]>([]);
  const [err, setErr] = useState("");

  // filters
  const [qText, setQText] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // bookings counts (best-effort)
  const [counts, setCounts] = useState<Record<string, number>>({});

  // modals
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMsg, setEditMsg] = useState("");
  const [selected, setSelected] = useState<EmployeeDoc | null>(null);

  const [bookingsOpen, setBookingsOpen] = useState(false);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [lastBookings, setLastBookings] = useState<BookingDoc[]>([]);

  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    department: DEPARTMENTS[0],
    role: "staff" as StaffRole,
    isActive: true,
  });

  // =========================
  // ✅ Load employees
  // =========================
  const loadEmployees = async () => {
    try {
      setLoading(true);
      setErr("");

      // ✅ 1) Owner/Admin يقرأ من employees
      // ✅ 2) Reception/Staff يقرأ من staff_public (عرض فقط)
      const preferred = canManage ? EMPLOYEES_COLLECTION : STAFF_PUBLIC_COLLECTION;

      const tryRead = async (colName: string) => {
        const qy = query(collection(db, colName), orderBy("name", "asc"));
        const snap = await getDocs(qy);

        const list: EmployeeDoc[] = snap.docs
          .map((d) => {
            const x: any = d.data();
            return {
              id: d.id,
              name: String(x?.name || x?.displayName || "").trim(),
              email: String(x?.email || "").trim() || undefined,
              phone: String(x?.phone || "").trim() || undefined,
              department: String(x?.department || "").trim() || undefined,
              role: toStaffRole(x?.role),
              isActive: x?.isActive !== false,
            };
          })
          .filter((e) => e.name);

        return list;
      };

      try {
        const list = await tryRead(preferred);
        setEmployees(list);
        return;
      } catch (e: any) {
        // ✅ لو حاول employees وفشل بسبب Permissions نجرب staff_public تلقائيًا
        if (preferred === EMPLOYEES_COLLECTION && isPermissionError(e)) {
          const list = await tryRead(STAFF_PUBLIC_COLLECTION);
          setEmployees(list);
          setErr("تنبيه: تم عرض البيانات من staff_public بسبب صلاحيات القراءة على employees.");
          return;
        }
        throw e;
      }
    } catch (e: any) {
      console.error("load employees error:", e);
      setErr(e?.message || "تعذر تحميل الموظفات");
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================
  // ✅ Load bookings counts (optional / best-effort)
  // =========================
  const loadCounts = async () => {
    try {
      // لو تبغى تشددها: خلها فقط للـ owner/admin/reception
      // (لأن staff غالبًا ما يحتاج يشوف أرقام الجميع)
      if (uiRole === "staff" || uiRole === "guest" || uiRole === "client") {
        setCounts({});
        return;
      }

      const qy = query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(500));
      const snap = await getDocs(qy);

      const map: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const x: any = d.data();
        const uid = String(x?.employeeUid || "").trim();
        const st = String(x?.status || "pending").toLowerCase();

        if (!uid) return;
        if (st === "cancelled") return;

        map[uid] = (map[uid] || 0) + 1;
      });

      setCounts(map);
    } catch {
      setCounts({});
    }
  };

  useEffect(() => {
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // =========================
  // ✅ Sync employees from users (Owner/Admin only)
  // =========================
  const syncFromUsers = async () => {
    if (!canManage) return;

    try {
      // ✅ نجلب حسابات الموظفات فقط
      // ملاحظة: حذفنا orderBy لتقليل مشاكل الـ Index
      const qy = query(
        collection(db, "users"),
        where("role", "in", ["staff", "reception", "admin"]),
        limit(200)
      );
      const snap = await getDocs(qy);

      // ✅ نكتب/نحدث employees/{uid}
      const ops = snap.docs.map(async (d) => {
        const x: any = d.data();
        const uid = d.id;

        const name = String(x?.displayName || "").trim() || "موظفة";
        const email = String(x?.email || "").trim() || undefined;
        const role = toStaffRole(x?.role);
        const active = x?.active !== false;

        await setDoc(
          doc(db, EMPLOYEES_COLLECTION, uid),
          {
            name,
            email,
            role,
            isActive: active,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );

        // ✅ (اختياري قوي) تحديث staff_public للعرض
        // إذا تبي reception/staff يشوفون نفس القائمة بدون صلاحيات employees
        await setDoc(
          doc(db, STAFF_PUBLIC_COLLECTION, uid),
          {
            name,
            email,
            role,
            isActive: active,
            department: String(x?.department || "").trim() || undefined,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      });

      await Promise.all(ops);
      await loadEmployees();
      await loadCounts();
      alert("✅ تمّت المزامنة من users إلى employees + staff_public");
    } catch (e: any) {
      console.error("syncFromUsers error:", e);
      alert("❌ تعذر عمل المزامنة (تحقق من Rules / Index)");
    }
  };

  // =========================
  // ✅ Filtering
  // =========================
  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();

    return employees.filter((e) => {
      if (departmentFilter !== "all" && (e.department || "") !== departmentFilter) return false;
      if (roleFilter !== "all" && String(e.role || "staff") !== roleFilter) return false;

      const active = e.isActive !== false;
      if (statusFilter === "active" && !active) return false;
      if (statusFilter === "inactive" && active) return false;

      if (!q) return true;
      const hay = `${e.name} ${e.email || ""} ${e.phone || ""} ${e.department || ""}`.toLowerCase();
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
  const openEdit = (emp: EmployeeDoc) => {
    setSelected(emp);
    setEditMsg("");
    setEditForm({
      name: emp.name || "",
      phone: emp.phone || "",
      department: emp.department || DEPARTMENTS[0],
      role: (emp.role || "staff") as StaffRole,
      isActive: emp.isActive !== false,
    });
    setEditOpen(true);
  };

  // =========================
  // ✅ Save Edit (employees + users sync)
  // =========================
  const handleSaveEdit = async () => {
    if (!canManage || !selected) return;

    const name = editForm.name.trim();
    const phone = editForm.phone.trim();
    const department = editForm.department.trim();
    const role = editForm.role;
    const isActive = !!editForm.isActive;

    setEditMsg("");

    if (!name) {
      setEditMsg("❌ الاسم مطلوب");
      return;
    }
    if (!department) {
      setEditMsg("❌ القسم مطلوب");
      return;
    }

    try {
      setEditSaving(true);

      await setDoc(
        doc(db, EMPLOYEES_COLLECTION, selected.id),
        {
          name,
          phone,
          department,
          role,
          isActive,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // ✅ حافظنا على تحديث staff_public عشان القراءة للعرض تكون سليمة
      await setDoc(
        doc(db, STAFF_PUBLIC_COLLECTION, selected.id),
        {
          name,
          phone,
          department,
          role,
          isActive,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "users", selected.id),
        {
          displayName: name,
          role,
          active: isActive,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      setEmployees((prev) =>
        prev.map((x) =>
          x.id === selected.id ? { ...x, name, phone, department, role, isActive } : x
        )
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
  };

  // =========================
  // ✅ Load last 5 bookings for employee
  // =========================
  const openBookings = async (emp: EmployeeDoc) => {
    setSelected(emp);
    setBookingsOpen(true);
    setBookingsLoading(true);
    setLastBookings([]);

    try {
      const qy = query(
        collection(db, "bookings"),
        where("employeeUid", "==", emp.id),
        orderBy("createdAt", "desc"),
        limit(5)
      );
      const snap = await getDocs(qy);

      const list: BookingDoc[] = snap.docs.map((d) => {
        const x: any = d.data();
        return {
          id: d.id,
          name: x?.name,
          phone: x?.phone,
          service: x?.serviceName || x?.service || "",
          date: x?.date,
          time: x?.time,
          status: x?.status,
          createdAt: x?.createdAt,
        };
      });

      setLastBookings(list);
    } catch {
      setLastBookings([]);
    } finally {
      setBookingsLoading(false);
    }
  };

  return (
    <div className="employees-page">
      <div className="dashboard-card">
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900 }}>إدارة الموظفات</h1>
            <p style={{ marginTop: 8, opacity: 0.85 }}>
              عرض الموظفات من Firestore (Collection:{" "}
              <b>{canManage ? EMPLOYEES_COLLECTION : STAFF_PUBLIC_COLLECTION}</b>)
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="dash-btn" type="button" onClick={loadEmployees}>
              تحديث
            </button>

            {canManage ? (
              <button className="dash-btn primary" type="button" onClick={syncFromUsers}>
                مزامنة من الحسابات
              </button>
            ) : (
              <button className="dash-btn" type="button" disabled title="reception عرض فقط">
                مزامنة من الحسابات
              </button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900 }}>المعروض: {stats.total}</div>
          <div style={{ fontWeight: 900 }}>النشطة: {stats.active}</div>
          <div style={{ fontWeight: 900 }}>الموقوفة: {stats.inactive}</div>
        </div>

        {/* Filters */}
        <div className="emp-filters">
          <input
            className="dashboard-input emp-input"
            placeholder="بحث بالاسم / القسم / الإيميل / الجوال…"
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
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">كل الأدوار</option>
            <option value="staff">موظفة</option>
            <option value="reception">استقبال</option>
            <option value="admin">مديرة</option>
          </select>

          <select
            className="dashboard-input emp-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
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
                    const c = counts[e.id] || 0;
                    const hasBookings = c > 0;

                    return (
                      <tr key={e.id} className={hasBookings ? "emp-row-linked" : ""}>
                        <td className="emp-name">{e.name}</td>

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
                          <span className={`emp-chip ${hasBookings ? "" : "warn"}`}>{c}</span>
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
                      onChange={(e) => setEditForm((p) => ({ ...p, role: e.target.value as StaffRole }))}
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
                  * يتم حفظ التعديل في <b>employees</b> + <b>staff_public</b> + مزامنة <b>users</b>
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
                  <p style={{ opacity: 0.75 }}>لا توجد حجوزات (أو تحتاج Index/Permissions للقراءة).</p>
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
                          <td>{b.name || "—"}</td>
                          <td className="emp-center">{b.date || "—"}</td>
                          <td className="emp-center">{b.time || "—"}</td>
                          <td>{b.service || "—"}</td>
                          <td className="emp-center">
                            <span className="emp-bk-pill">{String(b.status || "pending")}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div className="emp-modal-hint">* هذه نافذة “عرض فقط”. تعديل الحجوزات يتم من صفحة الحجوزات.</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardEmployees;
