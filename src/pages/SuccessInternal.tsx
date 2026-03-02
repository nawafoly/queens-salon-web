import { useEffect, useMemo } from "react";
import { formatTime12 } from "../helpers/timeDisplay";

type BookingPaymentType = "full" | "partial";

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

function normalizePaymentType(raw: any): BookingPaymentType | null {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "full" || s === "complete" || s === "كامل") return "full";
  if (s === "partial" || s === "deposit" || s === "عربون" || s === "جزئي") return "partial";
  return null;
}

function resolveItemPayment(item: BookingItem) {
  const totalAmount = Math.max(0, Number(item?.finalPrice ?? item?.total ?? 0) || 0);
  const normalizedType = normalizePaymentType(item?.paymentType);
  const hasExplicitPaid = Number.isFinite(Number(item?.paidAmount));
  const explicitPaid = hasExplicitPaid ? Number(item?.paidAmount) : NaN;
  const status = String(item?.status || "").trim().toLowerCase();
  const isRevenueStatus = status === "confirmed" || status === "completed";

  let paymentType: BookingPaymentType = normalizedType || (isRevenueStatus ? "full" : "partial");
  let paidAmount: number;
  if (hasExplicitPaid) {
    paidAmount = Math.max(0, Math.min(totalAmount, explicitPaid));
  } else if (paymentType === "partial") {
    paidAmount = 0;
  } else {
    paidAmount = isRevenueStatus ? totalAmount : totalAmount;
  }

  if (paymentType === "full") {
    paidAmount = Math.max(0, Math.min(totalAmount, paidAmount));
  } else {
    paymentType = paidAmount >= totalAmount ? "full" : "partial";
  }
  const remainingAmount = Math.max(0, Math.round((totalAmount - paidAmount) * 100) / 100);
  return {
    paymentType,
    paidAmount: Math.round(Math.max(0, Math.min(totalAmount, paidAmount)) * 100) / 100,
    remainingAmount,
    totalAmount: Math.round(totalAmount * 100) / 100,
  };
}

export default function SuccessInternal() {
  const bookingInfo = useMemo<CurrentBooking | null>(
    () => safeParse<CurrentBooking | null>("currentBooking", null),
    []
  );

  const allBookings = useMemo<BookingItem[]>(
    () => safeParse<BookingItem[]>("allBookings", []),
    []
  );

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
  const invoicePaymentType: BookingPaymentType = remainingTotal > 0 ? "partial" : "full";
  const totalBeforeDiscount = totalFinalPrice + discountTotal;
  const offerTitle =
    String((allBookings.find((x) => String(x.offerTitle || "").trim())?.offerTitle || "")).trim() ||
    "";

  useEffect(() => {
    if (allBookings.length === 0) return;
    let closeTimer: number | null = null;
    const closeAfterPrint = () => {
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
    const timer = window.setTimeout(() => window.print(), 800);
    return () => {
      window.clearTimeout(timer);
      if (closeTimer != null) window.clearTimeout(closeTimer);
      window.removeEventListener("afterprint", closeAfterPrint);
    };
  }, [allBookings]);

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
  padding: 15px 5px;
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
  margin-bottom: 8px;
}
.info-item {
  margin-bottom: 5px;
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
  margin: 14px 0;
  font-size: var(--font-size-normal);
  text-align: center;
}
.items-table th {
  padding-bottom: 6px;
  border-bottom: 1px solid #000;
  font-weight: 700;
}
.items-table td {
  padding: 8px 2px;
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
  margin-top: 14px;
}
.totals-section .total-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
  padding: 8px;
  background: #eee;
  border-radius: 4px;
}

.footer {
  text-align: center;
  margin-top: 20px;
  font-size: var(--font-size-small);
  font-weight: 600;
}

@media print {
  @page {
    size: 80mm auto;
    margin: 0;
  }
  body * {
    visibility: hidden !important;
  }
  #print-area,
  #print-area * {
    visibility: visible !important;
  }
  #print-area {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 80mm !important;
  }
  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }
  * {
    -webkit-print-color-adjust: economy !important;
    print-color-adjust: economy !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }
  .receipt-container {
    padding: 0 !important;
  }
}
        `}
      </style>

      <div className="receipt-container">
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
            <span className="value">{invoicePaymentType === "partial" ? "عربون" : "كامل"}</span>
          </div>
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
