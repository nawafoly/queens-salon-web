import DashboardNumberInputV2 from "../components/dashboard-v2/DashboardNumberInputV2";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDay,
  faCashRegister,
  faClockRotateLeft,
  faCreditCard,
  faEye,
  faFileInvoiceDollar,
  faLock,
  faPrint,
  faScaleBalanced,
  faTriangleExclamation,
  faUnlockKeyhole,
} from "@fortawesome/free-solid-svg-icons";
import { DashboardDatePickerV2, DashboardSkeletonV2 } from "../components/dashboard-v2";
import {
  CoreDayAuditService,
  type CoreDayAuditClosing,
  type CoreDayAuditSnapshot,
  type CoreDayAuditView,
} from "../services/CoreDayAuditService";
import { CoreApiError } from "../services/coreApiClient";
import "../styles/dashboard-v2/dashboard-v2.css";
import { dayAuditText, type DashboardLanguage } from "../helpers/dashboardDayAuditLanguage";

type DayAuditPrintPayload = {
  dateLabel: string;
  totalHalalas: number;
  cashHalalas: number;
  cardHalalas: number;
  transferHalalas: number;
  unclassifiedHalalas: number;
  manualCashHalalas: number;
  diffHalalas: number;
  isLocked: boolean;
  lockTimeLabel: string;
  closedByName: string;
  printedAtLabel: string;
};

function moneyFormatter(language: DashboardLanguage) {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateTimeFormatter(language: DashboardLanguage) {
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHalalas(value: unknown, language: DashboardLanguage): string {
  const n = Number(value);
  const currency = language === "en" ? "SAR" : "ر.س";
  const amount = Number.isFinite(n) ? n / 100 : 0;
  return `${moneyFormatter(language).format(amount)} ${currency}`;
}

function formatDateKey(dateKey: string, language: DashboardLanguage) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateKey;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    dateStyle: "short",
  }).format(date);
}

function formatDateTime(value: string | null | undefined, language: DashboardLanguage) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return dateTimeFormatter(language).format(new Date(parsed));
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseManualCashHalalas(raw: string): number | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const halalas = Math.round(amount * 100);
  return Number.isSafeInteger(halalas) ? halalas : null;
}

function emptySnapshot(date: string): CoreDayAuditSnapshot {
  return {
    date,
    totalHalalas: 0,
    cashHalalas: 0,
    cardHalalas: 0,
    transferHalalas: 0,
    unclassifiedHalalas: 0,
    unclassifiedRows: [],
    rowCount: 0,
    sourceVersion: "day-audit-v1",
  };
}

