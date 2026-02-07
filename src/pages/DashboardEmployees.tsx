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
  faToggleOn,
  faToggleOff,
  faUserTie,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import "../styles/DashboardModals.css";
import "../styles/EmployeePortal.css";
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
  specialties: string[];
  bio?: string;
  avatarUrl?: string;
  cvUrl?: string; // ✅ NEW
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

  // ✅ NOW: filter by serviceId
  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cvUrl, setCvUrl] = useState(""); // ✅ NEW

  const [active, setActive] = useState(true);

  // ✅ NOW: store serviceIds
  const [specialties, setSpecialties] = useState<string[]>([]);

  // ✅ services options (instead of sections)
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setBio("");
    setAvatarUrl("");
    setCvUrl(""); // ✅ NEW
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
    setCvUrl((x as any).cvUrl ?? ""); // ✅ NEW
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
      const snap = await getDocs(staffPublicCol());
      const rows = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data?.name ?? "",
          active: !!data?.active,
          specialties: normalizeSpecialties(data?.specialties),
          bio: data?.bio ?? "",
          avatarUrl: data?.avatarUrl ?? "",
          cvUrl: data?.cvUrl ?? "", // ✅ NEW
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        };

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

  // ✅ Load services (catalog options for specialties)
  const loadServiceOptions = async () => {
    try {
      // ملاحظة: نخليها orderBy فقط بدون where عشان ما نعلق على index
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
        // ✅ نعرض فقط الخدمات المفعلة
        .filter((s) => s.active !== false);

      setServiceOptions(opts);
    } catch (e) {
      console.warn("loadServiceOptions error:", e);
      setServiceOptions([]);
    }
  };


  // ✅ FIX: migrate old bookings to include employeeUid/employeeKey
  const fixBookingsEmployeeUid = async () => {
    if (!canManage) return;

    const ok = confirm(
      "سيتم إصلاح الحجوزات القديمة بإضافة employeeUid/employeeKey حسب staff_public.linkedUid.\nهل تريد المتابعة؟"
    );
    if (!ok) return;

    setLoading(true);
    setErrorMsg("");

    try {
      // 1) load staff_public map: employeeId -> linkedUid
      const staffSnap = await getDocs(staffPublicCol());
      const uidByEmployeeId = new Map<string, string>();

      staffSnap.docs.forEach((d) => {
        const data: any = d.data();
        const linkedUid = String(data?.linkedUid || "").trim();
        if (linkedUid) uidByEmployeeId.set(d.id, linkedUid);
      });

      // 2) read all bookings (or you can filter if you want)
      const bookingsRef = collection(db, "salons", SALON_ID, "bookings");
      const bSnap = await getDocs(bookingsRef);

      let changed = 0;
      let missingStaff = 0;

      // batch limit: 500 writes
      let batch = writeBatch(db);
      let batchCount = 0;

      const commitBatch = async () => {
        if (batchCount === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      };

      for (const d of bSnap.docs) {
        const b: any = d.data();

        const employeeUid = String(b?.employeeUid || "").trim();
        const employeeId = String(b?.employeeId || "").trim();

        // ✅ fix only if employeeUid is missing but employeeId exists
        if (employeeUid || !employeeId) continue;

        const linkedUid = uidByEmployeeId.get(employeeId) || "";
        if (!linkedUid) {
          missingStaff += 1;
          continue;
        }

        const ref = doc(db, "salons", SALON_ID, "bookings", d.id);

        batch.update(ref, {
          employeeUid: linkedUid,
          employeeKey: linkedUid,
          updatedAt: serverTimestamp(),
        });

        batchCount += 1;
        changed += 1;

        if (batchCount >= 450) {
          // safe buffer under 500
          await commitBatch();
        }
      }

      await commitBatch();

      alert(
        `✅ تم الإصلاح بنجاح\n` +
        `تم تحديث: ${changed} حجز\n` +
        `حجوزات لم نجد لها linkedUid: ${missingStaff}\n\n` +
        `ملاحظة: الحجوزات التي لم تُصلح معناها الموظفة غير مرتبطة (linkedUid ناقص) داخل staff_public.`
      );
    } catch (e) {
      console.warn("fixBookingsEmployeeUid error:", e);
      setErrorMsg("تعذر إصلاح الحجوزات (راجع Console)");
    } finally {
      setLoading(false);
    }
  };

  // 🔎 DIAG: show which employeeIds/names are missing linkedUid mapping
  const diagnoseMissingLinkedUid = async () => {
    if (!canManage) return;

    setLoading(true);
    setErrorMsg("");

    try {
      const staffSnap = await getDocs(staffPublicCol());

      // maps for matching
      const uidByDocId = new Map<string, string>();       // docId -> linkedUid
      const uidByName = new Map<string, string>();        // normalizedName -> linkedUid
      const uidByEmail = new Map<string, string>();       // emailLower -> linkedUid

      staffSnap.docs.forEach((d) => {
        const data: any = d.data();
        const linkedUid = String(data?.linkedUid || data?.uid || "").trim();
        const name = String(data?.name || "").trim();
        const email = String(data?.email || "").trim().toLowerCase();

        if (linkedUid) uidByDocId.set(d.id, linkedUid);

        const nk = normalizeArabicName(name);
        if (nk && linkedUid) uidByName.set(nk, linkedUid);

        if (email && linkedUid) uidByEmail.set(email, linkedUid);
      });

      const bookingsRef = collection(db, "salons", SALON_ID, "bookings");
      const bSnap = await getDocs(bookingsRef);

      // count missing by employeeId / employeeName
      const byEmployeeId: Record<string, number> = {};
      const byEmployeeName: Record<string, number> = {};
      const examples: any[] = [];

      for (const d of bSnap.docs) {
        const b: any = d.data();
        const employeeUid = String(b?.employeeUid || "").trim();
        const employeeId = String(b?.employeeId || "").trim();
        const employeeName = String(b?.employeeName || "").trim();
        const employeeEmail = String(b?.employeeEmail || "").trim().toLowerCase();

        // only those missing employeeUid
        if (employeeUid) continue;

        // try to see if we could match
        const docMatch = employeeId && uidByDocId.get(employeeId);
        const nameMatch = employeeName && uidByName.get(normalizeArabicName(employeeName));
        const emailMatch = employeeEmail && uidByEmail.get(employeeEmail);

        if (!docMatch && !nameMatch && !emailMatch) {
          if (employeeId) byEmployeeId[employeeId] = (byEmployeeId[employeeId] || 0) + 1;
          if (employeeName) byEmployeeName[employeeName] = (byEmployeeName[employeeName] || 0) + 1;

          if (examples.length < 15) {
            examples.push({
              bookingId: d.id,
              employeeId,
              employeeName,
              employeeEmail,
              date: b?.date,
              time: b?.time,
            });
          }
        }
      }

      console.log("❗ Missing mapping by employeeId:", byEmployeeId);
      console.log("❗ Missing mapping by employeeName:", byEmployeeName);
      console.log("🧾 Examples (first 15):", examples);

      alert(
        "تم طباعة التشخيص في Console ✅\n\n" +
        "افتح DevTools (F12) → Console وشوف:\n" +
        "- Missing mapping by employeeId\n" +
        "- Missing mapping by employeeName\n" +
        "- Examples"
      );
    } catch (e) {
      console.warn("diagnoseMissingLinkedUid error:", e);
      setErrorMsg("تعذر التشخيص (راجع Console)");
    } finally {
      setLoading(false);
    }
  };

  // ✅ SMART FIX: fill employeeUid/employeeKey even if staff_public docId is not employeeId
  const smartFixBookingsEmployeeUid = async () => {
    if (!canManage) return;

    const ok = confirm(
      "إصلاح ذكي: سيتم محاولة إصلاح الحجوزات القديمة عبر مطابقة staff_public بالـ docId أو الاسم أو الإيميل + aliases.\nهل تريد المتابعة؟"
    );
    if (!ok) return;

    setLoading(true);
    setErrorMsg("");

    try {
      const staffSnap = await getDocs(staffPublicCol());

      const uidByDocId = new Map<string, string>();
      const uidByName = new Map<string, string>();
      const uidByEmail = new Map<string, string>();

      staffSnap.docs.forEach((d) => {
        const data: any = d.data();

        // ✅ linkedUid is the source of truth (fallback to uid if present)
        const linkedUid = String(data?.linkedUid || data?.uid || "").trim();
        if (!linkedUid) return;

        const name = String(data?.name || "").trim();
        const email = String(data?.email || "").trim().toLowerCase();

        // 1) docId
        uidByDocId.set(d.id, linkedUid);

        // 2) name
        const nk = normalizeArabicName(name);
        if (nk) uidByName.set(nk, linkedUid);

        // 3) email
        if (email) uidByEmail.set(email, linkedUid);

        // ✅ 4) aliases (NEW)
        const aliases: string[] = Array.isArray(data?.aliases) ? data.aliases : [];
        for (const a of aliases) {
          const s = String(a || "").trim();
          if (!s) continue;

          // alias as "employeeId style"
          uidByDocId.set(s, linkedUid);

          // alias as "name style"
          uidByName.set(normalizeArabicName(s), linkedUid);
        }
      });

      const bookingsRef = collection(db, "salons", SALON_ID, "bookings");
      const bSnap = await getDocs(bookingsRef);

      let changed = 0;
      let stillMissing = 0;

      let batch = writeBatch(db);
      let batchCount = 0;

      const commitBatch = async () => {
        if (batchCount === 0) return;
        await batch.commit();
        batch = writeBatch(db);
        batchCount = 0;
      };

      for (const d of bSnap.docs) {
        const b: any = d.data();
        const employeeUid = String(b?.employeeUid || "").trim();
        if (employeeUid) continue;

        const employeeId = String(b?.employeeId || "").trim();
        const employeeName = String(b?.employeeName || "").trim();
        const employeeEmail = String(b?.employeeEmail || "").trim().toLowerCase();

        // try matches in order: docId/employeeId -> name -> email
        let linkedUid =
          (employeeId && uidByDocId.get(employeeId)) ||
          (employeeName && uidByName.get(normalizeArabicName(employeeName))) ||
          (employeeEmail && uidByEmail.get(employeeEmail)) ||
          "";

        linkedUid = String(linkedUid || "").trim();

        if (!linkedUid) {
          stillMissing += 1;
          continue;
        }

        const ref = doc(db, "salons", SALON_ID, "bookings", d.id);
        batch.update(ref, {
          employeeUid: linkedUid,
          employeeKey: linkedUid,
          updatedAt: serverTimestamp(),
        });

        batchCount += 1;
        changed += 1;

        if (batchCount >= 450) await commitBatch();
      }

      await commitBatch();

      alert(
        `✅ تم الإصلاح الذكي\n` +
        `تم تحديث: ${changed} حجز\n` +
        `المتبقي بدون تطابق: ${stillMissing} حجز\n\n` +
        `ملاحظة: هذا الإصلاح يعتمد على linkedUid/uid داخل staff_public، ويدعم aliases لو كانت موجودة.`
      );
    } catch (e) {
      console.warn("smartFixBookingsEmployeeUid error:", e);
      setErrorMsg("تعذر الإصلاح الذكي (راجع Console)");
    } finally {
      setLoading(false);
    }
  };



  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    loadServiceOptions();
  }, []);

  // ✅ Owner-only: compute booking counts per staff_public doc
  useEffect(() => {
    let alive = true;

    const compute = async () => {
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
        console.log("[EmployeesStats] bookings=", rows.length, "staff=", list.length);

        const m: Record<string, StaffBookingStats> = {};

        for (const b of rows) {
          const eid = String((b as any).employeeId || "").trim();
          const euid = String((b as any).employeeUid || "").trim();
          const ekey = String((b as any).employeeKey || "").trim();
          const ename = String((b as any).employeeName || "").trim();

          let staffId: string | null = null;

          if (ekey && staffByKey.has(ekey)) staffId = staffByKey.get(ekey) || null;
          if (!staffId && euid && staffByKey.has(euid)) staffId = staffByKey.get(euid) || null;
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

  const toggleSpecialty = (serviceId: string) => {
    setSpecialties((prev) =>
      prev.includes(serviceId)
        ? prev.filter((x) => x !== serviceId)
        : [...prev, serviceId]
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
      cvUrl: cvUrl.trim(), // ✅ NEW
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

  /* =========================
     Render
  ========================= */
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
            <button
              className="exp-btn"
              onClick={fixBookingsEmployeeUid}
              disabled={loading}
              type="button"
              title="إضافة employeeUid/employeeKey للحجوزات القديمة"
            >
              إصلاح الحجوزات القديمة
            </button>

            <button
              className="exp-btn primary"
              onClick={openCreate}
              disabled={loading}
              type="button"
            >
              <FontAwesomeIcon icon={faPlus} /> إضافة موظفة
            </button>

            <button
              className="exp-btn"
              onClick={diagnoseMissingLinkedUid}
              disabled={loading}
              type="button"
              title="يعرض سبب الحجوزات اللي ما تنصلح"
            >
              تشخيص الحجوزات
            </button>

            <button
              className="exp-btn"
              onClick={smartFixBookingsEmployeeUid}
              disabled={loading}
              type="button"
              title="يحاول الإصلاح بمطابقة docId أو الاسم أو الإيميل"
            >
              إصلاح ذكي للحجوزات
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
              {serviceOptions.map((o) => (
                <option key={o.id} value={o.id}>
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

          {serviceOptions.length === 0 && (
            <div className="dash-meta" style={{ marginTop: 8, opacity: 0.8 }}>
              * ملاحظة: لا توجد خدمات مفعلة في الكتالوج. ادخل الإعدادات → إدارة الكتالوج وأضف خدمات.
            </div>
          )}
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

                {x.bio ? (
                  <div className="staff-bio">{x.bio}</div>
                ) : (
                  <div className="staff-bio muted">بدون نبذة</div>
                )}

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

                {/* ✅ Owner-only booking stats */}
                {authUser?.role === "owner" && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span className="staff-pill stat total">
                        الحجوزات:{" "}
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.total ?? 0)}
                        </b>
                      </span>

                      <span className="staff-pill stat confirmed">
                        مؤكد:{" "}
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.byStatus.confirmed ?? 0)}
                        </b>
                      </span>

                      <span className="staff-pill stat pending">
                        انتظار:{" "}
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.byStatus.pending ?? 0)}
                        </b>
                      </span>

                      <span className="staff-pill stat completed">
                        مكتمل:{" "}
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.byStatus.completed ?? 0)}
                        </b>
                      </span>

                      <span className="staff-pill stat cancelled">
                        ملغي:{" "}
                        <b style={{ marginInlineStart: 6 }}>
                          {statsLoading ? "..." : (bookingStats[x.id]?.byStatus.cancelled ?? 0)}
                        </b>
                      </span>
                    </div>

                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                      * تُحسب الإحصائيات عبر employeeKey/employeeUid ثم employeeId، وإلا مطابقة الاسم كت fallback.
                    </div>
                  </div>
                )}

                {(x as any).cvUrl ? (
                  <button
                    className="exp-btn"
                    type="button"
                    onClick={() => window.open((x as any).cvUrl, "_blank")}
                    title="عرض السيرة الذاتية"
                    style={{ marginTop: 10 }}
                  >
                    📄 عرض السيرة الذاتية
                  </button>
                ) : null}


                <div className="staff-id">ID: {x.id}</div>
              </div>
            ))}
        </div>

        {/* Modal */}
        {isOpen && (
          <Modal
            open={isOpen}
            onClose={closeModal}
            ariaLabel={editId ? "تعديل موظفة" : "إضافة موظفة"}
            panelClassName="modal-box"
            size="lg"
          >
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
                  <label>رابط السيرة الذاتية PDF (اختياري)</label>
                  <input
                    className="dash-input"
                    value={cvUrl}
                    onChange={(e) => setCvUrl(e.target.value)}
                    placeholder="https://...pdf"
                    dir="ltr"
                  />
                </div>


                <div className="dash-field">
                  <label>الخدمات (اختيار متعدد) ✅</label>
                  <div className="staff-picks">
                    {serviceOptions.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        className={`pick ${specialties.includes(o.id) ? "on" : ""}`}
                        onClick={() => toggleSpecialty(o.id)}
                        title={o.id}
                      >
                        {o.label}
                      </button>
                    ))}
                    {serviceOptions.length === 0 && (
                      <div style={{ padding: 10, opacity: 0.8 }}>
                        لا توجد خدمات مفعلة. أضف خدمات من الإعدادات → إدارة الكتالوج.
                      </div>
                    )}
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
          </Modal>
        )}
      </div>
    </div>
  );
}
