import { useEffect, useMemo, useRef } from "react";
import { formatTime12 } from "../helpers/timeDisplay";
import {
  bookingPaymentMethodLabelAr,
  normalizePaymentBreakdown,
  paymentBreakdownLines,
  resolveExistingBookingPayment,
  roundMoney2,
  sumPaymentBreakdown,
  type BookingPaymentBreakdown,
  type BookingPaymentMethod,
  type BookingPaymentType,
} from "../helpers/bookingPaymentUtils";

type BookingItem = {
  id?: string;
  publicId?: string;
  clientName?: string;
  clientPhone?: string;
  name?: string;
  phone?: string;
  serviceId?: string;
  serviceName?: string;
  serviceSectionId?: string;
  serviceSectionTitle?: string;
  serviceCategoryId?: string;
  serviceCategoryName?: string;
  serviceSnapshot?: {
    serviceNameAtBooking?: string;
    sectionIdAtBooking?: string;
    sectionTitleAtBooking?: string;
    categoryIdAtBooking?: string;
    categoryNameAtBooking?: string;
  };
  employeeName?: string;
  date?: string;
  time?: string;
  durationMin?: number;
  finalPrice?: number;
  total?: number;
  discountAmount?: number;
  offerTitle?: string;
  couponCode?: string;
  toolsSource?: "client" | "salon" | string | null;
  toolsFeeApplied?: number;
  paymentMethod?: BookingPaymentMethod | string;
  paymentBreakdown?: Partial<BookingPaymentBreakdown>;
  paymentType?: BookingPaymentType | string;
  paidAmount?: number;
  remainingAmount?: number;
  status?: string;
  createdAt?: number | string | Date;
};

type CurrentBooking = {
  id?: string;
  publicId?: string;
  clientName?: string;
  clientPhone?: string;
  name?: string;
  phone?: string;
  date?: string;
  time?: string;
  createdAt?: number | string | Date;
};