export default function DashboardDayAudit({ language = "ar" }: { language?: DashboardLanguage }) {
  const t = (arabic: string) => dayAuditText(language, arabic);
  const [todayKey, setTodayKey] = useState(() => todayISO());
  const [todayLimitKey, setTodayLimitKey] = useState(() => todayISO());
  const [view, setView] = useState<CoreDayAuditView | null>(null);
  const [history, setHistory] = useState<CoreDayAuditClosing[]>([]);
  const [loadedDateKey, setLoadedDateKey] = useState("");
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [manualCashInput, setManualCashInput] = useState("");
  const [manualCashError, setManualCashError] = useState("");
  const [errorText, setErrorText] = useState("");
  const [closingInFlight, setClosingInFlight] = useState(false);
  const pendingPrintPopupRef = useRef<Window | null>(null);
  const manualCashRef = useRef<HTMLInputElement | null>(null);
  const unclassifiedNoticeRef = useRef<HTMLDivElement | null>(null);
  const selectedDateRef = useRef(todayKey);

  const snapshot = view?.snapshot || emptySnapshot(todayKey);
  const closing = view?.closing || null;
  const totalHalalas = closing?.totalHalalas ?? snapshot.totalHalalas;
  const cashHalalas = closing?.cashHalalas ?? snapshot.cashHalalas;
  const cardHalalas = closing?.cardHalalas ?? snapshot.cardHalalas;
  const transferHalalas = closing?.transferHalalas ?? snapshot.transferHalalas;
  const unclassifiedHalalas = closing?.unclassifiedHalalas ?? snapshot.unclassifiedHalalas;
  const manualCashHalalas = closing?.manualCashHalalas ?? parseManualCashHalalas(manualCashInput) ?? 0;
  const diffHalalas = closing?.cashDiffHalalas ?? manualCashHalalas - cashHalalas;
  const loading = loadedDateKey !== todayKey;
  const hasUnclassified = !closing && snapshot.unclassifiedRows.length > 0;

  const dateLabel = useMemo(() => formatDateKey(todayKey, language), [todayKey, language]);

  const loadHistory = async () => {
    try {
      const rows = await CoreDayAuditService.listClosings(50, 0);
      setHistory(rows);
      setHistoryLoaded(true);
    } catch (error) {
      console.error("Core day audit history load failed:", error);
      setHistoryLoaded(true);
      setErrorText(t("تعذر تحميل سجل الإغلاقات من Core."));
    }
  };

  const loadSelectedDate = async (options: { preserveManual?: boolean } = {}) => {
    const requestedDate = todayKey;
    try {
      const next = await CoreDayAuditService.get(requestedDate);
      if (selectedDateRef.current !== requestedDate) return;
      setView(next);
      setLoadedDateKey(requestedDate);
      if (next.closing) {
        setManualCashInput((next.closing.manualCashHalalas / 100).toFixed(2));
      } else if (!options.preserveManual) {
        setManualCashInput("");
      }
    } catch (error) {
      if (selectedDateRef.current !== requestedDate) return;
      console.error("Core day audit load failed:", error);
      setView({ snapshot: emptySnapshot(requestedDate), closing: null });
      setLoadedDateKey(requestedDate);
      setErrorText(t("تعذر تحميل جرد اليوم من Core."));
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setTodayLimitKey(todayISO()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    selectedDateRef.current = todayKey;
    setErrorText("");
    setManualCashError("");
    setLoadedDateKey("");
    void loadSelectedDate();
  }, [todayKey]);

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadSelectedDate({ preserveManual: true });
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [todayKey]);

  const applyDateSelection = (rawDate: string) => {
    const raw = String(rawDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return;
    const bounded = raw > todayLimitKey ? todayLimitKey : raw;
    selectedDateRef.current = bounded;
    setTodayKey(bounded);
  };

  const closePendingAuditPrintPopup = () => {
    const popup = pendingPrintPopupRef.current;
    if (popup && !popup.closed) {
      try { popup.close(); } catch { /* ignore */ }
    }
    pendingPrintPopupRef.current = null;
  };

  useEffect(() => () => closePendingAuditPrintPopup(), []);

  const primeAuditPrintPopup = () => {
    const current = pendingPrintPopupRef.current;
    if (current && !current.closed) {
      current.focus();
      return true;
    }
    const popup = window.open(
      "about:blank",
      "day_audit_print_popup",
      "width=720,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes"
    );
    if (!popup) return false;
    pendingPrintPopupRef.current = popup;
    try { popup.document.title = t("جاري تجهيز جرد اليوم"); } catch { /* ignore */ }
    popup.focus();
    return true;
  };

  const buildAuditPrintHtml = (payload: DayAuditPrintPayload) => {
    const statusLabel = payload.isLocked ? t("مقفل") : t("مفتوح");
    const diffClass = payload.diffHalalas < 0 ? "neg" : payload.diffHalalas > 0 ? "pos" : "zero";
    const lockedRows = payload.isLocked
      ? `<tr><td>${escapeHtml(t("وقت الإغلاق"))}</td><td>${escapeHtml(payload.lockTimeLabel)}</td></tr>
         <tr><td>${escapeHtml(t("مغلق بواسطة"))}</td><td>${escapeHtml(payload.closedByName || "—")}</td></tr>`
      : "";
    return `<!doctype html>
<html lang="${language}" dir="${language === "en" ? "ltr" : "rtl"}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(t("جرد اليوم"))}</title>
<style>
@page { size: 80mm auto; margin: 0; }
html,body{width:80mm;margin:0;padding:0;background:#fff;color:#000;font-family:"Lucida Console","Courier New",monospace;font-size:11px;line-height:1.35}
.receipt{width:72mm;margin:0 auto;padding:2mm 1.5mm 4mm;box-sizing:border-box}.title{text-align:center;font-size:16px}.meta{text-align:center;font-size:10px}.line{margin:2mm 0;border-top:1px dashed #000}table{width:100%;border-collapse:collapse}td{padding:1mm 0}td:last-child{text-align:left;font-weight:700}.summary{margin-top:1.5mm;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:1.2mm 0}.row{display:flex;justify-content:space-between;gap:6px;padding:.8mm 0}.row strong{font-size:13px}.neg strong{color:#b42318}.pos strong{color:#067647}.footer{margin-top:2mm;text-align:center;font-size:10px}
</style>
</head>
<body><main class="receipt">
<h1 class="title">${escapeHtml(t("جرد اليوم"))}</h1><div class="meta">${escapeHtml(payload.printedAtLabel)}</div><div class="line"></div>
<table><tr><td>${escapeHtml(t("تاريخ الجرد"))}</td><td>${escapeHtml(payload.dateLabel)}</td></tr><tr><td>${escapeHtml(t("الحالة"))}</td><td>${escapeHtml(statusLabel)}</td></tr>${lockedRows}</table>
<div class="summary">
<div class="row"><span>${escapeHtml(t("إجمالي التحصيل"))}</span><strong>${escapeHtml(formatHalalas(payload.totalHalalas, language))}</strong></div>
<div class="row"><span>${escapeHtml(t("إيراد الكاش"))}</span><strong>${escapeHtml(formatHalalas(payload.cashHalalas, language))}</strong></div>
<div class="row"><span>${escapeHtml(t("إيراد الشبكة"))}</span><strong>${escapeHtml(formatHalalas(payload.cardHalalas, language))}</strong></div>
<div class="row"><span>${escapeHtml(t("إيراد التحويل (خارج مطابقة الكاش)"))}</span><strong>${escapeHtml(formatHalalas(payload.transferHalalas, language))}</strong></div>
<div class="row"><span>${escapeHtml(t("إيراد غير مصنف"))}</span><strong>${escapeHtml(formatHalalas(payload.unclassifiedHalalas, language))}</strong></div>
<div class="row"><span>${escapeHtml(t("الكاش اليدوي"))}</span><strong>${escapeHtml(formatHalalas(payload.manualCashHalalas, language))}</strong></div>
<div class="row ${diffClass}"><span>${escapeHtml(t("فرق الكاش (الكاش اليدوي - إيراد الكاش)"))}</span><strong>${escapeHtml(formatHalalas(payload.diffHalalas, language))}</strong></div>
</div><div class="footer">${escapeHtml(t("تم إعداد الجرد آليًا من لوحة التحكم"))}</div>
</main><script>(function(){var done=false;function p(){if(done)return;done=true;window.focus();window.print()}window.addEventListener('load',function(){setTimeout(p,120)});window.onafterprint=function(){setTimeout(function(){window.close()},80)}})();</script></body></html>`;
  };

  const openAuditPrintPopup = (payload: DayAuditPrintPayload) => {
    const pending = pendingPrintPopupRef.current;
    const popup = pending && !pending.closed
      ? pending
      : window.open("about:blank", "day_audit_print_popup", "width=720,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes");
    if (!popup) {
      closePendingAuditPrintPopup();
      return false;
    }
    pendingPrintPopupRef.current = popup;
    try {
      popup.document.open();
      popup.document.write(buildAuditPrintHtml(payload));
      popup.document.close();
      popup.focus();
      pendingPrintPopupRef.current = null;
      return true;
    } catch {
      closePendingAuditPrintPopup();
      return false;
    }
  };

  const payloadFromCurrent = (): DayAuditPrintPayload => ({
    dateLabel,
    totalHalalas,
    cashHalalas,
    cardHalalas,
    transferHalalas,
    unclassifiedHalalas,
    manualCashHalalas,
    diffHalalas,
    isLocked: !!closing,
    lockTimeLabel: closing ? formatDateTime(closing.closedAt, language) : "—",
    closedByName: closing?.closedByName || "",
    printedAtLabel: dateTimeFormatter(language).format(new Date()),
  });

  const payloadFromClosing = (row: CoreDayAuditClosing): DayAuditPrintPayload => ({
    dateLabel: formatDateKey(row.auditDate, language),
    totalHalalas: row.totalHalalas,
    cashHalalas: row.cashHalalas,
    cardHalalas: row.cardHalalas,
    transferHalalas: row.transferHalalas,
    unclassifiedHalalas: row.unclassifiedHalalas,
    manualCashHalalas: row.manualCashHalalas,
    diffHalalas: row.cashDiffHalalas,
    isLocked: true,
    lockTimeLabel: formatDateTime(row.closedAt, language),
    closedByName: row.closedByName || "",
    printedAtLabel: dateTimeFormatter(language).format(new Date()),
  });

  const printAudit = () => {
    setErrorText("");
    if (!openAuditPrintPopup(payloadFromCurrent())) {
      setErrorText(t("تعذر فتح نافذة الطباعة. فعّل النوافذ المنبثقة للموقع ثم أعد المحاولة."));
    }
  };

  const printHistoricalClosing = (row: CoreDayAuditClosing) => {
    setErrorText("");
    if (!openAuditPrintPopup(payloadFromClosing(row))) {
      setErrorText(t("تعذر فتح نافذة الطباعة. فعّل النوافذ المنبثقة للموقع ثم أعد المحاولة."));
    }
  };

  const printAndClose = async () => {
    if (closing || closingInFlight) return;
    setErrorText("");
    setManualCashError("");

    const parsedManual = parseManualCashHalalas(manualCashInput);
    if (parsedManual == null) {
      const message = String(manualCashInput || "").trim()
        ? t("الكاش اليدوي لا يمكن أن يكون رقمًا سالبًا.")
        : t("أدخل مبلغ الكاش الموجود فعليًا في الصندوق.");
      setManualCashError(message);
      setErrorText(message);
      window.setTimeout(() => manualCashRef.current?.focus(), 0);
      closePendingAuditPrintPopup();
      return;
    }

    if (hasUnclassified) {
      const message = t("لا يمكن إقفال اليوم مع وجود مبالغ غير مصنفة.");
      setErrorText(message);
      window.setTimeout(() => unclassifiedNoticeRef.current?.focus(), 0);
      closePendingAuditPrintPopup();
      return;
    }

    const closingDate = todayKey;
    setClosingInFlight(true);
    let created: CoreDayAuditClosing;
    try {
      created = await CoreDayAuditService.close(closingDate, parsedManual);
    } catch (error) {
      console.error("Core day audit close failed:", error);
      closePendingAuditPrintPopup();
      if (error instanceof CoreApiError && error.code === "core_day_audit:unclassified_payments") {
        setErrorText(t("لا يمكن إقفال اليوم مع وجود مبالغ غير مصنفة."));
        window.setTimeout(() => unclassifiedNoticeRef.current?.focus(), 0);
      } else {
        setErrorText(t("تعذر إقفال اليوم. أعد تحميل البيانات وحاول مرة أخرى."));
      }
      setClosingInFlight(false);
      return;
    }

    // The POST is authoritative. Reflect the immutable closing immediately so a
    // failed follow-up refresh can never make a successfully closed day look open.
    if (selectedDateRef.current === closingDate) {
      setView((current) => ({
        snapshot: current?.snapshot?.date === closingDate ? current.snapshot : emptySnapshot(closingDate),
        closing: created,
      }));
      setLoadedDateKey(closingDate);
      setManualCashInput((created.manualCashHalalas / 100).toFixed(2));
    }
    setClosingInFlight(false);

    if (!openAuditPrintPopup(payloadFromClosing(created))) {
      setErrorText(t("تعذر فتح نافذة الطباعة. فعّل النوافذ المنبثقة للموقع ثم أعد المحاولة."));
    }
    void loadHistory();

    // Best effort only: enrich the local snapshot after success, but never roll
    // the UI back to open if this GET is unavailable.
    void (async () => {
      try {
        const refreshed = await CoreDayAuditService.get(closingDate);
        if (selectedDateRef.current === closingDate) {
          setView({ ...refreshed, closing: refreshed.closing || created });
          setLoadedDateKey(closingDate);
        }
      } catch (error) {
        console.error("Core day audit post-close refresh failed:", error);
      }
    })();
  };

  const diffTone = diffHalalas < 0 ? "negative" : diffHalalas > 0 ? "positive" : "zero";
  const diffMetricClass = diffHalalas < 0
    ? "dsv2-metric-card--danger"
    : diffHalalas > 0
      ? "dsv2-metric-card--gold"
      : "dsv2-metric-card--success";

  const closingStoredInCore = closing?.origin !== "legacy_local_readonly";

  return (
    <main className="dsv2-page day-audit-v2-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <section className="dsv2-card day-audit-v2-hero">
        <div className="day-audit-v2-hero__content">
          <span className="dsv2-badge dsv2-badge--gold">{t("الجرد اليومي")}</span>
          <h1 className="dsv2-page-title">{t("الجرد والإقفال اليومي")}</h1>
          <p className="dsv2-page-subtitle">{t("مطابقة تحصيلات النظام مع الكاش الفعلي وإصدار محضر جرد واضح قبل إقفال اليوم.")}</p>
        </div>
        <div className="day-audit-v2-hero__controls no-print">
          <div className="day-audit-v2-date-card">
            <span className="day-audit-v2-date-card__icon" aria-hidden="true"><FontAwesomeIcon icon={faCalendarDay} /></span>
            <label className="day-audit-v2-date-card__field" htmlFor="day-audit-date">
              <span>{t("تاريخ الجرد")}</span>
              <DashboardDatePickerV2 id="day-audit-date" value={todayKey} max={todayLimitKey} clearable={false} onChange={applyDateSelection} />
            </label>
            <button className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" type="button" onClick={() => applyDateSelection(todayLimitKey)} disabled={todayKey === todayLimitKey}>{t("اليوم")}</button>
          </div>
          <div className="day-audit-v2-status" data-state={closing ? "locked" : "open"}>
            <FontAwesomeIcon icon={closing ? faLock : faUnlockKeyhole} />
            <span>{closing ? t("اليوم مقفل") : t("اليوم مفتوح")}</span>
          </div>
        </div>
      </section>

      {closing ? (
        <div className="day-audit-v2-notice day-audit-v2-notice--success" role="status">
          <FontAwesomeIcon icon={faLock} />
          <span>
            {t("تم إقفال هذا اليوم في")} <strong>{formatDateTime(closing.closedAt, language)}</strong>.{" "}
            {closingStoredInCore ? t("القيم محفوظة في Core وغير قابلة للتعديل.") : t("هذا إغلاق قديم محفوظ على هذا الجهاز للعرض فقط.")}
          </span>
        </div>
      ) : null}

      {hasUnclassified ? (
        <div ref={unclassifiedNoticeRef} tabIndex={-1} className="day-audit-v2-notice day-audit-v2-notice--danger" role="alert">
          <FontAwesomeIcon icon={faTriangleExclamation} />
          <div>
            <strong>{t("يوجد تحصيل غير مصنف. حدّد طريقة الدفع الصحيحة قبل إقفال اليوم.")}</strong>
            <div>{t("مبالغ غير مصنفة")}: {formatHalalas(snapshot.unclassifiedHalalas, language)}</div>
          </div>
        </div>
      ) : null}

      <section className="day-audit-v2-metrics" aria-label={t("ملخص الجرد")}>
        <article className="dsv2-metric-card dsv2-metric-card--dark">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faFileInvoiceDollar} /></span>
          <p className="dsv2-metric-card__label">{t("إجمالي التحصيل")}</p>
          <div className="dsv2-metric-card__value">{loading ? <DashboardSkeletonV2 width="72%" height={22} /> : formatHalalas(totalHalalas, language)}</div>
          <p className="dsv2-metric-card__meta">{dateLabel}</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--success">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faCashRegister} /></span>
          <p className="dsv2-metric-card__label">{t("تحصيل الكاش")}</p>
          <p className="dsv2-metric-card__value">{formatHalalas(cashHalalas, language)}</p>
          <p className="dsv2-metric-card__meta">{t("حسب المدفوعات المسجلة")}</p>
        </article>
        <article className="dsv2-metric-card dsv2-metric-card--gold">
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faCreditCard} /></span>
          <p className="dsv2-metric-card__label">{t("الشبكة والتحويل")}</p>
          <p className="dsv2-metric-card__value">{formatHalalas(cardHalalas + transferHalalas, language)}</p>
          <p className="dsv2-metric-card__meta">{t("شبكة")} {formatHalalas(cardHalalas, language)} · {t("تحويل")} {formatHalalas(transferHalalas, language)}</p>
        </article>
        <article className={`dsv2-metric-card ${unclassifiedHalalas !== 0 ? "dsv2-metric-card--danger" : "dsv2-metric-card--success"}`}>
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faTriangleExclamation} /></span>
          <p className="dsv2-metric-card__label">{t("غير مصنف")}</p>
          <p className="dsv2-metric-card__value">{formatHalalas(unclassifiedHalalas, language)}</p>
          <p className="dsv2-metric-card__meta">{hasUnclassified ? t("لا يمكن إقفال اليوم مع وجود مبالغ غير مصنفة.") : t("حسب المدفوعات المسجلة")}</p>
        </article>
        <article className={`dsv2-metric-card ${diffMetricClass}`}>
          <span className="dsv2-metric-card__icon"><FontAwesomeIcon icon={faScaleBalanced} /></span>
          <p className="dsv2-metric-card__label">{t("فرق الكاش")}</p>
          <p className="dsv2-metric-card__value">{formatHalalas(diffHalalas, language)}</p>
          <p className="dsv2-metric-card__meta">{t("الكاش الفعلي ناقص تحصيل الكاش")}</p>
        </article>
      </section>

      {hasUnclassified ? (
        <section className="dsv2-card day-audit-v2-panel" aria-label={t("مبالغ غير مصنفة")}>
          <header className="day-audit-v2-panel__head">
            <div className="day-audit-v2-panel__head-copy">
              <span className="dsv2-badge dsv2-badge--gold">{t("مبالغ غير مصنفة")}</span>
              <h2>{t("يوجد تحصيل غير مصنف. حدّد طريقة الدفع الصحيحة قبل إقفال اليوم.")}</h2>
            </div>
          </header>
          <div className="day-audit-v2-summary">
            {snapshot.unclassifiedRows.map((row) => (
              <div className="day-audit-v2-summary-row" key={row.id}>
                <span>
                  <strong>{row.bookingId ? `${t("الحجز")}: ${row.bookingId}` : row.id}</strong>
                  {row.bookingDate ? ` · ${t("تاريخ الحجز")}: ${row.bookingDate}` : ""}
                  {` · ${t("طريقة الدفع الحالية")}: ${row.method || t("غير معروف")}`}
                  {row.occurredAt ? ` · ${t("وقت التسجيل")}: ${formatDateTime(row.occurredAt, language)}` : ""}
                </span>
                <strong>{formatHalalas(row.amountHalalas, language)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="day-audit-v2-layout" id="day-audit-print">
        <article className="dsv2-card day-audit-v2-panel day-audit-v2-entry">
          <header className="day-audit-v2-panel__head">
            <div className="day-audit-v2-panel__head-copy">
              <span className="dsv2-badge dsv2-badge--gold">{t("عدّ الكاش")}</span>
              <h2>{t("إدخال الكاش الفعلي")}</h2>
              <p>{t("أدخل المبلغ الموجود فعليًا في الصندوق، ثم راجع الفرق قبل الإقفال.")}</p>
            </div>
            <span className="day-audit-v2-panel__index">01</span>
          </header>
          <label className="day-audit-v2-amount-field" htmlFor="day-audit-manual-cash">
            <span>{t("مبلغ الكاش الموجود")}</span>
            <div className="day-audit-v2-amount-control">
              <DashboardNumberInputV2
                ref={manualCashRef}
                id="day-audit-manual-cash"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={closing ? (closing.manualCashHalalas / 100).toFixed(2) : manualCashInput}
                onChange={(event) => {
                  setErrorText("");
                  setManualCashError("");
                  setManualCashInput(String(event.target.value || ""));
                }}
                disabled={!!closing}
                aria-invalid={manualCashError ? true : undefined}
                aria-describedby={manualCashError ? "day-audit-manual-cash-error" : undefined}
                style={manualCashError ? { borderColor: "#b42318", boxShadow: "0 0 0 1px #b42318" } : undefined}
              />
              <b>{language === "en" ? "SAR" : "ر.س"}</b>
            </div>
            {manualCashError ? <small id="day-audit-manual-cash-error" role="alert" style={{ color: "#b42318" }}>{manualCashError}</small> : null}
            <small>{closing ? t("تم تثبيت المبلغ عند إقفال اليوم.") : t("استخدم المبلغ المحسوب فعليًا من الصندوق.")}</small>
          </label>
          <div className="day-audit-v2-difference">
            <span>{t("نتيجة المطابقة الحالية")}</span>
            <strong data-diff={diffTone}>{diffHalalas === 0 ? t("متطابق") : diffHalalas < 0 ? `${t("عجز")} ${formatHalalas(Math.abs(diffHalalas), language)}` : `${t("زيادة")} ${formatHalalas(diffHalalas, language)}`}</strong>
          </div>
          {errorText ? <div className="day-audit-v2-notice day-audit-v2-notice--danger no-print" role="alert">{errorText}</div> : null}
          <div className="day-audit-v2-actions no-print">
            <button type="button" className="dsv2-btn dsv2-btn--secondary" onPointerDown={primeAuditPrintPopup} onClick={printAudit}>
              <FontAwesomeIcon icon={faPrint} />{t("طباعة مسودة الجرد")}
            </button>
            <button type="button" className="dsv2-btn dsv2-btn--primary" onPointerDown={primeAuditPrintPopup} onClick={printAndClose} disabled={!!closing || closingInFlight}>
              <FontAwesomeIcon icon={faLock} />{closing ? t("تم إقفال اليوم") : t("طباعة وإقفال اليوم")}
            </button>
          </div>
        </article>

        <aside className="dsv2-card day-audit-v2-panel day-audit-v2-breakdown">
          <header className="day-audit-v2-panel__head">
            <div className="day-audit-v2-panel__head-copy">
              <span className="dsv2-badge dsv2-badge--gold">{t("التسوية")}</span>
              <h2>{t("تفصيل التسوية")}</h2>
              <p>{t("ملخص قنوات الدفع الداخلة في جرد التاريخ المحدد.")}</p>
            </div>
            <span className="day-audit-v2-panel__index">02</span>
          </header>
          <div className="day-audit-v2-summary">
            <div className="day-audit-v2-summary-row"><span>{t("إجمالي التحصيل")}</span><strong>{formatHalalas(totalHalalas, language)}</strong></div>
            <div className="day-audit-v2-summary-row"><span>{t("تحصيل الكاش بالنظام")}</span><strong>{formatHalalas(cashHalalas, language)}</strong></div>
            <div className="day-audit-v2-summary-row"><span>{t("تحصيل الشبكة")}</span><strong>{formatHalalas(cardHalalas, language)}</strong></div>
            <div className="day-audit-v2-summary-row"><span>{t("التحويل البنكي")}</span><strong>{formatHalalas(transferHalalas, language)}</strong></div>
            <div className="day-audit-v2-summary-row"><span>{t("مبالغ غير مصنفة")}</span><strong>{formatHalalas(unclassifiedHalalas, language)}</strong></div>
            <div className="day-audit-v2-summary-row day-audit-v2-summary-row--highlight"><span>{t("الكاش الفعلي")}</span><strong>{formatHalalas(manualCashHalalas, language)}</strong></div>
            <div className="day-audit-v2-summary-row day-audit-v2-summary-row--total"><span>{t("فرق الكاش النهائي")}</span><strong className="day-audit-v2-value" data-diff={diffTone}>{formatHalalas(diffHalalas, language)}</strong></div>
          </div>
          <div className="day-audit-v2-policy"><strong>{t("قاعدة الإقفال")}</strong><p>{t("التحويل البنكي يظهر في الإجمالي، لكنه لا يدخل في مقارنة الكاش الفعلي مع صندوق الاستقبال.")}</p></div>
        </aside>
      </section>

      <section className="dsv2-card day-audit-v2-panel" aria-label={t("الإغلاقات السابقة")}>
        <header className="day-audit-v2-panel__head">
          <div className="day-audit-v2-panel__head-copy">
            <span className="dsv2-badge dsv2-badge--gold"><FontAwesomeIcon icon={faClockRotateLeft} /> {t("الإغلاقات السابقة")}</span>
            <h2>{t("الإغلاقات السابقة")}</h2>
            <p>{t("سجل الإغلاقات محفوظ مركزيًا في Core ويظهر على جميع الأجهزة.")}</p>
          </div>
        </header>
        {!historyLoaded ? <DashboardSkeletonV2 width="100%" height={90} /> : history.length === 0 ? (
          <p className="dsv2-page-subtitle">{t("لا توجد إغلاقات سابقة حتى الآن.")}</p>
        ) : (
          <div className="day-audit-v2-summary">
            {history.map((row) => (
              <div className="day-audit-v2-summary-row" key={row.id}>
                <span>
                  <strong>{formatDateKey(row.auditDate, language)}</strong>
                  {` · ${formatDateTime(row.closedAt, language)}`}
                  {row.closedByName ? ` · ${t("مغلق بواسطة")}: ${row.closedByName}` : ""}
                  <br />
                  {t("إجمالي")}: {formatHalalas(row.totalHalalas, language)} · {t("الكاش")}: {formatHalalas(row.cashHalalas, language)} · {t("الشبكة")}: {formatHalalas(row.cardHalalas, language)} · {t("تحويل")}: {formatHalalas(row.transferHalalas, language)}
                </span>
                <span className="day-audit-v2-actions no-print">
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onClick={() => { selectedDateRef.current = row.auditDate; setTodayKey(row.auditDate); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    <FontAwesomeIcon icon={faEye} /> {t("عرض")}
                  </button>
                  <button type="button" className="dsv2-btn dsv2-btn--secondary dsv2-btn--sm" onPointerDown={primeAuditPrintPopup} onClick={() => printHistoricalClosing(row)}>
                    <FontAwesomeIcon icon={faPrint} /> {t("طباعة")}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
