import { useEffect, useMemo } from "react";
import { formatTime12 } from "../helpers/timeDisplay";

// --- Types (مطابقة للأنواع في صفحة الحجز) ---
type BookingItem = {
  serviceName?: string;
  employeeName?: string;
  date?: string;
  time?: string;
  finalPrice?: number; // السعر النهائي للخدمة بعد الخصم
};

// هذا النوع يمثل أول حجز في القائمة لتفاصيل العميل العامة
type CurrentBooking = {
  publicId?: string;
  clientName?: string;
  clientPhone?: string;
  date?: string;
  time?: string;
};

// --- Utility Functions ---
function safeParse<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function formatCurrency(num: number): string {
  // تنسيق الرقم ليكون دائماً بمنزلتين عشريتين
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// --- Component ---
export default function SuccessInternal() {
  // --- 1. قراءة بيانات الحجوزات من LocalStorage ---

  // `currentBooking` يحتوي على بيانات أول حجز (للحصول على اسم العميل ورقم الجوال)
  const bookingInfo = useMemo<CurrentBooking | null>(
    () => safeParse<CurrentBooking | null>("currentBooking", null),
    []
  );

  // `allBookings` يحتوي على **جميع** الخدمات التي تم حجزها
  const allBookings = useMemo<BookingItem[]>(
    () => safeParse<BookingItem[]>("allBookings", []),
    []
  );

  // --- 2. تجهيز البيانات للعرض ---
  const publicId = bookingInfo?.publicId || "-";
  const clientName = (bookingInfo?.clientName || "-").trim();
  const clientPhone = (bookingInfo?.clientPhone || "-").trim();

  // تاريخ ووقت أول خدمة كمرجع عام للفاتورة
  const mainDate = (bookingInfo?.date || "-").trim();
  const mainTime = (bookingInfo?.time || "-").trim();

  // حساب الإجمالي النهائي بجمع أسعار كل الخدمات
  const totalFinalPrice = allBookings.reduce(
    (sum, item) => sum + Number(item.finalPrice || 0),
    0
  );

  // --- 3. تشغيل الطباعة تلقائياً ---
  useEffect(() => {
    // لا تطبع إذا لم تكن هناك بيانات
    if (!bookingInfo || allBookings.length === 0) return;

    const timer = setTimeout(() => {
      window.print();
    }, 800); // تأخير بسيط لضمان عرض كل شيء قبل الطباعة

    return () => clearTimeout(timer);
  }, [bookingInfo, allBookings]);

  // --- 4. رسالة في حال عدم وجود بيانات ---
  if (!bookingInfo || allBookings.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h2>لا توجد بيانات فاتورة للطباعة.</h2>
      </div>
    );
  }

  // --- 5. عرض الفاتورة للطباعة ---
  return (
    <div id="print-area">
      <style>
        {`
:root {
  --receipt-width: 72mm;
  --font-family: 'Lucida Console', 'Courier New', monospace;
  --font-size-normal: 13px;
  --font-size-small: 11px;
  --font-size-large: 17px;
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
  margin-bottom: 15px;
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
  margin-bottom: 10px;
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
  margin: 15px 0;
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
  font-weight: 600;
}
.items-table .employee-name {
  font-size: var(--font-size-small);
  color: #444;
  padding-top: 3px;
  font-weight: 600;
}
.items-table .price {
  direction: ltr;
  white-space: nowrap;
  font-weight: 700;
}

.totals-section {
  margin-top: 15px;
  text-align: center;
}
.totals-section .total-row {
  font-size: var(--font-size-large);
  font-weight: 700;
  padding: 8px;
  background: #eee;
  border-radius: 4px;
  display: inline-block;
}
.totals-section .total-row .value {
  direction: ltr;
  margin-right: 10px;
}

.footer {
  text-align: center;
  margin-top: 20px;
  font-size: var(--font-size-small);
  font-weight: 600;
}

/* --- منطق الطباعة (بدون تغيير) --- */
@media print {
  @page { size: 80mm auto; margin: 0; }
@media print {
  body * { visibility: hidden !important; }
  #print-area, #print-area * { visibility: visible !important; }
  #print-area { position: fixed !important; top: 0 !important; left: 0 !important; width: 80mm !important; }
}
  #print-area { position: absolute; top: 0; left: 0; width: 100%; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  #print-area, #print-area * { visibility: visible !important; }
  * {
    -webkit-print-color-adjust: economy !important;
    print-color-adjust: economy !important;
    box-shadow: none !important;
    text-shadow: none !important;
  }
  .receipt-container { padding: 0 !important; }
}
        `}
      </style>

      <div className="receipt-container">
        <header className="header">
          <h1 className="brand-logo">Malikat</h1>
          <p className="subtitle">Queens Salon — فاتورة حجز</p>
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
        </section>

        <div className="line" />

        <table className="items-table">
          <thead>
            <tr>
              <th>الخدمة / الموظفة / الوقت</th>
              <th>السعر</th>
            </tr>
          </thead>
          <tbody>
            {/* ✅ الكود المصحح لعرض تفاصيل الخدمة */}
            {allBookings.map((item, index) => (
              <tr key={index}>
                <td>
                  <div className="service-name">{item.serviceName || "-"}</div>
                  <div className="employee-name">
                    {/* 
              الإصلاح: 
              - القوسين يظهران فقط إذا كان اسم الموظفة موجوداً.
              - تم إزالة "غير محدد" من الوقت ليكون أنظف.
            */}
                    {item.employeeName && `(${item.employeeName})`}{' - '}{formatTime12(item.time || "", "")}
                  </div>
                </td>
                <td className="price">{formatCurrency(item.finalPrice || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>


        <div className="line" />

        <section className="totals-section">
          <div className="total-row">
            <span>الإجمالي:</span>
            <span className="value">{formatCurrency(totalFinalPrice)} ر.س</span>
          </div>
        </section>

        <footer className="footer">
          <p>شكراً لزيارتكم!</p>
        </footer>
      </div>
    </div>
  );
}