function safeParse<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeStorageText(key: string): string {
  try {
    return String(localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

type InternalReceiptPrintState = {
  activeKey: string;
  activeSince: number;
  lastPrintedKey: string;
  lastPrintedAt: number;
  printCount: number;
};

type InternalReceiptPrintWindow = Window & {
  __malikatInternalReceiptPrintState?: InternalReceiptPrintState;
};

function getInternalReceiptPrintState(): InternalReceiptPrintState {
  const w = window as InternalReceiptPrintWindow;
  if (!w.__malikatInternalReceiptPrintState) {
    w.__malikatInternalReceiptPrintState = {
      activeKey: "",
      activeSince: 0,
      lastPrintedKey: "",
      lastPrintedAt: 0,
      printCount: 0,
    };
  }
  return w.__malikatInternalReceiptPrintState;
}

function formatCurrency(num: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(num || 0));
}

function readItemServiceName(item: BookingItem): string {
  return String(item?.serviceName || item?.serviceSnapshot?.serviceNameAtBooking || "").trim();
}

function readItemSectionLabel(item: BookingItem): string {
  return String(
    item?.serviceSectionTitle ||
      item?.serviceSnapshot?.sectionTitleAtBooking ||
      item?.serviceSnapshot?.sectionIdAtBooking ||
      item?.serviceSectionId ||
      ""
  ).trim();
}

function readItemCategoryLabel(item: BookingItem): string {
  return String(
    item?.serviceCategoryName ||
      item?.serviceSnapshot?.categoryNameAtBooking ||
      item?.serviceSnapshot?.categoryIdAtBooking ||
      item?.serviceCategoryId ||
      ""
  ).trim();
}

function readToolsLabel(item: BookingItem): string {
  const source = String(item?.toolsSource || "").trim().toLowerCase();
  if (!source) return "";
  if (source === "salon") {
    const fee = Math.max(0, Number(item?.toolsFeeApplied || 0));
    return `الأدوات: من الصالون${fee > 0 ? ` (+${fee} ريال)` : ""}`;
  }
  if (source === "client") return "الأدوات: من العميلة";
  return "";
}

function toEpoch(v: any): number {
  if (v == null) return NaN;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const numeric = Number(v);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  if (typeof v === "object" && typeof (v as any)?.seconds === "number") {
    const sec = Number((v as any).seconds || 0);
    const nano = Number((v as any).nanoseconds || 0);
    return sec * 1000 + Math.floor(nano / 1e6);
  }
  return NaN;
}

function resolveItemPayment(item: BookingItem) {
  return resolveExistingBookingPayment(item);
}

/* THERMAL_RECEIPT_EXACT_HEIGHT_V2 */
function prepareExactThermalPrintPage() {
  const receipt = document.getElementById("booking-print-receipt");
  if (!receipt) return;

  const rect = receipt.getBoundingClientRect();
  const contentPx = Math.max(
    rect.height,
    receipt.scrollHeight,
    receipt.offsetHeight
  );

  const pxToMm = 25.4 / 96;
  const contentHeightMm = Math.max(
    25,
    Math.ceil(contentPx * pxToMm) + 1
  );

  let style = document.getElementById(
    "malikat-thermal-exact-page-size"
  ) as HTMLStyleElement | null;

  if (!style) {
    style = document.createElement("style");
    style.id = "malikat-thermal-exact-page-size";
    document.head.appendChild(style);
  }

  style.textContent = `
    @media print {
      @page {
        size: 80mm ${contentHeightMm}mm !important;
        margin: 0 !important;
      }

      html,
      body,
      #root,
      #print-area {
        width: 80mm !important;
        height: ${contentHeightMm}mm !important;
        min-height: 0 !important;
        max-height: ${contentHeightMm}mm !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
      }

      #booking-print-receipt {
        position: absolute !important;
        top: 0 !important;
        left: 4mm !important;
        width: 72mm !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        margin: 0 !important;
        padding-bottom: 0.5mm !important;
        overflow: visible !important;
        break-after: avoid !important;
        page-break-after: avoid !important;
      }

      #booking-print-receipt > :last-child,
      #booking-print-receipt .footer,
      #booking-print-receipt .footer p {
        margin-bottom: 0 !important;
        padding-bottom: 0 !important;
      }
    }
  `;
}
/* END_THERMAL_RECEIPT_EXACT_HEIGHT_V2 */

export default function SuccessInternal() {
  const printEffectStartedRef = useRef(false);
  const bookingInfo = useMemo<CurrentBooking | null>(
    () => safeParse<CurrentBooking | null>("currentBooking", null),
    []
  );

  const allBookings = useMemo<BookingItem[]>(
    () => safeParse<BookingItem[]>("allBookings", []),
    []
  );
  const printRequestId = useMemo(() => safeStorageText("internalInvoicePrintRequestId"), []);

  const firstItem = allBookings[0] || {};

  const publicId = String(bookingInfo?.publicId || firstItem?.publicId || "-").trim() || "-";
  const clientName = String(
    bookingInfo?.clientName ||
      bookingInfo?.name ||
      firstItem?.clientName ||
      firstItem?.name ||
      "-"
  ).trim() || "-";
  const clientPhone = String(
    bookingInfo?.clientPhone ||
      bookingInfo?.phone ||
      firstItem?.clientPhone ||
      firstItem?.phone ||
      "-"
  ).trim() || "-";
  const mainDate = String(bookingInfo?.date || firstItem?.date || "-").trim() || "-";

  const createdAtSource = bookingInfo?.createdAt ?? firstItem?.createdAt ?? null;
  const createdAtEpoch = toEpoch(createdAtSource);
  const createdAtLabel = Number.isFinite(createdAtEpoch)
    ? new Intl.DateTimeFormat("ar-SA", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(createdAtEpoch))
    : "-";

  const totalFinalPrice = allBookings.reduce((sum, item) => sum + Number(item.finalPrice || 0), 0);
  const discountTotal = allBookings.reduce(
    (sum, item) => sum + Math.max(0, Number(item.discountAmount || 0)),
    0
  );
  const paymentTotals = allBookings.map((item) => resolveItemPayment(item));
  const paidTotal = paymentTotals.reduce((sum, item) => sum + Number(item.paidAmount || 0), 0);
  const remainingTotal = paymentTotals.reduce((sum, item) => sum + Number(item.remainingAmount || 0), 0);
  const invoicePaymentType: BookingPaymentType =
    paidTotal <= 0 && remainingTotal > 0 ? "none" : remainingTotal > 0 ? "partial" : "full";
  const paymentBreakdownTotal = normalizePaymentBreakdown(
    paymentTotals.reduce(
      (sum, item) => {
        const breakdown = normalizePaymentBreakdown(item.paymentBreakdown);
        return {
          cash: roundMoney2(sum.cash + breakdown.cash),
          card: roundMoney2(sum.card + breakdown.card),
          transfer: roundMoney2(sum.transfer + breakdown.transfer),
        };
      },
      { cash: 0, card: 0, transfer: 0 }
    )
  );
  const paymentBreakdownTotalLines = paymentBreakdownLines(paymentBreakdownTotal);
  const firstPaidPayment = paymentTotals.find((item) => Number(item.paidAmount || 0) > 0);
  const hasMixedPayment = paymentTotals.some(
    (item) => Number(item.paidAmount || 0) > 0 && item.paymentMethod === "mixed"
  );
  const invoicePaymentMethod =
    hasMixedPayment && sumPaymentBreakdown(paymentBreakdownTotal) > 0
      ? "mixed"
      : firstPaidPayment?.paymentMethod || null;
  const totalBeforeDiscount = totalFinalPrice + discountTotal;
  const offerTitle =
    String((allBookings.find((x) => String(x.offerTitle || "").trim())?.offerTitle || "")).trim() ||
    "";
  const invoicePrintKey = useMemo(() => {
    const rowKeys = allBookings
      .map((item, index) =>
        [
          item.id || index,
          item.publicId || "",
          readItemServiceName(item),
          item.date || "",
          item.time || "",
          Number(item.finalPrice || 0),
          Number(item.paidAmount || 0),
          Number(item.remainingAmount || 0),
        ].join(":")
      )
      .join("|");
    return [
      "internal-receipt",
      printRequestId || "legacy",
      publicId,
      totalFinalPrice,
      paidTotal,
      remainingTotal,
      rowKeys,
    ].join("::");
  }, [allBookings, paidTotal, printRequestId, publicId, remainingTotal, totalFinalPrice]);

  useEffect(() => {
    if (allBookings.length === 0) return;
    if (printEffectStartedRef.current) return;

    const receiptCount = document.querySelectorAll("#booking-print-receipt").length;
    if (receiptCount !== 1) {
      console.warn(`Expected one #booking-print-receipt element, found ${receiptCount}.`);
      if (receiptCount < 1) return;
    }

    const state = getInternalReceiptPrintState();
    const now = Date.now();
    const printKey = invoicePrintKey;
    const activeIsFresh = state.activeKey === printKey && now - state.activeSince < 15_000;
    const justPrinted = state.lastPrintedKey === printKey && now - state.lastPrintedAt < 3_000;
    if (activeIsFresh || justPrinted) return;

    printEffectStartedRef.current = true;
    state.activeKey = printKey;
    state.activeSince = now;

    let closed = false;
    let printed = false;
    let closeTimer: number | null = null;
    let finishTimer: number | null = null;
    let resetTimer: number | null = null;

    const finishPrintCycle = () => {
      if (state.activeKey === printKey) {
        state.activeKey = "";
        state.activeSince = 0;
      }
      if (printed) {
        state.lastPrintedKey = printKey;
        state.lastPrintedAt = Date.now();
      }
    };

    const closeAfterPrint = () => {
      finishPrintCycle();
      // Close only when the page is opened as a popup/tab by script.
      if (window.opener || window.name === "internal_print_popup") {
        closeTimer = window.setTimeout(() => {
          try {
            window.close();
          } catch {
            // ignore browser restrictions
          }
        }, 250);
      }
    };

    window.addEventListener("afterprint", closeAfterPrint);
    const timer = window.setTimeout(() => {
      if (closed) return;
      printed = true;
      state.printCount += 1;

      const receipt =
        document.getElementById("booking-print-receipt");

      if (receipt) {
        const rect = receipt.getBoundingClientRect();
        const pxToMm = 25.4 / 96;

        const contentHeightMm = Math.max(
          30,
          Math.ceil(rect.height * pxToMm) + 2
        );

        let dynamicPrintStyle =
          document.getElementById(
            "malikat-dynamic-receipt-page-size"
          ) as HTMLStyleElement | null;

        if (!dynamicPrintStyle) {
          dynamicPrintStyle =
            document.createElement("style");

          dynamicPrintStyle.id =
            "malikat-dynamic-receipt-page-size";

          document.head.appendChild(
            dynamicPrintStyle
          );
        }

        dynamicPrintStyle.textContent = `
          @media print {
            @page {
              size: 80mm ${contentHeightMm}mm;
              margin: 0;
            }

            html,
            body,
            #print-area {
              width: 80mm !important;
              height: ${contentHeightMm}mm !important;
              min-height: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
            }

            #booking-print-receipt {
              width: 72mm !important;
              height: auto !important;
              min-height: 0 !important;
              margin: 0 auto !important;
              padding-bottom: 1mm !important;
              break-after: avoid !important;
              page-break-after: avoid !important;
            }

            #booking-print-receipt > :last-child {
              margin-bottom: 0 !important;
              padding-bottom: 0 !important;
            }
          }
        `;
      }

      prepareExactThermalPrintPage();

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.print();
        });
      });
      finishTimer = window.setTimeout(finishPrintCycle, 1200);
    }, 650);
    resetTimer = window.setTimeout(finishPrintCycle, 15_000);

    return () => {
      closed = true;
      window.clearTimeout(timer);
      if (finishTimer != null) window.clearTimeout(finishTimer);
      if (resetTimer != null) window.clearTimeout(resetTimer);
      if (closeTimer != null) window.clearTimeout(closeTimer);
      window.removeEventListener("afterprint", closeAfterPrint);
      if (!printed && state.activeKey === printKey) {
        state.activeKey = "";
        state.activeSince = 0;
        printEffectStartedRef.current = false;
      }
    };
  }, [allBookings.length, invoicePrintKey]);

  if (allBookings.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
        <h2>لا توجد بيانات فاتورة للطباعة.</h2>
      </div>
    );
  }

  return (
    <div id="print-area">
      <style>
        {`
:root {
  --receipt-width: 72mm;
  --font-family: 'Lucida Console', 'Courier New', monospace;
  --font-size-normal: 13px;
  --font-size-small: 11px;
  --font-size-large: 16px;
}

.receipt-container {
  width: var(--receipt-width);
  margin: 0 auto;
  box-sizing: border-box;
  height: auto;
  min-height: 0;
  padding: 12px 6px 10px;
  background: #fff;
  color: #000;
  font-family: var(--font-family);
  font-size: var(--font-size-normal);
  line-height: 1.5;
  direction: rtl;
  font-weight: 600;
}

.header {
  text-align: center;
  margin-bottom: 14px;
}
.header .brand-logo {
  font-size: 24px;
  font-weight: 700;
  margin: 0;
  letter-spacing: 1px;
  color: #000;
}
.header .subtitle {
  font-size: var(--font-size-small);
  color: #333;
  margin-top: 4px;
  font-weight: 600;
}

.line {
  border-top: 1px dashed #000;
  margin: 12px 0;
}

.info-section {
  text-align: center;
  margin-bottom: 6px;
}
.info-item {
  margin-bottom: 4px;
}
.info-item .key {
  font-weight: 700;
}
.info-item .value {
  direction: ltr;
  unicode-bidi: plaintext;
  font-weight: 600;
  display: block;
  font-size: 14px;
}
.info-item .value-rtl {
  direction: rtl;
}

.items-table {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: var(--font-size-normal);
  text-align: center;
}
.items-table th {
  padding-bottom: 6px;
  border-bottom: 1px solid #000;
  font-weight: 700;
}
.items-table td {
  padding: 6px 2px;
  vertical-align: top;
  border-bottom: 1px dotted #888;
}
.items-table tr:last-child td {
  border-bottom: none;
}
.items-table .service-name {
  white-space: normal;
  font-weight: 700;
}
.items-table .service-meta {
  font-size: var(--font-size-small);
  color: #555;
  padding-top: 2px;
  font-weight: 600;
}
.items-table .employee-name {
  font-size: var(--font-size-small);
  color: #444;
  padding-top: 2px;
  font-weight: 600;
}
.items-table .service-submeta {
  font-size: var(--font-size-small);
  color: #555;
  padding-top: 2px;
  font-weight: 600;
}
.items-table .service-tools {
  font-size: var(--font-size-small);
  color: #444;
  padding-top: 2px;
  font-weight: 600;
}
.items-table .price {
  direction: ltr;
  white-space: nowrap;
  font-weight: 700;
}

.totals-section {
  margin-top: 10px;
  padding-top: 6px;
  border-top: 1px dashed #000;
}
.totals-section .total-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: var(--font-size-normal);
  padding: 3px 0;
}
.totals-section .total-line .value {
  direction: ltr;
  white-space: nowrap;
}
.totals-section .total-line.is-before .value {
  text-decoration: line-through;
  color: #555;
}
.totals-section .total-line.is-discount .value {
  color: #a00;
}
.totals-section .total-line.is-final {
  margin-top: 6px;
  font-size: var(--font-size-large);
  font-weight: 700;
  padding: 8px 7px;
  background: #eee;
  border: 1px solid #000;
  border-radius: 4px;
}

.footer {
  text-align: center;
  margin-top: 8px;
  margin-bottom: 0;
  padding-top: 6px;
  padding-bottom: 0;
  border-top: 1px dashed #000;
  font-size: var(--font-size-small);
  font-weight: 600;
}

.footer p {
  margin: 0;
}

@media print {
  @page {
    size: 80mm auto;
    margin: 0;
  }
  body * {
    visibility: hidden !important;
  }
  #booking-print-receipt,
  #booking-print-receipt * {
    visibility: visible !important;
  }
  #booking-print-receipt {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    width: var(--receipt-width) !important;
    height: auto !important;
    min-height: 0 !important;
    margin: 0 !important;
  }
  html,
  body,
  #root,
  #print-area {
    margin: 0 !important;
    padding: 0 !important;
    height: auto !important;
    min-height: 0 !important;
    background: #fff !important;
  }
  * {
    -webkit-print-color-adjust: economy !important;
    print-color-adjust: economy !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }
  .receipt-container {
    height: auto !important;
    min-height: 0 !important;
    margin-bottom: 0 !important;
    padding: 2mm 2mm 1mm !important;
    overflow: visible !important;
  }

  #print-area {
    margin: 0 !important;
    padding: 0 !important;
    min-height: 0 !important;
  }

  .footer,
  .footer p {
    margin-bottom: 0 !important;
    padding-bottom: 0 !important;
  }
}
        `}
      </style>

      <div
        id="booking-print-receipt"
        className="receipt-container"
        data-print-request-id={printRequestId || undefined}
      >
        <header className="header">
          <h1 className="brand-logo">Malikat</h1>
          <p className="subtitle">MALIKAT SALON - فاتورة حجز</p>
        </header>

        <div className="line" />

        <section className="info-section">
          <div className="info-item">
            <span className="key">رقم الحجز المرجعي</span>
            <span className="value">{publicId}</span>
          </div>
          <div className="info-item">
            <span className="key">العميلة</span>
            <span className="value value-rtl">{clientName}</span>
          </div>
          <div className="info-item">
            <span className="key">الجوال</span>
            <span className="value">{clientPhone}</span>
          </div>
          <div className="info-item">
            <span className="key">تاريخ الحجز</span>
            <span className="value">{mainDate}</span>
          </div>
          <div className="info-item">
            <span className="key">وقت إنشاء الحجز</span>
            <span className="value">{createdAtLabel}</span>
          </div>
        </section>

        <div className="line" />

        <table className="items-table">
          <thead>
            <tr>
              <th>تفاصيل الخدمة</th>
              <th>السعر</th>
            </tr>
          </thead>
          <tbody>
            {allBookings.map((item, index) => {
              const serviceName = readItemServiceName(item) || "-";
              const sectionLabel = readItemSectionLabel(item);
              const categoryLabel = readItemCategoryLabel(item);
              const serviceMeta = [sectionLabel, categoryLabel].filter(Boolean).join(" / ");
              const empTime = [
                item.employeeName ? `(${item.employeeName})` : "",
                formatTime12(item.time || "", ""),
                item.date ? String(item.date || "").trim() : "",
              ]
                .filter(Boolean)
                .join(" - ");
              const durationText =
                Number(item.durationMin || 0) > 0 ? `المدة: ${Number(item.durationMin || 0)} د` : "";
              const toolsText = readToolsLabel(item);

              return (
                <tr key={String(item.id || index)}>
                  <td>
                    <div className="service-name">{serviceName}</div>
                    {serviceMeta ? <div className="service-meta">{serviceMeta}</div> : null}
                    {empTime ? <div className="employee-name">{empTime}</div> : null}
                    {durationText ? <div className="service-submeta">{durationText}</div> : null}
                    {toolsText ? <div className="service-tools">{toolsText}</div> : null}
                  </td>
                  <td className="price">{formatCurrency(item.finalPrice || 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="line" />

        <section className="totals-section">
          {discountTotal > 0 ? (
            <>
              <div className="total-line is-before">
                <span>قبل الخصم:</span>
                <span className="value">{formatCurrency(totalBeforeDiscount)} ر.س</span>
              </div>
              <div className="total-line is-discount">
                <span>الخصم{offerTitle ? ` (${offerTitle})` : ""}:</span>
                <span className="value">-{formatCurrency(discountTotal)} ر.س</span>
              </div>
            </>
          ) : null}
          <div className="total-line is-final">
            <span>الإجمالي:</span>
            <span className="value">{formatCurrency(totalFinalPrice)} ر.س</span>
          </div>
          <div className="total-line">
            <span>نوع الدفع:</span>
            <span className="value">
              {invoicePaymentType === "none"
                ? "بدون دفع"
                : invoicePaymentType === "partial"
                  ? "عربون"
                  : "كامل"}
            </span>
          </div>
          {invoicePaymentMethod && paidTotal > 0 ? (
            <div className="total-line">
              <span>طريقة الدفع:</span>
              <span className="value">{bookingPaymentMethodLabelAr(invoicePaymentMethod)}</span>
            </div>
          ) : null}
          {invoicePaymentMethod === "mixed" && paymentBreakdownTotalLines.length > 0 ? (
            <div className="receipt-payment-breakdown">
              {paymentBreakdownTotalLines.map((line) => (
                <div className="total-line is-breakdown" key={line}>
                  <span>{line.split(" ")[0]}:</span>
                  <span className="value">{line.replace(/^[^\s]+\s+/, "")}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="total-line">
            <span>المدفوع:</span>
            <span className="value">{formatCurrency(paidTotal)} ر.س</span>
          </div>
          <div className="total-line">
            <span>المتبقي:</span>
            <span className="value">{formatCurrency(remainingTotal)} ر.س</span>
          </div>
          {invoicePaymentType === "partial" ? (
            <div className="total-line">
              <span>دفعت عربون:</span>
              <span className="value">{formatCurrency(paidTotal)} ر.س</span>
            </div>
          ) : null}
        </section>

        <footer className="footer">
          <p>شكرًا لزيارتكم!</p>
        </footer>
      </div>
    </div>
  );
}
