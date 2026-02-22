import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDays, faChartLine, faClockRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";

import "../styles/DashboardReports.css";
import { db } from "../services/firebase";

type PeriodKey = "day" | "week" | "month" | "year" | "custom";
type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

type BookingRow = {
  id: string;
  publicId: string;
  date: string;
  time: string;
  status: BookingStatus;
  amount: number;
  employeeName: string;
  clientName: string;
};

type IncomeRow = {
  id: string;
  date: string;
  time: string;
  amount: number;
  source: string;
  bookingId: string;
  note: string;
  createdAtMs: number;
};

type ExpenseRow = {
  id: string;
  date: string;
  amount: number;
  category: string;
  title: string;
  note: string;
  addedBy: string;
  createdAtMs: number;
};

type RevenueDetailsRow = {
  id: string;
  date: string;
  time: string;
  source: "booking" | "manual" | "refund";
  mkRef: string;
  employeeName: string;
  amount: number;
  statusLabel: string;
};

const SALON_ID = "main";
const REVENUE_STATUSES = new Set<BookingStatus>(["confirmed", "completed"]);

function pad2(v: number) {
  return String(v).padStart(2, "0");
}

function toIsoDate(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseMillis(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const asNum = Number(v);
    if (Number.isFinite(asNum)) return asNum;
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof v?.toMillis === "function") return Number(v.toMillis()) || 0;
  if (typeof v?.seconds === "number") {
    return Number(v.seconds) * 1000 + Math.floor(Number(v.nanoseconds || 0) / 1e6);
  }
  return 0;
}

function formatMoney(v: number) {
  return `${Number(v || 0).toLocaleString("en-US")} ر.س`;
}

function formatDateTime(date: string, time: string) {
  const d = String(date || "").trim() || "-";
  const t = String(time || "").trim() || "-";
  return `${d} ${t}`;
}

function bookingStatusLabel(status: BookingStatus) {
  if (status === "confirmed") return "مؤكد";
  if (status === "completed") return "مكتمل";
  if (status === "cancelled") return "ملغي";
  return "انتظار";
}

function normalizeSource(raw: string) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "manual";
  if (s === "booking" || s === "invoice" || s === "حجز") return "booking";
  if (s === "refund" || s === "استرجاع") return "refund";
  return "manual";
}

function getRange(period: PeriodKey, customFrom: string, customTo: string) {
  const now = new Date();
  const today = toIsoDate(now);

  if (period === "day") return { from: today, to: today };

  if (period === "week") {
    const day = now.getDay(); // 0=Sun
    const start = new Date(now);
    start.setDate(now.getDate() - day);
    return { from: toIsoDate(start), to: today };
  }

  if (period === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: toIsoDate(start), to: today };
  }

  if (period === "year") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: toIsoDate(start), to: today };
  }

  const from = String(customFrom || "").trim();
  const to = String(customTo || "").trim();
  if (!from && !to) return { from: today, to: today };
  if (!from) return { from: to, to };
  if (!to) return { from, to: from };
  return from <= to ? { from, to } : { from: to, to: from };
}

function inDateRange(dateIso: string, from: string, to: string) {
  const d = String(dateIso || "").trim();
  if (!d) return false;
  return d >= from && d <= to;
}

