import { useEffect, useMemo } from "react";

// --- Types ---
type BookingItem = {
  serviceName?: string;
  employeeName?: string;
  date?: string;
  time?: string;
  finalPrice?: number;
};

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

function normalizePhone(v: any): string {
  const s = String(v ?? "").trim();
  return s || "-";
}

function formatCurrency(num: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// --- Component ---
export default function SuccessInternal() {
  const booking = useMemo<CurrentBooking | null>(
    () => safeParse<CurrentBooking | null>("currentBooking", null),
    []
  );

  const allBookings = useMemo<BookingItem[]>(
    () => safeParse<BookingItem[]>("allBookings", []),
    []
  );

  const profile = useMemo(
    () => safeParse<any>("userProfile", null) || safeParse<any>("profile", null),
    []
  );

  const lastClientName =
    profile?.name || profile?.fullName || profile?.displayName || "";
  const lastClientPhone =
    profile?.phone || profile?.phoneNumber || profile?.mobile || "";

  const publicId = booking?.publicId || "-";
  const clientName =
    (booking?.clientName || lastClientName || "-").trim() || "-";
  const clientPhone = normalizePhone(booking?.clientPhone || lastClientPhone);
  const date = (booking?.date || "-").trim() || "-";
  const time = (booking?.time || "-").trim() || "-";

  const total = allBookings.reduce((sum, b) => sum + Number(b.finalPrice || 0), 0);

  useEffect(() => {
    if (!booking) return;
  
    const timer = setTimeout(() => {
      // Using requestAnimationFrame for better rendering before print
      requestAnimationFrame(() => {
        window.print();
      });
    }, 800);
  
    return () => clearTimeout(timer);
  }, [booking]);
  

  if (!booking) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          fontFamily: "sans-serif",
          color: "#555",
        }}
      >
        لا توجد بيانات لعرض الفاتورة.
      </div>
    );
  }

  return (
    <div id="print-area">
      <style>
        {`
:root {
  --receipt-width: 72mm;
  /* Using a clearer, slightly wider monospace font */
  --font-family: 'Lucida Console', 'Courier New', monospace;
  --font-size-normal: 13px; /* Increased for clarity */
  --font-size-small: 11px;
  --font-size-large: 17px;
}

.receipt-container {
  width: var(--receipt-width);
  margin: 0 auto;
  padding: 15px 5px; /* Added horizontal padding for better spacing */
  background: #fff;
  color: #000;
  font-family: var(--font-family);
  font-size: var(--font-size-normal);
  line-height: 1.5; /* Increased for readability */
  direction: rtl;
  font-weight: 600; /* Make all text bolder by default */
}

.header {
  text-align: center;
  margin-bottom: 15px;
}
.header .brand-logo {
  font-size: 24px; /* Larger brand name */
  font-weight: 700; /* Bolder */
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
  border-top: 1px dashed #000; /* Darker line */
  margin: 12px 0;
}

/* Centered Key-Value Section */
.info-section {
  text-align: center; /* Center all text within this section */
  margin-bottom: 10px;
}
.info-item {
  margin-bottom: 5px;
}
.info-item .key {
  font-weight: 700; /* Extra bold key */
}
.info-item .value {
  direction: ltr;
  unicode-bidi: plaintext;
  font-weight: 600;
  display: block; /* Make value appear on a new line */
  font-size: 14px; /* Larger value text */
}
.info-item .value-rtl {
  direction: rtl; /* For Arabic values like client name */
}


/* Centered Items Table */
.items-table {
  width: 100%;
  border-collapse: collapse;
  margin: 15px 0;
  font-size: var(--font-size-normal);
  text-align: center; /* Center all table content */
}
.items-table th {
  padding-bottom: 6px;
  border-bottom: 1px solid #000;
  font-weight: 700; /* Bolder headers */
}
.items-table td {
  padding: 8px 2px; /* More vertical padding */
  vertical-align: top;
  border-bottom: 1px dotted #888; /* Dotted line between items */
}
.items-table tr:last-child td {
  border-bottom: none; /* No line for the last item */
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
  font-weight: 700; /* Bolder price */
}

/* Centered Totals Section */
.totals-section {
  margin-top: 15px;
  text-align: center;
}
.totals-section .total-row {
  font-size: var(--font-size-large);
  font-weight: 700; /* BOLD TOTAL */
  padding: 8px;
  background: #eee;
  border-radius: 4px;
  display: inline-block; /* To make it fit the content */
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

/* --- PRINT LOGIC (UNCHANGED) --- */
@media print {
  @page { size: 80mm auto; margin: 0; }

  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }

  body > * { visibility: hidden !important; }

  #print-area, #print-area * { visibility: visible !important; }

  #print-area {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
  }

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
            <span className="key">رقم الحجز</span>
            <span className="value">{publicId}</span>
          </div>
          <div className="info-item">
            <span className="key">العميلة</span>
            <span className="value value-rtl">{clientName}</span>
          </div>
          <div className="info-item">
            <span className="key">التاريخ والوقت</span>
            <span className="value">{date} - {time}</span>
          </div>
        </section>

        <div className="line" />

        <table className="items-table">
          <thead>
            <tr>
              <th>الخدمة</th>
              <th>السعر</th>
            </tr>
          </thead>
          <tbody>
            {allBookings.map((item, index) => (
              <tr key={index}>
                <td>
                  <div className="service-name">{item.serviceName || "-"}</div>
                  {item.employeeName && (
                    <div className="employee-name">({item.employeeName})</div>
                  )}
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
            <span className="value">{formatCurrency(total)} ر.س</span>
          </div>
        </section>

        <footer className="footer">
          <p>شكراً لزيارتكم!</p>
        </footer>
      </div>
    </div>
  );
}
