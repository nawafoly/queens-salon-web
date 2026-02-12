import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClockRotateLeft,
  faFilter,
  faMagnifyingGlass,
  faRotateRight,
  faTriangleExclamation,
  faChevronDown,
  faChevronUp,
} from "@fortawesome/free-solid-svg-icons";

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
  logId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  description?: string;
  userName?: string;
  userUid?: string;
  userRole?: string;
  userEmail?: string;
  source?: string;
  createdAt?: any;
  before?: any;
  after?: any;
  meta?: any;
  sensitive?: boolean;

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

function dayKey(ms: number) {
  if (!ms) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function detectSensitiveLocal(row: LogRow) {
  if (row.sensitive === true) return true;
  const text = `${row.action || ""} ${row.description || ""} ${JSON.stringify(row.meta || {})}`.toLowerCase();
  return (
    text.includes("delete") ||
    text.includes("حذف") ||
    text.includes("price") ||
    text.includes("سعر") ||
    text.includes("amount") ||
    text.includes("مالي") ||
    text.includes("role") ||
    text.includes("صلاح")
  );
}

const SALON_ID = "main";

export default function DashboardLogs() {
  const authUser = useMemo(() => getAuthUser(), []);
  const canManage = authUser?.role === "owner" || authUser?.role === "admin";

  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [errMsg, setErrMsg] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [qText, setQText] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [onlySensitive, setOnlySensitive] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [maxRows, setMaxRows] = useState<number>(300);

  const load = async () => {
    setLoading(true);
    setErrMsg("");

    try {
      const colRef = collection(db, "salons", SALON_ID, "logs");
      const q = query(colRef, orderBy("createdAt", "desc"), limit(Math.max(50, Math.min(1000, maxRows))));
      const snap = await getDocs(q);

      const list: LogRow[] = snap.docs.map((d) => {
        const x: any = d.data();
        const atMs = safeMs(x?.createdAt);
        return {
          id: d.id,
          logId: String(x?.logId || d.id),
          action: String(x?.action || x?.type || ""),
          entityType: String(x?.entityType || x?.entity || ""),
          entityId: String(x?.entityId || ""),
          description: String(x?.description || x?.note || ""),
          userName: String(x?.userName || ""),
          userUid: String(x?.userUid || x?.byUid || ""),
          userRole: String(x?.userRole || x?.byRole || ""),
          userEmail: String(x?.userEmail || x?.byEmail || ""),
          source: String(x?.source || ""),
          createdAt: x?.createdAt || x?.at,
          before: x?.before,
          after: x?.after,
          meta: x?.meta,
          sensitive: Boolean(x?.sensitive),
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
          ? "⚠️ الصلاحيات تمنع قراءة السجل. لازم Rules تسمح فقط للأونر/الأدمن بقراءة salons/main/logs."
          : "❌ تعذر تحميل سجل العمليات:\n" + msg
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canManage) return;
    load();
  }, [canManage, maxRows]);

  const actionOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const t = String(r.action || "").trim();
      if (t) s.add(t);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const entityOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const t = String(r.entityType || "").trim();
      if (t) s.add(t);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const userOptions = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      const u = String(r.userName || r.userEmail || r.userUid || "").trim();
      if (u) s.add(u);
    });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const t = qText.trim().toLowerCase();

    return rows.filter((r) => {
      if (actionFilter !== "all" && String(r.action || "") !== actionFilter) return false;
      if (entityFilter !== "all" && String(r.entityType || "") !== entityFilter) return false;
      if (sourceFilter !== "all" && String(r.source || "") !== sourceFilter) return false;

      const userToken = String(r.userName || r.userEmail || r.userUid || "");
      if (userFilter !== "all" && userToken !== userFilter) return false;

      const isSensitive = detectSensitiveLocal(r);
      if (onlySensitive && !isSensitive) return false;

      const dk = dayKey(r.atMs);
      if (fromDate && dk && dk < fromDate) return false;
      if (toDate && dk && dk > toDate) return false;

      if (!t) return true;

      const hay = String(
        `${r.logId || ""} ${r.action || ""} ${r.entityType || ""} ${r.entityId || ""} ${r.userName || ""} ${r.userEmail || ""} ${r.userUid || ""} ${r.userRole || ""} ${r.description || ""} ${r.source || ""}`
      ).toLowerCase();

      return hay.includes(t);
    });
  }, [rows, qText, actionFilter, entityFilter, userFilter, sourceFilter, fromDate, toDate, onlySensitive]);

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
            <p>سجل العمليات للأونر/الأدمن فقط.</p>
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
              <FontAwesomeIcon icon={faClockRotateLeft} /> سجل العمليات التشغيلي
            </h2>
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
                placeholder="بحث بالنص داخل الوصف / المستخدم / نوع العملية ..."
              />
            </div>

            <div className="logs-select">
              <FontAwesomeIcon icon={faFilter} />
              <select className="dash-select" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
                <option value="all">كل العمليات</option>
                {actionOptions.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>

            <select className="dash-select" value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}>
              <option value="all">كل العناصر</option>
              {entityOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>

            <select className="dash-select" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="all">كل المستخدمين</option>
              {userOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>

            <select className="dash-select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">كل المصادر</option>
              <option value="dashboard">dashboard</option>
              <option value="internal_booking">internal_booking</option>
              <option value="client_app">client_app</option>
              <option value="system">system</option>
            </select>

            <input className="dash-input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            <input className="dash-input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />

            <label className="logs-sensitive-filter">
              <input type="checkbox" checked={onlySensitive} onChange={(e) => setOnlySensitive(e.target.checked)} />
              العمليات الحساسة فقط
            </label>

            <select className="dash-select" value={String(maxRows)} onChange={(e) => setMaxRows(Number(e.target.value))}>
              <option value="100">100</option>
              <option value="300">300</option>
              <option value="500">500</option>
              <option value="800">800</option>
              <option value="1000">1000</option>
            </select>

            <div className="logs-meta">
              المعروض: <b>{filtered.length}</b> • الإجمالي: <b>{rows.length}</b>
              {loading ? <span className="logs-loading"> • تحميل...</span> : null}
            </div>
          </div>

          {filtered.length === 0 && !loading ? (
            <div className="logs-empty">ما فيه عمليات مسجلة ضمن الفلاتر الحالية.</div>
          ) : (
            <div className="logs-table">
              <div className="logs-head">
                <div>الوقت</div>
                <div>العملية</div>
                <div>العنصر</div>
                <div>المستخدم</div>
                <div>المصدر</div>
                <div>الوصف</div>
                <div>تفاصيل</div>
              </div>

              {filtered.map((r) => {
                const sensitive = detectSensitiveLocal(r);
                const expanded = expandedId === r.id;

                return (
                  <div key={r.id} className={`logs-row ${sensitive ? "logs-row--sensitive" : ""}`}>
                    <div className="logs-time">{fmtDateTime(r.atMs)}</div>
                    <div className="logs-type">
                      {sensitive ? <FontAwesomeIcon className="logs-sensitive-icon" icon={faTriangleExclamation} /> : null}
                      {r.action || "-"}
                    </div>
                    <div className="logs-entity">{r.entityType || "-"}</div>
                    <div className="logs-user">{r.userName || r.userEmail || (r.userUid ? String(r.userUid).slice(0, 8) : "-")}</div>
                    <div className="logs-source">{r.source || "-"}</div>
                    <div className="logs-note">{r.description || "-"}</div>
                    <div>
                      <button
                        className="logs-expand-btn"
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : r.id)}
                      >
                        {expanded ? <FontAwesomeIcon icon={faChevronUp} /> : <FontAwesomeIcon icon={faChevronDown} />}
                        {expanded ? "إخفاء" : "عرض"}
                      </button>
                    </div>

                    {expanded ? (
                      <div className="logs-details" role="region" aria-label="تفاصيل السجل">
                        <div className="logs-detail-grid">
                          <div>
                            <h4>before</h4>
                            <pre>{JSON.stringify(r.before ?? null, null, 2)}</pre>
                          </div>
                          <div>
                            <h4>after</h4>
                            <pre>{JSON.stringify(r.after ?? null, null, 2)}</pre>
                          </div>
                        </div>
                        <div className="logs-meta-json">
                          <h4>meta</h4>
                          <pre>{JSON.stringify(r.meta ?? null, null, 2)}</pre>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