export default function DashboardReports() {
  const [period, setPeriod] = useState<PeriodKey>("day");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSyncMs, setLastSyncMs] = useState<number>(Date.now());
  const [loadErr, setLoadErr] = useState("");

  const range = useMemo(
    () => getRange(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  useEffect(() => {
    let pending = 3;
    setLoading(true);
    setLoadErr("");

    const done = () => {
      pending -= 1;
      if (pending <= 0) setLoading(false);
    };

    const bookingsQ = query(
      collection(db, "salons", SALON_ID, "bookings"),
      orderBy("createdAt", "desc")
    );
    const incomeQ = query(
      collection(db, "salons", SALON_ID, "income"),
      orderBy("createdAt", "desc")
    );
    const expensesQ = query(
      collection(db, "salons", SALON_ID, "expenses"),
      orderBy("createdAt", "desc")
    );

    const unsubBookings = onSnapshot(
      bookingsQ,
      (snap) => {
        const rows: BookingRow[] = snap.docs.map((d) => {
          const raw = d.data() as any;
          const date = String(raw?.date || "").trim();
          return {
            id: d.id,
            publicId: String(raw?.publicId || raw?.trackPublicId || "").trim(),
            date,
            time: String(raw?.time || "").trim(),
            status: String(raw?.status || "pending").trim() as BookingStatus,
            amount: Number(raw?.finalPrice ?? raw?.total ?? raw?.serviceSnapshot?.priceAtBooking ?? 0) || 0,
            employeeName: String(raw?.employeeName || "").trim(),
            clientName: String(raw?.clientName || raw?.name || raw?.customerName || "").trim(),
          };
        });
        setBookings(rows);
        setLastSyncMs(Date.now());
        done();
      },
      (err) => {
        setLoadErr(String(err?.message || err || "تعذر تحميل الحجوزات"));
        done();
      }
    );

    const unsubIncome = onSnapshot(
      incomeQ,
      (snap) => {
        const rows: IncomeRow[] = snap.docs.map((d) => {
          const raw = d.data() as any;
          const createdAtMs = parseMillis(raw?.createdAt || raw?.updatedAt);
          const date = String(raw?.date || "").trim() || (createdAtMs ? toIsoDate(new Date(createdAtMs)) : "");
          const time = createdAtMs
            ? new Intl.DateTimeFormat("ar-SA", {
                hour: "2-digit",
                minute: "2-digit",
              }).format(new Date(createdAtMs))
            : "";

          return {
            id: d.id,
            date,
            time,
            amount: Number(raw?.amount ?? 0) || 0,
            source: String(raw?.source || "").trim(),
            bookingId: String(raw?.bookingId || "").trim(),
            note: String(raw?.note || "").trim(),
            createdAtMs,
          };
        });
        setIncomeRows(rows);
        setLastSyncMs(Date.now());
        done();
      },
      (err) => {
        setLoadErr(String(err?.message || err || "تعذر تحميل الإيرادات"));
        done();
      }
    );

    const unsubExpenses = onSnapshot(
      expensesQ,
      (snap) => {
        const rows: ExpenseRow[] = snap.docs.map((d) => {
          const raw = d.data() as any;
          const createdAtMs = parseMillis(raw?.createdAt || raw?.updatedAt);
          return {
            id: d.id,
            date:
              String(raw?.date || "").trim() ||
              (createdAtMs ? toIsoDate(new Date(createdAtMs)) : ""),
            amount: Number(raw?.amount ?? 0) || 0,
            category: String(raw?.category || "أخرى").trim() || "أخرى",
            title: String(raw?.title || "").trim(),
            note: String(raw?.note || "").trim(),
            addedBy: String(
              raw?.createdByName || raw?.addedBy || raw?.createdBy || raw?.createdByUid || "-"
            ).trim() || "-",
            createdAtMs,
          };
        });
        setExpenses(rows);
        setLastSyncMs(Date.now());
        done();
      },
      (err) => {
        setLoadErr(String(err?.message || err || "تعذر تحميل المصروفات"));
        done();
      }
    );

    return () => {
      unsubBookings();
      unsubIncome();
      unsubExpenses();
    };
  }, []);

  const bookingById = useMemo(() => {
    const map: Record<string, BookingRow> = {};
    bookings.forEach((b) => {
      map[b.id] = b;
    });
    return map;
  }, [bookings]);

  const bookingRevenueRows = useMemo(
    () =>
      bookings.filter(
        (b) => REVENUE_STATUSES.has(b.status) && inDateRange(b.date, range.from, range.to)
      ),
    [bookings, range.from, range.to]
  );

  const manualIncomeRows = useMemo(() => {
    return incomeRows.filter((x) => {
      if (!inDateRange(x.date, range.from, range.to)) return false;
      const source = normalizeSource(x.source);
      const isLinkedBooking = !!String(x.bookingId || "").trim() || source === "booking";
      const isRefund = source === "refund" || x.amount < 0 || String(x.id || "").startsWith("refund_");
      if (isLinkedBooking) return false;
      if (isRefund) return false;
      return Number(x.amount || 0) > 0;
    });
  }, [incomeRows, range.from, range.to]);

  const refundRows = useMemo(() => {
    return incomeRows.filter((x) => {
      if (!inDateRange(x.date, range.from, range.to)) return false;
      const source = normalizeSource(x.source);
      return source === "refund" || x.amount < 0 || String(x.id || "").startsWith("refund_");
    });
  }, [incomeRows, range.from, range.to]);

  const expensesInRange = useMemo(
    () => expenses.filter((x) => inDateRange(x.date, range.from, range.to)),
    [expenses, range.from, range.to]
  );

  const revenueRowsDetailed = useMemo<RevenueDetailsRow[]>(() => {
    const fromBookings: RevenueDetailsRow[] = bookingRevenueRows.map((b) => ({
      id: `booking_${b.id}`,
      date: b.date,
      time: b.time || "-",
      source: "booking",
      mkRef: b.publicId || "-",
      employeeName: b.employeeName || "-",
      amount: Number(b.amount || 0),
      statusLabel: bookingStatusLabel(b.status),
    }));

    const fromManual: RevenueDetailsRow[] = manualIncomeRows.map((x) => ({
      id: `manual_${x.id}`,
      date: x.date,
      time: x.time || "-",
      source: "manual",
      mkRef: "-",
      employeeName: "-",
      amount: Number(x.amount || 0),
      statusLabel: "دخل يدوي",
    }));

    const fromRefund: RevenueDetailsRow[] = refundRows.map((x) => {
      const linked = bookingById[String(x.bookingId || "").trim()];
      return {
        id: `refund_${x.id}`,
        date: x.date,
        time: x.time || "-",
        source: "refund",
        mkRef: linked?.publicId || "-",
        employeeName: linked?.employeeName || "-",
        amount: Number(x.amount || 0),
        statusLabel: "استرجاع",
      };
    });

    return [...fromBookings, ...fromManual, ...fromRefund].sort((a, b) => {
      const aKey = `${a.date} ${a.time}`;
      const bKey = `${b.date} ${b.time}`;
      return bKey.localeCompare(aKey);
    });
  }, [bookingRevenueRows, manualIncomeRows, refundRows, bookingById]);

  const totals = useMemo(() => {
    const bookingsRevenue = bookingRevenueRows.reduce((s, x) => s + Number(x.amount || 0), 0);
    const manualRevenue = manualIncomeRows.reduce((s, x) => s + Number(x.amount || 0), 0);
    const refunds = refundRows.reduce((s, x) => s + Number(x.amount || 0), 0);
    const revenue = bookingsRevenue + manualRevenue + refunds;
    const expensesTotal = expensesInRange.reduce((s, x) => s + Number(x.amount || 0), 0);
    const net = revenue - expensesTotal;
    return { revenue, expenses: expensesTotal, net };
  }, [bookingRevenueRows, manualIncomeRows, refundRows, expensesInRange]);

  const chartModel = useMemo(() => {
    const revByDate: Record<string, number> = {};
    const expByDate: Record<string, number> = {};

    revenueRowsDetailed.forEach((r) => {
      const key = String(r.date || "").trim();
      if (!key) return;
      revByDate[key] = (revByDate[key] || 0) + Number(r.amount || 0);
    });
    expensesInRange.forEach((e) => {
      const key = String(e.date || "").trim();
      if (!key) return;
      expByDate[key] = (expByDate[key] || 0) + Number(e.amount || 0);
    });

    const fromD = new Date(`${range.from}T00:00:00`);
    const toD = new Date(`${range.to}T00:00:00`);
    const labels: string[] = [];
    const cursor = new Date(fromD);
    while (cursor <= toD) {
      labels.push(toIsoDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
      if (labels.length > 500) break;
    }

    if (!labels.length) labels.push(range.from);

    const points = labels.map((date) => {
      const revenue = Number(revByDate[date] || 0);
      const expense = Number(expByDate[date] || 0);
      const net = revenue - expense;
      return { date, revenue, expense, net };
    });

    const values = points.flatMap((p) => [0, p.revenue, p.expense, p.net]);
    let minVal = Math.min(0, ...values);
    let maxVal = Math.max(0, ...values);
    if (maxVal === minVal) {
      maxVal += 1;
      minVal -= 1;
    }

    const width = Math.max(840, points.length * 38);
    const height = 300;
    const padX = 50;
    const padY = 28;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;
    const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;

    const yOf = (v: number) => padY + ((maxVal - v) / (maxVal - minVal)) * plotH;
    const xOf = (idx: number) => padX + idx * stepX;
    const yZero = yOf(0);

    const toPath = (pick: (p: (typeof points)[number]) => number) =>
      points
        .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(2)} ${yOf(pick(p)).toFixed(2)}`)
        .join(" ");

    const barSlot = Math.max(16, Math.min(26, stepX * 0.72 || 22));
    const barW = Math.max(6, Math.floor((barSlot - 4) / 2));

    const bars = points.map((p, i) => {
      const cx = xOf(i);
      const revY = yOf(p.revenue);
      const expY = yOf(p.expense);
      const netY = yOf(p.net);

      return {
        date: p.date,
        revenue: p.revenue,
        expense: p.expense,
        net: p.net,
        revenueRect: {
          x: cx - barW - 1,
          y: Math.min(yZero, revY),
          w: barW,
          h: Math.max(1, Math.abs(yZero - revY)),
        },
        expenseRect: {
          x: cx + 1,
          y: Math.min(yZero, expY),
          w: barW,
          h: Math.max(1, Math.abs(yZero - expY)),
        },
        netDot: { x: cx, y: netY },
      };
    });

    const gridTicks = 5;
    const gridLines = Array.from({ length: gridTicks }, (_, i) => {
      const ratio = i / (gridTicks - 1);
      const value = maxVal - ratio * (maxVal - minVal);
      return { y: yOf(value), value };
    });

    const stride = Math.max(1, Math.ceil(points.length / 10));

    return {
      points: bars,
      width,
      height,
      padX,
      yZero,
      minVal,
      maxVal,
      gridLines,
      revenuePath: toPath((p) => p.revenue),
      expensePath: toPath((p) => p.expense),
      netPath: toPath((p) => p.net),
      xOf,
      yOf,
      stride,
    };
  }, [revenueRowsDetailed, expensesInRange, range.from, range.to]);

  const lastSyncLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ar-SA", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(lastSyncMs)),
    [lastSyncMs]
  );

  return (
    <div className="reports-v2">
      <div className="reports-v2__header">
        <div>
          <h1>اللوحة المالية</h1>
          <p>
            المصدر الرسمي: إيراد الحجوزات من الحجوزات (مؤكد/مكتمل) + دخل يدوي/استرجاع من income، والمصروفات من expenses.
          </p>
          <small className="reports-v2__sync">
            <FontAwesomeIcon icon={faClockRotateLeft} /> آخر مزامنة: {lastSyncLabel}
          </small>
        </div>
      </div>

      <div className="reports-v2__filters">
        <button
          className={`f-btn ${period === "day" ? "is-active" : ""}`}
          onClick={() => setPeriod("day")}
          type="button"
        >
          اليوم
        </button>
        <button
          className={`f-btn ${period === "week" ? "is-active" : ""}`}
          onClick={() => setPeriod("week")}
          type="button"
        >
          هذا الأسبوع
        </button>
        <button
          className={`f-btn ${period === "month" ? "is-active" : ""}`}
          onClick={() => setPeriod("month")}
          type="button"
        >
          هذا الشهر
        </button>
        <button
          className={`f-btn ${period === "year" ? "is-active" : ""}`}
          onClick={() => setPeriod("year")}
          type="button"
        >
          هذه السنة
        </button>
        <button
          className={`f-btn ${period === "custom" ? "is-active" : ""}`}
          onClick={() => setPeriod("custom")}
          type="button"
        >
          فترة مخصصة
        </button>

        {period === "custom" && (
          <div className="reports-v2__custom-range">
            <label>
              من
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label>
              إلى
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </div>
        )}

        <div className="reports-v2__range-caption">
          <FontAwesomeIcon icon={faCalendarDays} /> الفترة: {range.from} إلى {range.to}
        </div>
      </div>

      <div className="reports-v2__kpis">
        <article className="kpi kpi-revenue">
          <h3>إجمالي الإيرادات</h3>
          <strong>{formatMoney(totals.revenue)}</strong>
        </article>
        <article className="kpi kpi-expense">
          <h3>إجمالي المصروفات</h3>
          <strong>{formatMoney(totals.expenses)}</strong>
        </article>
        <article className={`kpi kpi-net ${totals.net >= 0 ? "is-positive" : "is-negative"}`}>
          <h3>صافي الربح / الخسارة</h3>
          <strong>{formatMoney(totals.net)}</strong>
        </article>
      </div>

      <section className="reports-v2__section">
        <div className="section-head">
          <h2>
            <FontAwesomeIcon icon={faChartLine} /> الرسم البياني المالي
          </h2>
          <span>يوميًا حسب الفلتر الحالي</span>
        </div>
        <div className="reports-v2__legend">
          <span><i className="lg lg-rev" /> الإيراد</span>
          <span><i className="lg lg-exp" /> المصروف</span>
          <span><i className="lg lg-net" /> الصافي</span>
        </div>
        <div className="reports-v2__chart-wrap">
          <svg
            className="reports-v2__chart"
            viewBox={`0 0 ${chartModel.width} ${chartModel.height}`}
            preserveAspectRatio="none"
          >
            {chartModel.gridLines.map((g, idx) => (
              <g key={`grid_${idx}`}>
                <line
                  x1={chartModel.padX}
                  y1={g.y}
                  x2={chartModel.width - chartModel.padX}
                  y2={g.y}
                  className="chart-grid"
                />
                <text x={8} y={g.y - 3} className="chart-y-label">
                  {Math.round(g.value)}
                </text>
              </g>
            ))}

            <line
              x1={chartModel.padX}
              y1={chartModel.yZero}
              x2={chartModel.width - chartModel.padX}
              y2={chartModel.yZero}
              className="chart-zero"
            />
            {chartModel.points.map((p) => (
              <g key={`bars_${p.date}`}>
                <rect
                  x={p.revenueRect.x}
                  y={p.revenueRect.y}
                  width={p.revenueRect.w}
                  height={p.revenueRect.h}
                  className="bar-revenue"
                />
                <rect
                  x={p.expenseRect.x}
                  y={p.expenseRect.y}
                  width={p.expenseRect.w}
                  height={p.expenseRect.h}
                  className="bar-expense"
                />
              </g>
            ))}
            <path d={chartModel.revenuePath} className="line-revenue" />
            <path d={chartModel.expensePath} className="line-expense" />
            <path d={chartModel.netPath} className="line-net" />
            {chartModel.points.map((p) => (
              <circle
                key={`net_dot_${p.date}`}
                cx={p.netDot.x}
                cy={p.netDot.y}
                r={2.8}
                className="dot-net"
              />
            ))}

            {chartModel.points.map((p, i) => {
              if (i % chartModel.stride !== 0 && i !== chartModel.points.length - 1) return null;
              return (
                <text
                  key={`x_lbl_${p.date}_${i}`}
                  x={chartModel.xOf(i)}
                  y={chartModel.height - 4}
                  textAnchor="middle"
                  className="chart-x-label"
                >
                  {p.date.slice(5)}
                </text>
              );
            })}
          </svg>
        </div>
      </section>

      {loadErr ? <div className="reports-v2__error">{loadErr}</div> : null}

      <section className="reports-v2__section">
        <div className="section-head">
          <h2>
            <FontAwesomeIcon icon={faChartLine} /> تفاصيل الإيرادات
          </h2>
          <span>عدد الحركات: {revenueRowsDetailed.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>التاريخ/الوقت</th>
                <th>المصدر</th>
                <th>رقم الحجز MK</th>
                <th>الموظفة</th>
                <th>المبلغ</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {revenueRowsDetailed.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">لا توجد بيانات إيراد داخل الفترة.</td>
                </tr>
              ) : (
                revenueRowsDetailed.map((row) => (
                  <tr key={row.id}>
                    <td data-label="التاريخ/الوقت">{formatDateTime(row.date, row.time)}</td>
                    <td data-label="المصدر">
                      {row.source === "booking" ? "حجز" : row.source === "refund" ? "استرجاع" : "يدوي"}
                    </td>
                    <td data-label="رقم الحجز MK">{row.mkRef}</td>
                    <td data-label="الموظفة">{row.employeeName || "-"}</td>
                    <td data-label="المبلغ" className={row.amount < 0 ? "amount-neg" : "amount-pos"}>
                      {formatMoney(row.amount)}
                    </td>
                    <td data-label="الحالة">{row.statusLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="reports-v2__section">
        <div className="section-head">
          <h2>تفاصيل المصروفات</h2>
          <span>عدد السجلات: {expensesInRange.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>التصنيف</th>
                <th>الوصف</th>
                <th>المبلغ</th>
                <th>من أضافه</th>
              </tr>
            </thead>
            <tbody>
              {expensesInRange.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-cell">لا توجد مصروفات داخل الفترة.</td>
                </tr>
              ) : (
                expensesInRange
                  .slice()
                  .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                  .map((row) => (
                    <tr key={row.id}>
                      <td data-label="التاريخ">{row.date}</td>
                      <td data-label="التصنيف">{row.category || "أخرى"}</td>
                      <td data-label="الوصف">{row.title || row.note || "-"}</td>
                      <td data-label="المبلغ" className="amount-exp">{formatMoney(row.amount)}</td>
                      <td data-label="من أضافه">{row.addedBy || "-"}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {loading ? <div className="reports-v2__loading">جاري مزامنة البيانات...</div> : null}
    </div>
  );
}
