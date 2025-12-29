// ✅ src/pages/EmployeePortal.tsx
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBoxOpen,
  faRotateRight,
  faUsers,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import "../styles/EmployeePortal.css";

type UiRole = "owner" | "admin" | "reception" | "staff";

type AuthUser = {
  uid: string;
  email: string;
  role: UiRole;
  displayName: string;
};

type Priority = "normal" | "urgent";
type RequestStatus =
  | "new"
  | "in_review"
  | "approved"
  | "rejected"
  | "fulfilled";

type SupplyRequestItem = {
  name: string;
  qty: number;
  unit: string;
};

type SupplyRequestDoc = {
  createdAt: any;
  employeeUid: string;
  employeeName: string;
  department: string;
  priority: Priority;
  reason: string;
  note?: string;
  status: RequestStatus;
  items: SupplyRequestItem[];
};

type SupplyRequestUi = SupplyRequestDoc & { id: string };

// ✅ الموظفات من staff_public
type StaffPublic = {
  uid: string;
  name: string;
  specialties: string[];
  active: boolean;
};

const STATUS_LABEL: Record<RequestStatus, string> = {
  new: "جديد",
  in_review: "تحت المراجعة",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  fulfilled: "تم التوفير/التسليم",
};

const SPECIALTY_LABELS: Record<string, string> = {
  hair: "الشعر",
  coloring: "الصبغات",
  makeup: "المكياج",
  nails: "الأظافر",
  waxing: "الشمع",
};

function translateSpecialties(list: string[] = []) {
  return list.map((s) => SPECIALTY_LABELS[s] || s).join("، ");
}

function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export default function EmployeePortal() {
  const authUser = useMemo(() => getAuthUser(), []);

  const isStaff = authUser?.role === "staff";
  const canManageView =
    authUser?.role === "owner" ||
    authUser?.role === "admin" ||
    authUser?.role === "reception";

  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<SupplyRequestUi[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // ✅ staff_public
  const [staffList, setStaffList] = useState<StaffPublic[]>([]);
  const [selectedStaffUid, setSelectedStaffUid] = useState<string>("__ALL__");

  // ===== تحميل الموظفات من staff_public =====
  const loadStaffList = async () => {
    if (!canManageView) return;

    try {
      const qStaff = query(
        collection(db, "salons", "main", "staff_public"),
        where("active", "==", true),
        orderBy("name")
      );

      const snap = await getDocs(qStaff);

      const list: StaffPublic[] = snap.docs.map((d) => ({
        uid: d.id,
        ...(d.data() as any),
      }));

      setStaffList(list);
    } catch (e) {
      console.warn("loadStaffList error:", e);
      setStaffList([]);
    }
  };

  // ===== تحميل الطلبات =====
  const loadRequestsFor = async (uid: string) => {
    setLoading(true);
    setErrorMsg("");

    try {
      const qReq = query(
        collection(db, "supplyRequests"),
        where("employeeUid", "==", uid),
        orderBy("createdAt", "desc")
      );

      const snap = await getDocs(qReq);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));

      setRequests(list);
    } catch (e) {
      setErrorMsg("تعذر تحميل الطلبات");
    } finally {
      setLoading(false);
    }
  };

  const loadAllRequests = async () => {
    setLoading(true);
    setErrorMsg("");

    try {
      const qReq = query(
        collection(db, "supplyRequests"),
        orderBy("createdAt", "desc")
      );

      const snap = await getDocs(qReq);
      const list = snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as any),
      }));

      setRequests(list);
    } catch (e) {
      setErrorMsg("تعذر تحميل الطلبات");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!authUser) return;

    if (isStaff) return loadRequestsFor(authUser.uid);

    if (selectedStaffUid !== "__ALL__") {
      return loadRequestsFor(selectedStaffUid);
    }

    return loadAllRequests();
  };

  useEffect(() => {
    if (!authUser) return;

    if (canManageView) {
      loadStaffList();
      loadAllRequests();
    } else if (isStaff) {
      loadRequestsFor(authUser.uid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ep-wrap">
      <div className="dash-topbar">
        <h2>بوابة الموظفات</h2>

        <button onClick={refresh} className="ep-btn" disabled={loading}>
          <FontAwesomeIcon icon={faRotateRight} /> تحديث
        </button>
      </div>

      {errorMsg && <div className="ep-banner">{errorMsg}</div>}

      {/* ✅ فلترة إدارية */}
      {canManageView && (
        <div className="ep-card ep-card--filters">
          <div className="ep-card-title">
            <FontAwesomeIcon icon={faUsers} /> عرض طلبات الموظفات
          </div>

          <select
            value={selectedStaffUid}
            onChange={(e) => setSelectedStaffUid(e.target.value)}
            className="ep-filter-control"
          >
            <option value="__ALL__">الكل</option>

            {staffList.map((s) => (
              <option key={s.uid} value={s.uid}>
                {s.name} — {translateSpecialties(s.specialties)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* ✅ الطلبات */}
      <div className="ep-card">
        <div className="ep-card-title">
          <FontAwesomeIcon icon={faBoxOpen} /> الطلبات
        </div>

        {loading && <p>جاري التحميل…</p>}
        {!loading && requests.length === 0 && <p>لا توجد طلبات.</p>}

        <div className="ep-list">
          {requests.map((r) => (
            <div key={r.id} className="ep-item">
              <div className="ep-item-top">
                <b>{STATUS_LABEL[r.status]}</b>
                {!isStaff && <span> • {r.employeeName}</span>}
              </div>

              <div className="ep-item-meta">
                {r.department} • {r.reason}
              </div>

              <div className="ep-chips">
                {r.items.map((it, i) => (
                  <span key={i} className="ep-chip">
                    {it.name} × {it.qty} {it.unit}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
