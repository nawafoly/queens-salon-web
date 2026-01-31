// ✅ src/pages/DashboardLogs.tsx
import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClockRotateLeft, faFilter, faMagnifyingGlass, faRotateRight } from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import "../styles/Dashboard.css";
import "../styles/DashboardLogs.css";

type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

type AuthUser = {
  uid: string;
  email: string;
  role: UiRole;
  displayName?: string;
};

function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

type LogRow = {
  id: string;
  type?: string;
  entity?: string;
  entityId?: string;
  note?: string;

  byUid?: string;
  byEmail?: string;
  byRole?: string;

  at?: any;
  meta?: any;

  atMs: number;
};

function safeMs(ts: any): number {
  try {
    if (!ts) return 0;
    if (typeof ts?.toMillis === "function") return ts.toMillis();
    if (typeof ts === "number") return ts;
    return 0;
  } catch {
    return 0;
  }
}

function fmtDateTime(ms: number) {
  if (!ms) return "-";
  const d = new Date(ms);
  return d.toLocaleString("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SALON_ID = "main";

export default function DashboardLogs() {
  const authUser = useMemo(() => getAuthUser(), []);
  const canManage = authUser?.role === "owner" || authUser?.role === "admin";

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [errMsg, setErrMsg] = useState("");

  const [qText, setQText] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [maxRows, setMaxRows] = useState<number>(300);

  const load = async () => {
    setLoading(true);
    setErrMsg("");

    try {
      const colRef = collection(db, "salons", SALON_ID, "logs");
      const q = query(colRef, orderBy("at", "desc"), limit(Math.max(50, Math.min(800, maxRows))));
      const snap = await getDocs(q);

      const list: LogRow[] = snap.docs.map((d) => {
        const x: any = d.data();
        const atMs = safeMs(x?.at);
        return {
          id: d.id,
          ...x,
          atMs,
        };
      });

      list.sort((a, b) => (b.atMs || 0) - (a.atMs || 0));
      setRows(list);
    } catch (e: any) {
      console.warn("DashboardLogs load error:", e);
      const msg = String(e?.message || e);
      setErrMsg(
        msg.includes("Missing or insufficient permissions")
          ? "⚠️ الصلاحيات تمنع قراءة السجل. لازم Rules تسمح للأونر/الأدمن بقراءة salons/main/logs."
          : "❌ تعذر تحميل السجل:\n" + msg
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManage) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, maxRows]);
  

  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const t = String(r.type || "").trim();
      if (t) s.add(t);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const entityOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const t = String(r.entity || "").trim();
      if (t) s.add(t);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();

    return rows.filter((r) => {
      if (typeFilter !== "all" && String(r.type || "") !== typeFilter) return false;
      if (entityFilter !== "all" && String(r.entity || "") !== entityFilter) return false;

      if (!t) return true;

      const hay = String(
        `${r.type || ""} ${r.entity || ""} ${r.entityId || ""} ${r.byEmail || ""} ${r.byUid || ""} ${r.byRole || ""} ${r.note || ""}`
      ).toLowerCase();

      return hay.includes(t);
    });
  }, [rows, qText, typeFilter, entityFilter]);

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
            <p>سجل الحركات للأونر/الأدمن فقط.</p>
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
              <FontAwesomeIcon icon={faClockRotateLeft} /> سجل الحركات
            </h2>
            <p className="dash-sub">
              المصدر: <b>salons/main/logs</b>
            </p>
          </div>

          <div className="dash-topbar-actions">
            <button className="exp-btn" onClick={load} disabled={loading} type="button">
              <FontAwesomeIcon icon={faRotateRight} /> تحديث
            </button>
          </div>
        </div>

        {errMsg && <div className="dash-alert">{errMsg}</div>}

        <div className="dash-card logs-card">
          <div className="logs-filters">
            <div className="logs-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                className="dash-input"
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="بحث: نوع / كيان / رقم / ايميل / ملاحظة..."
              />
            </div>

            <div className="logs-select">
              <FontAwesomeIcon icon={faFilter} />
              <select className="dash-select" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
                <option value="all">كل الكيانات</option>
                {entityOptions.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>

            <select className="dash-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">كل الأنواع</option>
              {typeOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>

            <select className="dash-select" value={String(maxRows)} onChange={(e) => setMaxRows(Number(e.target.value))}>
              <option value="100">100</option>
              <option value="300">300</option>
              <option value="500">500</option>
              <option value="800">800</option>
            </select>

            <div className="logs-meta">
              المعروض: <b>{filtered.length}</b> • الإجمالي: <b>{rows.length}</b>
              {loading ? <span className="logs-loading"> • تحميل...</span> : null}
            </div>
          </div>

          {filtered.length === 0 && !loading ? (
            <div className="logs-empty">ما فيه حركات مسجلة حتى الآن.</div>
          ) : (
            <div className="logs-table">
              <div className="logs-head">
                <div>الوقت</div>
                <div>النوع</div>
                <div>الكيان</div>
                <div>الرقم</div>
                <div>المستخدم</div>
                <div>الملاحظة</div>
              </div>

              {filtered.map((r) => (
                <div key={r.id} className="logs-row">
                  <div className="logs-time">{fmtDateTime(r.atMs)}</div>
                  <div className="logs-type">{r.type || "-"}</div>
                  <div className="logs-entity">{r.entity || "-"}</div>
                  <div className="logs-id">{r.entityId || "-"}</div>
                  <div className="logs-user">{r.byEmail || (r.byUid ? String(r.byUid).slice(0, 8) : "-")}</div>
                  <div className="logs-note">{r.note || "-"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
