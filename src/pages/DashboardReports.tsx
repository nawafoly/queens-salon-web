import { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCalendarDays, faChartLine, faClockRotateLeft } from "@fortawesome/free-solid-svg-icons";
import { collection, onSnapshot } from "firebase/firestore";

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
const MONTHS_AR = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

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

function toMonthKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function monthLabelAr(monthKey: string) {
  const y = Number(monthKey.slice(0, 4));
  const m = Number(monthKey.slice(5, 7));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthKey;
  return `${MONTHS_AR[m - 1]} ${y}`;
}

function formatDeltaPct(v: number) {
  if (!Number.isFinite(v)) return "-";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function calcDeltaPct(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 0;
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function niceCeil(v: number) {
  const x = Number(v || 0);
  if (x <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(x));
  const normalized = x / magnitude;
  let nice = 1;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

function niceFloor(v: number) {
  const x = Number(v || 0);
  if (x >= 0) return 0;
  return -niceCeil(Math.abs(x));
}

function formatAxisNumber(v: number) {
  return Math.round(Number(v || 0)).toLocaleString("en-US");
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const span = Math.abs(endDeg - startDeg);
  // SVG arc cannot draw a full 360deg circle in a single arc command.
  if (span >= 359.999) {
    return [
      `M ${cx - r} ${cy}`,
      `A ${r} ${r} 0 1 0 ${cx + r} ${cy}`,
      `A ${r} ${r} 0 1 0 ${cx - r} ${cy}`,
      "Z",
    ].join(" ");
  }
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startDeg));
  const y1 = cy + r * Math.sin(rad(startDeg));
  const x2 = cx + r * Math.cos(rad(endDeg));
  const y2 = cy + r * Math.sin(rad(endDeg));
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

export default function DashboardReports() {
  const [period, setPeriod] = useState<PeriodKey>("day");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [trendMode, setTrendMode] = useState<"month" | "day">("month");

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

    const bookingsQ = collection(db, "salons", SALON_ID, "bookings");
    const incomeQ = collection(db, "salons", SALON_ID, "income");
    const expensesQ = collection(db, "salons", SALON_ID, "expenses");

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

  const monthCompare = useMemo(() => {
    const base = String(range.to || "").trim();
    const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(base) ? new Date(`${base}T00:00:00`) : new Date();
    const safeBaseDate = Number.isFinite(baseDate.getTime()) ? baseDate : new Date();
    const currentKey = toMonthKey(safeBaseDate);
    const prevDate = new Date(safeBaseDate.getFullYear(), safeBaseDate.getMonth() - 1, 1);
    const previousKey = toMonthKey(prevDate);

    const bookingRevenueByMonth = (key: string) =>
      bookings
        .filter((b) => REVENUE_STATUSES.has(b.status) && String(b.date || "").startsWith(`${key}-`))
        .reduce((s, x) => s + Number(x.amount || 0), 0);

    const manualRevenueByMonth = (key: string) =>
      incomeRows
        .filter((x) => {
          if (!String(x.date || "").startsWith(`${key}-`)) return false;
          const source = normalizeSource(x.source);
          const isLinkedBooking = !!String(x.bookingId || "").trim() || source === "booking";
          const isRefund = source === "refund" || x.amount < 0 || String(x.id || "").startsWith("refund_");
          if (isLinkedBooking || isRefund) return false;
          return Number(x.amount || 0) > 0;
        })
        .reduce((s, x) => s + Number(x.amount || 0), 0);

    const refundsByMonth = (key: string) =>
      incomeRows
        .filter((x) => {
          if (!String(x.date || "").startsWith(`${key}-`)) return false;
          const source = normalizeSource(x.source);
          return source === "refund" || x.amount < 0 || String(x.id || "").startsWith("refund_");
        })
        .reduce((s, x) => s + Number(x.amount || 0), 0);

    const expensesByMonth = (key: string) =>
      expenses
        .filter((x) => String(x.date || "").startsWith(`${key}-`))
        .reduce((s, x) => s + Number(x.amount || 0), 0);

    const currentRevenue =
      bookingRevenueByMonth(currentKey) + manualRevenueByMonth(currentKey) + refundsByMonth(currentKey);
    const previousRevenue =
      bookingRevenueByMonth(previousKey) + manualRevenueByMonth(previousKey) + refundsByMonth(previousKey);

    const currentExpenses = expensesByMonth(currentKey);
    const previousExpenses = expensesByMonth(previousKey);

    const currentNet = currentRevenue - currentExpenses;
    const previousNet = previousRevenue - previousExpenses;

    return {
      currentLabel: monthLabelAr(currentKey),
      previousLabel: monthLabelAr(previousKey),
      current: {
        revenue: currentRevenue,
        expenses: currentExpenses,
        net: currentNet,
      },
      previous: {
        revenue: previousRevenue,
        expenses: previousExpenses,
        net: previousNet,
      },
      delta: {
        revenue: calcDeltaPct(currentRevenue, previousRevenue),
        expenses: calcDeltaPct(currentExpenses, previousExpenses),
        net: calcDeltaPct(currentNet, previousNet),
      },
    };
  }, [range.to, bookings, incomeRows, expenses]);

  const chartsModel = useMemo(() => {
    const selectedYear = Number(String(range.to || "").slice(0, 4)) || new Date().getFullYear();
    let points: Array<{ key: string; label: string; returns: number; investments: number }> = [];

    if (trendMode === "month") {
      const returnsMonthly = new Array(12).fill(0);
      const investmentsMonthly = new Array(12).fill(0);

      revenueRowsDetailed.forEach((row) => {
        const d = String(row.date || "").trim();
        if (!d || !d.startsWith(`${selectedYear}-`)) return;
        const monthIdx = Number(d.slice(5, 7)) - 1;
        if (monthIdx < 0 || monthIdx > 11) return;
        returnsMonthly[monthIdx] += Number(row.amount || 0);
      });

      expensesInRange.forEach((row) => {
        const d = String(row.date || "").trim();
        if (!d || !d.startsWith(`${selectedYear}-`)) return;
        const monthIdx = Number(d.slice(5, 7)) - 1;
        if (monthIdx < 0 || monthIdx > 11) return;
        investmentsMonthly[monthIdx] += Number(row.amount || 0);
      });

      points = MONTHS_AR.map((m, i) => ({
        key: `${selectedYear}-${pad2(i + 1)}`,
        label: m,
        returns: returnsMonthly[i],
        investments: investmentsMonthly[i],
      }));
    } else {
      const from = String(range.from || "").trim();
      const to = String(range.to || "").trim();
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00`) : new Date();
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T00:00:00`) : fromDate;
      const start = fromDate <= toDate ? fromDate : toDate;
      const end = fromDate <= toDate ? toDate : fromDate;
      const dayKeys: string[] = [];
      const cursor = new Date(start);
      while (cursor <= end && dayKeys.length < 800) {
        dayKeys.push(toIsoDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      if (!dayKeys.length) dayKeys.push(toIsoDate(new Date()));

      const returnsByDay: Record<string, number> = {};
      const investmentsByDay: Record<string, number> = {};
      revenueRowsDetailed.forEach((row) => {
        const d = String(row.date || "").trim();
        if (!d) return;
        returnsByDay[d] = (returnsByDay[d] || 0) + Number(row.amount || 0);
      });
      expensesInRange.forEach((row) => {
        const d = String(row.date || "").trim();
        if (!d) return;
        investmentsByDay[d] = (investmentsByDay[d] || 0) + Number(row.amount || 0);
      });

      const hasMultiYear = dayKeys.some((d) => d.slice(0, 4) !== dayKeys[0].slice(0, 4));
      points = dayKeys.map((d) => ({
        key: d,
        label: hasMultiYear ? d.slice(2) : d.slice(5),
        returns: Number(returnsByDay[d] || 0),
        investments: Number(investmentsByDay[d] || 0),
      }));
    }

    const returnsSeries = points.map((p) => p.returns);
    const investmentsSeries = points.map((p) => p.investments);
    const denom = Math.max(1, points.length - 1);
    const maxRaw = Math.max(0, ...returnsSeries, ...investmentsSeries);
    const minRaw = Math.min(0, ...returnsSeries, ...investmentsSeries);
    const maxY = niceCeil(Math.max(4, maxRaw));
    const minY = niceFloor(minRaw);
    const spanY = Math.max(1, maxY - minY);
    const yTicks = Array.from({ length: 5 }, (_, i) => Math.round(maxY - (spanY * i) / 4));
    const topWidth = 860;
    const topHeight = 310;
    const padR = 20;
    const padT = 28;
    const padB = 40;
    const longestTickLabel = yTicks.reduce((max, v) => {
      const len = formatAxisNumber(v).length;
      return len > max ? len : max;
    }, 1);
    const padL = Math.max(72, 20 + longestTickLabel * 9);
    const plotW = topWidth - padL - padR;
    const plotH = topHeight - padT - padB;
    const xOf = (i: number) => padL + (i * plotW) / denom;
    const yOf = (v: number) => padT + plotH - ((v - minY) / spanY) * plotH;
    const toPath = (series: number[]) =>
      series
        .map((v, i) => `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(2)} ${yOf(v).toFixed(2)}`)
        .join(" ");

    const statusOrder: BookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];
    const statusLabel: Record<BookingStatus, string> = {
      pending: "نشط",
      confirmed: "مؤكد",
      completed: "مكتمل",
      cancelled: "مرفوض",
    };
    const statusCount: Record<BookingStatus, number> = {
      pending: 0,
      confirmed: 0,
      completed: 0,
      cancelled: 0,
    };
    bookings
      .filter((b) => inDateRange(b.date, range.from, range.to))
      .forEach((b) => {
        const s = statusOrder.includes(b.status) ? b.status : "pending";
        statusCount[s] += 1;
      });
    const statusBars = statusOrder.map((k) => ({
      key: k,
      label: statusLabel[k],
      value: statusCount[k],
    }));

    const sourceRaw = [
      { label: "الحجز", key: "booking", value: revenueRowsDetailed.filter((x) => x.source === "booking").length, color: "#40010D" },
      { label: "يدوي", key: "manual", value: revenueRowsDetailed.filter((x) => x.source === "manual").length, color: "#0D0D0D" },
      { label: "استرجاع", key: "refund", value: revenueRowsDetailed.filter((x) => x.source === "refund").length, color: "#888C8C" },
    ];
    const sourceTotal = sourceRaw.reduce((s, x) => s + x.value, 0);
    const pie = sourceRaw.filter((x) => x.value > 0);
    const pieTotal = pie.reduce((s, x) => s + x.value, 0);
    let cursor = -90;
    const pieSlices = pie.map((item) => {
      const delta = (item.value / pieTotal) * 360;
      const start = cursor;
      const end = cursor + delta;
      cursor = end;
      return {
        ...item,
        start,
        end,
      };
    });

    return {
      selectedYear,
      topWidth,
      topHeight,
      padL,
      padR,
      padT,
      padB,
      xOf,
      yOf,
      maxY,
      yTicks,
      returnsPath: toPath(returnsSeries),
      investmentsPath: toPath(investmentsSeries),
      points,
      xTickStride: Math.max(1, Math.ceil(points.length / 12)),
      statusBars,
      statusMax: Math.max(4, ...statusBars.map((x) => x.value)),
      pieSlices,
      sourceTotal,
    };
  }, [trendMode, revenueRowsDetailed, expensesInRange, bookings, range.from, range.to]);

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

      <section className="reports-v2__month-compare">
        <div className="section-head">
          <h2>مقارنة الأشهر</h2>
          <span>{monthCompare.currentLabel} مقابل {monthCompare.previousLabel}</span>
        </div>
        <div className="month-compare-grid">
          <article className="month-compare-card">
            <h4>الإيرادات</h4>
            <div className="month-compare-row">
              <span>{monthCompare.currentLabel}</span>
              <b>{formatMoney(monthCompare.current.revenue)}</b>
            </div>
            <div className="month-compare-row">
              <span>{monthCompare.previousLabel}</span>
              <b>{formatMoney(monthCompare.previous.revenue)}</b>
            </div>
            <div className={`month-compare-delta ${monthCompare.delta.revenue >= 0 ? "is-up" : "is-down"}`}>
              {formatDeltaPct(monthCompare.delta.revenue)}
            </div>
          </article>

          <article className="month-compare-card">
            <h4>المصروفات</h4>
            <div className="month-compare-row">
              <span>{monthCompare.currentLabel}</span>
              <b>{formatMoney(monthCompare.current.expenses)}</b>
            </div>
            <div className="month-compare-row">
              <span>{monthCompare.previousLabel}</span>
              <b>{formatMoney(monthCompare.previous.expenses)}</b>
            </div>
            <div className={`month-compare-delta ${monthCompare.delta.expenses >= 0 ? "is-up" : "is-down"}`}>
              {formatDeltaPct(monthCompare.delta.expenses)}
            </div>
          </article>

          <article className="month-compare-card">
            <h4>صافي الربح</h4>
            <div className="month-compare-row">
              <span>{monthCompare.currentLabel}</span>
              <b>{formatMoney(monthCompare.current.net)}</b>
            </div>
            <div className="month-compare-row">
              <span>{monthCompare.previousLabel}</span>
              <b>{formatMoney(monthCompare.previous.net)}</b>
            </div>
            <div className={`month-compare-delta ${monthCompare.delta.net >= 0 ? "is-up" : "is-down"}`}>
              {formatDeltaPct(monthCompare.delta.net)}
            </div>
          </article>
        </div>
      </section>

      <section className="reports-v2__charts-board">
        <article className="chart-card chart-card--wide">
          <div className="chart-card__head">
            <div>
              <h2>
                اتجاه التدفقات {trendMode === "month" ? "الشهرية" : "اليومية"}
                {trendMode === "month" ? ` (${chartsModel.selectedYear})` : ""}
              </h2>
              <p>العوائد مقابل المصروفات</p>
            </div>
            <div className="chart-switch" dir="rtl">
              <button
                type="button"
                className={`chart-switch__btn ${trendMode === "day" ? "is-active" : ""}`}
                onClick={() => setTrendMode("day")}
              >
                يومي
              </button>
              <button
                type="button"
                className={`chart-switch__btn ${trendMode === "month" ? "is-active" : ""}`}
                onClick={() => setTrendMode("month")}
              >
                شهري
              </button>
            </div>
          </div>
          <div className="top-chart-wrap">
            <svg viewBox={`0 0 ${chartsModel.topWidth} ${chartsModel.topHeight}`} className="top-chart" preserveAspectRatio="none">
              {chartsModel.yTicks.map((tickVal, i) => {
                const y = chartsModel.padT + ((chartsModel.topHeight - chartsModel.padT - chartsModel.padB) * i) / 4;
                return (
                  <g key={`yg_${i}`}>
                    <line
                      x1={chartsModel.padL}
                      y1={y}
                      x2={chartsModel.topWidth - chartsModel.padR}
                      y2={y}
                      className="grid-line"
                    />
                    <text x={chartsModel.padL - 8} y={y + 4} textAnchor="end" className="axis-y">
                      {formatAxisNumber(tickVal)}
                    </text>
                  </g>
                );
              })}
              {chartsModel.points.map((p, i) => (
                <g key={`x_${p.key}`}>
                  <line
                    x1={chartsModel.xOf(i)}
                    y1={chartsModel.padT}
                    x2={chartsModel.xOf(i)}
                    y2={chartsModel.topHeight - chartsModel.padB}
                    className="grid-line grid-line--v"
                  />
                  {i % chartsModel.xTickStride === 0 || i === chartsModel.points.length - 1 ? (
                    <text x={chartsModel.xOf(i)} y={chartsModel.topHeight - 10} textAnchor="middle" className="axis-x">
                      {p.label}
                    </text>
                  ) : null}
                </g>
              ))}
              <path d={chartsModel.returnsPath} className="trend-line trend-line--returns" />
              <path d={chartsModel.investmentsPath} className="trend-line trend-line--investments" />
              {chartsModel.points.map((p, i) => (
                <circle key={`ret_pt_${i}`} cx={chartsModel.xOf(i)} cy={chartsModel.yOf(p.returns)} r={3.2} className="trend-dot trend-dot--returns" />
              ))}
              {chartsModel.points.map((p, i) => (
                <circle key={`inv_pt_${i}`} cx={chartsModel.xOf(i)} cy={chartsModel.yOf(p.investments)} r={3.2} className="trend-dot trend-dot--investments" />
              ))}
            </svg>
          </div>
          <div className="trend-legend">
            <span className="legend-item legend-item--returns">العوائد</span>
            <span className="legend-item legend-item--investments">المصروفات</span>
          </div>
        </article>

        <article className="chart-card">
          <div className="chart-card__head">
            <h3>حالة الحجوزات (حسب الفترة)</h3>
          </div>
          <div className="mini-chart-wrap">
            <svg viewBox="0 0 520 280" className="mini-chart">
              {Array.from({ length: 5 }).map((_, i) => {
                const y = 24 + (220 * i) / 4;
                return (
                  <line key={`sg_${i}`} x1={40} y1={y} x2={500} y2={y} className="grid-line" />
                );
              })}
              {chartsModel.statusBars.map((b, i) => {
                const x = 70 + i * 110;
                const h = (Math.max(0, b.value) / chartsModel.statusMax) * 180;
                const y = 240 - h;
                return (
                  <g key={`sb_${b.key}`}>
                    <rect x={x} y={y} width={62} height={h} rx={8} className="status-bar" />
                    <text x={x + 31} y={258} textAnchor="middle" className="axis-x">{b.label}</text>
                    <text x={x + 31} y={Math.max(18, y - 6)} textAnchor="middle" className="axis-y">{b.value}</text>
                  </g>
                );
              })}
            </svg>
          </div>
        </article>

        <article className="chart-card">
          <div className="chart-card__head">
            <h3>توزيع مصادر الإيرادات</h3>
          </div>
          <div className="mini-chart-wrap">
            <svg viewBox="0 0 520 260" className="mini-chart mini-chart--pie">
              <g transform="translate(260,130)">
                {chartsModel.pieSlices.map((s) => (
                  <path
                    key={`pie_${s.key}`}
                    d={arcPath(0, 0, 84, s.start, s.end)}
                    fill={s.color}
                    stroke="#ffffff"
                    strokeWidth="2.5"
                  />
                ))}
                {chartsModel.pieSlices.length === 0 ? (
                  <>
                    <circle r="78" fill="rgba(136, 140, 140, 0.18)" stroke="rgba(13, 13, 13, 0.16)" />
                    <text textAnchor="middle" y="5" className="axis-x">No data</text>
                  </>
                ) : null}
              </g>
            </svg>
          </div>
          <div className="pie-legend" dir="rtl">
            {chartsModel.pieSlices.map((s) => {
              const ratio = chartsModel.sourceTotal > 0 ? Math.round((s.value / chartsModel.sourceTotal) * 100) : 0;
              return (
                <div key={`pie_legend_${s.key}`} className="pie-legend__item">
                  <span className="pie-legend__dot" style={{ backgroundColor: s.color }} />
                  <span className="pie-legend__label">{s.label}</span>
                  <span className="pie-legend__value">{s.value}</span>
                  <span className="pie-legend__ratio">({ratio}%)</span>
                </div>
              );
            })}
            {chartsModel.pieSlices.length === 0 ? (
              <div className="pie-legend__empty">لا توجد بيانات في الفترة المحددة</div>
            ) : null}
          </div>
        </article>
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
